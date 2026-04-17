/**
 * Lambda Function: Nightly BDL Updater
 *
 * Scheduled: Daily at 08:00 UTC (03:00 ET) via EventBridge
 * Purpose: Sync upcoming BDL schedule (ET, all statuses) into raw/analytics games, then fetch
 *          yesterday/today's Final games (ET date window), upsert raw tables, and run transforms + computes.
 *
 * Pipeline: BDL API → raw.games + raw.player_game_stats + raw.players
 *           → analytics.games + analytics.player_game_logs
 *           → analytics.team_game_stats + analytics.team_season_averages
 *           → analytics.player_season_averages
 *
 * Environment Variables:
 * - SUPABASE_DB_URL (required)
 * - BALLDONTLIE_API_KEY (required)
 * - BALLDONTLIE_REQUEST_DELAY_MS (optional, default: 200)
 * - MAX_RETRIES (optional, default: 3)
 * - BDL_SCHEDULE_SYNC_DAYS_FORWARD (optional, default: 14) — ET calendar days after today to
 *   upsert scheduled/final games into raw + analytics (playoffs & slate discovery).
 * - DISABLE_BDL_SCHEDULE_SYNC (optional, set to "1" to skip that step)
 */

try {
  const path = require('path');
  const fs = require('fs');
  const rootEnv = path.join(__dirname, '../../.env');
  const localEnv = path.join(__dirname, '.env');
  if (fs.existsSync(rootEnv)) {
    require('dotenv').config({ path: rootEnv });
  } else if (fs.existsSync(localEnv)) {
    require('dotenv').config({ path: localEnv });
  } else {
    require('dotenv').config();
  }
} catch {
  // dotenv not available in Lambda -- env vars set via configuration
}

import { Pool, PoolClient } from 'pg';

// ============================================
// CONFIGURATION
// ============================================

const BDL_BASE = 'https://api.balldontlie.io/v1';
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;
const REQUEST_DELAY_MS = parseInt(process.env.BALLDONTLIE_REQUEST_DELAY_MS || '200', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_BASE_DELAY_MS = 60000;

if (!SUPABASE_DB_URL) {
  throw new Error('Missing SUPABASE_DB_URL environment variable');
}
if (!BALLDONTLIE_API_KEY) {
  throw new Error('Missing BALLDONTLIE_API_KEY environment variable');
}

let cleanedDbUrl = SUPABASE_DB_URL.trim();
if (!cleanedDbUrl.startsWith('postgresql://') && !cleanedDbUrl.startsWith('postgres://')) {
  throw new Error(`Invalid connection string format: ${cleanedDbUrl.substring(0, 20)}...`);
}

const pool = new Pool({
  connectionString: cleanedDbUrl,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 3,
});

// ============================================
// HELPERS
// ============================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sid(id: number | null | undefined): string {
  if (id == null) return '';
  return String(id);
}

function getCurrentSeason(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  return month < 6 ? year - 1 : year;
}

// ============================================
// BDL API
// ============================================

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: BALLDONTLIE_API_KEY as string },
    });
    if (res.status === 429) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Rate limited (429). Waiting ${delay / 1000}s before retry ${attempt + 1}...`);
      await sleep(delay);
      continue;
    }
    if (res.status >= 500 && attempt < retries) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Server error (${res.status}). Waiting ${delay / 1000}s before retry ${attempt + 1}...`);
      await sleep(delay);
      continue;
    }
    return res;
  }
  throw new Error(`BDL API failed after ${retries + 1} attempts: ${url}`);
}

async function fetchGames(startDate: string, endDate: string, season: number): Promise<any[]> {
  const out: any[] = [];
  let cursor: number | null = null;
  while (true) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      'seasons[]': String(season),
      per_page: '100',
    });
    if (cursor != null) params.set('cursor', String(cursor));
    const res = await fetchWithRetry(`${BDL_BASE}/games?${params.toString()}`);
    if (!res.ok) throw new Error(`Games API returned ${res.status}`);
    const json: any = await res.json();
    out.push(...(json.data || []));
    cursor = json.meta?.next_cursor ?? null;
    if (cursor == null) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return out;
}

