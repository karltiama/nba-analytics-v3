import type { PropMarketResearch } from '@/lib/betting/prop-market-serving';
import { UPGRADE_COPY, type ResolvedEntitlement } from './types';

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
  const movement = { ...research.movement };

  if (!entitlement.features.line_shopping_detail) {
    shopping.bestAvailableOverLine = null;
    shopping.bestAvailableUnderLine = null;
    shopping.bestPriceAtSelectedLine = null;
    shopping.books = [];
  }

  if (!entitlement.features.market_movement && movement.status === 'ok') {
    movement.status = 'unavailable';
    movement.reason = 'entitlement';
    movement.message = UPGRADE_COPY.market_movement.title;
    movement.openedLine = null;
    movement.closedLine = null;
    movement.delta = null;
    movement.from = null;
    movement.to = null;
  }

  return {
    ...research,
    shopping,
    movement,
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
