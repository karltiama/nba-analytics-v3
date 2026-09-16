import type { HistoricalMovementRow, HistoricalParlayLegReplayInput } from '../types';

export const GAME = 'game-den-okc-2026-04-10';
export const JOKIC = '203999';
export const SGA = '1628983';

export function replayInput(
  partial: Partial<HistoricalParlayLegReplayInput> &
    Pick<HistoricalParlayLegReplayInput, 'market' | 'line'>
): HistoricalParlayLegReplayInput {
  return {
    historicalDate: '2026-04-10',
    playerId: JOKIC,
    playerDisplayName: 'Nikola Jokic',
    entityId: 'ent-jokic',
    gameId: GAME,
    marketUnsupported: false,
    side: 'over',
    sportsbookVendor: 'draftkings',
    playerResolved: true,
    gameResolved: true,
    ...partial,
  };
}

function row(
  partial: Partial<HistoricalMovementRow> & Pick<HistoricalMovementRow, 'prop_type' | 'vendor'>
): HistoricalMovementRow {
  return {
    game_id: GAME,
    player_id: JOKIC,
    reference_kind: '3_hour_pre_tip',
    reference_line: 27.5,
    reference_over_odds: -110,
    reference_under_odds: -110,
    reference_timestamp: '2026-04-10T20:00:00.000Z',
    comparison_kind: 'decision_close',
    comparison_line: 27.5,
    comparison_over_odds: -115,
    comparison_under_odds: -105,
    comparison_timestamp: '2026-04-10T23:50:00.000Z',
    ...partial,
  };
}

export const CORPUS: HistoricalMovementRow[] = [
  row({
    prop_type: 'points',
    vendor: 'draftkings',
    reference_line: 27.5,
    comparison_line: 28.5,
    comparison_over_odds: -120,
  }),
  row({
    prop_type: 'points',
    vendor: 'caesars',
    reference_line: 27.5,
    comparison_line: 27.5,
  }),
  row({
    prop_type: 'threes',
    vendor: 'draftkings',
    reference_line: 1.5,
    comparison_line: 1.5,
  }),
  row({
    prop_type: 'points_rebounds_assists',
    vendor: 'draftkings',
    reference_line: 47.5,
    comparison_line: 47.5,
  }),
  row({
    prop_type: 'rebounds',
    vendor: 'draftkings',
    reference_line: 12.5,
    comparison_line: null,
    comparison_over_odds: null,
    comparison_under_odds: null,
    comparison_timestamp: null,
  }),
  row({
    prop_type: 'assists',
    vendor: 'betmgm',
    reference_line: 8.5,
    comparison_line: 8.5,
  }),
  row({
    game_id: GAME,
    player_id: SGA,
    prop_type: 'points',
    vendor: 'draftkings',
    reference_line: 32.5,
    comparison_line: 32.5,
  }),
];
