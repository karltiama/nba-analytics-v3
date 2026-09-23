/**
 * Signup and Founding Pro intent.
 * Never send email, account ids, price, Stripe ids, or checkout session ids.
 *
 * market_movement_upgrade_clicked stays separate for historical continuity.
 */

import {
  PRODUCT_EVENTS,
  type CheckoutStartedProperties,
  type SignupSurfaceProperties,
  type UpgradeClickedProperties,
  type UpgradeClickedSurface,
} from '@/lib/product-analytics/track-event';

export const UPGRADE_CLICKED = PRODUCT_EVENTS.UPGRADE_CLICKED;
export const CHECKOUT_STARTED = PRODUCT_EVENTS.CHECKOUT_STARTED;
export const SIGNUP_STARTED = PRODUCT_EVENTS.SIGNUP_STARTED;
export const SIGNUP_COMPLETED = PRODUCT_EVENTS.SIGNUP_COMPLETED;

export function upgradeClickedProperties(surface: UpgradeClickedSurface): UpgradeClickedProperties {
  return { surface, plan: 'founding_pro' };
}

export function checkoutStartedProperties(): CheckoutStartedProperties {
  return { surface: 'billing', plan: 'founding_pro' };
}

export function signupSurfaceProperties(): SignupSurfaceProperties {
  return { surface: 'signup' };
}
