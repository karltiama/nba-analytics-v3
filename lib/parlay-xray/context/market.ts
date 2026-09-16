import type { HistoricalParlayLegMatch } from '@/lib/parlay-xray/replay/types';
import type { ParlayLegSide } from '@/lib/parlay-xray/types';
import { finiteOrNull, round1 } from './stats';
import type { XRayMarketContext } from './types';

function sideOdds(
  overOdds: number | null,
  underOdds: number | null,
  side: ParlayLegSide | null
): number | null {
  if (side === 'under') return finiteOrNull(underOdds);
  if (side === 'over') return finiteOrNull(overOdds);
  return finiteOrNull(overOdds);
}

function delta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return round1(a - b);
}

export function assembleMarketContext(match: HistoricalParlayLegMatch): XRayMarketContext {
  const threeHour = match.reference;
  const close = match.comparison;
  const side = match.requestedSide;
  const threeHourOdds = sideOdds(threeHour.overOdds, threeHour.underOdds, side);
  const closeOdds = sideOdds(close.overOdds, close.underOdds, side);
  const status =
    match.status === 'MATCHED'
      ? 'AVAILABLE'
      : match.status === 'PARTIAL_MATCH'
        ? 'LIMITED'
        : match.status === 'NEEDS_CONFIRMATION'
          ? 'NEEDS_CONFIRMATION'
          : 'UNAVAILABLE';

  return {
    status,
    reason: match.reason,
    requestedBook: match.input.sportsbookVendor,
    matchedBook: match.matchedVendor,
    matchStatus: match.status,
    lineQuality: match.lineQuality,
    requestedLine: match.requestedLine,
    threeHourLine: threeHour.available ? threeHour.line : null,
    threeHourOdds: threeHour.available ? threeHourOdds : null,
    threeHourTimestamp: threeHour.available ? threeHour.timestamp : null,
    closeLine: close.available ? close.line : null,
    closeOdds: close.available ? closeOdds : null,
    closeTimestamp: close.available ? close.timestamp : null,
    lineDeltaCloseMinusThreeHour: delta(close.available ? close.line : null, threeHour.available ? threeHour.line : null),
    lineDeltaThreeHourMinusRequested: delta(threeHour.available ? threeHour.line : null, match.requestedLine),
    americanOddsDeltaCloseMinusThreeHour: delta(closeOdds, threeHourOdds),
    snapshotAvailable: {
      threeHourPreTip: match.exactness.snapshotAvailable.threeHourPreTip,
      decisionClose: match.exactness.snapshotAvailable.decisionClose,
    },
  };
}
