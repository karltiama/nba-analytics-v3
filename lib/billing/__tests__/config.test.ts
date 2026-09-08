import { describe, expect, it } from 'vitest';
import { getStripeBillingConfig } from '../config';

const BASE = {
  STRIPE_SECRET_KEY: 'sk_test_abc',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc',
  STRIPE_FOUNDING_PRO_PRICE_ID: 'price_founding_pro',
  APP_BASE_URL: 'http://localhost:3000',
};

describe('getStripeBillingConfig', () => {
  it('fails closed when env is missing', () => {
    const result = getStripeBillingConfig({});
    expect(result.ok).toBe(false);
  });

  it('rejects live secret keys', () => {
    const result = getStripeBillingConfig({
      ...BASE,
      STRIPE_SECRET_KEY: 'sk_live_not_allowed',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/test-mode/i);
  });

  it('rejects malformed webhook secret and price id', () => {
    expect(
      getStripeBillingConfig({ ...BASE, STRIPE_WEBHOOK_SECRET: 'not-a-secret' }).ok
    ).toBe(false);
    expect(
      getStripeBillingConfig({ ...BASE, STRIPE_FOUNDING_PRO_PRICE_ID: 'prod_abc' }).ok
    ).toBe(false);
  });

  it('accepts Stripe test-mode configuration', () => {
    const result = getStripeBillingConfig(BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.foundingProPriceId).toBe('price_founding_pro');
    expect(result.config.appBaseUrl).toBe('http://localhost:3000');
  });
});
