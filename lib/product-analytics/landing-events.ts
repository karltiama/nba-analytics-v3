/**
 * Landing conversion events. Destination intent only.
 * Do not send campaign text, player names, or query strings.
 */

import {
  PRODUCT_EVENTS,
  type LandingCtaAction,
  type LandingCtaClickedProperties,
  type LandingCtaLocation,
} from '@/lib/product-analytics/track-event';

export const LANDING_CTA_CLICKED = PRODUCT_EVENTS.LANDING_CTA_CLICKED;

export function landingCtaProperties(
  location: LandingCtaLocation,
  action: LandingCtaAction
): LandingCtaClickedProperties {
  return { surface: 'landing', location, action };
}
