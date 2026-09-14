import { asRecord, pickNumber, pickString } from './normalize';

export type ResearchMarketKind = 'MONEYLINE' | 'SPREAD' | 'TOTAL' | 'OTHER' | 'UNKNOWN';

export type ResearchClosingQuote = {
  market: ResearchMarketKind;
  book: string | null;
  source: string | null;
  side: string | null;
  line: number | null;
  price: number | null;
  closeTimestamp: string | number | null;
  eventId: string | null;
};

const ML_MARKETS = new Set(['h2h', 'moneyline', 'money_line', 'ml', 'money line']);
const SPREAD_MARKETS = new Set(['spreads', 'spread', 'handicap', 'asian_handicap']);
const TOTAL_MARKETS = new Set(['totals', 'total', 'over_under', 'ou', 'over/under']);

export function classifyMarketKind(value: unknown): ResearchMarketKind {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!raw) return 'UNKNOWN';
  if (ML_MARKETS.has(raw) || raw.includes('moneyline') || raw === 'h2h') return 'MONEYLINE';
  if (SPREAD_MARKETS.has(raw) || raw.includes('spread') || raw.includes('handicap')) return 'SPREAD';
  if (TOTAL_MARKETS.has(raw) || raw.includes('total')) return 'TOTAL';
  return 'OTHER';
}

