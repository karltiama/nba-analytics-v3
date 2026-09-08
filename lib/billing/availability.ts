import { FOUNDING_PRO_PRICE_CONCEPT } from '@/lib/entitlements/types';
import { getStripeBillingConfig } from './config';

export type BillingMode = 'disabled' | 'stripe_test' | 'stripe_live';

export type BillingAvailability = {
  mode: BillingMode;
  checkoutEnabled: boolean;
  portalEnabled: boolean;
  notice: string | null;
  priceLabel: string;
};

function trim(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Vercel Production only. Local `next start` and Preview keep test Checkout. */
export function isPublicProductionDeploy(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (env.VERCEL_ENV ?? '').trim().toLowerCase() === 'production';
}

/**
 * Public billing capability. Live keys never enable Checkout in WP6.4.
 * Test keys on Production do not present a live commercial purchase.
 */
export function getBillingAvailability(
  env: Record<string, string | undefined> = process.env
): BillingAvailability {
  const priceLabel = FOUNDING_PRO_PRICE_CONCEPT;
  const secretKey = trim(env.STRIPE_SECRET_KEY);

  if (secretKey?.startsWith('sk_live_')) {
    return {
      mode: 'stripe_live',
      checkoutEnabled: false,
      portalEnabled: false,
      notice: 'Live Stripe billing is not enabled.',
      priceLabel,
    };
  }

  const cfg = getStripeBillingConfig(env);
  if (!cfg.ok) {
    return {
      mode: 'disabled',
      checkoutEnabled: false,
      portalEnabled: false,
      notice: 'Founding Pro billing is not available in this environment.',
      priceLabel,
    };
  }

  if (isPublicProductionDeploy(env)) {
    return {
      mode: 'stripe_test',
      checkoutEnabled: false,
      portalEnabled: false,
      notice: 'Founding Pro is not available for live purchase yet.',
      priceLabel,
    };
  }

  return {
    mode: 'stripe_test',
    checkoutEnabled: true,
    portalEnabled: true,
    notice: 'Stripe test mode. No live charges.',
    priceLabel,
  };
}
