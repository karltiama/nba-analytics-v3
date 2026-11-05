/**
 * Parlay true cost: price math only.
 *
 * Compares what a book pays for a parlay with the payout implied by no-vig
 * ("fair") prices. Fair probability is the product of two-sided no-vig leg
 * probabilities, which assumes the legs are independent. Same-game legs are not
 * independent; this module does not measure or claim correlation.
 *
 * Never guesses: a leg without the opposite side's price makes every fair-odds
 * output explicitly unknown.
 */

import { americanToDecimal } from '@/lib/betting/odds-utils';
import { noVigProbability, rawImpliedProbFromMoneyline } from '@/lib/betting/market-probability';
import { combinedAmericanOdds, decimalToAmerican } from '@/lib/parlay-xray/combined-odds';

/** Legs priced at or shorter than this are flagged as adding vig for little payout. */
export const HEAVY_FAVORITE_AMERICAN = -300;

export type TrueCostLegInput = {
  id: string;
  /** Chosen side's American price. */
  priceAmerican: number | null | undefined;
  /** Opposite side's American price from the same book, market and line, when known. */
  oppositeAmerican?: number | null | undefined;
};

export type TrueCostUnknownReason = 'NO_LEGS' | 'MISSING_PRICE' | 'MISSING_OPPOSITE_SIDE' | 'INVALID_PRICE';

export type TrueCostLegFair =
  | {
      status: 'known';
      /** Two-sided no-vig probability: q_side / (q_side + q_other). */
      probability: number;
      /** Overround of this two-way market: q_side + q_other − 1. */
      hold: number;
      /** 1 − p_fair × d_book for this leg alone. */
      houseEdge: number;
    }
  | { status: 'unknown'; reason: TrueCostUnknownReason };

export type TrueCostLeg = {
  id: string;
  priceAmerican: number | null;
  oppositeAmerican: number | null;
  decimal: number | null;
  /** Raw implied probability of the chosen side (includes vig). */
  impliedProbability: number | null;
  fair: TrueCostLegFair;
  /** Price is at or shorter than HEAVY_FAVORITE_AMERICAN. */
  heavyFavorite: boolean;
};

export type TrueCostBook =
  | {
      status: 'known';
      decimal: number;
      /** Rounded American odds via combinedAmericanOdds. */
      american: number | null;
      /** 1 / D_book: the hit rate needed to break even at this payout. */
      breakEvenHitRate: number;
    }
  | { status: 'unknown'; reason: TrueCostUnknownReason };

export type TrueCostFair =
  | {
      status: 'known';
      /** ∏ no-vig leg probabilities (independence assumption). */
      probability: number;
      decimal: number;
      american: number | null;
      /** P_fair × D_book − 1 per $1 staked. */
      evPerDollar: number;
      /** 1 − P_fair × D_book. */
      houseEdge: number;
    }
  | { status: 'unknown'; reason: TrueCostUnknownReason; legIds: string[] };

export type TrueCostResult = {
  legs: TrueCostLeg[];
  book: TrueCostBook;
  fair: TrueCostFair;
};

function validPrice(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value === 0) return null;
  // American prices between −100 and +100 (exclusive) do not exist.
  if (value > -100 && value < 100) return null;
  return value;
}

function legDecimal(american: number | null): number | null {
  if (american == null) return null;
  const d = americanToDecimal(american);
  return d != null && Number.isFinite(d) && d > 1 ? d : null;
}

