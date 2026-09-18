/**
 * Injury-conditioned WOWY estimator v1 (Phase 6D).
 * RAW_PAIR_DIFFERENCE + C1 EB normal-normal per Phase 6C + 6C.1 amendment.
 * Pure — no DB/network. game_start must be supplied on each observation.
 */

import {
  INTERVAL_LEVEL,
  ebPosterior,
  estimateDlPrior,
  pooledResidualVariance,
  resolveStateVariance,
  sampleVarianceDdof1,
  samplingVarianceDelta,
  type PriorEstimate,
  type VarianceSource,
} from './injury-wowy-eb';

export const INJURY_WOWY_ESTIMATOR_VERSION = 'injury-wowy-estimator-v1' as const;
export const INJURY_WOWY_PAIR_POLICY_VERSION = 'injury-wowy-pair-policy-v1' as const;

export const ESTIMATOR_METRICS = [
  'minutes',
  'pts',
  'reb',
  'ast',
  'tpm',
  'fga',
  'tpa',
  'fta',
] as const;

export type EstimatorMetric = (typeof ESTIMATOR_METRICS)[number];
export type CohortPolicy = 'P0' | 'P1' | 'P2' | 'P3';
export type EstimatorMode = 'RESEARCH_FULL_HISTORY' | 'PRODUCTION_AS_OF';
export type EstimationStatus =
  | 'NO_HISTORY'
  | 'ONE_SIDED_HISTORY'
  | 'PRIOR_NOT_ESTIMABLE'
  | 'SPARSE_BOTH_STATES'
  | 'PAIR_ESTIMATE_AVAILABLE';

export type EstimatorObservation = {
  game_id: string;
  game_start: string;
  season: string;
  team_id: string;
  subject_player_entity_id: string;
  focal_player_entity_id: string;
  focal_state: 'PRE_GAME_AVAILABLE' | 'PRE_GAME_OUT';
  subject_metrics: Record<string, number | null>;
  cohort_p0?: boolean;
  cohort_p1?: boolean;
  cohort_p2?: boolean;
  cohort_p3?: boolean;
};

export type PairKey = {
  season: string;
  team_id: string;
  subject_player_entity_id: string;
  focal_player_entity_id: string;
};

export type EstimatorResult = {
  estimator_version: typeof INJURY_WOWY_ESTIMATOR_VERSION;
  pair_policy_version: typeof INJURY_WOWY_PAIR_POLICY_VERSION;
  mode: EstimatorMode;
  as_of: string | null;
  cohort_policy: CohortPolicy;
  season: string;
  team_id: string;
  subject_player_entity_id: string;
  focal_player_entity_id: string;
  metric: EstimatorMetric;
  with_n: number;
  without_n: number;
  with_mean: number | null;
  without_mean: number | null;
  raw_delta: number | null;
  with_variance_used: number | null;
  without_variance_used: number | null;
  with_variance_source: VarianceSource | null;
  without_variance_source: VarianceSource | null;
  sampling_variance: number | null;
  prior_pair_count: number;
  pooled_residual_df: number;
  pooled_residual_variance: number | null;
  prior_mean: number | null;
  prior_variance: number | null;
  data_weight: number | null;
  prior_weight: number | null;
  estimated_delta: number | null;
  posterior_variance: number | null;
  interval_level: number;
  interval_low: number | null;
  interval_high: number | null;
  estimation_status: EstimationStatus;
  quality_tier: 'Q0' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
  ui_display_eligible: boolean;
  sign_convention: 'WITHOUT_MINUS_WITH';
};

function cohortOk(o: EstimatorObservation, cohort: CohortPolicy): boolean {
  const map: Record<CohortPolicy, boolean | undefined> = {
    P0: o.cohort_p0,
    P1: o.cohort_p1,
    P2: o.cohort_p2,
    P3: o.cohort_p3,
  };
  const v = map[cohort];
  return v === undefined ? true : Boolean(v);
}

export function assertMetric(metric: string): asserts metric is EstimatorMetric {
  if (!(ESTIMATOR_METRICS as readonly string[]).includes(metric)) {
    throw new Error(`unsupported estimator metric: ${metric}`);
  }
}

