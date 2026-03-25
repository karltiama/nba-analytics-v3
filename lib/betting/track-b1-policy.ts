/**
 * Track B.1: stability-aware recency weighting, sigma shrinkage, and combo honesty.
 * Constants are explicit for tuning; logic stays linear and explainable.
 */

import type { GameLog } from '@/lib/players/types';

export type PropStatSeriesKey = 'pts' | 'reb' | 'ast' | 'threes' | 'pra' | 'pa' | 'pr' | 'ra';

/** Max L5 blend weight when fully stable (matches legacy 0.45 cap). */
export const W_L5_MAX = 0.45;

/** Extra sigma multiplier for combo props (honesty layer). */
export const COMBO_SIGMA_MULT = 1.28;

/** Minimum games in window to trust sample fully for L5 weight. */
const SAMPLE_FULL = 10;

/** Minutes CV above this strongly damps L5. */
const MINUTES_CV_DAMP_THRESHOLD = 0.35;

/** Stat coefficient of variation (std/|mean|) above this damps L5. */
const STAT_CV_DAMP_THRESHOLD = 0.45;

const EPS_MEAN = 0.5;

export interface StabilitySignals {
  sampleGamesUsed: number;
  minutesCv: number | null;
  minutesStabilityScore: number | null;
  statCoeffVar: number | null;
}

