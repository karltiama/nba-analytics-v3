import { beforeEach, describe, expect, it } from 'vitest';
import { adaptPropsExplorerOffer, type PropsExplorerOfferInput } from '../adapt-props-explorer-offer';
import {
  addExplorerOfferToSelection,
  canonicalParlaySelectionFromLegs,
  emptyParlaySelection,
  removeSelectedLeg,
  snapshotDisplayLabel,
  summarizeCanonicalSelection,
} from '../selection';
import {
  getCanonicalParlaySelection,
  getExplorerReturnHref,
  getParlaySelectionLegs,
  rememberExplorerReturnHref,
  replaceParlaySelectionLegs,
  resetParlaySelectionStoreForTests,
} from '../selection-store';

const JOKIC_DK: PropsExplorerOfferInput = {
  playerId: 203999,
  playerName: 'Nikola Jokic',
  gameId: 'game-den-okc-2026-03-17',
  propType: 'points',
  side: 'over',
  lineValue: 27.5,
  sportsbook: 'DraftKings',
  oddsAmerican: -110,
  snapshotAt: '2026-03-17T16:50:00.000Z',
  marketContext: 'historical',
  sourceTable: 'research.prop_decision_lines',
};

function addToStore(input: PropsExplorerOfferInput, gameLabel = 'OKC vs DEN') {
  const result = addExplorerOfferToSelection(getParlaySelectionLegs(), input, { gameLabel });
  expect(result.status).toBe('added');
  if (result.status !== 'added') throw new Error(result.status);
  replaceParlaySelectionLegs(result.legs);
  return result.legs;
}

function identityOf(input: PropsExplorerOfferInput) {
  const adapted = adaptPropsExplorerOffer(input);
  expect(adapted.ok).toBe(true);
  if (!adapted.ok) throw new Error(adapted.code);
  return adapted.offer;
}

describe('cross-route parlay selection store', () => {
  beforeEach(() => {
    resetParlaySelectionStoreForTests();
  });

  it('starts empty for a direct Workspace visit', () => {
    expect(getParlaySelectionLegs()).toEqual([]);
    expect(getCanonicalParlaySelection()).toEqual({
      legs: [],
      sourceContext: 'props_explorer',
    });
  });

  it('hands off one selected offer with exact canonical identity', () => {
    const expected = identityOf(JOKIC_DK);
    addToStore(JOKIC_DK);
    const afterNav = getCanonicalParlaySelection();
    expect(afterNav.legs).toHaveLength(1);
    expect(afterNav.sourceContext).toBe('props_explorer');
    const offer = afterNav.legs[0]?.offer;
    expect(offer).toMatchObject({
      playerId: expected.playerId,
      gameId: expected.gameId,
      market: expected.market,
      side: expected.side,
      line: expected.line,
      sportsbook: expected.sportsbook,
      oddsAmerican: expected.oddsAmerican,
      snapshotKind: 'decision_close',
      snapshotAt: expected.snapshotAt,
      source: 'props_explorer',
      sourceProvenance: 'selected_canonical_offer',
      offerIdentity: expected.offerIdentity,
    });
    expect(snapshotDisplayLabel(offer!.snapshotKind)).toBe('Decision Close');
  });

  it('preserves identity across a Workspace → Explorer → Workspace loop', () => {
    addToStore(JOKIC_DK);
    const first = getParlaySelectionLegs()[0]?.offer.offerIdentity;
    addToStore({ ...JOKIC_DK, propType: 'rebounds', lineValue: 12.5 });
    const roundtrip = getParlaySelectionLegs();
    expect(roundtrip).toHaveLength(2);
    expect(roundtrip[0]?.offer.offerIdentity).toBe(first);
    expect(roundtrip[1]?.offer.market).toBe('rebounds');
    expect(roundtrip[1]?.offer.line).toBe(12.5);
  });

  it('hands off four, eight, and twelve legs without identity loss', () => {
    for (const count of [4, 8, 12]) {
      resetParlaySelectionStoreForTests();
      for (let i = 0; i < count; i += 1) {
        addToStore({
          ...JOKIC_DK,
          playerId: 200000 + i,
          playerName: `Player ${i}`,
          lineValue: 10.5 + i,
        });
      }
      const selection = getCanonicalParlaySelection();
      expect(selection.legs).toHaveLength(count);
      expect(new Set(selection.legs.map((leg) => leg.offer.offerIdentity)).size).toBe(count);
    }
  });

  it('removes only the matching offer when two same-player markets are selected', () => {
    addToStore({ ...JOKIC_DK, propType: 'points' });
    addToStore({ ...JOKIC_DK, propType: 'rebounds', lineValue: 12.5 });
    const ptsId = getParlaySelectionLegs()[0]?.offer.offerIdentity;
    expect(ptsId).toBeTruthy();
    replaceParlaySelectionLegs(removeSelectedLeg(getParlaySelectionLegs(), ptsId!));
    const remaining = getParlaySelectionLegs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.offer.market).toBe('rebounds');
    expect(remaining[0]?.offer.playerId).toBe('203999');
  });

  it('clears the store for both Workspace and Explorer', () => {
    addToStore(JOKIC_DK);
    replaceParlaySelectionLegs(emptyParlaySelection());
    expect(getParlaySelectionLegs()).toEqual([]);
  });

  it('dedupes corrupted duplicate offerIdentity rows', () => {
    addToStore(JOKIC_DK);
    const clone = getParlaySelectionLegs()[0]!;
    replaceParlaySelectionLegs([clone, clone]);
    expect(getParlaySelectionLegs()).toHaveLength(1);
  });

  it('treats a hard-refresh reset as an empty Workspace', () => {
    addToStore(JOKIC_DK);
    resetParlaySelectionStoreForTests();
    expect(getCanonicalParlaySelection().legs).toEqual([]);
  });

  it('remembers an Explorer return href without encoding wagers', () => {
    rememberExplorerReturnHref('/betting/props-explorer?date=2026-03-17');
    expect(getExplorerReturnHref()).toBe('/betting/props-explorer?date=2026-03-17');
    rememberExplorerReturnHref('/parlay-workspace?player=jokic');
    expect(getExplorerReturnHref()).toBe('/betting/props-explorer');
  });

  it('summarizes same-player grouping without calling it correlation', () => {
    addToStore({ ...JOKIC_DK, propType: 'points' });
    addToStore({ ...JOKIC_DK, propType: 'rebounds', lineValue: 12.5 });
    const summary = summarizeCanonicalSelection(getParlaySelectionLegs());
    expect(summary.legCount).toBe(2);
    expect(summary.samePlayerLegCount).toBe(2);
    expect(summary.labels).toContain('Same player');
    expect(JSON.stringify(summary)).not.toMatch(/correlat/i);
  });

  it('builds a source-neutral container without persistence ids', () => {
    addToStore(JOKIC_DK);
    const container = canonicalParlaySelectionFromLegs(getParlaySelectionLegs());
    expect(container).not.toHaveProperty('id');
    expect(container).not.toHaveProperty('savedParlayId');
    expect(container.sourceContext).toBe('props_explorer');
  });
});
