export type MarketOutcome =
  | 'NO_REQUEST'
  | 'REQUEST_FAILED'
  | 'NO_MARKET_POSTED'
  | 'MARKET_AVAILABLE';

export function outcomeForProviderResult(input: {
  threw: boolean;
  rowCount: number;
}): MarketOutcome {
  if (input.threw) return 'REQUEST_FAILED';
  if (input.rowCount <= 0) return 'NO_MARKET_POSTED';
  return 'MARKET_AVAILABLE';
}

export function logMarketOutcome(fields: {
  outcome: MarketOutcome;
  reason?: string;
  universe?: string | null;
  gameId?: string;
  pullRunId?: number;
  rowsFetched?: number;
}): void {
  console.log(
    JSON.stringify({
      event: 'player_prop_market_outcome',
      ...fields,
    })
  );
}

/** Coverage metric for a cycle that did not queue provider work. Never reports a fake queue. */
export function noRequestCoverage(): { GamesTargeted: number; GamesQueued: number } {
  return { GamesTargeted: 0, GamesQueued: 0 };
}

/**
 * GamesQueued is emitted only when this wave had eligible games and the queue
 * result is the coverage signal. An empty window returns null so the low-coverage
 * alarm, which treats a missing sample as not breaching, stays quiet.
 * A full dedupe also returns null: those games were already queued.
 * Eligible games with nothing queued and nothing deduped is unexpected and emits 0.
 */
export function controllerCoverageMetric(input: {
  eligibleGames: number;
  queuedGames: number;
  dedupedGames: number;
}): { GamesTargeted: number; GamesQueued: number; GamesDeduped: number } | null {
  if (input.eligibleGames <= 0) return null;
  if (input.queuedGames > 0) {
    return {
      GamesTargeted: input.eligibleGames,
      GamesQueued: input.queuedGames,
      GamesDeduped: input.dedupedGames,
    };
  }
  if (input.dedupedGames >= input.eligibleGames) return null;
  return {
    GamesTargeted: input.eligibleGames,
    GamesQueued: 0,
    GamesDeduped: input.dedupedGames,
  };
}
