import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireBettingAuth = vi.fn();
const getCachedPlatformHealth = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/ops/platform-health', () => ({
  getCachedPlatformHealth: (...args: unknown[]) => getCachedPlatformHealth(...args),
}));

import { GET } from '@/app/api/ops/health/route';

describe('GET /api/ops/health', () => {
  beforeEach(() => {
    requireBettingAuth.mockReset();
    getCachedPlatformHealth.mockReset();
  });

  it('returns 401 for unauthenticated requests and does not query health', async () => {
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await GET(new NextRequest('http://localhost/api/ops/health'));
    expect(res.status).toBe(401);
    expect(getCachedPlatformHealth).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});
