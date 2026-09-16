import { describe, expect, it } from 'vitest';
import { matchHistoricalParlayLeg } from '../match';
import { CORPUS, GAME, JOKIC, replayInput } from './fixtures';
import { resolveCanonicalParlayLeg } from '@/lib/parlay-xray/resolution/resolve-leg';
import { replayInputFromResolution } from '../types';
import { CATALOG, extractedLeg } from '@/lib/parlay-xray/resolution/__tests__/fixtures';

describe('matchHistoricalParlayLeg', () => {
  it('matches exact player/game/market/line/book and reports both snapshots', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'threes', line: 1.5 }),
      CORPUS
    );
    expect(match.status).toBe('MATCHED');
    expect(match.lineQuality).toBe('EXACT_LINE_MATCH');
    expect(match.exactness).toMatchObject({
      playerExact: true,
      gameExact: true,
      marketExact: true,
      lineExact: true,
      bookExact: true,
      snapshotAvailable: { threeHourPreTip: true, decisionClose: true },
    });
    expect(match.reference.kind).toBe('3_hour_pre_tip');
    expect(match.reference.label).toBe('3-Hour Pre-Tip');
    expect(match.comparison.kind).toBe('decision_close');
    expect(match.comparison.label).toBe('Decision Close');
    expect(match.matchedVendor).toBe('draftkings');
    expect(match.reference.line).toBe(1.5);
    expect(match.comparison.line).toBe(1.5);
  });

  it('does not treat a different historical line as exact', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'points', line: 27.5 }),
      CORPUS
    );
    expect(match.status).toBe('MATCHED');
    expect(match.lineQuality).toBe('EXACT_LINE_MATCH');
    expect(match.reference.line).toBe(27.5);
    expect(match.comparison.line).toBe(28.5);

    const moved = matchHistoricalParlayLeg(
      replayInput({ market: 'points', line: 29.5 }),
      CORPUS
    );
    expect(moved.status).toBe('PARTIAL_MATCH');
    expect(moved.lineQuality).toBe('MARKET_MATCH_DIFFERENT_LINE');
    expect(moved.exactness.lineExact).toBe(false);
    expect(moved.exactness.bookExact).toBe(true);
    expect(moved.reason).toBe('DIFFERENT_LINE');
  });

  it('returns partial match when the requested book is missing', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'points', line: 27.5, sportsbookVendor: 'fanduel' }),
      CORPUS
    );
    expect(match.status).toBe('PARTIAL_MATCH');
    expect(match.reason).toBe('BOOK_UNAVAILABLE');
    expect(match.exactness.bookExact).toBe(false);
    expect(match.matchedVendor).toBeNull();
    expect(match.availableBooks.map((b) => b.vendor).sort()).toEqual(['caesars', 'draftkings']);
    expect(match.reference.available).toBe(false);
  });

  it('does not pick a book when sportsbook is unknown', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'points', line: 27.5, sportsbookVendor: null }),
      CORPUS
    );
    expect(match.status).toBe('PARTIAL_MATCH');
    expect(match.reason).toBe('BOOK_UNKNOWN');
    expect(match.exactness.bookExact).toBe(false);
    expect(match.matchedVendor).toBeNull();
    expect(match.availableBooks.length).toBeGreaterThanOrEqual(2);
  });

  it('reports a missing decision-close snapshot without backfilling from 3-hour', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'rebounds', line: 12.5 }),
      CORPUS
    );
    expect(match.status).toBe('MATCHED');
    expect(match.reference.available).toBe(true);
    expect(match.reference.line).toBe(12.5);
    expect(match.comparison.available).toBe(false);
    expect(match.comparison.line).toBeNull();
    expect(match.exactness.snapshotAvailable.decisionClose).toBe(false);
  });

  it('matches a combo prop on the canonical PRA id', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'points_rebounds_assists', line: 47.5 }),
      CORPUS
    );
    expect(match.status).toBe('MATCHED');
    expect(match.reference.line).toBe(47.5);
  });

  it('does not remap unsupported markets to points', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'rebounds_assists', line: 20.5, marketUnsupported: false }),
      CORPUS
    );
    expect(match.status).toBe('NO_MATCH');
    expect(match.reason).toBe('UNSUPPORTED_MARKET');
    expect(match.lineQuality).toBe('NO_MARKET_MATCH');
  });

  it('does not guess a game when the canonical game is unresolved', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'points', line: 27.5, gameId: null, gameResolved: false }),
      CORPUS
    );
    expect(match.status).toBe('NEEDS_CONFIRMATION');
    expect(match.reason).toBe('GAME_UNRESOLVED');
    expect(match.matchedVendor).toBeNull();
  });

  it('does not guess a player when identity is unresolved', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({
        market: 'points',
        line: 27.5,
        playerId: null,
        playerResolved: false,
      }),
      CORPUS
    );
    expect(match.status).toBe('NO_MATCH');
    expect(match.reason).toBe('PLAYER_UNRESOLVED');
  });

  it('returns no match when the market is absent for that player/game', () => {
    const match = matchHistoricalParlayLeg(
      replayInput({ market: 'points_assists', line: 35.5 }),
      CORPUS
    );
    expect(match.status).toBe('NO_MATCH');
    expect(match.reason).toBe('NO_MARKET_MATCH');
  });

  it('does not invent a 3-hour snapshot from close', () => {
    const closeOnly: typeof CORPUS = [
      {
        ...CORPUS[0]!,
        reference_line: null,
        reference_over_odds: null,
        reference_under_odds: null,
        reference_timestamp: null,
        comparison_line: 28.5,
      },
    ];
    const match = matchHistoricalParlayLeg(replayInput({ market: 'points', line: 28.5 }), closeOnly);
    expect(match.reference.available).toBe(false);
    expect(match.reference.line).toBeNull();
    expect(match.comparison.available).toBe(true);
    expect(match.comparison.line).toBe(28.5);
  });
});

describe('replayInputFromResolution', () => {
  it('copies canonical ids without re-running name fuzzy matching', () => {
    const resolution = resolveCanonicalParlayLeg(
      extractedLeg({
        player: 'Nikola Jokic',
        team: 'DEN',
        opponent: 'OKC',
        matchup: 'DEN vs OKC',
        market: 'points',
        side: 'over',
        line: 27.5,
        sportsbook: 'DraftKings',
        gameDate: '2026-03-17',
      }),
      CATALOG
    );
    const input = replayInputFromResolution(resolution, '2026-03-17');
    expect(input.playerId).toBe('203999');
    expect(input.gameId).toBe('game-den-okc-2026-03-17');
    expect(input.market).toBe('points');
    expect(input.sportsbookVendor).toBe('draftkings');
    expect(input.playerResolved).toBe(true);
    expect(input.gameResolved).toBe(true);
    expect(GAME.length).toBeGreaterThan(0);
    expect(JOKIC).toBe('203999');
  });
});
