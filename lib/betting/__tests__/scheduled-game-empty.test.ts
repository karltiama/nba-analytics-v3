import { describe, expect, it } from 'vitest';
import { toNullableGameOdds, buildEnrichedTeamSide, enrichGameStatus } from '@/lib/betting/enrich-games-response';

/**
 * Simulates the games API enrichment for a scheduled game with no markets / no season avgs.
 */
function enrichScheduledGameStub() {
  const odds = toNullableGameOdds(undefined);
  const home = buildEnrichedTeamSide({
    id: 'h',
    name: 'Home',
    abbreviation: 'HOM',
    ratings: undefined,
    defensiveRank: undefined,
    recentForm: [],
  });
  const { status } = enrichGameStatus('2026-11-01T00:00:00Z');
  return {
    status,
    odds,
    homeTeam: home,
    awayTeam: buildEnrichedTeamSide({
      id: 'a',
      name: 'Away',
      abbreviation: 'AWY',
      ratings: undefined,
      defensiveRank: undefined,
      recentForm: [],
    }),
  };
}

describe('scheduled game with no props/odds/analytics', () => {
  it('renders an honest payload (nullable odds, no fake ratings, Scheduled status)', () => {
    const g = enrichScheduledGameStub();
    expect(g.status).toBe('Scheduled');
    expect(g.odds.home.moneyline).toBeNull();
    expect(g.odds.home.spreadOdds).toBeNull();
    expect(g.odds.overUnder).toBeNull();
    expect(g.homeTeam.hasSeasonAnalytics).toBe(false);
    expect(g.homeTeam.pace).toBeNull();
    expect(g.homeTeam.record).toBeNull();
    expect(g.awayTeam.offensiveRating).toBeNull();
  });
});
