/**
 * Pregame quote from the odds job (analytics.game_odds_history), used when the scoreboard's own
 * market feed has nothing for the game. Latest pregame snapshot per sportsbook, then the line most
 * books agree on, median prices on that line, and the best price per side. Snapshots, not live.
 */

import { twoWayMarketDisplay } from '@/lib/betting/market-probability';
import type { MatchupQuote } from './quote';

export type BookOddsRow = {
  vendor: string;
  snapshotAt: string;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeSpread: number | null;
  homeSpreadOdds: number | null;
  awaySpreadOdds: number | null;
  total: number | null;
  overOdds: number | null;
  underOdds: number | null;
};

/** Exchanges and prediction markets price differently; the quote is sportsbooks only. */
const NOT_SPORTSBOOKS = new Set(['polymarket', 'kalshi']);
/** A snapshot older than this before tip is not shown. */
export const BOOK_SNAPSHOT_MAX_AGE_HOURS = 36;
/** Fewer books than this and the quote is not shown. */
export const MIN_BOOKS = 2;

const BOOK_LABELS: Record<string, string> = {
  ballybet: 'Bally Bet',
  betmgm: 'BetMGM',
  betparx: 'betPARX',
  betrivers: 'BetRivers',
  betway: 'Betway',
  caesars: 'Caesars',
  draftkings: 'DraftKings',
  fanatics: 'Fanatics',
  fanduel: 'FanDuel',
  rebet: 'Rebet',
};

export function bookLabel(vendor: string): string {
  return BOOK_LABELS[vendor] ?? vendor.charAt(0).toUpperCase() + vendor.slice(1);
}

const ok = (v: number | null): v is number => v != null && Number.isFinite(v);

