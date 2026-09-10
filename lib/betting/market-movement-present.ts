/**
 * Props Explorer presentation for certified Market Movement v1.
 * Uses API labels and values. Does not reorder by timestamp. Does not recompute median/class/delta.
 */

import { UPGRADE_COPY } from '@/lib/entitlements/types';
import { PLAYER_PROP_V1_VENDORS } from '@/lib/betting/market-movement';
import type {
  ApiConsensusSnapshot,
  PlayerMarketMovementBook,
  PlayerMarketMovementResponse,
} from '@/lib/betting/market-movement-api';
import {
  formatBookCount,
  formatConsensusRange,
  formatConsensusSpan,
  formatImpliedProbabilityDeltaPp,
  formatMarketLine,
  formatSignedLineDelta,
  formatSnapshotQuote,
} from '@/lib/betting/market-movement-format';

export const MM_SECTION_TITLE = 'Market Movement';
export const MM_PRO_SUBTITLE = '3-Hour Pre-Tip → Close';
export const MM_FREE_TITLE = 'Market Consensus';
export const MM_EMPTY_TITLE = 'No 3-Hour Pre-Tip history for this market';
export const MM_EMPTY_BODY = 'Current shopping data may still be available.';
export const MM_UNSUPPORTED_TITLE = "Market Movement isn't available for this prop yet.";
export const MM_UNSUPPORTED_BODY = 'Shopping and other market details may still be available.';
export const MM_ONE_BOOK_TITLE = '1 supported book available';
export const MM_ONE_BOOK_DETAIL = 'Not a consensus. Requires at least 2 supported books.';
export const MM_CONSENSUS_UNAVAILABLE = 'Consensus unavailable';
export const MM_CONSENSUS_UNAVAILABLE_DETAIL = 'Requires at least 2 supported books.';
export const MM_DISCLAIMER_SHORT =
  'Median across supported books — not necessarily a line any book offered.';
export const MM_ROW_REFERENCE_LABEL = '3-Hour';
export const MM_ROW_COMPARISON_LABEL = 'Close';

export const MOVEMENT_CLASS_EXPLANATION = {
  Quiet: 'Little meaningful movement',
  Juice: 'Price moved, line held',
  Line: 'Line moved',
  'Line+Price': 'Both line and price moved',
  Unclassified: 'Movement not classified',
} as const;

const VENDOR_ORDER = new Map(PLAYER_PROP_V1_VENDORS.map((v, i) => [v, i]));

export type PresentedConsensus = {
  available: boolean;
  medianLabel: string | null;
  rangeLabel: string | null;
  spanLabel: string | null;
  bookCount: number;
};

export type PresentedBookRow = {
  vendor: string;
  vendorLabel: string;
  classLabel: string;
  classExplanation: string;
  referenceQuote: string;
  comparisonQuote: string;
  lineDeltaLabel: string | null;
  priceMovementLabel: string | null;
  juiceContext: string | null;
};

export type PresentedMarketMovement =
  | {
      state: 'empty';
      title: string;
      body: string;
    }
  | {
      state: 'unsupported';
      title: string;
      body: string;
    }
  | {
      state: 'free';
      title: string;
      close: PresentedConsensus;
      consensusUnavailable: boolean;
      acrossLabel: string | null;
      upgradeTitle: string;
      upgradeDetail: string;
    }
  | {
      state: 'pro';
      title: string;
      subtitle: string;
      referenceKind: PlayerMarketMovementResponse['reference']['kind'];
      comparisonKind: PlayerMarketMovementResponse['comparison']['kind'];
      referenceLabel: string;
      comparisonLabel: string;
      rowReferenceLabel: string;
      rowComparisonLabel: string;
      reference: PresentedConsensus;
      comparison: PresentedConsensus;
      consensusDeltaLabel: string | null;
      consensusUnavailable: boolean;
      oneBook: boolean;
      oneBookTitle: string;
      oneBookDetail: string;
      acrossLabel: string | null;
      books: PresentedBookRow[];
      disclaimer: string;
    };

export type PresentOddsSide = 'over' | 'under';

