/**
 * Server entitlement lookup. Feature code should call this instead of reading
 * subscription rows or trusting a client-supplied plan.
 */

import { queryOne } from '@/lib/db';
import { evaluateFeature, type CapabilityDecision } from './capabilities';
import {
  foundingProEntitlement,
  freeEntitlement,
  parseDevGrantUserIds,
  resolveEntitlementFromRow,
} from './resolve';
import type { EntitlementRow, FeatureKey, ResolvedEntitlement } from './types';

export const USER_ENTITLEMENTS_SELECT_SQL = `
SELECT user_id, plan, status, current_period_end, provider
FROM public.user_entitlements
WHERE user_id = $1::uuid
`;

export async function getUserEntitlements(
  userId: string,
  now: Date = new Date()
): Promise<ResolvedEntitlement> {
  const trimmed = userId.trim();
  if (!trimmed) return freeEntitlement('none', 'default');

  const devIds = parseDevGrantUserIds(
    process.env.ENTITLEMENT_DEV_GRANT_USER_IDS,
    process.env.NODE_ENV
  );
  if (devIds.has(trimmed)) {
    return foundingProEntitlement({
      status: 'active',
      currentPeriodEnd: null,
      source: 'dev_override',
    });
  }

  try {
    const row = await queryOne<EntitlementRow>(USER_ENTITLEMENTS_SELECT_SQL, [trimmed]);
    return resolveEntitlementFromRow(row, now);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    console.error('[entitlements] lookup failed closed to Free:', message);
    return freeEntitlement('none', 'default');
  }
}

export async function requireEntitlement(
  userId: string,
  feature: FeatureKey,
  now?: Date
): Promise<
  | { ok: true; entitlement: ResolvedEntitlement; decision: CapabilityDecision }
  | { ok: false; entitlement: ResolvedEntitlement; decision: CapabilityDecision }
> {
  const entitlement = await getUserEntitlements(userId, now);
  const decision = evaluateFeature({ isPro: entitlement.isPro, authenticated: true }, feature);
  if (decision.access === 'allow') return { ok: true, entitlement, decision };
  return { ok: false, entitlement, decision };
}
