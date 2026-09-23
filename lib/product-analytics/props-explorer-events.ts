/**
 * Props Explorer engagement. Market category only.
 * Never send line, odds, book, player name, or the search query.
 */

import { CANONICAL_PROP_TYPES } from '@/lib/betting/market-movement';
import {
  PRODUCT_EVENTS,
  type ClosedPropMarket,
  type PropContextOpenedProperties,
  type PropExplorerEventProperties,
} from '@/lib/product-analytics/track-event';

export const PROP_OPENED = PRODUCT_EVENTS.PROP_OPENED;
export const PROP_ADDED_TO_PARLAY = PRODUCT_EVENTS.PROP_ADDED_TO_PARLAY;
export const PROP_CONTEXT_OPENED = PRODUCT_EVENTS.PROP_CONTEXT_OPENED;

const CANONICAL_MARKETS = new Set<string>(CANONICAL_PROP_TYPES);

export function closedPropMarket(value: string | null | undefined): ClosedPropMarket {
  const key = (value ?? '').trim().toLowerCase();
  if (CANONICAL_MARKETS.has(key)) return key as ClosedPropMarket;
  return 'other';
}

export function propOpenedProperties(propType: string | null | undefined): PropExplorerEventProperties {
  return { surface: 'props_explorer', market: closedPropMarket(propType) };
}

export function propAddedToParlayProperties(
  propType: string | null | undefined
): PropExplorerEventProperties {
  return { surface: 'props_explorer', market: closedPropMarket(propType) };
}

export function propContextOpenedProperties(
  propType: string | null | undefined
): PropContextOpenedProperties {
  return {
    surface: 'props_explorer',
    context_type: 'player_panel',
    market: closedPropMarket(propType),
  };
}
