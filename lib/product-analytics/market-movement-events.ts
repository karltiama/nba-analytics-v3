/**
 * Market Movement v1 product events. Presentation helpers stay pure;
 * this module is the only MM analytics mapping.
 */

import type { PlayerMarketMovementResponse } from '@/lib/betting/market-movement-api';
import {
  PRODUCT_EVENTS,
  type MarketMovementUpgradeClickedProperties,
  type MarketMovementViewedProperties,
} from '@/lib/product-analytics/track-event';

export const MARKET_MOVEMENT_VIEWED = PRODUCT_EVENTS.MARKET_MOVEMENT_VIEWED;
export const MARKET_MOVEMENT_UPGRADE_CLICKED = PRODUCT_EVENTS.MARKET_MOVEMENT_UPGRADE_CLICKED;

const VIEWED_PROPERTY_KEYS = [
  'game_id',
  'prop_type',
  'detail',
  'movement_status',
  'consensus_book_count',
] as const;

export type MarketMovementViewedEvent = {
  name: typeof MARKET_MOVEMENT_VIEWED;
  key: string;
  properties: MarketMovementViewedProperties;
};

export function marketMovementViewKey(mm: PlayerMarketMovementResponse): string {
  return [
    String(mm.market.gameId),
    String(mm.market.player.id),
    String(mm.market.propType),
    mm.detail,
    mm.status,
  ].join('|');
}

function consensusBookCount(mm: PlayerMarketMovementResponse): number {
  const counts = [
    mm.consensus.reference.bookCount,
    mm.consensus.comparison.bookCount,
    mm.coverage.eligibleBookCount,
  ];
  const max = Math.max(0, ...counts.filter((n) => typeof n === 'number' && Number.isFinite(n)));
  return Math.trunc(max);
}

/** Resolved MM payload for viewed. Loading is not a MM status and must not call this. */
export function buildMarketMovementViewed(mm: PlayerMarketMovementResponse): MarketMovementViewedEvent {
  const properties: MarketMovementViewedProperties = {
    game_id: String(mm.market.gameId),
    prop_type: String(mm.market.propType),
    detail: mm.detail === 'summary' ? 'summary' : 'full',
    movement_status: mm.status,
    consensus_book_count: consensusBookCount(mm),
  };
  return {
    name: MARKET_MOVEMENT_VIEWED,
    key: marketMovementViewKey(mm),
    properties,
  };
}

/** Once-per-identity: same key as the last fire is skipped. */
export function marketMovementViewedIfChanged(
  previousKey: string | null,
  mm: PlayerMarketMovementResponse
): MarketMovementViewedEvent | null {
  const next = buildMarketMovementViewed(mm);
  if (previousKey === next.key) return null;
  return next;
}

export function marketMovementUpgradeClickedProperties(): MarketMovementUpgradeClickedProperties {
  return { surface: 'market_movement' };
}

export function viewedPropertyKeys(): readonly string[] {
  return VIEWED_PROPERTY_KEYS;
}
