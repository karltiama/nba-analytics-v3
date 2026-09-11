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
import { REMOVED_FROM_REPORT_STATUS } from './leave-report';
import { planInjuryIngest, type InjuryFieldSnapshot, type InjuryPullRow } from './ingest-plan';
import { fetchBdlLive } from './bdl-live-rate-limit';
import {
  IDENTITY_BRIDGES_SQL,
  IDENTITY_PROJECTIONS_SQL,
  IDENTITY_QUARANTINE_SQL,
} from './identity-sql';
import { classifyFromSqlRows } from './classify-sql-rows';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALDONTLIE_API_KEY;
const BDL_BASE = 'https://api.balldontlie.io';
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

async function fetchAllInjuries(): Promise<BdlPlayerInjury[]> {
  const all: BdlPlayerInjury[] = [];
  let cursor: number | null = null;

  while (true) {
    const url = new URL(`${BDL_BASE}/nba/v1/player_injuries`);
    url.searchParams.set('per_page', '100');
    if (cursor != null) {
      url.searchParams.set('cursor', String(cursor));
    }

    const res = await fetchBdlLive(
      url.toString(),
      { headers: { Authorization: BALLDONTLIE_API_KEY as string } },
      { worker: 'injuries-snapshot' }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`BDL API error: ${res.status} ${res.statusText} — ${body}`);
    }

    const json = await res.json();
    const parsed = BdlInjuriesResponseSchema.parse(json);
    all.push(...parsed.data);

    cursor = parsed.meta?.next_cursor ?? null;
    if (cursor == null) break;
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
  pullRunId: number,
  opts: { rowsStored: number; rowsReturned: number }
): Promise<{ current: number; history: number; removed: number; massClearBlocked: boolean; completenessReason: string }> {
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

  const prevCompleteRes = await pool.query<{ rows_stored: number | string }>(
    `SELECT rows_stored
     FROM raw.injury_pull_runs
     WHERE pull_run_id < $1
       AND status = 'success'
       AND completed_at IS NOT NULL
       AND rows_stored IS NOT NULL
       AND rows_returned IS NOT NULL
       AND rows_stored = rows_returned
       AND rows_stored > 0
     ORDER BY pull_run_id DESC
     LIMIT 1`,
    [pullRunId]
  );
  const previousCompleteRowCount =
    prevCompleteRes.rows[0] != null ? Number(prevCompleteRes.rows[0].rows_stored) : null;

  const rawRows = await pool.query(
    `SELECT DISTINCT ON (provider_player_id)
       provider_player_id, provider_team_id, status, description, return_date_raw, created_at
     FROM raw.player_injuries
     WHERE pull_run_id = $1
     ORDER BY provider_player_id, created_at DESC`,
    [pullRunId]
  );

  const requestedIds = [
    ...new Set(rawRows.rows.map((row) => String(row.provider_player_id))),
  ];
  const bridges = requestedIds.length
    ? await pool.query<{ provider_player_id: string; player_entity_id: string }>(
        IDENTITY_BRIDGES_SQL,
        ['balldontlie', requestedIds]
      )
    : { rows: [] as Array<{ provider_player_id: string; player_entity_id: string }> };
  const entityIds = [
    ...new Set(bridges.rows.map((r) => r.player_entity_id)),
  ];
  const projections = entityIds.length
    ? await pool.query<{ player_entity_id: string; analytics_player_id: string }>(
        IDENTITY_PROJECTIONS_SQL,
        [entityIds]
      )
    : { rows: [] as Array<{ player_entity_id: string; analytics_player_id: string }> };
  const identity = classifyFromSqlRows(requestedIds, bridges.rows, projections.rows);
  const observedAtIso = new Date().toISOString();
  for (const q of identity.quarantine) {
    await pool.query(IDENTITY_QUARANTINE_SQL, [
      'balldontlie',
      q.providerPlayerId,
      'INJURY',
      q.status,
      observedAtIso,
      null,
      null,
    ]);
  }

  const pullRows: InjuryPullRow[] = rawRows.rows
    .map((row) => ({
      playerId: String(row.provider_player_id),
      teamId: mapTeamId(row.provider_team_id ?? null),
      status: row.status ?? null,
      description: row.description ?? null,
      returnDateRaw: row.return_date_raw ?? null,
      snapshotAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    }))
    .filter((row) => identity.servingIds.has(row.playerId));

  const observedAt =
    pullRows[0]?.snapshotAt ?? new Date().toISOString();

  const prevCurrentRes = await pool.query<{
    player_id: string;
    team_id: string | null;
    status: string | null;
    description: string | null;
    return_date_raw: string | null;
  }>(
    `SELECT player_id, team_id, status, description, return_date_raw
     FROM analytics.player_injury_status_current`
  );
  const previousCurrent = new Map<string, InjuryFieldSnapshot>();
  for (const row of prevCurrentRes.rows) {
    previousCurrent.set(String(row.player_id), {
      playerId: String(row.player_id),
      teamId: row.team_id,
      status: row.status,
      description: row.description,
      returnDateRaw: row.return_date_raw,
    });
  }

  const existingLeaveRes = await pool.query<{ player_id: string }>(
    `SELECT player_id
     FROM analytics.player_injury_status_history
     WHERE pull_run_id = $1
       AND status = $2`,
    [pullRunId, REMOVED_FROM_REPORT_STATUS]
  );

  const plan = planInjuryIngest({
    pullRunId,
    pullStatus: 'success',
    completed: true,
    rowsStored: opts.rowsStored,
    rowsReturned: opts.rowsReturned,
    previousCompleteRowCount,
    observedAt,
    pullRows,
    previousCurrent,
    existingLeaveReportPlayerIds: existingLeaveRes.rows.map((r) => String(r.player_id)),
  });

  if (plan.massClearBlocked) {
    console.warn(
      `[injuries] mass-clear blocked for pull ${pullRunId}: ${plan.completenessReason}`
    );
  }

  let historyCount = 0;
  for (const insert of plan.historyInserts) {
    await pool.query(
      `INSERT INTO analytics.player_injury_status_history (
         player_id, team_id, status, description, return_date_raw, snapshot_at, pull_run_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        insert.playerId,
        insert.teamId,
        insert.status,
        insert.description,
        insert.returnDateRaw,
        insert.snapshotAt,
        insert.pullRunId,
      ]
    );
    historyCount += 1;
  }

  let currentCount = 0;
  for (const row of plan.currentUpserts) {
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
      [
        row.playerId,
        row.teamId,
        row.status,
        row.description,
        row.returnDateRaw,
        row.snapshotAt,
        pullRunId,
      ]
    );
    currentCount += 1;
  }

  let removedCount = 0;
  if (!plan.massClearBlocked && plan.currentDeletes.length > 0) {
    const removed = await pool.query(
      `DELETE FROM analytics.player_injury_status_current c
       WHERE c.player_id = ANY($1::text[])
       RETURNING c.player_id`,
      [plan.currentDeletes]
    );
    removedCount = removed.rowCount ?? 0;
  }

  return {
    current: currentCount,
    history: historyCount,
    removed: removedCount,
    massClearBlocked: plan.massClearBlocked,
    completenessReason: plan.completenessReason,
  };
}

// ============================================
// LAMBDA HANDLER
// ============================================

export const handler = async () => {
  try {
    console.log('Starting injuries snapshot (BallDontLie /nba/v1/player_injuries)...');

    if (SHOULD_SKIP_MUTATIONS) {
      console.log(
        `[offseason] Skipping injuries provider calls and writes (DATA_MODE=${DATA_MODE}, OFFSEASON_MODE=${OFFSEASON_MODE ? '1' : '0'}, CRON_DRY_RUN=${CRON_DRY_RUN ? '1' : '0'}).`
      );
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          skipped: true,
          reason: 'Injuries snapshot skipped by runtime mode flags',
          dataMode: DATA_MODE,
          offseasonMode: OFFSEASON_MODE,
          cronDryRun: CRON_DRY_RUN,
          timestamp: new Date().toISOString(),
        }),
      };
    }

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

    const transformResult = await transformToAnalytics(pullRunId, {
      rowsStored: stored,
      rowsReturned: rows.length,
    });
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
