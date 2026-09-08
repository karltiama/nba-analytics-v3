/**
 * Step 4E: dry-run 2023 provider-quality policy. No BDL HTTP. No Postgres writes.
 *
 *   npx tsx scripts/ops/preflight-2023-provider-quality.ts
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import type { BdlEnvelope } from '@/lib/balldontlie/archive-client';
import { assertCompleteHistoricalArchive, type BdlEntityManifest } from '@/lib/ingestion/historical-serving/archive-gate';
import {
  transformBdlArchiveToServing,
  type BdlGame,
  type BdlStat,
  type ExistingGameRow,
  type TeamCatalogRow,
} from '@/lib/ingestion/historical-serving/bdl-to-serving';
import { buildServingBackfillPlan } from '@/lib/ingestion/historical-serving/plan';
import {
  PERSISTENT_2023_ANOMALIES,
  PERSISTENT_2023_ANOMALY_IDS,
  BDL_PLAYER_POINTS_SCORE_MISMATCH,
  ANOMALY_SEMANTICS,
  QUALITY_TABLE,
  RESEARCH_EXCLUDE_UNRESOLVED_HIGH_SQL,
  evaluateSeason,
  projectedValidationRow,
  specForGame,
  type GameEvidence,
  type RawStatRef,
} from '@/lib/ingestion/historical-serving/provider-quality-policy';
import { LOAD_EXISTING_GAMES_SQL, LOAD_TEAM_CATALOG_SQL } from '@/lib/ingestion/historical-serving/season-scoped-writes';
import { planCompletedSeasonStintsFromLogs } from '@/lib/ingestion/historical-serving/stints-from-logs';
import { historicalSeasonWindow } from '@/lib/ingestion/historical-serving/season-window';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const SEASON = 2023;
const OUT_JSON = 'reports/trial/2023-provider-quality-policy.json';
const OUT_MD = 'reports/trial/2023-provider-quality-policy.md';
const BOX_ID = '18447793';
const EXPECTED = {
  gamesRecords: 1319,
  statsRecords: 46090,
  games2024: 1321,
  logs2024: 46150,
  tgs2024: 2642,
  psa2024: 587,
  tsa2024: 30,
  inferred2024: 699,
  games2025: 1323,
  logs2025: 46056,
  tgs2025: 2644,
  rawPgs: 46056,
  games2026: 1200,
  logs2026: 0,
  stints2026: 578,
  boxHome: 109,
  boxAway: 118,
  delta2024Mb: 10.95,
  dbAfter2024Mb: 315.02,
};

function sid(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function mb(n: number): number {
  return Math.round(n * 100) / 100;
}

function toNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

async function listPageKeys(s3: S3Storage, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const obj of s3.listByPrefix(`${prefix}/`)) {
    if (/\/page=\d+\.json$/.test(obj.key)) keys.push(obj.key);
  }
  keys.sort((a, b) => {
    const na = Number((a.match(/page=(\d+)\.json$/) ?? [])[1] ?? 0);
    const nb = Number((b.match(/page=(\d+)\.json$/) ?? [])[1] ?? 0);
    return na - nb;
  });
  return keys;
}

async function loadEnvelopeData<T>(s3: S3Storage, keys: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (const key of keys) {
    const env = await s3.getJson<BdlEnvelope>(key);
    if (env && Array.isArray(env.data)) rows.push(...(env.data as T[]));
  }
  return rows;
}

function ptsByTeam(stats: BdlStat[], homeId: string, awayId: string) {
  let home = 0;
  let away = 0;
  const players = new Set<string>();
  for (const s of stats) {
    const pid = sid(s.player?.id);
    const tid = sid(s.team?.id);
    if (pid) players.add(pid);
    const pts = toNum(s.pts);
    if (tid === homeId) home += pts;
    else if (tid === awayId) away += pts;
  }
  return { home, away, players };
}

function teamSide(raw: unknown): { id: string; players: Array<Record<string, unknown>> } {
  const side = (raw ?? {}) as Record<string, unknown>;
  const nested = side.team && typeof side.team === 'object' ? (side.team as Record<string, unknown>) : side;
  const players = Array.isArray(side.players) ? (side.players as Array<Record<string, unknown>>) : [];
  return { id: sid(nested.id), players };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const window = historicalSeasonWindow(SEASON);
  const plan = buildServingBackfillPlan({
    season: SEASON,
    rawPrefix: process.env.NBA_RAW_PREFIX,
    blockedReason: null,
  });
  const unsafe: string[] = [];
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode || '(empty)'}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== '2025') unsafe.push(`season pin=${pin}`);
  if (plan.stagingMode !== 'none') unsafe.push(`stagingMode=${plan.stagingMode}`);

  const pg = await pool.connect();
  try {
    await pg.query('begin read only');
    const snap = await pg.query(
      `select
         pg_database_size(current_database())::bigint as db_bytes,
         (select count(*)::int from analytics.games where season = '2023') as games_2023,
         (select count(*)::int from analytics.player_game_logs where season = '2023') as logs_2023,
         (select count(*)::int from analytics.team_game_stats where season = '2023') as tgs_2023,
         (select count(*)::int from analytics.player_season_averages where season = '2023') as psa_2023,
         (select count(*)::int from analytics.team_season_averages where season = '2023') as tsa_2023,
         (select count(*)::int from analytics.player_team_stints where season = '2023') as stints_2023,
         (select count(*)::int from raw.player_game_stats) as raw_pgs,
         (select count(*)::int
            from raw.player_game_stats s
            join analytics.games g on g.game_id = s.game_id::text
           where g.season = '2023') as raw_pgs_2023,
         (select count(*)::int from analytics.games where season = '2024') as games_2024,
         (select count(*)::int from analytics.player_game_logs where season = '2024') as logs_2024,
         (select count(*)::int from analytics.team_game_stats where season = '2024') as tgs_2024,
         (select count(*)::int from analytics.player_season_averages where season = '2024') as psa_2024,
         (select count(*)::int from analytics.team_season_averages where season = '2024') as tsa_2024,
         (select count(*)::int from analytics.player_team_stints
           where season = '2024' and source = 'inferred_pgl') as inferred_2024,
         (select count(*)::int from analytics.games where season = '2025') as games_2025,
         (select count(*)::int from analytics.player_game_logs where season = '2025') as logs_2025,
         (select count(*)::int from analytics.team_game_stats where season = '2025') as tgs_2025,
         (select count(*)::int from analytics.games where season = '2026') as games_2026,
         (select count(*)::int from analytics.player_game_logs where season = '2026') as logs_2026,
         (select count(*)::int from analytics.player_team_stints where season = '2026') as stints_2026,
         (select count(*)::int from game_validation_results) as gvr_rows`
    );
    const box = await pg.query(`select home_score, away_score from analytics.games where game_id = $1`, [BOX_ID]);
    const gvrSample = await pg.query<{ game_id: string }>(`select game_id from game_validation_results limit 3`);
    const teamCatalog = (await pg.query<TeamCatalogRow>(LOAD_TEAM_CATALOG_SQL)).rows;
    const s = snap.rows[0]!;
    const n = (k: string) => Number(s[k]);
    const serving = {
      games_2023: n('games_2023'),
      logs_2023: n('logs_2023'),
      tgs_2023: n('tgs_2023'),
      psa_2023: n('psa_2023'),
      tsa_2023: n('tsa_2023'),
      stints_2023: n('stints_2023'),
      raw_pgs: n('raw_pgs'),
      raw_pgs_2023: n('raw_pgs_2023'),
      games_2024: n('games_2024'),
      logs_2024: n('logs_2024'),
      tgs_2024: n('tgs_2024'),
      psa_2024: n('psa_2024'),
      tsa_2024: n('tsa_2024'),
      inferred_2024: n('inferred_2024'),
      games_2025: n('games_2025'),
      logs_2025: n('logs_2025'),
      tgs_2025: n('tgs_2025'),
      games_2026: n('games_2026'),
      logs_2026: n('logs_2026'),
      stints_2026: n('stints_2026'),
      gvr_rows: n('gvr_rows'),
      box184: box.rows[0]
        ? { home: Number(box.rows[0].home_score), away: Number(box.rows[0].away_score) }
        : null,
    };
    if (serving.games_2023 !== 0 || serving.logs_2023 !== 0 || serving.tgs_2023 !== 0 || serving.psa_2023 !== 0 || serving.tsa_2023 !== 0 || serving.stints_2023 !== 0 || serving.raw_pgs_2023 !== 0) {
      unsafe.push('2023 serving/raw not empty');
    }
    if (serving.games_2024 !== EXPECTED.games2024 || serving.logs_2024 !== EXPECTED.logs2024 || serving.tgs_2024 !== EXPECTED.tgs2024 || serving.psa_2024 !== EXPECTED.psa2024 || serving.tsa_2024 !== EXPECTED.tsa2024 || serving.inferred_2024 !== EXPECTED.inferred2024) {
      unsafe.push('2024 isolation unexpected');
    }
    if (serving.games_2025 !== EXPECTED.games2025 || serving.logs_2025 !== EXPECTED.logs2025 || serving.tgs_2025 !== EXPECTED.tgs2025) {
      unsafe.push('2025 isolation unexpected');
    }
    if (serving.games_2026 !== EXPECTED.games2026 || serving.logs_2026 !== EXPECTED.logs2026 || serving.stints_2026 !== EXPECTED.stints2026) {
      unsafe.push('2026 isolation unexpected');
    }
    if (serving.box184?.home !== EXPECTED.boxHome || serving.box184?.away !== EXPECTED.boxAway) unsafe.push('18447793 unexpected');
    if (serving.raw_pgs !== EXPECTED.rawPgs) unsafe.push(`raw.player_game_stats ${serving.raw_pgs}`);

    const safety = {
      dataMode: mode.dataMode,
      offseasonMode: mode.offseason,
      cronDryRun: mode.cronDryRun,
      frozen: mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun,
      currentAnalyticsSeason: pin,
      bdlHttpRequests: 0,
      postgresWrites: false,
      serving,
    };

    await pg.query('commit');
    const dbBytes = Number(s.db_bytes);
    const gvrSampleIds = gvrSample.rows.map((r) => r.game_id);
    const teams = teamCatalog;

    if (unsafe.length) {
      const stopped = {
        generatedAt,
        step: '4E',
        stopped: true,
        reason: 'safety preflight failed',
        unsafe,
        safety,
        verdict: 'RED — do not materialize 2023',
      };
      mkdirSync('reports/trial', { recursive: true });
      writeFileSync(OUT_JSON, JSON.stringify(stopped, null, 2) + '\n');
      console.log(JSON.stringify(stopped, null, 2));
      process.exit(2);
    }

    const bucket = process.env.NBA_DATA_BUCKET?.trim();
    if (!bucket) throw new Error('Missing NBA_DATA_BUCKET');
    const s3 = new S3Storage({ bucket });
    const gamesManifest = await s3.getJson<BdlEntityManifest>(`${plan.s3GamesPrefix}/_manifest.json`);
    const statsManifest = await s3.getJson<BdlEntityManifest>(`${plan.s3StatsPrefix}/_manifest.json`);
    const gamesPageKeys = await listPageKeys(s3, plan.s3GamesPrefix);
    const statsPageKeys = await listPageKeys(s3, plan.s3StatsPrefix);
    const gate = assertCompleteHistoricalArchive({
      season: SEASON,
      gamesManifest,
      statsManifest,
      gamesPageKeys,
      statsPageKeys,
    });
    console.log('  loading 2023 S3 archive (no BDL HTTP)...');
    const games = await loadEnvelopeData<BdlGame>(s3, gamesPageKeys);
    const statsRows = await loadEnvelopeData<BdlStat>(s3, statsPageKeys);
    const gameIds = games.map((g) => sid(g.id)).filter(Boolean);
    const existing = gameIds.length
      ? (await pg.query<ExistingGameRow>(LOAD_EXISTING_GAMES_SQL, [gameIds])).rows
      : [];

    const report = transformBdlArchiveToServing({
      seasonStartYear: SEASON,
      games,
      stats: statsRows,
      teamCatalog: teams,
      existingGames: existing,
    });

    const rawStatsByGame = new Map<string, RawStatRef[]>();
    const seasonStatsByGame = new Map<string, BdlStat[]>();
    for (const srow of statsRows) {
      const gid = sid(srow.game?.id);
      if (!gid) continue;
      const list = seasonStatsByGame.get(gid) ?? [];
      list.push(srow);
      seasonStatsByGame.set(gid, list);
      const raw = rawStatsByGame.get(gid) ?? [];
      raw.push({
        id: sid(srow.id),
        playerId: sid(srow.player?.id),
        teamId: sid(srow.team?.id),
        gameId: gid,
      });
      rawStatsByGame.set(gid, raw);
    }

    const logsByGame = new Map<string, typeof report.logs>();
    for (const log of report.logs) {
      const list = logsByGame.get(log.game_id) ?? [];
      list.push(log);
      logsByGame.set(log.game_id, list);
    }

    const evidenceByGame = new Map<string, GameEvidence>();
    const evidenceNotes: Array<Record<string, unknown>> = [];
    for (const spec of PERSISTENT_2023_ANOMALIES) {
      const g = report.games.find((x) => x.game_id === spec.gameId);
      const orig = seasonStatsByGame.get(spec.gameId) ?? [];
      const repair = await s3.getJson<{ pages?: BdlEnvelope[] }>(`${plan.s3StatsPrefix}/game_id=${spec.gameId}.json`);
      const fresh = (repair?.pages ?? []).flatMap((p) => (Array.isArray(p.data) ? (p.data as BdlStat[]) : []));
      const origSum = ptsByTeam(orig, g?.home_team_id ?? '', g?.away_team_id ?? '');
      const freshSum = ptsByTeam(fresh, g?.home_team_id ?? '', g?.away_team_id ?? '');
      const refetchIdentical =
        origSum.home === freshSum.home &&
        origSum.away === freshSum.away &&
        origSum.players.size === freshSum.players.size &&
        [...origSum.players].every((id) => freshSum.players.has(id));

      let boxScores: GameEvidence['boxScores'] = spec.boxScoresEvidence;
      if (spec.boxScoresEvidence === 'sampled_reproduced') {
        const date = sid((games.find((x) => sid(x.id) === spec.gameId) as BdlGame | undefined)?.date);
        const diag = await s3.getJson<{ body?: { data?: Array<Record<string, unknown>> } }>(
          `raw/source=balldontlie/league=nba/season=2023/entity=box_scores_diagnostic/date=${date}.json`
        );
        const boxes = diag?.body?.data ?? [];
        const box = boxes.find((b) => sid(b.id) === spec.gameId) ?? null;
        if (!box) boxScores = 'missing';
        else {
          const home = teamSide(box.home_team);
          const away = teamSide(box.visitor_team);
          let homePts = 0;
          let awayPts = 0;
          for (const p of home.players) homePts += toNum(p.pts);
          for (const p of away.players) awayPts += toNum(p.pts);
          if (homePts !== spec.providerSum.home || awayPts !== spec.providerSum.away) boxScores = 'missing';
        }
      }
      evidenceByGame.set(spec.gameId, { refetchIdentical, boxScores });
      evidenceNotes.push({
        gameId: spec.gameId,
        refetchIdentical,
        boxScores,
        origSum,
        freshSum,
      });
    }
    for (const g of report.games) {
      if (!evidenceByGame.has(g.game_id)) {
        evidenceByGame.set(g.game_id, { refetchIdentical: false, boxScores: 'not_applicable' });
      }
    }

    const policy = evaluateSeason({
      season: '2023',
      games: report.games,
      logsByGame,
      rawStatsByGame,
      evidenceByGame,
    });

    const teamStatKeys = new Set<string>();
    for (const log of report.logs) teamStatKeys.add(`${log.team_id}|${log.game_id}`);
    const playerAvgIds = [...new Set(report.logs.map((l) => l.player_id))];
    const teamAvgIds = [...new Set(report.logs.map((l) => l.team_id))];
    const stintPlan = planCompletedSeasonStintsFromLogs({
      season: '2023',
      appearances: report.logs.map((l) => ({
        playerId: l.player_id,
        teamId: l.team_id,
        gameDate: l.game_date,
        gameId: l.game_id,
      })),
    });

    const logScale = report.logs.length / EXPECTED.logs2024;
    const calibratedBaseMb = EXPECTED.delta2024Mb * logScale;
    const storage = {
      method: 'Scale actual 2024 materialization delta (+10.95 MB) by 2023/2024 player-log counts. Quality flag rows are negligible.',
      actual2024DeltaMb: EXPECTED.delta2024Mb,
      logScale: mb(logScale),
      lowMb: mb(calibratedBaseMb * 0.95),
      baseMb: mb(calibratedBaseMb),
      highMb: mb(calibratedBaseMb * 1.15),
      currentDbMb: mb(dbBytes / (1024 * 1024)),
      checkpointAfter2024Mb: EXPECTED.dbAfter2024Mb,
      projectedDbAfter2023Mb: mb(EXPECTED.dbAfter2024Mb + calibratedBaseMb),
      headroomTo340Mb: mb(340 - (EXPECTED.dbAfter2024Mb + calibratedBaseMb)),
    };

    const qualityRows = policy.results
      .filter((r) => r.qualityFlag)
      .map((r) => projectedValidationRow({ result: r, season: '2023', detectedAt: generatedAt }));

    const rejects = policy.results.filter((r) => r.decision === 'REJECT');
    let verdict:
      | 'GREEN — quality policy is fail-closed and 2023 is ready for controlled materialization'
      | 'YELLOW — quality representation needs review'
      | 'RED — do not materialize 2023';
    if (!gate.ok || report.games.length !== EXPECTED.gamesRecords || report.logs.length !== EXPECTED.statsRecords) {
      verdict = 'RED — do not materialize 2023';
    } else if (!policy.canMaterialize || policy.allowAnomaly !== 10 || policy.allowStrict !== 1309) {
      verdict = 'RED — do not materialize 2023';
    } else {
      verdict = 'GREEN — quality policy is fail-closed and 2023 is ready for controlled materialization';
    }

    const payload = {
      generatedAt,
      step: '4E',
      dryRun: true,
      bdlHttpRequests: 0,
      postgresWrites: false,
      safety,
      existingQualityInfrastructureAudit: {
        table: QUALITY_TABLE,
        present: true,
        existingRows: serving.gvr_rows,
        sampleGameIds: gvrSampleIds,
        idNamespace: 'existing rows use bbref_* game ids; BDL numeric ids do not collide',
        columns: ['game_id', 'check_name', 'status', 'severity', 'details jsonb', 'validated_at'],
        uniqueKey: '(game_id, check_name)',
        canRepresent: {
          game_id: 'column',
          season: 'details.season',
          source: 'details.source',
          issueCode: 'check_name',
          severity: 'column (error = high)',
          officialScore: 'details.official',
          providerSum: 'details.providerSum',
          delta: 'details.delta',
          detectedAt: 'validated_at',
          notes: 'details.notes / reviewStatus',
        },
        reuse: true,
        reason: 'This is the existing per-game validation ledger. Not an unrelated table. No migration required.',
      },
      chosenQualityRepresentation: {
        table: QUALITY_TABLE,
        checkName: BDL_PLAYER_POINTS_SCORE_MISMATCH,
        status: 'fail',
        severity: 'error',
        writeOnMaterialize: true,
        writeNow: false,
      },
      anomalyCode: {
        code: BDL_PLAYER_POINTS_SCORE_MISMATCH,
        semantics: ANOMALY_SEMANTICS,
      },
      authoritativeScorePolicy: {
        gameScore: 'analytics.games home_score/away_score from BDL /v1/games archive. Authoritative final score.',
        playerStats: 'Store BDL player rows exactly as provided. Do not alter pts. Do not distribute missing team points.',
        teamStats: {
          team_points: 'SUM(analytics.player_game_logs.points) — provider as-reported. For the 10 games this is 2–5 pts below official.',
          points_allowed: 'Opponent analytics.games score (authoritative).',
          result: 'W/L from analytics.games home_score vs away_score (authoritative).',
          team_season_averages: 'avg_points uses team_points (provider sums). wins/losses/avg_points_allowed use official-score fields.',
          doNot: 'Do not overwrite team_points with official scores (fabrication). Do not change W/L to player-sum outcomes.',
        },
      },
      seasonAveragePolicy: {
        playerSeasonAverages: 'Include provider player stats as reported. Do not drop the 10 games.',
        reason: 'Dropping them would create a larger completeness error than the 2–5 point undercount.',
      },
      futureResearchFilterPolicy: {
        excludeFromScoreSensitiveWork: 'unresolved severity-high provider score mismatch',
        sql: RESEARCH_EXCLUDE_UNRESOLVED_HIGH_SQL.trim(),
        historicalExplorer: 'Do not auto-exclude. Later UI may disclose that provider player stats do not fully reconcile.',
        noUiNow: true,
      },
      allowlist: PERSISTENT_2023_ANOMALIES,
      evidenceNotes,
      dryRunCounts: {
        archiveGames: games.length,
        archiveStats: statsRows.length,
        mappedGames: report.games.length,
        mappedLogs: report.logs.length,
        projectedTeamStats: teamStatKeys.size,
        projectedPlayerAverages: playerAvgIds.length,
        projectedTeamAverages: teamAvgIds.length,
        projectedInferredStints: stintPlan.inferredStints.length,
        qualityFlags: policy.qualityFlags,
        allowStrict: policy.allowStrict,
        allowAnomaly: policy.allowAnomaly,
        reject: policy.reject,
        expected: {
          games: 1319,
          logs: 46090,
          teamStats: 2638,
          qualityFlags: 10,
          allowStrict: 1309,
          allowAnomaly: 10,
        },
      },
      mappingIssues: report.stats,
      rejects: rejects.map((r) => ({ gameId: r.gameId, reason: r.reason, inspection: r.inspection })),
      projectedQualityRows: qualityRows,
      validatorSafetyTests: {
        file: 'lib/ingestion/historical-serving/__tests__/provider-quality-policy.test.ts',
        cases: [
          'known 10 allowed only under explicit persistent-provider-anomaly policy',
          'unknown mismatch fails closed',
          'known id with new structural defect fails closed',
          'known id whose mismatch changes unexpectedly fails closed',
          'known id that suddenly reconciles requires review',
          'clean games use normal validation path',
          'allowlist is 2023-only; no generic ignoreScoreMismatch',
        ],
      },
      projectedStorage: storage,
      trialApiCost: {
        bdlHttpRequests: 0,
        investigationClosedForTrial: true,
        note: 'Do not spend more GOAT requests on these 10. /v1/stats refetch and Box Scores already reproduced the anomaly.',
      },
      remainingMaterializationBlockers: [
        'Do not materialize from this step.',
        'Next execute must call evaluateSeason before writes and upsert the 10 game_validation_results rows.',
        'Do not introduce ignoreScoreMismatch=true.',
      ],
      archiveGate: gate,
      seasonWindow: { min: window.servingMinDate, max: window.servingMaxDate },
      verdict,
    };

    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
    writeFileSync(
      OUT_MD,
      [
        '# 2023 provider-quality policy (Step 4E)',
        '',
        `Generated: ${generatedAt}`,
        '',
        `**${verdict}**`,
        '',
        `- BDL HTTP: 0`,
        `- mapped games ${report.games.length} / logs ${report.logs.length}`,
        `- allow strict ${policy.allowStrict}; anomaly ${policy.allowAnomaly}; reject ${policy.reject}`,
        `- quality flags ${policy.qualityFlags}`,
        `- storage base ${storage.baseMb} MB; projected DB ${storage.projectedDbAfter2023Mb} MB; headroom to 340 ${storage.headroomTo340Mb} MB`,
        '',
        'Do not materialize 2023 from this step. Do not call BALLDONTLIE.',
        '',
      ].join('\n')
    );
    console.log(
      JSON.stringify(
        {
          verdict,
          games: report.games.length,
          logs: report.logs.length,
          allowStrict: policy.allowStrict,
          allowAnomaly: policy.allowAnomaly,
          reject: policy.reject,
          qualityFlags: policy.qualityFlags,
          storage,
        },
        null,
        2
      )
    );
    if (verdict.startsWith('RED')) process.exitCode = 2;
    else if (verdict.startsWith('YELLOW')) process.exitCode = 1;
  } catch (err) {
    try {
      await pg.query('rollback');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    pg.release();
  }
}

main()
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
