/**
 * Trial scoped Postgres materialize from validated S3 `/v1/stats` archives.
 * Default: the 3 proof games. `--remaining-31`: the other 31 manifest IDs only.
 * Never refetches BALLDONTLIE. Never touches 18447793/21707973/21716138 in remaining-31 mode.
 * Never touches 21681993. No unscoped transforms.
 *
 *   npx tsx scripts/ingestion/materialize-goat-stats-3game-postgres.ts --dry-run
 *   npx tsx scripts/ingestion/materialize-goat-stats-3game-postgres.ts --execute --i-understand-production-write
 *   npx tsx scripts/ingestion/materialize-goat-stats-remaining-31-postgres.ts --dry-run
 *   npx tsx scripts/ingestion/materialize-goat-stats-remaining-31-postgres.ts --execute --i-understand-production-write
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { parseExecuteFlag, rawEntityPrefix } from '@/lib/archive/trial-archive-plan';
import {
  DO_NOT_TOUCH_LOCAL_ONLY_ID,
  GOAT_STATS_REPAIR_IDS,
} from '@/lib/ingestion/goat-stats-repair-queue';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';
import pool from '@/lib/db';

export const MATERIALIZE_3GAME_IDS = ['18447793', '21707973', '21716138'] as const;
export const REMAINING_31_MATERIALIZE_IDS = [
  '21708674',
  '21708301',
  '21709223',
  '21707974',
  '21708677',
  '21708303',
  '21709227',
  '21707975',
  '21708680',
  '21708305',
  '21709231',
  '21707976',
  '21709235',
  '21707977',
  '21709238',
  '21709241',
  '21713528',
  '21713895',
  '21713529',
  '21713897',
  '21713530',
  '21713899',
  '21713531',
  '21713901',
  '21713532',
  '21713533',
  '21713534',
  '21716134',
  '21716135',
  '21716136',
  '21716137',
] as const;
const DONE_IDS = new Set(MATERIALIZE_3GAME_IDS.map(String));
const REPLACE_ID = '18447793';
const CACHE_PATH = 'reports/trial/bdl-games-2025.json';
const SEASON = '2025';
const SEASON_NUM = 2025;

type CachedGame = {
  id: number;
  date?: string | null;
  datetime?: string | null;
  season?: number | null;
  status?: string | null;
  period?: number | null;
  time?: string | null;
  period_detail?: string | null;
  postseason?: boolean | null;
  home_team_score?: number | null;
  visitor_team_score?: number | null;
  home_team?: Record<string, unknown> | null;
  visitor_team?: Record<string, unknown> | null;
};

type StatRow = {
  id?: number | null;
  min?: string | number | null;
  fgm?: number | null;
  fga?: number | null;
  fg_pct?: number | null;
  fg3m?: number | null;
  fg3a?: number | null;
  fg3_pct?: number | null;
  ftm?: number | null;
  fta?: number | null;
  ft_pct?: number | null;
  oreb?: number | null;
  dreb?: number | null;
  reb?: number | null;
  ast?: number | null;
  stl?: number | null;
  blk?: number | null;
  turnover?: number | null;
  pf?: number | null;
  pts?: number | null;
  plus_minus?: number | string | null;
  player?: Record<string, unknown> | null;
  team?: Record<string, unknown> | null;
  game?: Record<string, unknown> | null;
};

type ArchiveDoc = {
  game_id?: string | number;
  season?: number;
  endpoint?: string;
  pages?: Array<{ data?: unknown[] }>;
};

function sid(v: unknown): string {
  return v == null ? '' : String(v);
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseInt(v.replace(/^\+/, ''), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function loadCachedGame(id: string): CachedGame | null {
  const doc = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as { games: CachedGame[] };
  return doc.games.find((g) => String(g.id) === id) ?? null;
}

function loadCachedFinalGames(): CachedGame[] {
  const doc = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as { games: CachedGame[] };
  return doc.games.filter((g) => /final/i.test(String(g.status ?? '')));
}

function loadCachedFinalIds(): string[] {
  return loadCachedFinalGames().map((g) => String(g.id));
}

function flattenRows(doc: ArchiveDoc): StatRow[] {
  return (doc.pages ?? []).flatMap((p) => (Array.isArray(p.data) ? (p.data as StatRow[]) : []));
}

function validateBox(args: {
  gameId: string;
  rows: StatRow[];
  official: CachedGame;
  replaceIncomplete: boolean;
}) {
  const homeId = sid(args.official.home_team?.id);
  const awayId = sid(args.official.visitor_team?.id);
  const officialHome = Number(args.official.home_team_score);
  const officialAway = Number(args.official.visitor_team_score);
  const pairCounts = new Map<string, number>();
  const playerIds = new Set<string>();
  let homePts = 0;
  let awayPts = 0;
  let homeN = 0;
  let awayN = 0;
  let unexpectedTeamCount = 0;
  let identityIssues = 0;
  const missingStatIds: number[] = [];

  for (const row of args.rows) {
    const pid = row.player?.id == null ? '' : sid(row.player.id);
    const tid = row.team?.id == null ? '' : sid(row.team.id);
    const gid = row.game?.id == null ? '' : sid(row.game.id);
    if (row.id == null) missingStatIds.push(-1);
    if (!pid || !tid || gid !== args.gameId) identityIssues += 1;
    if (pid) {
      playerIds.add(pid);
      pairCounts.set(pid, (pairCounts.get(pid) ?? 0) + 1);
    }
    const pts = typeof row.pts === 'number' ? row.pts : 0;
    if (tid === homeId) {
      homePts += pts;
      homeN += 1;
    } else if (tid === awayId) {
      awayPts += pts;
      awayN += 1;
    } else if (tid) unexpectedTeamCount += 1;
  }
  const duplicateCount = [...pairCounts.values()].filter((n) => n > 1).length;
  const scoreOk = homePts === officialHome && awayPts === officialAway;
  let classification = 'OTHER';
  if (args.rows.length === 0) classification = 'NO_STATS_RETURNED';
  else if (identityIssues > 0 || missingStatIds.length > 0) classification = 'IDENTITY_ISSUE';
  else if (duplicateCount > 0) classification = 'DUPLICATE_PLAYER';
  else if (homeN === 0 || awayN === 0) classification = 'ONE_TEAM_MISSING';
  else if (!scoreOk) classification = 'SCORE_RECONCILIATION_SUSPECT';
  else if (args.replaceIncomplete) classification = 'READY_TO_REPLACE_INCOMPLETE_LOCAL_BOX';
  else classification = 'READY_TO_MATERIALIZE';
  return {
    gameId: args.gameId,
    records: args.rows.length,
    distinctPlayers: playerIds.size,
    homeN,
    awayN,
    summed: { home: homePts, away: awayPts },
    official: { home: officialHome, away: officialAway },
    scoreOk,
    duplicateCount,
    unexpectedTeamCount,
    identityIssues,
    classification,
  };
}

const UPSERT_RAW_STAT = `
  insert into raw.player_game_stats (
    id, min, fgm, fga, fg_pct, fg3m, fg3a, fg3_pct, ftm, fta, ft_pct,
    oreb, dreb, reb, ast, stl, blk, turnover, pf, pts, plus_minus,
    player_id, team_id, game_id, player, team, game
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25::jsonb, $26::jsonb, $27::jsonb)
  on conflict (id) do update set
    min = excluded.min, fgm = excluded.fgm, fga = excluded.fga, fg_pct = excluded.fg_pct,
    fg3m = excluded.fg3m, fg3a = excluded.fg3a, fg3_pct = excluded.fg3_pct,
    ftm = excluded.ftm, fta = excluded.fta, ft_pct = excluded.ft_pct,
    oreb = excluded.oreb, dreb = excluded.dreb, reb = excluded.reb,
    ast = excluded.ast, stl = excluded.stl, blk = excluded.blk,
    turnover = excluded.turnover, pf = excluded.pf, pts = excluded.pts, plus_minus = excluded.plus_minus,
    player_id = excluded.player_id, team_id = excluded.team_id, game_id = excluded.game_id,
    player = excluded.player, team = excluded.team, game = excluded.game
`;

const UPSERT_RAW_GAME = `
  insert into raw.games (id, date, season, status, period, time, period_detail, datetime, postseason, home_team_score, visitor_team_score, home_team, visitor_team)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
  on conflict (id) do update set
    date = excluded.date, season = excluded.season, status = excluded.status,
    period = excluded.period, time = excluded.time, period_detail = excluded.period_detail,
    datetime = excluded.datetime, postseason = excluded.postseason,
    home_team_score = excluded.home_team_score, visitor_team_score = excluded.visitor_team_score,
    home_team = excluded.home_team, visitor_team = excluded.visitor_team
`;

const UPSERT_RAW_PLAYER = `
  insert into raw.players (id, first_name, last_name, position, height, weight, jersey_number, college, country, draft_year, draft_round, draft_number, team_id)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  on conflict (id) do update set
    first_name = excluded.first_name, last_name = excluded.last_name, position = excluded.position,
    height = excluded.height, weight = excluded.weight, jersey_number = excluded.jersey_number,
    college = excluded.college, country = excluded.country, draft_year = excluded.draft_year,
    draft_round = excluded.draft_round, draft_number = excluded.draft_number, team_id = excluded.team_id
`;

const UPSERT_ANALYTICS_PLAYER = `
  insert into analytics.players (player_id, full_name, first_name, last_name, position, height, weight)
  values ($1, $2, $3, $4, $5, $6, $7)
  on conflict (player_id) do update set
    full_name = excluded.full_name, first_name = excluded.first_name, last_name = excluded.last_name,
    position = excluded.position, height = excluded.height, weight = excluded.weight, updated_at = now()
`;

const UPSERT_LOG = `
  insert into analytics.player_game_logs (
    game_id, player_id, team_id,
    minutes, points, rebounds, offensive_rebounds, defensive_rebounds,
    assists, steals, blocks, turnovers, personal_fouls,
    field_goals_made, field_goals_attempted,
    three_pointers_made, three_pointers_attempted,
    free_throws_made, free_throws_attempted,
    plus_minus, opponent_team_id, is_home, game_date, season, pra
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
  on conflict (game_id, player_id) do update set
    team_id = excluded.team_id, minutes = excluded.minutes, points = excluded.points,
    rebounds = excluded.rebounds, offensive_rebounds = excluded.offensive_rebounds,
    defensive_rebounds = excluded.defensive_rebounds, assists = excluded.assists,
    steals = excluded.steals, blocks = excluded.blocks, turnovers = excluded.turnovers,
    personal_fouls = excluded.personal_fouls, field_goals_made = excluded.field_goals_made,
    field_goals_attempted = excluded.field_goals_attempted,
    three_pointers_made = excluded.three_pointers_made,
    three_pointers_attempted = excluded.three_pointers_attempted,
    free_throws_made = excluded.free_throws_made,
    free_throws_attempted = excluded.free_throws_attempted,
    plus_minus = excluded.plus_minus, opponent_team_id = excluded.opponent_team_id,
    is_home = excluded.is_home, game_date = excluded.game_date, season = excluded.season,
    pra = excluded.pra, updated_at = now()
  where analytics.player_game_logs.season = excluded.season
`;

const UPSERT_PLAYER_AVG = `
  insert into analytics.player_season_averages (
    player_id, season, games_played,
    pts_avg, reb_avg, ast_avg, stl_avg, blk_avg, turnover_avg, pra_avg,
    fg_pct, fg3_pct, ft_pct
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  on conflict (player_id, season) do update set
    games_played = excluded.games_played, pts_avg = excluded.pts_avg, reb_avg = excluded.reb_avg,
    ast_avg = excluded.ast_avg, stl_avg = excluded.stl_avg, blk_avg = excluded.blk_avg,
    turnover_avg = excluded.turnover_avg, pra_avg = excluded.pra_avg,
    fg_pct = excluded.fg_pct, fg3_pct = excluded.fg3_pct, ft_pct = excluded.ft_pct, updated_at = now()
`;

async function snapshotIsolation(client: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, string>> }>;
}) {
  const res = await client.query(
    `select
       (select count(*)::text from analytics.games where season = '2026') as games_2026,
       (select count(*)::text from analytics.player_game_logs where season = '2026') as logs_2026,
       (select count(*)::text from analytics.team_game_stats where season = '2026') as tgs_2026,
       (select count(*)::text from analytics.player_season_averages where season = '2026') as pav_2026,
       (select count(*)::text from analytics.team_season_averages where season = '2026') as tav_2026,
       (select count(*)::text from analytics.player_team_stints where season = '2026') as stints_2026,
       (select count(*)::text from analytics.player_game_logs where season in ('2024','2023')) as hist_logs,
       (select count(*)::text from analytics.team_game_stats where season in ('2024','2023')) as hist_tgs,
       pg_database_size(current_database())::text as db_bytes`
  );
  return res.rows[0]!;
}

async function gameLayerCounts(
  client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  gameId: string
) {
  const raw = await client.query(
    `select count(*)::int as n, count(distinct player_id)::int as players,
            count(*) filter (where team_id is null or player_id is null)::int as missing_ids
     from raw.player_game_stats where game_id = $1`,
    [Number(gameId)]
  );
  const logs = await client.query(
    `select count(*)::int as n, count(distinct l.player_id)::int as players,
            count(distinct l.player_id)::int as unique_keys,
            count(distinct l.team_id)::int as teams,
            coalesce(sum(l.points) filter (where l.team_id = g.home_team_id), 0)::int as home_pts,
            coalesce(sum(l.points) filter (where l.team_id = g.away_team_id), 0)::int as away_pts,
            count(*) filter (where l.season <> '2025')::int as other_season
     from analytics.player_game_logs l
     join analytics.games g on g.game_id = l.game_id
     where l.game_id = $1
     group by g.home_team_id, g.away_team_id`,
    [gameId]
  );
  const tgs = await client.query(
    `select count(*)::int as n, array_agg(team_id order by team_id) as team_ids,
            count(*) filter (where season <> '2025')::int as other_season
     from analytics.team_game_stats where game_id = $1`,
    [gameId]
  );
  const dups = await client.query(
    `select count(*)::int as n from (
       select player_id from analytics.player_game_logs where game_id = $1
       group by player_id having count(*) > 1
     ) d`,
    [gameId]
  );
  return {
    rawRows: Number(raw.rows[0]?.n ?? 0),
    rawPlayers: Number(raw.rows[0]?.players ?? 0),
    logRows: Number(logs.rows[0]?.n ?? 0),
    logPlayers: Number(logs.rows[0]?.players ?? 0),
    uniqueKeys: Number(logs.rows[0]?.unique_keys ?? 0),
    logTeams: Number(logs.rows[0]?.teams ?? 0),
    homePts: Number(logs.rows[0]?.home_pts ?? 0),
    awayPts: Number(logs.rows[0]?.away_pts ?? 0),
    logOtherSeason: Number(logs.rows[0]?.other_season ?? 0),
    teamRows: Number(tgs.rows[0]?.n ?? 0),
    teamIds: (tgs.rows[0]?.team_ids as string[] | null) ?? [],
    teamOtherSeason: Number(tgs.rows[0]?.other_season ?? 0),
    duplicatePlayers: Number(dups.rows[0]?.n ?? 0),
  };
}

async function auditProviderFinals(
  client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  finals: CachedGame[]
) {
  const ids = finals.map((g) => String(g.id));
  const intIds = finals.map((g) => g.id);
  const officialById = new Map(finals.map((g) => [String(g.id), g]));
  const raw = await client.query(
    `select game_id::text as game_id, count(*)::int as n from raw.player_game_stats where game_id = any($1::int[]) group by 1`,
    [intIds]
  );
  const logs = await client.query(
    `select l.game_id,
            count(*)::int as n,
            count(distinct l.player_id)::int as players,
            count(*) filter (where l.team_id is null or l.player_id is null)::int as missing_ids,
            count(*) filter (where l.team_id not in (g.home_team_id, g.away_team_id))::int as foreign_teams,
            coalesce(sum(l.points) filter (where l.team_id = g.home_team_id), 0)::int as home_pts,
            coalesce(sum(l.points) filter (where l.team_id = g.away_team_id), 0)::int as away_pts
     from analytics.player_game_logs l
     join analytics.games g on g.game_id = l.game_id
     where l.season = '2025' and l.game_id = any($1::text[])
     group by l.game_id`,
    [ids]
  );
  const dups = await client.query(
    `select game_id, player_id, count(*)::int as n
     from analytics.player_game_logs
     where season = '2025' and game_id = any($1::text[])
     group by game_id, player_id having count(*) > 1`,
    [ids]
  );
  const tgs = await client.query(
    `select game_id, count(*)::int as n, array_agg(team_id order by team_id) as teams
     from analytics.team_game_stats
     where season = '2025' and game_id = any($1::text[])
     group by game_id`,
    [ids]
  );
  const games = await client.query(
    `select game_id from analytics.games where season = '2025' and game_id = any($1::text[])`,
    [ids]
  );
  const rawBy = new Map(raw.rows.map((r) => [String(r.game_id), Number(r.n)]));
  const logBy = new Map(logs.rows.map((r) => [String(r.game_id), r]));
  const tgsBy = new Map(tgs.rows.map((r) => [String(r.game_id), r]));
  const localGames = new Set(games.rows.map((r) => String(r.game_id)));
  const missingRaw: string[] = [];
  const missingLogs: string[] = [];
  const missingTeam: string[] = [];
  const missingAnalyticsGame: string[] = [];
  const scoreFailures: Array<Record<string, unknown>> = [];
  const teamMismatches: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const off = officialById.get(id)!;
    if (!localGames.has(id) && id !== String(DO_NOT_TOUCH_LOCAL_ONLY_ID)) missingAnalyticsGame.push(id);
    if ((rawBy.get(id) ?? 0) === 0) missingRaw.push(id);
    const log = logBy.get(id);
    if (!log) missingLogs.push(id);
    const team = tgsBy.get(id);
    if (!team || Number(team.n) !== 2) missingTeam.push(id);
    if (log) {
      const officialHome = Number(off.home_team_score);
      const officialAway = Number(off.visitor_team_score);
      if (Number(log.home_pts) !== officialHome || Number(log.away_pts) !== officialAway) {
        scoreFailures.push({
          gameId: id,
          summed: { home: log.home_pts, away: log.away_pts },
          official: { home: officialHome, away: officialAway },
        });
      }
      if (Number(log.foreign_teams) > 0) {
        teamMismatches.push({ gameId: id, foreignTeams: log.foreign_teams });
      }
    }
  }
  return {
    providerFinals: ids.length,
    missingAnalyticsGame,
    missingRawStats: missingRaw,
    missingAnalyticsLogs: missingLogs,
    missingTeamStats: missingTeam,
    scoreReconciliationFailures: scoreFailures,
    duplicatePlayerGameRows: dups.rows,
    teamIdentityMismatches: teamMismatches,
    completeLogGames: ids.length - missingLogs.length,
    completeTeamStatGames: ids.length - missingTeam.length,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const { execute } = parseExecuteFlag(argv);
  const confirm = argv.includes('--i-understand-production-write');
  const remaining31 = argv.includes('--remaining-31');
  const extra = argv.filter((a) => a.startsWith('--game'));
  if (extra.length > 0) {
    console.error('[fatal] this materialize uses a frozen ID allowlist; do not pass --game flags');
    process.exit(1);
  }

  const fromCode = GOAT_STATS_REPAIR_IDS.map(String).filter((id) => !DONE_IDS.has(id));
  if (remaining31) {
    console.log(`total manifest GOAT IDs = ${GOAT_STATS_REPAIR_IDS.length}`);
    console.log(`already materialized = ${DONE_IDS.size}`);
    console.log(`remaining = ${REMAINING_31_MATERIALIZE_IDS.length}`);
    const sameSet =
      REMAINING_31_MATERIALIZE_IDS.length === 31 &&
      REMAINING_31_MATERIALIZE_IDS.length === fromCode.length &&
      REMAINING_31_MATERIALIZE_IDS.every((id) => fromCode.includes(id)) &&
      !REMAINING_31_MATERIALIZE_IDS.some((id) => DONE_IDS.has(id)) &&
      !REMAINING_31_MATERIALIZE_IDS.includes(String(DO_NOT_TOUCH_LOCAL_ONLY_ID));
    if (!sameSet) {
      console.error('[fatal] remaining queue math did not resolve exactly to 31; STOP');
      process.exit(2);
    }
  }
  const batchIds: string[] = remaining31
    ? [...REMAINING_31_MATERIALIZE_IDS]
    : [...MATERIALIZE_3GAME_IDS];
  const outPath = remaining31
    ? 'reports/trial/2025-goat-stats-remaining-31-materialize.json'
    : 'reports/trial/2025-goat-stats-3game-materialize.json';

  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const lockStatus = bdlAcquisitionLockStatus();
  const unsafe: string[] = [];
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== SEASON) unsafe.push(`season pin ${pin}`);
  if (lockStatus.active) unsafe.push(`BDL acquisition lock busy pid=${lockStatus.pid}`);
  if (!process.env.NBA_DATA_BUCKET?.trim()) unsafe.push('NBA_DATA_BUCKET missing');
  if (execute && !confirm) unsafe.push('missing --i-understand-production-write');
  if (remaining31 && batchIds.some((id) => DONE_IDS.has(id))) {
    unsafe.push('remaining-31 queue includes already-repaired IDs');
  }
  if (batchIds.includes(String(DO_NOT_TOUCH_LOCAL_ONLY_ID))) {
    unsafe.push('queue includes do-not-touch 21681993');
  }

  const prefix = rawEntityPrefix(process.env.NBA_RAW_PREFIX ?? 'raw', SEASON_NUM, 'player_stats');
  const safety = {
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    currentAnalyticsSeason: pin,
    bdlLockActive: lockStatus.active,
    bdlHttpRequests: 0,
    trialLimiterConsumed: false,
    remaining31Mode: remaining31,
    batch: batchIds,
  };
  if (unsafe.length) {
    const report = { generatedAt: new Date().toISOString(), safety, unsafe, stopped: true };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const s3 = new S3Storage({ bucket: process.env.NBA_DATA_BUCKET!.trim() });
  const boxes: Array<{ gameId: string; key: string; rows: StatRow[]; validation: ReturnType<typeof validateBox> }> =
    [];
  const excluded: Array<Record<string, unknown>> = [];
  for (const gameId of batchIds) {
    const official = loadCachedGame(gameId);
    const key = `${prefix}/game_id=${gameId}.json`;
    if (!official) {
      const item = { gameId, key, reason: 'missing from cached BDL games' };
      if (!remaining31) {
        console.error(`[fatal] ${gameId} missing from cached BDL games`);
        process.exit(2);
      }
      excluded.push(item);
      continue;
    }
    const doc = await s3.getJson<ArchiveDoc>(key);
    if (!doc) {
      const item = { gameId, key, reason: 'missing S3 archive' };
      if (!remaining31) {
        console.error(`[fatal] missing S3 object ${key}`);
        process.exit(2);
      }
      excluded.push(item);
      continue;
    }
    if (sid(doc.game_id) !== gameId || Number(doc.season) !== SEASON_NUM) {
      const item = { gameId, key, reason: 'S3 season/game mismatch' };
      if (!remaining31) {
        console.error(`[fatal] S3 object season/game mismatch for ${gameId}`);
        process.exit(2);
      }
      excluded.push(item);
      continue;
    }
    const rows = flattenRows(doc);
    const validation = validateBox({
      gameId,
      rows,
      official,
      replaceIncomplete: gameId === REPLACE_ID,
    });
    const expected =
      gameId === REPLACE_ID ? 'READY_TO_REPLACE_INCOMPLETE_LOCAL_BOX' : 'READY_TO_MATERIALIZE';
    if (validation.classification !== expected) {
      const item = { gameId, key, reason: `classification ${validation.classification}`, validation };
      if (!remaining31) {
        console.error(`[fatal] ${gameId} S3 validation ${validation.classification} !== ${expected}`);
        process.exit(2);
      }
      excluded.push(item);
      continue;
    }
    boxes.push({ gameId, key, rows, validation });
  }
  if (remaining31 && boxes.length === 0) {
    console.error('[fatal] remaining-31 revalidation produced zero writable games; STOP');
    process.exit(2);
  }
  const writeIds = boxes.map((b) => b.gameId);

  const client = await pool.connect();
  let isolationBefore;
  let isolationAfter;
  const beforeByGame: Record<string, unknown> = {};
  const afterByGame: Record<string, unknown> = {};
  let stintsBefore: unknown = null;
  let stintsAfter: unknown = null;
  let stintDecision: Record<string, unknown> = {};
  let averages: Record<string, unknown> = {};
  let completeness: Record<string, unknown> = {};
  try {
    isolationBefore = await snapshotIsolation(client);
    const stintSrc = await client.query(
      `select season, source, count(*)::int as n from analytics.player_team_stints group by 1, 2 order by 1, 2`
    );
    stintsBefore = stintSrc.rows;
    if (
      isolationBefore.games_2026 !== '1200' ||
      isolationBefore.logs_2026 !== '0' ||
      isolationBefore.stints_2026 !== '578' ||
      isolationBefore.hist_logs !== '0' ||
      isolationBefore.hist_tgs !== '0'
    ) {
      throw new Error(
        `unexpected isolation baseline: 2026 games=${isolationBefore.games_2026} logs=${isolationBefore.logs_2026} stints=${isolationBefore.stints_2026} hist_logs=${isolationBefore.hist_logs}`
      );
    }
    const seasonGuard = await client.query(
      `select game_id, season from analytics.games where game_id = any($1::text[])`,
      [writeIds]
    );
    for (const row of seasonGuard.rows) {
      if (String(row.season) !== SEASON) {
        throw new Error(`refusing game ${row.game_id} season ${row.season}`);
      }
    }
    const localOnlyBefore = await client.query(
      `select count(*)::int as logs from analytics.player_game_logs where game_id = $1`,
      [String(DO_NOT_TOUCH_LOCAL_ONLY_ID)]
    );
    for (const gameId of writeIds) {
      beforeByGame[gameId] = await gameLayerCounts(client, gameId);
    }

    const affectedPlayers = new Set<string>();
    const affectedTeams = new Set<string>();
    const priorLogs = await client.query(
      `select player_id, team_id from analytics.player_game_logs where game_id = any($1::text[]) and season = $2`,
      [writeIds, SEASON]
    );
    for (const r of priorLogs.rows) {
      affectedPlayers.add(String(r.player_id));
      affectedTeams.add(String(r.team_id));
    }

    if (!execute) {
      const report = {
        generatedAt: new Date().toISOString(),
        dryRun: true,
        postgresMaterialize: false,
        bdlHttpRequests: 0,
        safety,
        queue: {
          requested: batchIds.length,
          writableAfterRevalidation: writeIds.length,
          excluded: excluded.length,
        },
        s3Validation: boxes.map((b) => ({ key: b.key, ...b.validation })),
        excluded,
        beforeByGame,
        isolationBefore,
        stintsBefore,
        doNotTouch21681993Logs: localOnlyBefore.rows[0]?.logs ?? 0,
      };
      mkdirSync('reports/trial', { recursive: true });
      writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    await client.query('begin');
    for (const box of boxes) {
      const official = loadCachedGame(box.gameId)!;
      const gameRow = await client.query(
        `select game_id, season, home_team_id, away_team_id,
                (start_time AT TIME ZONE 'America/New_York')::date::text as game_date
         from analytics.games where game_id = $1 and season = $2`,
        [box.gameId, SEASON]
      );
      const g = gameRow.rows[0];
      if (!g) throw new Error(`analytics.games missing ${box.gameId} season ${SEASON}`);
      const homeId = String(g.home_team_id);
      const awayId = String(g.away_team_id);
      affectedTeams.add(homeId);
      affectedTeams.add(awayId);

      const statIds = box.rows.map((r) => toInt(r.id)).filter((n): n is number => n != null);
      if (statIds.length !== box.rows.length) throw new Error(`${box.gameId} missing raw stat ids`);
      const collide = await client.query(
        `select id, game_id from raw.player_game_stats where id = any($1::int[]) and game_id <> $2`,
        [statIds, Number(box.gameId)]
      );
      if (collide.rows.length > 0) {
        throw new Error(`raw stat id collision for ${box.gameId}`);
      }

      await client.query(UPSERT_RAW_GAME, [
        Number(box.gameId),
        official.date ?? null,
        official.season ?? SEASON_NUM,
        official.status ?? null,
        official.period ?? null,
        official.time ?? null,
        official.period_detail ?? null,
        official.datetime ?? null,
        official.postseason ?? false,
        official.home_team_score ?? null,
        official.visitor_team_score ?? null,
        JSON.stringify(official.home_team ?? null),
        JSON.stringify(official.visitor_team ?? null),
      ]);

      await client.query(`delete from raw.player_game_stats where game_id = $1`, [Number(box.gameId)]);
      const leftoverLogs = await client.query(
        `select count(*)::int as n from analytics.player_game_logs where game_id = $1 and season <> $2`,
        [box.gameId, SEASON]
      );
      if (Number(leftoverLogs.rows[0]?.n ?? 0) > 0) {
        throw new Error(`cross-season logs exist for ${box.gameId}`);
      }
      await client.query(`delete from analytics.player_game_logs where game_id = $1 and season = $2`, [
        box.gameId,
        SEASON,
      ]);
      await client.query(`delete from analytics.team_game_stats where game_id = $1 and season = $2`, [
        box.gameId,
        SEASON,
      ]);

      for (const row of box.rows) {
        const player = row.player ?? {};
        const team = row.team ?? {};
        const playerId = toInt(player.id);
        const teamIdNum = toInt(team.id);
        const gameIdNum = toInt(row.game?.id);
        if (playerId == null || teamIdNum == null || gameIdNum !== Number(box.gameId)) {
          throw new Error(`identity failure writing ${box.gameId}`);
        }
        const teamId = sid(teamIdNum);
        if (teamId !== homeId && teamId !== awayId) {
          throw new Error(`foreign team ${teamId} on ${box.gameId}`);
        }
        affectedPlayers.add(sid(playerId));
        const first = sid(player.first_name).trim();
        const last = sid(player.last_name).trim();
        const full = `${first} ${last}`.trim() || sid(playerId);
        await client.query(UPSERT_RAW_PLAYER, [
          playerId,
          player.first_name ?? null,
          player.last_name ?? null,
          player.position ?? null,
          player.height ?? null,
          player.weight ?? null,
          player.jersey_number ?? null,
          player.college ?? null,
          player.country ?? null,
          player.draft_year ?? null,
          player.draft_round ?? null,
          player.draft_number ?? null,
          teamIdNum,
        ]);
        await client.query(UPSERT_ANALYTICS_PLAYER, [
          sid(playerId),
          full,
          player.first_name ?? null,
          player.last_name ?? null,
          player.position ?? null,
          player.height ?? null,
          player.weight ?? null,
        ]);
        await client.query(UPSERT_RAW_STAT, [
          toInt(row.id),
          row.min ?? null,
          row.fgm ?? null,
          row.fga ?? null,
          row.fg_pct ?? null,
          row.fg3m ?? null,
          row.fg3a ?? null,
          row.fg3_pct ?? null,
          row.ftm ?? null,
          row.fta ?? null,
          row.ft_pct ?? null,
          row.oreb ?? null,
          row.dreb ?? null,
          row.reb ?? null,
          row.ast ?? null,
          row.stl ?? null,
          row.blk ?? null,
          row.turnover ?? null,
          row.pf ?? null,
          row.pts ?? null,
          toInt(row.plus_minus),
          playerId,
          teamIdNum,
          gameIdNum,
          JSON.stringify(player),
          JSON.stringify(team),
          JSON.stringify(row.game ?? null),
        ]);
        const isHome = teamId === homeId;
        const opponent = isHome ? awayId : homeId;
        const pts = row.pts ?? 0;
        const reb = row.reb ?? 0;
        const ast = row.ast ?? 0;
        await client.query(UPSERT_LOG, [
          box.gameId,
          sid(playerId),
          teamId,
          row.min ?? null,
          row.pts ?? null,
          row.reb ?? null,
          row.oreb ?? null,
          row.dreb ?? null,
          row.ast ?? null,
          row.stl ?? null,
          row.blk ?? null,
          row.turnover ?? null,
          row.pf ?? null,
          row.fgm ?? null,
          row.fga ?? null,
          row.fg3m ?? null,
          row.fg3a ?? null,
          row.ftm ?? null,
          row.fta ?? null,
          toInt(row.plus_minus),
          opponent,
          isHome,
          g.game_date,
          SEASON,
          pts + reb + ast,
        ]);
      }
    }

    const teamAgg = await client.query(
      `with team_per_game as (
         select
           pgl.team_id, pgl.game_id, g.season,
           (g.start_time AT TIME ZONE 'America/New_York')::date as game_date,
           case when pgl.team_id = g.home_team_id then g.away_team_id else g.home_team_id end as opponent_team_id,
           (pgl.team_id = g.home_team_id) as is_home,
           coalesce(sum(pgl.points), 0)::int as team_points,
           coalesce(sum(pgl.rebounds), 0)::int as team_rebounds,
           coalesce(sum(pgl.assists), 0)::int as team_assists,
           coalesce(sum(pgl.steals), 0)::int as team_steals,
           coalesce(sum(pgl.blocks), 0)::int as team_blocks,
           coalesce(sum(pgl.turnovers), 0)::int as team_turnovers,
           coalesce(sum(pgl.field_goals_made), 0)::int as team_fgm,
           coalesce(sum(pgl.field_goals_attempted), 0)::int as team_fga,
           coalesce(sum(pgl.three_pointers_made), 0)::int as team_3pm,
           coalesce(sum(pgl.three_pointers_attempted), 0)::int as team_3pa,
           coalesce(sum(pgl.free_throws_made), 0)::int as team_ftm,
           coalesce(sum(pgl.free_throws_attempted), 0)::int as team_fta,
           coalesce(sum(pgl.offensive_rebounds), 0)::int as offensive_rebounds,
           coalesce(sum(pgl.defensive_rebounds), 0)::int as defensive_rebounds,
           case when pgl.team_id = g.home_team_id then g.away_score else g.home_score end as points_allowed,
           case
             when g.home_score is null or g.away_score is null then null
             when pgl.team_id = g.home_team_id and g.home_score > g.away_score then 'W'
             when pgl.team_id = g.away_team_id and g.away_score > g.home_score then 'W'
             when g.home_score = g.away_score then null
             else 'L'
           end as result
         from analytics.player_game_logs pgl
         join analytics.games g on g.game_id = pgl.game_id
         where g.season = $2 and pgl.game_id = any($1::text[])
         group by pgl.team_id, pgl.game_id, g.season, g.start_time,
                  g.home_team_id, g.away_team_id, g.home_score, g.away_score
       ),
       with_opponent as (
         select t.*, o.team_fgm as opponent_fgm, o.team_fga as opponent_fga,
                o.team_3pm as opponent_3pm, o.team_3pa as opponent_3pa,
                o.team_ftm as opponent_ftm, o.team_fta as opponent_fta,
                o.team_turnovers as opponent_turnovers,
                o.offensive_rebounds as opponent_offensive_rebounds,
                o.defensive_rebounds as opponent_defensive_rebounds
         from team_per_game t
         join team_per_game o on o.game_id = t.game_id and o.team_id = t.opponent_team_id
       )
       select *,
         0.5 * ((team_fga + 0.44 * team_fta - offensive_rebounds + team_turnovers) +
                (opponent_fga + 0.44 * opponent_fta - opponent_offensive_rebounds + opponent_turnovers)) as estimated_possessions
       from with_opponent`,
      [[...writeIds], SEASON]
    );
    if (teamAgg.rows.length !== writeIds.length * 2) {
      throw new Error(`expected ${writeIds.length * 2} team-stat rows, got ${teamAgg.rows.length}`);
    }
    for (const r of teamAgg.rows) {
      const est = Number(r.estimated_possessions);
      await client.query(
        `insert into analytics.team_game_stats (
           team_id, game_id, season, game_date, opponent_team_id, is_home,
           team_points, team_rebounds, team_assists, team_steals, team_blocks, team_turnovers,
           team_fgm, team_fga, team_3pm, team_3pa, team_ftm, team_fta,
           offensive_rebounds, defensive_rebounds,
           opponent_fgm, opponent_fga, opponent_3pm, opponent_3pa, opponent_ftm, opponent_fta,
           opponent_turnovers, opponent_offensive_rebounds, opponent_defensive_rebounds,
           points_allowed, result,
           estimated_possessions, offensive_rating, defensive_rating, pace, efg_pct, tov_pct, orb_pct
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
           $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
           $32,$33,$34,$35,$36,$37,$38
         )
         on conflict (team_id, game_id) do update set
           season = excluded.season, game_date = excluded.game_date,
           opponent_team_id = excluded.opponent_team_id, is_home = excluded.is_home,
           team_points = excluded.team_points, team_rebounds = excluded.team_rebounds,
           team_assists = excluded.team_assists, team_steals = excluded.team_steals,
           team_blocks = excluded.team_blocks, team_turnovers = excluded.team_turnovers,
           team_fgm = excluded.team_fgm, team_fga = excluded.team_fga,
           team_3pm = excluded.team_3pm, team_3pa = excluded.team_3pa,
           team_ftm = excluded.team_ftm, team_fta = excluded.team_fta,
           offensive_rebounds = excluded.offensive_rebounds,
           defensive_rebounds = excluded.defensive_rebounds,
           opponent_fgm = excluded.opponent_fgm, opponent_fga = excluded.opponent_fga,
           opponent_3pm = excluded.opponent_3pm, opponent_3pa = excluded.opponent_3pa,
           opponent_ftm = excluded.opponent_ftm, opponent_fta = excluded.opponent_fta,
           opponent_turnovers = excluded.opponent_turnovers,
           opponent_offensive_rebounds = excluded.opponent_offensive_rebounds,
           opponent_defensive_rebounds = excluded.opponent_defensive_rebounds,
           points_allowed = excluded.points_allowed, result = excluded.result,
           estimated_possessions = excluded.estimated_possessions,
           offensive_rating = excluded.offensive_rating, defensive_rating = excluded.defensive_rating,
           pace = excluded.pace, efg_pct = excluded.efg_pct, tov_pct = excluded.tov_pct,
           orb_pct = excluded.orb_pct, updated_at = now()`,
        [
          r.team_id,
          r.game_id,
          r.season,
          r.game_date,
          r.opponent_team_id,
          r.is_home,
          r.team_points,
          r.team_rebounds,
          r.team_assists,
          r.team_steals,
          r.team_blocks,
          r.team_turnovers,
          r.team_fgm,
          r.team_fga,
          r.team_3pm,
          r.team_3pa,
          r.team_ftm,
          r.team_fta,
          r.offensive_rebounds,
          r.defensive_rebounds,
          r.opponent_fgm,
          r.opponent_fga,
          r.opponent_3pm,
          r.opponent_3pa,
          r.opponent_ftm,
          r.opponent_fta,
          r.opponent_turnovers,
          r.opponent_offensive_rebounds,
          r.opponent_defensive_rebounds,
          r.points_allowed,
          r.result,
          est,
          est ? (Number(r.team_points) / est) * 100 : null,
          est ? (Number(r.points_allowed) / est) * 100 : null,
          est,
          r.team_fga ? (Number(r.team_fgm) + 0.5 * Number(r.team_3pm)) / Number(r.team_fga) : null,
          Number(r.team_fga) + 0.44 * Number(r.team_fta) + Number(r.team_turnovers) > 0
            ? Number(r.team_turnovers) /
              (Number(r.team_fga) + 0.44 * Number(r.team_fta) + Number(r.team_turnovers))
            : null,
          Number(r.offensive_rebounds) + Number(r.opponent_defensive_rebounds) > 0
            ? Number(r.offensive_rebounds) /
              (Number(r.offensive_rebounds) + Number(r.opponent_defensive_rebounds))
            : null,
        ]
      );
    }

    const playerIds = [...affectedPlayers];
    const teamIds = [...affectedTeams];
    const pav = await client.query(
      `select player_id, season, count(*)::int as games_played,
              avg(points) as pts_avg, avg(rebounds) as reb_avg, avg(assists) as ast_avg,
              avg(steals) as stl_avg, avg(blocks) as blk_avg, avg(turnovers) as turnover_avg,
              avg(pra) as pra_avg,
              case when sum(field_goals_attempted) > 0 then sum(field_goals_made)::numeric / sum(field_goals_attempted) else null end as fg_pct,
              case when sum(three_pointers_attempted) > 0 then sum(three_pointers_made)::numeric / sum(three_pointers_attempted) else null end as fg3_pct,
              case when sum(free_throws_attempted) > 0 then sum(free_throws_made)::numeric / sum(free_throws_attempted) else null end as ft_pct
       from analytics.player_game_logs
       where season = $2 and player_id = any($1::text[])
       group by player_id, season`,
      [playerIds, SEASON]
    );
    for (const r of pav.rows) {
      await client.query(UPSERT_PLAYER_AVG, [
        r.player_id,
        r.season,
        r.games_played,
        r.pts_avg,
        r.reb_avg,
        r.ast_avg,
        r.stl_avg,
        r.blk_avg,
        r.turnover_avg,
        r.pra_avg,
        r.fg_pct,
        r.fg3_pct,
        r.ft_pct,
      ]);
    }
    const tav = await client.query(
      `select team_id, season, count(*)::int as games_played,
              avg(team_points) as avg_points, avg(team_rebounds) as avg_rebounds,
              avg(team_assists) as avg_assists, avg(team_steals) as avg_steals,
              avg(team_blocks) as avg_blocks, avg(team_turnovers) as avg_turnovers,
              avg(team_fgm) as avg_fgm, avg(team_fga) as avg_fga, avg(team_3pm) as avg_3pm,
              avg(team_3pa) as avg_3pa, avg(team_ftm) as avg_ftm, avg(team_fta) as avg_fta,
              avg(points_allowed) as avg_points_allowed,
              count(*) filter (where result = 'W')::int as wins,
              count(*) filter (where result = 'L')::int as losses,
              count(*) filter (where is_home and result = 'W')::int as home_wins,
              count(*) filter (where is_home and result = 'L')::int as home_losses,
              count(*) filter (where not is_home and result = 'W')::int as away_wins,
              count(*) filter (where not is_home and result = 'L')::int as away_losses,
              case when count(*) filter (where result in ('W','L')) > 0
                   then count(*) filter (where result = 'W')::numeric / count(*) filter (where result in ('W','L'))
                   else null end as win_pct,
              avg(offensive_rating) as avg_offensive_rating,
              avg(defensive_rating) as avg_defensive_rating,
              avg(pace) as avg_pace, avg(efg_pct) as avg_efg_pct,
              avg(tov_pct) as avg_tov_pct, avg(orb_pct) as avg_orb_pct
       from analytics.team_game_stats
       where season = $2 and team_id = any($1::text[])
       group by team_id, season`,
      [teamIds, SEASON]
    );
    for (const r of tav.rows) {
      await client.query(
        `insert into analytics.team_season_averages (
           team_id, season, games_played,
           avg_points, avg_rebounds, avg_assists, avg_steals, avg_blocks, avg_turnovers,
           avg_fgm, avg_fga, avg_3pm, avg_3pa, avg_ftm, avg_fta,
           avg_points_allowed, wins, losses, home_wins, home_losses, away_wins, away_losses, win_pct,
           avg_offensive_rating, avg_defensive_rating, avg_pace, avg_efg_pct, avg_tov_pct, avg_orb_pct
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
         )
         on conflict (team_id, season) do update set
           games_played = excluded.games_played, avg_points = excluded.avg_points,
           avg_rebounds = excluded.avg_rebounds, avg_assists = excluded.avg_assists,
           avg_steals = excluded.avg_steals, avg_blocks = excluded.avg_blocks,
           avg_turnovers = excluded.avg_turnovers, avg_fgm = excluded.avg_fgm, avg_fga = excluded.avg_fga,
           avg_3pm = excluded.avg_3pm, avg_3pa = excluded.avg_3pa, avg_ftm = excluded.avg_ftm,
           avg_fta = excluded.avg_fta, avg_points_allowed = excluded.avg_points_allowed,
           wins = excluded.wins, losses = excluded.losses, home_wins = excluded.home_wins,
           home_losses = excluded.home_losses, away_wins = excluded.away_wins,
           away_losses = excluded.away_losses, win_pct = excluded.win_pct,
           avg_offensive_rating = excluded.avg_offensive_rating,
           avg_defensive_rating = excluded.avg_defensive_rating, avg_pace = excluded.avg_pace,
           avg_efg_pct = excluded.avg_efg_pct, avg_tov_pct = excluded.avg_tov_pct,
           avg_orb_pct = excluded.avg_orb_pct, updated_at = now()`,
        [
          r.team_id,
          r.season,
          r.games_played,
          r.avg_points,
          r.avg_rebounds,
          r.avg_assists,
          r.avg_steals,
          r.avg_blocks,
          r.avg_turnovers,
          r.avg_fgm,
          r.avg_fga,
          r.avg_3pm,
          r.avg_3pa,
          r.avg_ftm,
          r.avg_fta,
          r.avg_points_allowed,
          r.wins,
          r.losses,
          r.home_wins,
          r.home_losses,
          r.away_wins,
          r.away_losses,
          r.win_pct,
          r.avg_offensive_rating,
          r.avg_defensive_rating,
          r.avg_pace,
          r.avg_efg_pct,
          r.avg_tov_pct,
          r.avg_orb_pct,
        ]
      );
    }
    averages = {
      playersRecomputed: pav.rows.length,
      teamsRecomputed: tav.rows.length,
      playerIds,
      teamIds,
      seasonsTouched: [SEASON],
    };

    await client.query('commit');

    const missingStints = await client.query(
      `select l.player_id, l.team_id, min(l.game_date)::text as observed_from, max(l.game_date)::text as observed_to
       from analytics.player_game_logs l
       where l.season = $2
         and (l.player_id, l.team_id) in (
           select distinct x.player_id, x.team_id
           from analytics.player_game_logs x
           where x.game_id = any($1::text[]) and x.season = $2
         )
         and not exists (
           select 1 from analytics.player_team_stints s
           where s.season = $2 and s.player_id = l.player_id and s.team_id = l.team_id
         )
       group by l.player_id, l.team_id`,
      [[...writeIds], SEASON]
    );
    if (missingStints.rows.length === 0) {
      stintDecision = {
        rebuilt: false,
        inferredInserted: 0,
        unresolved: [],
        reason:
          'All repaired appearances already have a 2025 player-team stint; season-wide inferred_pgl rebuild not required. nba_stats and 2026 stints left unchanged.',
        missingPlayerTeamPairs: [],
      };
    } else {
      const unresolved: Array<Record<string, unknown>> = [];
      let inserted = 0;
      await client.query('begin');
      try {
        for (const s of missingStints.rows) {
          const ent = await client.query(
            `select coalesce(
               (select player_entity_id from analytics.player_provider_ids
                where provider = 'balldontlie' and provider_player_id = $1 limit 1),
               (select player_entity_id from analytics.player_team_stints
                where player_id = $1 and player_entity_id is not null limit 1)
             ) as player_entity_id`,
            [s.player_id]
          );
          const entityId = ent.rows[0]?.player_entity_id ?? null;
          if (!entityId) {
            unresolved.push({ player_id: s.player_id, team_id: s.team_id, reason: 'no player_entity_id' });
            continue;
          }
          await client.query(
            `insert into analytics.player_team_stints (
               season, player_id, player_entity_id, team_id, observed_from, observed_to,
               source, source_player_id, jersey, position, membership_type
             ) values ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11)`,
            [
              SEASON,
              s.player_id,
              entityId,
              s.team_id,
              s.observed_from,
              s.observed_to,
              'inferred_pgl',
              null,
              null,
              null,
              null,
            ]
          );
          inserted += 1;
        }
        await client.query('commit');
      } catch (stintErr) {
        await client.query('rollback').catch(() => undefined);
        unresolved.push({
          error: stintErr instanceof Error ? stintErr.message : String(stintErr),
        });
      }
      stintDecision = {
        rebuilt: false,
        inferredInserted: inserted,
        unresolved,
        reason:
          inserted > 0
            ? 'Inserted inferred_pgl rows only for missing 2025 player-team pairs with a resolvable player_entity_id. Did not delete nba_stats or 2026 stints.'
            : 'Missing 2025 player-team pairs could not be inserted without player_entity_id; stats materialize was kept. nba_stats and 2026 stints unchanged.',
        missingPlayerTeamPairs: missingStints.rows,
      };
    }

    for (const gameId of writeIds) {
      afterByGame[gameId] = await gameLayerCounts(client, gameId);
    }
    isolationAfter = await snapshotIsolation(client);
    const stintSrcAfter = await client.query(
      `select season, source, count(*)::int as n from analytics.player_team_stints group by 1, 2 order by 1, 2`
    );
    stintsAfter = stintSrcAfter.rows;
    const localOnlyAfter = await client.query(
      `select count(*)::int as logs from analytics.player_game_logs where game_id = $1`,
      [String(DO_NOT_TOUCH_LOCAL_ONLY_ID)]
    );
    const complete = await client.query(
      `with logs as (
         select game_id from analytics.player_game_logs where season = '2025' group by game_id
       ),
       tgs as (
         select game_id from analytics.team_game_stats
         where season = '2025' group by game_id having count(*) = 2
       )
       select
         (select count(*)::int from logs) as distinct_log_games,
         (select count(*)::int from tgs) as distinct_teamstat_games,
         (select count(*)::int from logs l join tgs t using (game_id)) as logs_and_teamstats`
    );
    const finalsAudit = await auditProviderFinals(client, loadCachedFinalGames());
    completeness = {
      providerFinals: finalsAudit.providerFinals,
      distinctLogGames: complete.rows[0]?.distinct_log_games,
      distinctTeamStatGames: complete.rows[0]?.distinct_teamstat_games,
      logsAndTeamStats: complete.rows[0]?.logs_and_teamstats,
      missingRawStats: finalsAudit.missingRawStats,
      missingAnalyticsLogs: finalsAudit.missingAnalyticsLogs,
      missingTeamStats: finalsAudit.missingTeamStats,
      missingAnalyticsGame: finalsAudit.missingAnalyticsGame,
      scoreReconciliationFailures: finalsAudit.scoreReconciliationFailures,
      duplicatePlayerGameRows: finalsAudit.duplicatePlayerGameRows,
      teamIdentityMismatches: finalsAudit.teamIdentityMismatches,
      completeLogGamesVsProvider: finalsAudit.completeLogGames,
      completeTeamStatGamesVsProvider: finalsAudit.completeTeamStatGames,
      doNotTouch21681993LogsBefore: localOnlyBefore.rows[0]?.logs ?? 0,
      doNotTouch21681993LogsAfter: localOnlyAfter.rows[0]?.logs ?? 0,
    };
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const isolationUnchanged =
    isolationBefore &&
    isolationAfter &&
    isolationBefore.games_2026 === isolationAfter.games_2026 &&
    isolationBefore.logs_2026 === isolationAfter.logs_2026 &&
    isolationBefore.tgs_2026 === isolationAfter.tgs_2026 &&
    isolationBefore.pav_2026 === isolationAfter.pav_2026 &&
    isolationBefore.tav_2026 === isolationAfter.tav_2026 &&
    isolationBefore.stints_2026 === isolationAfter.stints_2026 &&
    isolationBefore.hist_logs === isolationAfter.hist_logs &&
    isolationBefore.hist_tgs === isolationAfter.hist_tgs;

  const exceptions: Array<Record<string, unknown>> = [];
  const allOk = writeIds.every((id) => {
    const after = afterByGame[id] as {
      rawRows: number;
      logRows: number;
      teamRows: number;
      duplicatePlayers: number;
      logOtherSeason: number;
      teamOtherSeason: number;
      homePts: number;
      awayPts: number;
    };
    const box = boxes.find((b) => b.gameId === id)!;
    const ok =
      after &&
      after.rawRows === box.validation.records &&
      after.logRows === box.validation.records &&
      after.rawRows === after.logRows &&
      after.teamRows === 2 &&
      after.duplicatePlayers === 0 &&
      after.logOtherSeason === 0 &&
      after.teamOtherSeason === 0 &&
      after.homePts === box.validation.official.home &&
      after.awayPts === box.validation.official.away;
    if (!ok) {
      exceptions.push({ gameId: id, reason: 'post-write verification failed', after, expected: box.validation });
    }
    return ok;
  });
  const remainingGaps = Array.isArray((completeness as { missingAnalyticsLogs?: string[] }).missingAnalyticsLogs)
    ? (completeness as { missingAnalyticsLogs: string[] }).missingAnalyticsLogs.filter(
        (id) => id !== String(DO_NOT_TOUCH_LOCAL_ONLY_ID)
      )
    : [];
  const completenessIdeal =
    Number((completeness as { completeLogGamesVsProvider?: number }).completeLogGamesVsProvider) === 1322 &&
    Number((completeness as { completeTeamStatGamesVsProvider?: number }).completeTeamStatGamesVsProvider) === 1322;
  const verdict = !isolationUnchanged
    ? 'RED — stop materialization'
    : remaining31 && allOk && excluded.length === 0 && completenessIdeal
      ? 'GREEN — all 2025 repair games materialized; proceed to full 2025 completeness audit'
      : remaining31
        ? 'YELLOW — some games need review before historical backfill'
        : allOk
          ? 'GREEN — 3-game Postgres repair proven; proceed to remaining 31 materializations'
          : 'YELLOW — review discrepancy before expanding';

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: false,
    postgresMaterialize: true,
    bdlHttpRequests: 0,
    trialLimiterConsumed: false,
    safety,
    queue: {
      requested: batchIds.length,
      materialized: writeIds.length,
      excluded: excluded.length,
    },
    s3Validation: boxes.map((b) => ({ key: b.key, ...b.validation })),
    excluded,
    exceptions,
    beforeByGame,
    afterByGame,
    teamStatsRowsWritten: writeIds.length * 2,
    averages,
    stintDecision,
    stintsBefore,
    stintsAfter,
    isolationBefore,
    isolationAfter,
    isolationUnchanged,
    completeness,
    remainingGaps,
    remainingGapCount: remainingGaps.length,
    stepVerdict: verdict,
  };
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (verdict.startsWith('RED')) process.exit(2);
}

main()
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
