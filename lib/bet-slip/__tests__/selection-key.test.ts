import { describe, expect, it } from 'vitest';
import {
  adaptPropsExplorerOffer,
  canonicalWagerIdentity,
  type PropsExplorerOfferInput,
} from '@/lib/parlay/adapt-props-explorer-offer';
import { canonicalBetLegFromParlayOffer } from '../adapt-parlay-leg';
import {
  canonicalSelectionKey,
  hasCanonicalSelection,
  sameCanonicalSelection,
  selectionLineToken,
} from '../selection-key';

const TATUM_BASE: PropsExplorerOfferInput = {
  playerId: 1628369,
  playerName: 'Jayson Tatum',
  gameId: 'game-bos-mia-2026-03-17',
  propType: 'points',
  side: 'over',
  lineValue: 28.5,
  sportsbook: 'DraftKings',
  oddsAmerican: -110,
  marketContext: 'live',
  sourceTable: 'analytics.player_props_current',
  snapshotAt: '2026-03-17T18:00:00.000Z',
};

function mustAdapt(input: PropsExplorerOfferInput) {
  const result = adaptPropsExplorerOffer(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.offer;
}

describe('canonicalSelectionKey', () => {
  it('matches exact same selection (Tatum PTS Over 28.5)', () => {
    const a = canonicalSelectionKey({
      gameId: 'game-bos-mia-2026-03-17',
      playerId: '1628369',
      market: 'points',
      side: 'over',
      line: 28.5,
    });
    const b = canonicalSelectionKey({
      gameId: 'game-bos-mia-2026-03-17',
      playerId: '1628369',
      market: 'points',
      side: 'over',
      line: 28.5,
    });
    expect(a).toBe(b);
    expect(a).toBe('nba|game-bos-mia-2026-03-17|1628369|points|over|28.5');
  });

  it('differs by side (Over vs Under 28.5)', () => {
    const over = canonicalSelectionKey({
      gameId: 'g1',
      playerId: '1628369',
      market: 'points',
      side: 'over',
      line: 28.5,
    });
    const under = canonicalSelectionKey({
      gameId: 'g1',
      playerId: '1628369',
      market: 'points',
      side: 'under',
      line: 28.5,
    });
    expect(over).not.toBe(under);
  });

  it('differs by line (Over 28.5 vs Over 29.5)', () => {
    const a = canonicalSelectionKey({
      gameId: 'g1',
      playerId: '1628369',
      market: 'points',
      side: 'over',
      line: 28.5,
    });
    const b = canonicalSelectionKey({
      gameId: 'g1',
      playerId: '1628369',
      market: 'points',
      side: 'over',
      line: 29.5,
    });
    expect(a).not.toBe(b);
  });

  it('differs by game with same player/market/side/line', () => {
    const a = canonicalSelectionKey({
      gameId: 'game-a',
      playerId: '1628369',
      market: 'points',
      side: 'over',
      line: 28.5,
    });
    const b = canonicalSelectionKey({
      gameId: 'game-b',
      playerId: '1628369',
      market: 'points',
      side: 'over',
      line: 28.5,
    });
    expect(a).not.toBe(b);
  });

  it('ignores odds movement for selection identity', () => {
    const dkNeg110 = mustAdapt({ ...TATUM_BASE, oddsAmerican: -110 });
    const dkNeg105 = mustAdapt({ ...TATUM_BASE, oddsAmerican: -105 });
    const legA = canonicalBetLegFromParlayOffer(dkNeg110);
    const legB = canonicalBetLegFromParlayOffer(dkNeg105);
    expect(legA.selectionKey).toBe(legB.selectionKey);
    expect(sameCanonicalSelection(legA, legB)).toBe(true);
    expect(legA.selectedOdds).toBe(-110);
    expect(legB.selectedOdds).toBe(-105);
  });

  it('ignores sportsbook for selection identity (DK vs FD same line)', () => {
    const dk = mustAdapt({ ...TATUM_BASE, sportsbook: 'DraftKings', oddsAmerican: -110 });
    const fd = mustAdapt({
      ...TATUM_BASE,
      sportsbook: 'FanDuel',
      oddsAmerican: -105,
    });
    const legDk = canonicalBetLegFromParlayOffer(dk);
    const legFd = canonicalBetLegFromParlayOffer(fd);
    expect(legDk.selectionKey).toBe(legFd.selectionKey);
    expect(sameCanonicalSelection(legDk, legFd)).toBe(true);
    expect(legDk.selectedSportsbook).toBe('draftkings');
    expect(legFd.selectedSportsbook).toBe('fanduel');
  });

  it('keeps existing wagerIdentity sportsbook-distinct (two-key contract)', () => {
    const dk = mustAdapt({ ...TATUM_BASE, sportsbook: 'DraftKings' });
    const fd = mustAdapt({ ...TATUM_BASE, sportsbook: 'FanDuel' });
    expect(dk.wagerIdentity).not.toBe(fd.wagerIdentity);
    expect(dk.wagerIdentity).toBe(
      canonicalWagerIdentity({
        playerId: dk.playerId,
        gameId: dk.gameId,
        market: dk.market,
        side: dk.side,
        line: dk.line,
        sportsbookVendor: 'draftkings',
      })
    );
    expect(fd.wagerIdentity).toContain('fanduel');
    expect(dk.wagerIdentity).toContain('draftkings');

    const legDk = canonicalBetLegFromParlayOffer(dk);
    const legFd = canonicalBetLegFromParlayOffer(fd);
    expect(legDk.selectionKey).toBe(legFd.selectionKey);
  });

  it('stabilizes line token so 28.5 and Number("28.50") match', () => {
    expect(selectionLineToken(28.5)).toBe('28.5');
    expect(selectionLineToken(Number('28.50'))).toBe('28.5');
    expect(
      canonicalSelectionKey({
        gameId: 'g1',
        playerId: '1',
        market: 'points',
        side: 'over',
        line: 28.5,
      })
    ).toBe(
      canonicalSelectionKey({
        gameId: 'g1',
        playerId: '1',
        market: 'points',
        side: 'over',
        line: Number('28.50'),
      })
    );
  });

  it('hasCanonicalSelection finds by selection key across books', () => {
    const dk = canonicalBetLegFromParlayOffer(mustAdapt(TATUM_BASE));
    const fd = canonicalBetLegFromParlayOffer(
      mustAdapt({ ...TATUM_BASE, sportsbook: 'FanDuel' })
    );
    expect(hasCanonicalSelection([dk], fd)).toBe(true);
    const otherLine = canonicalBetLegFromParlayOffer(
      mustAdapt({ ...TATUM_BASE, lineValue: 29.5 })
    );
    expect(hasCanonicalSelection([dk], otherLine)).toBe(false);
  });
});
