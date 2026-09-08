export const STRIPE_PROVIDER = 'stripe' as const;

export type StripeBillingConfig = {
  secretKey: string;
  webhookSecret: string;
  foundingProPriceId: string;
  appBaseUrl: string;
};

export type StripeBillingConfigResult =
  | { ok: true; config: StripeBillingConfig }
  | { ok: false; error: string };

function trim(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function resolveAppBaseUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  const explicit = trim(env.APP_BASE_URL) || trim(env.NEXT_PUBLIC_APP_URL);
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = trim(env.VERCEL_URL);
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, '');
    return `https://${host}`;
  }
  return null;
}

/**
 * Fail-closed Stripe test-mode config. Live keys are rejected in WP6.3.
 */
export function getStripeBillingConfig(
  env: Record<string, string | undefined> = process.env
): StripeBillingConfigResult {
  const secretKey = trim(env.STRIPE_SECRET_KEY);
  const webhookSecret = trim(env.STRIPE_WEBHOOK_SECRET);
  const foundingProPriceId = trim(env.STRIPE_FOUNDING_PRO_PRICE_ID);
  const appBaseUrl = resolveAppBaseUrl(env);

  if (!secretKey || !webhookSecret || !foundingProPriceId) {
    return {
      ok: false,
      error: 'Billing is not configured (missing Stripe test-mode env)',
    };
  }
  if (!secretKey.startsWith('sk_test_')) {
    return {
      ok: false,
      error: 'Billing is test-mode only; live Stripe secret keys are not enabled',
    };
  }
  if (!webhookSecret.startsWith('whsec_')) {
    return { ok: false, error: 'STRIPE_WEBHOOK_SECRET is malformed' };
  }
  if (!foundingProPriceId.startsWith('price_')) {
    return { ok: false, error: 'STRIPE_FOUNDING_PRO_PRICE_ID is malformed' };
  }
  if (!appBaseUrl) {
    return { ok: false, error: 'APP_BASE_URL or VERCEL_URL is required for Checkout URLs' };
  }

  return {
    ok: true,
    config: { secretKey, webhookSecret, foundingProPriceId, appBaseUrl },
  };
}
