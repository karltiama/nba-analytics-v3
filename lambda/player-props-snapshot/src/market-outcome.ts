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
