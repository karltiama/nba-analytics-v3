export type ExplorerValueGrade = 'good' | 'fair' | 'bad' | 'unknown';

/** Same thresholds the explorer table already uses. */
export function explorerValueGrade(ev: number | null | undefined): ExplorerValueGrade {
  if (ev == null || !Number.isFinite(ev)) return 'unknown';
  if (ev > 0.03) return 'good';
  if (ev < -0.02) return 'bad';
  return 'fair';
}

export function explorerValueToneClass(ev: number | null | undefined): string {
  const grade = explorerValueGrade(ev);
  if (grade === 'good') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (grade === 'bad') return 'bg-rose-50 text-rose-800 border-rose-200';
  if (grade === 'fair') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-[#F8FBFA] text-[#4a6366] border-[#DCE9EA]';
}

/** Desktop table copy. Classification is unchanged. */
export function explorerTableValueCopy(
  ev: number | null | undefined,
  marketContext?: 'live' | 'historical'
): string {
  if (marketContext === 'historical') return 'Unavailable';
  const grade = explorerValueGrade(ev);
  if (grade === 'good') return 'Good Value';
  if (grade === 'bad') return 'Bad Value';
  if (grade === 'fair') return 'Fair Value';
  return 'No Signal';
}

/** One-line card label. Same grades, shorter words. */
export function explorerCardValueLabel(
  ev: number | null | undefined,
  marketContext?: 'live' | 'historical'
): string {
  if (marketContext === 'historical') return 'Unavailable';
  const grade = explorerValueGrade(ev);
  if (grade === 'good') return 'Good';
  if (grade === 'bad') return 'Bad';
  if (grade === 'fair') return 'Fair';
  return 'No signal';
}

export function formatExplorerOdds(odds: number | null | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

/** Full name. Missing names fall back to the id. No manual abbreviation. */
export function explorerCardPlayerName(
  playerName: string | null | undefined,
  playerId: number
): string {
  const raw = (playerName ?? '').trim();
  return raw || String(playerId);
}

/**
 * Est. EV text colour follows the sign. Model EV has not beaten the market in backtests,
 * so it lives behind the experimental toggle and is never shown as a default "value" call.
 */
export function explorerEvTextClass(ev: number | null | undefined): string {
  if (ev == null || !Number.isFinite(ev) || Math.abs(ev) < 0.0005) return 'text-[#4a6366]';
  return ev > 0 ? 'text-[#178A45]' : 'text-[#B42318]';
}

/** No-vig fair probability, whole percent. */
export function formatFairProbability(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '—';
  return `${(p * 100).toFixed(1)}%`;
}

/** Plain sample-size label. The old "Confidence" tier only measured sample and minutes stability. */
export function explorerSampleLabel(games: number | null | undefined): string {
  if (games == null || !Number.isFinite(games) || games <= 0) return '—';
  const n = Math.round(games);
  if (n >= 10) return '10+ games';
  return `${n} ${n === 1 ? 'game' : 'games'}`;
}

/** Shape served on each explorer row (see PropsExplorerBestPrice in props-explorer-serving). */
export type ExplorerBestPrice = {
  oddsAmerican: number | null;
  sportsbook: string | null;
  bookCount: number;
  isBest: boolean;
  vsAverage: number | null;
};

/** Payout difference vs the average book, one decimal; null or single-book markets show a dash. */
export function formatVsAverage(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const pct = v * 100;
  if (Math.abs(pct) < 0.05) return '0.0%';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
}

export function vsAverageTextClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.0005) return 'text-[#4a6366]';
  return v > 0 ? 'text-[#178A45]' : 'text-[#8A5A00]';
}

/**
 * Compact best-price cell: "Best of 4" when this row is the best price, "Only book" when no
 * other book quotes the line, otherwise the better price and its book.
 */
export function bestPriceLabel(
  bp: ExplorerBestPrice | null | undefined,
  bookName: (book: string | null) => string
): string {
  if (!bp) return '—';
  if (bp.bookCount <= 1) return 'Only book';
  if (bp.isBest) return `Best of ${bp.bookCount}`;
  return `${formatExplorerOdds(bp.oddsAmerican)} ${bookName(bp.sportsbook)}`;
}

export const BEST_PRICE_TITLE =
  'Best price for this exact line and side across books, or across the books you selected in the filter.';
export const VS_AVERAGE_TITLE =
  'How much more this price pays than the average book for the same line and side. Taking the best price added about 3.5 points of return per bet on 2025-26 closing lines. It is a price comparison, not a prediction.';

export const FAIR_PROBABILITY_TITLE =
  'Sportsbook price with the bookmaker margin removed, using both sides of the same line at the same book.';
export const SAMPLE_TITLE =
  'This-season games behind the stat estimates (window caps at 10). Small samples make every estimate noisier.';
export const EXPERIMENTAL_MODEL_SHOW = 'Show experimental model';
export const EXPERIMENTAL_MODEL_HIDE = 'Hide experimental model';
export const EXPERIMENTAL_MODEL_NOTE =
  'Experimental model. In backtests on 2025-26 closing lines it has not beaten the market price. Not betting advice.';