export function computeTrueCostLeg(input: TrueCostLegInput): TrueCostLeg {
  const rawPrice = input.priceAmerican ?? null;
  const rawOpposite = input.oppositeAmerican ?? null;
  const price = validPrice(rawPrice);
  const opposite = validPrice(rawOpposite);
  const decimal = legDecimal(price);
  const implied = price != null ? rawImpliedProbFromMoneyline(price) : null;

  let fair: TrueCostLegFair;
  if (rawPrice == null) {
    fair = { status: 'unknown', reason: 'MISSING_PRICE' };
  } else if (price == null || decimal == null || implied == null) {
    fair = { status: 'unknown', reason: 'INVALID_PRICE' };
  } else if (rawOpposite == null) {
    fair = { status: 'unknown', reason: 'MISSING_OPPOSITE_SIDE' };
  } else {
    const oppositeImplied = opposite != null ? rawImpliedProbFromMoneyline(opposite) : null;
    const p = noVigProbability(implied, oppositeImplied);
    if (p == null || oppositeImplied == null) {
      fair = { status: 'unknown', reason: 'INVALID_PRICE' };
    } else {
      fair = {
        status: 'known',
        probability: p,
        hold: implied + oppositeImplied - 1,
        houseEdge: 1 - p * decimal,
      };
    }
  }

  return {
    id: input.id,
    priceAmerican: price,
    oppositeAmerican: opposite,
    decimal,
    impliedProbability: implied,
    fair,
    heavyFavorite: price != null && price <= HEAVY_FAVORITE_AMERICAN,
  };
}

/** Product of leg decimals, or null when any leg lacks a usable price. */
export function combinedDecimal(prices: Array<number | null | undefined>): number | null {
  if (prices.length === 0) return null;
  let product = 1;
  for (const price of prices) {
    const d = legDecimal(validPrice(price));
    if (d == null) return null;
    product *= d;
  }
  return product;
}

export function computeParlayTrueCost(inputs: TrueCostLegInput[]): TrueCostResult {
  const legs = inputs.map(computeTrueCostLeg);

  let book: TrueCostBook;
  if (legs.length === 0) {
    book = { status: 'unknown', reason: 'NO_LEGS' };
  } else if (legs.some((leg) => leg.fair.status === 'unknown' && leg.fair.reason === 'MISSING_PRICE')) {
    book = { status: 'unknown', reason: 'MISSING_PRICE' };
  } else {
    const decimal = combinedDecimal(legs.map((leg) => leg.priceAmerican));
    book =
      decimal == null
        ? { status: 'unknown', reason: 'INVALID_PRICE' }
        : {
            status: 'known',
            decimal,
            american: combinedAmericanOdds(legs.map((leg) => leg.priceAmerican)),
            breakEvenHitRate: 1 / decimal,
          };
  }

  let fair: TrueCostFair;
  const unknownLegs = legs.filter((leg) => leg.fair.status === 'unknown');
  if (legs.length === 0) {
    fair = { status: 'unknown', reason: 'NO_LEGS', legIds: [] };
  } else if (book.status === 'unknown') {
    fair = { status: 'unknown', reason: book.reason, legIds: unknownLegs.map((leg) => leg.id) };
  } else if (unknownLegs.length > 0) {
    const reasons = unknownLegs.map((leg) => (leg.fair.status === 'unknown' ? leg.fair.reason : null));
    const reason: TrueCostUnknownReason = reasons.includes('INVALID_PRICE') ? 'INVALID_PRICE' : 'MISSING_OPPOSITE_SIDE';
    fair = { status: 'unknown', reason, legIds: unknownLegs.map((leg) => leg.id) };
  } else {
    const probability = legs.reduce(
      (acc, leg) => acc * (leg.fair.status === 'known' ? leg.fair.probability : Number.NaN),
      1
    );
    const fairDecimal = 1 / probability;
    fair = {
      status: 'known',
      probability,
      decimal: fairDecimal,
      american: decimalToAmerican(fairDecimal),
      evPerDollar: probability * book.decimal - 1,
      houseEdge: 1 - probability * book.decimal,
    };
  }

  return { legs, book, fair };
}

// ---------------------------------------------------------------------------
// Best single book. A parlay has to be placed at one book, so this compares
// whole parlays per book, not the best price per leg.
// ---------------------------------------------------------------------------

export type BookLegQuote = {
  /** Canonical vendor key (e.g. draftkings). */
  vendor: string;
  displayName: string;
  priceAmerican: number | null;
  oppositeAmerican: number | null;
};

export type BookParlayPrice = {
  vendor: string;
  displayName: string;
  decimal: number;
  american: number | null;
  /** 1 − P_fair × D_book; null when fair probability is unknown. */
  houseEdge: number | null;
  /** Payout difference per $100 staked vs the user's book (positive = pays more). */
  extraPayoutPer100: number | null;
};

