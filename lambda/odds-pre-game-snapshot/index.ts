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
import { parseOddsNumber, providerThrowToPage } from './normal-path';
import { promotePullOdds } from './pregame-market';
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

async function transformToAnalytics(pullRunId: number) {
  try {
    return await withTransaction((client) => promotePullOdds(client, pullRunId, PREFERRED_VENDOR));
  } catch (err) {
    if (err instanceof OddsPersistError) throw err;
    throw new OddsPersistError(err instanceof Error ? err.message : 'current persistence failed', 'CURRENT_PERSISTENCE');
  }
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
