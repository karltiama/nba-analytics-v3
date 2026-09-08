/**
 * Step 4C: targeted GOAT `/v1/stats?game_ids[]=` refetch for the 10 2023 mismatch games.
 * Archives game-scoped repair objects. Does not overwrite season page=N.json.
 * Does not materialize Postgres. Does not start 2022 or Advanced Stats.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/refetch-2023-mismatch-stats.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/refetch-2023-mismatch-stats.ts --execute
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { acquireBdlAcquisitionLock, bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { BdlArchiveClient, readBdlApiKey, type BdlEnvelope } from '@/lib/balldontlie/archive-client';
import { archiveJsonObjectToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag, rawEntityPrefix } from '@/lib/archive/trial-archive-plan';
import {
  assertTrialExecuteAllowed,
  BDL_TRIAL_MIN_DELAY_MS,
  resolveBdlRequestDelayMs,
} from '@/lib/balldontlie/trial-limiter';
import { buildServingBackfillPlan } from '@/lib/ingestion/historical-serving/plan';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const SEASON = 2023;
const ALLOWLIST = [
  '1038319',
  '1038322',
  '1038342',
  '1038362',
  '1038379',
  '1038433',
  '1038439',
  '1038453',
  '1038491',
  '1038504',
] as const;
const ORIGINAL_STATS_PAGES = [267, 268, 274, 275, 281, 282, 287, 307, 308, 309, 314, 327, 331];
const ORIGINAL_GAMES_PAGES = [8, 9, 10];
const OUT_JSON = 'reports/trial/2023-targeted-refetch-report.json';
const OUT_MD = 'reports/trial/2023-targeted-refetch-report.md';
const REPAIR_MANIFEST = '_repair_10mismatch_manifest.json';
const BOX_ID = '18447793';

type ResultClass =
  | 'REFETCH_FIXED'
  | 'REFETCH_CHANGED_BUT_STILL_MISMATCH'
  | 'REFETCH_IDENTICAL_PROVIDER_ANOMALY'
  | 'REFETCH_WORSE_OR_INVALID'
  | 'REFETCH_FAILED';

type StatRow = {
  id?: unknown;
  pts?: number | null;
  player?: { id?: unknown } | null;
  team?: { id?: unknown } | null;
  game?: {
    id?: unknown;
    home_team_score?: unknown;
    visitor_team_score?: unknown;
  } | null;
};

function sid(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function setEq(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

async function snapshotPostgres() {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const r = await client.query(
      `select
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
         (select home_score from analytics.games where game_id = $1) as box_home,
         (select away_score from analytics.games where game_id = $1) as box_away`,
      [BOX_ID]
    );
    await client.query('commit');
    const row = r.rows[0]!;
    return {
      games_2023: Number(row.games_2023),
      logs_2023: Number(row.logs_2023),
      tgs_2023: Number(row.tgs_2023),
      psa_2023: Number(row.psa_2023),
      tsa_2023: Number(row.tsa_2023),
      stints_2023: Number(row.stints_2023),
      raw_pgs: Number(row.raw_pgs),
      raw_pgs_2023: Number(row.raw_pgs_2023),
      box184: { home: Number(row.box_home), away: Number(row.box_away) },
    };
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

function summarizeBox(args: {
  rows: StatRow[];
  homeId: string;
  awayId: string;
  officialHome: number | null;
  officialAway: number | null;
  expectedGameId: string;
}) {
  const playerIds = new Set<string>();
  const statIds = new Set<string>();
  const pair = new Map<string, number>();
  const statDup = new Map<string, number>();
  let homePts = 0;
  let awayPts = 0;
  let homeN = 0;
  let awayN = 0;
  let foreign = 0;
  let missingPlayer = 0;
  let missingTeam = 0;
  let missingGame = 0;
  let wrongGame = 0;
  for (const row of args.rows) {
    const pid = sid(row.player?.id);
    const tid = sid(row.team?.id);
    const gid = sid(row.game?.id);
    const sidv = sid(row.id);
    if (!pid) missingPlayer += 1;
    else {
      playerIds.add(pid);
      const k = `${args.expectedGameId}|${pid}`;
      pair.set(k, (pair.get(k) ?? 0) + 1);
    }
    if (!tid) missingTeam += 1;
    if (!gid) missingGame += 1;
    if (gid && gid !== args.expectedGameId) wrongGame += 1;
    if (sidv) {
      statDup.set(sidv, (statDup.get(sidv) ?? 0) + 1);
      statIds.add(sidv);
    }
    const pts = typeof row.pts === 'number' ? row.pts : 0;
    if (tid === args.homeId) {
      homePts += pts;
      homeN += 1;
    } else if (tid === args.awayId) {
      awayPts += pts;
      awayN += 1;
    } else if (tid) foreign += 1;
  }
  const dupLogical = [...pair.values()].filter((n) => n > 1).length;
  const dupStat = [...statDup.values()].filter((n) => n > 1).length;
  const scoreOk =
    args.officialHome != null &&
    args.officialAway != null &&
    homePts === args.officialHome &&
    awayPts === args.officialAway;
  const structuralOk =
    homeN > 0 &&
    awayN > 0 &&
    dupLogical === 0 &&
    dupStat === 0 &&
    missingPlayer === 0 &&
    missingTeam === 0 &&
    missingGame === 0 &&
    foreign === 0 &&
    wrongGame === 0;
  return {
    rowCount: args.rows.length,
    playerIds: [...playerIds].sort(),
    statIds: [...statIds].sort(),
    playerIdCount: playerIds.size,
    statIdCount: statIds.size,
    homeRows: homeN,
    awayRows: awayN,
    homePts,
    awayPts,
    officialHome: args.officialHome,
    officialAway: args.officialAway,
    deltaHome: args.officialHome == null ? null : homePts - args.officialHome,
    deltaAway: args.officialAway == null ? null : awayPts - args.officialAway,
    scoreOk,
    bothTeams: homeN > 0 && awayN > 0,
    dupLogical,
    dupStat,
    missingPlayer,
    missingTeam,
    missingGame,
    foreign,
    wrongGame,
    structuralOk,
  };
}

async function loadEnvelope(s3: S3Storage, key: string): Promise<BdlEnvelope | null> {
  return s3.getJson<BdlEnvelope>(key);
}

async function main() {
  const { execute, dryRun } = parseExecuteFlag(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const delay = resolveBdlRequestDelayMs();
  const lockIdle = bdlAcquisitionLockStatus();
  const queue = [...ALLOWLIST];
  const unsafe: string[] = [];
  if (!delay.trialMode) unsafe.push('BDL_TRIAL_MODE is not 1');
  if (delay.delayMs !== 13_000) unsafe.push(`spacing ${delay.delayMs}ms`);
  if (delay.delayMs < BDL_TRIAL_MIN_DELAY_MS) unsafe.push('spacing below 12000');
  if (delay.concurrency !== 1) unsafe.push(`concurrency=${delay.concurrency}`);
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode || '(empty)'}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== '2025') unsafe.push(`season pin=${pin}`);
  if (lockIdle.active) unsafe.push(`BDL lock already active pid=${lockIdle.pid}`);
  if (queue.length !== 10 || new Set(queue).size !== 10) unsafe.push('queue is not exactly 10 unique IDs');

  const pgBefore = await snapshotPostgres();
  if (
    pgBefore.games_2023 !== 0 ||
    pgBefore.logs_2023 !== 0 ||
    pgBefore.tgs_2023 !== 0 ||
    pgBefore.psa_2023 !== 0 ||
    pgBefore.tsa_2023 !== 0 ||
    pgBefore.stints_2023 !== 0 ||
    pgBefore.raw_pgs_2023 !== 0
  ) {
    unsafe.push('2023 serving/raw not empty');
  }

  const safety = {
    bdlTrialMode: delay.trialMode,
    delayMs: delay.delayMs,
    concurrency: delay.concurrency,
    lockIdleBefore: !lockIdle.active,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen: true,
    currentAnalyticsSeason: pin,
    postgresMaterialize: false,
    servingBefore: pgBefore,
  };

  if (unsafe.length) {
    const stopped = {
      generatedAt,
      step: '4C',
      stopped: true,
      reason: 'safety preflight failed',
      unsafe,
      safety,
      queue,
      verdict: 'RED — targeted repair failed',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(stopped, null, 2) + '\n');
    console.log(JSON.stringify(stopped, null, 2));
    process.exit(2);
  }

  const plan = buildServingBackfillPlan({
    season: SEASON,
    rawPrefix: process.env.NBA_RAW_PREFIX,
    blockedReason: null,
  });
  const prefix = rawEntityPrefix(process.env.NBA_RAW_PREFIX ?? 'raw', SEASON, 'player_stats');
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('Missing NBA_DATA_BUCKET');
  const s3 = new S3Storage({ bucket });

  type GameMeta = { homeId: string; awayId: string; homeScore: number | null; awayScore: number | null; homeAbbr: string; awayAbbr: string };
  const games = new Map<string, GameMeta>();
  for (const n of ORIGINAL_GAMES_PAGES) {
    const env = await loadEnvelope(s3, `${plan.s3GamesPrefix}/page=${n}.json`);
    for (const raw of env?.data ?? []) {
      const g = raw as Record<string, unknown>;
      const id = sid(g.id);
      if (!ALLOWLIST.includes(id as (typeof ALLOWLIST)[number])) continue;
      const home = (g.home_team ?? null) as Record<string, unknown> | null;
      const vis = (g.visitor_team ?? null) as Record<string, unknown> | null;
      games.set(id, {
        homeId: sid(home?.id),
        awayId: sid(vis?.id),
        homeScore: toNum(g.home_team_score),
        awayScore: toNum(g.visitor_team_score),
        homeAbbr: sid(home?.abbreviation),
        awayAbbr: sid(vis?.abbreviation),
      });
    }
  }
  const missingGames = queue.filter((id) => !games.has(id));
  if (missingGames.length) {
    throw new Error(`allowlist games missing from archived games pages: ${missingGames.join(',')}`);
  }

  const originalRows = new Map<string, StatRow[]>();
  for (const id of queue) originalRows.set(id, []);
  for (const n of ORIGINAL_STATS_PAGES) {
    const env = await loadEnvelope(s3, `${plan.s3StatsPrefix}/page=${n}.json`);
    for (const raw of env?.data ?? []) {
      const s = raw as StatRow;
      const gid = sid(s.game?.id);
      if (!originalRows.has(gid)) continue;
      originalRows.get(gid)!.push(s);
    }
  }

  const keys = queue.map((id) => `${prefix}/game_id=${id}.json`);
  console.log('=== Step 4C targeted 2023 mismatch refetch ===');
  console.log(`  queue (${queue.length}): ${queue.join(', ')}`);
  console.log(`  repair keys: game_id=<id>.json under ${prefix}`);
  console.log(`  will not overwrite: ${plan.s3StatsPrefix}/page=N.json or _manifest.json`);

  if (dryRun || !execute) {
    const payload = {
      generatedAt,
      step: '4C',
      dryRun: true,
      safety,
      queue,
      plannedRequests: 10,
      repairKeys: keys,
      repairManifest: `${prefix}/${REPAIR_MANIFEST}`,
      seasonWideManifestUntouched: `${prefix}/_manifest.json`,
      note: 'Safety GREEN. Rerun with BDL_TRIAL_MODE=1 --execute. No Postgres writes.',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  console.log(`  lock: acquired ${lock.path}`);
  const client = new BdlArchiveClient({ apiKey: readBdlApiKey() });
  const wallStart = Date.now();
  const perGame: Array<Record<string, unknown>> = [];
  let wrote = 0;
  let skipped = 0;

  try {
    for (const gameId of queue) {
      if (!ALLOWLIST.includes(gameId as (typeof ALLOWLIST)[number])) {
        throw new Error(`request escaped allowlist: ${gameId}`);
      }
      const meta = games.get(gameId)!;
      const orig = summarizeBox({
        rows: originalRows.get(gameId) ?? [],
        homeId: meta.homeId,
        awayId: meta.awayId,
        officialHome: meta.homeScore,
        officialAway: meta.awayScore,
        expectedGameId: gameId,
      });
      const key = `${prefix}/game_id=${gameId}.json`;
      if (key.includes('/page=') || key.endsWith('/_manifest.json')) {
        throw new Error(`refusing to write collision key ${key}`);
      }

      let pages: BdlEnvelope[] = [];
      let failed: string | null = null;
      let skippedExisting = false;
      if (await s3.objectExists(key)) {
        skippedExisting = true;
        skipped += 1;
        const existing = await s3.getJson<{ pages?: BdlEnvelope[] }>(key);
        pages = existing?.pages ?? [];
      } else {
        try {
          for await (const page of client.paginate({
            path: '/stats',
            params: { 'game_ids[]': gameId },
            paginationStyle: 'cursor',
            perPage: 100,
          })) {
            pages.push(page.body);
          }
        } catch (e) {
          failed = e instanceof Error ? e.message : String(e);
        }
        if (!failed && pages.length) {
          await archiveJsonObjectToS3({
            s3,
            key,
            body: {
              schemaVersion: 1,
              source: 'balldontlie',
              endpoint: '/v1/stats',
              season: SEASON,
              game_id: gameId,
              kind: 'targeted_mismatch_repair',
              pages,
              fetchedAt: new Date().toISOString(),
            },
          });
          wrote += 1;
        }
      }

      const freshRows = pages.flatMap((p) => (Array.isArray(p.data) ? (p.data as StatRow[]) : []));
      const fresh = summarizeBox({
        rows: freshRows,
        homeId: meta.homeId,
        awayId: meta.awayId,
        officialHome: meta.homeScore,
        officialAway: meta.awayScore,
        expectedGameId: gameId,
      });

      const origPlayers = new Set(orig.playerIds);
      const freshPlayers = new Set(fresh.playerIds);
      const origStats = new Set(orig.statIds);
      const freshStats = new Set(fresh.statIds);
      const identical =
        orig.rowCount === fresh.rowCount &&
        orig.homePts === fresh.homePts &&
        orig.awayPts === fresh.awayPts &&
        setEq(origPlayers, freshPlayers) &&
        setEq(origStats, freshStats);
      const addedPlayers = [...freshPlayers].filter((id) => !origPlayers.has(id));
      const removedPlayers = [...origPlayers].filter((id) => !freshPlayers.has(id));
      const addedStats = [...freshStats].filter((id) => !origStats.has(id));
      const removedStats = [...origStats].filter((id) => !freshStats.has(id));

      let result: ResultClass;
      if (failed || pages.length === 0) result = 'REFETCH_FAILED';
      else if (!fresh.structuralOk) result = 'REFETCH_WORSE_OR_INVALID';
      else if (fresh.scoreOk && fresh.structuralOk) result = 'REFETCH_FIXED';
      else if (identical) result = 'REFETCH_IDENTICAL_PROVIDER_ANOMALY';
      else result = 'REFETCH_CHANGED_BUT_STILL_MISMATCH';

      const ready = result === 'REFETCH_FIXED';
      perGame.push({
        gameId,
        matchup: `${meta.homeAbbr} vs ${meta.awayAbbr}`,
        official: { home: meta.homeScore, away: meta.awayScore },
        original: orig,
        fresh,
        identicalResponse: identical,
        changedRows: orig.rowCount !== fresh.rowCount,
        additionalPlayerRows: addedPlayers,
        removedPlayerRows: removedPlayers,
        changedPlayerPoints: orig.homePts !== fresh.homePts || orig.awayPts !== fresh.awayPts,
        changedStatIds: addedStats.length + removedStats.length > 0,
        addedStatIds: addedStats.length,
        removedStatIds: removedStats.length,
        correctedReconciliation: fresh.scoreOk,
        skippedExisting,
        s3Key: key,
        result,
        preferredSource: ready ? 'GAME_SCOPED_REPAIR_OBJECT' : 'ORIGINAL_SEASON_PAGE_UNRESOLVED',
        materialize: ready ? 'READY_TO_MATERIALIZE' : 'UNRESOLVED_PROVIDER_ANOMALY',
        error: failed,
      });
    }

    await archiveJsonObjectToS3({
      s3,
      key: `${prefix}/${REPAIR_MANIFEST}`,
      overwrite: true,
      body: {
        schemaVersion: 1,
        entity: 'player_stats',
        season: SEASON,
        kind: 'targeted_2023_mismatch_repair_10',
        gameIds: queue,
        written: wrote,
        skipped,
        status: perGame.some((g) => g.result === 'REFETCH_FAILED') ? 'partial' : 'success',
        overwritesSeasonPages: false,
        overwritesSeasonManifest: false,
        postgresMaterialize: false,
        fetchedAt: new Date().toISOString(),
      },
    });
  } finally {
    lock.release();
    console.log('  lock: released');
  }

  const wallMs = Date.now() - wallStart;
  const metrics = client.getMetrics();
  const pgAfter = await snapshotPostgres();
  const postgresUnchanged =
    pgAfter.games_2023 === 0 &&
    pgAfter.logs_2023 === 0 &&
    pgAfter.tgs_2023 === 0 &&
    pgAfter.psa_2023 === 0 &&
    pgAfter.tsa_2023 === 0 &&
    pgAfter.stints_2023 === 0 &&
    pgAfter.raw_pgs_2023 === 0 &&
    pgAfter.raw_pgs === pgBefore.raw_pgs;

  const fixed = perGame.filter((g) => g.result === 'REFETCH_FIXED');
  const unresolved = perGame.filter((g) => g.result !== 'REFETCH_FIXED');
  const x = fixed.length;
  const y = unresolved.length;
  const safe = 1309 + x;

  let verdict:
    | 'GREEN — all 10 fixed; 2023 ready for materialization preflight'
    | 'YELLOW — some provider mismatches remain; review before materialization'
    | 'RED — targeted repair failed';
  if (perGame.some((g) => g.result === 'REFETCH_FAILED' || g.result === 'REFETCH_WORSE_OR_INVALID')) {
    verdict = 'RED — targeted repair failed';
  } else if (y === 0 && x === 10) {
    verdict = 'GREEN — all 10 fixed; 2023 ready for materialization preflight';
  } else {
    verdict = 'YELLOW — some provider mismatches remain; review before materialization';
  }

  const recommendedNext =
    verdict.startsWith('GREEN')
      ? 'Do not materialize in this step. Next: 2023 materialization preflight using season pages plus GAME_SCOPED_REPAIR_OBJECT for the 10 IDs.'
      : verdict.startsWith('YELLOW')
        ? 'Do not materialize 2023 yet. Do not make more API requests in 4C. Decide separately: hold unresolved games out, try another BDL endpoint, or document provider anomalies.'
        : 'STOP. Do not materialize 2023. Do not start another dataset.';

  const report = {
    generatedAt,
    step: '4C',
    dryRun: false,
    bdlHttpRequests: metrics.httpAttempts,
    safety: { ...safety, lockAcquiredDuringExecute: true, servingAfter: pgAfter },
    queueConfirmation: { expected: [...ALLOWLIST], actual: queue, plannedRequests: 10, ok: true },
    requestResult: {
      planned: 10,
      actual: metrics.httpAttempts,
      httpSuccess: metrics.httpSuccess,
      wrote,
      skipped,
    },
    oldVsFresh: perGame,
    fixedGames: fixed.map((g) => g.gameId),
    stillUnresolvedGames: unresolved.map((g) => ({
      gameId: g.gameId,
      result: g.result,
      originalDelta: { home: (g.original as { deltaHome?: number }).deltaHome, away: (g.original as { deltaAway?: number }).deltaAway },
      freshDelta: { home: (g.fresh as { deltaHome?: number }).deltaHome, away: (g.fresh as { deltaAway?: number }).deltaAway },
      identical: g.identicalResponse,
      structuralOk: (g.fresh as { structuralOk?: boolean }).structuralOk,
    })),
    preferredSourcePerGame: perGame.map((g) => ({
      gameId: g.gameId,
      result: g.result,
      preferredSource: g.preferredSource,
      materialize: g.materialize,
    })),
    safeMaterializationCount: {
      cleanFromOriginalArchive: 1309,
      fixedByTargetedRefetch: x,
      stillUnresolved: y,
      totalSafeToMaterialize: safe,
      desired: '1319 / 1319',
      actual: `${safe} / 1319`,
    },
    s3RepairArchive: {
      prefix,
      objects: keys,
      repairManifest: `${prefix}/${REPAIR_MANIFEST}`,
      seasonPagesUntouched: true,
      seasonManifestUntouched: `${prefix}/_manifest.json`,
    },
    rateLimit: {
      plannedRequests: 10,
      actualRequests: metrics.httpAttempts,
      http200s: metrics.httpSuccess,
      status429: metrics.status429,
      retries: metrics.retries,
      retryAfterUsed: metrics.retryAfterUsed,
      wallClockMs: wallMs,
      wallClockMinutes: Math.round((wallMs / 60000) * 10) / 10,
      avgSpacingMs: avg(metrics.spacingSamplesMs),
      minSpacingMs: metrics.spacingSamplesMs.length ? Math.min(...metrics.spacingSamplesMs) : null,
      delayMs: delay.delayMs,
      concurrency: delay.concurrency,
    },
    postgresUnchanged: { ok: postgresUnchanged, before: pgBefore, after: pgAfter },
    recommendedNextStep: recommendedNext,
    verdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(
    OUT_MD,
    [
      '# 2023 targeted mismatch refetch (Step 4C)',
      '',
      `Generated: ${generatedAt}`,
      '',
      `**${verdict}**`,
      '',
      `- queue: ${queue.join(', ')}`,
      `- HTTP: ${metrics.httpAttempts} attempts / ${metrics.httpSuccess} success / 429s ${metrics.status429}`,
      `- fixed: ${x}; unresolved: ${y}; safe to materialize: ${safe} / 1319`,
      `- Postgres 2023 still empty: ${postgresUnchanged}`,
      '',
      recommendedNext,
      '',
    ].join('\n')
  );
  console.log(
    JSON.stringify(
      {
        verdict,
        fixed: x,
        unresolved: y,
        safe: `${safe} / 1319`,
        rateLimit: report.rateLimit,
        results: perGame.map((g) => ({ gameId: g.gameId, result: g.result, identical: g.identicalResponse })),
      },
      null,
      2
    )
  );
  if (verdict.startsWith('RED')) process.exitCode = 2;
  else if (verdict.startsWith('YELLOW')) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
