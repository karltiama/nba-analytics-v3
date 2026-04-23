/**
 * Lambda Function: Injuries Snapshot
 *
 * Purpose: Fetch NBA player injuries from BallDontLie GET /nba/v1/player_injuries,
 *          store append-only raw snapshots, transform into analytics current + history.
 *
 * Pipeline: BDL /nba/v1/player_injuries -> raw.injury_pull_runs + raw.player_injuries
 *           -> analytics.player_injury_status_current + analytics.player_injury_status_history
 *
 * Environment Variables:
 * - SUPABASE_DB_URL (required)
 * - BALLDONTLIE_API_KEY (required)
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
  // dotenv not available in Lambda
}

import { Pool } from 'pg';
import { z } from 'zod';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;
const BDL_BASE = 'https://api.balldontlie.io';

if (!SUPABASE_DB_URL) {
  throw new Error('Missing SUPABASE_DB_URL environment variable');
}
if (!BALLDONTLIE_API_KEY) {
  throw new Error('Missing BALLDONTLIE_API_KEY environment variable');
}

const pool = new Pool({
  connectionString: SUPABASE_DB_URL.trim(),
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

// ============================================
// ZOD SCHEMAS (BDL NBAPlayerInjury)
// ============================================

const BdlPlayerSchema = z.object({
  id: z.number(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  team_id: z.number().nullable().optional(),
  team: z.any().nullable().optional(),
});

const BdlPlayerInjurySchema = z.object({
  player: BdlPlayerSchema,
  return_date: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});

const BdlInjuriesResponseSchema = z.object({
  data: z.array(BdlPlayerInjurySchema),
  meta: z.object({
    next_cursor: z.number().nullable().optional(),
    per_page: z.number().optional(),
  }).optional(),
});

type BdlPlayerInjury = z.infer<typeof BdlPlayerInjurySchema>;

// ============================================
// FETCH INJURIES FROM BDL
// ============================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAllInjuries(): Promise<BdlPlayerInjury[]> {
  const all: BdlPlayerInjury[] = [];
  let cursor: number | null = null;

  while (true) {
    const url = new URL(`${BDL_BASE}/nba/v1/player_injuries`);
    url.searchParams.set('per_page', '100');
    if (cursor != null) {
      url.searchParams.set('cursor', String(cursor));
    }

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
    const parsed = BdlInjuriesResponseSchema.parse(json);
    all.push(...parsed.data);

    cursor = parsed.meta?.next_cursor ?? null;
    if (cursor == null) break;

    await sleep(200);
  }

  return all;
}

// ============================================
// RAW STORAGE
// ============================================

async function createPullRun(): Promise<number> {
  const result = await pool.query(
    `INSERT INTO raw.injury_pull_runs (pulled_at, provider, status)
     VALUES (now(), 'balldontlie', 'started')
     RETURNING pull_run_id`
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
    `UPDATE raw.injury_pull_runs
     SET rows_returned = $2, rows_stored = $3, status = $4,
         metadata = $5, error_message = $6, completed_at = now()
     WHERE pull_run_id = $1`,
    [pullRunId, rowsReturned, rowsStored, status, metadata ? JSON.stringify(metadata) : null, errorMessage || null]
  );
}

async function insertRawSnapshot(
  pullRunId: number,
  row: BdlPlayerInjury
): Promise<void> {
  const playerId = row.player?.id ?? 0;
  const teamId = row.player?.team_id ?? (row.player?.team && typeof row.player.team === 'object' && 'id' in row.player.team ? (row.player.team as { id: number }).id : null);

  await pool.query(
    `INSERT INTO raw.player_injuries (
       pull_run_id, provider_player_id, provider_team_id,
       status, description, return_date_raw, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      pullRunId,
      playerId,
      teamId,
      row.status ?? null,
      row.description ?? null,
      row.return_date ?? null,
      JSON.stringify(row),
    ]
  );
}

// ============================================
// TRANSFORM: raw -> analytics (current + history on meaningful change)
// ============================================

async function transformToAnalytics(
  pullRunId: number
): Promise<{ current: number; history: number; removed: number }> {
  // Build provider_team_id -> analytics team_id map (same logic as transform-raw-to-analytics)
  const teamMapRes = await pool.query(
    `SELECT r.id as raw_id, t.team_id
     FROM raw.teams r
     JOIN analytics.teams t ON upper(trim(r.abbreviation)) = upper(trim(t.abbreviation))`
  );
  const providerTeamIdToAnalytics = new Map<number, string>();
  for (const r of teamMapRes.rows) {
    providerTeamIdToAnalytics.set(Number(r.raw_id), r.team_id);
  }

  const mapTeamId = (providerTeamId: number | null | undefined): string | null => {
    if (providerTeamId == null) return null;
    return providerTeamIdToAnalytics.get(providerTeamId) ?? null;
  };

  // Latest raw row per player in this pull (one per player)
  const rawRows = await pool.query(
    `SELECT DISTINCT ON (provider_player_id)
       provider_player_id, provider_team_id, status, description, return_date_raw, created_at
     FROM raw.player_injuries
     WHERE pull_run_id = $1
       AND (provider_player_id::text) IN (SELECT player_id FROM analytics.players)
     ORDER BY provider_player_id, created_at DESC`,
    [pullRunId]
  );

  let currentCount = 0;
  let historyCount = 0;
  const currentPlayerIds = new Set<string>();

  for (const row of rawRows.rows) {
    const playerId = String(row.provider_player_id);
    currentPlayerIds.add(playerId);
    const teamId = mapTeamId(row.provider_team_id ?? null);
    const status = row.status ?? null;
    const description = row.description ?? null;
    const returnDateRaw = row.return_date_raw ?? null;
    const snapshotAt = row.created_at;

    // Previous current row (before upsert)
    const prev = await pool.query(
      `SELECT status, description, return_date_raw, team_id
       FROM analytics.player_injury_status_current
       WHERE player_id = $1`,
      [playerId]
    );
    const prevRow = prev.rows[0];
    const changed =
      !prevRow ||
      prevRow.status !== status ||
      prevRow.description !== description ||
      prevRow.return_date_raw !== returnDateRaw ||
      prevRow.team_id !== teamId;

    if (changed && prevRow) {
      await pool.query(
        `INSERT INTO analytics.player_injury_status_history (
           player_id, team_id, status, description, return_date_raw, snapshot_at, pull_run_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [playerId, teamId, status, description, returnDateRaw, snapshotAt, pullRunId]
      );
      historyCount += 1;
    }
    if (changed && !prevRow) {
      // First time we see this player on injury report — still insert history for audit
      await pool.query(
        `INSERT INTO analytics.player_injury_status_history (
           player_id, team_id, status, description, return_date_raw, snapshot_at, pull_run_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [playerId, teamId, status, description, returnDateRaw, snapshotAt, pullRunId]
      );
      historyCount += 1;
    }

    await pool.query(
      `INSERT INTO analytics.player_injury_status_current (
         player_id, team_id, status, description, return_date_raw, snapshot_at, pull_run_id, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (player_id) DO UPDATE SET
         team_id = excluded.team_id,
         status = excluded.status,
         description = excluded.description,
         return_date_raw = excluded.return_date_raw,
         snapshot_at = excluded.snapshot_at,
         pull_run_id = excluded.pull_run_id,
         updated_at = now()`,
      [playerId, teamId, status, description, returnDateRaw, snapshotAt, pullRunId]
    );
    currentCount += 1;
  }

  const latestPlayerIds = Array.from(currentPlayerIds);
  let removedCount = 0;
  if (latestPlayerIds.length > 0) {
    const removed = await pool.query(
      `DELETE FROM analytics.player_injury_status_current c
       WHERE c.player_id != ALL($1::text[])
       RETURNING c.player_id`,
      [latestPlayerIds]
    );
    removedCount = removed.rowCount ?? 0;
  } else {
    const removed = await pool.query(
      `DELETE FROM analytics.player_injury_status_current c
       RETURNING c.player_id`
    );
    removedCount = removed.rowCount ?? 0;
  }

  return { current: currentCount, history: historyCount, removed: removedCount };
}

// ============================================
// LAMBDA HANDLER
// ============================================

export const handler = async () => {
  try {
    console.log('Starting injuries snapshot (BallDontLie /nba/v1/player_injuries)...');

    const pullRunId = await createPullRun();
    console.log('Created pull run:', pullRunId);

    const rows = await fetchAllInjuries();
    console.log('Fetched', rows.length, 'injury rows from BDL');

    let stored = 0;
    for (const row of rows) {
      try {
        await insertRawSnapshot(pullRunId, row);
        stored++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Error storing snapshot for player', row.player?.id, msg);
      }
    }
    console.log('Stored', stored, '/', rows.length, 'raw snapshots');

    const transformResult = await transformToAnalytics(pullRunId);
    console.log(
      'Transform — current:',
      transformResult.current,
      'history:',
      transformResult.history,
      'removed:',
      transformResult.removed
    );

    await completePullRun(pullRunId, rows.length, stored, 'success', {
      transform: transformResult,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        pullRunId,
        rowsFetched: rows.length,
        rowsStored: stored,
        transform: transformResult,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error in injuries snapshot:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

// Local run
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('index.ts') ||
  process.argv[1].endsWith('index.js') ||
  process.argv[1].includes('injuries-snapshot')
);

if (isMainModule) {
  handler().then((r) => {
    console.log('\n=== Lambda Response ===');
    console.log(JSON.stringify(JSON.parse(r.body), null, 2));
    pool.end().then(() => {
      console.log('\nDone.');
      process.exit(r.statusCode === 200 ? 0 : 1);
    });
  }).catch((e) => {
    console.error('Error:', e);
    pool.end().finally(() => process.exit(1));
  });
}