export type BestBookResult =
  | {
      status: 'known';
      /** Books that price every leg on the chosen side, best combined payout first. */
      books: BookParlayPrice[];
      best: BookParlayPrice;
      /** The user's book, when it prices every leg. */
      current: BookParlayPrice | null;
      /** current.houseEdge − best.houseEdge, in probability units; null when unknown. */
      houseEdgeDifference: number | null;
    }
  | { status: 'unknown'; reason: 'NO_LEGS' | 'NO_BOOK_PRICES_EVERY_LEG' };

/**
 * Ranks books that price every leg and compares each with the user's book.
 * `fairProbability` is the reference fair probability (from the user's book prices);
 * pass null when it is unknown and house-edge fields stay null.
 */
export function bestSingleBook(input: {
  quotesPerLeg: BookLegQuote[][];
  fairProbability: number | null;
  currentVendor: string | null;
  currentDecimal: number | null;
}): BestBookResult {
  const { quotesPerLeg, fairProbability, currentVendor } = input;
  if (quotesPerLeg.length === 0) return { status: 'unknown', reason: 'NO_LEGS' };

  const vendors = new Map<string, string>();
  for (const quotes of quotesPerLeg) {
    for (const q of quotes) if (!vendors.has(q.vendor)) vendors.set(q.vendor, q.displayName);
  }

  const fairOk = fairProbability != null && Number.isFinite(fairProbability) && fairProbability > 0 && fairProbability < 1;
  const priced: Array<Omit<BookParlayPrice, 'extraPayoutPer100'>> = [];
  for (const [vendor, displayName] of vendors) {
    const prices = quotesPerLeg.map((quotes) => quotes.find((q) => q.vendor === vendor)?.priceAmerican ?? null);
    const decimal = combinedDecimal(prices);
    if (decimal == null) continue;
    priced.push({
      vendor,
      displayName,
      decimal,
      american: combinedAmericanOdds(prices),
      houseEdge: fairOk ? 1 - fairProbability! * decimal : null,
    });
  }
  if (priced.length === 0) return { status: 'unknown', reason: 'NO_BOOK_PRICES_EVERY_LEG' };

  priced.sort((a, b) => b.decimal - a.decimal || a.vendor.localeCompare(b.vendor));
  const currentFromBooks = currentVendor ? priced.find((b) => b.vendor === currentVendor) ?? null : null;
  const currentDecimal =
    input.currentDecimal != null && Number.isFinite(input.currentDecimal) && input.currentDecimal > 1
      ? input.currentDecimal
      : currentFromBooks?.decimal ?? null;

  const books: BookParlayPrice[] = priced.map((b) => ({
    ...b,
    extraPayoutPer100: currentDecimal != null ? (b.decimal - currentDecimal) * 100 : null,
  }));
  const best = books[0]!;
  const current = currentVendor ? books.find((b) => b.vendor === currentVendor) ?? null : null;
  const currentEdge =
    current?.houseEdge ?? (fairOk && currentDecimal != null ? 1 - fairProbability! * currentDecimal : null);

  return {
    status: 'known',
    books,
    best,
    current,
    houseEdgeDifference: currentEdge != null && best.houseEdge != null ? currentEdge - best.houseEdge : null,
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Profit on a winning $100 stake at decimal odds. */
export function profitPer100(decimal: number): number {
  return (decimal - 1) * 100;
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDollars(value: number): string {
  const abs = Math.abs(value);
  const text = abs >= 1000 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(2);
  return `${value < 0 ? '−' : ''}$${text}`;
}

export const TRUE_COST_UNKNOWN_COPY: Record<TrueCostUnknownReason, string> = {
  NO_LEGS: 'Add legs to see the price math.',
  MISSING_PRICE: 'A leg has no price, so the payout is unknown.',
  MISSING_OPPOSITE_SIDE: 'The other side of a leg is not priced, so fair odds are unknown.',
  INVALID_PRICE: 'A leg has a price that cannot be read, so fair odds are unknown.',
};
