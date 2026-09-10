import type { PropMarketResearch } from '@/lib/betting/prop-market-serving';
import { summarizePlayerMarketMovementForFree } from '@/lib/betting/market-movement-api';
import { type ResolvedEntitlement } from './types';

export type EntitledPropMarketResearch = PropMarketResearch & {
  entitlement: {
    plan: ResolvedEntitlement['plan'];
    isPro: boolean;
    features: Pick<ResolvedEntitlement['features'], 'line_shopping_detail' | 'market_movement'>;
  };
};

/**
 * Strip premium line-shopping / movement fields for Free users.
 * Computes may still happen server-side; this is the response contract.
 */
export function sanitizePropMarketResearch(
  research: PropMarketResearch,
  entitlement: ResolvedEntitlement
): EntitledPropMarketResearch {
  const shopping = { ...research.shopping };

  if (!entitlement.features.line_shopping_detail) {
    shopping.bestAvailableOverLine = null;
    shopping.bestAvailableUnderLine = null;
    shopping.bestPriceAtSelectedLine = null;
    shopping.books = [];
  }

  const marketMovement = entitlement.features.market_movement
    ? research.marketMovement
    : summarizePlayerMarketMovementForFree(research.marketMovement);

  return {
    ...research,
    shopping,
    marketMovement,
    entitlement: {
      plan: entitlement.plan,
      isPro: entitlement.isPro,
      features: {
        line_shopping_detail: entitlement.features.line_shopping_detail,
        market_movement: entitlement.features.market_movement,
      },
    },
  };
}
