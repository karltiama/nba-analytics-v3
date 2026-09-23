/**
 * User-facing Context section on a historical game.
 * Admin Context Check studio is not a production engagement surface.
 */

import {
  PRODUCT_EVENTS,
  type ContextCheckOpenedProperties,
} from '@/lib/product-analytics/track-event';

export const CONTEXT_CHECK_OPENED = PRODUCT_EVENTS.CONTEXT_CHECK_OPENED;

export function contextCheckOpenedProperties(): ContextCheckOpenedProperties {
  return { surface: 'historical_game' };
}
