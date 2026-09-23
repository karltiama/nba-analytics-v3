import { emptyPlayerMarketMovement } from '@/lib/betting/market-movement-api';
import {
  MOVEMENT_CLASS_API_LABEL,
  PLAYER_PROP_V1_VENDORS,
} from '@/lib/betting/market-movement';
import { PREVIEW_SNAPSHOT_AT } from './catalog';
import type { PreviewScenario } from './scenario';

function book(vendor: (typeof PLAYER_PROP_V1_VENDORS)[number], referenceLine: number, closeLine: number) {
  return {
    vendor,
    vendorLabel: vendor,
    reference: {
      line: referenceLine,
      overOdds: -110,
      underOdds: -110,
      timestamp: '2026-04-02T16:00:00.000Z',
    },
    comparison: {
      line: closeLine,
      overOdds: -125,
      underOdds: 105,
      timestamp: PREVIEW_SNAPSHOT_AT,
    },
    movement: {
      lineDelta: closeLine - referenceLine,
      overImpliedProbabilityDelta: 0.028,
      underImpliedProbabilityDelta: -0.028,
      class: MOVEMENT_CLASS_API_LABEL.C,
      classCode: 'C' as const,
    },
  };
}

export function previewMarketResponse(
  scenario: PreviewScenario,
  params: URLSearchParams
): { status: number; body: unknown } {
  if (scenario === 'error') {
    return { status: 500, body: { error: 'Failed to load market comparison' } };
  }
  const gameId = params.get('game_id') || '';
  const playerId = params.get('player_id') || '';
  const propType = params.get('prop_type') || 'points';
  const side = params.get('side') || 'over';
  const lineValue = Number(params.get('line_value') || '0');
  const sparse = scenario === 'empty' || scenario === 'partial' || playerId.endsWith('4');
  const movement = emptyPlayerMarketMovement({
    gameId,
    playerId,
    playerName: null,
    propType,
    status: sparse ? 'empty' : 'ok',
    reason: sparse ? 'no_certified_historical_snapshot' : null,
  });
  const populated = sparse
    ? movement
    : {
        ...movement,
        consensus: {
          ...movement.consensus,
          reference: { available: true, median: 24.5, min: 23.5, max: 25.5, bookCount: 2 },
          comparison: { available: true, median: 25.5, min: 24.5, max: 26.5, bookCount: 2 },
          lineDelta: 1,
        },
        books: [book('draftkings', 24.5, 25.5), book('fanduel', 24.5, 26.5)],
        coverage: {
          ...movement.coverage,
          eligibleBookCount: 2,
          booksWithMeaningfulMovement: 2,
        },
      };

  return {
    status: 200,
    body: {
      marketContext: 'live',
      lineLabel: sparse ? 'Line unavailable' : String(lineValue),
      comparisonLabel: sparse ? 'No comparison' : 'Preview board',
      paperBetAllowed: false,
      selected: {
        gameId,
        playerId,
        propType,
        sportsbook: params.get('sportsbook') || 'DraftKings',
        side: side === 'under' ? 'under' : 'over',
        lineValue: Number.isFinite(lineValue) ? lineValue : 0,
        oddsAmerican: params.get('odds_american') ? Number(params.get('odds_american')) : null,
        snapshotAt: params.get('snapshot_at'),
      },
      shopping: sparse
        ? {
            status: 'unavailable',
            reason: 'missing_shopping_data',
            message: 'Preview has no book board for this prop.',
            sourceTable: null,
            bookCount: 0,
            marketMinLine: null,
            marketMaxLine: null,
            latestSnapshotAt: null,
            bestAvailableOverLine: null,
            bestAvailableUnderLine: null,
            bestPriceAtSelectedLine: null,
            books: [],
          }
        : {
            status: 'ok',
            reason: null,
            message: null,
            sourceTable: 'ccpreview',
            bookCount: 2,
            marketMinLine: lineValue,
            marketMaxLine: lineValue + 1,
            latestSnapshotAt: PREVIEW_SNAPSHOT_AT,
            bestAvailableOverLine: {
              sportsbook: 'DraftKings',
              side: 'over',
              lineValue,
              oddsAmerican: -110,
            },
            bestAvailableUnderLine: {
              sportsbook: 'FanDuel',
              side: 'under',
              lineValue,
              oddsAmerican: -105,
            },
            bestPriceAtSelectedLine: {
              sportsbook: 'DraftKings',
              side: side === 'under' ? 'under' : 'over',
              lineValue,
              oddsAmerican: -110,
            },
            books: [
              {
                sportsbook: 'DraftKings',
                side: 'over',
                lineValue,
                oddsAmerican: -110,
                snapshotAt: PREVIEW_SNAPSHOT_AT,
              },
              {
                sportsbook: 'FanDuel',
                side: 'over',
                lineValue: lineValue + 1,
                oddsAmerican: 102,
                snapshotAt: PREVIEW_SNAPSHOT_AT,
              },
            ],
          },
      marketMovement: populated,
      entitlement: {
        plan: 'free',
        isPro: false,
        features: { line_shopping_detail: false, market_movement: false },
      },
    },
  };
}
