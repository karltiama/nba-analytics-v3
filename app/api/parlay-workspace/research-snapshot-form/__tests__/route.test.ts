import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requireBettingAuth, query } = vi.hoisted(() => ({
  requireBettingAuth: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  query: (...args: unknown[]) => query(...args),
  default: {},
}));

import { POST } from '@/app/api/parlay-workspace/research-snapshot-form/route';

function authed() {
  return {
    ok: true as const,
    auth: { userId: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (response: NextResponse) => response,
  };
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/parlay-workspace/research-snapshot-form', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/parlay-workspace/research-snapshot-form', () => {
  beforeEach(() => {
    requireBettingAuth.mockReset();
    query.mockReset();
  });

  it('requires an authenticated session', async () => {
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const response = await POST(post({ legs: [] }));
    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an invalid observation and does not query', async () => {
    requireBettingAuth.mockResolvedValue(authed());
    const response = await POST(
      post({
        legs: [
          {
            playerId: '11',
            gameId: 'g1',
            market: 'points',
            side: 'over',
            line: 15,
            snapshotAt: 'not-a-time',
            oddsAmerican: -115,
          },
        ],
      })
    );
    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('loads form at the observation cutoff without prices, injuries, or projections', async () => {
    requireBettingAuth.mockResolvedValue(authed());
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes('home_abbr')) {
        return [
          {
            game_id: 'g1',
            start_time: '2026-11-10T00:30:00.000Z',
            season: '2026',
            home_team_id: 'home',
            away_team_id: 'away',
            home_abbr: 'BOS',
            away_abbr: 'NYK',
          },
        ];
      }
      if (String(sql).includes('player_game_logs')) {
        return [
          {
            player_id: '11',
            game_id: 'old-1',
            team_id: 'home',
            start_time: '2026-11-01T00:00:00.000Z',
            season: '2026',
            minutes: 30,
            points: 18,
            rebounds: 4,
            assists: 3,
            three_pointers_made: 1,
            game_status: 'Final',
            box_score_stored_at: '2026-11-02T00:00:00.000Z',
          },
        ];
      }
      throw new Error(String(sql));
    });
    const response = await POST(
      post({
        legs: [
          {
            playerId: '11',
            gameId: 'g1',
            market: 'points',
            side: 'over',
            line: 15,
            snapshotAt: '2026-11-09T16:00:00.000Z',
          },
        ],
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { legs: Array<{ status: string; line: number; snapshotAt: string; season: { average: number } }> };
    expect(body.legs[0]?.status).toBe('ready');
    expect(body.legs[0]?.line).toBe(15);
    expect(body.legs[0]?.snapshotAt).toBe('2026-11-09T16:00:00.000Z');
    expect(body.legs[0]?.season.average).toBe(18);
    expect(JSON.stringify(body)).not.toContain('odds');
    const statements = query.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => sql.includes('player_injury'))).toBe(false);
    expect(statements.some((sql) => sql.includes('prediction_snapshots'))).toBe(false);
    expect(statements.some((sql) => sql.includes('l.created_at <'))).toBe(true);
    expect(query.mock.calls.some((call) => call[1]?.[1] === '2026-11-09T16:00:00.000Z')).toBe(true);
  });
});
