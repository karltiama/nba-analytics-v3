import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const resolveSupabaseAuth = vi.fn();
const createSharedBetSlip = vi.fn();
const getSharedBetSlipByShareId = vi.fn();
const parseCanonicalBetLeg = vi.fn();

vi.mock('@/lib/auth/supabase-user', () => ({
  resolveSupabaseAuth: (...args: unknown[]) => resolveSupabaseAuth(...args),
}));

vi.mock('@/lib/bet-slip/server', () => ({
  createSharedBetSlip: (...args: unknown[]) => createSharedBetSlip(...args),
  getSharedBetSlipByShareId: (...args: unknown[]) => getSharedBetSlipByShareId(...args),
  parseCanonicalBetLeg: (...args: unknown[]) => parseCanonicalBetLeg(...args),
}));

import { POST } from '@/app/api/shared-slips/route';
import { GET } from '@/app/api/shared-slips/[shareId]/route';

const USER = '11111111-1111-1111-1111-111111111111';

const SAMPLE_LEG = {
  selectionKey: 'nba|g1|1628369|points|over|28.5',
  sport: 'nba',
  gameId: 'g1',
  playerId: '1628369',
  market: 'points',
  side: 'over',
  line: 28.5,
  playerName: 'Jayson Tatum',
  selectedSportsbook: 'draftkings',
  selectedOdds: -110,
  selectedAt: '2026-03-17T18:00:00.000Z',
};

function authed() {
  return {
    ok: true as const,
    auth: { userId: USER, email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

describe('shared-slips API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseCanonicalBetLeg.mockImplementation((raw) => raw);
  });

  it('rejects unauthenticated create', async () => {
    resolveSupabaseAuth.mockResolvedValue({ ok: false });
    const res = await POST(
      new NextRequest('http://localhost/api/shared-slips', {
        method: 'POST',
        body: JSON.stringify({ source: 'props_explorer', legs: [SAMPLE_LEG] }),
      })
    );
    expect(res.status).toBe(401);
    expect(createSharedBetSlip).not.toHaveBeenCalled();
  });

  it('rejects empty slip body', async () => {
    resolveSupabaseAuth.mockResolvedValue(authed());
    const res = await POST(
      new NextRequest('http://localhost/api/shared-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'props_explorer', legs: [] }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('rejects malformed legs', async () => {
    resolveSupabaseAuth.mockResolvedValue(authed());
    parseCanonicalBetLeg.mockReturnValue(null);
    const res = await POST(
      new NextRequest('http://localhost/api/shared-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'props_explorer', legs: [{ bad: true }] }),
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid leg/i);
  });

  it('creates and returns public-safe share only', async () => {
    resolveSupabaseAuth.mockResolvedValue(authed());
    createSharedBetSlip.mockResolvedValue({
      ok: true,
      share: {
        shareId: 'tok123',
        title: null,
        source: 'props_explorer',
        snapshotVersion: 1,
        legs: [SAMPLE_LEG],
        createdAt: '2026-03-17T19:00:00.000Z',
        path: '/slip/tok123',
      },
    });
    const res = await POST(
      new NextRequest('http://localhost/api/shared-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'props_explorer', legs: [SAMPLE_LEG] }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.share.shareId).toBe('tok123');
    expect(JSON.stringify(json)).not.toContain('created_by');
    expect(JSON.stringify(json)).not.toContain(USER);
    expect(JSON.stringify(json)).not.toMatch(/"id":/);
  });

  it('public GET returns share without private fields', async () => {
    getSharedBetSlipByShareId.mockResolvedValue({
      ok: true,
      share: {
        shareId: 'tok123',
        title: null,
        source: 'manual',
        snapshotVersion: 1,
        legs: [SAMPLE_LEG],
        createdAt: '2026-03-17T19:00:00.000Z',
        path: '/slip/tok123',
      },
    });
    const res = await GET(new NextRequest('http://localhost/api/shared-slips/tok123'), {
      params: Promise.resolve({ shareId: 'tok123' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.share.legs[0].line).toBe(28.5);
    expect(JSON.stringify(json)).not.toContain('created_by');
    expect(JSON.stringify(json)).not.toContain('auth.users');
  });

  it('public GET handles not found cleanly', async () => {
    getSharedBetSlipByShareId.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    const res = await GET(new NextRequest('http://localhost/api/shared-slips/missing'), {
      params: Promise.resolve({ shareId: 'missing' }),
    });
    expect(res.status).toBe(404);
  });
});
