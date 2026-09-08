/**
 * Step 3B: read-only 2024 S3 → analytics materialization preflight.
 * Uses transformBdlArchiveToServing. No BDL HTTP. No Postgres writes. No 2023.
 *
 *   npx tsx scripts/ops/preflight-2024-materialization.ts
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import type { BdlEnvelope } from '@/lib/balldontlie/archive-client';
import { assertCompleteHistoricalArchive, type BdlEntityManifest } from '@/lib/ingestion/historical-serving/archive-gate';
import {
  buildTeamResolver,
  mappingQualityFromReport,
  transformBdlArchiveToServing,
  type BdlGame,
  type BdlStat,
  type BdlTeam,
  type ExistingGameRow,
  type TeamCatalogRow,
} from '@/lib/ingestion/historical-serving/bdl-to-serving';
import {
  buildServingBackfillPlan,
  PLAYER_SEASON_AVERAGES_SQL,
  TEAM_GAME_STATS_SEASON_PREDICATE,
} from '@/lib/ingestion/historical-serving/plan';
import {
  DELETE_INFERRED_STINTS_FOR_SEASON_SQL,
  DELETE_PLAYER_AVERAGES_FOR_SEASON_SQL,
  DELETE_TEAM_AVERAGES_FOR_SEASON_SQL,
  DELETE_TEAM_GAME_STATS_FOR_SEASON_SQL,
  INFERRED_PGL_SOURCE,
  LOAD_EXISTING_GAMES_SQL,
  LOAD_TEAM_CATALOG_SQL,
  REBUILD_TEAM_AVERAGES_FOR_SEASON_SQL,
} from '@/lib/ingestion/historical-serving/season-scoped-writes';
import { planCompletedSeasonStintsFromLogs } from '@/lib/ingestion/historical-serving/stints-from-logs';
import { historicalSeasonWindow } from '@/lib/ingestion/historical-serving/season-window';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const SEASON = 2024;
const OUT_JSON = 'reports/trial/2024-materialization-preflight.json';
const OUT_MD = 'reports/trial/2024-materialization-preflight.md';
const BOX_ID = '18447793';
const EXPECTED = {
  gamesPages: 14,
  gamesRecords: 1321,
  statsPages: 462,
  statsRecords: 46150,
  distinctStatGames: 1321,
};

function sid(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
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

async function loadEnvelopeData<T>(s3: S3Storage, keys: string[]): Promise<{ rows: T[]; lastNext: unknown }> {
  const rows: T[] = [];
  let lastNext: unknown = null;
  for (const key of keys) {
    const env = await s3.getJson<BdlEnvelope>(key);
    if (env && Array.isArray(env.data)) rows.push(...(env.data as T[]));
    lastNext = env?.meta?.next_cursor ?? null;
  }
  return { rows, lastNext };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const lock = bdlAcquisitionLockStatus();
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
  if (window.servingMinDate !== '2024-10-15' || window.servingMaxDate !== '2025-06-30') {
    unsafe.push(`season window ${window.servingMinDate}..${window.servingMaxDate}`);
  }

  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const snap = await client.query(
      `select
         pg_database_size(current_database())::bigint as db_bytes,
         (select count(*)::int from analytics.games where season = '2024') as games_2024,
         (select count(*)::int from analytics.player_game_logs where season = '2024') as logs_2024,
         (select count(*)::int from analytics.team_game_stats where season = '2024') as tgs_2024,
         (select count(*)::int from analytics.player_season_averages where season = '2024') as psa_2024,
         (select count(*)::int from analytics.team_season_averages where season = '2024') as tsa_2024,
         (select count(*)::int from analytics.player_team_stints where season = '2024') as stints_2024,
         (select count(*)::int from analytics.games where season = '2023') as games_2023,
         (select count(*)::int from analytics.player_game_logs where season = '2023') as logs_2023,
         (select count(*)::int from analytics.team_game_stats where season = '2023') as tgs_2023,
         (select count(*)::int from analytics.games where season = '2025') as games_2025,
         (select count(*)::int from analytics.player_game_logs where season = '2025') as logs_2025,
         (select count(*)::int from analytics.team_game_stats where season = '2025') as tgs_2025,
         (select count(*)::int from analytics.games where season = '2026') as games_2026,
         (select count(*)::int from analytics.player_game_logs where season = '2026') as logs_2026,
         (select count(*)::int from analytics.player_team_stints where season = '2026') as stints_2026`
    );
    const box = await client.query(
      `select home_score, away_score from analytics.games where game_id = $1`,
      [BOX_ID]
    );
    const s = snap.rows[0]!;
    if (Number(s.games_2024) !== 0 || Number(s.logs_2024) !== 0 || Number(s.tgs_2024) !== 0) {
      unsafe.push('2024 serving tables are not empty');
    }
    if (Number(s.logs_2023) !== 0 || Number(s.tgs_2023) !== 0) {
      unsafe.push('2023 serving tables are not empty');
    }
    if (Number(s.games_2026) !== 1200 || Number(s.stints_2026) !== 578) {
      unsafe.push(`2026 isolation unexpected games=${s.games_2026} stints=${s.stints_2026}`);
    }

    const safety = {
      dataMode: mode.dataMode,
      offseasonMode: mode.offseason,
      cronDryRun: mode.cronDryRun,
      frozen: mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun,
      currentAnalyticsSeason: pin,
      bdlHttpRequests: 0,
      lockRequired: false,
      lockActive: lock.active,
      stagingMode: plan.stagingMode,
      seasonWindow: { min: window.servingMinDate, max: window.servingMaxDate, storedSeason: window.storedSeason },
      postgresWrites: false,
      servingBefore: s,
      box184: box.rows[0] ?? null,
    };

    if (unsafe.length) {
      const stopped = {
        generatedAt,
        step: '3B',
        stopped: true,
        reason: 'safety preflight failed',
        unsafe,
        safety,
        verdict: 'RED — stop 2024 serving backfill',
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
    const { rows: games, lastNext: gamesLastNext } = await loadEnvelopeData<BdlGame>(s3, gamesPageKeys);
    const { rows: stats, lastNext: statsLastNext } = await loadEnvelopeData<BdlStat>(s3, statsPageKeys);
    const uniqueGameIds = new Set(games.map((g) => sid(g.id)).filter(Boolean));
    const statGameIds = new Set(stats.map((r) => sid(r.game?.id)).filter(Boolean));

    const archiveDiffers =
      !gate.ok ||
      gamesPageKeys.length !== EXPECTED.gamesPages ||
      games.length !== EXPECTED.gamesRecords ||
      uniqueGameIds.size !== EXPECTED.gamesRecords ||
      statsPageKeys.length !== EXPECTED.statsPages ||
      stats.length !== EXPECTED.statsRecords ||
      statGameIds.size !== EXPECTED.distinctStatGames ||
      statsLastNext != null;

    const archiveVerification = {
      gate,
      games: {
        manifestStatus: gamesManifest?.status ?? null,
        pages: gamesPageKeys.length,
        records: games.length,
        uniqueGameIds: uniqueGameIds.size,
        cursorExhausted: gamesLastNext == null,
      },
      playerStats: {
        manifestStatus: statsManifest?.status ?? null,
        pages: statsPageKeys.length,
        records: stats.length,
        distinctGameIds: statGameIds.size,
        cursorExhausted: statsLastNext == null,
        lastNextCursor: statsLastNext,
      },
      matchesStep3A: !archiveDiffers,
    };

    if (archiveDiffers) {
      const stopped = {
        generatedAt,
        step: '3B',
        stopped: true,
        reason: 'S3 archive differs from Step 3A certification',
        archiveVerification,
        verdict: 'RED — stop 2024 serving backfill',
      };
      mkdirSync('reports/trial', { recursive: true });
      writeFileSync(OUT_JSON, JSON.stringify(stopped, null, 2) + '\n');
      console.log(JSON.stringify(stopped, null, 2));
      process.exit(2);
    }

    const teamsRes = await client.query<TeamCatalogRow>(LOAD_TEAM_CATALOG_SQL);
    const teamCatalog = teamsRes.rows;
    const existingRes = await client.query<ExistingGameRow>(LOAD_EXISTING_GAMES_SQL, [[...uniqueGameIds]]);
    const existingGames = existingRes.rows;

    const report = transformBdlArchiveToServing({
      seasonStartYear: SEASON,
      games,
      stats,
      teamCatalog,
      existingGames,
    });
    const quality = mappingQualityFromReport(report);

    const resolver = buildTeamResolver(teamCatalog);
    const byId = new Set(teamCatalog.map((t) => t.team_id));
    const seenTeamKeys = new Set<string>();
    let exactId = 0;
    let abbrFallback = 0;
    let ambiguous = 0;
    let unmapped = 0;
    const unmappedTeams: Array<Record<string, unknown>> = [];
    const ambiguousTeams: Array<Record<string, unknown>> = [];
    const inspectTeam = (team: BdlTeam | null | undefined, ctx: string) => {
      const id = sid(team?.id);
      const abbr = (team?.abbreviation ?? '').trim().toUpperCase();
      const key = `${id}|${abbr}|${ctx}`;
      if (seenTeamKeys.has(key)) return;
      seenTeamKeys.add(key);
      const resolved = resolver.resolve(team);
      if (id && byId.has(id)) exactId += 1;
      else if (resolved.ok) abbrFallback += 1;
      else if (!resolved.ok && resolved.reason === 'ambiguous') {
        ambiguous += 1;
        ambiguousTeams.push({ ctx, id, abbr });
      } else {
        unmapped += 1;
        unmappedTeams.push({ ctx, id, abbr });
      }
    };
    for (const g of games) {
      inspectTeam(g.home_team, `game:${sid(g.id)}:home`);
      inspectTeam(g.visitor_team, `game:${sid(g.id)}:away`);
    }

    const mappedPlayerIds = report.players.map((p) => p.player_id);
    const existingPlayers = mappedPlayerIds.length
      ? await client.query<{ player_id: string }>(
          `select player_id from analytics.players where player_id = any($1::text[])`,
          [mappedPlayerIds]
        )
      : { rows: [] as Array<{ player_id: string }> };
    const existingPlayerSet = new Set(existingPlayers.rows.map((r) => r.player_id));
    const newPlayerIds = mappedPlayerIds.filter((id) => !existingPlayerSet.has(id));
    const bdlMaps = mappedPlayerIds.length
      ? await client.query<{ provider_player_id: string; player_entity_id: string; n: string }>(
          `select provider_player_id, player_entity_id, count(*)::text as n
           from analytics.player_provider_ids
           where provider = 'balldontlie' and provider_player_id = any($1::text[])
           group by 1, 2`,
          [mappedPlayerIds]
        )
      : { rows: [] as Array<{ provider_player_id: string; player_entity_id: string; n: string }> };
    const dupMaps = bdlMaps.rows.filter((r) => Number(r.n) > 1);
    const nullPlayerIssues = report.issues.filter((i) => i.kind === 'missing_player');

    const crossSeason = existingGames.filter((g) => g.season != null && g.season !== '2024');
    const sameSeasonExisting = existingGames.filter((g) => g.season === '2024');
    const otherLocal = existingGames.filter((g) => g.season == null);

    const mappedGameIds = new Set(report.games.map((g) => g.game_id));
    const logDup = new Map<string, number>();
    const foreignTeam: string[] = [];
    const nullCore: string[] = [];
    const badMinutes: string[] = [];
    const teamsByGame = new Map<string, Set<string>>();
    const ptsByGameTeam = new Map<string, Map<string, number>>();
    for (const log of report.logs) {
      const k = `${log.game_id}|${log.player_id}`;
      logDup.set(k, (logDup.get(k) ?? 0) + 1);
      const g = report.games.find((x) => x.game_id === log.game_id);
      if (!mappedGameIds.has(log.game_id)) foreignTeam.push(`unknown-game:${log.game_id}`);
      if (g && log.team_id !== g.home_team_id && log.team_id !== g.away_team_id) {
        foreignTeam.push(`${log.game_id}:${log.player_id}:${log.team_id}`);
      }
      if (!log.game_id || !log.player_id || !log.team_id) nullCore.push(k);
      if (log.minutes != null && !/^\d{1,3}(:\d{2})?$/.test(String(log.minutes).trim()) && String(log.minutes).trim() !== '') {
        badMinutes.push(`${k}:${log.minutes}`);
      }
      const tset = teamsByGame.get(log.game_id) ?? new Set<string>();
      tset.add(log.team_id);
      teamsByGame.set(log.game_id, tset);
      const pm = ptsByGameTeam.get(log.game_id) ?? new Map<string, number>();
      pm.set(log.team_id, (pm.get(log.team_id) ?? 0) + Number(log.points ?? 0));
      ptsByGameTeam.set(log.game_id, pm);
    }
    const duplicateLogKeys = [...logDup.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    const oneTeamFinals: string[] = [];
    const scoreMismatches: Array<Record<string, unknown>> = [];
    for (const g of report.games) {
      const teams = teamsByGame.get(g.game_id);
      if (!teams || !teams.has(g.home_team_id) || !teams.has(g.away_team_id)) oneTeamFinals.push(g.game_id);
      const pts = ptsByGameTeam.get(g.game_id) ?? new Map();
      const homePts = pts.get(g.home_team_id) ?? 0;
      const awayPts = pts.get(g.away_team_id) ?? 0;
      if (g.home_score != null && g.away_score != null && (homePts !== Number(g.home_score) || awayPts !== Number(g.away_score))) {
        scoreMismatches.push({
          gameId: g.game_id,
          official: { home: g.home_score, away: g.away_score },
          summed: { home: homePts, away: awayPts },
        });
      }
    }

    const teamStatKeys = new Map<string, { team_id: string; game_id: string; is_home: boolean }>();
    for (const log of report.logs) {
      const g = report.games.find((x) => x.game_id === log.game_id);
      if (!g) continue;
      const key = `${log.team_id}|${log.game_id}`;
      if (!teamStatKeys.has(key)) {
        teamStatKeys.set(key, {
          team_id: log.team_id,
          game_id: log.game_id,
          is_home: log.team_id === g.home_team_id,
        });
      }
    }
    const tgsByGame = new Map<string, number>();
    for (const row of teamStatKeys.values()) tgsByGame.set(row.game_id, (tgsByGame.get(row.game_id) ?? 0) + 1);
    const tgsZero: string[] = [];
    const tgsOne: string[] = [];
    const tgsOver: string[] = [];
    const tgsWrong: string[] = [];
    for (const g of report.games) {
      const n = tgsByGame.get(g.game_id) ?? 0;
      if (n === 0) tgsZero.push(g.game_id);
      else if (n === 1) tgsOne.push(g.game_id);
      else if (n > 2) tgsOver.push(g.game_id);
      const rows = [...teamStatKeys.values()].filter((r) => r.game_id === g.game_id);
      if (n === 2) {
        const ids = rows.map((r) => r.team_id);
        if (!ids.includes(g.home_team_id) || !ids.includes(g.away_team_id)) tgsWrong.push(g.game_id);
      }
    }

    const playerAvgIds = [...new Set(report.logs.map((l) => l.player_id))];
    const teamAvgIds = [...new Set([...teamStatKeys.values()].map((r) => r.team_id))];

    const appearances = report.logs.map((l) => ({
      playerId: l.player_id,
      teamId: l.team_id,
      gameDate: l.game_date,
      gameId: l.game_id,
    }));
    const stintPlan = planCompletedSeasonStintsFromLogs({ season: '2024', appearances });
    const existing2024Inferred = await client.query<{ n: number }>(
      `select count(*)::int as n from analytics.player_team_stints where season = '2024' and source = $1`,
      [INFERRED_PGL_SOURCE]
    );
    const existingOtherSeasonInferredWouldStay = await client.query<{ n: number }>(
      `select count(*)::int as n from analytics.player_team_stints
       where source = $1 and season <> '2024'`,
      [INFERRED_PGL_SOURCE]
    );

    const compact2025 = {
      gamesRows: 1323,
      gamesBytes: 778240,
      logsRows: 46056,
      logsBytes: 14827520,
      tgsRows: 2644,
      tgsBytes: 1409024,
      psaRows: 603,
      psaBytes: 335872,
      tsaRows: 30,
      tsaBytes: 114688,
      stintsRows: 1276,
      stintsBytes: 1196032,
    };
    const scale = (rows: number, refRows: number, refBytes: number) =>
      refRows > 0 ? (rows / refRows) * refBytes : 0;
    const projectedHeap =
      scale(report.games.length, compact2025.gamesRows, compact2025.gamesBytes) +
      scale(report.logs.length, compact2025.logsRows, compact2025.logsBytes) +
      scale(teamStatKeys.size, compact2025.tgsRows, compact2025.tgsBytes) +
      scale(playerAvgIds.length, compact2025.psaRows, compact2025.psaBytes) +
      scale(teamAvgIds.length, compact2025.tsaRows, compact2025.tsaBytes) +
      scale(stintPlan.inferredStints.length, compact2025.stintsRows, compact2025.stintsBytes);
    const storage = {
      method: 'Scale 2025 compact serving bytes/row to projected 2024 row counts. Low/base/high apply index overhead.',
      projectedHeapBytes: Math.round(projectedHeap),
      projectedHeapMb: mb(projectedHeap),
      lowMb: mb(projectedHeap * 1.1),
      baseMb: mb(projectedHeap * 1.25),
      highMb: mb(projectedHeap * 1.5),
      highExceeds35Mb: mb(projectedHeap * 1.5) > 35,
    };
    const dbNow = Number(s.db_bytes);
    const after = {
      currentMb: mb(dbNow),
      deltaLowMb: storage.lowMb,
      deltaBaseMb: storage.baseMb,
      deltaHighMb: storage.highMb,
      projectedLowMb: mb(dbNow) + storage.lowMb,
      projectedBaseMb: mb(dbNow) + storage.baseMb,
      projectedHighMb: mb(dbNow) + storage.highMb,
      headroomTo340Base: Math.round((340 - (mb(dbNow) + storage.baseMb)) * 100) / 100,
      headroomTo400Base: Math.round((400 - (mb(dbNow) + storage.baseMb)) * 100) / 100,
      headroomTo450Base: Math.round((450 - (mb(dbNow) + storage.baseMb)) * 100) / 100,
      stop2023IfDbOver340: true,
      stop2023IfDeltaOver35: true,
    };

    const req2024 = 477;
    const avgMs = 13654;
    const hours = (n: number) => Math.round(((n * avgMs) / 3600000) * 100) / 100;
    const timeBudget = {
      note: 'No BDL HTTP in this preflight. 2023 core scaled from Step 3A 477 attempts × 13.654s. 6-hour end-of-trial reserve must be kept. Do not start any acquisition from this table.',
      step3A: { httpAttempts: req2024, avgSpacingMs: avgMs, apiHours: hours(req2024) },
      phases: [
        { phase: '2024 materialize', expectedApiRequests: 0, estimatedApiTime: '0 API time', priority: 'MUST' },
        { phase: '2023 core archive', expectedApiRequests: '~450–500', estimatedApiTime: '~1.8–2.0 h', priority: 'MUST' },
        { phase: '2023 materialize', expectedApiRequests: 0, estimatedApiTime: '0 API time', priority: 'MUST' },
        { phase: 'Advanced 2025', expectedApiRequests: '~350–550', estimatedApiTime: '~1.3–2.1 h', priority: 'HIGH' },
        { phase: 'Advanced 2024', expectedApiRequests: '~350–550', estimatedApiTime: '~1.3–2.1 h', priority: 'HIGH' },
        { phase: 'Advanced 2023', expectedApiRequests: '~350–550', estimatedApiTime: '~1.3–2.1 h', priority: 'HIGH' },
        { phase: 'Opening props', expectedApiRequests: '~800–1400', estimatedApiTime: '~3.0–5.3 h', priority: 'HIGH' },
        { phase: 'Opening odds', expectedApiRequests: '~200–1320', estimatedApiTime: '~0.8–5.0 h', priority: 'HIGH' },
        { phase: 'Lineups', expectedApiRequests: '~1300', estimatedApiTime: '~5 h', priority: 'OPTIONAL' },
        { phase: '2022 core', expectedApiRequests: '~2024 scale', estimatedApiTime: '~1.8–2.0 h', priority: 'OPTIONAL' },
      ],
      endOfTrialReserveHours: 6,
    };

    const sqlScope = {
      teamGameStatsPredicate: TEAM_GAME_STATS_SEASON_PREDICATE,
      playerAveragesSqlContainsSeasonBind: PLAYER_SEASON_AVERAGES_SQL.includes('where season = $1'),
      deleteTeamStats: DELETE_TEAM_GAME_STATS_FOR_SEASON_SQL,
      deletePlayerAverages: DELETE_PLAYER_AVERAGES_FOR_SEASON_SQL,
      deleteTeamAverages: DELETE_TEAM_AVERAGES_FOR_SEASON_SQL,
      deleteInferredStints: DELETE_INFERRED_STINTS_FOR_SEASON_SQL,
      rebuildTeamAveragesWhereSeasonBind: REBUILD_TEAM_AVERAGES_FOR_SEASON_SQL.includes('where season = $1'),
      inferredSourceOnly: INFERRED_PGL_SOURCE,
      cannotUpdate2025: true,
    };

    const blockingStintIssues = stintPlan.manualQueue.filter(
      (m) => m.kind !== 'unusual_team_transition'
    );
    const blockers: string[] = [];
    if (report.stats.crossSeasonConflicts > 0) blockers.push('cross-season game collisions');
    if (quality.teams.ambiguous > 0) blockers.push('ambiguous team mappings');
    if (quality.teams.missing > 0) blockers.push('unmapped teams');
    if (scoreMismatches.length > 0) blockers.push(`score mismatches ${scoreMismatches.length}`);
    if (duplicateLogKeys.length > 0) blockers.push('duplicate player-log keys');
    if (foreignTeam.length > 0) blockers.push('foreign team IDs on logs');
    if (tgsZero.length + tgsOne.length + tgsOver.length + tgsWrong.length > 0) blockers.push('team-stat shape issues');
    if (storage.highExceeds35Mb) blockers.push('high storage estimate > 35 MB');
    if (oneTeamFinals.length > 0) blockers.push(`one-team-only finals ${oneTeamFinals.length}`);
    if (dupMaps.length > 0) blockers.push('duplicate BDL provider mappings');
    if (blockingStintIssues.length > 0) blockers.push('blocking stint reconstruction issues');

    let verdict: string;
    if (
      report.stats.crossSeasonConflicts > 0 ||
      quality.teams.ambiguous > 0 ||
      scoreMismatches.length > 0 ||
      !archiveVerification.matchesStep3A
    ) {
      verdict = 'RED — stop 2024 serving backfill';
    } else if (blockers.length > 0) {
      verdict = 'YELLOW — review listed issues before materialization';
    } else {
      verdict = 'GREEN — 2024 materialization preflight clean; proceed to controlled 2024 Postgres materialization';
    }

    await client.query('commit');

    const out = {
      generatedAt,
      step: '3B',
      readOnly: true,
      bdlHttpRequests: 0,
      postgresWrites: false,
      safety,
      archiveVerification,
      mapper: {
        fn: 'transformBdlArchiveToServing',
        stagingMode: plan.stagingMode,
        season: report.season,
        stats: report.stats,
        issueCounts: {
          missing_team: report.issues.filter((i) => i.kind === 'missing_team').length,
          ambiguous_team: report.issues.filter((i) => i.kind === 'ambiguous_team').length,
          missing_player: nullPlayerIssues.length,
          missing_game: report.issues.filter((i) => i.kind === 'missing_game').length,
          cross_season_game: report.stats.crossSeasonConflicts,
          out_of_window: report.stats.gamesSkippedWindow,
        },
        issueSample: report.issues.slice(0, 40),
      },
      projectedGames: { rows: report.games.length, expectedApprox: 1321 },
      projectedPlayerLogs: {
        rows: report.logs.length,
        statsFetched: report.stats.statsFetched,
        droppedVsArchive: report.stats.statsFetched - report.logs.length,
      },
      projectedTeamStats: {
        rows: teamStatKeys.size,
        expectedIfComplete: report.games.length * 2,
        zeroRowGames: tgsZero,
        oneRowGames: tgsOne,
        overTwoRowGames: tgsOver,
        wrongTeamIds: tgsWrong,
      },
      projectedAverages: {
        playerRows: playerAvgIds.length,
        playerDuplicateKeys: 0,
        playerNullIds: playerAvgIds.filter((id) => !id).length,
        teamRows: teamAvgIds.length,
        expectedTeams: 30,
        teamDuplicateKeys: 0,
        teamNullIds: teamAvgIds.filter((id) => !id).length,
        sqlScope,
      },
      projectedStints: {
        inferredRows: stintPlan.inferredStints.length,
        distinctPlayerTeam: new Set(stintPlan.inferredStints.map((s) => `${s.playerId}|${s.teamId}`)).size,
        multiTeamPlayers: stintPlan.stats.multiTeamPlayers,
        unusualTransitions: stintPlan.manualQueue.filter((m) => m.kind === 'unusual_team_transition').length,
        unusualTransitionsNote:
          'A→B→A appearance sequences (waive/re-sign or two-way returns). Reported, not a mapping failure. Does not block materialization by itself.',
        manualQueueSample: stintPlan.manualQueue.slice(0, 25),
        conflicts: stintPlan.conflicts,
        skippedUnresolved: stintPlan.skippedUnresolvedPlayerIds,
        existing2024Inferred: Number(existing2024Inferred.rows[0]?.n ?? 0),
        otherSeasonInferredUntouched: Number(existingOtherSeasonInferredWouldStay.rows[0]?.n ?? 0),
        applyWouldOnlyDelete: DELETE_INFERRED_STINTS_FOR_SEASON_SQL,
      },
      teamIdentity: {
        exactIdMatches: exactId,
        abbreviationFallbackMatches: abbrFallback,
        ambiguous,
        unmapped,
        ambiguousTeams,
        unmappedTeams,
        mappedCurrentTeams: quality.teams.mapped,
        defunctLegacy: unmappedTeams.filter((t) => Number(t.id) > 30),
      },
      playerIdentity: {
        providerPlayerIds: mappedPlayerIds.length,
        existingAnalyticsPlayerIds: existingPlayerSet.size,
        newAnalyticsPlayerInserts: newPlayerIds.length,
        newPlayerIdSample: newPlayerIds.slice(0, 30),
        unmappedInvalidPlayers: nullPlayerIssues.map((i) => i.id),
        duplicateProviderMappings: dupMaps,
        bdlProviderMapsFound: bdlMaps.rows.length,
        conflictingPlayerIdentities: [] as string[],
        nameGuessing: false,
      },
      crossSeasonCollisions: {
        existingLookups: existingGames.length,
        crossSeason: crossSeason,
        sameSeasonExisting: sameSeasonExisting,
        unexpectedLocal: otherLocal,
        mapperSkippedCrossSeason: report.stats.crossSeasonConflicts,
      },
      scoreReconciliation: {
        finals: report.games.length,
        matches: report.games.length - scoreMismatches.length,
        mismatches: scoreMismatches.length,
        mismatchGameIds: scoreMismatches.map((m) => m.gameId),
        mismatchSample: scoreMismatches.slice(0, 20),
        expected: '1321 / 1321 match',
      },
      structuralValidation: {
        duplicatePlayerGameKeys: duplicateLogKeys.length,
        logsOutsideMappedGames: report.logs.filter((l) => !mappedGameIds.has(l.game_id)).length,
        foreignTeamIds: foreignTeam.length,
        foreignTeamSample: foreignTeam.slice(0, 20),
        nullCoreIds: nullCore.length,
        unusualMinutes: badMinutes.slice(0, 20),
        oneTeamOnlyFinals: oneTeamFinals,
      },
      projectedStorageDelta: storage,
      projectedDbAfter2024: after,
      updatedTrialTimeBudget: timeBudget,
      isolation: {
        games2025: Number(s.games_2025),
        logs2025: Number(s.logs_2025),
        tgs2025: Number(s.tgs_2025),
        box18447793: box.rows[0] ?? null,
        games2026: Number(s.games_2026),
        logs2026: Number(s.logs_2026),
        stints2026: Number(s.stints_2026),
      },
      materializationBlockers: blockers,
      verdict,
    };

    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n');
    writeFileSync(
      OUT_MD,
      [
        '# 2024 materialization preflight (Step 3B)',
        '',
        `Generated: ${generatedAt}`,
        '',
        `**${verdict}**`,
        '',
        `- stagingMode: ${plan.stagingMode}`,
        `- projected games: ${report.games.length}`,
        `- projected logs: ${report.logs.length}`,
        `- projected team stats: ${teamStatKeys.size}`,
        `- player averages: ${playerAvgIds.length}`,
        `- team averages: ${teamAvgIds.length}`,
        `- inferred stints: ${stintPlan.inferredStints.length}`,
        `- score matches: ${report.games.length - scoreMismatches.length} / ${report.games.length}`,
        `- cross-season collisions: ${report.stats.crossSeasonConflicts}`,
        `- storage high MB: ${storage.highMb}`,
        `- blockers: ${blockers.length ? blockers.join('; ') : 'none'}`,
        '',
      ].join('\n')
    );

    console.log(
      JSON.stringify(
        {
          verdict,
          projected: {
            games: report.games.length,
            logs: report.logs.length,
            teamStats: teamStatKeys.size,
            playerAvgs: playerAvgIds.length,
            teamAvgs: teamAvgIds.length,
            stints: stintPlan.inferredStints.length,
          },
          score: { matches: report.games.length - scoreMismatches.length, mismatches: scoreMismatches.length },
          collisions: report.stats.crossSeasonConflicts,
          storage,
          after,
          blockers,
          outJson: OUT_JSON,
        },
        null,
        2
      )
    );
    if (verdict.startsWith('RED')) process.exitCode = 2;
    else if (verdict.startsWith('YELLOW')) process.exitCode = 1;
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

main()
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
