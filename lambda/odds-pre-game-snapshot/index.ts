/**
 * Lambda Function: Pre-Game Odds Snapshot
 *
 * Scheduled: an empty event fetches today and tomorrow in America/New_York.
 * Purpose: Fetch those NBA odds from BallDontLie /v2/odds,
 *          store raw snapshots, and transform complete snapshots into analytics tables.
 * The normal path stops at 3 provider pages per date and 6 pages per invocation.
 * A truncated date is INCOMPLETE and does not replace current odds or movement.
 *
 * Prerequisite: nightly-bdl-updater must have run so games exist in analytics.games (runs at 03:00 ET).
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

import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { acquireOdds, OddsPersistError, type OddsProviderRow } from './acquire';
import { BdlRateLimitError, fetchBdlLive } from './bdl-live-rate-limit';
import { isOddsCanaryOnly, isOpeningNightCanaryEvent } from './canary-limits';
import type { PlannedGame } from './collection-planner';
import { createDynamoOddsClaim } from './overlap-claim';
import { parseOddsNumber, providerThrowToPage, shouldReplaceCurrent } from './normal-path';
import { createDynamoOddsBudget } from './request-budget';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;
const BDL_BASE = 'https://api.balldontlie.io/v2';
const PREFERRED_VENDOR = process.env.PREFERRED_VENDOR || 'draftkings';
const OFFSEASON_MODE = process.env.OFFSEASON_MODE === '1';
const CRON_DRY_RUN = process.env.CRON_DRY_RUN === '1';

function getDataMode(): string {
  // Missing / unknown is not live. Only exact live_api enables provider calls.
  return (process.env.DATA_MODE || '').trim().toLowerCase();
}

const DATA_MODE = getDataMode();
const SHOULD_SKIP_MUTATIONS = CRON_DRY_RUN || OFFSEASON_MODE || DATA_MODE !== 'live_api';

if (!SUPABASE_DB_URL) {
  throw new Error('Missing SUPABASE_DB_URL environment variable');
}
if (!SHOULD_SKIP_MUTATIONS && !BALLDONTLIE_API_KEY) {
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

function parseNumeric(val: string | null | undefined): number | null {
  return parseOddsNumber(val);
}

// ============================================
// FETCH ODDS FROM BDL
// ============================================

/** Reserved after the last provider page for snapshot writes and transform. */
const DEADLINE_MARGIN_MS = 45_000;
let runDeadlineMs: number | undefined;

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

async function insertRawSnapshot(pullRunId: number, row: OddsProviderRow): Promise<void> {
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

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original persistence error is the one the run records.
    }
    throw err;
  } finally {
    client.release();
  }
}

