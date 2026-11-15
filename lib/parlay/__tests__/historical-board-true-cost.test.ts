import { describe, expect, it } from 'vitest';
import { adaptPropsExplorerOffer } from '../adapt-props-explorer-offer';
import type { SelectedParlayLeg } from '../selection';
import { quotesForLegs } from '../true-cost-quotes';
import { buildWorkspaceTrueCost, savedOfferTrueCostInput } from '../true-cost-presentation';

const OFFERED = -110;
const CLOSING = -130;

function historicalLeg(line = 27.5): SelectedParlayLeg {
  const adapted = adaptPropsExplorerOffer({
    playerId: '203999',
    playerName: 'Nikola Jokic',
    gameId: '21718012',
    propType: 'points',
    side: 'over',
    lineValue: line,
    sportsbook: 'DraftKings',
    oddsAmerican: OFFERED,
    snapshotAt: '2026-11-01T23:00:00.000Z',
    marketContext: 'historical',
    sourceTable: 'research.prop_decision_lines',
  });
  if (!adapted.ok) throw new Error(adapted.code);
  return { offer: adapted.offer, gameLabel: 'DEN vs OKC' };
}

describe('historical true cost after the current board loses the 95 games', () => {
  it('keeps the saved offered price when the board still has the opposite side', () => {
    const leg = historicalLeg();
    const view = buildWorkspaceTrueCost([leg], [[
      { vendor: 'draftkings', displayName: 'DraftKings', priceAmerican: -125, oppositeAmerican: -105 },
    ]]);
    expect(view.result.legs[0]?.priceAmerican).toBe(OFFERED);
    expect(view.result.legs[0]?.oppositeAmerican).toBe(-105);
    expect(view.result.book.status).toBe('known');
  });

  it('keeps the saved price and marks fair odds unavailable when the board quote is gone', () => {
    const leg = historicalLeg();
    const view = buildWorkspaceTrueCost([leg], [[]]);
    expect(view.result.legs[0]?.priceAmerican).toBe(OFFERED);
    expect(view.result.legs[0]?.fair).toEqual({ status: 'unknown', reason: 'MISSING_OPPOSITE_SIDE' });
    expect(view.result.book.status).toBe('known');
    expect(savedOfferTrueCostInput(leg, null).priceAmerican).toBe(OFFERED);
  });

  it('does not adopt a research close at a different line', () => {
    const leg = historicalLeg(27.5);
    const researchClose = quotesForLegs(
      [{ gameId: leg.offer.gameId, playerId: leg.offer.playerId, market: 'points', side: 'over', line: 27.5 }],
      [{
        game_id: leg.offer.gameId,
        player_id: leg.offer.playerId,
        sportsbook: 'DraftKings',
        prop_type: 'points',
        side: 'over',
        line_value: 24.5,
        odds_american: CLOSING,
      }]
    );
    expect(researchClose[0]).toEqual([]);
    const view = buildWorkspaceTrueCost([leg], researchClose);
    expect(view.result.legs[0]?.priceAmerican).toBe(OFFERED);
    expect(view.result.legs[0]?.priceAmerican).not.toBe(CLOSING);
    expect(view.result.legs[0]?.fair).toEqual({ status: 'unknown', reason: 'MISSING_OPPOSITE_SIDE' });
  });

  it('still prices an open-slate leg from a current-board quote', () => {
    const quotes = quotesForLegs(
      [{ gameId: '21718103', playerId: '1', market: 'points', side: 'over', line: 20.5 }],
      [{
        game_id: '21718103',
        player_id: '1',
        sportsbook: 'DraftKings',
        prop_type: 'points',
        side: 'over',
        line_value: 20.5,
        odds_american: -115,
      }, {
        game_id: '21718103',
        player_id: '1',
        sportsbook: 'DraftKings',
        prop_type: 'points',
        side: 'under',
        line_value: 20.5,
        odds_american: -105,
      }]
    );
    expect(quotes[0]?.[0]).toMatchObject({ vendor: 'draftkings', priceAmerican: -115, oppositeAmerican: -105 });
  });
});
