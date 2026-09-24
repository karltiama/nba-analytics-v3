/**
 * Reverse map Odds API cert markets → CanonicalPropType for resolution probes.
 */

import type { CanonicalPropType } from '@/lib/betting/market-movement';
import type { CertMarketKey } from './types';

const ODDS_API_TO_CANONICAL: Record<CertMarketKey, CanonicalPropType> = {
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_assists: 'assists',
  player_threes: 'threes',
  player_points_rebounds_assists: 'points_rebounds_assists',
};

export function certMarketToCanonical(market: CertMarketKey): CanonicalPropType {
  return ODDS_API_TO_CANONICAL[market];
}
