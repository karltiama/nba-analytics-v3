/**
 * Court Context capability registry.
 * Source of truth: reports/product/parlay-product-acceptance-entitlement-architecture.md (E6).
 *
 * Readiness is independent of plan. A Pro user cannot unlock NOT_READY / INTERNAL /
 * PROVIDER_BLOCKED / kill-switched capabilities.
 */

import type { FeatureKey } from './types';

export const COURT_CONTEXT_CAPABILITIES = [
  'LANDING',
  'DASHBOARD',
  'PROPS_BROWSE',
  'PROPS_COMPARE',
  'MARKET_MOVEMENT_BASIC',
  'MARKET_MOVEMENT_DEEP',
  'LINE_SHOPPING_DETAIL',
  'PARLAY_BUILD',
  'PARLAY_WORKSPACE',
  'PARLAY_STRUCTURAL_ANALYSIS',
  'PARLAY_WHY_THIS_COULD_FAIL',
  'PARLAY_HISTORICAL_CONTEXT',
  'PARLAY_ADVANCED_CONTEXT',
  'CURRENT_LIVE_ANALYSIS',
  'XRAY_UPLOAD_UI',
  'XRAY_EXTRACTION',
  'XRAY_CORRECTION',
  'XRAY_CONFIRM',
  'XRAY_WORKSPACE_HANDOFF',
  'PLAYER_RESEARCH_BASIC',
  'PLAYER_RESEARCH_ADVANCED',
  'GAME_RESEARCH_BASIC',
  'GAME_RESEARCH_ADVANCED',
  'WOWY_BASIC',
  'WOWY_ADVANCED',
  'SAVED_PROPS',
  'SAVED_PARLAYS',
  'PAPER_TRACKING',
  'AI_BRIEFING',
  'ALERTS',
  'ADVANCED_HISTORY',
  'PTS_C_REB_C',
  'AVAILABILITY_CONTEXT',
  'MEASURED_CORRELATION',
  'PARLAY_PERSISTENCE',
] as const;

export type CourtContextCapability = (typeof COURT_CONTEXT_CAPABILITIES)[number];

export type CapabilityReadiness =
  | 'AVAILABLE'
  | 'NOT_READY'
  | 'INTERNAL_RESEARCH'
  | 'PROVIDER_BLOCKED'
  | 'DISABLED';

export type CapabilityPlanAccess = 'FREE' | 'PRO' | 'BOTH';

export type CapabilityAccessReason =
  | 'AVAILABLE'
  | 'PLAN_REQUIRED'
  | 'FEATURE_NOT_READY'
  | 'PROVIDER_BLOCKED'
  | 'INTERNAL_ONLY'
  | 'AUTH_REQUIRED'
  | 'KILL_SWITCH';

export type CapabilitySpec = {
  capability: CourtContextCapability;
  readiness: CapabilityReadiness;
  planAccess: CapabilityPlanAccess;
  neverPaywall?: boolean;
  /** HTML/public surface; auth is a separate check for APIs. */
  public?: boolean;
};

export type PlanSnapshot = {
  isPro: boolean;
  authenticated?: boolean;
};

export type CapabilityDecision = {
  capability: CourtContextCapability;
  readiness: CapabilityReadiness;
  access: 'allow' | 'deny';
  reason: CapabilityAccessReason;
  showUpgrade: boolean;
};

export type CapabilityRuntime = {
  /** Kill switch for screenshot extraction. Default false = public extraction disabled. */
  xrayExtractionEnabled?: boolean;
};

