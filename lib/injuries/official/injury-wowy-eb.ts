/**
 * Injury-conditioned WOWY empirical-Bayes helpers (Phase 6D / 6C.1).
 * Pure math — no DB/network.
 */

export const Z_CRITICAL = 1.959963984540054;
export const INTERVAL_LEVEL = 0.95;
export const MIN_PRIOR_PAIRS = 20;
export const MIN_POOLED_RESIDUAL_DF = 20;

export type VarianceSource =
  | 'OBSERVED_SAMPLE_VARIANCE'
  | 'POOLED_SINGLETON_FALLBACK'
  | 'POOLED_ZERO_VARIANCE_FALLBACK';

export function sampleVarianceDdof1(values: readonly number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  let sum = 0;
  for (const x of values) sum += x;
  const mean = sum / n;
  let sse = 0;
  for (const x of values) {
    const d = x - mean;
    sse += d * d;
  }
  return sse / (n - 1);
}

export function pooledResidualVariance(
  cells: ReadonlyArray<{ n: number; sse: number }>
): { sigma2Pool: number | null; pooledResidualDf: number } {
  let sseSum = 0;
  let dfSum = 0;
  for (const c of cells) {
    if (c.n < 2) continue;
    sseSum += c.sse;
    dfSum += c.n - 1;
  }
  if (dfSum < MIN_POOLED_RESIDUAL_DF) {
    return { sigma2Pool: null, pooledResidualDf: dfSum };
  }
  const sigma2 = sseSum / dfSum;
  if (!Number.isFinite(sigma2) || !(sigma2 > 0)) {
    return { sigma2Pool: null, pooledResidualDf: dfSum };
  }
  return { sigma2Pool: sigma2, pooledResidualDf: dfSum };
}

export function resolveStateVariance(
  n: number,
  observedS2: number | null,
  sigma2Pool: number | null
): { varianceUsed: number | null; varianceSource: VarianceSource | null } {
  if (n <= 0) return { varianceUsed: null, varianceSource: null };
  if (n === 1) {
    if (sigma2Pool == null) return { varianceUsed: null, varianceSource: null };
    return { varianceUsed: sigma2Pool, varianceSource: 'POOLED_SINGLETON_FALLBACK' };
  }
  if (observedS2 != null && Number.isFinite(observedS2) && observedS2 > 0) {
    return { varianceUsed: observedS2, varianceSource: 'OBSERVED_SAMPLE_VARIANCE' };
  }
  if (sigma2Pool == null) return { varianceUsed: null, varianceSource: null };
  return { varianceUsed: sigma2Pool, varianceSource: 'POOLED_ZERO_VARIANCE_FALLBACK' };
}

export function samplingVarianceDelta(
  s2Without: number,
  withoutN: number,
  s2With: number,
  withN: number
): number | null {
  if (!(withoutN > 0) || !(withN > 0)) return null;
  const v = s2Without / withoutN + s2With / withN;
  if (!Number.isFinite(v) || !(v > 0)) return null;
  return v;
}

export type PriorEstimate = {
  priorPairCount: number;
  pooledResidualDf: number;
  sigma2Pool: number | null;
  mu0: number | null;
  tau2: number | null;
  estimable: boolean;
};

/** DerSimonian–Laird τ² + random-effects μ0 (amendment M1). */
export function estimateDlPrior(
  pairs: ReadonlyArray<{ y: number; v: number }>,
  sigma2Pool: number | null,
  pooledResidualDf: number
): PriorEstimate {
  if (sigma2Pool == null || pooledResidualDf < MIN_POOLED_RESIDUAL_DF) {
    return {
      priorPairCount: 0,
      pooledResidualDf,
      sigma2Pool,
      mu0: null,
      tau2: null,
      estimable: false,
    };
  }
  const ys: number[] = [];
  const vs: number[] = [];
  for (const p of pairs) {
    if (!Number.isFinite(p.y) || !Number.isFinite(p.v) || !(p.v > 0)) continue;
    ys.push(p.y);
    vs.push(p.v);
  }
  const k = ys.length;
  if (k < MIN_PRIOR_PAIRS) {
    return {
      priorPairCount: k,
      pooledResidualDf,
      sigma2Pool,
      mu0: null,
      tau2: null,
      estimable: false,
    };
  }
  const w = vs.map((v) => 1 / v);
  const sw = w.reduce((a, b) => a + b, 0);
  const muFe = w.reduce((acc, wi, i) => acc + wi * ys[i]!, 0) / sw;
  const Q = w.reduce((acc, wi, i) => {
    const d = ys[i]! - muFe;
    return acc + wi * d * d;
  }, 0);
  const sumW2 = w.reduce((a, wi) => a + wi * wi, 0);
  const C = sw - sumW2 / sw;
  if (!Number.isFinite(C) || !(C > 0)) {
    return {
      priorPairCount: k,
      pooledResidualDf,
      sigma2Pool,
      mu0: null,
      tau2: null,
      estimable: false,
    };
  }
  const tau2 = Math.max(0, (Q - (k - 1)) / C);
  if (!Number.isFinite(tau2) || !(tau2 > 0)) {
    return {
      priorPairCount: k,
      pooledResidualDf,
      sigma2Pool,
      mu0: null,
      tau2: null,
      estimable: false,
    };
  }
  const a = vs.map((v) => 1 / (v + tau2));
  const sa = a.reduce((x, y) => x + y, 0);
  const mu0 = a.reduce((acc, ai, i) => acc + ai * ys[i]!, 0) / sa;
  if (!Number.isFinite(mu0)) {
    return {
      priorPairCount: k,
      pooledResidualDf,
      sigma2Pool,
      mu0: null,
      tau2: null,
      estimable: false,
    };
  }
  return {
    priorPairCount: k,
    pooledResidualDf,
    sigma2Pool,
    mu0,
    tau2,
    estimable: true,
  };
}

export type EbPosterior = {
  dataWeight: number;
  priorWeight: number;
  estimatedDelta: number;
  posteriorVariance: number;
  intervalLow: number;
  intervalHigh: number;
};

/** M5 data_weight = τ²/(τ²+v); EB = dw*y + pw*μ0. */
export function ebPosterior(y: number, v: number, mu0: number, tau2: number): EbPosterior | null {
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(v) ||
    !(v > 0) ||
    !Number.isFinite(mu0) ||
    !Number.isFinite(tau2) ||
    !(tau2 > 0)
  ) {
    return null;
  }
  const dataWeight = tau2 / (tau2 + v);
  const priorWeight = v / (tau2 + v);
  if (!Number.isFinite(dataWeight) || !(dataWeight > 0 && dataWeight < 1)) return null;
  const estimatedDelta = dataWeight * y + priorWeight * mu0;
  const posteriorVariance = (tau2 * v) / (tau2 + v);
  if (!Number.isFinite(estimatedDelta) || !Number.isFinite(posteriorVariance) || !(posteriorVariance > 0)) {
    return null;
  }
  const se = Math.sqrt(posteriorVariance);
  const intervalLow = estimatedDelta - Z_CRITICAL * se;
  const intervalHigh = estimatedDelta + Z_CRITICAL * se;
  if (!Number.isFinite(intervalLow) || !Number.isFinite(intervalHigh)) return null;
  return { dataWeight, priorWeight, estimatedDelta, posteriorVariance, intervalLow, intervalHigh };
}
