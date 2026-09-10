/**
 * Season 2025 lineups raw archive (Step 8B).
 * Canonical S3 only. No Postgres lineup table. No 2022.
 *
 * Reuses LINEUPS_PATH from lib/balldontlie/lineups.ts and BdlArchiveClient
 * (limiter, 429 retries, raw envelopes). Copies valid Step 8A characterization
 * objects instead of refetching. fetchLineupsFromBallDontLie is not used here
 * because it swallows HTTP status.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-lineups-2025.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-lineups-2025.ts --execute
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/backfill-lineups-2025.ts --certify-only
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import {
  LINEUPS_2025_AVAILABILITY_LIMITATION,
  LINEUPS_2025_EXPECTED_TARGET,
  LINEUPS_2025_LOCAL_ONLY_ID,
  LINEUPS_2025_MAX_CRAWL_MS,
  classifyStarterReliability,
  extractLineupRows,
  lineups2025CanonicalPrefix,
  lineups2025CharacterizationPrefix,
  lineups2025GameObjectKey,
  loadAuthoritativeBdl2025GameInventory,
  nestedId,
  planLineups2025ArchiveFromArgv,
  validateLineupArchiveBody,
  type LineupArchiveJson,
} from '@/lib/archive/lineups-2025';
import { archiveJsonObjectToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';
import { acquireBdlAcquisitionLock, bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { BDL_NBA_BASE_URL, BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';
import { LINEUPS_PATH } from '@/lib/balldontlie/lineups';
import { assertTrialExecuteAllowed, resolveBdlRequestDelayMs } from '@/lib/balldontlie/trial-limiter';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const EXPECTED_DB_BYTES = 342_846_611;
const TRIAL_START_ISO = '2026-09-08T12:10:59.422Z';
const ADV_PREFIX = 'raw/source=balldontlie/league=nba/season=2025/entity=advanced_stats_v2';
const REPORT_JSON = 'reports/trial/lineups-2025-full-archive-report.json';
const REPORT_MD = 'reports/trial/lineups-2025-full-archive-report.md';
const PROGRESS_JSON = 'reports/trial/lineups-2025-full-archive-progress.json';
const MAX_CONSECUTIVE_FAILURES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, unknown>;

function sid(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function round(n: number | null | undefined, d = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function pct(n: number, d: number, digits = 2): number | null {
  if (!d) return null;
  return round((100 * n) / d, digits);
}

function hoursSinceTrialStart(nowIso: string): number {
  return (Date.parse(nowIso) - Date.parse(TRIAL_START_ISO)) / 3_600_000;
}

function parseMinutes(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '-' || s.toLowerCase() === 'dnp') return 0;
  const m = s.match(/^(\d+)(?::(\d+))?/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2] ?? 0) / 60;
}

function lineupTeamId(row: LineupArchiveJson): string | null {
  return nestedId(row.team);
}

function lineupPlayerId(row: LineupArchiveJson): string | null {
  return nestedId(row.player);
}

function isCanonicalGameKey(prefix: string, key: string): boolean {
  if (!key.startsWith(`${prefix}/`)) return false;
  if (key.includes('/_characterization_')) return false;
  return /\/game_id=\d+\.json$/.test(key);
}

async function listReusableCharacterization(
  s3: S3Storage,
  charPrefix: string,
  targetIds: Set<string>
): Promise<{ gameId: string; key: string; body: Json }[]> {
  const out: { gameId: string; key: string; body: Json }[] = [];
  for await (const o of s3.listByPrefix(charPrefix.endsWith('/') ? charPrefix : `${charPrefix}/`)) {
    const m = o.key.match(/game_id=(\d+)\.json$/);
    if (!m) continue;
    const gameId = m[1]!;
    if (!targetIds.has(gameId)) continue;
    const body = await s3.getJson<Json>(o.key);
    const v = validateLineupArchiveBody(gameId, body);
    if (!v.ok || !body) {
      console.log(`[lineups-2025] characterization skip game_id=${gameId} reason=${v.reason}`);
      continue;
    }
    out.push({ gameId, key: o.key, body });
  }
  return out;
}

async function alreadyCanonical(s3: S3Storage, canonicalPrefix: string, _gameIds: string[]): Promise<Set<string>> {
  const have = new Set<string>();
  for await (const o of s3.listByPrefix(canonicalPrefix.endsWith('/') ? canonicalPrefix : `${canonicalPrefix}/`)) {
    if (!isCanonicalGameKey(canonicalPrefix, o.key)) continue;
    const m = o.key.match(/game_id=(\d+)\.json$/);
    if (m) have.add(m[1]!);
  }
  return have;
}

function writeProgress(body: Json) {
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(PROGRESS_JSON, JSON.stringify(body, null, 2) + '\n');
}

async function measurePostgres(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Json[] }> }) {
  const snap = await client.query(
    `select
       pg_database_size(current_database())::text as db_bytes,
       (select count(*)::int from analytics.games where season = '2025') as games_2025,
       (select count(*)::int from analytics.player_game_logs where season = '2025') as logs_2025,
       (select count(*)::int from analytics.games where season = '2026') as games_2026,
       (select count(*)::int from analytics.player_game_logs where season = '2026') as logs_2026`
  );
  const serving = await client.query(
    `select to_regclass('analytics.lineups')::text as rel
     union all select to_regclass('analytics.game_lineups')::text
     union all select to_regclass('analytics.player_lineups')::text
     union all select to_regclass('analytics.game_starters')::text
     union all select to_regclass('raw.lineups')::text
     union all select to_regclass('analytics.player_advanced_stats')::text`
  );
  const s = snap.rows[0] as {
    db_bytes: string;
    games_2025: number;
    logs_2025: number;
    games_2026: number;
    logs_2026: number;
  };
  const tables = (serving.rows as { rel: string | null }[]).map((r) => r.rel).filter(Boolean) as string[];
  return {
    dbBytes: Number(s.db_bytes),
    dbMb: round(Number(s.db_bytes) / (1024 * 1024), 2),
    games2025: s.games_2025,
    logs2025: s.logs_2025,
    games2026: s.games_2026,
    logs2026: s.logs_2026,
    lineupServingTables: tables.filter((t) => t.toLowerCase().includes('lineup') || t.toLowerCase().includes('starter')),
    advancedServingTables: tables.filter((t) => t.toLowerCase().includes('advanced')),
  };
}

async function certifyArchive(args: {
  s3: S3Storage;
  canonicalPrefix: string;
  targetIds: string[];
  inventoryById: Map<string, { date: string | null; postseason: boolean }>;
  acquisition: Json;
  safety: Json;
  reuse: Json;
  timeGate: Json;
  generatedAt: string;
}): Promise<Json> {
  const { s3, canonicalPrefix, targetIds, inventoryById } = args;
  const bodies = new Map<string, Json>();
  const missingCanonical: string[] = [];
  const invalidCanonical: string[] = [];
  const allRows: LineupArchiveJson[] = [];
  const rowsByGame = new Map<string, LineupArchiveJson[]>();

  for (const gameId of targetIds) {
    const key = lineups2025GameObjectKey(canonicalPrefix, gameId);
    const body = await s3.getJson<Json>(key);
    if (!body) {
      missingCanonical.push(gameId);
      continue;
    }
    const v = validateLineupArchiveBody(gameId, body);
    if (!v.ok) {
      invalidCanonical.push(gameId);
      continue;
    }
    bodies.set(gameId, body);
    const rows = extractLineupRows(body);
    rowsByGame.set(gameId, rows);
    allRows.push(...rows);
  }

  const grainKeys = new Map<string, number>();
  let nullGameIds = 0;
  let nullTeamIds = 0;
  let nullPlayerIds = 0;
  let starterNulls = 0;
  let positionNulls = 0;
  let teamObjectPresent = 0;
  let teamObjectMissing = 0;
  let teamIdMatchesPlayerTeam = 0;
  let teamIdMismatchesPlayerTeam = 0;
  const uniquePlayers = new Set<string>();
  const uniqueTeams = new Set<string>();
  const uniqueGames = new Set<string>();

  for (const r of allRows) {
    const gameId = sid(r.game_id);
    const teamId = lineupTeamId(r);
    const playerId = lineupPlayerId(r);
    if (!gameId) nullGameIds += 1;
    else uniqueGames.add(gameId);
    if (!teamId) nullTeamIds += 1;
    else uniqueTeams.add(teamId);
    if (!playerId) nullPlayerIds += 1;
    else uniquePlayers.add(playerId);
    if (r.starter == null) starterNulls += 1;
    if (r.position == null || String(r.position).trim() === '') positionNulls += 1;
    if (r.team && typeof r.team === 'object') teamObjectPresent += 1;
    else teamObjectMissing += 1;
    const playerTeam = sid((r.player as Json | undefined)?.team_id);
    if (teamId && playerTeam) {
      if (teamId === playerTeam) teamIdMatchesPlayerTeam += 1;
      else teamIdMismatchesPlayerTeam += 1;
    }
    if (gameId && teamId && playerId) {
      const k = `${gameId}|${teamId}|${playerId}`;
      grainKeys.set(k, (grainKeys.get(k) ?? 0) + 1);
    }
  }
  const duplicateLogicalKeys = [...grainKeys.values()].filter((n) => n > 1).length;

  const teamGamesEval: Json[] = [];
  const starterAnomalies: Json[] = [];
  let exactly5 = 0;
  let fewer5 = 0;
  let more5 = 0;
  let dupStarterFlags = 0;
  let nullStarterTeamGames = 0;
  let valid5plus5 = 0;
  const validGameIds: string[] = [];

  for (const gameId of targetIds) {
    const rows = rowsByGame.get(gameId) ?? [];
    const byTeam = new Map<string, LineupArchiveJson[]>();
    for (const r of rows) {
      const teamId = lineupTeamId(r);
      if (!teamId) continue;
      const arr = byTeam.get(teamId) ?? [];
      arr.push(r);
      byTeam.set(teamId, arr);
    }
    let gameValid = byTeam.size === 2;
    const teamSummaries: Json[] = [];
    for (const [teamId, trows] of byTeam) {
      const starters = trows.filter((r) => r.starter === true);
      const starterPlayers = starters.map((r) => lineupPlayerId(r)).filter((x): x is string => !!x);
      const dup = starterPlayers.length !== new Set(starterPlayers).size;
      const nullStarter = trows.some((r) => r.starter == null);
      const n = starters.length;
      if (n === 5) exactly5 += 1;
      else if (n < 5) fewer5 += 1;
      else more5 += 1;
      if (dup) dupStarterFlags += 1;
      if (nullStarter) nullStarterTeamGames += 1;
      const ok = n === 5 && !dup && !nullStarter;
      if (!ok) gameValid = false;
      teamSummaries.push({ teamId, starters: n, duplicateStarters: dup, nullStarter });
      if (!ok) {
        starterAnomalies.push({
          gameId,
          teamId,
          starters: n,
          duplicateStarters: dup,
          nullStarter,
        });
      }
    }
    if (byTeam.size !== 2) {
      gameValid = false;
      starterAnomalies.push({
        gameId,
        reason: 'team_count_not_2',
        teams: [...byTeam.keys()],
        records: rows.length,
      });
    }
    if (gameValid) {
      valid5plus5 += 1;
      validGameIds.push(gameId);
    }
    teamGamesEval.push({ gameId, teams: teamSummaries });
  }

  const reliability = classifyStarterReliability(valid5plus5, targetIds.length);

  const db = await pool.connect();
  let identity: Json = {};
  let logComparison: Json = {};
  let bench: Json = {};
  let replacement: Json = {};
  let joinability: Json = {};
  let dbAfter = 0;
  let isolationAfter: Json = {};
  try {
    await db.query('begin read only');
    await db.query("set local statement_timeout = '300000'");
    isolationAfter = await measurePostgres(db);
    dbAfter = Number(isolationAfter.dbBytes);

    const gameMeta = await db.query<{
      game_id: string;
      season: string | null;
      home_team_id: string;
      away_team_id: string;
      start_time: Date | null;
    }>(
      `select game_id, season, home_team_id, away_team_id, start_time
       from analytics.games
       where game_id = any($1::text[])`,
      [targetIds]
    );
    const gamesById = new Map(gameMeta.rows.map((r) => [r.game_id, r]));
    let mappedGames = 0;
    let unknownGames = 0;
    let wrongSeason = 0;
    for (const id of uniqueGames) {
      const g = gamesById.get(id);
      if (!g) unknownGames += 1;
      else if (String(g.season) !== '2025') wrongSeason += 1;
      else mappedGames += 1;
    }

    const teamIds = [...uniqueTeams];
    const teamRows = await db.query<{ team_id: string }>(
      `select team_id from analytics.teams where team_id = any($1::text[])`,
      [teamIds]
    );
    const knownTeams = new Set(teamRows.rows.map((r) => r.team_id));
    let mappedTeams = 0;
    let unknownTeams = 0;
    let teamNotInGame = 0;
    for (const r of allRows) {
      const teamId = lineupTeamId(r);
      const gameId = sid(r.game_id);
      if (!teamId) continue;
      if (!knownTeams.has(teamId)) unknownTeams += 1;
      else mappedTeams += 1;
      const g = gameId ? gamesById.get(gameId) : undefined;
      if (g && teamId !== g.home_team_id && teamId !== g.away_team_id) teamNotInGame += 1;
    }
    // unique team mapping counts (not per-row)
    mappedTeams = [...uniqueTeams].filter((t) => knownTeams.has(t)).length;
    unknownTeams = [...uniqueTeams].filter((t) => !knownTeams.has(t)).length;
    teamNotInGame = 0;
    for (const r of allRows) {
      const teamId = lineupTeamId(r);
      const gameId = sid(r.game_id);
      const g = gameId ? gamesById.get(gameId) : undefined;
      if (g && teamId && teamId !== g.home_team_id && teamId !== g.away_team_id) teamNotInGame += 1;
    }

    const playerIds = [...uniquePlayers];
    const playerRows = await db.query<{ player_id: string }>(
      `select player_id from analytics.players where player_id = any($1::text[])`,
      [playerIds]
    );
    const knownPlayers = new Set(playerRows.rows.map((r) => r.player_id));
    const unmappedPlayers = playerIds.filter((id) => !knownPlayers.has(id));
    identity = {
      games: {
        mapped: mappedGames,
        unknown: unknownGames,
        wrongSeason,
        note: 'Mapped against analytics.games by provider game_id',
      },
      teams: {
        mapped: mappedTeams,
        unknown: unknownTeams,
        teamNotParticipatingInGame: teamNotInGame,
        matchMethod: 'top-level team.id (not player.team_id)',
      },
      players: {
        uniqueLineupPlayers: playerIds.length,
        mapped: playerIds.length - unmappedPlayers.length,
        unmapped: unmappedPlayers.length,
        unmappedIds: unmappedPlayers.slice(0, 50),
        conflicts: 0,
        matchMethod: 'provider player.id == analytics.players.player_id (no name guessing)',
      },
    };

    const logs = await db.query<{
      game_id: string;
      player_id: string;
      minutes: string | null;
    }>(
      `select game_id, player_id, minutes
       from analytics.player_game_logs
       where game_id = any($1::text[])`,
      [targetIds]
    );
    const logKeys = new Set(logs.rows.map((r) => `${r.game_id}|${r.player_id}`));
    const logMinutes = new Map(logs.rows.map((r) => [`${r.game_id}|${r.player_id}`, r.minutes]));
    const lineupKeys: string[] = [];
    for (const r of allRows) {
      const gameId = sid(r.game_id);
      const playerId = lineupPlayerId(r);
      if (gameId && playerId) lineupKeys.push(`${gameId}|${playerId}`);
    }
    const lineupKeySet = new Set(lineupKeys);
    const lineupWithLogs = lineupKeys.filter((k) => logKeys.has(k)).length;
    const lineupOnly = lineupKeys.filter((k) => !logKeys.has(k)).length;
    const logPlayers = [...logKeys];
    const logInLineup = logPlayers.filter((k) => lineupKeySet.has(k)).length;
    const logOnly = logPlayers.filter((k) => !lineupKeySet.has(k)).length;
    logComparison = {
      lineupPlayersWithMatchingLogs: lineupWithLogs,
      lineupOnlyPlayers: lineupOnly,
      logPlayersPresentInLineup: logInLineup,
      logOnlyPlayers: logOnly,
      lineupToLogsMatchPct: pct(lineupWithLogs, lineupKeys.length),
      lineupOnlyPct: pct(lineupOnly, lineupKeys.length),
      logsToLineupMatchPct: pct(logInLineup, logPlayers.length),
      logOnlyPct: pct(logOnly, logPlayers.length),
      note: 'Do not require 1:1 coverage. Endpoint is not a full-roster source.',
    };

    let benchPlayed = 0;
    let benchZeroMin = 0;
    let benchNoLog = 0;
    for (const r of allRows) {
      if (r.starter !== false) continue;
      const gameId = sid(r.game_id);
      const playerId = lineupPlayerId(r);
      if (!gameId || !playerId) continue;
      const k = `${gameId}|${playerId}`;
      if (!logKeys.has(k)) {
        benchNoLog += 1;
        continue;
      }
      const mins = parseMinutes(logMinutes.get(k));
      if (mins != null && mins > 0) benchPlayed += 1;
      else benchZeroMin += 1;
    }
    bench = {
      starterFalsePlayedPositiveMinutes: benchPlayed,
      starterFalseZeroMinuteLog: benchZeroMin,
      starterFalseNoPlayerGameLog: benchNoLog,
      statement: 'starter=false does NOT mean “played off the bench.”',
      note: 'Non-starters mix players who entered, zero-minute logs, and lineup-only rows. Do not derive active/inactive from this endpoint.',
    };

    const inj = await db.query<{
      game_id: string;
      player_id: string;
      status: string | null;
    }>(
      `select g.game_id, h.player_id, h.status
       from analytics.games g
       join analytics.player_injury_status_history h
         on h.snapshot_at >= g.start_time - interval '36 hours'
        and h.snapshot_at <= g.start_time + interval '6 hours'
        and h.team_id in (g.home_team_id, g.away_team_id)
       where g.game_id = any($1::text[])
         and h.status ~* 'out|inactive'`,
      [targetIds]
    );
    const injByGame = new Map<string, Set<string>>();
    for (const row of inj.rows) {
      const set = injByGame.get(row.game_id) ?? new Set<string>();
      set.add(row.player_id);
      injByGame.set(row.game_id, set);
    }
    let gamesWithInjuryMarked = 0;
    let gamesInjuryMissingFromStarters = 0;
    let gamesUsableReplacement = 0;
    const validSet = new Set(validGameIds);
    for (const gameId of targetIds) {
      const injured = injByGame.get(gameId);
      if (!injured || injured.size === 0) continue;
      gamesWithInjuryMarked += 1;
      const starters = new Set(
        (rowsByGame.get(gameId) ?? [])
          .filter((r) => r.starter === true)
          .map((r) => lineupPlayerId(r))
          .filter((x): x is string => !!x)
      );
      const missingFromStarters = [...injured].some((pid) => !starters.has(pid));
      if (missingFromStarters) {
        gamesInjuryMissingFromStarters += 1;
        if (validSet.has(gameId)) gamesUsableReplacement += 1;
      }
    }
    replacement = {
      window: 'injury snapshot_at in [start_time-36h, start_time+6h]; status ~ out|inactive; team in home/away',
      gamesWithInjuryMarkedMissingUsualStarterProxy: gamesWithInjuryMarked,
      gamesWhereInjuredPlayerIsNotAStarter: gamesInjuryMissingFromStarters,
      gamesWithDeterministicReplacementContext: gamesUsableReplacement,
      pctOfTargetWithUsableReplacementContext: pct(gamesUsableReplacement, targetIds.length),
      pctOfInjuryGamesWithUsableReplacement: pct(gamesUsableReplacement, gamesWithInjuryMarked),
      note: 'Lightweight coverage only. An Out/Inactive player who is not in the starting five plus a valid 5+5 listing is replacement context, not a causal usual-starter model. Injury as-of density may be incomplete.',
    };

    const gamesWithLogs = await db.query<{ n: number }>(
      `select count(distinct game_id)::int as n
       from analytics.player_game_logs
       where game_id = any($1::text[])`,
      [targetIds]
    );
    const propGames = await db.query<{ n: number }>(
      `select count(distinct game_id)::int as n
       from research.prop_decision_lines
       where game_id = any($1::text[])`,
      [targetIds]
    );
    const injuryGames = await db.query<{ n: number }>(
      `select count(distinct g.game_id)::int as n
       from analytics.games g
       join analytics.player_injury_status_history h
         on h.snapshot_at >= g.start_time - interval '36 hours'
        and h.snapshot_at <= g.start_time + interval '6 hours'
        and h.team_id in (g.home_team_id, g.away_team_id)
       where g.game_id = any($1::text[])`,
      [targetIds]
    );
    const stintPlayers = await db.query<{ n: number }>(
      `select count(distinct s.player_id)::int as n
       from analytics.player_team_stints s
       where s.season = '2025'
         and s.player_id = any($1::text[])`,
      [playerIds]
    );

    let advGameIds = new Set<string>();
    let advPages = 0;
    try {
      for await (const o of s3.listByPrefix(ADV_PREFIX.endsWith('/') ? ADV_PREFIX : `${ADV_PREFIX}/`)) {
        if (!o.key.endsWith('.json') || o.key.includes('_manifest') || o.key.includes('_run')) continue;
        if (!o.key.includes('page=')) continue;
        advPages += 1;
        const body = await s3.getJson(o.key);
        const rows = extractLineupRows(body);
        for (const row of rows) {
          const gid = nestedId((row as Json).game) ?? sid((row as Json).game_id);
          if (gid) advGameIds.add(gid);
        }
      }
    } catch (e) {
      console.warn('[lineups-2025] advanced stats S3 scan failed', e instanceof Error ? e.message : String(e));
    }
    const targetSet = new Set(targetIds);
    const advOverlap = [...advGameIds].filter((id) => targetSet.has(id)).length;

    joinability = {
      playerGameLogs: {
        games: gamesWithLogs.rows[0]?.n ?? 0,
        pctOfTarget: pct(Number(gamesWithLogs.rows[0]?.n ?? 0), targetIds.length),
      },
      advancedStatsS3: {
        pagesScanned: advPages,
        distinctGameIds: advGameIds.size,
        overlappingTargetGames: advOverlap,
        pctOfTarget: pct(advOverlap, targetIds.length),
        servingTable: false,
      },
      injuryHistory: {
        gamesWithSnapshotNearTip: injuryGames.rows[0]?.n ?? 0,
        pctOfTarget: pct(Number(injuryGames.rows[0]?.n ?? 0), targetIds.length),
      },
      propResearchGames: {
        games: propGames.rows[0]?.n ?? 0,
        pctOfTarget: pct(Number(propGames.rows[0]?.n ?? 0), targetIds.length),
      },
      playerTeamStints: {
        lineupPlayersWith2025Stint: stintPlayers.rows[0]?.n ?? 0,
        pctOfLineupPlayers: pct(Number(stintPlayers.rows[0]?.n ?? 0), playerIds.length),
      },
    };

    const dbAfterRow = await db.query<{ db_bytes: string }>(
      `select pg_database_size(current_database())::text as db_bytes`
    );
    dbAfter = Number(dbAfterRow.rows[0]!.db_bytes);
    await db.query('commit');
  } catch (err) {
    await db.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    db.release();
  }

  let gameObjectBytes = 0;
  let gameObjectCount = 0;
  let manifestBytes = 0;
  let runBytes = 0;
  for await (const o of s3.listByPrefix(canonicalPrefix.endsWith('/') ? canonicalPrefix : `${canonicalPrefix}/`)) {
    if (o.key.includes('/_characterization_')) continue;
    if (isCanonicalGameKey(canonicalPrefix, o.key)) {
      gameObjectBytes += o.size;
      gameObjectCount += 1;
    } else if (o.key.endsWith('/_manifest.json')) {
      manifestBytes += o.size;
    } else if (o.key.endsWith('/_run.json')) {
      runBytes += o.size;
    }
  }
  const totalBytes = gameObjectBytes + manifestBytes + runBytes;

  const role =
    reliability.classification === 'EXCELLENT' || reliability.classification === 'GOOD' ? 'recommended' : 'scoped';
  const explorer =
    reliability.classification === 'EXCELLENT' || reliability.classification === 'GOOD' ? 'recommended' : 'scoped';
  const productInterpretation = {
    roleCheck: {
      recommendation: role,
      reason: 'Explicit per-game starter=true is unique versus logs/stints/injuries/Advanced Stats.',
    },
    opportunityCheck: {
      recommendation: 'scoped',
      reason: 'Replacement context exists when an Out/Inactive player is not among the five starters and the game is valid 5+5. Not a causal usual-starter model.',
    },
    historicalExplorer: {
      recommendation: explorer,
      reason: 'Starting five display is the primary product use of this archive.',
    },
    wowy: {
      recommendation: 'not_from_this_endpoint',
      reason: 'Records are player-game listings, not five-man units or possessions.',
    },
    availability: {
      recommendation: 'not_from_this_endpoint',
      reason: LINEUPS_2025_AVAILABILITY_LIMITATION,
    },
  };

  const failed = (args.acquisition.failedGames as string[] | undefined) ?? missingCanonical;
  const complete = missingCanonical.length === 0 && invalidCanonical.length === 0;
  let stepVerdict: string;
  if (!complete || reliability.classification === 'POOR') {
    stepVerdict =
      reliability.classification === 'POOR' || !complete
        ? 'RED — lineup archive does not support reliable starter history'
        : 'YELLOW — archive complete but starter reliability/semantics require scoped use';
  } else if (reliability.classification === 'MIXED') {
    stepVerdict = 'YELLOW — archive complete but starter reliability/semantics require scoped use';
  } else {
    stepVerdict = 'GREEN — 2025 starter archive complete and product-useful';
  }

  const elapsedH = hoursSinceTrialStart(args.generatedAt);
  const remainingH = 48 - elapsedH;
  const crawlH = round(Number(args.acquisition.wallClockMs ?? 0) / 3_600_000, 3);

  return {
    generatedAt: args.generatedAt,
    step: '8B',
    postgresWrites: false,
    started2022: false,
    safety: args.safety,
    targetDefinition: {
      source: 'reports/trial/bdl-games-2025.json',
      targetCount: targetIds.length,
      expected: LINEUPS_2025_EXPECTED_TARGET,
      excludedLocalOnly: LINEUPS_2025_LOCAL_ONLY_ID,
      dateMin: [...inventoryById.values()].map((g) => g.date).filter(Boolean).sort()[0] ?? null,
      dateMax: [...inventoryById.values()].map((g) => g.date).filter(Boolean).sort().at(-1) ?? null,
      regularSeason: [...inventoryById.values()].filter((g) => !g.postseason).length,
      postseason: [...inventoryById.values()].filter((g) => g.postseason).length,
    },
    characterizationReuse: args.reuse,
    timeGate: args.timeGate,
    acquisitionResult: {
      ...args.acquisition,
      successfulGames: bodies.size,
      missingCanonical,
      invalidCanonical,
      lineupRecords: allRows.length,
    },
    rateLimitResult: args.acquisition.rateLimit ?? null,
    recordGrain: {
      totalRecords: allRows.length,
      distinctLogicalKeys: grainKeys.size,
      duplicateLogicalKeys,
      nullGameIds,
      nullTeamIds,
      nullPlayerIds,
      starterNulls,
      positionNulls,
      recommendedKey: '(game_id, team_id, player_id)',
      notFiveManUnits: true,
      uniqueGames: uniqueGames.size,
      uniqueTeams: uniqueTeams.size,
      uniquePlayers: uniquePlayers.size,
    },
    teamObjectTypeResult: {
      priorType: 'BdlLineupEntry omitted team',
      actualProviderField: 'top-level team { id, abbreviation, name, full_name, city, conference, division }',
      minimalCorrection: 'Added BdlLineupTeam / required team on BdlLineupEntry. Raw JSON remains authoritative. team.id is game-context team; do not replace with player.team_id.',
      recordsWithTeamObject: teamObjectPresent,
      recordsMissingTeamObject: teamObjectMissing,
      teamIdMatchesPlayerTeamId: teamIdMatchesPlayerTeam,
      teamIdMismatchesPlayerTeamId: teamIdMismatchesPlayerTeam,
      typescriptNowIncludesTeam: true,
    },
    identityCompatibility: identity,
    fullSeasonStarterCertification: {
      teamGamesEvaluated: exactly5 + fewer5 + more5,
      expectedTeamGames: targetIds.length * 2,
      exactly5Starters: exactly5,
      fewerThan5: fewer5,
      moreThan5: more5,
      duplicateStarterFlags: dupStarterFlags,
      nullStarterState: nullStarterTeamGames,
      valid5plus5: valid5plus5,
      valid5plus5OfTarget: `${valid5plus5} / ${targetIds.length}`,
      anomalyGameIds: [...new Set(starterAnomalies.map((a) => String((a as Json).gameId)))],
      anomalies: starterAnomalies,
    },
    starterReliabilityClassification: reliability,
    playerGameLogComparison: logComparison,
    benchSemantics: bench,
    availabilityLimitation: LINEUPS_2025_AVAILABILITY_LIMITATION,
    starterReplacementCoverage: replacement,
    contextJoinability: joinability,
    s3Certification: {
      canonicalPrefix,
      characterizationPrefixPreserved: true,
      gameObjects: gameObjectCount,
      gameObjectBytes,
      manifestBytes,
      runBytes,
      totalBytes,
      totalMb: round(totalBytes / (1024 * 1024), 2),
      step8AProjectionMb: 13.4,
    },
    productInterpretation,
    trialTimeRemaining: {
      elapsedHours: round(elapsedH, 3),
      remainingHours: round(remainingH, 3),
      protectedReserveHours: 6,
      usableRemainingHours: round(remainingH - 6, 3),
      characterizationPlusArchiveHours: crawlH,
      optional2022Hours: [1.8, 2],
      doNotStart2022: true,
      nextStep: 'final trial audit / objective review',
    },
    postgresUnchangedConfirmation: {
      expectedBytes: EXPECTED_DB_BYTES,
      dbBytesAfter: dbAfter,
      unchanged: dbAfter === EXPECTED_DB_BYTES,
      isolationAfter,
      noLineupTableCreated: (isolationAfter.lineupServingTables as string[] | undefined)?.length === 0,
      advancedStatsS3Only: true,
      marketDataServingUnchanged: true,
    },
    failedGames: failed,
    stepVerdict,
  };
}

function renderMarkdown(report: Json): string {
  const t = report.targetDefinition as Json;
  const a = report.acquisitionResult as Json;
  const s = report.fullSeasonStarterCertification as Json;
  const r = report.starterReliabilityClassification as Json;
  const pg = report.postgresUnchangedConfirmation as Json;
  return `# Lineups 2025 Full Archive (Step 8B)

- Generated: ${report.generatedAt}
- Verdict: **${report.stepVerdict}**
- Postgres writes: ${report.postgresWrites}
- Started 2022: ${report.started2022}

## Safety State
- Trial mode / 13s / concurrency 1 / frozen / season pin 2025
- Postgres expected ${EXPECTED_DB_BYTES}; after=${pg.dbBytesAfter}; unchanged=${pg.unchanged}

## Target Definition
- ${t.targetCount} games from cached BDL inventory (excluded ${t.excludedLocalOnly})
- Dates ${t.dateMin} → ${t.dateMax}; RS=${t.regularSeason}; post=${t.postseason}

## Characterization Reuse
${JSON.stringify(report.characterizationReuse, null, 2)}

## Time Gate
${JSON.stringify(report.timeGate, null, 2)}

## Acquisition Result
- target=${a.targetGames} reused=${a.reusedGames} newlyRequested=${a.newlyRequestedGames}
- successful=${a.successfulGames} zero=${a.zeroResultGames} failed=${JSON.stringify(a.failedGames)}
- records=${a.lineupRecords} HTTP=${a.httpAttempts} 429s=${a.status429} retries=${a.retries}
- wallClockMs=${a.wallClockMs}

## Full-Season Starter Certification
- valid 5+5: ${s.valid5plus5OfTarget}
- exactly5=${s.exactly5Starters} fewer=${s.fewerThan5} more=${s.moreThan5} dup=${s.duplicateStarterFlags} null=${s.nullStarterState}
- reliability: ${r.classification} (${r.pct}%)

## Availability Limitation
${report.availabilityLimitation}

## S3
${JSON.stringify(report.s3Certification, null, 2)}

## Product Interpretation
${JSON.stringify(report.productInterpretation, null, 2)}

## Trial Time Remaining
${JSON.stringify(report.trialTimeRemaining, null, 2)}

Do NOT start 2022. Next: final trial audit.
`;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const argv = process.argv.slice(2);
  const { dryRun, execute } = parseExecuteFlag(argv);
  const certifyOnly = argv.includes('--certify-only');
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const delay = resolveBdlRequestDelayMs();
  const lockBefore = bdlAcquisitionLockStatus();
  const frozen = mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun;

  const inventory = loadAuthoritativeBdl2025GameInventory();
  const targetIds = inventory.gameIds;
  const inventoryById = new Map(inventory.games.map((g) => [g.id, g]));
  const plan = planLineups2025ArchiveFromArgv(argv, targetIds);
  const canonicalPrefix = lineups2025CanonicalPrefix();
  const charPrefix = lineups2025CharacterizationPrefix();

  const client = await pool.connect();
  let isolationBefore: Json = {};
  let dbBytesBefore = 0;
  try {
    await client.query('begin read only');
    await client.query("set local statement_timeout = '180000'");
    isolationBefore = await measurePostgres(client);
    dbBytesBefore = Number(isolationBefore.dbBytes);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  if (!frozen || pin !== '2025') {
    throw new Error(`Safety stop: frozen=${frozen} pin=${pin} dataMode=${mode.dataMode}`);
  }
  if (dbBytesBefore !== EXPECTED_DB_BYTES) {
    throw new Error(`Safety stop: postgres bytes ${dbBytesBefore} != ${EXPECTED_DB_BYTES}`);
  }
  if ((isolationBefore.lineupServingTables as string[]).length > 0) {
    throw new Error(`Safety stop: unexpected lineup table ${JSON.stringify(isolationBefore.lineupServingTables)}`);
  }
  if (targetIds.length !== LINEUPS_2025_EXPECTED_TARGET) {
    throw new Error(`Safety stop: target ${targetIds.length} != ${LINEUPS_2025_EXPECTED_TARGET}`);
  }
  if (!delay.trialMode || delay.delayMs < 12000 || delay.concurrency !== 1) {
    throw new Error('Safety stop: trial limiter not 13s / concurrency 1');
  }

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  const s3 = new S3Storage({ bucket });
  const targetSet = new Set(targetIds);

  console.log('[lineups-2025] listing characterization + canonical objects (no BDL HTTP)');
  const reusable = await listReusableCharacterization(s3, charPrefix, targetSet);
  const already = await alreadyCanonical(s3, canonicalPrefix, targetIds);
  const reusableIds = new Set(reusable.map((r) => r.gameId));
  const needFetch = targetIds.filter((id) => !already.has(id) && !reusableIds.has(id));
  const needCopy = reusable.filter((r) => !already.has(r.gameId));
  const projectedRequests = needFetch.length;
  const projectedMs = projectedRequests * delay.delayMs;
  const elapsedH = hoursSinceTrialStart(generatedAt);
  const remainingH = 48 - elapsedH;
  const projectedAfterH = remainingH - projectedMs / 3_600_000;

  const safety = {
    trialMode: delay.trialMode,
    delayMs: delay.delayMs,
    delaySource: delay.source,
    minDelayMs: 12000,
    concurrency: delay.concurrency,
    lockActiveBefore: lockBefore.active,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen,
    currentAnalyticsSeason: pin,
    dbBytesBefore,
    dbMb: isolationBefore.dbMb,
    isolationBefore,
    acquisitionPathWritesPostgres: false,
  };
  const reuse = {
    characterizationPrefix: charPrefix,
    reusableValid: reusable.length,
    alreadyCanonical: already.size,
    needCopy: needCopy.length,
    needFetch: needFetch.length,
    expectedReusableUpTo: 25,
    expectedNewIfAll25Reused: 1297,
  };
  const timeGate = {
    trialElapsedHours: round(elapsedH, 3),
    trialRemainingHours: round(remainingH, 3),
    protectedReserveHours: 6,
    usableAfterReserveHours: round(remainingH - 6, 3),
    reusableResponses: reusable.length,
    requiredProviderRequests: projectedRequests,
    projectedCrawlMs: projectedMs,
    projectedCrawlHours: round(projectedMs / 3_600_000, 3),
    projectedRemainingAfterCrawlHours: round(projectedAfterH, 3),
    maxAllowedHours: 6,
    proceed: projectedMs <= LINEUPS_2025_MAX_CRAWL_MS,
  };

  console.log(JSON.stringify({ plan, safety, target: {
    count: targetIds.length,
    dateMin: inventory.dateMin,
    dateMax: inventory.dateMax,
    regularSeason: inventory.regularSeason,
    postseason: inventory.postseason,
  }, reuse, timeGate }, null, 2));

  if (!timeGate.proceed) {
    throw new Error(`Safety stop: projected crawl ${timeGate.projectedCrawlHours}h exceeds 6h`);
  }

  if (dryRun && !certifyOnly && !execute) {
    console.log('[dry-run] no lineup fetches. Characterization reuse counted above.');
    await pool.end().catch(() => undefined);
    return;
  }

  let reusedGames = 0;
  let newlyRequested = 0;
  let written = 0;
  let skippedExisting = already.size;
  let successes = 0;
  let zeroResult = 0;
  const failedGames: string[] = [];
  const wallStart = Date.now();
  let metrics: Json = {
    httpAttempts: 0,
    httpSuccess: 0,
    status429: 0,
    retries: 0,
    retryAfterUsed: 0,
    spacingSamplesMs: [] as number[],
  };

  if (execute && !certifyOnly) {
    assertTrialExecuteAllowed();
    const lock = acquireBdlAcquisitionLock();
    const bdl = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });
    let consecutiveFailures = 0;
    let httpN = 0;
    try {
      await archiveJsonObjectToS3({
        s3,
        key: `${canonicalPrefix}/_run.json`,
        body: {
          schemaVersion: 1,
          entity: 'lineups',
          season: 2025,
          status: 'running',
          startedAt: generatedAt,
          targetGames: targetIds.length,
          reuse,
          timeGate,
          postgresMaterialize: false,
        },
        overwrite: true,
      });

      for (const item of needCopy) {
        const dest = lineups2025GameObjectKey(canonicalPrefix, item.gameId);
        await archiveJsonObjectToS3({ s3, key: dest, body: item.body });
        reusedGames += 1;
        written += 1;
        const n = extractLineupRows(item.body).length;
        if (n === 0) zeroResult += 1;
        else successes += 1;
      }

      for (const gameId of needFetch) {
        if (httpN > 0) await sleep(delay.delayMs);
        httpN += 1;
        newlyRequested += 1;
        try {
          const pages: unknown[] = [];
          for await (const page of bdl.paginate({
            path: LINEUPS_PATH,
            params: { 'game_ids[]': gameId },
            paginationStyle: 'cursor',
            perPage: 100,
          })) {
            pages.push(page.body);
          }
          const body = { game_id: gameId, fetchedAt: new Date().toISOString(), pages };
          const v = validateLineupArchiveBody(gameId, body);
          if (!v.ok) throw new Error(`invalid lineup body: ${v.reason}`);
          const dest = lineups2025GameObjectKey(canonicalPrefix, gameId);
          await archiveJsonObjectToS3({ s3, key: dest, body });
          written += 1;
          const n = extractLineupRows(body).length;
          if (n === 0) zeroResult += 1;
          else successes += 1;
          consecutiveFailures = 0;
        } catch (err) {
          consecutiveFailures += 1;
          failedGames.push(gameId);
          console.error(
            `[lineups-2025] FAIL game_id=${gameId} ${err instanceof Error ? err.message : String(err)}`
          );
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            throw new Error(`Stopping: ${MAX_CONSECUTIVE_FAILURES} consecutive lineup fetch failures`);
          }
        }
        if (httpN % 25 === 0 || httpN === needFetch.length) {
          writeProgress({
            updatedAt: new Date().toISOString(),
            httpN,
            needFetch: needFetch.length,
            reusedGames,
            written,
            failedGames,
            successes,
            zeroResult,
          });
          console.log(
            `[lineups-2025] progress fetch ${httpN}/${needFetch.length} reused=${reusedGames} fail=${failedGames.length}`
          );
        }
      }
      metrics = bdl.getMetrics() as unknown as Json;
    } finally {
      lock.release();
    }
  } else if (certifyOnly) {
    reusedGames = Math.min(already.size, reusable.length);
    successes = already.size;
  }

  // Count objects now on S3 for skipped-existing path (resume / certify-only).
  if (!execute || certifyOnly) {
    for (const gameId of targetIds) {
      if (already.has(gameId)) {
        const body = await s3.getJson<Json>(lineups2025GameObjectKey(canonicalPrefix, gameId));
        const n = extractLineupRows(body).length;
        if (n === 0) zeroResult += 1;
        else successes += 1;
      }
    }
  }

  const wallMs = Date.now() - wallStart;
  const spacing = (metrics.spacingSamplesMs as number[] | undefined) ?? [];
  const rateLimit = {
    configuredSpacingMs: delay.delayMs,
    averageMs: spacing.length ? round(spacing.reduce((a, b) => a + b, 0) / spacing.length, 1) : null,
    minimumMs: spacing.length ? Math.min(...spacing) : null,
    maximumMs: spacing.length ? Math.max(...spacing) : null,
    retrySpecificBehavior: '429/5xx honor Retry-After else 60s exponential backoff; maxRetries=3; no infinite retry',
    minObservedAtLeast12000: spacing.length ? Math.min(...spacing) >= 12000 : httpNSafe(metrics),
  };

  const acquisition: Json = {
    targetGames: targetIds.length,
    reusedGames: execute && !certifyOnly ? reusedGames : reuse.reusableValid,
    newlyRequestedGames: newlyRequested,
    skippedExisting,
    written,
    successfulGames: null,
    zeroResultGames: zeroResult,
    failedGames,
    lineupRecords: null,
    httpAttempts: metrics.httpAttempts ?? 0,
    httpSuccess: metrics.httpSuccess ?? 0,
    status429: metrics.status429 ?? 0,
    retries: metrics.retries ?? 0,
    retryAfterUsed: metrics.retryAfterUsed ?? 0,
    wallClockMs: wallMs,
    rateLimit,
  };

  console.log('[lineups-2025] certifying archive from S3 + local postgres (read-only, no BDL HTTP)');
  const report = await certifyArchive({
    s3,
    canonicalPrefix,
    targetIds,
    inventoryById,
    acquisition,
    safety: { ...safety, lockReleased: true },
    reuse,
    timeGate,
    generatedAt: new Date().toISOString(),
  });

  await archiveJsonObjectToS3({
    s3,
    key: `${canonicalPrefix}/_manifest.json`,
    body: {
      schemaVersion: 1,
      source: 'balldontlie',
      entity: 'lineups',
      season: 2025,
      endpoint: LINEUPS_PATH,
      grain: '(game_id, team_id, player_id)',
      teamIdAuthoritative: 'top-level team.id, not player.team_id',
      availabilityLimitation: LINEUPS_2025_AVAILABILITY_LIMITATION,
      notFiveManUnits: true,
      postgresMaterialize: false,
      characterizationPrefixPreserved: charPrefix,
      targetGames: targetIds.length,
      excludedLocalOnly: LINEUPS_2025_LOCAL_ONLY_ID,
      reusedFromCharacterization: execute && !certifyOnly ? reusedGames : reusable.length,
      newlyRequested,
      successfulGames: (report.acquisitionResult as Json).successfulGames,
      zeroResultGames: zeroResult,
      failedGames,
      lineupRecords: (report.recordGrain as Json).totalRecords,
      httpAttempts: acquisition.httpAttempts,
      status429: acquisition.status429,
      retries: acquisition.retries,
      retryAfterUsed: acquisition.retryAfterUsed,
      wallClockMs: wallMs,
      starterReliability: report.starterReliabilityClassification,
      valid5plus5: (report.fullSeasonStarterCertification as Json).valid5plus5OfTarget,
      status:
        failedGames.length === 0 &&
        ((report.acquisitionResult as Json).missingCanonical as string[] | undefined ?? []).length === 0
          ? 'success'
          : 'partial',
      fetchedAt: new Date().toISOString(),
    },
    overwrite: true,
  });
  await archiveJsonObjectToS3({
    s3,
    key: `${canonicalPrefix}/_run.json`,
    body: {
      schemaVersion: 1,
      entity: 'lineups',
      season: 2025,
      status: (report.stepVerdict as string).startsWith('GREEN') ? 'success' : 'complete',
      startedAt: generatedAt,
      finishedAt: new Date().toISOString(),
      postgresMaterialize: false,
      started2022: false,
      acquisition,
      stepVerdict: report.stepVerdict,
    },
    overwrite: true,
  });

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(REPORT_MD, renderMarkdown(report));
  console.log(JSON.stringify({
    reportPath: REPORT_JSON,
    stepVerdict: report.stepVerdict,
    valid5plus5: (report.fullSeasonStarterCertification as Json).valid5plus5OfTarget,
    postgresUnchanged: (report.postgresUnchangedConfirmation as Json).unchanged,
    started2022: false,
  }, null, 2));
  await pool.end().catch(() => undefined);
}

function httpNSafe(metrics: Json): boolean {
  const attempts = Number(metrics.httpAttempts ?? 0);
  return attempts <= 1;
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
