/**
 * Lambda Function: Pre-Game Odds Snapshot
 *
 * Scheduled: Every 30 min from 10am–12pm ET via EventBridge
 * Purpose: Fetch today's NBA game odds from BallDontLie /v2/odds,
 *          store raw snapshots, and transform into analytics tables.
 *
 * Prerequisite: nightly-bdl-updater must have run so today's games
 *               exist in analytics.games (runs at 03:00 ET).
 *
 * Pipeline: BDL /v2/odds -> raw.odds_pull_runs + raw.odds_snapshots
 *           -> analytics.game_odds_current + analytics.game_odds_history
 *           -> analytics.game_line_movement_summary
 *
 * Environment Variables:
 * - SUPABASE_DB_URL (required)
 * - BALLDONTLIE_API_KEY (required)
 * - PREFERRED_VENDOR (optional, defaults to 'draftkings')
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
  // dotenv not available in Lambda — env vars set via configuration
}

import { Pool } from 'pg';
import { z } from 'zod';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;
const BDL_BASE = 'https://api.balldontlie.io/v2';
const PREFERRED_VENDOR = process.env.PREFERRED_VENDOR || 'draftkings';

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
  max: 1,
  ssl: { rejectUnauthorized: false },
});

// ============================================
// ZOD SCHEMAS
// ============================================

const BdlOddsRowSchema = z.object({
  id: z.number(),
  game_id: z.number(),
  vendor: z.string(),
  spread_home_value: z.string().nullable().optional(),
  spread_home_odds: z.number().nullable().optional(),
  spread_away_value: z.string().nullable().optional(),
  spread_away_odds: z.number().nullable().optional(),
  moneyline_home_odds: z.number().nullable().optional(),
  moneyline_away_odds: z.number().nullable().optional(),
  total_value: z.string().nullable().optional(),
  total_over_odds: z.number().nullable().optional(),
  total_under_odds: z.number().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

const BdlOddsResponseSchema = z.object({
  data: z.array(BdlOddsRowSchema),
  meta: z.object({
    next_cursor: z.number().nullable().optional(),
    per_page: z.number().optional(),
  }).optional(),
});

type BdlOddsRow = z.infer<typeof BdlOddsRowSchema>;

// ============================================
// HELPERS
// ============================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseNumeric(val: string | null | undefined): number | null {
  if (val == null || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// ============================================
// FETCH ODDS FROM BDL
// ============================================

async function fetchOddsForDate(dateStr: string): Promise<BdlOddsRow[]> {
  const allRows: BdlOddsRow[] = [];
  let cursor: number | null = null;

  while (true) {
    const url = new URL(`${BDL_BASE}/odds`);
    url.searchParams.set('dates[]', dateStr);
    url.searchParams.set('per_page', '100');
    if (cursor != null) {
      url.searchParams.set('cursor', String(cursor));
    }

    console.log(`Fetching odds: ${url.toString().replace(/Authorization=[^&]+/, 'Authorization=***')}`);

    const res = await fetch(url.toString(), {
      headers: { Authorization: BALLDONTLIE_API_KEY as string },
    });

    if (res.status === 429) {
      console.warn('Rate limited, waiting 60s...');
      await sleep(60000);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`BDL API error: ${res.status} ${res.statusText} — ${body}`);
    }

    const json = await res.json();
    const parsed = BdlOddsResponseSchema.parse(json);
    allRows.push(...parsed.data);

    cursor = parsed.meta?.next_cursor ?? null;
    if (cursor == null) break;

    await sleep(200);
  }

  return allRows;
}

// ============================================
// RAW STORAGE
// ============================================

async function createPullRun(dateQueried: string): Promise<number> {
  const result = await pool.query(
    `INSERT INTO raw.odds_pull_runs (pulled_at, provider, date_queried, status)
     VALUES (now(), 'balldontlie', $1, 'started')
     RETURNING pull_run_id`,
    [dateQueried]
  );
  return result.rows[0].pull_run_id;
}

async function completePullRun(
  pullRunId: number,
  rowsReturned: number,
  rowsStored: number,
  status: 'success' | 'error',
  metadata?: Record<string, unknown>,
  errorMessage?: string
): Promise<void> {
  await pool.query(
    `UPDATE raw.odds_pull_runs
     SET rows_returned = $2, rows_stored = $3, status = $4,
         metadata = $5, error_message = $6, completed_at = now()
     WHERE pull_run_id = $1`,
    [pullRunId, rowsReturned, rowsStored, status, metadata ? JSON.stringify(metadata) : null, errorMessage || null]
  );
}

async function insertRawSnapshot(pullRunId: number, row: BdlOddsRow): Promise<void> {
  await pool.query(
    `INSERT INTO raw.odds_snapshots (
       pull_run_id, bdl_odds_id, bdl_game_id, game_id, vendor,
       spread_home_value, spread_home_odds, spread_away_value, spread_away_odds,
       moneyline_home_odds, moneyline_away_odds,
       total_value, total_over_odds, total_under_odds,
       provider_updated_at, raw_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      pullRunId,
      row.id,
      row.game_id,
      String(row.game_id),
      row.vendor,
      parseNumeric(row.spread_home_value),
      row.spread_home_odds ?? null,
      parseNumeric(row.spread_away_value),
      row.spread_away_odds ?? null,
      row.moneyline_home_odds ?? null,
      row.moneyline_away_odds ?? null,
      parseNumeric(row.total_value),
      row.total_over_odds ?? null,
      row.total_under_odds ?? null,
      row.updated_at ? new Date(row.updated_at) : null,
      JSON.stringify(row),
    ]
  );
}

// ============================================
// ANALYTICS TRANSFORM (inline)
// ============================================

async function transformToAnalytics(pullRunId: number): Promise<{ current: number; history: number; movement: number }> {
  let currentCount = 0;
  let historyCount = 0;

  // Get the latest snapshot per game+vendor from this pull run,
  // filtering to preferred vendor for current odds.
  const latestRows = await pool.query(
    `SELECT DISTINCT ON (game_id)
       game_id, vendor,
       spread_home_value, spread_home_odds, spread_away_value, spread_away_odds,
       moneyline_home_odds, moneyline_away_odds,
       total_value, total_over_odds, total_under_odds,
       provider_updated_at, pull_run_id
     FROM raw.odds_snapshots
     WHERE pull_run_id = $1
       AND vendor = $2
       AND game_id IN (SELECT game_id FROM analytics.games)
     ORDER BY game_id, provider_updated_at DESC NULLS LAST`,
    [pullRunId, PREFERRED_VENDOR]
  );

  for (const row of latestRows.rows) {
    // Upsert current odds
    const upsertResult = await pool.query(
      `INSERT INTO analytics.game_odds_current (
         game_id, home_moneyline, away_moneyline,
         home_spread, home_spread_odds, away_spread, away_spread_odds,
         total, over_odds, under_odds,
         vendor, snapshot_at, pull_run_id, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
       ON CONFLICT (game_id) DO UPDATE SET
         home_moneyline = excluded.home_moneyline,
         away_moneyline = excluded.away_moneyline,
         home_spread = excluded.home_spread,
         home_spread_odds = excluded.home_spread_odds,
         away_spread = excluded.away_spread,
         away_spread_odds = excluded.away_spread_odds,
         total = excluded.total,
         over_odds = excluded.over_odds,
         under_odds = excluded.under_odds,
         vendor = excluded.vendor,
         snapshot_at = excluded.snapshot_at,
         pull_run_id = excluded.pull_run_id,
         updated_at = now()`,
      [
        row.game_id,
        row.moneyline_home_odds, row.moneyline_away_odds,
        row.spread_home_value, row.spread_home_odds,
        row.spread_away_value, row.spread_away_odds,
        row.total_value, row.total_over_odds, row.total_under_odds,
        row.vendor,
        row.provider_updated_at || new Date(),
        row.pull_run_id,
      ]
    );
    currentCount += upsertResult.rowCount ?? 0;
  }

  // Append all vendor rows from this run to history (deduped by unique constraint)
  const allRows = await pool.query(
    `SELECT game_id, vendor,
       spread_home_value, spread_home_odds, spread_away_value, spread_away_odds,
       moneyline_home_odds, moneyline_away_odds,
       total_value, total_over_odds, total_under_odds,
       provider_updated_at, pull_run_id
     FROM raw.odds_snapshots
     WHERE pull_run_id = $1
       AND game_id IN (SELECT game_id FROM analytics.games)`,
    [pullRunId]
  );

  for (const row of allRows.rows) {
    const snapshotAt = row.provider_updated_at || new Date();
    const insertResult = await pool.query(
      `INSERT INTO analytics.game_odds_history (
         game_id, home_moneyline, away_moneyline,
         home_spread, home_spread_odds, away_spread, away_spread_odds,
         total, over_odds, under_odds,
         vendor, snapshot_at, pull_run_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (game_id, vendor, snapshot_at) DO NOTHING`,
      [
        row.game_id,
        row.moneyline_home_odds, row.moneyline_away_odds,
        row.spread_home_value, row.spread_home_odds,
        row.spread_away_value, row.spread_away_odds,
        row.total_value, row.total_over_odds, row.total_under_odds,
        row.vendor, snapshotAt, row.pull_run_id,
      ]
    );
    historyCount += insertResult.rowCount ?? 0;
  }

  // Refresh line movement summary for affected games
  const affectedGameIds = [...new Set(allRows.rows.map((r: any) => r.game_id))];
  const movementCount = await refreshLineMovementSummary(affectedGameIds);

  return { current: currentCount, history: historyCount, movement: movementCount };
}

async function refreshLineMovementSummary(gameIds: string[]): Promise<number> {
  if (gameIds.length === 0) return 0;
  let count = 0;

  for (const gameId of gameIds) {
    const result = await pool.query(
      `INSERT INTO analytics.game_line_movement_summary (
         game_id,
         open_home_spread, open_total, open_home_ml,
         current_home_spread, current_total, current_home_ml,
         spread_movement, total_movement,
         snapshots_count, first_seen_at, last_seen_at, updated_at
       )
       SELECT
         $1,
         first_snap.home_spread, first_snap.total, first_snap.home_moneyline,
         last_snap.home_spread, last_snap.total, last_snap.home_moneyline,
         last_snap.home_spread - first_snap.home_spread,
         last_snap.total - first_snap.total,
         stats.cnt, stats.first_at, stats.last_at, now()
       FROM (
         SELECT home_spread, total, home_moneyline
         FROM analytics.game_odds_history
         WHERE game_id = $1 AND vendor = $2
         ORDER BY snapshot_at ASC
         LIMIT 1
       ) first_snap,
       (
         SELECT home_spread, total, home_moneyline
         FROM analytics.game_odds_history
         WHERE game_id = $1 AND vendor = $2
         ORDER BY snapshot_at DESC
         LIMIT 1
       ) last_snap,
       (
         SELECT count(*)::int as cnt, min(snapshot_at) as first_at, max(snapshot_at) as last_at
         FROM analytics.game_odds_history
         WHERE game_id = $1 AND vendor = $2
       ) stats
       ON CONFLICT (game_id) DO UPDATE SET
         open_home_spread = excluded.open_home_spread,
         open_total = excluded.open_total,
         open_home_ml = excluded.open_home_ml,
         current_home_spread = excluded.current_home_spread,
         current_total = excluded.current_total,
         current_home_ml = excluded.current_home_ml,
         spread_movement = excluded.spread_movement,
         total_movement = excluded.total_movement,
         snapshots_count = excluded.snapshots_count,
         first_seen_at = excluded.first_seen_at,
         last_seen_at = excluded.last_seen_at,
         updated_at = now()`,
      [gameId, PREFERRED_VENDOR]
    );
    count += result.rowCount ?? 0;
  }

  return count;
}

// ============================================
// LAMBDA HANDLER
// ============================================

interface LambdaEvent {
  source?: string;
  'detail-type'?: string;
  time?: string;
  date?: string;     // single date override
  dates?: string[];  // multiple dates override
}

function getTodayET(): string[] {
  return [new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })];
}

async function processDate(dateStr: string): Promise<{
  date: string;
  pullRunId: number;
  rowsFetched: number;
  rowsStored: number;
  uniqueGames: number;
  uniqueVendors: number;
  transform: { current: number; history: number; movement: number };
}> {
  const pullRunId = await createPullRun(dateStr);
  console.log(`[${dateStr}] Created pull run: ${pullRunId}`);

  const oddsRows = await fetchOddsForDate(dateStr);
  console.log(`[${dateStr}] Fetched ${oddsRows.length} odds rows from BDL`);

  if (oddsRows.length === 0) {
    await completePullRun(pullRunId, 0, 0, 'success', { message: 'No odds returned' });
    return { date: dateStr, pullRunId, rowsFetched: 0, rowsStored: 0, uniqueGames: 0, uniqueVendors: 0, transform: { current: 0, history: 0, movement: 0 } };
  }

  let stored = 0;
  for (const row of oddsRows) {
    try {
      await insertRawSnapshot(pullRunId, row);
      stored++;
    } catch (err: any) {
      console.error(`[${dateStr}] Error storing snapshot for game ${row.game_id} vendor ${row.vendor}:`, err.message);
    }
  }
  console.log(`[${dateStr}] Stored ${stored}/${oddsRows.length} raw snapshots`);

  const transformResult = await transformToAnalytics(pullRunId);
  console.log(`[${dateStr}] Transform — current: ${transformResult.current}, history: ${transformResult.history}, movement: ${transformResult.movement}`);

  const vendors = [...new Set(oddsRows.map(r => r.vendor))];
  const games = [...new Set(oddsRows.map(r => r.game_id))];
  await completePullRun(pullRunId, oddsRows.length, stored, 'success', {
    vendors,
    gamesCount: games.length,
    transform: transformResult,
  });

  return { date: dateStr, pullRunId, rowsFetched: oddsRows.length, rowsStored: stored, uniqueGames: games.length, uniqueVendors: vendors.length, transform: transformResult };
}

export const handler = async (event: LambdaEvent) => {
  try {
    console.log('Starting pre-game odds snapshot (BallDontLie /v2/odds)...');
    console.log('Event:', JSON.stringify(event));
    console.log(`Preferred vendor: ${PREFERRED_VENDOR}`);

    const dates = event.dates
      || (event.date ? [event.date] : getTodayET());
    console.log(`Fetching odds for dates: ${dates.join(', ')}`);

    const results = [];
    for (const dateStr of dates) {
      try {
        const result = await processDate(dateStr);
        results.push(result);
      } catch (err: any) {
        console.error(`Error processing ${dateStr}:`, err.message);
        results.push({ date: dateStr, error: err.message });
      }
    }

    const totalFetched = results.reduce((s, r) => s + ((r as any).rowsFetched || 0), 0);
    const totalStored = results.reduce((s, r) => s + ((r as any).rowsStored || 0), 0);

    const summary = { dates, results, totalFetched, totalStored, timestamp: new Date().toISOString() };
    console.log('Summary:', JSON.stringify(summary, null, 2));

    return { statusCode: 200, body: JSON.stringify({ success: true, ...summary }) };
  } catch (error: any) {
    console.error('Error in pre-game odds snapshot:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message || 'Unknown error', timestamp: new Date().toISOString() }),
    };
  }
};

// For local testing — run if executed directly
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('index.ts') ||
  process.argv[1].endsWith('index.js') ||
  process.argv[1].includes('odds-pre-game-snapshot')
);

if (isMainModule) {
  const dateArgs = process.argv.filter(a => a.match(/^\d{4}-\d{2}-\d{2}$/));
  const event = dateArgs.length > 0 ? { dates: dateArgs } : {};
  handler(event).then((result) => {
    console.log('\n=== Lambda Response ===');
    console.log(JSON.stringify(JSON.parse(result.body), null, 2));
    pool.end().then(() => {
      console.log('\nDone.');
      process.exit(0);
    });
  }).catch((error) => {
    console.error('Error:', error);
    pool.end().finally(() => process.exit(1));
  });
}
