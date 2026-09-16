import { describe, expect, it } from 'vitest';
import { adaptPropsExplorerOffer, type PropsExplorerOfferInput } from '../adapt-props-explorer-offer';
import {
  ADAPTER_ADD_COPY,
  PARLAY_SELECTION_SOFT_CAP,
  addExplorerOfferToSelection,
  addResultNotice,
  clearSelectedLegs,
  emptyParlaySelection,
  isOfferSelected,
  previewParlaySelection,
  removeSelectedLeg,
} from '../selection';

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

function added(input: PropsExplorerOfferInput, gameLabel = 'OKC vs DEN') {
  const result = addExplorerOfferToSelection(emptyParlaySelection(), input, { gameLabel });
  expect(result.status).toBe('added');
  if (result.status !== 'added') throw new Error(result.status);
  return result.legs;
}

describe('transient parlay selection', () => {
  it('starts empty', () => {
    const legs = emptyParlaySelection();
    expect(legs).toEqual([]);
    expect(previewParlaySelection(legs).summary).toBe('');
    expect(isOfferSelected(legs, JOKIC_DK)).toBe(false);
  });

  it('adds one Explorer offer through the certified E1 adapter', () => {
    const adapted = adaptPropsExplorerOffer(JOKIC_DK);
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    const legs = added(JOKIC_DK);
    expect(legs).toHaveLength(1);
    expect(legs[0]?.offer.offerIdentity).toBe(adapted.offer.offerIdentity);
    expect(legs[0]?.offer.line).toBe(27.5);
    expect(legs[0]?.offer.sportsbook.vendor).toBe('draftkings');
    expect(legs[0]?.offer.snapshotKind).toBe('decision_close');
    expect(legs[0]?.offer.source).toBe('props_explorer');
    expect(isOfferSelected(legs, JOKIC_DK)).toBe(true);
  });

  it('does not add a failed adapter result', () => {
    const result = addExplorerOfferToSelection(emptyParlaySelection(), {
      ...JOKIC_DK,
      propType: 'turnovers',
    });
    expect(result).toEqual({
      status: 'rejected',
      legs: [],
      code: 'UNSUPPORTED_MARKET',
    });
    expect(addResultNotice(result)).toBe(ADAPTER_ADD_COPY.UNSUPPORTED_MARKET);
  });

  it('preserves historical decision_close and ignores 3-Hour comparison fields', () => {
    const result = addExplorerOfferToSelection(emptyParlaySelection(), {
      ...JOKIC_DK,
      lineValue: 12.5,
      threeHourLine: 11.5,
    } as PropsExplorerOfferInput & { threeHourLine: number });
    expect(result.status).toBe('added');
    if (result.status !== 'added') return;
    expect(result.legs[0]?.offer.line).toBe(12.5);
    expect(result.legs[0]?.offer.snapshotKind).toBe('decision_close');
    expect(result.legs[0]?.offer.line).not.toBe(11.5);
  });

  it('prevents adding the exact same offer twice', () => {
    const once = added(JOKIC_DK);
    const twice = addExplorerOfferToSelection(once, JOKIC_DK);
    expect(twice.status).toBe('duplicate');
    expect(twice.legs).toHaveLength(1);
    expect(addResultNotice(twice)).toBe('Already added');
  });

  it('keeps DraftKings 27.5 and FanDuel 28.5 distinct', () => {
    const dk = added({ ...JOKIC_DK, sportsbook: 'DraftKings', lineValue: 27.5 });
    const both = addExplorerOfferToSelection(dk, {
      ...JOKIC_DK,
      sportsbook: 'FanDuel',
      lineValue: 28.5,
    });
    expect(both.status).toBe('added');
    expect(both.legs).toHaveLength(2);
  });

  it('keeps Over and Under distinct', () => {
    const over = added({ ...JOKIC_DK, side: 'over' });
    const both = addExplorerOfferToSelection(over, { ...JOKIC_DK, side: 'under' });
    expect(both.status).toBe('added');
    expect(both.legs).toHaveLength(2);
  });

  it('allows same player with different markets', () => {
    const pts = added({ ...JOKIC_DK, propType: 'points', lineValue: 27.5 });
    const reb = addExplorerOfferToSelection(pts, {
      ...JOKIC_DK,
      propType: 'rebounds',
      lineValue: 12.5,
    });
    expect(reb.status).toBe('added');
    expect(reb.legs).toHaveLength(2);
    const preview = previewParlaySelection(reb.legs);
    expect(preview.samePlayer).toBe(true);
    expect(preview.labels).toContain('Same player');
    expect(preview.labels.join(' ')).not.toMatch(/correlat/i);
  });

  it('removes only the matching offer identity', () => {
    const pts = added({ ...JOKIC_DK, propType: 'points' });
    const both = addExplorerOfferToSelection(pts, {
      ...JOKIC_DK,
      propType: 'rebounds',
      lineValue: 12.5,
    });
    expect(both.status).toBe('added');
    const ptsId = both.legs[0]?.offer.offerIdentity;
    expect(ptsId).toBeTruthy();
    const remaining = removeSelectedLeg(both.legs, ptsId!);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.offer.market).toBe('rebounds');
  });

  it('clears the entire selection', () => {
    const legs = added(JOKIC_DK);
    expect(clearSelectedLegs()).toEqual([]);
    expect(legs).toHaveLength(1);
  });

  it('summarizes a shared game without calling it correlation', () => {
    const first = added(JOKIC_DK, 'OKC vs DEN');
    const second = addExplorerOfferToSelection(
      first,
      { ...JOKIC_DK, playerId: 203507, playerName: 'Giannis Antetokounmpo', propType: 'rebounds', lineValue: 8.5 },
      { gameLabel: 'OKC vs DEN' }
    );
    expect(second.status).toBe('added');
    const preview = previewParlaySelection(second.legs);
    expect(preview.sameGame).toBe(true);
    expect(preview.summary).toBe('2 legs · OKC vs DEN');
    expect(preview.labels).toContain('Same game');
    expect(JSON.stringify(preview)).not.toMatch(/correlat/i);
  });

  it.each([1, 4, 8, 12])('holds %s selected legs', (count) => {
    let legs = emptyParlaySelection();
    for (let i = 0; i < count; i += 1) {
      const result = addExplorerOfferToSelection(
        legs,
        {
          ...JOKIC_DK,
          playerId: 200000 + i,
          playerName: `Player ${i}`,
          lineValue: 10.5 + i,
        },
        { gameLabel: 'LAL @ OKC' }
      );
      expect(result.status).toBe('added');
      legs = result.legs;
    }
    expect(legs).toHaveLength(count);
    expect(previewParlaySelection(legs).summary).toContain(String(count));
  });

  it('does not add past the explicit 12-leg development ceiling', () => {
    let legs = emptyParlaySelection();
    for (let i = 0; i < PARLAY_SELECTION_SOFT_CAP; i += 1) {
      const result = addExplorerOfferToSelection(legs, {
        ...JOKIC_DK,
        playerId: 300000 + i,
        lineValue: 5.5 + i,
      });
      expect(result.status).toBe('added');
      legs = result.legs;
    }
    const overflow = addExplorerOfferToSelection(legs, {
      ...JOKIC_DK,
      playerId: 399999,
      lineValue: 40.5,
    });
    expect(overflow.status).toBe('cap');
    expect(overflow.legs).toHaveLength(12);
    expect(addResultNotice(overflow)).toMatch(/12-leg development ceiling/);
  });
});
