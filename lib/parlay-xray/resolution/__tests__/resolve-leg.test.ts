import { describe, expect, it } from 'vitest';
import { resolveCanonicalParlayLeg, resolveCanonicalParlayLegs } from '../resolve-leg';
import { CATALOG, extractedLeg } from './fixtures';

describe('resolveCanonicalParlayLeg', () => {
  it('does not rewrite extracted OCR when proposing Jokic', () => {
    const leg = extractedLeg({
      player: 'Jockic',
      team: 'DEN',
      opponent: 'OKC',
      matchup: 'DEN vs OKC',
      market: 'points',
      marketLabel: 'Points',
      side: 'over',
      line: 27.5,
      sportsbook: 'DraftKings',
      gameDate: '2026-03-17',
    });
    const frozen = leg.playerDisplayName.value;
    const resolved = resolveCanonicalParlayLeg(leg, CATALOG);
    expect(frozen).toBe('Jockic');
    expect(resolved.originalLeg.playerDisplayName.value).toBe('Jockic');
    expect(leg.playerDisplayName.value).toBe('Jockic');
    expect(resolved.playerResolution.status).toBe('NEEDS_CONFIRMATION');
    expect(resolved.playerResolution.candidates[0]?.displayName).toBe('Nikola Jokic');
    expect(resolved.coreResolved).toBe(false);
    expect(resolved.overallStatus).toBe('NEEDS_CONFIRMATION');
  });

  it('fully resolves a clean player + date + matchup core', () => {
    const resolved = resolveCanonicalParlayLeg(
      extractedLeg({
        player: 'Nikola Jokic',
        team: 'DEN',
        opponent: 'OKC',
        matchup: 'DEN vs OKC',
        market: 'points',
        marketLabel: 'Points',
        side: 'over',
        line: 27.5,
        sportsbook: 'FanDuel',
        gameDate: '2026-03-17',
      }),
      CATALOG
    );
    expect(resolved.playerResolution.status).toBe('RESOLVED');
    expect(resolved.marketResolution.value?.propType).toBe('points');
    expect(resolved.sideResolution.value).toBe('over');
    expect(resolved.lineResolution.value).toBe(27.5);
    expect(resolved.gameResolution.status).toBe('RESOLVED');
    expect(resolved.sportsbookResolution.value?.vendor).toBe('fanduel');
    expect(resolved.coreResolved).toBe(true);
    expect(resolved.fullyResolved).toBe(true);
    expect(resolved.overallStatus).toBe('FULLY_RESOLVED');
  });

  it('keeps player resolved and game unresolved without a date', () => {
    const resolved = resolveCanonicalParlayLeg(
      extractedLeg({
        player: 'Giannis Antetokounmpo',
        team: 'MIL',
        opponent: 'MIA',
        matchup: 'MIL vs MIA',
        market: 'rebounds',
        side: 'over',
        line: 8.5,
      }),
      CATALOG
    );
    expect(resolved.playerResolution.status).toBe('RESOLVED');
    expect(resolved.gameResolution.status).toBe('UNRESOLVED');
    expect(resolved.coreResolved).toBe(true);
    expect(resolved.fullyResolved).toBe(false);
    expect(resolved.overallStatus).toBe('CORE_RESOLVED');
  });

  it('resolves the same player independently across two markets', () => {
    const legs = resolveCanonicalParlayLegs(
      [
        extractedLeg({
          id: 'pts',
          player: 'Giannis Antetokounmpo',
          market: 'points',
          marketLabel: 'Points',
          side: 'over',
          line: 27.5,
        }),
        extractedLeg({
          id: 'reb',
          player: 'Giannis Antetokounmpo',
          market: 'rebounds',
          marketLabel: 'Rebounds',
          side: 'over',
          line: 8.5,
        }),
      ],
      CATALOG
    );
    expect(legs[0]?.playerResolution.value?.playerId).toBe(legs[1]?.playerResolution.value?.playerId);
    expect(legs[0]?.marketResolution.value?.propType).toBe('points');
    expect(legs[1]?.marketResolution.value?.propType).toBe('rebounds');
  });

  it('does not coerce an unsupported market into points', () => {
    const resolved = resolveCanonicalParlayLeg(
      extractedLeg({
        player: 'Jayson Tatum',
        market: 'other',
        marketLabel: 'First Basket',
        side: 'over',
        line: 0.5,
      }),
      CATALOG
    );
    expect(resolved.marketResolution.status).toBe('UNRESOLVED');
    expect(resolved.marketResolution.unsupported).toBe(true);
    expect(resolved.marketResolution.extracted).toBe('First Basket');
    expect(resolved.coreResolved).toBe(false);
  });

  it('does not let a missing sportsbook block a core resolution', () => {
    const resolved = resolveCanonicalParlayLeg(
      extractedLeg({
        player: 'Bam Adebayo',
        market: 'rebounds',
        side: 'under',
        line: 5.5,
      }),
      CATALOG
    );
    expect(resolved.sportsbookResolution.status).toBe('UNRESOLVED');
    expect(resolved.sideResolution.value).toBe('under');
    expect(resolved.coreResolved).toBe(true);
  });

  it('does not infer a missing side', () => {
    const resolved = resolveCanonicalParlayLeg(
      extractedLeg({
        player: 'Luka Doncic',
        market: 'assists',
        line: 7.5,
      }),
      CATALOG
    );
    expect(resolved.sideResolution.status).toBe('UNRESOLVED');
    expect(resolved.coreResolved).toBe(false);
  });

  it('uses caller slate date, not an implicit current game', () => {
    const resolved = resolveCanonicalParlayLeg(
      extractedLeg({
        player: 'Nikola Jokic',
        team: 'DEN',
        opponent: 'OKC',
        matchup: 'DEN vs OKC',
        market: 'points',
        side: 'over',
        line: 27.5,
      }),
      CATALOG,
      { asOfDate: '2025-04-01' }
    );
    expect(resolved.gameResolution.value?.gameId).toBe('game-den-okc-2025-04-01');
  });
});
