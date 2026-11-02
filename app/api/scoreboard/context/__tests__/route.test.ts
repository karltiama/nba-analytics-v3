import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { serveCardContext } from '@/lib/scoreboard/card-context/serve';

const { requireBettingAuth, loadGamesForDate, query } = vi.hoisted(() => ({
  requireBettingAuth: vi.fn(),
  loadGamesForDate: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  default: {
    query: (...args: unknown[]) => query(...args),
  },
}));

vi.mock('@/lib/scoreboard/store', () => ({
  createPgScoreboardStore: () => ({
    loadGamesForDate: (...args: unknown[]) => loadGamesForDate(...args),
  }),
}));

import { GET } from '@/app/api/scoreboard/context/route';

function authed() {
  return {
    ok: true as const,
    auth: { userId: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (response: NextResponse) => response,
  };
}

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function game(): StoredScoreboardGame {
  return {
    gameId: '5001',
    season: 2026,
    seasonType: 'regular',
    seasonTypeSource: 'request_season_type',
    etDate: '2026-11-02',
    scheduledTip: null,
    homeTeamId: 'okc',
    homeAbbr: 'OKC',
    homeName: null,
    homeScore: null,
    visitorTeamId: 'cle',
    visitorAbbr: 'CLE',
    visitorName: null,
    visitorScore: null,
    providerStatus: null,
    providerStatusState: null,
    period: null,
    clock: null,
    overtimePeriods: 0,
    lifecycle: 'scheduled',
    gamesRequestId: 'req',
    firstObservedAt: '2026-11-02T18:00:00.000Z',
    lastObservedAt: '2026-11-02T18:00:00.000Z',
    lastChangedAt: '2026-11-02T18:00:00.000Z',
    terminalConfirmations: 0,
    finalObservedAt: null,
    pollingState: 'pending',
    boxCompleteness: 'none',
    boxRequestId: null,
    boxObservedAt: null,
    finalBoxAttempts: 0,
  };
}

describe('GET /api/scoreboard/context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SCOREBOARD_CARD_CONTEXT_ENABLED;
    requireBettingAuth.mockResolvedValue(authed());
    loadGamesForDate.mockResolvedValue([game()]);
    query.mockResolvedValue({ rows: [] });
  });

  it('returns 401 before reading the flag or the database', async () => {
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await GET(request('/api/scoreboard/context?date=2026-11-02'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(loadGamesForDate).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 503 when the serving flag is missing or not 1', async () => {
    const missing = await GET(request('/api/scoreboard/context?date=2026-11-02'));
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: 'card_context_disabled' });
    expect(missing.headers.get('Cache-Control')).toBe('no-store');

    process.env.SCOREBOARD_CARD_CONTEXT_ENABLED = 'yes';
    const invalid = await GET(request('/api/scoreboard/context?date=2026-11-02'));
    expect(invalid.status).toBe(503);
    expect(loadGamesForDate).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing or impossible date', async () => {
    process.env.SCOREBOARD_CARD_CONTEXT_ENABLED = '1';
    const missing = await GET(request('/api/scoreboard/context'));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'invalid_date' });
    const bad = await GET(request('/api/scoreboard/context?date=2026-02-31'));
    expect(bad.status).toBe(400);
    expect(loadGamesForDate).not.toHaveBeenCalled();
  });

  it('returns the card-context.v1 shape for a date', async () => {
    process.env.SCOREBOARD_CARD_CONTEXT_ENABLED = '1';
    const res = await GET(request('/api/scoreboard/context?date=2026-11-02'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');
    const body = await res.json();
    expect(body.schema_version).toBe('card-context.v1');
    expect(body.date).toBe('2026-11-02');
    expect(body.games['5001']).toEqual({
      schedule: { status: 'unavailable', text: 'Schedule context unavailable.' },
      injuries: { status: 'unavailable', text: 'Injury report unavailable', as_of: null, as_of_label: null, teams: null },
    });
    expect(loadGamesForDate).toHaveBeenCalledWith('2026-11-02');
  });

  it('returns 200 with a documented error when the scoreboard store fails', async () => {
    process.env.SCOREBOARD_CARD_CONTEXT_ENABLED = '1';
    loadGamesForDate.mockRejectedValue(new Error('store down'));
    const res = await GET(request('/api/scoreboard/context?date=2026-11-02'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBe('scoreboard_store_unavailable');
    expect(body.games).toEqual({});
  });

  it('returns 200 with per-game unavailable copy when analytics reads fail', async () => {
    process.env.SCOREBOARD_CARD_CONTEXT_ENABLED = '1';
    query.mockRejectedValue(new Error('analytics down'));
    const res = await GET(request('/api/scoreboard/context?date=2026-11-02'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(body.games['5001'].schedule.status).toBe('unavailable');
    expect(body.games['5001'].injuries.status).toBe('unavailable');
  });
});

describe('serveCardContext flag', () => {
  it('does not load games when the flag is off', async () => {
    const loadGames = vi.fn();
    const result = await serveCardContext({
      env: {},
      params: new URLSearchParams({ date: '2026-11-02' }),
      now: new Date('2026-11-02T22:00:00.000Z'),
      loadGames,
      query: async () => [],
    });
    expect(result.status).toBe(503);
    expect(loadGames).not.toHaveBeenCalled();
  });
});