function firstTimestamp(record: Record<string, unknown>): string | number | null {
  const v =
    record.closeTimestamp ??
    record.closeTime ??
    record.closedAt ??
    record.closingTimestamp ??
    record.timestamp ??
    record.ts ??
    record.capturedAt ??
    record.asOf ??
    record.updatedAt ??
    record.gameDate;
  if (typeof v === 'string' && v.trim()) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function baseQuote(rec: Record<string, unknown>): Omit<ResearchClosingQuote, 'market' | 'side' | 'line' | 'price'> {
  return {
    book: pickString(rec, ['book', 'sportsbook', 'bookmaker', 'vendor']),
    source: pickString(rec, ['source', 'provenance', 'origin', 'providerSource']),
    closeTimestamp: firstTimestamp(rec),
    eventId: pickString(rec, ['eventId', 'event_id']),
  };
}

/** Research-only. Expands a live book-row into ML/spread/total sides. Does not rewrite raw. */
export function expandClosingOddsQuotes(raw: unknown): ResearchClosingQuote[] {
  const rec = asRecord(raw);
  if (!rec) return [];
  const base = baseQuote(rec);
  const out: ResearchClosingQuote[] = [];
  const ml = asRecord(rec.moneyline);
  if (ml) {
    const home = pickNumber(ml, ['home']);
    const away = pickNumber(ml, ['away']);
    const draw = pickNumber(ml, ['draw']);
    if (home != null) out.push({ ...base, market: 'MONEYLINE', side: 'home', line: null, price: home });
    if (away != null) out.push({ ...base, market: 'MONEYLINE', side: 'away', line: null, price: away });
    if (draw != null) out.push({ ...base, market: 'MONEYLINE', side: 'draw', line: null, price: draw });
  }
  const spread = asRecord(rec.spread);
  if (spread) {
    const homeLine = pickNumber(spread, ['home', 'homeLine']);
    const awayLine = pickNumber(spread, ['away', 'awayLine']);
    const homePrice = pickNumber(spread, ['homePrice', 'home_price']);
    const awayPrice = pickNumber(spread, ['awayPrice', 'away_price']);
    if (homeLine != null || homePrice != null) {
      out.push({ ...base, market: 'SPREAD', side: 'home', line: homeLine, price: homePrice });
    }
    if (awayLine != null || awayPrice != null) {
      out.push({ ...base, market: 'SPREAD', side: 'away', line: awayLine, price: awayPrice });
    }
  }
  const total = asRecord(rec.total);
  if (total) {
    const line = pickNumber(total, ['line', 'total']);
    const over = pickNumber(total, ['overPrice', 'over']);
    const under = pickNumber(total, ['underPrice', 'under']);
    if (over != null || line != null) {
      out.push({ ...base, market: 'TOTAL', side: 'over', line, price: over });
    }
    if (under != null || line != null) {
      out.push({ ...base, market: 'TOTAL', side: 'under', line, price: under });
    }
  }
  if (out.length > 0) return out;
  return [classifyClosingOddsRow(raw)];
}

/** Research-only. Does not rewrite the raw provider payload. */
export function classifyClosingOddsRow(raw: unknown): ResearchClosingQuote {
  const rec = asRecord(raw) ?? {};
  const nestedMarket = asRecord(rec.moneyline) ?? asRecord(rec.spread) ?? asRecord(rec.total);
  const marketField = rec.market ?? rec.marketType ?? rec.type ?? rec.betType;
  let market = classifyMarketKind(marketField);
  if (market === 'UNKNOWN') {
    if (rec.moneyline && !rec.spread && !rec.total) market = 'MONEYLINE';
    else if (rec.spread && !rec.moneyline && !rec.total) market = 'SPREAD';
    else if (rec.total && !rec.moneyline && !rec.spread) market = 'TOTAL';
  }
  const sourceRec = nestedMarket ?? rec;
  return {
    market,
    book: pickString(rec, ['book', 'sportsbook', 'bookmaker', 'vendor']),
    source: pickString(rec, ['source', 'provenance', 'origin', 'providerSource']),
    side: pickString(rec, ['side', 'outcome', 'selection', 'name']) ?? pickString(sourceRec, ['side', 'outcome']),
    line:
      pickNumber(rec, ['line', 'spread', 'total', 'points', 'handicap', 'closeLine', 'closingLine']) ??
      pickNumber(sourceRec, ['line', 'spread', 'total', 'points']),
    price:
      pickNumber(rec, [
        'price',
        'american',
        'americanPrice',
        'odds',
        'closePrice',
        'closingPrice',
        'priceAmerican',
      ]) ?? pickNumber(sourceRec, ['price', 'american', 'americanPrice', 'odds']),
    closeTimestamp: firstTimestamp(rec) ?? (nestedMarket ? firstTimestamp(nestedMarket) : null),
    eventId: pickString(rec, ['eventId', 'event_id']),
  };
}

export function quoteCompleteness(row: ResearchClosingQuote): {
  hasBook: boolean;
  hasPrice: boolean;
  hasLineIfNeeded: boolean;
  hasSource: boolean;
} {
  return {
    hasBook: Boolean(row.book),
    hasPrice: row.price != null,
    hasLineIfNeeded: row.market === 'MONEYLINE' || row.line != null,
    hasSource: Boolean(row.source),
  };
}

/** Provider book=consensus only. Never relabel as Court Context consensus. */
export const OWLS_PROVIDER_CONSENSUS_BOOK = 'consensus';

export function isValidAmericanPrice(price: number | null): boolean {
  if (price == null || !Number.isFinite(price)) return false;
  return Math.abs(price) >= 100;
}

export type ClosingOddsQualityFlag =
  | 'MONEYLINE_MISSING_SIDE'
  | 'SPREAD_HOME_NOT_NEGATIVE_AWAY'
  | 'MISSING_SPREAD_PRICE'
  | 'MISSING_TOTAL_PRICE'
  | 'INVALID_AMERICAN_PRICE'
  | 'UNEXPECTED_NULL_FIELD'
  | 'DUPLICATE_BOOK_SOURCE';

/** Research-only flags. Does not mutate provider rows. */
export function flagClosingOddsBookRow(raw: unknown): ClosingOddsQualityFlag[] {
  const rec = asRecord(raw);
  if (!rec) return ['UNEXPECTED_NULL_FIELD'];
  const flags: ClosingOddsQualityFlag[] = [];
  const ml = asRecord(rec.moneyline);
  const spread = asRecord(rec.spread);
  const total = asRecord(rec.total);
  if (!ml) flags.push('UNEXPECTED_NULL_FIELD');
  else {
    const home = pickNumber(ml, ['home']);
    const away = pickNumber(ml, ['away']);
    if (home == null || away == null) flags.push('MONEYLINE_MISSING_SIDE');
    if (home != null && !isValidAmericanPrice(home)) flags.push('INVALID_AMERICAN_PRICE');
    if (away != null && !isValidAmericanPrice(away)) flags.push('INVALID_AMERICAN_PRICE');
  }
  if (!spread) flags.push('UNEXPECTED_NULL_FIELD');
  else {
    const homeLine = pickNumber(spread, ['home']);
    const awayLine = pickNumber(spread, ['away']);
    const homePrice = pickNumber(spread, ['homePrice']);
    const awayPrice = pickNumber(spread, ['awayPrice']);
    if (homeLine == null || awayLine == null) flags.push('UNEXPECTED_NULL_FIELD');
    else if (Math.abs(homeLine + awayLine) > 1e-9) flags.push('SPREAD_HOME_NOT_NEGATIVE_AWAY');
    if (homePrice == null || awayPrice == null) flags.push('MISSING_SPREAD_PRICE');
    if (homePrice != null && !isValidAmericanPrice(homePrice)) flags.push('INVALID_AMERICAN_PRICE');
    if (awayPrice != null && !isValidAmericanPrice(awayPrice)) flags.push('INVALID_AMERICAN_PRICE');
  }
  if (!total) flags.push('UNEXPECTED_NULL_FIELD');
  else {
    const line = pickNumber(total, ['line']);
    const over = pickNumber(total, ['overPrice']);
    const under = pickNumber(total, ['underPrice']);
    if (line == null) flags.push('UNEXPECTED_NULL_FIELD');
    if (over == null || under == null) flags.push('MISSING_TOTAL_PRICE');
    if (over != null && !isValidAmericanPrice(over)) flags.push('INVALID_AMERICAN_PRICE');
    if (under != null && !isValidAmericanPrice(under)) flags.push('INVALID_AMERICAN_PRICE');
  }
  return [...new Set(flags)];
}

export function flagDuplicateBookSource(rows: unknown[]): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const raw of rows) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const key = `${pickString(rec, ['book']) ?? ''}|${pickString(rec, ['source']) ?? ''}`;
    if (seen.has(key)) dupes += 1;
    else seen.add(key);
  }
  return dupes;
}
