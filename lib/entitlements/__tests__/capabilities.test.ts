import { describe, expect, it } from 'vitest';
import { SCREENSHOT_EXTRACTION_AVAILABLE } from '@/lib/parlay-xray/types';
import { loadXrayExtractionConfig } from '@/lib/parlay-xray/extraction/config';
import { FEATURE_NOT_AVAILABLE, ENTITLEMENT_REQUIRED, entitlementRequiredResponse } from '../http';
import {
  CAPABILITY_REGISTRY,
  COURT_CONTEXT_CAPABILITIES,
  evaluateCapability,
  evaluateFeature,
  featureFlagsForPlan,
} from '../capabilities';
import { foundingProEntitlement, freeEntitlement, hasFeature } from '../resolve';
import { sanitizePropMarketResearch } from '../sanitize-prop-market';
import { getBillingAvailability } from '@/lib/billing/availability';
import { FOUNDING_PRO_PRICE_CONCEPT } from '../types';
import type { PropMarketResearch } from '@/lib/betting/prop-market-serving';
import { mapServingRowsToPlayerMarketMovement } from '@/lib/betting/market-movement-api';

const FREE = { isPro: false, authenticated: true };
const PRO = { isPro: true, authenticated: true };
const ANON = { isPro: false, authenticated: false };

const MARKET: PropMarketResearch = {
  marketContext: 'historical',
  lineLabel: 'Historical closing line',
  comparisonLabel: 'Historical sportsbook comparison',
  paperBetAllowed: false,
  selected: {
    gameId: '1',
    playerId: '9',
    propType: 'points',
    sportsbook: 'draftkings',
    side: 'over',
    lineValue: 10.5,
    oddsAmerican: -114,
    snapshotAt: '2026-05-01T18:00:00.000Z',
  },
  shopping: {
    status: 'ok',
    reason: null,
    message: null,
    sourceTable: 'research.prop_decision_lines',
    bookCount: 2,
    marketMinLine: 10.5,
    marketMaxLine: 11.5,
    latestSnapshotAt: '2026-05-01T18:00:00.000Z',
    bestAvailableOverLine: {
      sportsbook: 'draftkings',
      side: 'over',
      lineValue: 10.5,
      oddsAmerican: -114,
      snapshotAt: '2026-05-01T18:00:00.000Z',
    },
    bestAvailableUnderLine: null,
    bestPriceAtSelectedLine: null,
    books: [
      {
        sportsbook: 'draftkings',
        side: 'over',
        lineValue: 10.5,
        oddsAmerican: -114,
        snapshotAt: '2026-05-01T18:00:00.000Z',
      },
    ],
  },
  marketMovement: mapServingRowsToPlayerMarketMovement({
    gameId: '1',
    playerId: '9',
    propType: 'points',
    rows: [],
  }),
};

