import type { Pool } from 'pg';

export const RETENTION_DAYS = 3;
export const DELETE_BATCH = 50_000;

export async function materializeClosingLines(pool: Pool): Promise<number> {
  const result = await pool.query(`
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
      r.fetched_at DESC
    ON CONFLICT (game_id, player_id, sportsbook, prop_type, side) DO NOTHING
  `);
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

export async function deleteRawEligibleBatches(
  pool: Pool,
  retentionDays: number = RETENTION_DAYS,
  batchSize: number = DELETE_BATCH
): Promise<number> {
  let deleted = 0;
  while (true) {
    const result = await pool.query(
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
