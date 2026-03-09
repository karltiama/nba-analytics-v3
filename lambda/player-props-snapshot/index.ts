/**
 * Lambda Function: Player Props Snapshot
 *
 * Scheduled: Every 30 min from 10am–12pm ET via EventBridge (offset 5 min from odds)
 * Purpose: Fetch today's NBA player props from BallDontLie /v2/odds/player_props,
 *          store raw snapshots, and transform into analytics tables.
 *
 * Prerequisite: nightly-bdl-updater must have run so today's games
 *               exist in analytics.games (runs at 03:00 ET).
 *
 * Pipeline: analytics.games (today) -> BDL /v2/odds/player_props per game
 *           -> raw.player_prop_pull_runs + raw.player_prop_snapshots
 *              + raw.player_prop_market_outcomes
 *           -> analytics.player_prop_current + analytics.player_prop_history
 *           -> analytics.player_prop_movement_summary
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

const BdlMarketSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('over_under'),
    over_odds: z.number(),
    under_odds: z.number(),
  }),
  z.object({
    type: z.literal('milestone'),
    odds: z.number(),
  }),
]);

const BdlPlayerPropRowSchema = z.object({
  id: z.number(),
  game_id: z.number(),
  player_id: z.number(),
  vendor: z.string(),
  prop_type: z.string(),
  line_value: z.string(),
  market: BdlMarketSchema,
  updated_at: z.string().nullable().optional(),
});

const BdlPlayerPropsResponseSchema = z.object({
  data: z.array(BdlPlayerPropRowSchema),
  meta: z.object({
    per_page: z.number().optional(),
  }).optional(),
});

type BdlPlayerPropRow = z.infer<typeof BdlPlayerPropRowSchema>;

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
// FETCH TARGET GAMES FROM DB
// ============================================

async function getTodayGameIds(dateStr: string): Promise<{ gameId: string; bdlGameId: number }[]> {
  // Use ET timezone range so late-night ET games (which are next-day UTC) are included.
  // e.g. '2026-03-09' ET spans 2026-03-09 05:00 UTC to 2026-03-10 05:00 UTC (EDT).
  const result = await pool.query(
    `SELECT game_id
     FROM analytics.games
     WHERE start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
       AND start_time <  (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
       AND status != 'Final'`,
    [dateStr]
  );

  if (result.rows.length === 0) {
    const fallback = await pool.query(
      `SELECT game_id
       FROM analytics.games
       WHERE start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
         AND start_time <  (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')`,
      [dateStr]
    );
    return fallback.rows.map((r: any) => ({
      gameId: r.game_id,
      bdlGameId: parseInt(r.game_id, 10),
    }));
  }

  return result.rows.map((r: any) => ({
    gameId: r.game_id,
    bdlGameId: parseInt(r.game_id, 10),
  }));
}

// ============================================
// FETCH PLAYER PROPS FROM BDL
// ============================================

async function fetchPlayerPropsForGame(bdlGameId: number): Promise<BdlPlayerPropRow[]> {
  const url = new URL(`${BDL_BASE}/odds/player_props`);
  url.searchParams.set('game_id', String(bdlGameId));

  while (true) {
    console.log(`  Fetching props for game ${bdlGameId}...`);

    const res = await fetch(url.toString(), {
      headers: { Authorization: BALLDONTLIE_API_KEY as string },
    });

    if (res.status === 429) {
      console.warn('  Rate limited, waiting 60s...');
      await sleep(60000);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`BDL API error: ${res.status} ${res.statusText} — ${body}`);
    }

    const json = await res.json();
    const parsed = BdlPlayerPropsResponseSchema.parse(json);
    return parsed.data;
  }
}

// ============================================
// RAW STORAGE
// ============================================

async function createPullRun(gameIdsQueried: string[]): Promise<number> {
  const result = await pool.query(
    `INSERT INTO raw.player_prop_pull_runs (pulled_at, provider, game_ids_queried, status)
     VALUES (now(), 'balldontlie', $1, 'started')
     RETURNING pull_run_id`,
    [gameIdsQueried]
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
    `UPDATE raw.player_prop_pull_runs
     SET rows_returned = $2, rows_stored = $3, status = $4,
         metadata = $5, error_message = $6, completed_at = now()
     WHERE pull_run_id = $1`,
    [pullRunId, rowsReturned, rowsStored, status, metadata ? JSON.stringify(metadata) : null, errorMessage || null]
  );
}

async function insertRawSnapshot(pullRunId: number, row: BdlPlayerPropRow): Promise<number> {
  const marketType = row.market.type;
  const overOdds = marketType === 'over_under' ? row.market.over_odds : null;
  const underOdds = marketType === 'over_under' ? row.market.under_odds : null;
  const milestoneOdds = marketType === 'milestone' ? row.market.odds : null;

  const result = await pool.query(
    `INSERT INTO raw.player_prop_snapshots (
       pull_run_id, bdl_prop_id, bdl_game_id, game_id,
       bdl_player_id, player_id, vendor,
       prop_type, line_value, market_type,
       over_odds, under_odds, milestone_odds,
       provider_updated_at, raw_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING snapshot_id`,
    [
      pullRunId,
      row.id,
      row.game_id,
      String(row.game_id),
      row.player_id,
      String(row.player_id),
      row.vendor,
      row.prop_type,
      parseNumeric(row.line_value),
      marketType,
      overOdds,
      underOdds,
      milestoneOdds,
      row.updated_at ? new Date(row.updated_at) : null,
      JSON.stringify(row),
    ]
  );
  return result.rows[0].snapshot_id;
}

async function insertMarketOutcomes(snapshotId: number, row: BdlPlayerPropRow): Promise<void> {
  if (row.market.type === 'over_under') {
    await pool.query(
      `INSERT INTO raw.player_prop_market_outcomes (snapshot_id, side, odds)
       VALUES ($1, 'over', $2), ($1, 'under', $3)`,
      [snapshotId, row.market.over_odds, row.market.under_odds]
    );
  } else {
    await pool.query(
      `INSERT INTO raw.player_prop_market_outcomes (snapshot_id, side, odds)
       VALUES ($1, 'milestone', $2)`,
      [snapshotId, row.market.odds]
    );
  }
}

// ============================================
// ANALYTICS TRANSFORM (inline)
// ============================================

async function transformToAnalytics(
  pullRunId: number,
  affectedGameIds: string[]
): Promise<{ current: number; history: number; movement: number }> {
  let currentCount = 0;
  let historyCount = 0;

  // Step 1: Upsert current props (preferred vendor).
  // Delete existing current rows for affected games, then insert fresh.
  // This avoids stale lines when O/U values move.
  for (const gameId of affectedGameIds) {
    await pool.query(
      `DELETE FROM analytics.player_prop_current
       WHERE game_id = $1 AND vendor = $2`,
      [gameId, PREFERRED_VENDOR]
    );

    const insertResult = await pool.query(
      `INSERT INTO analytics.player_prop_current (
         game_id, player_id, player_name, vendor,
         prop_type, line_value, market_type,
         over_odds, under_odds, milestone_odds,
         bdl_prop_id, snapshot_at, pull_run_id, updated_at
       )
       SELECT DISTINCT ON (s.game_id, s.player_id, s.prop_type, s.market_type, s.line_value)
         s.game_id, s.player_id,
         p.full_name,
         s.vendor,
         s.prop_type, s.line_value, s.market_type,
         s.over_odds, s.under_odds, s.milestone_odds,
         s.bdl_prop_id,
         COALESCE(s.provider_updated_at, s.created_at),
         s.pull_run_id,
         now()
       FROM raw.player_prop_snapshots s
       LEFT JOIN analytics.players p ON p.player_id = s.player_id
       WHERE s.pull_run_id = $1
         AND s.game_id = $2
         AND s.vendor = $3
         AND s.player_id IN (SELECT player_id FROM analytics.players)
       ORDER BY s.game_id, s.player_id, s.prop_type, s.market_type, s.line_value,
                s.provider_updated_at DESC NULLS LAST`,
      [pullRunId, gameId, PREFERRED_VENDOR]
    );
    currentCount += insertResult.rowCount ?? 0;
  }

  // Step 2: Append all vendor rows to history (deduped by unique constraint)
  const allSnapshots = await pool.query(
    `SELECT s.game_id, s.player_id, s.vendor,
       s.prop_type, s.line_value, s.market_type,
       s.over_odds, s.under_odds, s.milestone_odds,
       s.bdl_prop_id, s.provider_updated_at, s.pull_run_id,
       p.full_name as player_name
     FROM raw.player_prop_snapshots s
     LEFT JOIN analytics.players p ON p.player_id = s.player_id
     WHERE s.pull_run_id = $1
       AND s.game_id = ANY($2)
       AND s.player_id IN (SELECT player_id FROM analytics.players)`,
    [pullRunId, affectedGameIds]
  );

  for (const row of allSnapshots.rows) {
    const snapshotAt = row.provider_updated_at || new Date();
    const insertResult = await pool.query(
      `INSERT INTO analytics.player_prop_history (
         game_id, player_id, player_name, vendor,
         prop_type, line_value, market_type,
         over_odds, under_odds, milestone_odds,
         bdl_prop_id, snapshot_at, pull_run_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (game_id, player_id, vendor, prop_type, market_type, line_value, snapshot_at) DO NOTHING`,
      [
        row.game_id, row.player_id, row.player_name, row.vendor,
        row.prop_type, row.line_value, row.market_type,
        row.over_odds, row.under_odds, row.milestone_odds,
        row.bdl_prop_id, snapshotAt, row.pull_run_id,
      ]
    );
    historyCount += insertResult.rowCount ?? 0;
  }

  // Step 3: Refresh movement summary for over_under markets
  const movementCount = await refreshPropMovementSummary(pullRunId, affectedGameIds);

  return { current: currentCount, history: historyCount, movement: movementCount };
}

async function refreshPropMovementSummary(
  pullRunId: number,
  gameIds: string[]
): Promise<number> {
  if (gameIds.length === 0) return 0;

  // Find distinct (game_id, player_id, prop_type) combos with O/U history
  const combos = await pool.query(
    `SELECT DISTINCT game_id, player_id, prop_type
     FROM analytics.player_prop_history
     WHERE game_id = ANY($1)
       AND vendor = $2
       AND market_type = 'over_under'`,
    [gameIds, PREFERRED_VENDOR]
  );

  let count = 0;
  for (const combo of combos.rows) {
    const result = await pool.query(
      `INSERT INTO analytics.player_prop_movement_summary (
         game_id, player_id, player_name, vendor, prop_type,
         open_line, open_over_odds, open_under_odds,
         current_line, current_over_odds, current_under_odds,
         line_movement, snapshots_count, first_seen_at, last_seen_at, updated_at
       )
       SELECT
         $1, $2,
         p.full_name,
         $4, $3,
         first_snap.line_value, first_snap.over_odds, first_snap.under_odds,
         last_snap.line_value, last_snap.over_odds, last_snap.under_odds,
         last_snap.line_value - first_snap.line_value,
         stats.cnt, stats.first_at, stats.last_at, now()
       FROM (
         SELECT line_value, over_odds, under_odds
         FROM analytics.player_prop_history
         WHERE game_id = $1 AND player_id = $2 AND prop_type = $3
           AND vendor = $4 AND market_type = 'over_under'
         ORDER BY snapshot_at ASC LIMIT 1
       ) first_snap,
       (
         SELECT line_value, over_odds, under_odds
         FROM analytics.player_prop_history
         WHERE game_id = $1 AND player_id = $2 AND prop_type = $3
           AND vendor = $4 AND market_type = 'over_under'
         ORDER BY snapshot_at DESC LIMIT 1
       ) last_snap,
       (
         SELECT count(*)::int as cnt, min(snapshot_at) as first_at, max(snapshot_at) as last_at
         FROM analytics.player_prop_history
         WHERE game_id = $1 AND player_id = $2 AND prop_type = $3
           AND vendor = $4 AND market_type = 'over_under'
       ) stats
       LEFT JOIN analytics.players p ON p.player_id = $2
       ON CONFLICT (game_id, player_id, vendor, prop_type) DO UPDATE SET
         player_name = excluded.player_name,
         open_line = excluded.open_line,
         open_over_odds = excluded.open_over_odds,
         open_under_odds = excluded.open_under_odds,
         current_line = excluded.current_line,
         current_over_odds = excluded.current_over_odds,
         current_under_odds = excluded.current_under_odds,
         line_movement = excluded.line_movement,
         snapshots_count = excluded.snapshots_count,
         first_seen_at = excluded.first_seen_at,
         last_seen_at = excluded.last_seen_at,
         updated_at = now()`,
      [combo.game_id, combo.player_id, combo.prop_type, PREFERRED_VENDOR]
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
  date?: string;
  dates?: string[];
}

function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function processDate(dateStr: string): Promise<{
  date: string;
  pullRunId: number;
  gamesQueried: number;
  rowsFetched: number;
  rowsStored: number;
  uniquePlayers: number;
  uniqueVendors: number;
  transform: { current: number; history: number; movement: number };
}> {
  console.log(`\n=== Processing ${dateStr} ===`);

  const games = await getTodayGameIds(dateStr);
  console.log(`Found ${games.length} games for ${dateStr}`);

  if (games.length === 0) {
    const pullRunId = await createPullRun([]);
    await completePullRun(pullRunId, 0, 0, 'success', { message: 'No games found for date' });
    return {
      date: dateStr, pullRunId, gamesQueried: 0, rowsFetched: 0,
      rowsStored: 0, uniquePlayers: 0, uniqueVendors: 0,
      transform: { current: 0, history: 0, movement: 0 },
    };
  }

  const gameIdStrings = games.map(g => g.gameId);
  const pullRunId = await createPullRun(gameIdStrings);
  console.log(`Created pull run: ${pullRunId}`);

  let totalFetched = 0;
  let totalStored = 0;
  const allPlayers = new Set<number>();
  const allVendors = new Set<string>();
  const gamesWithProps: string[] = [];

  for (const game of games) {
    try {
      const props = await fetchPlayerPropsForGame(game.bdlGameId);
      console.log(`  Game ${game.bdlGameId}: ${props.length} props returned`);

      if (props.length > 0) {
        gamesWithProps.push(game.gameId);
      }

      totalFetched += props.length;

      for (const row of props) {
        try {
          const snapshotId = await insertRawSnapshot(pullRunId, row);
          await insertMarketOutcomes(snapshotId, row);
          totalStored++;
          allPlayers.add(row.player_id);
          allVendors.add(row.vendor);
        } catch (err: any) {
          console.error(`  Error storing prop for game ${row.game_id} player ${row.player_id}:`, err.message);
        }
      }

      await sleep(200);
    } catch (err: any) {
      console.error(`  Error fetching props for game ${game.bdlGameId}:`, err.message);
    }
  }

  console.log(`Stored ${totalStored}/${totalFetched} raw snapshots across ${gamesWithProps.length} games`);

  // Transform to analytics
  const transformResult = await transformToAnalytics(pullRunId, gamesWithProps);
  console.log(`Transform — current: ${transformResult.current}, history: ${transformResult.history}, movement: ${transformResult.movement}`);

  await completePullRun(pullRunId, totalFetched, totalStored, 'success', {
    gamesQueried: games.length,
    gamesWithProps: gamesWithProps.length,
    vendors: [...allVendors],
    uniquePlayers: allPlayers.size,
    transform: transformResult,
  });

  return {
    date: dateStr,
    pullRunId,
    gamesQueried: games.length,
    rowsFetched: totalFetched,
    rowsStored: totalStored,
    uniquePlayers: allPlayers.size,
    uniqueVendors: allVendors.size,
    transform: transformResult,
  };
}

export const handler = async (event: LambdaEvent) => {
  try {
    console.log('Starting player props snapshot (BallDontLie /v2/odds/player_props)...');
    console.log('Event:', JSON.stringify(event));
    console.log(`Preferred vendor: ${PREFERRED_VENDOR}`);

    const dates = event.dates
      || (event.date ? [event.date] : [getTodayET()]);
    console.log(`Processing dates: ${dates.join(', ')}`);

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
    console.log('\nSummary:', JSON.stringify(summary, null, 2));

    return { statusCode: 200, body: JSON.stringify({ success: true, ...summary }) };
  } catch (error: any) {
    console.error('Error in player props snapshot:', error);
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
  process.argv[1].includes('player-props-snapshot')
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
