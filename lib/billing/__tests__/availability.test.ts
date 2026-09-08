import { describe, expect, it } from 'vitest';
import { getBillingAvailability, isPublicProductionDeploy } from '../availability';

const TEST_STRIPE = {
  STRIPE_SECRET_KEY: 'sk_test_abc',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc',
  STRIPE_FOUNDING_PRO_PRICE_ID: 'price_founding_pro',
  APP_BASE_URL: 'http://localhost:3000',
};

describe('getBillingAvailability', () => {
  it('is disabled when Stripe env is missing', () => {
    const result = getBillingAvailability({});
    expect(result.mode).toBe('disabled');
    expect(result.checkoutEnabled).toBe(false);
    expect(result.portalEnabled).toBe(false);
  });

  it('enables test Checkout outside Vercel Production', () => {
    const result = getBillingAvailability(TEST_STRIPE);
    expect(result.mode).toBe('stripe_test');
    expect(result.checkoutEnabled).toBe(true);
    expect(result.notice).toMatch(/test mode/i);
    expect(result.priceLabel).toBe('$10/month');
  });

  it('does not present live purchase when test Stripe is on Vercel Production', () => {
    const result = getBillingAvailability({ ...TEST_STRIPE, VERCEL_ENV: 'production' });
    expect(isPublicProductionDeploy({ VERCEL_ENV: 'production' })).toBe(true);
    expect(result.mode).toBe('stripe_test');
    expect(result.checkoutEnabled).toBe(false);
    expect(result.portalEnabled).toBe(false);
    expect(result.notice).toMatch(/not available for live purchase/i);
  });

  it('never enables Checkout for live Stripe keys', () => {
    const result = getBillingAvailability({
      STRIPE_SECRET_KEY: 'sk_live_not_allowed',
      STRIPE_WEBHOOK_SECRET: 'whsec_abc',
      STRIPE_FOUNDING_PRO_PRICE_ID: 'price_founding_pro',
      APP_BASE_URL: 'http://localhost:3000',
    });
    expect(result.mode).toBe('stripe_live');
    expect(result.checkoutEnabled).toBe(false);
    expect(result.portalEnabled).toBe(false);
  });
});
