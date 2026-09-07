/**
 * Server entitlement lookup. Feature code should call this instead of reading
 * subscription rows or trusting a client-supplied plan.
 */

import { queryOne } from '@/lib/db';
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
): Promise<{ ok: true; entitlement: ResolvedEntitlement } | { ok: false; entitlement: ResolvedEntitlement }> {
  const entitlement = await getUserEntitlements(userId, now);
  if (entitlement.features[feature]) return { ok: true, entitlement };
  return { ok: false, entitlement };
}