export function filterObservationsForWindow(
  observations: readonly EstimatorObservation[],
  opts: { cohort: CohortPolicy; mode: EstimatorMode; as_of: string | null }
): EstimatorObservation[] {
  if (opts.mode === 'PRODUCTION_AS_OF') {
    if (opts.as_of == null) throw new Error('PRODUCTION_AS_OF requires as_of');
  } else if (opts.as_of != null) {
    throw new Error('RESEARCH_FULL_HISTORY requires as_of=null');
  }
  const out: EstimatorObservation[] = [];
  for (const o of observations) {
    if (!cohortOk(o, opts.cohort)) continue;
    if (opts.mode === 'PRODUCTION_AS_OF') {
      if (!(o.game_start < opts.as_of!)) continue;
    }
    out.push(o);
  }
  return out;
}

export function rawDeltaFromMeans(withoutMean: number, withMean: number): number {
  return withoutMean - withMean;
}

type Cell = { n: number; mean: number; sse: number; sampleVar: number | null; values: number[] };

function cellKey(o: EstimatorObservation, state: string): string {
  return `${o.season}\0${o.team_id}\0${o.subject_player_entity_id}\0${o.focal_player_entity_id}\0${state}`;
}

function pairKeyStr(o: EstimatorObservation): string {
  return `${o.season}\0${o.team_id}\0${o.subject_player_entity_id}\0${o.focal_player_entity_id}`;
}

function parsePairKey(s: string): PairKey {
  const [season, team_id, subject_player_entity_id, focal_player_entity_id] = s.split('\0');
  return { season: season!, team_id: team_id!, subject_player_entity_id: subject_player_entity_id!, focal_player_entity_id: focal_player_entity_id! };
}

function buildCells(obs: readonly EstimatorObservation[], metric: EstimatorMetric): Map<string, Cell> {
  const buckets = new Map<string, number[]>();
  for (const o of obs) {
    const raw = o.subject_metrics[metric];
    if (raw == null || !Number.isFinite(Number(raw))) continue;
    const k = cellKey(o, o.focal_state);
    const arr = buckets.get(k) ?? [];
    arr.push(Number(raw));
    buckets.set(k, arr);
  }
  const cells = new Map<string, Cell>();
  for (const [k, values] of buckets) {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    let sse = 0;
    for (const x of values) {
      const d = x - mean;
      sse += d * d;
    }
    const sampleVar = n >= 2 ? sse / (n - 1) : null;
    cells.set(k, { n, mean, sse, sampleVar, values });
  }
  return cells;
}

type PairRaw = {
  with_n: number;
  without_n: number;
  with_mean: number | null;
  without_mean: number | null;
  raw_delta: number | null;
  with_variance_used: number | null;
  without_variance_used: number | null;
  with_variance_source: VarianceSource | null;
  without_variance_source: VarianceSource | null;
  sampling_variance: number | null;
};

function pairRawFromCells(cells: Map<string, Cell>, pk: string, sigma2Pool: number | null): PairRaw {
  const avail = cells.get(`${pk}\0PRE_GAME_AVAILABLE`);
  const out = cells.get(`${pk}\0PRE_GAME_OUT`);
  const withN = avail?.n ?? 0;
  const withoutN = out?.n ?? 0;
  const withMean = avail ? avail.mean : null;
  const withoutMean = out ? out.mean : null;
  const wr = resolveStateVariance(withN, avail?.sampleVar ?? null, sigma2Pool);
  const wor = resolveStateVariance(withoutN, out?.sampleVar ?? null, sigma2Pool);
  let raw: number | null = null;
  let v: number | null = null;
  if (withN > 0 && withoutN > 0 && withMean != null && withoutMean != null) {
    raw = rawDeltaFromMeans(withoutMean, withMean);
    if (wr.varianceUsed != null && wor.varianceUsed != null) {
      v = samplingVarianceDelta(wor.varianceUsed, withoutN, wr.varianceUsed, withN);
    }
  }
  return {
    with_n: withN,
    without_n: withoutN,
    with_mean: withMean,
    without_mean: withoutMean,
    raw_delta: raw,
    with_variance_used: wr.varianceUsed,
    without_variance_used: wor.varianceUsed,
    with_variance_source: wr.varianceSource,
    without_variance_source: wor.varianceSource,
    sampling_variance: v,
  };
}

export function qualityTier(status: EstimationStatus, withN: number, withoutN: number): EstimatorResult['quality_tier'] {
  if (status === 'NO_HISTORY' || status === 'ONE_SIDED_HISTORY' || status === 'PRIOR_NOT_ESTIMABLE') {
    return 'Q0';
  }
  const m = Math.min(withN, withoutN);
  if (m === 1) return 'Q1';
  if (m === 2) return 'Q2';
  if (m === 3 || m === 4) return 'Q3';
  return 'Q4';
}

