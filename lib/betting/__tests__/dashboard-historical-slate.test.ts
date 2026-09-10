import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireBettingAuth = vi.fn();
const getGamesForCalendarDate = vi.fn();
const getGamesForDate = vi.fn();
const getAllTeamRatings = vi.fn();
const getTeamRecentForm = vi.fn();
const getTeamDefensiveRankings = vi.fn();
const getGamesOdds = vi.fn();
const getTodaysGames = vi.fn();
const getRecentGames = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/betting/queries', () => ({
  getTodaysGames: (...args: unknown[]) => getTodaysGames(...args),
  getRecentGames: (...args: unknown[]) => getRecentGames(...args),
  getAllTeamRatings: (...args: unknown[]) => getAllTeamRatings(...args),
  getTeamRecentForm: (...args: unknown[]) => getTeamRecentForm(...args),
  getGamesOdds: (...args: unknown[]) => getGamesOdds(...args),
  getTeamDefensiveRankings: (...args: unknown[]) => getTeamDefensiveRankings(...args),
  getGamesForCalendarDate: (...args: unknown[]) => getGamesForCalendarDate(...args),
  getGamesForDate: (...args: unknown[]) => getGamesForDate(...args),
}));

vi.mock('@/lib/balldontlie/refresh-schedule-from-bdl', () => ({
  getTodayEtYmd: () => '2026-09-10',
  refreshBdlScheduleForEtDateRange: vi.fn(),
}));

vi.mock('@/lib/runtime/ingestion-mode', () => ({
  isLiveBdlScheduleRefreshEnabled: () => false,
}));

vi.mock('@/lib/betting/ai-briefing-eligibility', () => ({
  isIngestionFrozen: () => true,
}));

import { GET } from '@/app/api/betting/games/route';

function authed() {
  return {
    ok: true as const,
    auth: { userId: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

describe('GET /api/betting/games historical Dashboard date', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireBettingAuth.mockResolvedValue(authed());
    getGamesOdds.mockResolvedValue({});
    getAllTeamRatings.mockResolvedValue({});
    getTeamDefensiveRankings.mockResolvedValue([]);
  });

  it('returns the 2024-06-17 Final instead of a season-pinned empty slate', async () => {
    getGamesForCalendarDate.mockResolvedValueOnce([
      {
        game_id: '15905067',
        game_date: '2024-06-17',
        start_time: '2024-06-18T00:00:00.000Z',
        home_team_id: '2',
        away_team_id: '7',
        home_team_name: 'Boston Celtics',
        away_team_name: 'Dallas Mavericks',
        home_team_abbr: 'BOS',
        away_team_abbr: 'DAL',
        home_score: 106,
        away_score: 88,
        status: 'Final',
      },
    ]);

    const res = await GET(new NextRequest('http://localhost/api/betting/games?date=2024-06-17'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.gamePicker).toBe('calendar');
    expect(body.games).toHaveLength(1);
    expect(body.games[0].id).toBe('15905067');
    expect(body.games[0].homeScore).toBe(106);
    expect(body.games[0].awayScore).toBe(88);
    expect(getGamesForCalendarDate).toHaveBeenCalledWith('2024-06-17');
    expect(getGamesForDate).not.toHaveBeenCalled();
    expect(getAllTeamRatings).not.toHaveBeenCalled();
    expect(getTeamRecentForm).not.toHaveBeenCalled();
  });

  it('keeps today/future dates on the season-pinned loader', async () => {
    getGamesForDate.mockResolvedValueOnce([]);
    const res = await GET(new NextRequest('http://localhost/api/betting/games?date=2026-10-20'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.gamePicker).toBe('season');
    expect(getGamesForDate).toHaveBeenCalledWith('2026-10-20');
    expect(getGamesForCalendarDate).not.toHaveBeenCalled();
  });
});
