/**
 * Retention + eligibility for raw.player_injuries.
 *
 * Cutoff uses the same America/New_York calendar date as archive partitions
 * (entity raw_player_injuries / created_at ET date). A row is eligible when:
 *
 *   (created_at AT TIME ZONE 'America/New_York')::date
 *     < (now() AT TIME ZONE 'America/New_York')::date - retentionDays
 *
 * That is strictly older than the retention boundary date (the cutoff date itself
 * is retained). Default INJURY_RAW_RETENTION_DAYS=7; missing/invalid/non-positive → 7.
 *
 * Deletes only target raw.player_injuries. Never analytics current/history
 * or raw.injury_pull_runs.
 */

import type { Pool } from 'pg';

export const INJURY_RAW_RETENTION_DAYS_ENV = 'INJURY_RAW_RETENTION_DAYS';
export const DEFAULT_INJURY_RAW_RETENTION_DAYS = 7;
export const INJURY_DELETE_BATCH = 5_000;

export const INJURY_ELIGIBLE_PREDICATE = `(created_at AT TIME ZONE 'America/New_York')::date
      < (now() AT TIME ZONE 'America/New_York')::date - $1::int`;

export function resolveInjuryRawRetentionDays(
  raw: string | undefined,
  fallback: number = DEFAULT_INJURY_RAW_RETENTION_DAYS
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export type InjuryCandidateStats = {
  eligibleRows: number;
  eligiblePlayerIds: number;
  oldest: string | null;
  newest: string | null;
};

export async function countRawInjuriesTotal(pool: Pool): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM raw.player_injuries`
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function countRawInjuriesEligible(
  pool: Pool,
  retentionDays: number
): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM raw.player_injuries
     WHERE ${INJURY_ELIGIBLE_PREDICATE}`,
    [retentionDays]
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function loadInjuryCandidateStats(
  pool: Pool,
  retentionDays: number
): Promise<InjuryCandidateStats> {
  const r = await pool.query<{
    eligible_rows: string;
    eligible_players: string;
    oldest: Date | string | null;
    newest: Date | string | null;
  }>(
    `SELECT
       count(*)::text AS eligible_rows,
       count(DISTINCT provider_player_id)::text AS eligible_players,
       min(created_at) AS oldest,
       max(created_at) AS newest
     FROM raw.player_injuries
     WHERE ${INJURY_ELIGIBLE_PREDICATE}`,
    [retentionDays]
  );
  const row = r.rows[0];
  return {
    eligibleRows: Number(row?.eligible_rows ?? 0),
    eligiblePlayerIds: Number(row?.eligible_players ?? 0),
    oldest: row?.oldest ? new Date(row.oldest).toISOString() : null,
    newest: row?.newest ? new Date(row.newest).toISOString() : null,
  };
}

export async function loadInjuryCutoffEt(
  pool: Pool,
  retentionDays: number
): Promise<string | null> {
  const r = await pool.query<{ cutoff_et: string | null }>(
    `SELECT ((now() AT TIME ZONE 'America/New_York')::date - $1::int)::text AS cutoff_et`,
    [retentionDays]
  );
  return r.rows[0]?.cutoff_et ?? null;
}

/**
 * Seasons whose analytics.games ET window overlaps prune-eligible injury rows.
 * Archive manifests are per season (entity raw_player_injuries).
 */
export async function listSeasonsWithEligibleRawInjuries(
  pool: Pool,
  retentionDays: number
): Promise<number[]> {
  const r = await pool.query<{ season: string }>(
    `WITH bounds AS (
       SELECT
         trim(both from g.season)::int AS season,
         min((g.start_time AT TIME ZONE 'America/New_York')::date) AS start_et,
         max((g.start_time AT TIME ZONE 'America/New_York')::date) AS end_et
       FROM analytics.games g
       WHERE g.season IS NOT NULL
         AND trim(both from g.season) ~ '^[0-9]+'
         AND g.start_time IS NOT NULL
       GROUP BY 1
     )
     SELECT DISTINCT b.season::text AS season
     FROM bounds b
     WHERE EXISTS (
       SELECT 1
       FROM raw.player_injuries r
       WHERE (r.created_at AT TIME ZONE 'America/New_York')::date
             < (now() AT TIME ZONE 'America/New_York')::date - $1::int
         AND (r.created_at AT TIME ZONE 'America/New_York')::date
             BETWEEN b.start_et AND b.end_et
     )
     ORDER BY 1`,
    [retentionDays]
  );
  return r.rows.map((row) => Number(row.season)).filter((n) => Number.isFinite(n));
}

/**
 * Destructive. Callers must have already passed env/archive/coverage/max-delete.
 * Only raw.player_injuries. Batched by ctid.
 */
export async function deleteRawInjuriesEligibleBatches(
  pool: Pool,
  retentionDays: number,
  batchSize: number = INJURY_DELETE_BATCH
): Promise<number> {
  let deleted = 0;
  while (true) {
    const result = await pool.query(
      `WITH doomed AS (
         SELECT ctid
         FROM raw.player_injuries
         WHERE (created_at AT TIME ZONE 'America/New_York')::date
           < (now() AT TIME ZONE 'America/New_York')::date - $1::int
         LIMIT $2
       )
       DELETE FROM raw.player_injuries t
       USING doomed d
       WHERE t.ctid = d.ctid`,
      [retentionDays, batchSize]
    );
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count === 0) break;
  }
  return deleted;
}
