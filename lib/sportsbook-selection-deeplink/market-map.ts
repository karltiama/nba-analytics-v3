/**
 * Explicit CanonicalPropType → The Odds API market key mapping.
 * Unsupported Court Context markets stay unsupported (no guessing).
 */

import type { CanonicalPropType } from '@/lib/betting/market-movement';

/** Documented Odds API NBA player-prop market keys we intentionally support. */
export const ODDS_API_PLAYER_PROP_MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_blocks',
  'player_steals',
  'player_points_rebounds',
  'player_points_assists',
  'player_rebounds_assists',
  'player_points_rebounds_assists',
] as const;

export type OddsApiPlayerPropMarket = (typeof ODDS_API_PLAYER_PROP_MARKETS)[number];

const CANONICAL_TO_ODDS_API: Partial<Record<CanonicalPropType, OddsApiPlayerPropMarket>> = {
  points: 'player_points',
  rebounds: 'player_rebounds',
  assists: 'player_assists',
  threes: 'player_threes',
  blocks: 'player_blocks',
  steals: 'player_steals',
  points_rebounds: 'player_points_rebounds',
  points_assists: 'player_points_assists',
  rebounds_assists: 'player_rebounds_assists',
  points_rebounds_assists: 'player_points_rebounds_assists',
};

export function mapCanonicalPropToOddsApiMarket(
  market: CanonicalPropType
): OddsApiPlayerPropMarket | null {
  return CANONICAL_TO_ODDS_API[market] ?? null;
}

export function isOddsApiPlayerPropMarketSupported(market: CanonicalPropType): boolean {
  return mapCanonicalPropToOddsApiMarket(market) != null;
}
