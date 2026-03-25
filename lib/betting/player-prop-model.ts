/**
 * Simple baseline player prop probability model for EV calculation.
 * No ML; projection = 0.7 * L10 + 0.3 * season; fixed std by prop type; Normal CDF.
 */

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
  points_rebounds_assists: 8,
  pra: 8,
};

const DEFAULT_STD = 5;

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
  const z = (line - projection) / stdDev;
  return 1 - normCdf(z);
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
 * Dynamic sigma upgrade:
 * - Projection leans slightly more to recent form using last5 if available.
 * - Sigma blends observed short-term volatility with prop defaults.
 */
export function computeUpgradedPlayerPropProbability(
  input: PlayerPropProbabilityInput
): PlayerPropProbabilityOutput {
  const { last10Avg, seasonAvg, line, propType, last5Avg, observedStdDev } = input;
  const baseProjection = computeProjection(last10Avg, seasonAvg);
  const projection = Number.isFinite(last5Avg as number)
    ? 0.55 * baseProjection + 0.45 * (last5Avg as number)
    : baseProjection;

  const fallbackStd = getStdDev(propType);
  const obsStd = observedStdDev != null && Number.isFinite(observedStdDev) && observedStdDev > 0
    ? observedStdDev
    : null;
  const stdDev = obsStd != null ? 0.65 * obsStd + 0.35 * fallbackStd : fallbackStd;
  const probability = computeProbability(projection, line, stdDev);
  return { projection, probability };
}
