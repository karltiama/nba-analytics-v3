/**
 * Centralized display formatting for context-interpretation-v1.
 * Frozen design precision — templates must not choose their own.
 */

import { DISPLAY_PRECISION } from './types';

export function roundToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite value for rounding: ${value}`);
  }
  const f = 10 ** decimals;
  // Half-away-from-zero via epsilon nudge matching common 1dp sports display.
  return Math.round((value + Number.EPSILON * Math.sign(value || 1)) * f) / f;
}

export function formatMinutes(value: number): string {
  return roundToDecimals(value, DISPLAY_PRECISION.minutes).toFixed(1);
}

export function formatCountingAverage(value: number): string {
  return roundToDecimals(value, DISPLAY_PRECISION.countingAverages).toFixed(1);
}

export function formatRating(value: number): string {
  return roundToDecimals(value, DISPLAY_PRECISION.ratings).toFixed(1);
}

/** Fraction 0–1 → "36.6%" */
export function formatRateAsPercent(fraction: number): string {
  const pct = roundToDecimals(fraction * 100, DISPLAY_PRECISION.ratesAsPercent);
  return `${pct.toFixed(1)}%`;
}

/** Absolute percentage-point delta from fraction delta (e.g. 0.006 → "+0.6"). */
export function formatPercentagePointsDelta(fractionDelta: number): string {
  const pp = roundToDecimals(fractionDelta * 100, DISPLAY_PRECISION.percentagePoints);
  const sign = pp > 0 ? '+' : pp < 0 ? '−' : '';
  const abs = Math.abs(pp).toFixed(1);
  return `${sign}${abs}`;
}

export function formatCountingDelta(delta: number): string {
  const d = roundToDecimals(delta, DISPLAY_PRECISION.countingAverages);
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  return `${sign}${Math.abs(d).toFixed(1)}`;
}

export function formatCount(value: number): string {
  return String(Math.trunc(value));
}

/** True when recent and season round to the same display value at 1 decimal. */
export function equalAtDisplayPrecision1(a: number, b: number): boolean {
  return roundToDecimals(a, 1) === roundToDecimals(b, 1);
}

/** Percentage fractions equal at 1 percentage-point display precision. */
export function equalAtPercentagePointPrecision(a: number, b: number): boolean {
  return (
    roundToDecimals(a * 100, DISPLAY_PRECISION.percentagePoints) ===
    roundToDecimals(b * 100, DISPLAY_PRECISION.percentagePoints)
  );
}
