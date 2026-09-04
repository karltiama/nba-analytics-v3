import { describe, expect, it } from 'vitest';
import {
  buildEnrichedTeamSide,
  hasAnyMarket,
  toNullableGameOdds,
} from '@/lib/betting/enrich-games-response';
import type { GameOdds } from '@/lib/betting/queries';

describe('toNullableGameOdds', () => {
  it('does not fabricate 0 / -110 when markets are missing', () => {
    const out = toNullableGameOdds(undefined);
    expect(out.home.moneyline).toBeNull();
    expect(out.home.spread).toBeNull();
    expect(out.home.spreadOdds).toBeNull();
    expect(out.away.moneyline).toBeNull();
    expect(out.away.spread).toBeNull();
    expect(out.away.spreadOdds).toBeNull();
    expect(out.overUnder).toBeNull();
    expect(out.overOdds).toBeNull();
    expect(out.underOdds).toBeNull();
    expect(hasAnyMarket(out)).toBe(false);
  });

  it('preserves genuine market values including a real zero spread', () => {
    const odds: GameOdds = {
      home: { moneyline: -120, spread: 0, spreadOdds: -110 },
      away: { moneyline: 100, spread: 0, spreadOdds: -110 },
      overUnder: 224.5,
      overOdds: -105,
      underOdds: -115,
      bookmaker: 'draftkings',
    };
    const out = toNullableGameOdds(odds);
    expect(out.home.spread).toBe(0);
    expect(out.home.spreadOdds).toBe(-110);
    expect(out.overUnder).toBe(224.5);
    expect(hasAnyMarket(out)).toBe(true);
  });
});

describe('buildEnrichedTeamSide', () => {
  it('returns null ratings/record when no season analytics', () => {
    const side = buildEnrichedTeamSide({
      id: '1',
      name: 'Team',
      abbreviation: 'T',
      ratings: undefined,
      defensiveRank: undefined,
      recentForm: [],
    });
    expect(side.hasSeasonAnalytics).toBe(false);
    expect(side.record).toBeNull();
    expect(side.pace).toBeNull();
    expect(side.offensiveRating).toBeNull();
    expect(side.defensiveRank).toBeNull();
  });

  it('does not invent defensive rank 0 as a signal', () => {
    const side = buildEnrichedTeamSide({
      id: '1',
      name: 'Team',
      abbreviation: 'T',
      ratings: { wins: 1, losses: 0, pace: 100, offensive_rating: 110, defensive_rating: 105 },
      defensiveRank: 0,
      recentForm: [],
    });
    expect(side.hasSeasonAnalytics).toBe(true);
    expect(side.record).toBe('1-0');
    expect(side.defensiveRank).toBeNull();
    expect(side.pace).toBe(100);
  });
});
