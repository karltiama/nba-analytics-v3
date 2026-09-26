import type { Pool } from 'pg';

export const RETENTION_DAYS = 3;
export const DELETE_BATCH = 50_000;

export const MATERIALIZE_CLOSING_LINES_SQL = `
    INSERT INTO research.prop_decision_lines
      (game_id, player_id, player_name, team_id, sportsbook, prop_type,
       market_type, side, line_value, odds_american, odds_decimal,
       implied_probability, decision_at, game_start_time)
    SELECT DISTINCT ON (r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side)
      g.game_id,
      r.player_id::text,
      r.player_name,
      r.team_id,
      r.sportsbook,
      r.prop_type,
      r.market_type,
      r.side,
      r.line_value,
      r.odds_american,
      r.odds_decimal,
      r.implied_probability,
      r.fetched_at,
      g.start_time
    FROM raw.player_prop_snapshots_v2 r
    INNER JOIN analytics.games g ON g.game_id = r.game_id::text
    WHERE g.status = 'Final'
      AND g.start_time IS NOT NULL
      AND r.fetched_at < g.start_time
      AND lower(coalesce(r.market_type, '')) = 'over_under'
      AND lower(r.side) IN ('over', 'under')
      AND NOT EXISTS (
        SELECT 1 FROM research.prop_decision_lines m
        WHERE m.game_id = g.game_id
          AND m.player_id = r.player_id::text
          AND m.sportsbook = r.sportsbook
          AND m.prop_type = r.prop_type
          AND m.side = r.side
      )
    ORDER BY
      r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side,
      r.fetched_at DESC,
      r.pull_run_id DESC NULLS LAST
    ON CONFLICT (game_id, player_id, sportsbook, prop_type, side) DO NOTHING
`;

export type PreTipObservation = {
  gameId: string;
  playerId: string;
  sportsbook: string;
  propType: string;
  side: string;
  lineValue: number;
  oddsAmerican: number;
  fetchedAt: Date;
  pullRunId: number;
};

/** Same order as MATERIALIZE_CLOSING_LINES_SQL: latest fetched_at, then later pull. */
export function selectLatestPreTipObservations<T extends PreTipObservation>(
  rows: T[],
  tip: Date
): T[] {
  const eligible = rows.filter((row) => row.fetchedAt.getTime() < tip.getTime());
  const best = new Map<string, T>();
  for (const row of eligible) {
    const key = [row.gameId, row.playerId, row.sportsbook, row.propType, row.side].join('|');
    const prev = best.get(key);
    if (!prev) {
      best.set(key, row);
      continue;
    }
    const newer =
      row.fetchedAt.getTime() > prev.fetchedAt.getTime() ||
      (row.fetchedAt.getTime() === prev.fetchedAt.getTime() && row.pullRunId > prev.pullRunId);
    if (newer) best.set(key, row);
  }
  return [...best.values()];
}

export async function materializeClosingLines(pool: Pool): Promise<number> {
  const result = await pool.query(MATERIALIZE_CLOSING_LINES_SQL);
  return result.rowCount ?? 0;
}

/**
 * Pending closing-line keys that would be lost if prune-eligible raw rows were deleted.
 */
export async function countPendingClosingLinesForPruneEligible(
  pool: Pool,
  retentionDays: number = RETENTION_DAYS
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `
    SELECT COUNT(*)::text AS count
    FROM (
      SELECT DISTINCT r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side
      FROM raw.player_prop_snapshots_v2 r
      INNER JOIN analytics.games g ON g.game_id = r.game_id::text
      WHERE g.status = 'Final'
        AND g.start_time IS NOT NULL
        AND r.fetched_at < g.start_time
        AND r.fetched_at < now() - ($1::text || ' days')::interval
        AND lower(coalesce(r.market_type, '')) = 'over_under'
        AND lower(r.side) IN ('over', 'under')
        AND NOT EXISTS (
          SELECT 1 FROM research.prop_decision_lines m
          WHERE m.game_id = g.game_id
            AND m.player_id = r.player_id::text
            AND m.sportsbook = r.sportsbook
            AND m.prop_type = r.prop_type
            AND m.side = r.side
        )
    ) pending
    `,
    [String(retentionDays)]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function countRawTotal(pool: Pool): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM raw.player_prop_snapshots_v2`
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function countRawEligible(
  pool: Pool,
  retentionDays: number = RETENTION_DAYS
): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM raw.player_prop_snapshots_v2
     WHERE fetched_at < now() - ($1::text || ' days')::interval`,
    [String(retentionDays)]
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function countCurrentTotal(pool: Pool): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM analytics.player_props_current`
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function countCurrentEligible(
  pool: Pool,
  retentionDays: number = RETENTION_DAYS
): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM analytics.player_props_current p
     INNER JOIN analytics.games g ON g.game_id = p.game_id::text
     WHERE g.status = 'Final'
       AND g.start_time < now() - ($1::text || ' days')::interval`,
    [String(retentionDays)]
  );
  return Number(r.rows[0]?.count ?? 0);
}

