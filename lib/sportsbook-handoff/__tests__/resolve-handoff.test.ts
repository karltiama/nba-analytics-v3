import { describe, expect, it } from 'vitest';
import type { CanonicalBetLeg, CanonicalBetSlip } from '@/lib/bet-slip/types';
import {
  isLiveSportsbookResolutionAvailable,
  listHandoffProviders,
  openSportsbookLabel,
  resolveSportsbookHandoff,
  unavailableLiveSportsbookResolver,
} from '../index';

const SAMPLE_LEG: CanonicalBetLeg = {
  selectionKey: 'nba|game-1|1628369|points|over|28.5',
  sport: 'nba',
  gameId: 'game-1',
  playerId: '1628369',
  market: 'points',
  side: 'over',
  line: 28.5,
  playerName: 'Jayson Tatum',
  selectedSportsbook: 'draftkings',
  selectedOdds: -110,
  selectedAt: '2026-03-17T18:00:00.000Z',
};

const SAMPLE_SLIP: CanonicalBetSlip = {
  legs: [SAMPLE_LEG],
  source: 'props_explorer',
  title: 'Test',
};

describe('resolveSportsbookHandoff', () => {
  it('falls through deepest request to verified sportsbook homepage', () => {
    for (const sportsbook of listHandoffProviders()) {
      const result = resolveSportsbookHandoff({
        sportsbook,
        slip: SAMPLE_SLIP,
        event: { gameId: 'game-1' },
        selection: { leg: SAMPLE_LEG },
      });
      expect(result.level).toBe('sportsbook');
      expect(result.verified).toBe(true);
      expect(result.requestedLevel).toBe('betslip');
      expect(result.url.startsWith('https://')).toBe(true);
      expect(['event', 'market', 'selection', 'betslip']).not.toContain(result.level);
    }
  });

  it('uses capability-safe open labels', () => {
    expect(openSportsbookLabel('draftkings')).toBe('Open DraftKings');
    expect(openSportsbookLabel('fanduel')).toBe('Open FanDuel');
    expect(openSportsbookLabel('caesars')).toBe('Open Caesars');
    expect(openSportsbookLabel('fanatics')).toBe('Open Fanatics');
    expect(openSportsbookLabel('betmgm')).toBe('Open BetMGM');
  });

  it('does not mutate the slip when resolving handoff', () => {
    const before = structuredClone(SAMPLE_SLIP);
    resolveSportsbookHandoff({ sportsbook: 'fanduel', slip: SAMPLE_SLIP });
    expect(SAMPLE_SLIP).toEqual(before);
  });
});

describe('live resolver boundary', () => {
  it('reports live resolution unavailable without fabricating match statuses', async () => {
    expect(isLiveSportsbookResolutionAvailable()).toBe(false);
    const result = await unavailableLiveSportsbookResolver.resolveSlip(SAMPLE_SLIP, 'draftkings');
    expect(result.status).toBe('unavailable');
    expect(result.liveResolutionAvailable).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('EXACT');
    expect(serialized).not.toContain('ODDS_CHANGED');
    expect(serialized).not.toContain('LINE_CHANGED');
    expect(serialized).not.toContain('SUSPENDED');
  });
});
