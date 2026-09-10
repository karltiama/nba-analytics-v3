import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const requireBettingAuth = vi.fn();
const getHistoricalGameTimeline = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

vi.mock('@/lib/betting/historical-timeline-server', () => ({
  getHistoricalGameTimeline: (...args: unknown[]) => getHistoricalGameTimeline(...args),
}));

import { GET, HISTORICAL_TIMELINE_CACHE_KEY } from '@/app/api/betting/games/[gameId]/timeline/route';

function authed() {
  return {
    ok: true as const,
    auth: { userId: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

describe('GET /api/betting/games/[gameId]/timeline', () => {
  beforeEach(() => {
    requireBettingAuth.mockReset();
    getHistoricalGameTimeline.mockReset();
    requireBettingAuth.mockResolvedValue(authed());
  });

  it('requires betting auth', async () => {
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await GET(new NextRequest('http://localhost/api/betting/games/18447937/timeline'), {
      params: Promise.resolve({ gameId: '18447937' }),
    });
    expect(res.status).toBe(401);
    expect(getHistoricalGameTimeline).not.toHaveBeenCalled();
  });

  it('returns normalized events and keyEvents without provider JSON', async () => {
    getHistoricalGameTimeline.mockResolvedValue({
      available: true,
      quality: {
        timelineAvailable: true,
        scoreReconciled: true,
        streamComplete: true,
        streamClass: 'complete',
        rotationContextAvailable: true,
        rotationFailureClass: null,
        qualityCode: 'TIMELINE_OK',
      },
      gameFlow: { timelineAvailable: true, scoreReconciled: true, leadChanges: 2 },
      officialHomeScore: 99,
      officialAwayScore: 118,
      events: [
        {
          gameId: '18447937',
          order: 1,
          period: 1,
          periodLabel: 'Q1',
          clock: '12:00',
          clockSecondsRemaining: 720,
          category: 'period',
          rawType: 'End Period',
          description: 'End of Q1',
          teamId: null,
          primaryPlayerId: null,
          secondaryPlayerId: null,
          primaryPlayerName: null,
          secondaryPlayerName: null,
          scoreHome: 0,
          scoreAway: 0,
          scoreValue: null,
          scoringPlay: false,
          substitutionPlayerIds: [],
          leadChange: false,
          becameTied: false,
        },
        {
          gameId: '18447937',
          order: 2,
          period: 1,
          periodLabel: 'Q1',
          clock: '11:40',
          clockSecondsRemaining: 700,
          category: 'shot_missed',
          rawType: 'Jump Shot',
          description: 'Missed jumper',
          teamId: '13',
          primaryPlayerId: '274',
          secondaryPlayerId: null,
          primaryPlayerName: 'Kawhi Leonard',
          secondaryPlayerName: null,
          scoreHome: 0,
          scoreAway: 0,
          scoreValue: null,
          scoringPlay: false,
          substitutionPlayerIds: [],
          leadChange: false,
          becameTied: false,
        },
      ],
    });

    const res = await GET(new NextRequest('http://localhost/api/betting/games/18447937/timeline'), {
      params: Promise.resolve({ gameId: '18447937' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.officialHomeScore).toBe(99);
    expect(body.officialAwayScore).toBe(118);
    expect(body.keyEvents.map((e: { order: number }) => e.order)).toEqual([1]);
    expect(body.events).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(/coordinate_x/);
    expect(JSON.stringify(body)).not.toMatch(/"pages"/);
    expect(getHistoricalGameTimeline).toHaveBeenCalledWith('18447937');
  });

  it('returns an isolated unavailable payload when the read throws', async () => {
    getHistoricalGameTimeline.mockRejectedValue(new Error('s3 down'));
    const res = await GET(new NextRequest('http://localhost/api/betting/games/18447937/timeline'), {
      params: Promise.resolve({ gameId: '18447937' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.events).toEqual([]);
    expect(body.keyEvents).toEqual([]);
    expect(body.error).toBe('TIMELINE_UNAVAILABLE');
  });
});

describe('timeline route cache contract', () => {
  it('keys Next cache by game_id and does not call BDL', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/api/betting/games/[gameId]/timeline/route.ts'),
      'utf8'
    );
    expect(src).toContain(HISTORICAL_TIMELINE_CACHE_KEY);
    expect(src).toContain('unstable_cache');
    expect(src).toContain('revalidate: false');
    expect(src).not.toContain('fetchLineupsFromBallDontLie');
    expect(src).not.toContain('BALLDONTLIE');
    expect(src).not.toContain('putJson');
  });
});
