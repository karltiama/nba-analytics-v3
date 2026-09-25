import { describe, expect, it } from 'vitest';
import { SCREENSHOT_EXTRACTION_AVAILABLE } from '@/lib/parlay-xray/types';
import { loadXrayExtractionConfig } from '@/lib/parlay-xray/extraction/config';
import { CAPABILITY_REGISTRY, evaluateCapability } from '../capabilities';
import { FOUNDING_PRO_PRICE_CONCEPT } from '../types';
import { getBillingAvailability } from '@/lib/billing/availability';

const FREE = { isPro: false, authenticated: true };
const PRO = { isPro: true, authenticated: true };

const FREE_CORE = [
  'PROPS_BROWSE',
  'PROPS_COMPARE',
  'PLAYER_RESEARCH_BASIC',
  'GAME_RESEARCH_BASIC',
  'PARLAY_BUILD',
  'PARLAY_WORKSPACE',
  'PARLAY_STRUCTURAL_ANALYSIS',
  'PARLAY_WHY_THIS_COULD_FAIL',
  'PARLAY_HISTORICAL_CONTEXT',
  'WOWY_BASIC',
  'XRAY_CORRECTION',
  'XRAY_CONFIRM',
] as const;

const NEVER_PAYWALL = [
  'PARLAY_STRUCTURAL_ANALYSIS',
  'PARLAY_WHY_THIS_COULD_FAIL',
  'XRAY_CORRECTION',
  'XRAY_CONFIRM',
  'AVAILABILITY_CONTEXT',
] as const;

describe('STEP 14P.E14 Free / Pro policy invariants', () => {
  it('keeps the Free core workflow allowed for Free and Pro', () => {
    for (const capability of FREE_CORE) {
      expect(CAPABILITY_REGISTRY[capability].readiness).toBe('AVAILABLE');
      expect(CAPABILITY_REGISTRY[capability].planAccess).not.toBe('PRO');
      expect(evaluateCapability(FREE, capability)).toMatchObject({
        access: 'allow',
        showUpgrade: false,
      });
      expect(evaluateCapability(PRO, capability).access).toBe('allow');
    }
  });

  it('keeps Why This Could Fail, structural warnings, and basic WOWY on Free', () => {
    expect(evaluateCapability(FREE, 'PARLAY_WHY_THIS_COULD_FAIL').access).toBe('allow');
    expect(evaluateCapability(FREE, 'PARLAY_STRUCTURAL_ANALYSIS').access).toBe('allow');
    expect(evaluateCapability(FREE, 'WOWY_BASIC').access).toBe('allow');
    expect(CAPABILITY_REGISTRY.WOWY_BASIC.planAccess).not.toBe('PRO');
  });

  it('keeps available Pro depth on Pro only', () => {
    for (const capability of ['LINE_SHOPPING_DETAIL', 'MARKET_MOVEMENT_DEEP', 'AI_BRIEFING'] as const) {
      expect(CAPABILITY_REGISTRY[capability].readiness).toBe('AVAILABLE');
      expect(CAPABILITY_REGISTRY[capability].planAccess).toBe('PRO');
      expect(evaluateCapability(FREE, capability)).toMatchObject({
        access: 'deny',
        reason: 'PLAN_REQUIRED',
        showUpgrade: true,
      });
      expect(evaluateCapability(PRO, capability).access).toBe('allow');
    }
  });

  it('does not let Pro or Free bypass not-ready, internal, or kill-switched capabilities', () => {
    for (const capability of [
      'CURRENT_LIVE_ANALYSIS',
      'SAVED_PARLAYS',
      'ALERTS',
      'ADVANCED_HISTORY',
      'WOWY_ADVANCED',
      'MEASURED_CORRELATION',
    ] as const) {
      expect(evaluateCapability(FREE, capability).showUpgrade).toBe(false);
      expect(evaluateCapability(PRO, capability)).toMatchObject({
        access: 'deny',
        reason: 'FEATURE_NOT_READY',
        showUpgrade: false,
      });
    }

    expect(evaluateCapability(PRO, 'PTS_C_REB_C')).toMatchObject({
      access: 'deny',
      reason: 'INTERNAL_ONLY',
      showUpgrade: false,
    });
    expect(evaluateCapability(FREE, 'PTS_C_REB_C').access).toBe('deny');
    expect(evaluateCapability(PRO, 'AVAILABILITY_CONTEXT').reason).toBe('PROVIDER_BLOCKED');
    expect(evaluateCapability(FREE, 'XRAY_EXTRACTION').reason).toBe('KILL_SWITCH');
    expect(evaluateCapability(PRO, 'XRAY_EXTRACTION')).toMatchObject({
      access: 'deny',
      reason: 'KILL_SWITCH',
      showUpgrade: false,
    });
    expect(SCREENSHOT_EXTRACTION_AVAILABLE).toBe(false);
    expect(loadXrayExtractionConfig({}).enabled).toBe(false);
  });

  it('refuses upgrade CTAs for unavailable capabilities', () => {
    for (const id of Object.keys(CAPABILITY_REGISTRY) as (keyof typeof CAPABILITY_REGISTRY)[]) {
      const spec = CAPABILITY_REGISTRY[id];
      if (spec.readiness === 'AVAILABLE' && id !== 'XRAY_EXTRACTION') continue;
      expect(evaluateCapability(FREE, id).showUpgrade).toBe(false);
      expect(evaluateCapability(PRO, id).showUpgrade).toBe(false);
    }
  });

  it('cannot mark a never-paywall capability as Pro-only', () => {
    for (const capability of NEVER_PAYWALL) {
      expect(CAPABILITY_REGISTRY[capability].neverPaywall).toBe(true);
      expect(CAPABILITY_REGISTRY[capability].planAccess).not.toBe('PRO');
      expect(evaluateCapability(FREE, capability).reason).not.toBe('PLAN_REQUIRED');
      expect(evaluateCapability(FREE, capability).showUpgrade).toBe(false);
    }
  });

  it('stores future commercial quotas without enforcing them', () => {
    expect(CAPABILITY_REGISTRY.XRAY_EXTRACTION.commercialQuota).toEqual({
      status: 'PREPARED_NOT_ACTIVE',
      kind: 'COMMERCIAL_LIMIT',
      free: 3,
      pro: 10,
      unit: 'imports_per_day',
    });
    expect(CAPABILITY_REGISTRY.SAVED_PARLAYS.commercialQuota).toEqual({
      status: 'PROPOSED_NOT_ACTIVE',
      kind: 'COMMERCIAL_LIMIT',
      free: 5,
      pro: 50,
      unit: 'saved_count',
    });
    expect(CAPABILITY_REGISTRY.CURRENT_LIVE_ANALYSIS).toMatchObject({
      readiness: 'NOT_READY',
      planAccess: 'BOTH',
    });
    expect(evaluateCapability(PRO, 'SAVED_PARLAYS').access).toBe('deny');
    expect(evaluateCapability(PRO, 'XRAY_EXTRACTION', { xrayExtractionEnabled: true }).reason).toBe(
      'AVAILABLE'
    );
  });

  it('leaves checkout disabled and the public price label unchanged', () => {
    expect(FOUNDING_PRO_PRICE_CONCEPT).toBe('$9.99/month');
    expect(
      getBillingAvailability({
        VERCEL_ENV: 'production',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
        STRIPE_FOUNDING_PRO_PRICE_ID: 'price_x',
        APP_BASE_URL: 'https://example.com',
      }).checkoutEnabled
    ).toBe(false);
  });
});