function emptyResult(
  partial: Omit<
    EstimatorResult,
    | 'data_weight'
    | 'prior_weight'
    | 'estimated_delta'
    | 'posterior_variance'
    | 'interval_low'
    | 'interval_high'
    | 'estimation_status'
    | 'quality_tier'
    | 'ui_display_eligible'
  > & {
    estimation_status: EstimationStatus;
  }
): EstimatorResult {
  return {
    ...partial,
    data_weight: null,
    prior_weight: null,
    estimated_delta: null,
    posterior_variance: null,
    interval_low: null,
    interval_high: null,
    quality_tier: qualityTier(partial.estimation_status, partial.with_n, partial.without_n),
    ui_display_eligible: partial.estimation_status === 'PAIR_ESTIMATE_AVAILABLE',
  };
}

export function finalizePairEstimate(
  pr: PairRaw,
  prior: PriorEstimate,
  meta: {
    mode: EstimatorMode;
    as_of: string | null;
    cohort: CohortPolicy;
    pair: PairKey;
    metric: EstimatorMetric;
  }
): EstimatorResult {
  const base = {
    estimator_version: INJURY_WOWY_ESTIMATOR_VERSION,
    pair_policy_version: INJURY_WOWY_PAIR_POLICY_VERSION,
    mode: meta.mode,
    as_of: meta.as_of,
    cohort_policy: meta.cohort,
    season: meta.pair.season,
    team_id: meta.pair.team_id,
    subject_player_entity_id: meta.pair.subject_player_entity_id,
    focal_player_entity_id: meta.pair.focal_player_entity_id,
    metric: meta.metric,
    with_n: pr.with_n,
    without_n: pr.without_n,
    with_mean: pr.with_mean,
    without_mean: pr.without_mean,
    raw_delta: pr.raw_delta,
    with_variance_used: pr.with_variance_used,
    without_variance_used: pr.without_variance_used,
    with_variance_source: pr.with_variance_source,
    without_variance_source: pr.without_variance_source,
    sampling_variance: pr.sampling_variance,
    prior_pair_count: prior.priorPairCount,
    pooled_residual_df: prior.pooledResidualDf,
    pooled_residual_variance: prior.sigma2Pool,
    prior_mean: prior.mu0,
    prior_variance: prior.tau2,
    interval_level: INTERVAL_LEVEL,
    sign_convention: 'WITHOUT_MINUS_WITH' as const,
  };

  if (pr.with_n === 0 && pr.without_n === 0) {
    return emptyResult({ ...base, estimation_status: 'NO_HISTORY' });
  }
  if (pr.with_n === 0 || pr.without_n === 0) {
    return emptyResult({ ...base, estimation_status: 'ONE_SIDED_HISTORY' });
  }
  if (!prior.estimable || pr.raw_delta == null || pr.sampling_variance == null || prior.mu0 == null || prior.tau2 == null) {
    return emptyResult({ ...base, estimation_status: 'PRIOR_NOT_ESTIMABLE' });
  }
  const post = ebPosterior(pr.raw_delta, pr.sampling_variance, prior.mu0, prior.tau2);
  if (!post) {
    return emptyResult({ ...base, estimation_status: 'PRIOR_NOT_ESTIMABLE' });
  }
  const status: EstimationStatus =
    Math.min(pr.with_n, pr.without_n) < 3 ? 'SPARSE_BOTH_STATES' : 'PAIR_ESTIMATE_AVAILABLE';
  return {
    ...base,
    data_weight: post.dataWeight,
    prior_weight: post.priorWeight,
    estimated_delta: post.estimatedDelta,
    posterior_variance: post.posteriorVariance,
    interval_low: post.intervalLow,
    interval_high: post.intervalHigh,
    estimation_status: status,
    quality_tier: qualityTier(status, pr.with_n, pr.without_n),
    ui_display_eligible: status === 'PAIR_ESTIMATE_AVAILABLE',
  };
}

export type WindowModel = {
  prior: PriorEstimate;
  pairs: Map<string, PairRaw>;
  maxTrainingGameStart: string | null;
  filteredCount: number;
};

