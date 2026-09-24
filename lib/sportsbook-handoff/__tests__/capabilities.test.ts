import { describe, expect, it } from 'vitest';
import {
  SPORTSBOOK_HANDOFF_CAPABILITIES,
  getHandoffCapability,
  listHandoffProviders,
} from '../capabilities';
import { listSportsbookHandoffAdapters } from '../adapters';
import { HANDOFF_SPORTSBOOK_HOME_URLS } from '../types';

describe('sportsbook handoff capabilities', () => {
  it('registers all five approved providers', () => {
    expect(listHandoffProviders()).toEqual([
      'draftkings',
      'fanduel',
      'caesars',
      'fanatics',
      'betmgm',
    ]);
  });

  it('marks openSportsbook confirmed for every provider', () => {
    for (const provider of listHandoffProviders()) {
      expect(getHandoffCapability(provider).openSportsbook).toBe('confirmed');
    }
  });

  it('does not claim preload/event for DK/FD/Caesars/Fanatics', () => {
    for (const provider of ['draftkings', 'fanduel', 'caesars', 'fanatics'] as const) {
      const c = SPORTSBOOK_HANDOFF_CAPABILITIES[provider];
      expect(c.openEvent).toBe('unavailable');
      expect(c.openMarket).toBe('unavailable');
      expect(c.preloadSingleSelection).toBe('unavailable');
      expect(c.preloadMultipleSelections).toBe('unavailable');
      expect(c.preloadSameGameParlay).toBe('unavailable');
      expect(c.requiresAffiliateRelationship).toBe(false);
    }
  });

  it('marks BetMGM deeper levels partner_only', () => {
    const c = SPORTSBOOK_HANDOFF_CAPABILITIES.betmgm;
    expect(c.openEvent).toBe('partner_only');
    expect(c.preloadSingleSelection).toBe('partner_only');
    expect(c.requiresAffiliateRelationship).toBe(true);
  });

  it('adapters only expose verified sportsbook destinations', () => {
    for (const adapter of listSportsbookHandoffAdapters()) {
      const dest = adapter.buildSportsbookDestination();
      expect(dest.level).toBe('sportsbook');
      expect(dest.verified).toBe(true);
      expect(dest.url).toBe(HANDOFF_SPORTSBOOK_HOME_URLS[adapter.sportsbook]);
      expect(dest.url.startsWith('https://')).toBe(true);
      expect(adapter.buildEventDestination?.({ gameId: 'g1' }) ?? null).toBeNull();
      expect(
        adapter.buildSelectionDestination?.({
          leg: {
            selectionKey: 'nba|g|1|points|over|28.5',
            sport: 'nba',
            gameId: 'g',
            playerId: '1',
            market: 'points',
            side: 'over',
            line: 28.5,
            playerName: 'Tatum',
            selectedAt: '2026-03-17T00:00:00.000Z',
          },
        }) ?? null
      ).toBeNull();
      expect(
        adapter.buildSlipDestination?.({
          legs: [],
          source: 'manual',
        }) ?? null
      ).toBeNull();
    }
  });
});
