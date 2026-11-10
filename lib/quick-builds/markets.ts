/**
 * Turns eligible observations into two-sided markets.
 * A side without its opposite, or with an unusable price, does not become a leg.
 */

import { combinedDecimal } from '@/lib/parlay/true-cost';
import { noVigProbability, rawImpliedProbFromMoneyline } from '@/lib/betting/market-probability';
import { parseLineValue, parsePropSide } from '@/lib/betting/prop-market-compare';
import { canonicalizeXrayMarket } from '@/lib/parlay-xray/resolution/market';
import { canonicalizeSportsbook } from '@/lib/parlay-xray/resolution/sportsbook';
import type { CanonicalPropType, PlayerPropV1Vendor } from '@/lib/betting/market-movement';
import { QUICK_BUILD_MAX_TWO_SIDED_MARKETS, QuickBuildInputError, type MarketObservationInput } from './types';

export type SideQuote = {
  playerId: string;
  gameId: string;
  market: CanonicalPropType;
  side: 'over' | 'under';
  line: number;
  sportsbook: PlayerPropV1Vendor;
  oddsAmerican: number;
  oppositeAmerican: number;
  noVigProbability: number;
  pullRunId: string;
  observedAt: string;
  ageMs: number;
};

export type TwoSidedMarket = {
  key: string;
  over: SideQuote;
  under: SideQuote;
};

export function usableAmerican(price: number | null | undefined): number | null {
  if (combinedDecimal([price]) == null) return null;
  return price as number;
}

function marketKey(quote: {
  playerId: string;
  gameId: string;
  market: string;
  line: number;
  sportsbook: string;
  pullRunId: string;
}): string {
  return [quote.pullRunId, quote.gameId, quote.playerId, quote.market, String(quote.line), quote.sportsbook].join('|');
}

type PendingSide = {
  playerId: string;
  gameId: string;
  market: CanonicalPropType;
  side: 'over' | 'under';
  line: number;
  sportsbook: PlayerPropV1Vendor;
  oddsAmerican: number;
  pullRunId: string;
  observedAt: string;
  ageMs: number;
};

export function buildTwoSidedMarkets(input: {
  observations: MarketObservationInput[];
  sportsbook: PlayerPropV1Vendor;
  asOfMs: number;
}): TwoSidedMarket[] {
  const pending = new Map<string, { over?: PendingSide; under?: PendingSide; conflict: boolean }>();

  for (const row of input.observations) {
    const playerId = row.playerId.trim();
    const gameId = row.gameId.trim();
    const pullRunId = row.pullRunId.trim();
    if (!playerId || !gameId || !pullRunId) continue;
    const book = canonicalizeSportsbook(row.sportsbook);
    if (!book || book.vendor !== input.sportsbook) continue;
    const market = canonicalizeXrayMarket(null, row.market);
    if (!market.propType) continue;
    const side = parsePropSide(row.side);
    if (!side) continue;
    const line = parseLineValue(row.line);
    if (line == null) continue;
    const price = usableAmerican(row.oddsAmerican);
    if (price == null || row.observedAt == null) continue;
    const observedMs = Date.parse(row.observedAt);
    if (!Number.isFinite(observedMs)) continue;

    const draft: PendingSide = {
      playerId,
      gameId,
      market: market.propType,
      side,
      line,
      sportsbook: book.vendor,
      oddsAmerican: price,
      pullRunId,
      observedAt: new Date(observedMs).toISOString(),
      ageMs: input.asOfMs - observedMs,
    };
    const key = marketKey(draft);
    const cell = pending.get(key) ?? { conflict: false };
    const previous = cell[side];
    if (previous && previous.oddsAmerican !== draft.oddsAmerican) {
      cell.conflict = true;
    } else if (!previous) {
      cell[side] = draft;
    }
    pending.set(key, cell);
  }

  const markets: TwoSidedMarket[] = [];
  for (const [key, cell] of pending) {
    if (cell.conflict || !cell.over || !cell.under) continue;
    const overImplied = rawImpliedProbFromMoneyline(cell.over.oddsAmerican);
    const underImplied = rawImpliedProbFromMoneyline(cell.under.oddsAmerican);
    const overNoVig = noVigProbability(overImplied, underImplied);
    const underNoVig = noVigProbability(underImplied, overImplied);
    if (overNoVig == null || underNoVig == null) continue;
    const over: SideQuote = {
      ...cell.over,
      oppositeAmerican: cell.under.oddsAmerican,
      noVigProbability: overNoVig,
    };
    const under: SideQuote = {
      ...cell.under,
      oppositeAmerican: cell.over.oddsAmerican,
      noVigProbability: underNoVig,
    };
    markets.push({ key, over, under });
  }

  if (markets.length > QUICK_BUILD_MAX_TWO_SIDED_MARKETS) {
    throw new QuickBuildInputError(
      'LIMIT_EXCEEDED',
      `two-sided markets exceed ${QUICK_BUILD_MAX_TWO_SIDED_MARKETS}`
    );
  }

  markets.sort((a, b) => a.key.localeCompare(b.key));
  return markets;
}
