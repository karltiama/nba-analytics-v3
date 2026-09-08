import { describe, expect, it } from 'vitest';
import {
  billingPlanLabel,
  billingRetentionCopy,
  billingStatusLine,
  isManualProWithoutStripe,
  showManageBilling,
  showUpgradeCheckout,
} from '../status-copy';

const PERIOD_END = '2026-10-01T00:00:00.000Z';

describe('billing status copy', () => {
  it('keeps canceled-in-period as Founding Pro with a cancel date', () => {
    const status = {
      isPro: true,
      status: 'canceled',
      currentPeriodEnd: PERIOD_END,
      canManageBilling: true,
      checkoutEnabled: true,
    };
    expect(billingPlanLabel(status)).toBe('Founding Pro');
    expect(billingStatusLine(status)).toMatch(/^Cancels on /);
    expect(billingRetentionCopy(status)).toBeNull();
    expect(showUpgradeCheckout(status)).toBe(false);
    expect(showManageBilling(status)).toBe(true);
  });

  it('treats past_due as effective Free and prefers Manage billing over Upgrade', () => {
    const status = {
      isPro: false,
      status: 'past_due',
      currentPeriodEnd: PERIOD_END,
      canManageBilling: true,
      checkoutEnabled: true,
    };
    expect(billingPlanLabel(status)).toBe('Free');
    expect(billingStatusLine(status)).toBe('Past due');
    expect(billingRetentionCopy(status)).toMatch(/still saved/);
    expect(showUpgradeCheckout(status)).toBe(false);
    expect(showManageBilling(status)).toBe(true);
  });

  it('treats expired as Free with Upgrade when Checkout is enabled', () => {
    const status = {
      isPro: false,
      status: 'expired',
      currentPeriodEnd: PERIOD_END,
      canManageBilling: false,
      checkoutEnabled: true,
    };
    expect(billingPlanLabel(status)).toBe('Free');
    expect(showUpgradeCheckout(status)).toBe(true);
    expect(billingRetentionCopy(status)).toMatch(/still saved/);
  });

  it('does not offer Stripe portal for manual Pro without a customer', () => {
    const status = {
      isPro: true,
      status: 'active',
      currentPeriodEnd: null,
      canManageBilling: false,
      checkoutEnabled: true,
    };
    expect(isManualProWithoutStripe(status)).toBe(true);
    expect(showManageBilling(status)).toBe(false);
    expect(showUpgradeCheckout(status)).toBe(false);
  });
});