export const CAPABILITY_REGISTRY: Record<CourtContextCapability, CapabilitySpec> = {
  LANDING: { capability: 'LANDING', readiness: 'AVAILABLE', planAccess: 'BOTH', public: true },
  DASHBOARD: { capability: 'DASHBOARD', readiness: 'AVAILABLE', planAccess: 'FREE' },
  PROPS_BROWSE: { capability: 'PROPS_BROWSE', readiness: 'AVAILABLE', planAccess: 'FREE' },
  PROPS_COMPARE: { capability: 'PROPS_COMPARE', readiness: 'AVAILABLE', planAccess: 'BOTH' },
  MARKET_MOVEMENT_BASIC: {
    capability: 'MARKET_MOVEMENT_BASIC',
    readiness: 'AVAILABLE',
    planAccess: 'FREE',
  },
  MARKET_MOVEMENT_DEEP: {
    capability: 'MARKET_MOVEMENT_DEEP',
    readiness: 'AVAILABLE',
    planAccess: 'PRO',
  },
  LINE_SHOPPING_DETAIL: {
    capability: 'LINE_SHOPPING_DETAIL',
    readiness: 'AVAILABLE',
    planAccess: 'PRO',
  },
  PARLAY_BUILD: { capability: 'PARLAY_BUILD', readiness: 'AVAILABLE', planAccess: 'FREE' },
  PARLAY_WORKSPACE: { capability: 'PARLAY_WORKSPACE', readiness: 'AVAILABLE', planAccess: 'FREE' },
  PARLAY_STRUCTURAL_ANALYSIS: {
    capability: 'PARLAY_STRUCTURAL_ANALYSIS',
    readiness: 'AVAILABLE',
    planAccess: 'FREE',
    neverPaywall: true,
  },
  PARLAY_WHY_THIS_COULD_FAIL: {
    capability: 'PARLAY_WHY_THIS_COULD_FAIL',
    readiness: 'AVAILABLE',
    planAccess: 'FREE',
    neverPaywall: true,
  },
  PARLAY_HISTORICAL_CONTEXT: {
    capability: 'PARLAY_HISTORICAL_CONTEXT',
    readiness: 'AVAILABLE',
    planAccess: 'FREE',
  },
  PARLAY_ADVANCED_CONTEXT: {
    capability: 'PARLAY_ADVANCED_CONTEXT',
    readiness: 'NOT_READY',
    planAccess: 'PRO',
  },
  CURRENT_LIVE_ANALYSIS: {
    capability: 'CURRENT_LIVE_ANALYSIS',
    readiness: 'NOT_READY',
    planAccess: 'PRO',
  },
  XRAY_UPLOAD_UI: {
    capability: 'XRAY_UPLOAD_UI',
    readiness: 'AVAILABLE',
    planAccess: 'BOTH',
    public: true,
  },
  XRAY_EXTRACTION: {
    capability: 'XRAY_EXTRACTION',
    readiness: 'DISABLED',
    planAccess: 'BOTH',
  },
  XRAY_CORRECTION: {
    capability: 'XRAY_CORRECTION',
    readiness: 'AVAILABLE',
    planAccess: 'FREE',
    neverPaywall: true,
  },
  XRAY_CONFIRM: {
    capability: 'XRAY_CONFIRM',
    readiness: 'AVAILABLE',
    planAccess: 'FREE',
    neverPaywall: true,
  },
  XRAY_WORKSPACE_HANDOFF: {
    capability: 'XRAY_WORKSPACE_HANDOFF',
    readiness: 'AVAILABLE',
    planAccess: 'FREE',
  },
  PLAYER_RESEARCH_BASIC: {
    capability: 'PLAYER_RESEARCH_BASIC',
    readiness: 'AVAILABLE',
    planAccess: 'FREE',
  },
  PLAYER_RESEARCH_ADVANCED: {
    capability: 'PLAYER_RESEARCH_ADVANCED',
    readiness: 'NOT_READY',
    planAccess: 'PRO',
  },
  GAME_RESEARCH_BASIC: {
    capability: 'GAME_RESEARCH_BASIC',
    readiness: 'AVAILABLE',
    planAccess: 'FREE',
  },
  GAME_RESEARCH_ADVANCED: {
    capability: 'GAME_RESEARCH_ADVANCED',
    readiness: 'NOT_READY',
    planAccess: 'PRO',
  },
  WOWY_BASIC: { capability: 'WOWY_BASIC', readiness: 'AVAILABLE', planAccess: 'FREE', public: true },
  WOWY_ADVANCED: { capability: 'WOWY_ADVANCED', readiness: 'NOT_READY', planAccess: 'PRO' },
  SAVED_PROPS: { capability: 'SAVED_PROPS', readiness: 'AVAILABLE', planAccess: 'FREE' },
  SAVED_PARLAYS: { capability: 'SAVED_PARLAYS', readiness: 'NOT_READY', planAccess: 'PRO' },
  PAPER_TRACKING: { capability: 'PAPER_TRACKING', readiness: 'AVAILABLE', planAccess: 'FREE' },
  AI_BRIEFING: { capability: 'AI_BRIEFING', readiness: 'AVAILABLE', planAccess: 'PRO' },
  ALERTS: { capability: 'ALERTS', readiness: 'NOT_READY', planAccess: 'PRO' },
  ADVANCED_HISTORY: { capability: 'ADVANCED_HISTORY', readiness: 'NOT_READY', planAccess: 'PRO' },
  PTS_C_REB_C: { capability: 'PTS_C_REB_C', readiness: 'INTERNAL_RESEARCH', planAccess: 'PRO' },
  AVAILABILITY_CONTEXT: {
    capability: 'AVAILABILITY_CONTEXT',
    readiness: 'PROVIDER_BLOCKED',
    planAccess: 'PRO',
  },
  MEASURED_CORRELATION: {
    capability: 'MEASURED_CORRELATION',
    readiness: 'NOT_READY',
    planAccess: 'PRO',
  },
  PARLAY_PERSISTENCE: {
    capability: 'PARLAY_PERSISTENCE',
    readiness: 'NOT_READY',
    planAccess: 'PRO',
  },
};

