import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireBettingAuth = vi.fn();
const query = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  query: (...args: unknown[]) => query(...args),
}));

import { POST } from '@/app/api/parlay-xray/headshots/route';
import { LOAD_PLAYERS_SQL } from '@/lib/parlay-xray/resolution/load-catalog';

const USER_A = '11111111-1111-1111-1111-111111111111';

function authed() {
  return {
    ok: true as const,
    auth: { userId: USER_A, email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

function requestWith(names: unknown): NextRequest {
  return new NextRequest('http://localhost/api/parlay-xray/headshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  });
}

describe('POST /api/parlay-xray/headshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns AUTH_REQUIRED without querying the catalog', async () => {
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await POST(requestWith(['Nikola Jokic']));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ result: 'AUTH_REQUIRED', players: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it('maps unique exact names to NBA ids and leaves OCR misses empty', async () => {
    requireBettingAuth.mockResolvedValue(authed());
    query.mockResolvedValue([
      {
        player_id: '203999',
        entity_id: 'ent-jokic',
        full_name: 'Nikola Jokic',
        first_name: 'Nikola',
        last_name: 'Jokic',
        nba_player_id: '203999',
      },
      {
        player_id: '1631119',
        entity_id: 'ent-jalen-w',
        full_name: 'Jalen Williams',
        first_name: 'Jalen',
        last_name: 'Williams',
        nba_player_id: '1631119',
      },
      {
        player_id: '1631116',
        entity_id: 'ent-jaylin-w',
        full_name: 'Jaylin Williams',
        first_name: 'Jaylin',
        last_name: 'Williams',
        nba_player_id: '1631116',
      },
    ]);
    const res = await POST(requestWith(['Nikola Jokic', 'Jockic', 'J. Williams']));
    expect(res.status).toBe(200);
    expect(query.mock.calls[0]?.[0]).toBe(LOAD_PLAYERS_SQL);
    expect(await res.json()).toEqual({
      result: 'OK',
      players: [
        { extracted: 'Nikola Jokic', nbaPlayerId: '203999' },
        { extracted: 'Jockic', nbaPlayerId: null },
        { extracted: 'J. Williams', nbaPlayerId: null },
      ],
    });
  });

  it('returns an empty list for empty or invalid bodies', async () => {
    requireBettingAuth.mockResolvedValue(authed());
    const res = await POST(requestWith([]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: 'OK', players: [] });
    expect(query).not.toHaveBeenCalled();
  });
});
