import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { canonicalSelectionKey } from '@/lib/bet-slip/selection-key';

const requireBettingAuth = vi.fn();
const query = vi.fn();
const countFeedPostsForDay = vi.fn();
const insertFeedPost = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/feed/feed-store', () => ({
  countFeedPostsForDay: (...args: unknown[]) => countFeedPostsForDay(...args),
  insertFeedPost: (...args: unknown[]) => insertFeedPost(...args),
  listFeedPostsForDay: vi.fn(),
  getFeedRecordForUser: vi.fn(),
}));

vi.mock('@/lib/betting/props-market-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/betting/props-market-context')>(
    '@/lib/betting/props-market-context'
  );
  return { ...actual, etCalendarDate: () => '2026-11-06' };
});

import { POST } from '@/app/api/betting/feed/route';

const USER = '11111111-1111-1111-1111-111111111111';

function authed() {
  return {
    ok: true as const,
    auth: { userId: USER, email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

function leg(gameId = '100') {
  const base = { sport: 'nba' as const, gameId, playerId: '7', market: 'points' as const, side: 'over' as const, line: 20.5 };
  return {
    ...base,
    selectionKey: canonicalSelectionKey(base),
    playerName: 'Test Player',
    selectedOdds: -110,
    selectedAt: '2026-11-06T15:00:00.000Z',
  };
}

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/betting/feed', { method: 'POST', body: JSON.stringify(body) })
  );
}

const FUTURE = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 5 * 60 * 1000).toISOString();

describe('POST /api/betting/feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireBettingAuth.mockResolvedValue(authed());
    countFeedPostsForDay.mockResolvedValue(0);
  });

  it('401 without a session', async () => {
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await post({ legs: [leg()] });
    expect(res.status).toBe(401);
    expect(insertFeedPost).not.toHaveBeenCalled();
  });

  it('creates a post before tip-off on the session user and today ET', async () => {
    query.mockResolvedValue([{ game_id: '100', start_time: FUTURE, status: 'Scheduled' }]);
    insertFeedPost.mockResolvedValue({ ok: true, id: 'p1', dailySlot: 1, postedAt: '2026-11-06T16:00:00.000Z' });
    const res = await post({ legs: [leg()], note: ' fade the pace ', userId: 'someone-else' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ post: { id: 'p1' }, postsLeftToday: 2 });
    expect(insertFeedPost).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, postDateEt: '2026-11-06', note: 'fade the pace' })
    );
  });

  it('409 once any leg has tipped off', async () => {
    query.mockResolvedValue([
      { game_id: '100', start_time: FUTURE, status: 'Scheduled' },
      { game_id: '200', start_time: PAST, status: 'Scheduled' },
    ]);
    const res = await post({ legs: [leg('100'), leg('200')] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('GAME_STARTED');
    expect(insertFeedPost).not.toHaveBeenCalled();
  });

  it('429 on the 4th post of the ET day', async () => {
    countFeedPostsForDay.mockResolvedValue(3);
    const res = await post({ legs: [leg()] });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('DAILY_CAP');
    expect(countFeedPostsForDay).toHaveBeenCalledWith(USER, '2026-11-06');
    expect(insertFeedPost).not.toHaveBeenCalled();
  });

  it('429 when a concurrent post takes the last slot', async () => {
    countFeedPostsForDay.mockResolvedValue(2);
    query.mockResolvedValue([{ game_id: '100', start_time: FUTURE, status: 'Scheduled' }]);
    insertFeedPost.mockResolvedValue({ ok: false, code: 'DAILY_CAP' });
    const res = await post({ legs: [leg()] });
    expect(res.status).toBe(429);
  });

  it('400 for a leg without odds', async () => {
    const res = await post({ legs: [{ ...leg(), selectedOdds: null }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('MISSING_ODDS');
  });
});