function presentConsensus(snapshot: ApiConsensusSnapshot): PresentedConsensus {
  if (!snapshot.available) {
    return {
      available: false,
      medianLabel: null,
      rangeLabel: null,
      spanLabel: null,
      bookCount: snapshot.bookCount,
    };
  }
  return {
    available: true,
    medianLabel: formatMarketLine(snapshot.median),
    rangeLabel: formatConsensusRange({
      min: snapshot.min,
      max: snapshot.max,
      bookCount: snapshot.bookCount,
    }),
    spanLabel: formatConsensusSpan(snapshot.min, snapshot.max),
    bookCount: snapshot.bookCount,
  };
}

export function normalizeOddsSide(side?: string | null): PresentOddsSide | null {
  const value = (side ?? '').trim().toLowerCase();
  if (value === 'over' || value === 'under') return value;
  return null;
}

function headlineContext(
  reference: PresentedConsensus,
  comparison: PresentedConsensus,
  bookCount: number,
  oneBook: boolean
): string | null {
  if (oneBook) return null;
  if (reference.spanLabel && comparison.spanLabel && reference.spanLabel !== comparison.spanLabel) {
    return `3-Hour ${reference.spanLabel} · Close ${comparison.spanLabel} · ${formatBookCount(bookCount)}`;
  }
  return comparison.rangeLabel || reference.rangeLabel;
}

export function pickOddsForSide(
  slot: PlayerMarketMovementBook['reference'],
  side: PresentOddsSide | null | undefined
): number | null {
  if (side === 'under') return slot.underOdds;
  return slot.overOdds;
}

function pickImpliedDelta(
  book: PlayerMarketMovementBook,
  side: PresentOddsSide | null | undefined
): number | null {
  if (side === 'under') return book.movement.underImpliedProbabilityDelta;
  if (side === 'over') return book.movement.overImpliedProbabilityDelta;
  const over = book.movement.overImpliedProbabilityDelta;
  const under = book.movement.underImpliedProbabilityDelta;
  const overAbs = over != null && Number.isFinite(over) ? Math.abs(over) : -1;
  const underAbs = under != null && Number.isFinite(under) ? Math.abs(under) : -1;
  if (underAbs > overAbs) return under;
  return over;
}

function juiceContext(
  book: PlayerMarketMovementBook,
  side: PresentOddsSide | null | undefined
): string | null {
  if (book.movement.classCode !== 'B') return null;
  const line = book.reference.line ?? book.comparison.line;
  const pp = formatImpliedProbabilityDeltaPp(pickImpliedDelta(book, side));
  if (line == null || !Number.isFinite(line) || !pp) return null;
  const points = pp.replace(' pp', '');
  return `Line stayed at ${formatMarketLine(line)}, but the price shifted ${points} percentage points.`;
}

function presentBook(
  book: PlayerMarketMovementBook,
  side: PresentOddsSide | null | undefined
): PresentedBookRow {
  const classLabel = book.movement.class;
  const classExplanation =
    MOVEMENT_CLASS_EXPLANATION[classLabel as keyof typeof MOVEMENT_CLASS_EXPLANATION] ??
    MOVEMENT_CLASS_EXPLANATION.Unclassified;
  const showLine =
    book.movement.classCode === 'C' ||
    book.movement.classCode === 'D' ||
    (book.movement.lineDelta != null && book.movement.lineDelta !== 0);
  const showPrice = book.movement.classCode === 'B' || book.movement.classCode === 'D';
  const pp = showPrice ? formatImpliedProbabilityDeltaPp(pickImpliedDelta(book, side)) : null;

  return {
    vendor: book.vendor,
    vendorLabel: book.vendorLabel,
    classLabel,
    classExplanation,
    referenceQuote: formatSnapshotQuote(book.reference.line, pickOddsForSide(book.reference, side)),
    comparisonQuote: formatSnapshotQuote(book.comparison.line, pickOddsForSide(book.comparison, side)),
    lineDeltaLabel: showLine ? formatSignedLineDelta(book.movement.lineDelta) : null,
    priceMovementLabel: pp,
    juiceContext: juiceContext(book, side),
  };
}