export function buildEstimatorWindow(
  observations: readonly EstimatorObservation[],
  opts: { metric: EstimatorMetric; cohort: CohortPolicy; mode: EstimatorMode; as_of: string | null }
): WindowModel {
  assertMetric(opts.metric);
  const filtered = filterObservationsForWindow(observations, opts);
  const cells = buildCells(filtered, opts.metric);
  const poolCells = [...cells.values()].map((c) => ({ n: c.n, sse: c.sse }));
  const { sigma2Pool, pooledResidualDf } = pooledResidualVariance(poolCells);
  const pairKeys = new Set<string>();
  for (const k of cells.keys()) {
    const pk = k.split('\0').slice(0, 4).join('\0');
    pairKeys.add(pk);
  }
  const pairs = new Map<string, PairRaw>();
  for (const pk of pairKeys) {
    pairs.set(pk, pairRawFromCells(cells, pk, sigma2Pool));
  }
  const priorPairs: Array<{ y: number; v: number }> = [];
  for (const pr of pairs.values()) {
    if (pr.with_n < 1 || pr.without_n < 1) continue;
    if (pr.raw_delta == null || pr.sampling_variance == null) continue;
    priorPairs.push({ y: pr.raw_delta, v: pr.sampling_variance });
  }
  const prior = estimateDlPrior(priorPairs, sigma2Pool, pooledResidualDf);
  let maxTrainingGameStart: string | null = null;
  for (const o of filtered) {
    if (maxTrainingGameStart == null || o.game_start > maxTrainingGameStart) {
      maxTrainingGameStart = o.game_start;
    }
  }
  return { prior, pairs, maxTrainingGameStart, filteredCount: filtered.length };
}

export function estimatePairFromWindow(
  window: WindowModel,
  pair: PairKey,
  opts: { metric: EstimatorMetric; cohort: CohortPolicy; mode: EstimatorMode; as_of: string | null }
): EstimatorResult {
  const pk = `${pair.season}\0${pair.team_id}\0${pair.subject_player_entity_id}\0${pair.focal_player_entity_id}`;
  const pr = window.pairs.get(pk) ?? {
    with_n: 0,
    without_n: 0,
    with_mean: null,
    without_mean: null,
    raw_delta: null,
    with_variance_used: null,
    without_variance_used: null,
    with_variance_source: null,
    without_variance_source: null,
    sampling_variance: null,
  };
  return finalizePairEstimate(pr, window.prior, { ...opts, pair });
}

export function estimateAllPairsInWindow(
  observations: readonly EstimatorObservation[],
  opts: { metric: EstimatorMetric; cohort: CohortPolicy; mode: EstimatorMode; as_of: string | null }
): { window: WindowModel; results: EstimatorResult[] } {
  const window = buildEstimatorWindow(observations, opts);
  const results: EstimatorResult[] = [];
  const keys = [...window.pairs.keys()].sort();
  for (const pk of keys) {
    results.push(estimatePairFromWindow(window, parsePairKey(pk), opts));
  }
  return { window, results };
}

/** Enumerate all primary keys from observations (any state), then estimate each. */
export function estimatePrimaryKeyUniverse(
  observations: readonly EstimatorObservation[],
  opts: { metric: EstimatorMetric; cohort: CohortPolicy; mode: EstimatorMode; as_of: string | null }
): { window: WindowModel; results: EstimatorResult[] } {
  const filteredForKeys = filterObservationsForWindow(observations, {
    cohort: opts.cohort,
    mode: 'RESEARCH_FULL_HISTORY',
    as_of: null,
  });
  // For PRODUCTION, keys still come from as-of filtered presence; for research use all cohort obs.
  const keySource =
    opts.mode === 'RESEARCH_FULL_HISTORY'
      ? filteredForKeys
      : filterObservationsForWindow(observations, opts);
  const keySet = new Set<string>();
  for (const o of keySource) {
    if (!cohortOk(o, opts.cohort) && opts.mode === 'RESEARCH_FULL_HISTORY') continue;
    keySet.add(pairKeyStr(o));
  }
  // Always include all cohort keys from full corpus listing when research:
  if (opts.mode === 'RESEARCH_FULL_HISTORY') {
    for (const o of observations) {
      if (!cohortOk(o, opts.cohort)) continue;
      keySet.add(pairKeyStr(o));
    }
  }
  const window = buildEstimatorWindow(observations, opts);
  const results: EstimatorResult[] = [];
  for (const pk of [...keySet].sort()) {
    results.push(estimatePairFromWindow(window, parsePairKey(pk), opts));
  }
  return { window, results };
}

export { sampleVarianceDdof1, ebPosterior, estimateDlPrior };
