import { describe, expect, it } from 'vitest';
import {
  foundingProEntitlement,
  freeEntitlement,
  parseDevGrantUserIds,
  resolveEntitlementFromRow,
} from '../resolve';

const USER_A = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-09-06T16:00:00.000Z');

describe('resolveEntitlementFromRow', () => {
  it('defaults missing row to Free', () => {
    const ent = resolveEntitlementFromRow(null, NOW);
    expect(ent.plan).toBe('free');
    expect(ent.isPro).toBe(false);
    expect(ent.features.line_shopping_detail).toBe(false);
    expect(ent.features.ai_briefing).toBe(false);
  });

  it('grants Founding Pro when active', () => {
    const ent = resolveEntitlementFromRow(
      {
        user_id: USER_A,
        plan: 'founding_pro',
        status: 'active',
        current_period_end: '2026-10-06T16:00:00.000Z',
        provider: 'manual',
      },
      NOW
    );
    expect(ent.plan).toBe('founding_pro');
    expect(ent.isPro).toBe(true);
    expect(ent.features.line_shopping_detail).toBe(true);
  });

  it('treats malformed/unknown state as Free', () => {
    expect(
      resolveEntitlementFromRow(
        { user_id: USER_A, plan: 'enterprise', status: 'active', current_period_end: null, provider: null },
        NOW
      ).isPro
    ).toBe(false);
    expect(
      resolveEntitlementFromRow(
        { user_id: USER_A, plan: 'founding_pro', status: 'weird', current_period_end: null, provider: null },
        NOW
      ).isPro
    ).toBe(false);
  });

  it('treats expired period as Free', () => {
    const ent = resolveEntitlementFromRow(
      {
        user_id: USER_A,
        plan: 'founding_pro',
        status: 'active',
        current_period_end: '2026-09-01T00:00:00.000Z',
        provider: null,
      },
      NOW
    );
    expect(ent.isPro).toBe(false);
    expect(ent.plan).toBe('free');
  });

  it('keeps canceled Founding Pro until current_period_end', () => {
    const inside = resolveEntitlementFromRow(
      {
        user_id: USER_A,
        plan: 'founding_pro',
        status: 'canceled',
        current_period_end: '2026-09-20T00:00:00.000Z',
        provider: null,
      },
      NOW
    );
    expect(inside.isPro).toBe(true);
    const after = resolveEntitlementFromRow(
      {
        user_id: USER_A,
        plan: 'founding_pro',
        status: 'canceled',
        current_period_end: '2026-09-01T00:00:00.000Z',
        provider: null,
      },
      NOW
    );
    expect(after.isPro).toBe(false);
  });

  it('fails closed on past_due and unpaid', () => {
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: 'founding_pro',
          status: 'past_due',
          current_period_end: '2026-10-01T00:00:00.000Z',
          provider: null,
        },
        NOW
      ).isPro
    ).toBe(false);
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: 'founding_pro',
          status: 'unpaid',
          current_period_end: null,
          provider: null,
        },
        NOW
      ).isPro
    ).toBe(false);
  });

  it('treats trialing Founding Pro as Pro while the period is open', () => {
    const ent = resolveEntitlementFromRow(
      {
        user_id: USER_A,
        plan: 'founding_pro',
        status: 'trialing',
        current_period_end: '2026-09-10T00:00:00.000Z',
        provider: null,
      },
      NOW
    );
    expect(ent.isPro).toBe(true);
  });
});

describe('dev grant override', () => {
  it('is ignored in production', () => {
    expect(parseDevGrantUserIds(USER_A, 'production').size).toBe(0);
    expect(parseDevGrantUserIds(USER_A, 'development').has(USER_A)).toBe(true);
  });
});

describe('helpers', () => {
  it('freeEntitlement never grants Pro features', () => {
    expect(freeEntitlement().isPro).toBe(false);
    expect(foundingProEntitlement({ status: 'active', currentPeriodEnd: null, source: 'row' }).isPro).toBe(
      true
    );
  });
});