export function presentPlayerMarketMovement(
  mm: PlayerMarketMovementResponse,
  side?: PresentOddsSide | string | null
): PresentedMarketMovement {
  const oddsSide = normalizeOddsSide(side ?? null);
  if (mm.status === 'empty') {
    return { state: 'empty', title: MM_EMPTY_TITLE, body: MM_EMPTY_BODY };
  }
  if (mm.status === 'unsupported_prop') {
    return { state: 'unsupported', title: MM_UNSUPPORTED_TITLE, body: MM_UNSUPPORTED_BODY };
  }

  if (mm.detail === 'summary') {
    const close = presentConsensus(mm.consensus.comparison);
    return {
      state: 'free',
      title: MM_FREE_TITLE,
      close,
      consensusUnavailable: !close.available,
      acrossLabel: close.available ? 'Close consensus' : null,
      upgradeTitle: UPGRADE_COPY.market_movement.title,
      upgradeDetail: UPGRADE_COPY.market_movement.detail,
    };
  }

  const reference = presentConsensus(mm.consensus.reference);
  const comparison = presentConsensus(mm.consensus.comparison);
  const books = mm.books
    .map((book) => presentBook(book, oddsSide))
    .sort(
      (a, b) =>
        (VENDOR_ORDER.get(a.vendor as (typeof PLAYER_PROP_V1_VENDORS)[number]) ?? 99) -
        (VENDOR_ORDER.get(b.vendor as (typeof PLAYER_PROP_V1_VENDORS)[number]) ?? 99)
    );
  const oneBook = books.length === 1;
  const bookCount = Math.max(reference.bookCount, comparison.bookCount, books.length);

  return {
    state: 'pro',
    title: MM_SECTION_TITLE,
    subtitle: `${mm.reference.label} → ${mm.comparison.label}`,
    referenceKind: mm.reference.kind,
    comparisonKind: mm.comparison.kind,
    referenceLabel: mm.reference.label,
    comparisonLabel: mm.comparison.label,
    rowReferenceLabel: MM_ROW_REFERENCE_LABEL,
    rowComparisonLabel: MM_ROW_COMPARISON_LABEL,
    reference,
    comparison,
    consensusDeltaLabel:
      reference.available && comparison.available
        ? formatSignedLineDelta(mm.consensus.lineDelta)
        : null,
    consensusUnavailable: !reference.available && !comparison.available,
    oneBook,
    oneBookTitle: MM_ONE_BOOK_TITLE,
    oneBookDetail: MM_ONE_BOOK_DETAIL,
    acrossLabel: headlineContext(reference, comparison, bookCount, oneBook),
    books,
    disclaimer: MM_DISCLAIMER_SHORT,
  };
}

/** Flattened copy for tests / a11y snapshots. Never includes timestamps. */
export function presentedCopyBlob(presented: PresentedMarketMovement): string {
  if (presented.state === 'empty' || presented.state === 'unsupported') {
    return `${presented.title} ${presented.body}`;
  }
  if (presented.state === 'free') {
    return [
      presented.title,
      presented.close.medianLabel,
      presented.close.rangeLabel,
      presented.acrossLabel,
      presented.consensusUnavailable ? MM_CONSENSUS_UNAVAILABLE : '',
      presented.upgradeTitle,
      presented.upgradeDetail,
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    presented.title,
    presented.subtitle,
    presented.referenceLabel,
    presented.comparisonLabel,
    presented.reference.medianLabel,
    presented.reference.rangeLabel,
    presented.comparison.medianLabel,
    presented.comparison.rangeLabel,
    presented.consensusDeltaLabel,
    presented.acrossLabel,
    presented.oneBook ? `${presented.oneBookTitle} ${presented.oneBookDetail}` : '',
    presented.disclaimer,
    ...presented.books.flatMap((b) => [
      b.vendorLabel,
      b.classLabel,
      b.classExplanation,
      b.referenceQuote,
      b.comparisonQuote,
      b.lineDeltaLabel,
      b.priceMovementLabel,
      b.juiceContext,
    ]),
  ]
    .filter(Boolean)
    .join(' ');
}

/** Shopping stays visible even when certified movement is empty. */
export function shoppingStillVisible(shoppingStatus: string): boolean {
  return shoppingStatus === 'ok';
}
