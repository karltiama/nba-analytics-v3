/**
 * Two-book arbitrage on player props: this row's price plus the best price on the other side of the
 * same line at another book adds up to less than 100% implied, so betting both returns the same
 * amount whichever side wins.
 *
 * Client-safe (no db). Only live lines for games that have not started, and only pairs whose quotes
 * were captured within ARB_MAX_QUOTE_GAP_MINUTES of each other, so a stale price does not fake an arb.
 */

export const ARB_MAX_QUOTE_GAP_MINUTES = 10;

export type ArbQuote = {
  sportsbook: string | null;
  side: string | null;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
  snapshotAt: string | Date | null;
};

export type PropsExplorerArb = {
  /** Guaranteed return on the total stake, as a fraction (0.012 = 1.2%). */
  profit: number;
  otherSide: 'over' | 'under';
  otherSportsbook: string | null;
  otherOddsAmerican: number | null;
  otherOddsDecimal: number;
  /** Share of the total stake on this row's bet (the rest goes on the other side). */
  stakeShare: number;
  /** Minutes between the two quotes' capture times. */
  quoteGapMinutes: number;
};

export function toDecimalOdds(decimal: number | null | undefined, american: number | null | undefined): number | null {
  if (decimal != null && Number.isFinite(decimal) && decimal > 1) return decimal;
  if (american == null || !Number.isFinite(american) || american === 0) return null;
  return american < 0 ? 1 + 100 / Math.abs(american) : 1 + american / 100;
}

function timeOf(v: string | Date | null | undefined): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

export function oppositeSide(side: string | null | undefined): 'over' | 'under' | null {
  const s = (side ?? '').trim().toLowerCase();
  return s === 'over' ? 'under' : s === 'under' ? 'over' : null;
}

/**
 * The arb this row forms with the best fresh opposite-side quote at another book, or null.
 * `others` may hold quotes for both sides and any books; non-qualifying ones are ignored.
 */
export function findArb(row: ArbQuote, others: ArbQuote[], maxGapMinutes = ARB_MAX_QUOTE_GAP_MINUTES): PropsExplorerArb | null {
  const other = oppositeSide(row.side);
  const own = toDecimalOdds(row.oddsDecimal, row.oddsAmerican);
  const at = timeOf(row.snapshotAt);
  if (!other || own == null || at == null) return null;
  const book = (row.sportsbook ?? '').trim().toLowerCase();
  let best: { q: ArbQuote; dec: number; gap: number } | null = null;
  for (const q of others) {
    if ((q.side ?? '').trim().toLowerCase() !== other) continue;
    if ((q.sportsbook ?? '').trim().toLowerCase() === book) continue;
    const dec = toDecimalOdds(q.oddsDecimal, q.oddsAmerican);
    const t = timeOf(q.snapshotAt);
    if (dec == null || t == null) continue;
    const gap = Math.abs(t - at) / 60000;
    if (gap > maxGapMinutes) continue;
    if (!best || dec > best.dec) best = { q, dec, gap };
  }
  if (!best) return null;
  const total = 1 / own + 1 / best.dec;
  if (total >= 1) return null;
  return {
    profit: 1 / total - 1,
    otherSide: other,
    otherSportsbook: best.q.sportsbook ?? null,
    otherOddsAmerican: best.q.oddsAmerican ?? null,
    otherOddsDecimal: best.dec,
    stakeShare: 1 / own / total,
    quoteGapMinutes: best.gap,
  };
}

export function formatArbProfit(profit: number): string {
  return `Arb +${(profit * 100).toFixed(1)}%`;
}

/**
 * Plain-language instructions for a $100 total stake, e.g.
 * "Bet $52 on Over at DraftKings and $48 on Under −105 at FanDuel. Either result returns about $101.20."
 */
export function arbInstructions(args: {
  arb: PropsExplorerArb;
  side: string | null;
  sportsbook: string | null;
  bookName: (book: string | null) => string;
  formatOdds: (american: number | null) => string;
}): string {
  const { arb } = args;
  const thisStake = Math.round(arb.stakeShare * 100);
  const otherStake = 100 - thisStake;
  const sideLabel = (s: string | null) => (s ?? '').charAt(0).toUpperCase() + (s ?? '').slice(1).toLowerCase();
  const payout = (100 * (1 + arb.profit)).toFixed(2);
  return (
    `Bet $${thisStake} on ${sideLabel(args.side)} at ${args.bookName(args.sportsbook)} and $${otherStake} on ` +
    `${sideLabel(arb.otherSide)} ${args.formatOdds(arb.otherOddsAmerican)} at ${args.bookName(arb.otherSportsbook)}. ` +
    `Either result returns about $${payout}.`
  );
}

export const ARB_EMPTY_COPY = {
  title: 'No arbitrage right now',
  detail:
    "Arbs are flagged on upcoming games when two books' prices on opposite sides add up to under 100%. They are rare and close fast; try all books or check back after the next price pull.",
};

export const ARB_TITLE =
  'Arbitrage: this price and the best price on the other side at another book add up to under 100%, so betting both returns the same amount either way. Both quotes were captured within 10 minutes of each other. Prices move and books limit arbitrage bettors, so confirm both prices before betting. Player-did-not-play rules differ by book.';
