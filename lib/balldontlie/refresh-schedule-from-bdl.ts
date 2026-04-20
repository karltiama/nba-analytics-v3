/**
 * Upsert BDL games for an inclusive ET calendar date range into raw.games + analytics.games.
 * Used so the betting dashboard sees playoff / same-day schedule changes without waiting for the nightly lambda.
 */

import type { PoolClient } from 'pg';
import pool from '@/lib/db';

const BDL_BASE = 'https://api.balldontlie.io/v1';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url: string, apiKey: string): Promise<Response> {
  const maxRetries = Number.parseInt(process.env.MAX_RETRIES || '3', 10);
  const retryBaseDelayMs = 60000;
  const requestDelayMs = Number.parseInt(process.env.BALLDONTLIE_REQUEST_DELAY_MS || '200', 10);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
    });
    if (res.status === 429) {
      const delay = retryBaseDelayMs * Math.pow(2, attempt);
      console.warn(`[refresh-schedule-from-bdl] Rate limited (429). Waiting ${delay / 1000}s before retry ${attempt + 1}...`);
      await sleep(delay);
      continue;
    }
    if (res.status >= 500 && attempt < maxRetries) {
      const delay = retryBaseDelayMs * Math.pow(2, attempt);
      console.warn(`[refresh-schedule-from-bdl] Server error (${res.status}). Waiting ${delay / 1000}s before retry ${attempt + 1}...`);
      await sleep(delay);
      continue;
    }
    return res;
  }
  throw new Error(`BDL API failed after ${maxRetries + 1} attempts: ${url}`);
}

async function fetchGamesPage(
  startDate: string,
  endDate: string,
  season: number,
  apiKey: string,
): Promise<any[]> {
  const out: any[] = [];
  let cursor: number | null = null;
  const requestDelayMs = Number.parseInt(process.env.BALLDONTLIE_REQUEST_DELAY_MS || '200', 10);

  while (true) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      'seasons[]': String(season),
      per_page: '100',
    });
    if (cursor != null) params.set('cursor', String(cursor));
    const res = await fetchWithRetry(`${BDL_BASE}/games?${params.toString()}`, apiKey);
    if (!res.ok) throw new Error(`Games API returned ${res.status}`);
    const json: any = await res.json();
    out.push(...(json.data || []));
    cursor = json.meta?.next_cursor ?? null;
    if (cursor == null) break;
    await sleep(requestDelayMs);
  }
  return out;
}

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
    console.warn(`[refresh-schedule-from-bdl] Skipping analytics.games for game ${g.id}: missing home or visitor team id`);
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
 * Calendar "today" in America/New_York as YYYY-MM-DD (matches getTodaysGames / betting URL dates).
 */
export function getTodayEtYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Fetch BDL games for inclusive ET dates [startDateET, endDateET] and upsert raw + analytics.
 * @returns number of BDL rows processed, or null if skipped (no API key).
 */
export async function refreshBdlScheduleForEtDateRange(
  startDateET: string,
  endDateET: string,
): Promise<number | null> {
  const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY)?.trim();
  if (!apiKey) {
    console.warn('[refresh-schedule-from-bdl] No BALLDONTLIE_API_KEY; skipping live schedule refresh.');
    return null;
  }

  const season = getCurrentSeason();
  const games = await fetchGamesPage(startDateET, endDateET, season, apiKey);
  if (games.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query('begin');
    const teamIdMap = await buildTeamIdMap(client);
    for (const g of games) {
      await upsertBdlGameRawAndAnalytics(client, g, teamIdMap);
    }
    await client.query('commit');
    return games.length;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
