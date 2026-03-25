/**
 * Simple baseline player prop probability model for EV calculation.
 * No ML; projection = 0.7 * L10 + 0.3 * season; fixed std by prop type; Normal CDF.
 */

import type { StabilitySignals } from '@/lib/betting/track-b1-policy';
import {
  computeEffectiveStdDevTrackB1,
  computeL5BlendWeight,
  isComboPropType,
  neutralStabilitySignals,
} from '@/lib/betting/track-b1-policy';

/**
 * Projection = 0.7 * last10Avg + 0.3 * seasonAvg
 */
export function computeProjection(last10Avg: number, seasonAvg: number): number {
  return 0.7 * last10Avg + 0.3 * seasonAvg;
}

const STD_BY_PROP: Record<string, number> = {
  points: 6,
  pts: 6,
  rebounds: 3,
  reb: 3,
  assists: 2.5,
  ast: 2.5,
  threes: 1.5,
  points_assists: 7,
  points_rebounds: 7,
  rebounds_assists: 4.5,
  points_rebounds_assists: 8,
  pra: 8,
};

const DEFAULT_STD = 5;
const MAX_ABS_Z = 3.0;
const PROB_FLOOR = 0.03;
const PROB_CEIL = 0.97;

/**
 * Fixed standard deviation by prop type (lowercase).
 */
export function getStdDev(propType: string): number {
  const key = (propType ?? '').toLowerCase().trim();
  return STD_BY_PROP[key] ?? DEFAULT_STD;
}

/**
 * Standard normal CDF (mean 0, std 1). Abramowitz & Stegun approximation.
 */
function normCdf(z: number): number {
  if (z <= -6) return 0;
  if (z >= 6) return 1;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d =
    0.3989423 *
    Math.exp((-z * z) / 2) *
    (0.3193815 * t - 0.3565638 * t * t + 1.781478 * t * t * t - 1.821256 * t * t * t * t + 1.330274 * t * t * t * t * t);
  return z >= 0 ? 1 - d : d;
}

/**
 * P(stat > line) assuming Normal(projection, stdDev).
 * z = (line - projection) / stdDev; then P(X > line) = 1 - normCdf(z).
 */
export function computeProbability(projection: number, line: number, stdDev: number): number {
  if (!Number.isFinite(stdDev) || stdDev <= 0) return 0.5;
  // Guardrail: cap tail confidence from extreme projection-line gaps.
  const rawZ = (line - projection) / stdDev;
  const z = Math.max(-MAX_ABS_Z, Math.min(MAX_ABS_Z, rawZ));
  const p = 1 - normCdf(z);
  return Math.max(PROB_FLOOR, Math.min(PROB_CEIL, p));
}

export interface PlayerPropProbabilityInput {
  last10Avg: number;
  seasonAvg: number;
  line: number;
  propType: string;
  last5Avg?: number;
  observedStdDev?: number | null;
}

export interface PlayerPropProbabilityOutput {
  projection: number;
  probability: number;
  /** Track B.1 diagnostics (present when upgraded / B.1 path). */
  sigmaEffective?: number;
  reliabilityShrinkSummary?: string;
  comboSigmaMultiplierApplied?: number;
}

export interface TrackB1Context {
  signals: StabilitySignals;
  isCombo: boolean;
}

/**
 * Wrapper: projection + P(stat > line).
 */
export function computePlayerPropProbability(
  input: PlayerPropProbabilityInput
): PlayerPropProbabilityOutput {
  const { last10Avg, seasonAvg, line, propType } = input;
  const projection = computeProjection(last10Avg, seasonAvg);
  const stdDev = getStdDev(propType);
  const probability = computeProbability(projection, line, stdDev);
  return { projection, probability };
}

/**
 * Track B.1: stability-weighted L5 blend, effective σ with reliability shrink + combo multiplier.
 */
export function computeTrackB1PlayerPropProbability(
  input: PlayerPropProbabilityInput,
  context: TrackB1Context
): PlayerPropProbabilityOutput {
  const { last10Avg, seasonAvg, line, propType, last5Avg, observedStdDev } = input;
  const { signals, isCombo } = context;
  const wL5 = computeL5BlendWeight(signals, isCombo);
  const baseProjection = computeProjection(last10Avg, seasonAvg);
  const projection = Number.isFinite(last5Avg as number)
    ? (1 - wL5) * baseProjection + wL5 * (last5Avg as number)
    : baseProjection;

  const fallbackStd = getStdDev(propType);
  const { stdDev, comboSigmaMultiplierApplied, reliabilityShrinkSummary } =
    computeEffectiveStdDevTrackB1(fallbackStd, observedStdDev, signals, isCombo);
  const probability = computeProbability(projection, line, stdDev);
  return {
    projection,
    probability,
    sigmaEffective: stdDev,
    reliabilityShrinkSummary,
    comboSigmaMultiplierApplied,
  };
}

/**
 * Dynamic sigma upgrade (Track B.1). Pass `stabilitySignals` from game logs; omit for neutral offline defaults.
 */
export function computeUpgradedPlayerPropProbability(
  input: PlayerPropProbabilityInput,
  stabilitySignals?: StabilitySignals | null
): PlayerPropProbabilityOutput {
  const signals = stabilitySignals ?? neutralStabilitySignals();
  const isCombo = isComboPropType(input.propType);
  return computeTrackB1PlayerPropProbability(input, { signals, isCombo });
}
