import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireBettingAuth = vi.fn();
const queryOne = vi.fn();
const insertPaperBetForUser = vi.fn();
const listPaperBetsForUser = vi.fn();
const deleteOpenPaperBetForUser = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: (...args: unknown[]) => queryOne(...args),
}));

vi.mock('@/lib/betting/paper-bets-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/betting/paper-bets-queries')>(
    '@/lib/betting/paper-bets-queries'
  );
  return {
    ...actual,
    insertPaperBetForUser: (...args: unknown[]) => insertPaperBetForUser(...args),
    listPaperBetsForUser: (...args: unknown[]) => listPaperBetsForUser(...args),
    deleteOpenPaperBetForUser: (...args: unknown[]) => deleteOpenPaperBetForUser(...args),
  };
});

vi.mock('@/lib/betting/props-market-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/betting/props-market-context')>(
    '@/lib/betting/props-market-context'
  );
  return {
    ...actual,
    etCalendarDate: () => '2026-09-06',
  };
});

import { DELETE, GET, POST } from '@/app/api/betting/paper-bets/route';
import { GET as GET_ANALYTICS } from '@/app/api/betting/paper-bets/analytics/route';
import { POST as POST_SETTLE } from '@/app/api/betting/paper-bets/settle/route';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

function denied() {
  return {
    ok: false as const,
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
}

function authed(userId = USER_A) {
  return {
    ok: true as const,
    auth: { userId, email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

describe('paper-bets API auth and ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unauthenticated GET/POST/DELETE return 401 JSON', async () => {
    requireBettingAuth.mockResolvedValue(denied());
    const getRes = await GET(new NextRequest('http://localhost/api/betting/paper-bets'));
    const postRes = await POST(
      new NextRequest('http://localhost/api/betting/paper-bets', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
    const delRes = await DELETE(
      new NextRequest('http://localhost/api/betting/paper-bets?id=x', { method: 'DELETE' })
    );
    expect(getRes.status).toBe(401);
    expect(postRes.status).toBe(401);
    expect(delRes.status).toBe(401);
    const analyticsRes = await GET_ANALYTICS(
      new NextRequest('http://localhost/api/betting/paper-bets/analytics')
    );
    const settleRes = await POST_SETTLE(
      new NextRequest('http://localhost/api/betting/paper-bets/settle', { method: 'POST' })
    );
    expect(analyticsRes.status).toBe(401);
    expect(settleRes.status).toBe(401);
    await expect(getRes.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('create uses session user_id even if the client sends another user id', async () => {
    requireBettingAuth.mockResolvedValue(authed(USER_A));
    queryOne.mockResolvedValueOnce({
      start_time: '2026-09-07T23:30:00.000Z',
      status: 'Scheduled',
    });
    insertPaperBetForUser.mockResolvedValueOnce({ id: 'bet-a', userId: USER_A });

    const res = await POST(
      new NextRequest('http://localhost/api/betting/paper-bets', {
        method: 'POST',
        body: JSON.stringify({
          gameId: '1',
          playerId: '9',
          decisionSnapshotAt: '2026-09-06T20:00:00.000Z',
          userId: USER_B,
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(insertPaperBetForUser).toHaveBeenCalledTimes(1);
    expect(insertPaperBetForUser.mock.calls[0]?.[0]?.userId).toBe(USER_A);
  });

  it('rejects historical completed games with HISTORICAL_GAME', async () => {
    requireBettingAuth.mockResolvedValue(authed(USER_A));
    queryOne.mockResolvedValueOnce({
      start_time: '2026-05-01T23:30:00.000Z',
      status: 'Final',
    });

    const res = await POST(
      new NextRequest('http://localhost/api/betting/paper-bets', {
        method: 'POST',
        body: JSON.stringify({
          gameId: '21681995',
          playerId: '9',
          decisionSnapshotAt: '2026-05-01T23:00:00.000Z',
        }),
      })
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'HISTORICAL_GAME' });
    expect(insertPaperBetForUser).not.toHaveBeenCalled();
  });

  it('GET lists with the session user only', async () => {
    requireBettingAuth.mockResolvedValue(authed(USER_A));
    listPaperBetsForUser.mockResolvedValueOnce({ bets: [], total: 0 });
    const res = await GET(new NextRequest('http://localhost/api/betting/paper-bets?status=open'));
    expect(res.status).toBe(200);
    expect(listPaperBetsForUser.mock.calls[0]?.[0]?.userId).toBe(USER_A);
  });

  it('DELETE requires owner match (IDOR: knowing B\'s id is not enough)', async () => {
    requireBettingAuth.mockResolvedValue(authed(USER_A));
    deleteOpenPaperBetForUser.mockResolvedValueOnce(null);
    const res = await DELETE(
      new NextRequest(`http://localhost/api/betting/paper-bets?id=${USER_B}`, { method: 'DELETE' })
    );
    expect(res.status).toBe(404);
    expect(deleteOpenPaperBetForUser.mock.calls[0]?.[0]).toEqual({
      userId: USER_A,
      id: USER_B,
    });
  });
});
