/**
 * Pregame market writes. Eligibility is decided from analytics.games at write time,
 * inside the same transaction as the insert, so a tip during the provider call cannot
 * land in current, history, or movement.
 */

import type { PoolClient } from 'pg';

export type PromotionCounts = {
  current: number;
  history: number;
  movement: number;
  acquiredRows: number;
  pregameEligibleRows: number;
  postTipRowsSkipped: number;
  currentRowsUpdated: number;
  historyRowsInserted: number;
  movementRowsInserted: number;
};

type RawOddsRow = {
  game_id: string;
  vendor: string;
  spread_home_value: string | number | null;
  spread_home_odds: number | null;
  spread_away_value: string | number | null;
  spread_away_odds: number | null;
  moneyline_home_odds: number | null;
  moneyline_away_odds: number | null;
  total_value: string | number | null;
  total_over_odds: number | null;
  total_under_odds: number | null;
  provider_updated_at: Date | string | null;
  pull_run_id: number;
};

/**
 * True only for a future tip whose canonical status is still scheduled.
 * Live, final, postponed, canceled, unknown, and a tip that clock_timestamp() has reached are false.
 */
export function pregameMarketEligibleSql(alias = 'g'): string {
  const status = `lower(regexp_replace(btrim(coalesce(${alias}.status, '')), '[[:space:]]+', ' ', 'g'))`;
  return `${alias}.start_time IS NOT NULL
    AND ${alias}.start_time > clock_timestamp()
    AND CASE
      WHEN ${status} = 'final' THEN false
      WHEN ${status} IN ('inprogress', 'in progress', 'live', 'halftime', 'in_progress') THEN false
      WHEN ${status} ~ '^(end of )?(1st|2nd|3rd|4th) qtr($|[^a-z0-9])' THEN false
      WHEN ${status} ~ '^q[1-4]($|[^a-z0-9])' THEN false
      WHEN ${status} ~ '^end of (1st|2nd|3rd|4th|q[1-4])($|[^a-z0-9])' THEN false
      WHEN ${status} ~ '^(end of )?[0-9]?ot[0-9]?($|[^a-z0-9])' THEN false
      WHEN ${status} = 'overtime' THEN false
      WHEN ${status} = 'postponed' THEN false
      WHEN ${status} IN ('cancelled', 'canceled') THEN false
      WHEN ${status} = 'scheduled' THEN true
      WHEN btrim(${alias}.status) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN true
      WHEN btrim(${alias}.status) ~* '[0-9]{1,2}:[0-9]{2}[[:space:]]*(am|pm)' THEN true
      WHEN btrim(${alias}.status) ~* '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?([.][0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})?$' THEN true
      ELSE false
    END`;
}

async function gameIsEligible(client: PoolClient, gameId: string): Promise<boolean> {
  const locked = await client.query<{ eligible: boolean }>(
    `SELECT ${pregameMarketEligibleSql('g')} AS eligible
     FROM analytics.games g
     WHERE g.game_id = $1
     FOR UPDATE`,
    [gameId]
  );
  return locked.rows[0]?.eligible === true;
}

async function insertHistory(client: PoolClient, row: RawOddsRow): Promise<number> {
  const inserted = await client.query(
    `INSERT INTO analytics.game_odds_history (
       game_id, home_moneyline, away_moneyline,
       home_spread, home_spread_odds, away_spread, away_spread_odds,
       total, over_odds, under_odds,
       vendor, snapshot_at, pull_run_id
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
     FROM analytics.games g
     WHERE g.game_id = $1
       AND ${pregameMarketEligibleSql('g')}
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
  return inserted.rowCount ?? 0;
}

async function upsertCurrent(client: PoolClient, row: RawOddsRow): Promise<number> {
  const updated = await client.query(
    `INSERT INTO analytics.game_odds_current (
       game_id, home_moneyline, away_moneyline,
       home_spread, home_spread_odds, away_spread, away_spread_odds,
       total, over_odds, under_odds,
       vendor, snapshot_at, pull_run_id, updated_at
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now()
     FROM analytics.games g
     WHERE g.game_id = $1
       AND ${pregameMarketEligibleSql('g')}
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
     WHERE analytics.game_odds_current.snapshot_at < excluded.snapshot_at
       AND EXISTS (
         SELECT 1 FROM analytics.games g
         WHERE g.game_id = analytics.game_odds_current.game_id
           AND ${pregameMarketEligibleSql('g')}
       )`,
    [
      row.game_id,
      row.moneyline_home_odds, row.moneyline_away_odds,
      row.spread_home_value, row.spread_home_odds,
      row.spread_away_value, row.spread_away_odds,
      row.total_value, row.total_over_odds, row.total_under_odds,
      row.vendor, row.provider_updated_at, row.pull_run_id,
    ]
  );
  return updated.rowCount ?? 0;
}

async function refreshMovement(client: PoolClient, gameId: string, vendor: string): Promise<number> {
  const result = await client.query(
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
     WHERE EXISTS (
       SELECT 1 FROM analytics.games g
       WHERE g.game_id = $1
         AND ${pregameMarketEligibleSql('g')}
     )
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
    [gameId, vendor]
  );
  return result.rowCount ?? 0;
}

export async function promotePullOdds(
  client: PoolClient,
  pullRunId: number,
  preferredVendor: string
): Promise<PromotionCounts> {
  const allRows = await client.query<RawOddsRow>(
    `SELECT game_id, vendor,
       spread_home_value, spread_home_odds, spread_away_value, spread_away_odds,
       moneyline_home_odds, moneyline_away_odds,
       total_value, total_over_odds, total_under_odds,
       provider_updated_at, pull_run_id
     FROM raw.odds_snapshots
     WHERE pull_run_id = $1`,
    [pullRunId]
  );
  const counts: PromotionCounts = {
    current: 0,
    history: 0,
    movement: 0,
    acquiredRows: allRows.rows.length,
    pregameEligibleRows: 0,
    postTipRowsSkipped: 0,
    currentRowsUpdated: 0,
    historyRowsInserted: 0,
    movementRowsInserted: 0,
  };
  for (const row of allRows.rows) {
    if (row.provider_updated_at == null) continue;
    const eligible = await gameIsEligible(client, String(row.game_id));
    if (!eligible) {
      counts.postTipRowsSkipped += 1;
      continue;
    }
    counts.pregameEligibleRows += 1;
    const historyInserted = await insertHistory(client, row);
    counts.historyRowsInserted += historyInserted;
    counts.history += historyInserted;
    if (row.vendor !== preferredVendor) continue;
    const currentUpdated = await upsertCurrent(client, row);
    counts.currentRowsUpdated += currentUpdated;
    counts.current += currentUpdated;
    const movementInserted = await refreshMovement(client, String(row.game_id), row.vendor);
    counts.movementRowsInserted += movementInserted;
    counts.movement += movementInserted;
  }
  return counts;
}