export const FEATURE_KEY_TO_CAPABILITY = {
  line_shopping_detail: 'LINE_SHOPPING_DETAIL',
  market_movement: 'MARKET_MOVEMENT_DEEP',
  ai_briefing: 'AI_BRIEFING',
  advanced_history: 'ADVANCED_HISTORY',
  wowy: 'WOWY_BASIC',
  alerts: 'ALERTS',
} as const satisfies Record<FeatureKey, CourtContextCapability>;

function deny(
  spec: CapabilitySpec,
  reason: CapabilityAccessReason,
  readiness: CapabilityReadiness = spec.readiness
): CapabilityDecision {
  return {
    capability: spec.capability,
    readiness,
    access: 'deny',
    reason,
    showUpgrade: false,
  };
}

function allow(spec: CapabilitySpec, readiness: CapabilityReadiness = spec.readiness): CapabilityDecision {
  return {
    capability: spec.capability,
    readiness,
    access: 'allow',
    reason: 'AVAILABLE',
    showUpgrade: false,
  };
}

/**
 * Decision order:
 * 1. feature available / kill switch
 * 2. authenticated if required
 * 3. readiness (internal / provider / not ready)
 * 4. plan access
 *
 * Safety quotas are not applied here.
 */
export function evaluateCapability(
  plan: PlanSnapshot,
  capability: CourtContextCapability,
  runtime: CapabilityRuntime = {}
): CapabilityDecision {
  const spec = CAPABILITY_REGISTRY[capability];

  if (capability === 'XRAY_EXTRACTION') {
    if (!runtime.xrayExtractionEnabled) {
      return deny(spec, 'KILL_SWITCH', 'DISABLED');
    }
    if (plan.authenticated === false) {
      return deny(spec, 'AUTH_REQUIRED', 'AVAILABLE');
    }
    return allow(spec, 'AVAILABLE');
  }

  if (plan.authenticated === false && !spec.public) {
    return deny(spec, 'AUTH_REQUIRED');
  }

  if (spec.readiness === 'INTERNAL_RESEARCH') {
    return deny(spec, 'INTERNAL_ONLY');
  }
  if (spec.readiness === 'PROVIDER_BLOCKED') {
    return deny(spec, 'PROVIDER_BLOCKED');
  }
  if (spec.readiness === 'NOT_READY' || spec.readiness === 'DISABLED') {
    return deny(spec, 'FEATURE_NOT_READY');
  }

  if (spec.neverPaywall || spec.planAccess === 'FREE' || spec.planAccess === 'BOTH') {
    return allow(spec);
  }

  if (plan.isPro) return allow(spec);

  return {
    capability: spec.capability,
    readiness: spec.readiness,
    access: 'deny',
    reason: 'PLAN_REQUIRED',
    showUpgrade: true,
  };
}

export function evaluateFeature(
  plan: PlanSnapshot,
  feature: FeatureKey,
  runtime?: CapabilityRuntime
): CapabilityDecision {
  return evaluateCapability(plan, FEATURE_KEY_TO_CAPABILITY[feature], runtime);
}

export function featureFlagsForPlan(isPro: boolean): Record<FeatureKey, boolean> {
  const plan = { isPro, authenticated: true };
  return {
    line_shopping_detail: evaluateFeature(plan, 'line_shopping_detail').access === 'allow',
    market_movement: evaluateFeature(plan, 'market_movement').access === 'allow',
    ai_briefing: evaluateFeature(plan, 'ai_briefing').access === 'allow',
    advanced_history: evaluateFeature(plan, 'advanced_history').access === 'allow',
    wowy: evaluateFeature(plan, 'wowy').access === 'allow',
    alerts: evaluateFeature(plan, 'alerts').access === 'allow',
  };
}