async function transformToAnalytics(pullRunId: number): Promise<{ current: number; history: number; movement: number }> {
  let historyCount = 0;
  try {
    historyCount = await withTransaction(async (client) => {
      const allRows = await client.query(
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
      let inserted = 0;
      for (const row of allRows.rows) {
        if (row.provider_updated_at == null) continue;
        const insertResult = await client.query(
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
            row.vendor, row.provider_updated_at, row.pull_run_id,
          ]
        );
        inserted += insertResult.rowCount ?? 0;
      }
      return inserted;
    });
  } catch (err) {
    throw new OddsPersistError(err instanceof Error ? err.message : 'history persistence failed', 'HISTORY_PERSISTENCE');
  }

  let currentCount = 0;
  let affectedGameIds: string[] = [];
  try {
    const current = await withTransaction(async (client) => {
      const latestRows = await client.query(
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
      let applied = 0;
      for (const row of latestRows.rows) {
        if (row.provider_updated_at == null) continue;
        const incomingAt = new Date(row.provider_updated_at).toISOString();
        const existing = await client.query(
          `SELECT snapshot_at FROM analytics.game_odds_current WHERE game_id = $1`,
          [row.game_id]
        );
        if (!shouldReplaceCurrent(existing.rows[0]?.snapshot_at ?? null, incomingAt)) continue;
        const upsertResult = await client.query(
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
             updated_at = now()
           WHERE analytics.game_odds_current.snapshot_at < excluded.snapshot_at`,
          [
            row.game_id,
            row.moneyline_home_odds, row.moneyline_away_odds,
            row.spread_home_value, row.spread_home_odds,
            row.spread_away_value, row.spread_away_odds,
            row.total_value, row.total_over_odds, row.total_under_odds,
            row.vendor,
            row.provider_updated_at,
            row.pull_run_id,
          ]
        );
        applied += upsertResult.rowCount ?? 0;
      }
      return {
        applied,
        gameIds: latestRows.rows.map((row: { game_id: string }) => String(row.game_id)),
      };
    });
    currentCount = current.applied;
    affectedGameIds = current.gameIds;
  } catch (err) {
    throw new OddsPersistError(err instanceof Error ? err.message : 'current persistence failed', 'CURRENT_PERSISTENCE');
  }

  let movementCount = 0;
  try {
    movementCount = await refreshLineMovementSummary(affectedGameIds);
  } catch (err) {
    throw new OddsPersistError(err instanceof Error ? err.message : 'movement persistence failed', 'MOVEMENT_PERSISTENCE');
  }

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
         open_home_spread = COALESCE(analytics.game_line_movement_summary.open_home_spread, excluded.open_home_spread),
         open_total = COALESCE(analytics.game_line_movement_summary.open_total, excluded.open_total),
         open_home_ml = COALESCE(analytics.game_line_movement_summary.open_home_ml, excluded.open_home_ml),
         current_home_spread = excluded.current_home_spread,
         current_total = excluded.current_total,
         current_home_ml = excluded.current_home_ml,
         spread_movement = excluded.current_home_spread - COALESCE(analytics.game_line_movement_summary.open_home_spread, excluded.open_home_spread),
         total_movement = excluded.current_total - COALESCE(analytics.game_line_movement_summary.open_total, excluded.open_total),
         snapshots_count = excluded.snapshots_count,
         first_seen_at = COALESCE(analytics.game_line_movement_summary.first_seen_at, excluded.first_seen_at),
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

async function loadPlannedGames(date: string): Promise<PlannedGame[]> {
  const games = await pool.query(
    `SELECT g.game_id::text AS game_id, g.season::text AS season,
            to_jsonb(g)->>'season_phase' AS season_phase, g.start_time
     FROM analytics.games g
     WHERE timezone('America/New_York', g.start_time)::date = $1::date`,
    [date]
  );
  const ids = games.rows.map((row: { game_id: string }) => row.game_id);
  const latest = new Map<string, string>();
  if (ids.length > 0) {
    const snaps = await pool.query(
      `SELECT game_id::text AS game_id, max(snapshot_at) AS snapshot_at
       FROM analytics.game_odds_current
       WHERE game_id = ANY($1::text[])
       GROUP BY game_id`,
      [ids]
    );
    for (const row of snaps.rows as { game_id: string; snapshot_at: Date | string }[]) {
      latest.set(row.game_id, row.snapshot_at instanceof Date ? row.snapshot_at.toISOString() : row.snapshot_at);
    }
  }
  return games.rows.map((row: { game_id: string; season: string | null; season_phase: string | null; start_time: Date | string | null }) => ({
    gameId: row.game_id,
    season: row.season,
    seasonPhase: row.season_phase,
    startTime: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
    latestSnapshotAt: latest.get(row.game_id) ?? null,
  }));
}

async function loadGames(gameIds: string[]) {
  const result = await pool.query(
    `SELECT g.game_id::text AS game_id, g.season::text AS season,
            to_jsonb(g)->>'season_phase' AS season_phase, g.start_time
     FROM analytics.games g
     WHERE g.game_id = ANY($1::text[])`,
    [gameIds]
  );
  return result.rows.map((row: { game_id: string; season: string | null; season_phase: string | null; start_time: Date | string | null }) => ({
    gameId: row.game_id,
    season: row.season,
    seasonPhase: row.season_phase,
    startTime: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
  }));
}

async function fetchOddsPage(dateStr: string, cursor: number | null) {
  const url = new URL(`${BDL_BASE}/odds`);
  url.searchParams.set('dates[]', dateStr);
  url.searchParams.set('per_page', '100');
  if (cursor != null) url.searchParams.set('cursor', String(cursor));
  console.log(`Fetching odds: ${url.toString()}`);

  try {
    const res = await fetchBdlLive(
      url.toString(),
      { headers: { Authorization: BALLDONTLIE_API_KEY as string } },
      { worker: 'odds-pre-game-snapshot', deadlineMs: runDeadlineMs }
    );
    if (!res.ok) {
      await res.text().catch(() => '');
      return { ok: false as const, status: res.status };
    }
    const parsed = BdlOddsResponseSchema.parse(await res.json());
    return {
      ok: true as const,
      rows: parsed.data,
      nextCursor: parsed.meta?.next_cursor ?? null,
    };
  } catch (err) {
    const translated = providerThrowToPage(err);
    if (translated && 'status' in translated) return translated;
    if (translated?.timeout) {
      const timeout = new Error(translated.message);
      (timeout as Error & { timeout?: boolean }).timeout = true;
      throw timeout;
    }
    if (err instanceof BdlRateLimitError) throw err;
    throw err;
  }
}

export const handler = async (
  event: LambdaEvent,
  context?: { getRemainingTimeInMillis?: () => number; awsRequestId?: string }
) => {
  const remainingMs = context?.getRemainingTimeInMillis?.();
  runDeadlineMs = remainingMs != null ? Date.now() + remainingMs - DEADLINE_MARGIN_MS : undefined;
  try {
    console.log('Starting pre-game odds snapshot (BallDontLie /v2/odds)...');
    console.log('Event:', JSON.stringify(event));
    console.log(`Preferred vendor: ${PREFERRED_VENDOR}`);

    if (SHOULD_SKIP_MUTATIONS) {
      console.log(
        `[offseason] Skipping odds provider calls and writes (DATA_MODE=${DATA_MODE}, OFFSEASON_MODE=${OFFSEASON_MODE ? '1' : '0'}, CRON_DRY_RUN=${CRON_DRY_RUN ? '1' : '0'}).`
      );
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          skipped: true,
          reason: 'Odds snapshot skipped by runtime mode flags',
          dataMode: DATA_MODE,
          offseasonMode: OFFSEASON_MODE,
          cronDryRun: CRON_DRY_RUN,
          timestamp: new Date().toISOString(),
        }),
      };
    }

    const budget = createDynamoOddsBudget({ tableName: process.env.BDL_RATE_LIMIT_TABLE });
    const claim = createDynamoOddsClaim({ tableName: process.env.BDL_RATE_LIMIT_TABLE });
    const outcome = await acquireOdds(event, {
      env: process.env,
      now: () => new Date(),
      preferredVendor: PREFERRED_VENDOR,
      fetchPage: fetchOddsPage,
      createPullRun,
      completePullRun,
      insertRaw: insertRawSnapshot,
      loadGames,
      transformComplete: transformToAnalytics,
      requireSafety: true,
      slateForDate: loadPlannedGames,
      reserveAttempt: (input) => budget.reserve(input),
      recordAttempt: (input) => budget.record(input),
      claimDate: (input) => claim.claim(input),
      completeClaim: (input) => claim.complete(input),
      claimOwner: context?.awsRequestId ?? 'odds-pre-game-snapshot',
    });
    console.log('Summary:', JSON.stringify(outcome));
    return {
      statusCode: outcome.httpStatus,
      body: JSON.stringify({ ...outcome, timestamp: new Date().toISOString() }),
    };
  } catch (error: any) {
    console.error('Error in pre-game odds snapshot:', error);
    if (isOddsCanaryOnly(process.env) || isOpeningNightCanaryEvent(event)) throw error;
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
