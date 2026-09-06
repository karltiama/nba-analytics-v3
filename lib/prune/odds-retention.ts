/**
 * Retention + eligibility SQL for raw.odds_snapshots.
 *
 * Cutoff uses the same America/New_York calendar date as archive partitions
 * (entity raw_odds_snapshots / created_at ET date). A row is eligible when:
 *
 *   (created_at AT TIME ZONE 'America/New_York')::date
 *     < (now() AT TIME ZONE 'America/New_York')::date - retentionDays
 *
 * Default retention is 30 days (conservative end of the 14–30 day audit band).
 * Missing / non-positive / non-numeric ODDS_RAW_RETENTION_DAYS → 30.
 *
 * Deletes only target raw.odds_snapshots. Never analytics odds or pull-runs.
 */

import type { Pool } from 'pg';

export const DEFAULT_ODDS_RAW_RETENTION_DAYS = 30;
export const ODDS_DELETE_BATCH = 50_000;

const ELIGIBLE_PREDICATE = `(created_at AT TIME ZONE 'America/New_York')::date
      < (now() AT TIME ZONE 'America/New_York')::date - $1::int`;

export function resolveOddsRawRetentionDays(
  raw: string | undefined,
  fallback: number = DEFAULT_ODDS_RAW_RETENTION_DAYS
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export type OddsCandidateStats = {
  eligibleRows: number;
  eligibleGameIds: number;
  oldest: string | null;
  newest: string | null;
};

export async function countRawOddsTotal(pool: Pool): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM raw.odds_snapshots`
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function countRawOddsEligible(
  pool: Pool,
  retentionDays: number
): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM raw.odds_snapshots
     WHERE ${ELIGIBLE_PREDICATE}`,
    [retentionDays]
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function loadOddsCandidateStats(
  pool: Pool,
  retentionDays: number
): Promise<OddsCandidateStats> {
  const r = await pool.query<{
    eligible_rows: string;
    eligible_games: string;
    oldest: Date | string | null;
    newest: Date | string | null;
  }>(
    `SELECT
       count(*)::text AS eligible_rows,
       count(DISTINCT game_id)::text AS eligible_games,
       min(created_at) AS oldest,
       max(created_at) AS newest
     FROM raw.odds_snapshots
     WHERE ${ELIGIBLE_PREDICATE}`,
    [retentionDays]
  );
  const row = r.rows[0];
  return {
    eligibleRows: Number(row?.eligible_rows ?? 0),
    eligibleGameIds: Number(row?.eligible_games ?? 0),
    oldest: row?.oldest ? new Date(row.oldest).toISOString() : null,
    newest: row?.newest ? new Date(row.newest).toISOString() : null,
  };
}

export async function loadOddsCutoffEt(
  pool: Pool,
  retentionDays: number
): Promise<string | null> {
  const r = await pool.query<{ cutoff_et: string | null }>(
    `SELECT ((now() AT TIME ZONE 'America/New_York')::date - $1::int)::text AS cutoff_et`,
    [retentionDays]
  );
  return r.rows[0]?.cutoff_et ?? null;
}

export async function listSeasonsWithEligibleRawOdds(
  pool: Pool,
  retentionDays: number
): Promise<number[]> {
  const r = await pool.query<{ season: string }>(
    `SELECT DISTINCT trim(both from g.season)::int AS season
     FROM raw.odds_snapshots r
     INNER JOIN analytics.games g ON g.game_id = r.game_id
     WHERE (r.created_at AT TIME ZONE 'America/New_York')::date
       < (now() AT TIME ZONE 'America/New_York')::date - $1::int
       AND g.season IS NOT NULL
       AND trim(both from g.season) ~ '^[0-9]+'
     ORDER BY 1`,
    [retentionDays]
  );
  return r.rows.map((row) => Number(row.season)).filter((n) => Number.isFinite(n));
}

/**
 * Destructive. Callers must have already passed env/archive/coverage/max-delete.
 * Only raw.odds_snapshots. Batched by ctid.
 */
export async function deleteRawOddsEligibleBatches(
  pool: Pool,
  retentionDays: number,
  batchSize: number = ODDS_DELETE_BATCH
): Promise<number> {
  let deleted = 0;
  while (true) {
    const result = await pool.query(
      `WITH doomed AS (
         SELECT ctid
         FROM raw.odds_snapshots
         WHERE (created_at AT TIME ZONE 'America/New_York')::date
           < (now() AT TIME ZONE 'America/New_York')::date - $1::int
         LIMIT $2
       )
       DELETE FROM raw.odds_snapshots t
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