async function fetchStatsByGameIds(gameIds: number[]): Promise<any[]> {
  const out: any[] = [];
  let cursor: number | null = null;
  const params = new URLSearchParams();
  gameIds.forEach((id) => params.append('game_ids[]', String(id)));
  params.set('per_page', '100');
  const base = `${BDL_BASE}/stats?${params.toString()}`;
  while (true) {
    const url = cursor == null ? base : `${base}&cursor=${cursor}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`Stats API returned ${res.status}`);
    const json: any = await res.json();
    out.push(...(json.data || []));
    cursor = json.meta?.next_cursor ?? null;
    if (cursor == null) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return out;
}

// ============================================
// RAW UPSERT SQL
// ============================================

const upsertRawGame = `
  insert into raw.games (id, date, season, status, period, time, period_detail, datetime, postseason, home_team_score, visitor_team_score, home_team, visitor_team)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
  on conflict (id) do update set
    date = excluded.date,
    season = excluded.season,
    status = excluded.status,
    period = excluded.period,
    time = excluded.time,
    period_detail = excluded.period_detail,
    datetime = excluded.datetime,
    postseason = excluded.postseason,
    home_team_score = excluded.home_team_score,
    visitor_team_score = excluded.visitor_team_score,
    home_team = excluded.home_team,
    visitor_team = excluded.visitor_team;
`;

const upsertRawStat = `
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
    player = excluded.player, team = excluded.team, game = excluded.game;
`;

const upsertRawPlayer = `
  insert into raw.players (id, first_name, last_name, position, height, weight, jersey_number, college, country, draft_year, draft_round, draft_number, team_id)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  on conflict (id) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    position = excluded.position,
    height = excluded.height,
    weight = excluded.weight,
    jersey_number = excluded.jersey_number,
    college = excluded.college,
    country = excluded.country,
    draft_year = excluded.draft_year,
    draft_round = excluded.draft_round,
    draft_number = excluded.draft_number,
    team_id = excluded.team_id;
`;

// ============================================
// ANALYTICS UPSERT SQL
// ============================================

const upsertAnalyticsPlayer = `
  insert into analytics.players (player_id, full_name, first_name, last_name, position, height, weight)
  values ($1, $2, $3, $4, $5, $6, $7)
  on conflict (player_id) do update set
    full_name = excluded.full_name,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    position = excluded.position,
    height = excluded.height,
    weight = excluded.weight,
    updated_at = now();
`;

const upsertAnalyticsGame = `
  insert into analytics.games (game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score, venue)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  on conflict (game_id) do update set
    season = excluded.season,
    start_time = excluded.start_time,
    status = excluded.status,
    home_team_id = excluded.home_team_id,
    away_team_id = excluded.away_team_id,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    venue = excluded.venue,
    updated_at = now();
`;

const upsertAnalyticsPlayerGameLog = `
  insert into analytics.player_game_logs (
    game_id, player_id, team_id,
    minutes, points, rebounds, offensive_rebounds, defensive_rebounds,
    assists, steals, blocks, turnovers, personal_fouls,
    field_goals_made, field_goals_attempted,
    three_pointers_made, three_pointers_attempted,
    free_throws_made, free_throws_attempted,
    plus_minus,
    opponent_team_id, is_home, game_date, season, pra
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
  on conflict (game_id, player_id) do update set
    team_id = excluded.team_id,
    minutes = excluded.minutes,
    points = excluded.points,
    rebounds = excluded.rebounds,
    offensive_rebounds = excluded.offensive_rebounds,
    defensive_rebounds = excluded.defensive_rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    turnovers = excluded.turnovers,
    personal_fouls = excluded.personal_fouls,
    field_goals_made = excluded.field_goals_made,
    field_goals_attempted = excluded.field_goals_attempted,
    three_pointers_made = excluded.three_pointers_made,
    three_pointers_attempted = excluded.three_pointers_attempted,
    free_throws_made = excluded.free_throws_made,
    free_throws_attempted = excluded.free_throws_attempted,
    plus_minus = excluded.plus_minus,
    opponent_team_id = excluded.opponent_team_id,
    is_home = excluded.is_home,
    game_date = excluded.game_date,
    season = excluded.season,
    pra = excluded.pra,
    updated_at = now();
`;

// ============================================
// TEAM STATS SQL (from compute-team-stats.ts)
// ============================================

const upsertTeamGameStats = `
  insert into analytics.team_game_stats (
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
    $19,$20,
    $21,$22,$23,$24,$25,$26,$27,$28,$29,
    $30,$31,
    $32,$33,$34,$35,$36,$37,$38
  )
  on conflict (team_id, game_id) do update set
    season = excluded.season,
    game_date = excluded.game_date,
    opponent_team_id = excluded.opponent_team_id,
    is_home = excluded.is_home,
    team_points = excluded.team_points,
    team_rebounds = excluded.team_rebounds,
    team_assists = excluded.team_assists,
    team_steals = excluded.team_steals,
    team_blocks = excluded.team_blocks,
    team_turnovers = excluded.team_turnovers,
    team_fgm = excluded.team_fgm,
    team_fga = excluded.team_fga,
    team_3pm = excluded.team_3pm,
    team_3pa = excluded.team_3pa,
    team_ftm = excluded.team_ftm,
    team_fta = excluded.team_fta,
    offensive_rebounds = excluded.offensive_rebounds,
    defensive_rebounds = excluded.defensive_rebounds,
    opponent_fgm = excluded.opponent_fgm,
    opponent_fga = excluded.opponent_fga,
    opponent_3pm = excluded.opponent_3pm,
    opponent_3pa = excluded.opponent_3pa,
    opponent_ftm = excluded.opponent_ftm,
    opponent_fta = excluded.opponent_fta,
    opponent_turnovers = excluded.opponent_turnovers,
    opponent_offensive_rebounds = excluded.opponent_offensive_rebounds,
    opponent_defensive_rebounds = excluded.opponent_defensive_rebounds,
    points_allowed = excluded.points_allowed,
    result = excluded.result,
    estimated_possessions = excluded.estimated_possessions,
    offensive_rating = excluded.offensive_rating,
    defensive_rating = excluded.defensive_rating,
    pace = excluded.pace,
    efg_pct = excluded.efg_pct,
    tov_pct = excluded.tov_pct,
    orb_pct = excluded.orb_pct,
    updated_at = now();
`;

const upsertTeamSeasonAverages = `
  insert into analytics.team_season_averages (
    team_id, season, games_played,
    avg_points, avg_rebounds, avg_assists, avg_steals, avg_blocks, avg_turnovers,
    avg_fgm, avg_fga, avg_3pm, avg_3pa, avg_ftm, avg_fta,
    avg_points_allowed, wins, losses, home_wins, home_losses, away_wins, away_losses, win_pct,
    avg_offensive_rating, avg_defensive_rating, avg_pace, avg_efg_pct, avg_tov_pct, avg_orb_pct
  ) values (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
  )
  on conflict (team_id, season) do update set
    games_played = excluded.games_played,
    avg_points = excluded.avg_points,
    avg_rebounds = excluded.avg_rebounds,
    avg_assists = excluded.avg_assists,
    avg_steals = excluded.avg_steals,
    avg_blocks = excluded.avg_blocks,
    avg_turnovers = excluded.avg_turnovers,
    avg_fgm = excluded.avg_fgm,
    avg_fga = excluded.avg_fga,
    avg_3pm = excluded.avg_3pm,
    avg_3pa = excluded.avg_3pa,
    avg_ftm = excluded.avg_ftm,
    avg_fta = excluded.avg_fta,
    avg_points_allowed = excluded.avg_points_allowed,
    wins = excluded.wins,
    losses = excluded.losses,
    home_wins = excluded.home_wins,
    home_losses = excluded.home_losses,
    away_wins = excluded.away_wins,
    away_losses = excluded.away_losses,
    win_pct = excluded.win_pct,
    avg_offensive_rating = excluded.avg_offensive_rating,
    avg_defensive_rating = excluded.avg_defensive_rating,
    avg_pace = excluded.avg_pace,
    avg_efg_pct = excluded.avg_efg_pct,
    avg_tov_pct = excluded.avg_tov_pct,
    avg_orb_pct = excluded.avg_orb_pct,
    updated_at = now();
`;

const upsertPlayerSeasonAverages = `
  insert into analytics.player_season_averages (
    player_id, season, games_played,
    pts_avg, reb_avg, ast_avg, stl_avg, blk_avg, turnover_avg, pra_avg,
    fg_pct, fg3_pct, ft_pct
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  on conflict (player_id, season) do update set
    games_played = excluded.games_played,
    pts_avg = excluded.pts_avg,
    reb_avg = excluded.reb_avg,
    ast_avg = excluded.ast_avg,
    stl_avg = excluded.stl_avg,
    blk_avg = excluded.blk_avg,
    turnover_avg = excluded.turnover_avg,
    pra_avg = excluded.pra_avg,
    fg_pct = excluded.fg_pct,
    fg3_pct = excluded.fg3_pct,
    ft_pct = excluded.ft_pct,
    updated_at = now();
`;

// ============================================
// TEAM ID MAPPING (dedup by abbreviation)
// ============================================

async function buildTeamIdMap(client: PoolClient): Promise<Map<number, number>> {
  const res = await client.query('select id, abbreviation from raw.teams');
  const byAbbrev = new Map<string, number>();
  for (const r of res.rows) {
    const abbr = (r.abbreviation ?? '').trim().toUpperCase();
    if (!abbr) continue;
    const existing = byAbbrev.get(abbr);
    if (!existing || r.id < existing) byAbbrev.set(abbr, r.id);
  }
  const mapping = new Map<number, number>();
  for (const r of res.rows) {
    const abbr = (r.abbreviation ?? '').trim().toUpperCase();
    if (!abbr) continue;
    const chosen = byAbbrev.get(abbr);
    if (chosen != null) mapping.set(r.id, chosen);
  }
  return mapping;
}

function mapTeamId(rawId: number | null | undefined, mapping: Map<number, number>): string {
  if (rawId == null) return '';
  const chosen = mapping.get(rawId) ?? rawId;
  return String(chosen);
}

/** Upsert one BDL game into raw.games + analytics.games (all statuses). */
async function upsertBdlGameRawAndAnalytics(
  client: PoolClient,
  g: any,
  teamIdMap: Map<number, number>,
): Promise<void> {
  await client.query(upsertRawGame, [
    g.id,
    g.date ?? null,
    g.season ?? null,
    g.status ?? null,
    g.period ?? null,
    g.time ?? null,
    g.period_detail ?? null,
    g.datetime ?? null,
    g.postseason ?? false,
    g.home_team_score ?? null,
    g.visitor_team_score ?? null,
    JSON.stringify(g.home_team ?? null),
    JSON.stringify(g.visitor_team ?? null),
  ]);

  const home = g.home_team && typeof g.home_team === 'object' ? g.home_team : null;
  const visitor = g.visitor_team && typeof g.visitor_team === 'object' ? g.visitor_team : null;
  const homeRawId = home?.id as number | undefined;
  const awayRawId = visitor?.id as number | undefined;
  const homeId = homeRawId != null ? mapTeamId(homeRawId, teamIdMap) : '';
  const awayId = awayRawId != null ? mapTeamId(awayRawId, teamIdMap) : '';
  if (!homeId || !awayId) {
    console.warn(`  Skipping analytics.games for game ${g.id}: missing home or visitor team id`);
    return;
  }
  const startTime = g.datetime
    ? new Date(g.datetime)
    : g.date
      ? new Date(g.date + 'T12:00:00.000Z')
      : null;
  await client.query(upsertAnalyticsGame, [
    sid(g.id),
    g.season != null ? String(g.season) : null,
    startTime,
    g.status ?? null,
    homeId,
    awayId,
    g.home_team_score ?? null,
    g.visitor_team_score ?? null,
    null,
  ]);
}

/**
 * Fetch BDL games for inclusive ET date range and upsert raw + analytics for every row (Scheduled, Final, …).
 */
async function syncUpcomingScheduleFromBdl(
  startDateET: string,
  endDateET: string,
  season: number,
): Promise<number> {
  console.log(`[0/9] Schedule sync (all statuses): BDL ${startDateET} .. ${endDateET}, season ${season}...`);
  const games = await fetchGames(startDateET, endDateET, season);
  if (games.length === 0) {
    console.log('  No games in window; nothing to upsert.');
    return 0;
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const teamIdMap = await buildTeamIdMap(client);
    for (const g of games) {
      await upsertBdlGameRawAndAnalytics(client, g, teamIdMap);
    }
    await client.query('commit');
    console.log(`  Upserted ${games.length} game rows (raw + analytics).`);
    return games.length;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ============================================
// PIPELINE STEPS
// ============================================

interface PipelineResult {
  scheduleGamesSynced: number;
  gamesFound: number;
  finalGames: number;
  statsUpserted: number;
  playersUpserted: number;
  analyticsGames: number;
  analyticsLogs: number;
  teamGameStats: number;
  teamSeasonAvgs: number;
  playerSeasonAvgs: number;
}

async function runPipeline(): Promise<PipelineResult> {
  const result: PipelineResult = {
    scheduleGamesSynced: 0,
    gamesFound: 0,
    finalGames: 0,
    statsUpserted: 0,
    playersUpserted: 0,
    analyticsGames: 0,
    analyticsLogs: 0,
    teamGameStats: 0,
    teamSeasonAvgs: 0,
    playerSeasonAvgs: 0,
  };

  const season = getCurrentSeason();
  const forwardRaw = process.env.BDL_SCHEDULE_SYNC_DAYS_FORWARD;
  const parsedForward = parseInt(forwardRaw ?? '14', 10);
  const forwardDays = Number.isFinite(parsedForward)
    ? Math.min(120, Math.max(0, parsedForward))
    : 14;

  const etRes = await pool.query<{
    yesterday_et: string;
    today_et: string;
    schedule_end_et: string;
  }>(
    `select
      to_char((timezone('America/New_York', now()))::date - interval '1 day', 'YYYY-MM-DD') as yesterday_et,
      to_char((timezone('America/New_York', now()))::date, 'YYYY-MM-DD') as today_et,
      to_char((timezone('America/New_York', now()))::date + $1::integer, 'YYYY-MM-DD') as schedule_end_et`,
    [forwardDays],
  );
  const { yesterday_et, today_et, schedule_end_et } = etRes.rows[0];

  if (process.env.DISABLE_BDL_SCHEDULE_SYNC !== '1' && forwardDays > 0) {
    result.scheduleGamesSynced = await syncUpcomingScheduleFromBdl(today_et, schedule_end_et, season);
  } else {
    console.log('[0/9] Schedule sync skipped (DISABLE_BDL_SCHEDULE_SYNC=1 or BDL_SCHEDULE_SYNC_DAYS_FORWARD=0).');
  }

  const startDate = yesterday_et;
  const endDate = today_et;

  console.log(`[1/9] Fetching games from BDL: ${startDate} to ${endDate} (season ${season})...`);
  const allGames = await fetchGames(startDate, endDate, season);
  result.gamesFound = allGames.length;
  console.log(`  Found ${allGames.length} total games.`);

  const finalGames = allGames.filter((g: any) => g.status === 'Final');
  result.finalGames = finalGames.length;
  console.log(`  ${finalGames.length} games with status "Final".`);

  if (finalGames.length === 0) {
    console.log('No Final games to process. Exiting early.');
    return result;
  }

  for (const g of finalGames) {
    const home = g.home_team?.abbreviation ?? '???';
    const away = g.visitor_team?.abbreviation ?? '???';
    console.log(`  Game ${g.id}: ${away} @ ${home} (${g.home_team_score}-${g.visitor_team_score})`);
  }

  const client = await pool.connect();
  try {
    // Step 2: Upsert raw.games
    console.log(`[2/9] Upserting ${finalGames.length} games into raw.games...`);
    await client.query('begin');
    for (const g of finalGames) {
      await client.query(upsertRawGame, [
        g.id,
        g.date ?? null,
        g.season ?? null,
        g.status ?? null,
        g.period ?? null,
        g.time ?? null,
        g.period_detail ?? null,
        g.datetime ?? null,
        g.postseason ?? false,
        g.home_team_score ?? null,
        g.visitor_team_score ?? null,
        JSON.stringify(g.home_team ?? null),
        JSON.stringify(g.visitor_team ?? null),
      ]);
    }
    await client.query('commit');
    console.log('  Done.');

    // Step 3: Fetch box scores
    const gameIds = finalGames.map((g: any) => g.id);
    console.log(`[3/9] Fetching box scores for ${gameIds.length} games...`);
    let allStats: any[] = [];
    const BATCH_SIZE = 25;
    for (let i = 0; i < gameIds.length; i += BATCH_SIZE) {
      const batch = gameIds.slice(i, i + BATCH_SIZE);
      const stats = await fetchStatsByGameIds(batch);
      allStats.push(...stats);
      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${stats.length} stat lines.`);
      if (i + BATCH_SIZE < gameIds.length) await sleep(REQUEST_DELAY_MS);
    }
    console.log(`  Total stat lines fetched: ${allStats.length}`);

    // Step 4: Upsert raw.player_game_stats
    console.log(`[4/9] Upserting ${allStats.length} stat lines into raw.player_game_stats...`);
    await client.query('begin');
    for (const s of allStats) {
      await client.query(upsertRawStat, [
        s.id,
        s.min ?? null,
        s.fgm ?? null,
        s.fga ?? null,
        s.fg_pct ?? null,
        s.fg3m ?? null,
        s.fg3a ?? null,
        s.fg3_pct ?? null,
        s.ftm ?? null,
        s.fta ?? null,
        s.ft_pct ?? null,
        s.oreb ?? null,
        s.dreb ?? null,
        s.reb ?? null,
        s.ast ?? null,
        s.stl ?? null,
        s.blk ?? null,
        s.turnover ?? null,
        s.pf ?? null,
        s.pts ?? null,
        s.plus_minus ?? null,
        s.player?.id ?? null,
        s.team?.id ?? null,
        s.game?.id ?? null,
        JSON.stringify(s.player ?? null),
        JSON.stringify(s.team ?? null),
        JSON.stringify(s.game ?? null),
      ]);
    }
    await client.query('commit');
    result.statsUpserted = allStats.length;
    console.log('  Done.');

    // Step 5: Upsert raw.players (extract unique players from stats)
    const playerMap = new Map<number, any>();
    for (const s of allStats) {
      if (s.player?.id && !playerMap.has(s.player.id)) {
        playerMap.set(s.player.id, s.player);
      }
    }
    const uniquePlayers = Array.from(playerMap.values());
    console.log(`[5/9] Upserting ${uniquePlayers.length} players into raw.players...`);
    await client.query('begin');
    for (const p of uniquePlayers) {
      await client.query(upsertRawPlayer, [
        p.id,
        p.first_name ?? null,
        p.last_name ?? null,
        p.position ?? null,
        p.height ?? null,
        p.weight ?? null,
        p.jersey_number ?? null,
        p.college ?? null,
        p.country ?? null,
        p.draft_year ?? null,
        p.draft_round ?? null,
        p.draft_number ?? null,
        p.team?.id ?? null,
      ]);
    }
    await client.query('commit');
    result.playersUpserted = uniquePlayers.length;
    console.log('  Done.');

    // Build team ID mapping for transform step
    const teamIdMap = await buildTeamIdMap(client);

    // Step 6: Transform → analytics.players + analytics.games (scoped)
    console.log(`[6/9] Transforming into analytics.players + analytics.games...`);
    await client.query('begin');
    for (const p of uniquePlayers) {
      const firstName = (p.first_name ?? '').trim();
      const lastName = (p.last_name ?? '').trim();
      const fullName = `${firstName} ${lastName}`.trim() || String(p.id);
      await client.query(upsertAnalyticsPlayer, [
        sid(p.id),
        fullName,
        p.first_name ?? null,
        p.last_name ?? null,
        p.position ?? null,
        p.height ?? null,
        p.weight ?? null,
      ]);
    }
    for (const g of finalGames) {
      const home = g.home_team && typeof g.home_team === 'object' ? g.home_team : null;
      const visitor = g.visitor_team && typeof g.visitor_team === 'object' ? g.visitor_team : null;
      const homeRawId = home?.id as number | undefined;
      const awayRawId = visitor?.id as number | undefined;
      const homeId = homeRawId != null ? mapTeamId(homeRawId, teamIdMap) : null;
      const awayId = awayRawId != null ? mapTeamId(awayRawId, teamIdMap) : null;
      if (!homeId || !awayId) {
        console.warn(`  Skipping game ${g.id}: missing home or visitor team id`);
        continue;
      }
      // BDL "date" is calendar day in Eastern; avoid midnight UTC (shows as previous day in ET)
      const startTime = g.datetime
        ? new Date(g.datetime)
        : g.date
          ? new Date(g.date + 'T12:00:00.000Z') // noon UTC so ET calendar day is correct
          : null;
      await client.query(upsertAnalyticsGame, [
        sid(g.id),
        g.season != null ? String(g.season) : null,
        startTime,
        g.status ?? null,
        homeId,
        awayId,
        g.home_team_score ?? null,
        g.visitor_team_score ?? null,
        null,
      ]);
    }
    await client.query('commit');
    result.analyticsGames = finalGames.length;
    console.log(`  Upserted ${uniquePlayers.length} players, ${finalGames.length} games.`);

    // Step 7: Transform → analytics.player_game_logs (scoped to affected games)
    const gameIdPlaceholders = gameIds.map((_: any, i: number) => `$${i + 1}`).join(',');
    const logsRes = await client.query(
      `select
        s.game_id, s.player_id, s.team_id,
        s.min, s.pts, s.reb, s.oreb, s.dreb, s.ast, s.stl, s.blk, s.turnover, s.pf, s.plus_minus,
        s.fgm, s.fga, s.fg3m, s.fg3a, s.ftm, s.fta,
        g.date as game_date, g.season as game_season,
        (g.home_team->>'id')::int as home_team_id,
        (g.visitor_team->>'id')::int as away_team_id
      from raw.player_game_stats s
      join raw.games g on g.id = s.game_id
      where s.game_id in (${gameIdPlaceholders})`,
      gameIds,
    );

    console.log(`[7/9] Upserting ${logsRes.rows.length} player game logs into analytics...`);
    await client.query('begin');
    for (const r of logsRes.rows) {
      const teamId = mapTeamId(r.team_id, teamIdMap);
      const homeId = mapTeamId(r.home_team_id, teamIdMap);
      const awayId = mapTeamId(r.away_team_id, teamIdMap);
      const isHome = teamId === homeId;
      const opponentTeamId = isHome ? awayId : homeId;
      const gameDate = r.game_date ?? null;
      const logSeason = r.game_season != null ? String(r.game_season) : null;
      const pra = (r.pts ?? 0) + (r.reb ?? 0) + (r.ast ?? 0);
      await client.query(upsertAnalyticsPlayerGameLog, [
        sid(r.game_id),
        sid(r.player_id),
        teamId,
        r.min ?? null,
        r.pts ?? null,
        r.reb ?? null,
        r.oreb ?? null,
        r.dreb ?? null,
        r.ast ?? null,
        r.stl ?? null,
        r.blk ?? null,
        r.turnover ?? null,
        r.pf ?? null,
        r.fgm ?? null,
        r.fga ?? null,
        r.fg3m ?? null,
        r.fg3a ?? null,
        r.ftm ?? null,
        r.fta ?? null,
        r.plus_minus ?? null,
        opponentTeamId || null,
        isHome,
        gameDate,
        logSeason,
        pra,
      ]);
    }
    await client.query('commit');
    result.analyticsLogs = logsRes.rows.length;
    console.log('  Done.');

    // Step 8: Compute team_game_stats (scoped to affected game IDs)
    console.log('[8/9] Computing team_game_stats for affected games...');
    const teamStatsQuery = `
      with team_per_game as (
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
        where g.game_id in (${gameIdPlaceholders})
        group by pgl.team_id, pgl.game_id, g.season, g.start_time,
                 g.home_team_id, g.away_team_id, g.home_score, g.away_score
      ),
      with_opponent as (
        select
          t.team_id, t.game_id, t.season, t.game_date, t.opponent_team_id, t.is_home,
          t.team_points, t.team_rebounds, t.team_assists, t.team_steals, t.team_blocks, t.team_turnovers,
          t.team_fgm, t.team_fga, t.team_3pm, t.team_3pa, t.team_ftm, t.team_fta,
          t.offensive_rebounds, t.defensive_rebounds,
          t.points_allowed, t.result,
          o.team_fgm as opponent_fgm, o.team_fga as opponent_fga,
          o.team_3pm as opponent_3pm, o.team_3pa as opponent_3pa,
          o.team_ftm as opponent_ftm, o.team_fta as opponent_fta,
          o.team_turnovers as opponent_turnovers,
          o.offensive_rebounds as opponent_offensive_rebounds,
          o.defensive_rebounds as opponent_defensive_rebounds
        from team_per_game t
        join team_per_game o on o.game_id = t.game_id and o.team_id = t.opponent_team_id
      )
      select
        *,
        0.5 * (
          (team_fga + 0.44 * team_fta - offensive_rebounds + team_turnovers) +
          (opponent_fga + 0.44 * opponent_fta - opponent_offensive_rebounds + opponent_turnovers)
        ) as estimated_possessions,
        (team_points::numeric / nullif(0.5 * (
          (team_fga + 0.44 * team_fta - offensive_rebounds + team_turnovers) +
          (opponent_fga + 0.44 * opponent_fta - opponent_offensive_rebounds + opponent_turnovers)
        ), 0)) * 100 as offensive_rating,
        (points_allowed::numeric / nullif(0.5 * (
          (team_fga + 0.44 * team_fta - offensive_rebounds + team_turnovers) +
          (opponent_fga + 0.44 * opponent_fta - opponent_offensive_rebounds + opponent_turnovers)
        ), 0)) * 100 as defensive_rating,
        0.5 * (
          (team_fga + 0.44 * team_fta - offensive_rebounds + team_turnovers) +
          (opponent_fga + 0.44 * opponent_fta - opponent_offensive_rebounds + opponent_turnovers)
        ) as pace,
        (team_fgm + 0.5 * team_3pm)::numeric / nullif(team_fga, 0) as efg_pct,
        team_turnovers::numeric / nullif(team_fga + 0.44 * team_fta + team_turnovers, 0) as tov_pct,
        offensive_rebounds::numeric / nullif(offensive_rebounds + opponent_defensive_rebounds, 0) as orb_pct
      from with_opponent`;

    const tgs = await client.query(teamStatsQuery, gameIds);
    console.log(`  Upserting ${tgs.rows.length} team game stat rows...`);
    await client.query('begin');
    for (const r of tgs.rows) {
      await client.query(upsertTeamGameStats, [
        r.team_id, r.game_id, r.season, r.game_date, r.opponent_team_id, r.is_home,
        r.team_points, r.team_rebounds, r.team_assists, r.team_steals, r.team_blocks, r.team_turnovers,
        r.team_fgm, r.team_fga, r.team_3pm, r.team_3pa, r.team_ftm, r.team_fta,
        r.offensive_rebounds, r.defensive_rebounds,
        r.opponent_fgm, r.opponent_fga, r.opponent_3pm, r.opponent_3pa, r.opponent_ftm, r.opponent_fta,
        r.opponent_turnovers, r.opponent_offensive_rebounds, r.opponent_defensive_rebounds,
        r.points_allowed, r.result,
        r.estimated_possessions, r.offensive_rating, r.defensive_rating, r.pace, r.efg_pct, r.tov_pct, r.orb_pct,
      ]);
    }
    await client.query('commit');
    result.teamGameStats = tgs.rows.length;
    console.log('  Done.');

    // Recompute team_season_averages for affected seasons (needs full season data)
    const affectedSeasons = [...new Set(finalGames.map((g: any) => String(g.season)).filter(Boolean))];
    if (affectedSeasons.length > 0) {
      const seasonPlaceholders = affectedSeasons.map((_: any, i: number) => `$${i + 1}`).join(',');
      const tsaRes = await client.query(
        `select
          team_id, season, count(*)::int as games_played,
          avg(team_points) as avg_points, avg(team_rebounds) as avg_rebounds,
          avg(team_assists) as avg_assists, avg(team_steals) as avg_steals,
          avg(team_blocks) as avg_blocks, avg(team_turnovers) as avg_turnovers,
          avg(team_fgm) as avg_fgm, avg(team_fga) as avg_fga,
          avg(team_3pm) as avg_3pm, avg(team_3pa) as avg_3pa,
          avg(team_ftm) as avg_ftm, avg(team_fta) as avg_fta,
          avg(points_allowed) as avg_points_allowed,
          count(*) filter (where result = 'W')::int as wins,
          count(*) filter (where result = 'L')::int as losses,
          count(*) filter (where is_home and result = 'W')::int as home_wins,
          count(*) filter (where is_home and result = 'L')::int as home_losses,
          count(*) filter (where not is_home and result = 'W')::int as away_wins,
          count(*) filter (where not is_home and result = 'L')::int as away_losses,
          case
            when count(*) filter (where result in ('W','L')) > 0
            then count(*) filter (where result = 'W')::numeric / count(*) filter (where result in ('W','L'))
            else null
          end as win_pct,
          avg(offensive_rating) as avg_offensive_rating,
          avg(defensive_rating) as avg_defensive_rating,
          avg(pace) as avg_pace,
          avg(efg_pct) as avg_efg_pct,
          avg(tov_pct) as avg_tov_pct,
          avg(orb_pct) as avg_orb_pct
        from analytics.team_game_stats
        where season in (${seasonPlaceholders})
        group by team_id, season`,
        affectedSeasons,
      );

      console.log(`  Recomputing ${tsaRes.rows.length} team season averages for seasons: ${affectedSeasons.join(', ')}...`);
      await client.query('begin');
      for (const r of tsaRes.rows) {
        await client.query(upsertTeamSeasonAverages, [
          r.team_id, r.season, r.games_played,
          r.avg_points, r.avg_rebounds, r.avg_assists, r.avg_steals, r.avg_blocks, r.avg_turnovers,
          r.avg_fgm, r.avg_fga, r.avg_3pm, r.avg_3pa, r.avg_ftm, r.avg_fta,
          r.avg_points_allowed, r.wins, r.losses, r.home_wins, r.home_losses, r.away_wins, r.away_losses, r.win_pct,
          r.avg_offensive_rating, r.avg_defensive_rating, r.avg_pace, r.avg_efg_pct, r.avg_tov_pct, r.avg_orb_pct,
        ]);
      }
      await client.query('commit');
      result.teamSeasonAvgs = tsaRes.rows.length;
      console.log('  Done.');
    }

    // Step 9: Compute player_season_averages for affected players
    const affectedPlayerIds = [...new Set(allStats.map((s: any) => String(s.player?.id)).filter(Boolean))];
    if (affectedPlayerIds.length > 0) {
      const playerPlaceholders = affectedPlayerIds.map((_: any, i: number) => `$${i + 1}`).join(',');
      const psaRes = await client.query(
        `select
          player_id, season,
          count(*)::int as games_played,
          avg(points) as pts_avg,
          avg(rebounds) as reb_avg,
          avg(assists) as ast_avg,
          avg(steals) as stl_avg,
          avg(blocks) as blk_avg,
          avg(turnovers) as turnover_avg,
          avg(pra) as pra_avg,
          case when sum(field_goals_attempted) > 0 then sum(field_goals_made)::numeric / sum(field_goals_attempted) else null end as fg_pct,
          case when sum(three_pointers_attempted) > 0 then sum(three_pointers_made)::numeric / sum(three_pointers_attempted) else null end as fg3_pct,
          case when sum(free_throws_attempted) > 0 then sum(free_throws_made)::numeric / sum(free_throws_attempted) else null end as ft_pct
        from analytics.player_game_logs
        where player_id in (${playerPlaceholders})
          and season is not null and season <> ''
        group by player_id, season`,
        affectedPlayerIds,
      );

      console.log(`[9/9] Upserting ${psaRes.rows.length} player season averages...`);
      await client.query('begin');
      for (const r of psaRes.rows) {
        await client.query(upsertPlayerSeasonAverages, [
          r.player_id, r.season, r.games_played ?? 0,
          r.pts_avg ?? null, r.reb_avg ?? null, r.ast_avg ?? null,
          r.stl_avg ?? null, r.blk_avg ?? null, r.turnover_avg ?? null, r.pra_avg ?? null,
          r.fg_pct ?? null, r.fg3_pct ?? null, r.ft_pct ?? null,
        ]);
      }
      await client.query('commit');
      result.playerSeasonAvgs = psaRes.rows.length;
      console.log('  Done.');
    }
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return result;
}

// ============================================
// LAMBDA HANDLER
// ============================================

export async function handler(event?: any): Promise<{ statusCode: number; body: string }> {
  const startTime = Date.now();
  console.log('=== Nightly BDL Updater: START ===');
  console.log(`Timestamp: ${new Date().toISOString()}`);

  try {
    const result = await runPipeline();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const summary = {
      status: 'success',
      elapsed_seconds: elapsed,
      ...result,
    };

    console.log('=== SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log('=== Nightly BDL Updater: COMPLETE ===');

    return {
      statusCode: 200,
      body: JSON.stringify(summary),
    };
  } catch (err: any) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error('=== Nightly BDL Updater: FAILED ===');
    console.error(`Elapsed: ${elapsed}s`);
    console.error(err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        status: 'error',
        error: err.message,
        elapsed_seconds: elapsed,
      }),
    };
  } finally {
    // Do not pool.end() in Lambda: container reuse would then break on warm invocations.
    if (require.main === module) {
      await pool.end().catch(() => {});
    }
  }
}

// Allow local execution: npx tsx index.ts
if (require.main === module) {
  handler()
    .then(async (res) => {
      console.log(`Exit: ${res.statusCode}`);
      await pool.end().catch(() => {});
      process.exit(res.statusCode === 200 ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
