/**
 * Player discovery events. Counts and surface only.
 * Never send the search text, player name, or player id.
 */

import {
  PRODUCT_EVENTS,
  type PlayerSearchResultOpenedProperties,
  type PlayerSearchSurface,
  type PlayerSearchUsedProperties,
  type SearchResultCountBucket,
} from '@/lib/product-analytics/track-event';

export const PLAYER_SEARCH_USED = PRODUCT_EVENTS.PLAYER_SEARCH_USED;
export const PLAYER_SEARCH_RESULT_OPENED = PRODUCT_EVENTS.PLAYER_SEARCH_RESULT_OPENED;

export function searchResultCountBucket(count: number): SearchResultCountBucket {
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count <= 5) return '1_5';
  return '6_plus';
}

export function playerSearchUsedProperties(
  surface: PlayerSearchSurface,
  resultCount: number
): PlayerSearchUsedProperties {
  return {
    surface,
    result_count_bucket: searchResultCountBucket(resultCount),
  };
}

export function playerSearchResultOpenedProperties(
  surface: PlayerSearchSurface
): PlayerSearchResultOpenedProperties {
  return { surface };
}
