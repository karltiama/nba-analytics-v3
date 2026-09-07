import {
  FEATURE_KEYS,
  PLANS,
  SUBSCRIPTION_STATUSES,
  type EntitlementRow,
  type FeatureKey,
  type PlanId,
  type ResolvedEntitlement,
  type SubscriptionStatus,
} from './types';

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function parseInstant(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isPlan(value: string | null | undefined): value is PlanId {
  return value != null && (PLANS as readonly string[]).includes(value);
}

function isStatus(value: string | null | undefined): value is SubscriptionStatus {
  return value != null && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

function featuresFor(isPro: boolean): Record<FeatureKey, boolean> {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, isPro])) as Record<FeatureKey, boolean>;
}

export function freeEntitlement(
  status: SubscriptionStatus = 'none',
  source: ResolvedEntitlement['source'] = 'default',
  currentPeriodEnd: string | null = null
): ResolvedEntitlement {
  return {
    plan: 'free',
    isPro: false,
    status,
    currentPeriodEnd,
    features: featuresFor(false),
    source,
  };
}

export function foundingProEntitlement(input: {
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  source: ResolvedEntitlement['source'];
}): ResolvedEntitlement {
  return {
    plan: 'founding_pro',
    isPro: true,
    status: input.status,
    currentPeriodEnd: input.currentPeriodEnd,
    features: featuresFor(true),
    source: input.source,
  };
}

/**
 * Fail-closed resolver. Unknown plan/status, expired period, past_due, unpaid,
 * and missing rows are Free. Trials are treated as Pro while status is trialing
 * and the period (if present) has not ended.
 */
export function resolveEntitlementFromRow(
  row: EntitlementRow | null | undefined,
  now: Date = new Date()
): ResolvedEntitlement {
  if (!row) return freeEntitlement('none', 'default');

  const planRaw = (row.plan ?? '').trim().toLowerCase();
  const statusRaw = (row.status ?? '').trim().toLowerCase();
  if (!isPlan(planRaw) || !isStatus(statusRaw)) {
    return freeEntitlement('none', 'row');
  }

  const periodEnd = parseInstant(row.current_period_end);
  const periodEndIso = iso(periodEnd);
  const periodOpen = periodEnd == null || periodEnd.getTime() > now.getTime();

  if (planRaw !== 'founding_pro') {
    return freeEntitlement(statusRaw, 'row', periodEndIso);
  }

  if (statusRaw === 'past_due' || statusRaw === 'unpaid' || statusRaw === 'expired' || statusRaw === 'none') {
    return freeEntitlement(statusRaw, 'row', periodEndIso);
  }

  if (statusRaw === 'active' || statusRaw === 'trialing') {
    if (!periodOpen) return freeEntitlement('expired', 'row', periodEndIso);
    return foundingProEntitlement({
      status: statusRaw,
      currentPeriodEnd: periodEndIso,
      source: 'row',
    });
  }

  if (statusRaw === 'canceled') {
    if (periodEnd != null && periodEnd.getTime() > now.getTime()) {
      return foundingProEntitlement({
        status: 'canceled',
        currentPeriodEnd: periodEndIso,
        source: 'row',
      });
    }
    return freeEntitlement('canceled', 'row', periodEndIso);
  }

  return freeEntitlement('none', 'row', periodEndIso);
}

export function hasFeature(entitlement: ResolvedEntitlement, feature: FeatureKey): boolean {
  return entitlement.features[feature] === true;
}

export function parseDevGrantUserIds(
  raw: string | undefined,
  nodeEnv: string | undefined
): Set<string> {
  if ((nodeEnv ?? '').toLowerCase() === 'production') return new Set();
  const ids = (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return new Set(ids);
}