/**
 * Seasons that own prune-eligible raw snapshots (via analytics.games.season).
 */
export async function listSeasonsWithEligibleRaw(
  pool: Pool,
  retentionDays: number = RETENTION_DAYS
): Promise<number[]> {
  const r = await pool.query<{ season: string }>(
    `
    SELECT DISTINCT trim(both from g.season)::int AS season
    FROM raw.player_prop_snapshots_v2 r
    INNER JOIN analytics.games g ON g.game_id = r.game_id::text
    WHERE r.fetched_at < now() - ($1::text || ' days')::interval
      AND g.season IS NOT NULL
      AND trim(both from g.season) ~ '^[0-9]+'
    ORDER BY 1
    `,
    [String(retentionDays)]
  );
  return r.rows.map((row) => Number(row.season)).filter((n) => Number.isFinite(n));
}

export type RawPruneArchiveOpts = {
  requireArchive: boolean;
  requiredAfterIso: string | null;
  legacyDumpOk: boolean;
};

/**
 * Seasons that still have prune-eligible LEGACY raw snapshots
 * (null pull_run_id, or game run started before PLAYER_PROP_ARCHIVE_REQUIRED_AFTER).
 * Used only when the per-run S3 archive prune gate is on, so 2026–27
 * balldontlie objects are not judged by the recovered player_props_raw_v2 dump.
 */
export async function listSeasonsWithEligibleLegacyRaw(
  pool: Pool,
  retentionDays: number = RETENTION_DAYS,
  requiredAfterIso: string | null = null
): Promise<number[]> {
  const r = await pool.query<{ season: string }>(
    `
    SELECT DISTINCT trim(both from g.season)::int AS season
    FROM raw.player_prop_snapshots_v2 r
    INNER JOIN analytics.games g ON g.game_id = r.game_id::text
    LEFT JOIN raw.player_prop_game_runs gr
      ON r.pull_run_id IS NOT NULL
     AND gr.pull_run_id = r.pull_run_id
     AND gr.game_id = r.game_id::text
    WHERE r.fetched_at < now() - ($1::text || ' days')::interval
      AND g.season IS NOT NULL
      AND trim(both from g.season) ~ '^[0-9]+'
      AND (
        r.pull_run_id IS NULL
        OR ($2::timestamptz IS NOT NULL AND gr.started_at IS NOT NULL AND gr.started_at < $2::timestamptz)
      )
    ORDER BY 1
    `,
    [String(retentionDays), requiredAfterIso]
  );
  return r.rows.map((row) => Number(row.season)).filter((n) => Number.isFinite(n));
}

export async function countRawDeletable(
  pool: Pool,
  retentionDays: number = RETENTION_DAYS,
  archiveOpts: RawPruneArchiveOpts
): Promise<number> {
  if (!archiveOpts.requireArchive) {
    return countRawEligible(pool, retentionDays);
  }
  const r = await pool.query<{ count: string }>(
    `
    SELECT COUNT(*)::text AS count
    FROM raw.player_prop_snapshots_v2 r
    LEFT JOIN raw.player_prop_game_runs gr
      ON r.pull_run_id IS NOT NULL
     AND gr.pull_run_id = r.pull_run_id
     AND gr.game_id = r.game_id::text
    WHERE r.fetched_at < now() - ($1::text || ' days')::interval
      AND (
        coalesce(gr.archive_status, '') = 'archived'
        OR (
          $2::boolean
          AND (
            r.pull_run_id IS NULL
            OR ($3::timestamptz IS NOT NULL AND gr.started_at IS NOT NULL AND gr.started_at < $3::timestamptz)
          )
        )
      )
    `,
    [String(retentionDays), archiveOpts.legacyDumpOk, archiveOpts.requiredAfterIso]
  );
  return Number(r.rows[0]?.count ?? 0);
}

