import {
  PLAYER_PROP_MARKET_MOVEMENT_TABLE,
  playerMarketMovementSql,
} from '@/lib/betting/market-movement-api';

export { PLAYER_PROP_MARKET_MOVEMENT_TABLE, playerMarketMovementSql };

export const HISTORICAL_REPLAY_LOOKUP_SQL = playerMarketMovementSql();

export const HISTORICAL_REPLAY_COVERAGE_SQL = `
  SELECT
    count(*)::int AS row_count,
    count(distinct game_id)::int AS game_count,
    count(distinct player_id)::int AS player_count,
    count(distinct vendor)::int AS vendor_count,
    count(distinct prop_type)::int AS market_count,
    min(reference_timestamp)::text AS min_reference_timestamp,
    max(reference_timestamp)::text AS max_reference_timestamp,
    count(*) FILTER (WHERE reference_line IS NOT NULL)::int AS reference_line_count,
    count(*) FILTER (WHERE comparison_line IS NOT NULL)::int AS comparison_line_count,
    count(*) FILTER (WHERE reference_kind = '3_hour_pre_tip')::int AS three_hour_kind_count,
    count(*) FILTER (WHERE comparison_kind = 'decision_close')::int AS decision_close_kind_count
  FROM analytics.player_prop_market_movement
`;

const FORBIDDEN = [
  'player_game_logs',
  'home_score',
  'away_score',
  'v_player_outcomes',
  'player_prop_market_outcomes',
  'box_score',
  'final_points',
  'hit_miss',
  'bet_result',
];

export function assertReplaySqlIsOutcomeFree(sql: string): void {
  const lowered = sql.toLowerCase();
  for (const token of FORBIDDEN) {
    if (lowered.includes(token)) {
      throw new Error(`Replay SQL must not read ${token}`);
    }
  }
}
