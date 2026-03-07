/**
 * Seed raw schema from BallDontLie API.
 * Populates raw.teams, raw.players, raw.games; optionally raw.player_game_stats and raw.season_averages.
 *
 * Prerequisites: Run db/schemas/raw_schema.sql first.
 *
 * Usage:
 *   npx tsx scripts/seed-raw-balldontlie.ts                    # teams + players + games (current season, full)
 *   npx tsx scripts/seed-raw-balldontlie.ts --season 2025       # games for season 2025
 *   npx tsx scripts/seed-raw-balldontlie.ts --start 2025-10-01 --end 2025-11-01
 *   npx tsx scripts/seed-raw-balldontlie.ts --stats              # also fetch player_game_stats for games in raw.games
 *   npx tsx scripts/seed-raw-balldontlie.ts --season-averages --season 2025  # also fetch season_averages for players in raw.players
 *
 * Env: BALLDONTLIE_REQUEST_DELAY_MS — delay between API calls (ms). Default 200 (GOAT 600/min). Free tier: set to 12000.
 */

import 'dotenv/config';
import { Pool } from 'pg';

const BDL_BASE = 'https://api.balldontlie.io/v1';
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;
// Default 200ms ≈ 300 req/min (GOAT 600/min). Free tier (5 req/min): set BALLDONTLIE_REQUEST_DELAY_MS=12000
const REQUEST_DELAY_MS = Number.parseInt(process.env.BALLDONTLIE_REQUEST_DELAY_MS || '200', 10);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 60000;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in .env');
  process.exit(1);
}
if (!BALLDONTLIE_API_KEY) {
  console.error('Missing BALLDONTLIE_API_KEY. Set it in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetchWithRetry = async (
  url: string,
  opts: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, opts);
    if (res.status === 429) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Rate limited. Waiting ${delay / 1000}s...`);
      await sleep(delay);
      continue;
    }
    if (res.status >= 500 && attempt < retries) {
      await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
      continue;
    }
    return res;
  }
  throw new Error(`Failed after ${retries + 1} attempts`);
};

const authHeader = () => ({ Authorization: BALLDONTLIE_API_KEY as string });

// --- Teams ---
async function fetchTeams(): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (true) {
    const res = await fetchWithRetry(`${BDL_BASE}/teams?page=${page}`, { headers: authHeader() });
    if (!res.ok) throw new Error(`Teams ${res.status}`);
    const json = await res.json();
    out.push(...(json.data || []));
    if (!json.meta?.next_page) break;
    page = json.meta.next_page;
    await sleep(REQUEST_DELAY_MS);
  }
  return out;
}

// --- Players (NBA) ---
async function fetchPlayers(): Promise<any[]> {
  const out: any[] = [];
  let cursor: number | null = null;
  while (true) {
    const params = new URLSearchParams({ per_page: '100' });
    if (cursor != null) params.set('cursor', String(cursor));
    const res = await fetchWithRetry(
      `${BDL_BASE}/players?${params.toString()}`,
      { headers: authHeader() },
    );
    if (!res.ok) throw new Error(`Players ${res.status}`);
    const json = await res.json();
    out.push(...(json.data || []));
    cursor = json.meta?.next_cursor ?? null;
    if (cursor == null) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return out;
}

// --- Games ---
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
    const res = await fetchWithRetry(
      `${BDL_BASE}/games?${params.toString()}`,
      { headers: authHeader() },
    );
    if (!res.ok) throw new Error(`Games ${res.status}`);
    const json = await res.json();
    out.push(...(json.data || []));
    cursor = json.meta?.next_cursor ?? null;
    if (cursor == null) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return out;
}

// --- Stats (player game stats by game_ids) ---
async function fetchStatsByGameIds(gameIds: number[]): Promise<any[]> {
  const out: any[] = [];
  let cursor: number | null = null;
  const params = new URLSearchParams();
  gameIds.forEach((id) => params.append('game_ids[]', String(id)));
  params.set('per_page', '100');
  const base = `${BDL_BASE}/stats?${params.toString()}`;
  while (true) {
    const url = cursor == null ? base : `${base}&cursor=${cursor}`;
    const res = await fetchWithRetry(url, { headers: authHeader() });
    if (!res.ok) throw new Error(`Stats ${res.status}`);
    const json = await res.json();
    out.push(...(json.data || []));
    cursor = json.meta?.next_cursor ?? null;
    if (cursor == null) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return out;
}

// --- Season averages (one call per player_id + season) ---
async function fetchSeasonAverages(playerId: number, season: number): Promise<any[]> {
  const res = await fetchWithRetry(
    `${BDL_BASE}/season_averages?player_id=${playerId}&season=${season}`,
    { headers: authHeader() },
  );
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

// --- Insert raw.teams ---
const upsertRawTeam = `
  insert into raw.teams (id, abbreviation, city, conference, division, full_name, name)
  values ($1, $2, $3, $4, $5, $6, $7)
  on conflict (id) do update set
    abbreviation = excluded.abbreviation,
    city = excluded.city,
    conference = excluded.conference,
    division = excluded.division,
    full_name = excluded.full_name,
    name = excluded.name;
`;

// --- Insert raw.players ---
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

// --- Insert raw.games ---
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

// --- Insert raw.player_game_stats ---
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

// --- Insert raw.season_averages ---
const upsertRawSeasonAvg = `
  insert into raw.season_averages (
    player_id, season, games_played, pts, ast, reb, stl, blk, turnover, min,
    fgm, fga, fg_pct, fg3m, fg3a, fg3_pct, ftm, fta, ft_pct, oreb, dreb
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
  on conflict (player_id, season) do update set
    games_played = excluded.games_played, pts = excluded.pts, ast = excluded.ast, reb = excluded.reb,
    stl = excluded.stl, blk = excluded.blk, turnover = excluded.turnover, min = excluded.min,
    fgm = excluded.fgm, fga = excluded.fga, fg_pct = excluded.fg_pct,
    fg3m = excluded.fg3m, fg3a = excluded.fg3a, fg3_pct = excluded.fg3_pct,
    ftm = excluded.ftm, fta = excluded.fta, ft_pct = excluded.ft_pct,
    oreb = excluded.oreb, dreb = excluded.dreb;
`;

function parseArgs(): {
  season: number;
  startDate: string;
  endDate: string;
  withStats: boolean;
  withSeasonAverages: boolean;
} {
  const args = process.argv.slice(2);
  let season = new Date().getFullYear();
  const now = new Date();
  const month = now.getMonth();
  if (month < 6) season -= 1; // Jan–Jun → previous season
  let startDate = `${season}-10-01`;
  let endDate = `${season + 1}-04-15`;
  let withStats = false;
  let withSeasonAverages = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--season' && args[i + 1]) {
      season = Number(args[++i]);
      startDate = `${season}-10-01`;
      endDate = `${season + 1}-04-15`;
    } else if (args[i] === '--start' && args[i + 1]) startDate = args[++i];
    else if (args[i] === '--end' && args[i + 1]) endDate = args[++i];
    else if (args[i] === '--stats') withStats = true;
    else if (args[i] === '--season-averages') withSeasonAverages = true;
  }
  return { season, startDate, endDate, withStats, withSeasonAverages };
}

async function main() {
  const { season, startDate, endDate, withStats, withSeasonAverages } = parseArgs();
  const client = await pool.connect();

  try {
    // 1. Teams
    console.log('Fetching teams...');
    const teams = await fetchTeams();
    console.log(`Fetched ${teams.length} teams.`);
    await client.query('begin');
    for (const t of teams) {
      await client.query(upsertRawTeam, [
        t.id,
        t.abbreviation ?? null,
        t.city ?? null,
        t.conference ?? null,
        t.division ?? null,
        t.full_name ?? null,
        t.name ?? null,
      ]);
    }
    await client.query('commit');
    console.log('Wrote raw.teams.');

    // 2. Players
    console.log('Fetching players...');
    const players = await fetchPlayers();
    console.log(`Fetched ${players.length} players.`);
    await client.query('begin');
    for (const p of players) {
      const teamId = p.team?.id ?? null;
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
        teamId,
      ]);
    }
    await client.query('commit');
    console.log('Wrote raw.players.');

    // 3. Games
    console.log(`Fetching games ${startDate}..${endDate} (season ${season})...`);
    const games = await fetchGames(startDate, endDate, season);
    console.log(`Fetched ${games.length} games.`);
    await client.query('begin');
    for (const g of games) {
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
    console.log('Wrote raw.games.');

    // 4. Optional: player_game_stats for games we have
    if (withStats && games.length > 0) {
      const gameIds = games.map((g: any) => g.id);
      console.log(`Fetching stats for ${gameIds.length} games (in batches of 25)...`);
      const batchSize = 25;
      for (let i = 0; i < gameIds.length; i += batchSize) {
        const batch = gameIds.slice(i, i + batchSize);
        const stats = await fetchStatsByGameIds(batch);
        await client.query('begin');
        for (const s of stats) {
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
        console.log(`  Stats batch: ${stats.length} rows.`);
        await sleep(REQUEST_DELAY_MS);
      }
      console.log('Wrote raw.player_game_stats.');
    }

    // 5. Optional: season_averages per player for given season
    if (withSeasonAverages && players.length > 0) {
      console.log(`Fetching season_averages for season ${season} (${players.length} players)...`);
      let count = 0;
      for (const p of players) {
        const rows = await fetchSeasonAverages(p.id, season);
        await client.query('begin');
        for (const row of rows) {
          await client.query(upsertRawSeasonAvg, [
            row.player_id ?? p.id,
            row.season ?? season,
            row.games_played ?? null,
            row.pts ?? null,
            row.ast ?? null,
            row.reb ?? null,
            row.stl ?? null,
            row.blk ?? null,
            row.turnover ?? null,
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
          ]);
          count++;
        }
        await client.query('commit');
        await sleep(REQUEST_DELAY_MS);
      }
      console.log(`Wrote raw.season_averages (${count} rows).`);
    }

    console.log('Done.');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
