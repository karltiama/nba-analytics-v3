import { describe, expect, it } from 'vitest';
import { assembleMatchup } from '../matchup';
import { CUTOFF, TARGET_GAME, teamStat } from './fixtures';

describe('X3C matchup matrix', () => {
  it('aggregates opponent and team stats from prior games only', () => {
    const ctx = assembleMatchup({
      teamStats: [
        teamStat({ teamId: 'okc', gameId: 'a', startTime: '2026-03-10T01:00:00.000Z', pace: 102, teamPoints: 120 }),
        teamStat({ teamId: 'okc', gameId: 'b', startTime: '2026-03-12T01:00:00.000Z', pace: 98, teamPoints: 110 }),
        teamStat({ teamId: 'den', gameId: 'c', startTime: '2026-03-11T01:00:00.000Z', pointsAllowed: 100 }),
        teamStat({ teamId: 'den', gameId: 'd', startTime: '2026-03-13T01:00:00.000Z', pointsAllowed: 112 }),
      ],
      cutoffAt: CUTOFF,
      targetGameId: TARGET_GAME,
      season: '2026',
      playerTeamId: 'okc',
      opponentTeamId: 'den',
      opponentAbbr: 'DEN',
    });
    expect(ctx.status).toBe('LIMITED');
    expect(ctx.opponentAbbr).toBe('DEN');
    expect(ctx.teamPace.average).toBe(100);
    expect(ctx.opponentPointsAllowed.average).toBe(106);
    expect(ctx.teamPoints.gameCount).toBe(2);
  });

  it('keeps early-season samples LIMITED', () => {
    const ctx = assembleMatchup({
      teamStats: [teamStat({ teamId: 'den', gameId: 'c', startTime: '2026-03-11T01:00:00.000Z' })],
      cutoffAt: CUTOFF,
      targetGameId: TARGET_GAME,
      season: '2026',
      playerTeamId: 'okc',
      opponentTeamId: 'den',
      opponentAbbr: 'DEN',
    });
    expect(ctx.status).toBe('LIMITED');
    expect(ctx.reason).toBe('SMALL_PRIOR_SAMPLE');
  });

  it('does not treat missing team stats as full-strength evidence', () => {
    const ctx = assembleMatchup({
      teamStats: [],
      cutoffAt: CUTOFF,
      targetGameId: TARGET_GAME,
      season: '2026',
      playerTeamId: 'okc',
      opponentTeamId: 'den',
      opponentAbbr: 'DEN',
    });
    expect(ctx.status).toBe('LIMITED');
    expect(ctx.reason).toBe('MISSING_TEAM_STATS');
    expect(ctx.opponentPace.gameCount).toBe(0);
  });
});
