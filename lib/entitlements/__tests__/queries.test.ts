import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { queryOne } from '@/lib/db';
import { getUserEntitlements, requireEntitlement, USER_ENTITLEMENTS_SELECT_SQL } from '../queries';

const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;
const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-09-06T16:00:00.000Z');

describe('getUserEntitlements isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENTITLEMENT_DEV_GRANT_USER_IDS;
    process.env.NODE_ENV = 'test';
  });

  it('user with no subscription is Free', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const ent = await getUserEntitlements(USER_A, NOW);
    expect(ent.plan).toBe('free');
    expect(mockQueryOne.mock.calls[0]?.[1]).toEqual([USER_A]);
    expect(USER_ENTITLEMENTS_SELECT_SQL).toMatch(/user_id = \$1::uuid/);
  });

  it('user A row does not bind user B', async () => {
    mockQueryOne.mockResolvedValueOnce({
      user_id: USER_A,
      plan: 'founding_pro',
      status: 'active',
      current_period_end: '2026-10-06T16:00:00.000Z',
      provider: 'manual',
    });
    const a = await getUserEntitlements(USER_A, NOW);
    expect(a.isPro).toBe(true);
    expect(mockQueryOne.mock.calls[0]?.[1]).not.toContain(USER_B);

    mockQueryOne.mockResolvedValueOnce(null);
    const b = await getUserEntitlements(USER_B, NOW);
    expect(b.isPro).toBe(false);
    expect(mockQueryOne.mock.calls[1]?.[1]).toEqual([USER_B]);
  });

  it('lookup errors fail closed to Free', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('relation does not exist'));
    const ent = await getUserEntitlements(USER_A, NOW);
    expect(ent.isPro).toBe(false);
    expect(ent.plan).toBe('free');
  });

  it('does not honor a client-looking plan override env in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENTITLEMENT_DEV_GRANT_USER_IDS = USER_A;
    mockQueryOne.mockResolvedValueOnce(null);
    const ent = await getUserEntitlements(USER_A, NOW);
    expect(ent.isPro).toBe(false);
    expect(ent.source).toBe('default');
  });

  it('dev override grants Pro only outside production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENTITLEMENT_DEV_GRANT_USER_IDS = USER_A;
    const ent = await getUserEntitlements(USER_A, NOW);
    expect(ent.isPro).toBe(true);
    expect(ent.source).toBe('dev_override');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});

describe('requireEntitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENTITLEMENT_DEV_GRANT_USER_IDS;
    process.env.NODE_ENV = 'test';
  });

  it('denies Free for line_shopping_detail and allows Pro', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const denied = await requireEntitlement(USER_A, 'line_shopping_detail', NOW);
    expect(denied.ok).toBe(false);

    mockQueryOne.mockResolvedValueOnce({
      user_id: USER_A,
      plan: 'founding_pro',
      status: 'active',
      current_period_end: null,
      provider: 'manual',
    });
    const allowed = await requireEntitlement(USER_A, 'line_shopping_detail', NOW);
    expect(allowed.ok).toBe(true);
  });
});
