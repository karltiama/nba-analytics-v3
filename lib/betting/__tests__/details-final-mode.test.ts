import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireBettingAuth = vi.fn();
const query = vi.fn();
const getAllTeamRatings = vi.fn();
const getTeamRecentForm = vi.fn();
const getHistoricalMatchups = vi.fn();
const getLineMovement = vi.fn();
const getGameOdds = vi.fn();
const getInjuryMatchupContext = vi.fn();
const fetchLineupsFromBallDontLie = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/betting/queries', () => ({
  getGameOdds: (...args: unknown[]) => getGameOdds(...args),
  getAllTeamRatings: (...args: unknown[]) => getAllTeamRatings(...args),
  getTeamRecentForm: (...args: unknown[]) => getTeamRecentForm(...args),
  getHistoricalMatchups: (...args: unknown[]) => getHistoricalMatchups(...args),
  getLineMovement: (...args: unknown[]) => getLineMovement(...args),
}));

vi.mock('@/lib/betting/injury-matchup-context', () => ({
  getInjuryMatchupContext: (...args: unknown[]) => getInjuryMatchupContext(...args),
}));

vi.mock('@/lib/balldontlie/lineups', () => ({
  fetchLineupsFromBallDontLie: (...args: unknown[]) => fetchLineupsFromBallDontLie(...args),
}));

vi.mock('@/lib/betting/ai-briefing-eligibility', () => ({
  isIngestionFrozen: () => true,
}));

import { GET } from '@/app/api/betting/games/[gameId]/details/route';

