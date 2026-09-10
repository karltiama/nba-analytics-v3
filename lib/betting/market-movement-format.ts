/**
 * Display formatters for certified Market Movement v1.
 * Domain values stay on the API; this module only formats them.
 */

export const MISSING_VALUE = '—';

export function formatAmericanOdds(odds: number | null | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return MISSING_VALUE;
  return odds > 0 ? `+${odds}` : String(odds);
}

export function formatMarketLine(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return MISSING_VALUE;
  return String(value);
}

/** Signed consensus/line delta. Never fabricates 0 from null. */
export function formatSignedLineDelta(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta)) return MISSING_VALUE;
  if (delta === 0) return '0';
  return `${delta > 0 ? '+' : ''}${delta}`;
}

/**
 * Decimal probability delta (0.024) → `+2.4 pp`.
 * Returns null when missing or rounds to 0.0 so Quiet rows stay quiet.
 */
export function formatImpliedProbabilityDeltaPp(delta: number | null | undefined): string | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  const rounded = Math.round(delta * 1000) / 10;
  if (rounded === 0) return null;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} pp`;
}

export function formatBookCount(count: number): string {
  return count === 1 ? '1 book' : `${count} books`;
}

/** Min–max span without book count. */
export function formatConsensusSpan(min: number | null, max: number | null): string | null {
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) return formatMarketLine(min);
  return `${formatMarketLine(min)}–${formatMarketLine(max)}`;
}

export function formatConsensusRange(input: {
  min: number | null;
  max: number | null;
  bookCount: number;
}): string | null {
  const span = formatConsensusSpan(input.min, input.max);
  if (!span) return null;
  const books = formatBookCount(input.bookCount);
  if (input.min === input.max) return `${span} · ${books}`;
  return `${span} range · ${books}`;
}

export function formatSnapshotQuote(
  line: number | null | undefined,
  odds: number | null | undefined
): string {
  const lineLabel = formatMarketLine(line);
  if (lineLabel === MISSING_VALUE) return MISSING_VALUE;
  const oddsLabel = formatAmericanOdds(odds);
  return oddsLabel === MISSING_VALUE ? lineLabel : `${lineLabel} ${oddsLabel}`;
}
