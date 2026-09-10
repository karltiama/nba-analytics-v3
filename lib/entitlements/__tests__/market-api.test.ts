import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireBettingAuth = vi.fn();
const getPropMarketResearch = vi.fn();
const getUserEntitlements = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/betting/prop-market-serving', () => ({
  getPropMarketResearch: (...args: unknown[]) => getPropMarketResearch(...args),
}));

vi.mock('@/lib/entitlements/queries', () => ({
  getUserEntitlements: (...args: unknown[]) => getUserEntitlements(...args),
}));

vi.mock('@/lib/betting/ai-briefing-eligibility', () => ({
  isIngestionFrozen: () => true,
}));

import { GET } from '@/app/api/betting/props-explorer/market/route';
import { freeEntitlement, foundingProEntitlement } from '../resolve';
import type { PropMarketResearch } from '@/lib/betting/prop-market-serving';
import { mapServingRowsToPlayerMarketMovement } from '@/lib/betting/market-movement-api';

const USER_A = '11111111-1111-1111-1111-111111111111';

const RESEARCH: PropMarketResearch = {
  marketContext: 'historical',
  lineLabel: 'Historical closing line',
  comparisonLabel: 'Historical sportsbook comparison',
  paperBetAllowed: false,
  selected: {
    gameId: '1',
    playerId: '9',
    propType: 'points',
    sportsbook: 'draftkings',
    side: 'over',
    lineValue: 10.5,
    oddsAmerican: -114,
    snapshotAt: null,
  },
  shopping: {
    status: 'ok',
    reason: null,
    message: null,
    sourceTable: 'research.prop_decision_lines',
    bookCount: 2,
    marketMinLine: 10.5,
    marketMaxLine: 11.5,
    latestSnapshotAt: null,
    bestAvailableOverLine: {
      sportsbook: 'betmgm',
      side: 'over',
      lineValue: 10.5,
      oddsAmerican: -110,
      snapshotAt: '2026-05-01T18:00:00.000Z',
    },
    bestAvailableUnderLine: null,
    bestPriceAtSelectedLine: {
      sportsbook: 'fanduel',
      side: 'over',
      lineValue: 10.5,
      oddsAmerican: -104,
      snapshotAt: '2026-05-01T18:00:00.000Z',
    },
    books: [
      {
        sportsbook: 'betmgm',
        side: 'over',
        lineValue: 10.5,
        oddsAmerican: -110,
        snapshotAt: '2026-05-01T18:00:00.000Z',
      },
    ],
  },
  marketMovement: mapServingRowsToPlayerMarketMovement({
    gameId: '1',
    playerId: '9',
    propType: 'points',
    rows: [],
  }),
};

function authed(userId = USER_A) {
  return {
    ok: true as const,
    auth: { userId, email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

describe('props-explorer market entitlement contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireBettingAuth.mockResolvedValue(authed());
    getPropMarketResearch.mockResolvedValue(RESEARCH);
  });

  it('Free responses omit premium books/bests even if computed internally', async () => {
    getUserEntitlements.mockResolvedValue(freeEntitlement());
    const res = await GET(
      new NextRequest(
        'http://localhost/api/betting/props-explorer/market?game_id=1&player_id=9&prop_type=points&side=over&line_value=10.5&sportsbook=draftkings&plan=founding_pro'
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(getUserEntitlements.mock.calls[0]?.[0]).toBe(USER_A);
    expect(body.shopping.bestPriceAtSelectedLine).toBeNull();
    expect(body.shopping.bestAvailableOverLine).toBeNull();
    expect(body.shopping.books).toEqual([]);
    expect(body.shopping.bookCount).toBe(2);
    expect(body.shopping.marketMinLine).toBe(10.5);
    expect(body.shopping.marketMaxLine).toBe(11.5);
    expect(body.entitlement.isPro).toBe(false);
    expect(body.marketMovement.detail).toBe('summary');
    expect(body.marketMovement.books).toEqual([]);
    expect(body.marketMovement.status).toBe('empty');
    expect(body.movement).toBeUndefined();
  });

  it('Founding Pro responses include premium fields', async () => {
    getUserEntitlements.mockResolvedValue(
      foundingProEntitlement({ status: 'active', currentPeriodEnd: null, source: 'row' })
    );
    const res = await GET(
      new NextRequest(
        'http://localhost/api/betting/props-explorer/market?game_id=1&player_id=9&prop_type=points&side=over&line_value=10.5&sportsbook=draftkings'
      )
    );
    const body = await res.json();
    expect(body.shopping.bestPriceAtSelectedLine.sportsbook).toBe('fanduel');
    expect(body.shopping.books).toHaveLength(1);
    expect(body.entitlement.isPro).toBe(true);
    expect(body.marketMovement.sourceTable).toBe('analytics.player_prop_market_movement');
    expect(body.marketMovement.detail).toBe('full');
  });

  it('past_due is treated as Free and sanitizes premium fields', async () => {
    getUserEntitlements.mockResolvedValue(freeEntitlement('past_due', 'row', '2026-10-01T00:00:00.000Z'));
    const res = await GET(
      new NextRequest(
        'http://localhost/api/betting/props-explorer/market?game_id=1&player_id=9&prop_type=points&side=over&line_value=10.5&sportsbook=draftkings'
      )
    );
    const body = await res.json();
    expect(body.shopping.bestAvailableOverLine).toBeNull();
    expect(body.shopping.books).toEqual([]);
    expect(body.entitlement.isPro).toBe(false);
  });

  it('unauthenticated market requests are 401', async () => {
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await GET(new NextRequest('http://localhost/api/betting/props-explorer/market'));
    expect(res.status).toBe(401);
    expect(getUserEntitlements).not.toHaveBeenCalled();
  });
});