describe('Court Context capability registry (E6 matrix)', () => {
  it('registers every capability with readiness and plan access', () => {
    for (const id of COURT_CONTEXT_CAPABILITIES) {
      expect(CAPABILITY_REGISTRY[id].capability).toBe(id);
    }
  });

  it('keeps the Free core parlay workflow allowed', () => {
    for (const capability of [
      'PROPS_BROWSE',
      'PARLAY_BUILD',
      'PARLAY_WORKSPACE',
      'PARLAY_STRUCTURAL_ANALYSIS',
      'PARLAY_WHY_THIS_COULD_FAIL',
      'PARLAY_HISTORICAL_CONTEXT',
      'MARKET_MOVEMENT_BASIC',
      'SAVED_PROPS',
      'PAPER_TRACKING',
      'WOWY_BASIC',
      'XRAY_CORRECTION',
      'XRAY_CONFIRM',
      'XRAY_WORKSPACE_HANDOFF',
    ] as const) {
      const decision = evaluateCapability(FREE, capability);
      expect(decision.access).toBe('allow');
      expect(decision.showUpgrade).toBe(false);
    }
  });

  it('never paywalls trust/safety capabilities', () => {
    for (const capability of [
      'PARLAY_STRUCTURAL_ANALYSIS',
      'PARLAY_WHY_THIS_COULD_FAIL',
      'XRAY_CORRECTION',
      'XRAY_CONFIRM',
    ] as const) {
      expect(CAPABILITY_REGISTRY[capability].neverPaywall).toBe(true);
      expect(evaluateCapability(FREE, capability).access).toBe('allow');
    }
  });

  it('gates only approved available Pro capabilities', () => {
    expect(evaluateCapability(FREE, 'LINE_SHOPPING_DETAIL')).toMatchObject({
      access: 'deny',
      reason: 'PLAN_REQUIRED',
      showUpgrade: true,
    });
    expect(evaluateCapability(PRO, 'LINE_SHOPPING_DETAIL').access).toBe('allow');
    expect(evaluateCapability(FREE, 'MARKET_MOVEMENT_DEEP').showUpgrade).toBe(true);
    expect(evaluateCapability(PRO, 'MARKET_MOVEMENT_DEEP').access).toBe('allow');
    expect(evaluateCapability(FREE, 'AI_BRIEFING').reason).toBe('PLAN_REQUIRED');
    expect(evaluateCapability(PRO, 'AI_BRIEFING').access).toBe('allow');
  });

  it('denies not-ready capabilities for Free and Pro without upgrade CTAs', () => {
    for (const capability of [
      'CURRENT_LIVE_ANALYSIS',
      'MEASURED_CORRELATION',
      'PARLAY_PERSISTENCE',
      'SAVED_PARLAYS',
      'ALERTS',
      'ADVANCED_HISTORY',
      'PARLAY_ADVANCED_CONTEXT',
      'WOWY_ADVANCED',
    ] as const) {
      const free = evaluateCapability(FREE, capability);
      const pro = evaluateCapability(PRO, capability);
      expect(free.access).toBe('deny');
      expect(pro.access).toBe('deny');
      expect(free.showUpgrade).toBe(false);
      expect(pro.showUpgrade).toBe(false);
      expect(free.reason).toBe('FEATURE_NOT_READY');
      expect(pro.reason).toBe('FEATURE_NOT_READY');
    }
  });

  it('does not let plan override provider-blocked or internal research', () => {
    const availability = evaluateCapability(PRO, 'AVAILABILITY_CONTEXT');
    expect(availability.access).toBe('deny');
    expect(availability.reason).toBe('PROVIDER_BLOCKED');
    expect(availability.showUpgrade).toBe(false);

    const shadow = evaluateCapability(PRO, 'PTS_C_REB_C');
    expect(shadow.access).toBe('deny');
    expect(shadow.reason).toBe('INTERNAL_ONLY');
    expect(shadow.showUpgrade).toBe(false);
    expect(evaluateCapability(FREE, 'PTS_C_REB_C').reason).toBe('INTERNAL_ONLY');
  });

  it('keeps public XRay extraction disabled even for Pro', () => {
    expect(SCREENSHOT_EXTRACTION_AVAILABLE).toBe(false);
    expect(loadXrayExtractionConfig({}).enabled).toBe(false);
    expect(evaluateCapability(PRO, 'XRAY_EXTRACTION').reason).toBe('KILL_SWITCH');
    expect(evaluateCapability(FREE, 'XRAY_EXTRACTION').reason).toBe('KILL_SWITCH');
    expect(evaluateCapability(PRO, 'XRAY_EXTRACTION').showUpgrade).toBe(false);
    expect(
      evaluateCapability(PRO, 'XRAY_EXTRACTION', { xrayExtractionEnabled: true }).access
    ).toBe('allow');
    expect(
      evaluateCapability(FREE, 'XRAY_EXTRACTION', { xrayExtractionEnabled: true }).access
    ).toBe('allow');
  });

  it('distinguishes sign-in from upgrade', () => {
    const browse = evaluateCapability(ANON, 'PROPS_BROWSE');
    expect(browse.reason).toBe('AUTH_REQUIRED');
    expect(browse.showUpgrade).toBe(false);
    const wowy = evaluateCapability(ANON, 'WOWY_BASIC');
    expect(wowy.access).toBe('allow');
    const extract = evaluateCapability(ANON, 'XRAY_EXTRACTION', { xrayExtractionEnabled: true });
    expect(extract.reason).toBe('AUTH_REQUIRED');
    expect(extract.showUpgrade).toBe(false);
  });
});

describe('client / server feature parity', () => {
  it('matches sanitize output to evaluateFeature for shopping and movement', () => {
    const freeEnt = freeEntitlement();
    const proEnt = foundingProEntitlement({ status: 'active', currentPeriodEnd: null, source: 'row' });
    expect(evaluateFeature(FREE, 'line_shopping_detail').access).toBe('deny');
    expect(hasFeature(freeEnt, 'line_shopping_detail')).toBe(false);
    expect(sanitizePropMarketResearch(MARKET, freeEnt).shopping.books).toEqual([]);
    expect(sanitizePropMarketResearch(MARKET, freeEnt).shopping.bestAvailableOverLine).toBeNull();

    expect(evaluateFeature(PRO, 'line_shopping_detail').access).toBe('allow');
    expect(hasFeature(proEnt, 'line_shopping_detail')).toBe(true);
    expect(sanitizePropMarketResearch(MARKET, proEnt).shopping.books).toHaveLength(1);

    expect(featureFlagsForPlan(false).wowy).toBe(true);
    expect(featureFlagsForPlan(true).alerts).toBe(false);
    expect(freeEnt.features.wowy).toBe(true);
    expect(proEnt.features.alerts).toBe(false);
  });

  it('returns upgrade 403 for Pro-gated available features and not-available for not-ready', () => {
    const upgrade = evaluateFeature(FREE, 'ai_briefing');
    const upgradeRes = entitlementRequiredResponse('ai_briefing', undefined, upgrade);
    expect(upgradeRes.status).toBe(403);

    const notReady = evaluateFeature(PRO, 'alerts');
    const notReadyRes = entitlementRequiredResponse('alerts', undefined, notReady);
    expect(notReadyRes.status).toBe(403);
    expect(notReady.showUpgrade).toBe(false);
    expect(upgrade.showUpgrade).toBe(true);
    expect(ENTITLEMENT_REQUIRED).toBe('ENTITLEMENT_REQUIRED');
    expect(FEATURE_NOT_AVAILABLE).toBe('FEATURE_NOT_AVAILABLE');
  });
});

describe('billing / checkout freeze', () => {
  it('does not enable production checkout and shows Founding Pro at $9.99/month', () => {
    expect(FOUNDING_PRO_PRICE_CONCEPT).toBe('$9.99/month');
    const production = getBillingAvailability({
      VERCEL_ENV: 'production',
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_FOUNDING_PRO_PRICE_ID: 'price_x',
      APP_BASE_URL: 'https://example.com',
    });
    expect(production.checkoutEnabled).toBe(false);
  });
});