function authed() {
  return {
    ok: true as const,
    auth: { userId: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

function finalGameRow() {
  return {
    game_id: '15905067',
    season: '2023',
    start_time: '2024-06-18T00:00:00.000Z',
    game_date: '2024-06-17',
    status: 'Final',
    home_score: 106,
    away_score: 88,
    home_team_id: '2',
    away_team_id: '7',
    home_team_name: 'Boston Celtics',
    home_team_abbr: 'BOS',
    away_team_name: 'Dallas Mavericks',
    away_team_abbr: 'DAL',
  };
}

describe('GET /api/betting/games/:id/details Final contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireBettingAuth.mockResolvedValue(authed());
    getLineMovement.mockResolvedValue({ spreadMovement: [], totalMovement: [] });
    getGameOdds.mockResolvedValue({
      home: { spread: null, spreadOdds: null, moneyline: null },
      away: { spreadOdds: null, moneyline: null },
      overUnder: null,
      overOdds: null,
      underOdds: null,
      bookmaker: null,
    });
  });

  it('derives gameSeason from the game row and does not call live ratings or BDL lineups', async () => {
    query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('player_role_profile')) return [];
      if (s.includes('player_game_advanced')) return [];
      if (s.includes('game_starters')) return [];
      if (s.includes('player_game_logs')) {
        return [
          {
            player_id: '434',
            player_name: 'Jayson Tatum',
            team_id: '2',
            minutes: '45',
            points: 31,
            rebounds: 8,
            assists: 11,
            steals: 2,
            blocks: 0,
          },
          {
            player_id: '132',
            player_name: 'Luka Doncic',
            team_id: '7',
            minutes: '43',
            points: 28,
            rebounds: 12,
            assists: 5,
            steals: 3,
            blocks: 0,
          },
        ];
      }
      return [finalGameRow()];
    });

    const res = await GET(new NextRequest('http://localhost/api/betting/games/15905067/details'), {
      params: Promise.resolve({ gameId: '15905067' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.viewMode).toBe('final');
    expect(body.gameSeason).toBe('2023');
    expect(body.gameSeason).not.toBe('2025');
    expect(body.game.homeScore).toBe(106);
    expect(body.game.awayScore).toBe(88);
    expect(body.boxScore.available).toBe(true);
    expect(body.boxScore.home[0]?.playerId).toBe('434');
    expect(body.boxScore.away[0]?.playerId).toBe('132');
    expect(body.availability).toEqual({
      starters: false,
      advanced: false,
      roleProfile: false,
      timeline: false,
      rotationContext: false,
    });
    expect(body.injuries).toEqual({ home: [], away: [] });
    expect(body.starters).toEqual({ available: false, home: [], away: [] });
    expect(body.events).toBeUndefined();
    expect(body.keyEvents).toBeUndefined();
    expect(getAllTeamRatings).not.toHaveBeenCalled();
    expect(getTeamRecentForm).not.toHaveBeenCalled();
    expect(getInjuryMatchupContext).not.toHaveBeenCalled();
    expect(fetchLineupsFromBallDontLie).not.toHaveBeenCalled();
  });

  it('keeps live details on the ratings path for a Scheduled game', async () => {
    query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('player_role_profile')) return [];
      if (s.includes('player_game_advanced')) return [];
      if (s.includes('player_injury_status_current')) return [];
      return [
        {
          ...finalGameRow(),
          game_id: '21717855',
          season: '2026',
          status: 'Scheduled',
          home_score: null,
          away_score: null,
          start_time: '2026-10-20T19:00:00.000Z',
        },
      ];
    });
    getAllTeamRatings.mockResolvedValue({});
    getTeamRecentForm.mockResolvedValue([]);
    getHistoricalMatchups.mockResolvedValue([]);
    getInjuryMatchupContext.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/betting/games/21717855/details'), {
      params: Promise.resolve({ gameId: '21717855' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewMode).toBe('live');
    expect(getAllTeamRatings).toHaveBeenCalled();
    expect(fetchLineupsFromBallDontLie).not.toHaveBeenCalled();
  });

  it('returns certified 5+5 starters for a 2025 Final and still does not call BDL', async () => {
    query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('player_role_profile')) return [];
      if (s.includes('player_game_advanced')) return [];
      if (s.includes('game_starters')) {
        return [
          ...[1, 2, 3, 4, 5].map((n) => ({
            player_id: `h${n}`,
            player_name: `Home ${n}`,
            team_id: '13',
            position: n === 1 ? 'C' : 'G',
          })),
          ...[1, 2, 3, 4, 5].map((n) => ({
            player_id: `a${n}`,
            player_name: `Away ${n}`,
            team_id: '27',
            position: 'F',
          })),
        ];
      }
      if (s.includes('player_game_logs')) return [];
      return [
        {
          ...finalGameRow(),
          game_id: '18447937',
          season: '2025',
          home_team_id: '13',
          away_team_id: '27',
          home_team_abbr: 'LAC',
          away_team_abbr: 'SAS',
          home_score: 99,
          away_score: 118,
          status: 'Final',
        },
      ];
    });

    const res = await GET(new NextRequest('http://localhost/api/betting/games/18447937/details'), {
      params: Promise.resolve({ gameId: '18447937' }),
    });
    const body = await res.json();
    expect(body.viewMode).toBe('final');
    expect(body.gameSeason).toBe('2025');
    expect(body.starters.available).toBe(true);
    expect(body.starters.home).toHaveLength(5);
    expect(body.starters.away).toHaveLength(5);
    expect(body.availability.starters).toBe(true);
    expect(fetchLineupsFromBallDontLie).not.toHaveBeenCalled();
  });

  it('hides Starting Five for a 2025 anomaly and does not fall back to BDL', async () => {
    query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('player_role_profile')) return [];
      if (s.includes('player_game_advanced')) return [];
      if (s.includes('game_starters')) {
        return [1, 2, 3, 4].map((n) => ({
          player_id: String(n),
          player_name: `P${n}`,
          team_id: '10',
          position: 'G',
        }));
      }
      if (s.includes('player_game_logs')) return [];
      return [
        {
          ...finalGameRow(),
          game_id: '18447931',
          season: '2025',
          home_team_id: '10',
          away_team_id: '2',
          status: 'Final',
        },
      ];
    });

    const res = await GET(new NextRequest('http://localhost/api/betting/games/18447931/details'), {
      params: Promise.resolve({ gameId: '18447931' }),
    });
    const body = await res.json();
    expect(body.starters.available).toBe(false);
    expect(body.starters.home).toHaveLength(0);
    expect(body.availability.starters).toBe(false);
    expect(fetchLineupsFromBallDontLie).not.toHaveBeenCalled();
  });

  it('enriches 2023/2024/2025 Finals with Advanced serving and leaves missing Advanced null', async () => {
    const advancedRow = (playerId: string, gameId: string, season: string) => ({
      player_id: playerId,
      game_id: gameId,
      season,
      usage_percentage: 0.32,
      true_shooting_percentage: 0.587,
      effective_field_goal_percentage: 0.55,
      offensive_rating: 118.4,
      defensive_rating: 104.1,
      net_rating: 14.3,
      pace: 99.2,
      possessions: 82,
      assist_percentage: 0.21,
      rebound_percentage: 0.09,
      turnover_ratio: 8.4,
      pie: 0.142,
    });

    async function loadFinal(opts: {
      gameId: string;
      season: string;
      homeTeamId: string;
      awayTeamId: string;
      withAdvanced: boolean;
    }) {
      query.mockImplementation(async (sql: unknown) => {
        const s = String(sql);
        if (s.includes('player_role_profile')) return [];
        if (s.includes('player_game_advanced')) {
          return opts.withAdvanced ? [advancedRow('434', opts.gameId, opts.season)] : [];
        }
        if (s.includes('game_starters')) return [];
        if (s.includes('player_game_logs')) {
          return [
            {
              player_id: '434',
              player_name: 'Star',
              team_id: opts.homeTeamId,
              minutes: '45',
              points: 31,
              rebounds: 8,
              assists: 11,
              steals: 2,
              blocks: 0,
            },
            {
              player_id: '999',
              player_name: 'Bench',
              team_id: opts.awayTeamId,
              minutes: '4',
              points: 2,
              rebounds: 0,
              assists: 0,
              steals: 0,
              blocks: 0,
            },
          ];
        }
        return [
          {
            ...finalGameRow(),
            game_id: opts.gameId,
            season: opts.season,
            home_team_id: opts.homeTeamId,
            away_team_id: opts.awayTeamId,
          },
        ];
      });
      const res = await GET(new NextRequest(`http://localhost/api/betting/games/${opts.gameId}/details`), {
        params: Promise.resolve({ gameId: opts.gameId }),
      });
      return res.json();
    }

    const s2023 = await loadFinal({
      gameId: '15905067',
      season: '2023',
      homeTeamId: '2',
      awayTeamId: '7',
      withAdvanced: true,
    });
    expect(s2023.availability.advanced).toBe(true);
    expect(s2023.boxScore.home[0]?.advanced?.trueShootingPercentage).toBe(0.587);
    expect(s2023.boxScore.home[0]?.advanced?.usagePercentage).toBe(0.32);
    expect(s2023.boxScore.home[0]?.advanced?.usagePercentage).toBe(0.32);
    expect(s2023.boxScore.away[0]?.playerId).toBe('999');
    expect(s2023.boxScore.away[0]?.advanced).toBeNull();

    const s2024 = await loadFinal({
      gameId: '18444564',
      season: '2024',
      homeTeamId: '21',
      awayTeamId: '12',
      withAdvanced: true,
    });
    expect(s2024.availability.advanced).toBe(true);

    const s2025 = await loadFinal({
      gameId: '18447937',
      season: '2025',
      homeTeamId: '13',
      awayTeamId: '27',
      withAdvanced: true,
    });
    expect(s2025.availability.advanced).toBe(true);
    expect(fetchLineupsFromBallDontLie).not.toHaveBeenCalled();
  });

  it('keeps Advanced unavailable on a 2026 Scheduled game', async () => {
    query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('player_role_profile')) return [];
      if (s.includes('player_game_advanced')) return [];
      if (s.includes('player_injury_status_current')) return [];
      return [
        {
          ...finalGameRow(),
          game_id: '21717855',
          season: '2026',
          status: 'Scheduled',
          home_score: null,
          away_score: null,
          start_time: '2026-10-20T19:00:00.000Z',
        },
      ];
    });
    getAllTeamRatings.mockResolvedValue({});
    getTeamRecentForm.mockResolvedValue([]);
    getHistoricalMatchups.mockResolvedValue([]);
    getInjuryMatchupContext.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/betting/games/21717855/details'), {
      params: Promise.resolve({ gameId: '21717855' }),
    });
    const body = await res.json();
    expect(body.viewMode).toBe('live');
    expect(body.availability.advanced).toBe(false);
    expect(body.availability.roleProfile).toBe(false);
    expect(body.boxScore.available).toBe(false);
  });

  it('attaches season Role Profile independently of Advanced and batches one lookup', async () => {
    const roleRow = {
      player_id: '434',
      season: '2023',
      isolation_poss_pct: 0.189,
      isolation_ppp: 1.04,
      pnr_ball_handler_poss_pct: 0.176,
      pnr_ball_handler_ppp: 0.96,
      pnr_roll_man_poss_pct: null,
      pnr_roll_man_ppp: null,
      drives_per_game: 12.4,
      drive_points_per_game: 8.1,
      passes_per_game: 48.7,
      potential_assists_per_game: 8.2,
      restricted_area_fga: 4.1,
      restricted_area_fg_pct: 0.62,
      paint_non_ra_fga: 2.0,
      paint_non_ra_fg_pct: 0.45,
      midrange_fga: 3.2,
      midrange_fg_pct: 0.41,
      corner_three_fga: 0.8,
      corner_three_fg_pct: 0.39,
      above_break_three_fga: 5.1,
      above_break_three_fg_pct: 0.36,
    };
    query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('player_role_profile')) return [roleRow];
      if (s.includes('player_game_advanced')) {
        return [
          {
            player_id: '434',
            game_id: '15905067',
            season: '2023',
            usage_percentage: 0.284,
            true_shooting_percentage: 0.563,
            effective_field_goal_percentage: 0.479,
            offensive_rating: 122.4,
            defensive_rating: 103.6,
            net_rating: 18.7,
            pace: 89.7,
            possessions: 85,
            assist_percentage: 0.423,
            rebound_percentage: 0.089,
            turnover_ratio: 5,
            pie: 0.205,
          },
        ];
      }
      if (s.includes('game_starters')) return [];
      if (s.includes('player_game_logs')) {
        return [
          {
            player_id: '434',
            player_name: 'Jayson Tatum',
            team_id: '2',
            minutes: '45',
            points: 31,
            rebounds: 8,
            assists: 11,
            steals: 2,
            blocks: 0,
          },
          {
            player_id: '132',
            player_name: 'Luka Doncic',
            team_id: '7',
            minutes: '43',
            points: 28,
            rebounds: 12,
            assists: 5,
            steals: 3,
            blocks: 0,
          },
        ];
      }
      return [finalGameRow()];
    });

    const res = await GET(new NextRequest('http://localhost/api/betting/games/15905067/details'), {
      params: Promise.resolve({ gameId: '15905067' }),
    });
    const body = await res.json();
    expect(body.availability.advanced).toBe(true);
    expect(body.availability.roleProfile).toBe(true);
    expect(body.boxScore.home[0]?.advanced?.usagePercentage).toBe(0.284);
    expect(body.boxScore.home[0]?.roleProfile?.isolationPossPct).toBe(0.189);
    expect(body.boxScore.home[0]?.roleProfile?.season).toBe('2023');
    expect(body.boxScore.away[0]?.playerId).toBe('132');
    expect(body.boxScore.away[0]?.roleProfile).toBeNull();
    expect(body.availability.timeline).toBe(false);
    expect(body.availability.rotationContext).toBe(false);
    const roleQueries = query.mock.calls.filter((call) => String(call[0]).includes('player_role_profile'));
    expect(roleQueries).toHaveLength(1);
    expect(String(roleQueries[0]?.[0])).toContain('ANY($2');
    expect(roleQueries[0]?.[1]?.[0]).toBe('2023');
    expect(fetchLineupsFromBallDontLie).not.toHaveBeenCalled();
  });

  it('sets Timeline and rotationContext from game_flow serving, not season === 2025', async () => {
    query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('game_flow')) {
        return [{ timeline_available: true, rotation_available: false }];
      }
      if (s.includes('player_role_profile')) return [];
      if (s.includes('player_game_advanced')) return [];
      if (s.includes('game_starters')) return [];
      if (s.includes('player_game_logs')) {
        return [
          {
            player_id: '274',
            player_name: 'Kawhi Leonard',
            team_id: '13',
            minutes: '32',
            points: 24,
            rebounds: 5,
            assists: 3,
            steals: 1,
            blocks: 0,
          },
        ];
      }
      return [
        {
          ...finalGameRow(),
          game_id: '18447937',
          season: '2025',
          home_team_id: '13',
          away_team_id: '27',
          home_score: 99,
          away_score: 118,
        },
      ];
    });

    const res = await GET(new NextRequest('http://localhost/api/betting/games/18447937/details'), {
      params: Promise.resolve({ gameId: '18447937' }),
    });
    const body = await res.json();
    expect(body.viewMode).toBe('final');
    expect(body.availability.timeline).toBe(true);
    expect(body.availability.rotationContext).toBe(false);
    expect(body.availability.starters).toBe(false);
  });
});