export interface EffectiveStdDevResult {
  stdDev: number;
  comboSigmaMultiplierApplied: number;
  reliabilityShrinkSummary: string;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function parseMinutes(m: number | string | null | undefined): number | null {
  if (m == null) return null;
  const n = typeof m === 'string' ? parseFloat(m) : m;
  if (!Number.isFinite(n)) return null;
  return n;
}

function gameStatValue(g: GameLog, stat: PropStatSeriesKey): number | null {
  const p = g.points ?? 0;
  const r = g.rebounds ?? 0;
  const a = g.assists ?? 0;
  const t = g.three_pointers_made ?? 0;
  switch (stat) {
    case 'pts':
      return g.points != null && Number.isFinite(g.points) ? g.points : null;
    case 'reb':
      return g.rebounds != null && Number.isFinite(g.rebounds) ? g.rebounds : null;
    case 'ast':
      return g.assists != null && Number.isFinite(g.assists) ? g.assists : null;
    case 'threes':
      return g.three_pointers_made != null && Number.isFinite(g.three_pointers_made)
        ? g.three_pointers_made
        : null;
    case 'pra':
      return p + r + a;
    case 'pa':
      return p + a;
    case 'pr':
      return p + r;
    case 'ra':
      return r + a;
    default:
      return null;
  }
}

export function isComboPropType(propType: string): boolean {
  const k = (propType ?? '').toLowerCase().trim();
  if (
    k === 'points_rebounds_assists' ||
    k === 'pra' ||
    k === 'points_assists' ||
    k === 'points_rebounds' ||
    k === 'rebounds_assists'
  )
    return true;
  if (k.includes('points_rebounds_assists') || k.includes('_pra')) return true;
  if (k.includes('points_assists') || k.includes('assists_points')) return true;
  if (k.includes('points_rebounds') || k.includes('rebounds_points')) return true;
  if (k.includes('rebounds_assists') || k.includes('assists_rebounds')) return true;
  return false;
}

export function propTypeToStatKey(propType: string): PropStatSeriesKey | null {
  const k = (propType ?? '').toLowerCase().trim();
  const map: Record<string, PropStatSeriesKey> = {
    points: 'pts',
    pts: 'pts',
    rebounds: 'reb',
    reb: 'reb',
    assists: 'ast',
    ast: 'ast',
    threes: 'threes',
    points_assists: 'pa',
    points_rebounds: 'pr',
    rebounds_assists: 'ra',
    points_rebounds_assists: 'pra',
    pra: 'pra',
  };
  if (map[k]) return map[k];
  if (k.includes('points_assists') || k.includes('assists_points')) return 'pa';
  if (k.includes('points_rebounds') || k.includes('rebounds_points')) return 'pr';
  if (k.includes('rebounds_assists') || k.includes('assists_rebounds')) return 'ra';
  if (k.includes('points_rebounds_assists') || k.includes('pra')) return 'pra';
  if (k.includes('rebound')) return 'reb';
  if (k.includes('assist')) return 'ast';
  if (k.includes('three') && !k.includes('assist')) return 'threes';
  if (k.includes('point')) return 'pts';
  return null;
}

/**
 * Build stability signals from up to the first 10 games (most recent first).
 */
export function buildStabilitySignals(games: GameLog[], stat: PropStatSeriesKey): StabilitySignals {
  const window = games.slice(0, 10);
  const minutesNums: number[] = [];
  const statVals: number[] = [];

  for (const g of window) {
    const min = parseMinutes(g.minutes ?? null);
    if (min != null && min >= 0) minutesNums.push(min);
    const sv = gameStatValue(g, stat);
    if (sv != null && Number.isFinite(sv)) statVals.push(sv);
  }

  const sampleGamesUsed = window.filter((g) => {
    const min = parseMinutes(g.minutes ?? null);
    const sv = gameStatValue(g, stat);
    return min != null && sv != null && Number.isFinite(sv);
  }).length;

  let minutesCv: number | null = null;
  if (minutesNums.length >= 2) {
    const mean = minutesNums.reduce((a, b) => a + b, 0) / minutesNums.length;
    const v =
      minutesNums.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / (minutesNums.length - 1);
    const sd = Math.sqrt(Math.max(v, 0));
    minutesCv = mean > EPS_MEAN ? sd / mean : null;
  }

  const minutesStabilityScore =
    minutesCv != null && Number.isFinite(minutesCv) ? clamp01(1 - Math.min(1, minutesCv)) : null;

  let statCoeffVar: number | null = null;
  if (statVals.length >= 2) {
    const mean = statVals.reduce((a, b) => a + b, 0) / statVals.length;
    const v =
      statVals.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / (statVals.length - 1);
    const sd = Math.sqrt(Math.max(v, 0));
    statCoeffVar = Math.abs(mean) > EPS_MEAN ? sd / Math.abs(mean) : null;
  }

  return { sampleGamesUsed, minutesCv, minutesStabilityScore, statCoeffVar };
}

/** Neutral context for offline scripts (no minutes CV in SQL). */
export function neutralStabilitySignals(): StabilitySignals {
  return {
    sampleGamesUsed: 10,
    minutesCv: 0,
    minutesStabilityScore: 1,
    statCoeffVar: 0.2,
  };
}

/**
 * L5 blend weight: 0..W_L5_MAX. Shrinks when sample thin, minutes volatile, stat noisy, or combo.
 */
export function computeL5BlendWeight(signals: StabilitySignals, isCombo: boolean): number {
  const sampleFactor = clamp01(signals.sampleGamesUsed / SAMPLE_FULL);
  let w = W_L5_MAX * sampleFactor;

  if (signals.minutesCv != null && signals.minutesCv > MINUTES_CV_DAMP_THRESHOLD) {
    const over = (signals.minutesCv - MINUTES_CV_DAMP_THRESHOLD) / (1 - MINUTES_CV_DAMP_THRESHOLD);
    w *= 1 - 0.55 * clamp01(over);
  }

  if (signals.statCoeffVar != null && signals.statCoeffVar > STAT_CV_DAMP_THRESHOLD) {
    const over = (signals.statCoeffVar - STAT_CV_DAMP_THRESHOLD) / Math.max(0.5, 1 - STAT_CV_DAMP_THRESHOLD);
    w *= 1 - 0.45 * clamp01(over);
  }

  if (isCombo) w *= 0.72;

  return Math.max(0, Math.min(W_L5_MAX, w));
}

/**
 * Effective std: blend obs with fallback, reliability-shrink toward fallback, floor, combo mult.
 */
export function computeEffectiveStdDevTrackB1(
  fallbackStd: number,
  observedStdDev: number | null | undefined,
  signals: StabilitySignals,
  isCombo: boolean
): EffectiveStdDevResult {
  const obs =
    observedStdDev != null && Number.isFinite(observedStdDev) && observedStdDev > 0
      ? observedStdDev
      : null;

  let blended = obs != null ? 0.65 * obs + 0.35 * fallbackStd : fallbackStd;

  const sampleRel = clamp01(signals.sampleGamesUsed / SAMPLE_FULL);
  const minStab = signals.minutesStabilityScore ?? 0.85;
  const statRel =
    signals.statCoeffVar != null
      ? clamp01(1 - signals.statCoeffVar / Math.max(STAT_CV_DAMP_THRESHOLD * 2, 0.01))
      : 0.9;
  const reliability = sampleRel * (0.5 + 0.5 * minStab) * (0.6 + 0.4 * statRel);
  blended = reliability * blended + (1 - reliability) * fallbackStd;

  let stdDev = Math.max(0.7 * fallbackStd, blended);
  let comboMult = 1;
  if (isCombo) {
    comboMult = COMBO_SIGMA_MULT;
    stdDev *= comboMult;
  }

  const summary = `rel=${reliability.toFixed(2)}|n=${signals.sampleGamesUsed}|comboMult=${comboMult}`;
  return { stdDev, comboSigmaMultiplierApplied: comboMult, reliabilityShrinkSummary: summary };
}

export type ConfidenceTier = 'high' | 'medium' | 'low';

export function computeConfidenceTier(
  isCombo: boolean,
  signals: StabilitySignals
): ConfidenceTier {
  if (isCombo) return 'low';
  if (signals.sampleGamesUsed < 5) return 'low';
  if (signals.sampleGamesUsed < 8) return 'medium';
  if (signals.minutesCv != null && signals.minutesCv > 0.45) return 'low';
  if (signals.minutesCv != null && signals.minutesCv > 0.28) return 'medium';
  if (signals.statCoeffVar != null && signals.statCoeffVar > 0.55) return 'low';
  if (signals.statCoeffVar != null && signals.statCoeffVar > 0.35) return 'medium';
  return 'high';
}
