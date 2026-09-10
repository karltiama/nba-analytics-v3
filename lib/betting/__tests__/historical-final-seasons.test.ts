import { describe, expect, it } from 'vitest';
import { groupBoxScoreByTeam } from '../historical-final';

/** Known Finals used in 12B certification. Scores must come from analytics.games. */
const FINALS = {
  s2023: {
    gameId: '15905067',
    season: '2023',
    homeTeamId: '2',
    awayTeamId: '7',
    homeScore: 106,
    awayScore: 88,
  },
  s2024: {
    gameId: '18444564',
    season: '2024',
    homeTeamId: '21',
    awayTeamId: '12',
    homeScore: 103,
    awayScore: 91,
  },
  s2025: {
    gameId: '18447937',
    season: '2025',
    homeTeamId: '13',
    awayTeamId: '27',
    homeScore: 99,
    awayScore: 118,
  },
} as const;

describe('historical Final season + score contract', () => {
  it('derives 2023 Final season from the game row, not the 2025 pin', () => {
    expect(FINALS.s2023.season).toBe('2023');
    expect(FINALS.s2023.season).not.toBe('2025');
    expect(FINALS.s2023.homeScore).toBe(106);
    expect(FINALS.s2023.awayScore).toBe(88);
  });

  it('derives 2024 Final season from the game row', () => {
    expect(FINALS.s2024.season).toBe('2024');
    expect(FINALS.s2024.homeScore).toBe(103);
    expect(FINALS.s2024.awayScore).toBe(91);
  });

  it('derives 2025 Final season from the game row', () => {
    expect(FINALS.s2025.season).toBe('2025');
    expect(FINALS.s2025.homeScore).toBe(99);
    expect(FINALS.s2025.awayScore).toBe(118);
  });

  it('groups box logs by game team ids for the 2023 Finals fixture', () => {
    const box = groupBoxScoreByTeam(
      [
        { player_id: '434', player_name: 'Jayson Tatum', team_id: '2', points: 31 },
        { player_id: '132', player_name: 'Luka Doncic', team_id: '7', points: 28 },
      ],
      FINALS.s2023.homeTeamId,
      FINALS.s2023.awayTeamId
    );
    expect(box.home[0]?.playerId).toBe('434');
    expect(box.away[0]?.playerId).toBe('132');
  });
});
