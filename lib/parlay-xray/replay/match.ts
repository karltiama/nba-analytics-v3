import {
  LINE_UNCHANGED_EPSILON,
  PLAYER_PROP_COMPARISON_KIND,
  PLAYER_PROP_REFERENCE_KIND,
  PLAYER_PROP_V1_VENDORS,
  isPlayerPropV1PropType,
  isPlayerPropV1Vendor,
  type PlayerPropV1Vendor,
} from '@/lib/betting/market-movement';
import { parseLineValue } from '@/lib/betting/prop-market-compare';
import type {
  HistoricalBookCandidate,
  HistoricalMatchExactness,
  HistoricalMovementRow,
  HistoricalParlayLegMatch,
  HistoricalParlayLegReplayInput,
  HistoricalSnapshot,
  LineMatchQuality,
  ReplayMatchStatus,
} from './types';

function finiteLine(raw: string | number | null | undefined): number | null {
  return parseLineValue(raw);
}

function iso(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

function lineEquals(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < LINE_UNCHANGED_EPSILON;
}

function emptySnapshot(
  kind: HistoricalSnapshot['kind'],
  label: HistoricalSnapshot['label']
): HistoricalSnapshot {
  return {
    kind,
    label,
    available: false,
    line: null,
    overOdds: null,
    underOdds: null,
    timestamp: null,
  };
}

function snapshotFromRow(
  row: HistoricalMovementRow | null,
  which: 'reference' | 'comparison'
): HistoricalSnapshot {
  if (!row) {
    return which === 'reference'
      ? emptySnapshot(PLAYER_PROP_REFERENCE_KIND, '3-Hour Pre-Tip')
      : emptySnapshot(PLAYER_PROP_COMPARISON_KIND, 'Decision Close');
  }
  if (which === 'reference') {
    const line = finiteLine(row.reference_line);
    const timestamp = iso(row.reference_timestamp);
    return {
      kind: PLAYER_PROP_REFERENCE_KIND,
      label: '3-Hour Pre-Tip',
      available: line != null || timestamp != null,
      line,
      overOdds: row.reference_over_odds,
      underOdds: row.reference_under_odds,
      timestamp,
    };
  }
  const line = finiteLine(row.comparison_line);
  const timestamp = iso(row.comparison_timestamp);
  return {
    kind: PLAYER_PROP_COMPARISON_KIND,
    label: 'Decision Close',
    available: line != null || timestamp != null,
    line,
    overOdds: row.comparison_over_odds,
    underOdds: row.comparison_under_odds,
    timestamp,
  };
}

function bookCandidate(row: HistoricalMovementRow, requestedLine: number | null): HistoricalBookCandidate {
  const vendor = row.vendor as PlayerPropV1Vendor;
  const referenceLine = finiteLine(row.reference_line);
  const comparisonLine = finiteLine(row.comparison_line);
  return {
    vendor,
    referenceLine,
    comparisonLine,
    lineExact: lineEquals(requestedLine, referenceLine) || lineEquals(requestedLine, comparisonLine),
  };
}

function lineQualityFor(row: HistoricalMovementRow | null, requested: number | null): LineMatchQuality {
  if (!row) return 'NO_MARKET_MATCH';
  const ref = finiteLine(row.reference_line);
  const close = finiteLine(row.comparison_line);
  if (lineEquals(requested, ref) || lineEquals(requested, close)) return 'EXACT_LINE_MATCH';
  return 'MARKET_MATCH_DIFFERENT_LINE';
}

function pack(
  input: HistoricalParlayLegReplayInput,
  extra: Partial<HistoricalParlayLegMatch> &
    Pick<HistoricalParlayLegMatch, 'status' | 'reason' | 'lineQuality' | 'exactness'>
): HistoricalParlayLegMatch {
  return {
    input,
    matchedVendor: null,
    availableBooks: [],
    reference: emptySnapshot(PLAYER_PROP_REFERENCE_KIND, '3-Hour Pre-Tip'),
    comparison: emptySnapshot(PLAYER_PROP_COMPARISON_KIND, 'Decision Close'),
    requestedLine: input.line,
    requestedSide: input.side,
    ...extra,
  };
}

function emptyExactness(partial: Partial<HistoricalMatchExactness> = {}): HistoricalMatchExactness {
  return {
    playerExact: false,
    gameExact: false,
    marketExact: false,
    lineExact: false,
    bookExact: false,
    snapshotAvailable: { threeHourPreTip: false, decisionClose: false },
    ...partial,
  };
}

export function matchHistoricalParlayLeg(
  input: HistoricalParlayLegReplayInput,
  rows: HistoricalMovementRow[]
): HistoricalParlayLegMatch {
  if (!input.historicalDate.trim()) {
    return pack(input, {
      status: 'NEEDS_CONFIRMATION',
      reason: 'MISSING_HISTORICAL_DATE',
      lineQuality: 'NO_MARKET_MATCH',
      exactness: emptyExactness(),
    });
  }
  if (!input.playerResolved || !input.playerId) {
    return pack(input, {
      status: 'NO_MATCH',
      reason: 'PLAYER_UNRESOLVED',
      lineQuality: 'NO_MARKET_MATCH',
      exactness: emptyExactness(),
    });
  }
  if (input.marketUnsupported || !input.market || !isPlayerPropV1PropType(input.market)) {
    return pack(input, {
      status: 'NO_MATCH',
      reason: input.marketUnsupported || (input.market && !isPlayerPropV1PropType(input.market))
        ? 'UNSUPPORTED_MARKET'
        : 'UNKNOWN_MARKET',
      lineQuality: 'NO_MARKET_MATCH',
      exactness: emptyExactness({ playerExact: true }),
    });
  }
  if (input.line == null) {
    return pack(input, {
      status: 'NO_MATCH',
      reason: 'MISSING_LINE',
      lineQuality: 'NO_MARKET_MATCH',
      exactness: emptyExactness({ playerExact: true, marketExact: true }),
    });
  }
  if (!input.gameResolved || !input.gameId) {
    return pack(input, {
      status: 'NEEDS_CONFIRMATION',
      reason: 'GAME_UNRESOLVED',
      lineQuality: 'NO_MARKET_MATCH',
      exactness: emptyExactness({ playerExact: true, marketExact: true }),
    });
  }

  const scoped = rows.filter(
    (row) =>
      row.game_id === input.gameId &&
      row.player_id === input.playerId &&
      row.prop_type === input.market &&
      isPlayerPropV1Vendor(row.vendor)
  );
  const availableBooks = scoped.map((row) => bookCandidate(row, input.line));

  if (scoped.length === 0) {
    return pack(input, {
      status: 'NO_MATCH',
      reason: 'NO_MARKET_MATCH',
      lineQuality: 'NO_MARKET_MATCH',
      exactness: emptyExactness({
        playerExact: true,
        gameExact: true,
        marketExact: true,
      }),
      availableBooks,
    });
  }

  const requestedBook =
    input.sportsbookVendor && isPlayerPropV1Vendor(input.sportsbookVendor)
      ? input.sportsbookVendor
      : null;
  const bookRows = requestedBook ? scoped.filter((row) => row.vendor === requestedBook) : [];

  if (requestedBook && bookRows.length > 1) {
    return pack(input, {
      status: 'NEEDS_CONFIRMATION',
      reason: 'AMBIGUOUS_BOOK_ROWS',
      lineQuality: 'MARKET_MATCH_DIFFERENT_LINE',
      exactness: emptyExactness({
        playerExact: true,
        gameExact: true,
        marketExact: true,
      }),
      availableBooks,
    });
  }

  if (requestedBook && bookRows.length === 0) {
    return pack(input, {
      status: 'PARTIAL_MATCH',
      reason: 'BOOK_UNAVAILABLE',
      lineQuality: availableBooks.some((book) => book.lineExact)
        ? 'EXACT_LINE_MATCH'
        : 'MARKET_MATCH_DIFFERENT_LINE',
      exactness: {
        playerExact: true,
        gameExact: true,
        marketExact: true,
        lineExact: false,
        bookExact: false,
        snapshotAvailable: {
          threeHourPreTip: scoped.some((row) => snapshotFromRow(row, 'reference').available),
          decisionClose: scoped.some((row) => snapshotFromRow(row, 'comparison').available),
        },
      },
      availableBooks,
    });
  }

  if (!requestedBook) {
    return pack(input, {
      status: 'PARTIAL_MATCH',
      reason: 'BOOK_UNKNOWN',
      lineQuality: scoped.some((row) => lineQualityFor(row, input.line) === 'EXACT_LINE_MATCH')
        ? 'EXACT_LINE_MATCH'
        : 'MARKET_MATCH_DIFFERENT_LINE',
      exactness: {
        playerExact: true,
        gameExact: true,
        marketExact: true,
        lineExact: scoped.some((row) => bookCandidate(row, input.line).lineExact),
        bookExact: false,
        snapshotAvailable: {
          threeHourPreTip: scoped.some((row) => snapshotFromRow(row, 'reference').available),
          decisionClose: scoped.some((row) => snapshotFromRow(row, 'comparison').available),
        },
      },
      availableBooks,
    });
  }

  const matched = bookRows[0]!;
  const reference = snapshotFromRow(matched, 'reference');
  const comparison = snapshotFromRow(matched, 'comparison');
  const quality = lineQualityFor(matched, input.line);
  const lineExact = quality === 'EXACT_LINE_MATCH';
  const status: ReplayMatchStatus = lineExact ? 'MATCHED' : 'PARTIAL_MATCH';

  return pack(input, {
    status,
    reason: lineExact ? null : 'DIFFERENT_LINE',
    lineQuality: quality,
    exactness: {
      playerExact: true,
      gameExact: true,
      marketExact: true,
      lineExact,
      bookExact: true,
      snapshotAvailable: {
        threeHourPreTip: reference.available,
        decisionClose: comparison.available,
      },
    },
    matchedVendor: matched.vendor as PlayerPropV1Vendor,
    availableBooks,
    reference,
    comparison,
  });
}

export const V1_REPLAY_VENDORS = PLAYER_PROP_V1_VENDORS;
