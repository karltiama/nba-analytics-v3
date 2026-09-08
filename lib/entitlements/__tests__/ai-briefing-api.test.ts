import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { freeEntitlement, foundingProEntitlement } from '../resolve';

const requireBettingAuth = vi.fn();
const requireEntitlement = vi.fn();
const isIngestionFrozen = vi.fn();
const buildAiSlateUserContent = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/entitlements/queries', () => ({
  requireEntitlement: (...args: unknown[]) => requireEntitlement(...args),
}));

vi.mock('@/lib/betting/ai-briefing-eligibility', () => ({
  isIngestionFrozen: (...args: unknown[]) => isIngestionFrozen(...args),
  isAiSlateBriefingEligible: () => true,
  aiBriefingUnavailableCopy: (frozen: boolean) =>
    frozen
      ? 'Slate briefing unavailable during offseason freeze. Live analysis is paused until current-game inputs resume.'
      : 'No current slate to summarize for this date.',
}));

vi.mock('@/lib/betting/ai-slate-context', () => ({
  buildAiSlateUserContent: (...args: unknown[]) => buildAiSlateUserContent(...args),
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

import { GET as slateGet } from '@/app/api/betting/ai-slate-insights/route';
import { POST as matchupPost } from '@/app/api/betting/games/[gameId]/ai-projection-summary/route';

const USER_A = '11111111-1111-1111-1111-111111111111';

function authed() {
  return {
    ok: true as const,
    auth: { userId: USER_A, email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

describe('AI briefing entitlement gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    requireBettingAuth.mockResolvedValue(authed());
    isIngestionFrozen.mockReturnValue(false);
    buildAiSlateUserContent.mockResolvedValue({
      userContent: 'slate',
      payloadHash: 'hash',
      gameCount: 2,
    });
  });

  it('gates Free slate AI before any provider call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    requireEntitlement.mockResolvedValue({ ok: false, entitlement: freeEntitlement() });
    const res = await slateGet(new NextRequest('http://localhost/api/betting/ai-slate-insights?date=2026-09-07'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('ENTITLEMENT_REQUIRED');
    expect(body.feature).toBe('ai_briefing');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(buildAiSlateUserContent).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('lets Pro pass entitlement and returns offseason instead of 403', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    requireEntitlement.mockResolvedValue({
      ok: true,
      entitlement: foundingProEntitlement({ status: 'active', currentPeriodEnd: null, source: 'row' }),
    });
    isIngestionFrozen.mockReturnValue(true);
    const res = await slateGet(new NextRequest('http://localhost/api/betting/ai-slate-insights?date=2026-09-07'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe('OFFSEASON');
    expect(body.eligible).toBe(false);
    expect(body.summary).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('gates Free matchup AI before any provider call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    requireEntitlement.mockResolvedValue({ ok: false, entitlement: freeEntitlement() });
    const res = await matchupPost(
      new NextRequest('http://localhost/api/betting/games/1/ai-projection-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeTeamName: 'A', awayTeamName: 'B', bullets: ['x'] }),
      }),
      { params: Promise.resolve({ gameId: '1' }) }
    );
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('lets Pro matchup AI pass entitlement then report freeze', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    requireEntitlement.mockResolvedValue({
      ok: true,
      entitlement: foundingProEntitlement({ status: 'active', currentPeriodEnd: null, source: 'row' }),
    });
    isIngestionFrozen.mockReturnValue(true);
    const res = await matchupPost(
      new NextRequest('http://localhost/api/betting/games/1/ai-projection-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeTeamName: 'A', awayTeamName: 'B', bullets: ['x'] }),
      }),
      { params: Promise.resolve({ gameId: '1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe('OFFSEASON');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