function median(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** American odds → decimal, for comparing and averaging prices. */
function toDecimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

function toAmerican(decimal: number): number {
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** Median price, taken in decimal so -105 and +105 average sensibly. */
function medianPrice(prices: number[]): number | null {
  const m = median(prices.map(toDecimal));
  return m == null ? null : toAmerican(m);
}

function american(value: number | null): string {
  if (value == null) return '—';
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function signedLine(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : 'PK';
}

/** The line most books hang; ties go to the one nearest the median of all lines. */
function consensusLine(lines: number[]): number | null {
  if (lines.length === 0) return null;
  const counts = new Map<number, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const mid = median(lines)!;
  return [...counts.entries()]
    .filter(([, n]) => n === top)
    .map(([l]) => l)
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)[0]!;
}

function best(rows: BookOddsRow[], price: (r: BookOddsRow) => number | null): { price: number; books: string[] } | null {
  const priced = rows.filter((r) => ok(price(r)));
  if (priced.length === 0) return null;
  const top = Math.max(...priced.map((r) => toDecimal(price(r)!)));
  const winners = priced.filter((r) => toDecimal(price(r)!) === top);
  return { price: price(winners[0]!)!, books: winners.map((r) => bookLabel(r.vendor)) };
}

/** A spread whose favourite disagrees with the same book's moneyline is a feed error; skip it. */
function spreadAgreesWithMoneyline(r: BookOddsRow): boolean {
  if (!ok(r.homeSpread)) return false;
  if (!ok(r.homeMoneyline) || !ok(r.awayMoneyline) || r.homeMoneyline === r.awayMoneyline) return true;
  const homeFavoured = toDecimal(r.homeMoneyline) < toDecimal(r.awayMoneyline);
  return r.homeSpread === 0 || homeFavoured === r.homeSpread < 0;
}

export function latestPregameBooks(rows: BookOddsRow[], tipAt: string | null, now: Date): BookOddsRow[] {
  const tip = tipAt ? Date.parse(tipAt) : NaN;
  const cutoff = Number.isFinite(tip) ? tip : now.getTime();
  const floor = cutoff - BOOK_SNAPSHOT_MAX_AGE_HOURS * 3600_000;
  const latest = new Map<string, BookOddsRow>();
  for (const r of rows) {
    const vendor = r.vendor.trim().toLowerCase();
    if (!vendor || NOT_SPORTSBOOKS.has(vendor)) continue;
    const at = Date.parse(r.snapshotAt);
    if (!Number.isFinite(at) || at >= cutoff || at < floor) continue;
    const prev = latest.get(vendor);
    if (!prev || Date.parse(prev.snapshotAt) < at) latest.set(vendor, { ...r, vendor });
  }
  return [...latest.values()].sort((a, b) => a.vendor.localeCompare(b.vendor));
}

/** Each sportsbook's first pregame snapshot we stored (no age limit). */
export function firstPregameBooks(rows: BookOddsRow[], tipAt: string | null, now: Date): BookOddsRow[] {
  const tip = tipAt ? Date.parse(tipAt) : NaN;
  const cutoff = Number.isFinite(tip) ? tip : now.getTime();
  const first = new Map<string, BookOddsRow>();
  for (const r of rows) {
    const vendor = r.vendor.trim().toLowerCase();
    if (!vendor || NOT_SPORTSBOOKS.has(vendor)) continue;
    const at = Date.parse(r.snapshotAt);
    if (!Number.isFinite(at) || at >= cutoff) continue;
    const prev = first.get(vendor);
    if (!prev || Date.parse(prev.snapshotAt) > at) first.set(vendor, { ...r, vendor });
  }
  return [...first.values()].sort((a, b) => a.vendor.localeCompare(b.vendor));
}

type MarketSnapshot = { spread: number | null; total: number | null; homeProb: number | null };

function marketOf(books: BookOddsRow[]): MarketSnapshot {
  const spreadBooks = books.filter(spreadAgreesWithMoneyline);
  const mlAway = medianPrice(books.filter((r) => ok(r.awayMoneyline)).map((r) => r.awayMoneyline!));
  const mlHome = medianPrice(books.filter((r) => ok(r.homeMoneyline)).map((r) => r.homeMoneyline!));
  const noVig = twoWayMarketDisplay(mlAway, mlHome);
  return {
    spread: consensusLine(spreadBooks.map((r) => r.homeSpread!)),
    total: consensusLine(books.filter((r) => ok(r.total)).map((r) => r.total!)),
    homeProb: noVig ? noVig.homePct : null,
  };
}

/**
 * Opening vs now from the odds job's snapshots: consensus of each book's first stored price against
 * the consensus of its latest, plus the books whose own spread or total moved.
 * "Opening" is the first price we stored, not necessarily the book's true open.
 */
export function lineMovement(input: {
  rows: BookOddsRow[];
  tipAt: string | null;
  now: Date;
  awayAbbr: string;
  homeAbbr: string;
}): string | null {
  const latest = latestPregameBooks(input.rows, input.tipAt, input.now);
  if (latest.length < MIN_BOOKS) return null;
  const firstAll = firstPregameBooks(input.rows, input.tipAt, input.now);
  const latestByVendor = new Map(latest.map((r) => [r.vendor, r]));
  const first = firstAll.filter((r) => latestByVendor.has(r.vendor));
  const firstAt = first.reduce((min, r) => Math.min(min, Date.parse(r.snapshotAt)), Infinity);
  const lastAt = latest.reduce((max, r) => Math.max(max, Date.parse(r.snapshotAt)), -Infinity);
  if (!Number.isFinite(firstAt) || lastAt - firstAt < 30 * 60_000) return null;

  const open = marketOf(first);
  const now = marketOf(latest);
  const H = input.homeAbbr;
  const fav = (spread: number) => (spread <= 0 ? `${H} ${signedLine(spread)}` : `${input.awayAbbr} ${signedLine(-spread)}`);
  const parts: string[] = [];
  if (open.spread != null && now.spread != null) {
    parts.push(open.spread === now.spread ? `spread steady at ${fav(now.spread)}` : `spread ${fav(open.spread)} → ${fav(now.spread)}`);
  }
  if (open.total != null && now.total != null) {
    parts.push(open.total === now.total ? `total steady at ${now.total}` : `total ${open.total} → ${now.total}`);
  }
  if (open.homeProb != null && now.homeProb != null && open.homeProb !== now.homeProb) {
    parts.push(`${H} win chance ${open.homeProb}% → ${now.homeProb}%`);
  }

  const moved: string[] = [];
  for (const f of first) {
    const l = latestByVendor.get(f.vendor)!;
    const bits: string[] = [];
    if (spreadAgreesWithMoneyline(f) && spreadAgreesWithMoneyline(l) && f.homeSpread !== l.homeSpread) {
      bits.push(`${fav(f.homeSpread!)} → ${fav(l.homeSpread!)}`);
    }
    if (ok(f.total) && ok(l.total) && f.total !== l.total) bits.push(`total ${f.total} → ${l.total}`);
    if (bits.length > 0) moved.push(`${bookLabel(f.vendor)} ${bits.join(', ')}`);
  }
  if (parts.length === 0) return null;
  const since = `Since ${etTime(new Date(firstAt).toISOString())} ET`;
  const movedText = moved.length > 0 ? ` Books that moved: ${moved.slice(0, 4).join('; ')}${moved.length > 4 ? ` (+${moved.length - 4} more)` : ''}.` : '';
  return `${since}: ${parts.join(' · ')}.${movedText}`;
}

function etTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function consensusQuote(input: {
  rows: BookOddsRow[];
  tipAt: string | null;
  now: Date;
  awayAbbr: string;
  homeAbbr: string;
}): MatchupQuote | null {
  const books = latestPregameBooks(input.rows, input.tipAt, input.now);
  if (books.length < MIN_BOOKS) return null;
  const { awayAbbr: A, homeAbbr: H } = input;

  const spreadBooks = books.filter(spreadAgreesWithMoneyline);
  const spread = consensusLine(spreadBooks.map((r) => r.homeSpread!));
  const onSpread = spread == null ? [] : spreadBooks.filter((r) => r.homeSpread === spread);
  const total = consensusLine(books.filter((r) => ok(r.total)).map((r) => r.total!));
  const onTotal = total == null ? [] : books.filter((r) => r.total === total);

  const mlAway = medianPrice(books.filter((r) => ok(r.awayMoneyline)).map((r) => r.awayMoneyline!));
  const mlHome = medianPrice(books.filter((r) => ok(r.homeMoneyline)).map((r) => r.homeMoneyline!));
  const noVig = twoWayMarketDisplay(mlAway, mlHome);

  const bestAway = best(books, (r) => r.awayMoneyline);
  const bestHome = best(books, (r) => r.homeMoneyline);
  const bestOver = best(onTotal, (r) => r.overOdds);
  const bestUnder = best(onTotal, (r) => r.underOdds);
  const bestLine = (label: string, b: { price: number; books: string[] } | null) =>
    b ? `${label} ${american(b.price)} (${b.books.slice(0, 2).join(', ')}${b.books.length > 2 ? ` +${b.books.length - 2}` : ''})` : null;
  const bestParts = [
    bestLine(`${A} ML`, bestAway),
    bestLine(`${H} ML`, bestHome),
    total != null ? bestLine(`O ${total}`, bestOver) : null,
    total != null ? bestLine(`U ${total}`, bestUnder) : null,
  ].filter((p): p is string => p != null);

  const newest = books.reduce((a, b) => (Date.parse(a.snapshotAt) > Date.parse(b.snapshotAt) ? a : b));
  const lines = [
    spread != null ? `spread ${onSpread.length} of ${spreadBooks.length}` : null,
    total != null ? `total ${onTotal.length} of ${books.length}` : null,
  ].filter(Boolean);

  return {
    vendorLabel: `Consensus of ${books.length} sportsbooks`,
    caption: `Consensus of ${books.length} sportsbooks${lines.length ? ` (books on the line: ${lines.join(', ')})` : ''} · prices as of ${etTime(newest.snapshotAt)} ET, not live`,
    awayAbbr: A,
    homeAbbr: H,
    spreadAway:
      spread == null ? '—' : `${A} ${signedLine(-spread)} ${american(medianPrice(onSpread.filter((r) => ok(r.awaySpreadOdds)).map((r) => r.awaySpreadOdds!)))}`,
    spreadHome:
      spread == null ? '—' : `${H} ${signedLine(spread)} ${american(medianPrice(onSpread.filter((r) => ok(r.homeSpreadOdds)).map((r) => r.homeSpreadOdds!)))}`,
    total: total == null ? '—' : `O/U ${total}`,
    totalPrices:
      total == null
        ? '—'
        : `O ${american(medianPrice(onTotal.filter((r) => ok(r.overOdds)).map((r) => r.overOdds!)))} / U ${american(
            medianPrice(onTotal.filter((r) => ok(r.underOdds)).map((r) => r.underOdds!))
          )}`,
    moneylineAway: `${A} ${american(mlAway)}`,
    moneylineHome: `${H} ${american(mlHome)}`,
    implied: noVig ? `No-vig implied probability: ${A} ${noVig.awayPct}%, ${H} ${noVig.homePct}%` : null,
    best: bestParts.length > 0 ? `Best price: ${bestParts.join(' · ')}` : null,
    movement: lineMovement(input),
  };
}
