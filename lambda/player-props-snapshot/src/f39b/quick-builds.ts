import { buildTwoSidedMarkets, type TwoSidedMarket } from '@/lib/quick-builds/markets';
import { selectEligibleObservations, type EligibleSelection } from '@/lib/quick-builds/eligibility';
import { generateQuickBuilds } from '@/lib/quick-builds/index';
import type { PlayerPropV1Vendor } from '@/lib/betting/market-movement';
import type { MarketObservationInput, QuickBuildPolicy, QuickBuildResult } from '@/lib/quick-builds/types';
import type { CurrentBoardResponse } from './reader';

type Vendor = PlayerPropV1Vendor;

function observationsFromBoard(board: Extract<CurrentBoardResponse, { available: true }>): MarketObservationInput[] {
  return board.rows.flatMap((row) => {
    if (row.line == null || row.oddsAmerican == null) return [];
    return [{
      playerId: row.playerId,
      gameId: board.gameId,
      market: row.propType,
      side: row.side,
      line: row.line,
      sportsbook: row.sportsbook,
      oddsAmerican: row.oddsAmerican,
      pullRunId: String(board.snapshot.pullRunId),
      observedAt: board.observedAt,
      observationClock: 'RESPONSE_RECEIVED' as const,
    }];
  });
}

/**
 * Feeds one verified current board into the existing Quick Builds selectors.
 * A missing price or player id is omitted. The two-leg generator is unchanged
 * and still requires a second game.
 */
export function evaluateCurrentQuickBuilds(args: {
  board: CurrentBoardResponse;
  sportsbook: Vendor;
  policy: QuickBuildPolicy;
  gameStartTime: string;
  gameStatus: string;
}): {
  selection: EligibleSelection | null;
  markets: TwoSidedMarket[];
  generator: QuickBuildResult | null;
} {
  if (!args.board.available) return { selection: null, markets: [], generator: null };
  const observations = observationsFromBoard(args.board);
  const selection = selectEligibleObservations({
    policy: args.policy,
    games: [{ gameId: args.board.gameId, startTime: args.gameStartTime, status: args.gameStatus }],
    attempts: [{
      pullRunId: String(args.board.snapshot.pullRunId),
      gameId: args.board.gameId,
      status: 'success',
      rowsStored: observations.length,
      completedAt: args.board.observedAt,
      observationClock: 'RESPONSE_RECEIVED',
    }],
    observations,
  });
  const kept = selection.observations;
  const markets = buildTwoSidedMarkets({
    observations: kept,
    sportsbook: args.sportsbook,
    asOfMs: selection.asOfMs,
  });
  const generator = generateQuickBuilds({
    sportsbook: args.sportsbook,
    range: { minAmerican: -200, maxAmerican: 200 },
    policy: args.policy,
    games: [{ gameId: args.board.gameId, startTime: args.gameStartTime, status: args.gameStatus }],
    attempts: [{
      pullRunId: String(args.board.snapshot.pullRunId),
      gameId: args.board.gameId,
      status: 'success',
      rowsStored: observations.length,
      completedAt: args.board.observedAt,
      observationClock: 'RESPONSE_RECEIVED',
    }],
    observations: kept,
  });
  return { selection, markets, generator };
}