/**
 * Age-eligible new-run rows that must stay until a verified S3 archive exists.
 */
export async function countRawBlockedByMissingArchive(
  pool: Pool,
  retentionDays: number = RETENTION_DAYS,
  requiredAfterIso: string | null = null
): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `
    SELECT COUNT(*)::text AS count
    FROM raw.player_prop_snapshots_v2 r
    LEFT JOIN raw.player_prop_game_runs gr
      ON r.pull_run_id IS NOT NULL
     AND gr.pull_run_id = r.pull_run_id
     AND gr.game_id = r.game_id::text
    WHERE r.fetched_at < now() - ($1::text || ' days')::interval
      AND r.pull_run_id IS NOT NULL
      AND NOT (
        $2::timestamptz IS NOT NULL AND gr.started_at IS NOT NULL AND gr.started_at < $2::timestamptz
      )
      AND coalesce(gr.archive_status, '') IS DISTINCT FROM 'archived'
    `,
    [String(retentionDays), requiredAfterIso]
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function deleteRawEligibleBatches(
  pool: Pool,
  retentionDays: number = RETENTION_DAYS,
  batchSize: number = DELETE_BATCH,
  archiveOpts?: RawPruneArchiveOpts
): Promise<number> {
  let deleted = 0;
  while (true) {
    const result = archiveOpts?.requireArchive
      ? await pool.query(
          `WITH doomed AS (
             SELECT r.ctid
             FROM raw.player_prop_snapshots_v2 r
             LEFT JOIN raw.player_prop_game_runs gr
               ON r.pull_run_id IS NOT NULL
              AND gr.pull_run_id = r.pull_run_id
              AND gr.game_id = r.game_id::text
             WHERE r.fetched_at < now() - ($1::text || ' days')::interval
               AND (
                 coalesce(gr.archive_status, '') = 'archived'
                 OR (
                   $3::boolean
                   AND (
                     r.pull_run_id IS NULL
                     OR ($4::timestamptz IS NOT NULL AND gr.started_at IS NOT NULL AND gr.started_at < $4::timestamptz)
                   )
                 )
               )
             LIMIT $2
           )
           DELETE FROM raw.player_prop_snapshots_v2 t
           USING doomed d
           WHERE t.ctid = d.ctid`,
          [
            String(retentionDays),
            batchSize,
            archiveOpts.legacyDumpOk,
            archiveOpts.requiredAfterIso,
          ]
        )
      : await pool.query(
          `WITH doomed AS (
             SELECT ctid
             FROM raw.player_prop_snapshots_v2
             WHERE fetched_at < now() - ($1::text || ' days')::interval
             LIMIT $2
           )
           DELETE FROM raw.player_prop_snapshots_v2 t
           USING doomed d
           WHERE t.ctid = d.ctid`,
          [String(retentionDays), batchSize]
        );
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count === 0) break;
  }
  return deleted;
}

export async function deleteCurrentEligibleBatches(
  pool: Pool,
  retentionDays: number = RETENTION_DAYS,
  batchSize: number = DELETE_BATCH
): Promise<number> {
  let deleted = 0;
  while (true) {
    const result = await pool.query(
      `WITH doomed AS (
         SELECT p.ctid
         FROM analytics.player_props_current p
         INNER JOIN analytics.games g ON g.game_id = p.game_id::text
         WHERE g.status = 'Final'
           AND g.start_time < now() - ($1::text || ' days')::interval
         LIMIT $2
       )
       DELETE FROM analytics.player_props_current t
       USING doomed d
       WHERE t.ctid = d.ctid`,
      [String(retentionDays), batchSize]
    );
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count === 0) break;
  }
  return deleted;
}
