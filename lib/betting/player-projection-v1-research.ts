/**
 * Research-only Court Context player-projection v1 helpers.
 *
 * Frozen mean benchmark: Played-only Track A
 *   0.70 * mean(last 10 PLAYED games) + 0.30 * mean(season PLAYED games)
 *
 * Does NOT change production Track A, APIs, UI, calibration, EV, or serving.
 * Sportsbook / public-betting numbers are never projection inputs here.
 */

import {
  blendTrackA,
  isPlayedGame,
  parseMinutes,
  windowCountingMean,
  windowMinutesMean,
  windowPerMinuteRate,
  type MinutesEvalLog,
} from '@/lib/betting/minutes-projection-eval';
import {
  computeMetricBlock,
  selectPriorGames,
  statFromLog,
  trackAProjection,
  type FeatureDefinition,
  type MetricBlock,
  type SupportedPropType,
  SUPPORTED_PROP_TYPES,
} from '@/lib/betting/player-projection-eval';
import { bootstrapMaeDifference, buildPlayedOnlyAsOfModelInputs } from '@/lib/betting/shadow-projection-eval';
import { propTypeToStatKey } from '@/lib/betting/track-b1-policy';

export const PROJECTION_V1_RESEARCH_VERSION = 'player-projection-v1-minutes-role-r1';
export const BENCHMARK_ID = 'played_track_a' as const;
export const BOOTSTRAP_SEED = 20260914;
export const BOOTSTRAP_ITERS = 400;
export const FEATURE_DEFINITION: FeatureDefinition = 'active_season';

export const PLAYED_ONLY_TRACK_A_DEFINITION = {
  id: BENCHMARK_ID,
  name: 'Played-only Track A',
  formula: '0.70 * mean(last 10 PLAYED games) + 0.30 * mean(season PLAYED games)',
  weights: { l10: 0.7, season: 0.3 },
  playedPredicate:
    'played if parsed minutes > 0, or minutes token is "0" / "0.0"; minutes token "00" is always DNP; real zero-stat appearances with minutes remain included',
  priorRule: 'strictly start_time < target tipoff; active_season only (same analytics.games.season)',
  targetUniverse: 'Final player-games that are played (isPlayedGame) with ≥1 prior played game in-season',
  leakage: 'target-game box, minutes, and starter flag are never inputs',
} as const;

export const CHRONO_SPLIT = {
  train: '2023',
  validation: '2024',
  test: '2025',
} as const;

export type ChronoSplit = 'train' | 'validation' | 'test' | 'excluded';

export const EWM_ALPHAS = [0.25, 0.4, 0.55] as const;
export type EwmAlpha = (typeof EWM_ALPHAS)[number];

export const CLIP_GRIDS = [
  { id: 'clip_080_120', lo: 0.8, hi: 1.2 },
  { id: 'clip_085_115', lo: 0.85, hi: 1.15 },
  { id: 'clip_090_110', lo: 0.9, hi: 1.1 },
] as const;
export type ClipGrid = (typeof CLIP_GRIDS)[number];

/** Do not scale when the L10 minutes reference is this small. */
export const MINUTES_REF_FLOOR = 5;

export const TREND_CLIP = { lo: 0.8, hi: 1.2 } as const;
export const ROLE_STARTER_RATE_HIGH = 0.6;
export const ROLE_STARTER_RATE_LOW = 0.4;
export const ROLE_SHIFT_TAUS = [0.15, 0.2, 0.25] as const;

export const REJECTED_AS_PROJECTION_INPUTS = [
  'target-game box score',
  'target-game minutes',
  'target-game starter / lineup (postgame certified archive)',
  'postgame injury resolution',
  'season aggregates that include future games',
  'closing-market prices as basketball features',
  'historical public-betting percentages (capture timing unknown)',
] as const;

export type RoleLabel = 'starter' | 'bench' | 'unknown';
export type MinutesChangeBucket = 'stable' | 'moderate' | 'large' | 'unknown';
export type VolumeBucket = 'low' | 'rotation' | 'high' | 'unknown';
export type ObservedRoleTransition =
  | 'starter_to_starter'
  | 'bench_to_bench'
  | 'bench_to_starter'
  | 'starter_to_bench'
  | 'unknown';

export interface ProjectionV1Log extends MinutesEvalLog {
  home_team_id: string | null;
  away_team_id: string | null;
  /** Observed starter for THIS game. Safe as a prior-game feature; leakage as a target-game feature. */
  started: RoleLabel;
}

export const MINUTES_ESTIMATOR_IDS = [
  'min_l5',
  'min_l5_season',
  'min_ewm_a025',
  'min_ewm_a040',
  'min_ewm_a055',
  'min_trend',
  'min_role',
] as const;
export type MinutesEstimatorId = (typeof MINUTES_ESTIMATOR_IDS)[number];

export const CANDIDATE_FAMILY_IDS = [
  BENCHMARK_ID,
  'a_l5_over_l10',
  'a_l5_season_over_l10',
  'a_ewm_over_l10',
  'a_trend_over_l10',
  'a_role_over_l10',
  'b_l5_x_season_rate',
  'b_l5_x_l10_rate',
  'b_l5_x_blended_rate',
  'b_l5_season_x_blended_rate',
  'b_ewm_x_blended_rate',
  'b_role_x_blended_rate',
  'r_shift_to_l5',
] as const;
export type CandidateFamilyId = (typeof CANDIDATE_FAMILY_IDS)[number];

export interface PregameMinutesRoleFeatures {
  priorLogCount: number;
  priorPlayedCount: number;
  l3PlayedCount: number;
  l5PlayedCount: number;
  l10PlayedCount: number;
  seasonPlayedCount: number;
  l3Min: number | null;
  l5Min: number | null;
  l10Min: number | null;
  seasonMin: number | null;
  ewm: Record<EwmAlpha, number | null>;
  trendMin: number | null;
  roleMin: number | null;
  starterRateL5: number | null;
  starterRateSeason: number | null;
  consecutiveStarts: number;
  priorKnownRoleCount: number;
  minutesChangeBucket: MinutesChangeBucket;
  volumeBucket: VolumeBucket;
  location: 'home' | 'away' | 'unknown';
  leakageViolations: number;
}

export function chronoSplitForSeason(season: string): ChronoSplit {
  if (season === CHRONO_SPLIT.train) return 'train';
  if (season === CHRONO_SPLIT.validation) return 'validation';
  if (season === CHRONO_SPLIT.test) return 'test';
  return 'excluded';
}

export function isStrictlyBefore(featureTimestamp: string, targetTipoff: string): boolean {
  const featureMs = Date.parse(featureTimestamp);
  const tipMs = Date.parse(targetTipoff);
  return Number.isFinite(featureMs) && Number.isFinite(tipMs) && featureMs < tipMs;
}

/** Count prior rows that are not strictly before tipoff. Must be 0. */
export function countAsOfLeakage(
  prior: Array<{ start_time: string }>,
  targetTipoff: string
): number {
  let n = 0;
  for (const row of prior) {
    if (!isStrictlyBefore(row.start_time, targetTipoff)) n += 1;
  }
  return n;
}

export function clipRatio(ratio: number, lo: number, hi: number): number {
  if (!Number.isFinite(ratio)) return 1;
  return Math.min(hi, Math.max(lo, ratio));
}

export function scaleByMinutesRatio(
  baseline: number,
  expectedMinutes: number | null,
  referenceMinutes: number | null,
  clip: { lo: number; hi: number },
  refFloor = MINUTES_REF_FLOOR
): number | null {
  if (!Number.isFinite(baseline)) return null;
  if (expectedMinutes == null || referenceMinutes == null) return null;
  if (!Number.isFinite(expectedMinutes) || !Number.isFinite(referenceMinutes)) return null;
  if (referenceMinutes < refFloor || referenceMinutes <= 0) return null;
  return baseline * clipRatio(expectedMinutes / referenceMinutes, clip.lo, clip.hi);
}

export function ewmPlayedMinutes(priorNewestFirst: MinutesEvalLog[], alpha: number): number | null {
  if (!(alpha > 0) || !(alpha < 1)) return null;
  const played = priorNewestFirst.filter(isPlayedGame);
  let num = 0;
  let den = 0;
  let weight = 1;
  for (const g of played) {
    const m = parseMinutes(g.minutes);
    if (m == null || m <= 0) continue;
    num += weight * m;
    den += weight;
    weight *= 1 - alpha;
  }
  if (den <= 0) return null;
  return num / den;
}

export function minutesChangeBucket(l5: number | null, l10: number | null): MinutesChangeBucket {
  if (l5 == null || l10 == null || l10 <= 0) return 'unknown';
  const rel = Math.abs(l5 - l10) / l10;
  if (rel < 0.1) return 'stable';
  if (rel < 0.25) return 'moderate';
  return 'large';
}

export function volumeBucket(seasonMin: number | null): VolumeBucket {
  if (seasonMin == null || !Number.isFinite(seasonMin)) return 'unknown';
  if (seasonMin < 15) return 'low';
  if (seasonMin < 28) return 'rotation';
  return 'high';
}

export function locationForLog(log: ProjectionV1Log): 'home' | 'away' | 'unknown' {
  if (!log.team_id || !log.home_team_id || !log.away_team_id) return 'unknown';
  if (log.team_id === log.home_team_id) return 'home';
  if (log.team_id === log.away_team_id) return 'away';
  return 'unknown';
}

function knownRolePlayed(priorNewestFirst: ProjectionV1Log[]): ProjectionV1Log[] {
  return priorNewestFirst.filter((g) => isPlayedGame(g) && g.started !== 'unknown');
}

export function starterRate(priorNewestFirst: ProjectionV1Log[], n: number | 'all'): number | null {
  const known = knownRolePlayed(priorNewestFirst);
  const slice = n === 'all' ? known : known.slice(0, n);
  if (slice.length === 0) return null;
  let starts = 0;
  for (const g of slice) if (g.started === 'starter') starts += 1;
  return starts / slice.length;
}

/** Consecutive newest-first known-role played games that were starts. Unknown breaks the streak. */
export function consecutiveStarts(priorNewestFirst: ProjectionV1Log[]): number {
  let n = 0;
  for (const g of priorNewestFirst) {
    if (!isPlayedGame(g)) continue;
    if (g.started === 'unknown') break;
    if (g.started !== 'starter') break;
    n += 1;
  }
  return n;
}

export function windowRoleMinutes(
  priorNewestFirst: ProjectionV1Log[],
  role: 'starter' | 'bench',
  n: number | 'all'
): number | null {
  const rows = knownRolePlayed(priorNewestFirst).filter((g) => g.started === role);
  const slice = n === 'all' ? rows : rows.slice(0, n);
  let sum = 0;
  let count = 0;
  for (const g of slice) {
    const m = parseMinutes(g.minutes);
    if (m == null || m <= 0) continue;
    sum += m;
    count += 1;
  }
  if (count === 0) return null;
  return sum / count;
}

/**
 * Role-aware expected minutes from PRIOR games only.
 * Target-game starter is never consulted.
 */
export function roleAwareMinutes(
  priorNewestFirst: ProjectionV1Log[],
  fallback: number | null
): number | null {
  const rate = starterRate(priorNewestFirst, 5);
  if (rate == null || knownRolePlayed(priorNewestFirst).length < 3) return fallback;
  if (rate >= ROLE_STARTER_RATE_HIGH) {
    return windowRoleMinutes(priorNewestFirst, 'starter', 10) ?? fallback;
  }
  if (rate <= ROLE_STARTER_RATE_LOW) {
    return windowRoleMinutes(priorNewestFirst, 'bench', 10) ?? fallback;
  }
  return fallback;
}

export function trendAdjustedMinutes(l3: number | null, l10: number | null): number | null {
  if (l3 == null || l10 == null || l10 <= 0) return null;
  return l10 * clipRatio(l3 / l10, TREND_CLIP.lo, TREND_CLIP.hi);
}

export function priorRoleMajority(starterRateL5: number | null): RoleLabel {
  if (starterRateL5 == null) return 'unknown';
  if (starterRateL5 >= 0.5) return 'starter';
  return 'bench';
}

/** Diagnostic split only. Uses observed target-game starter, never as a projection input. */
export function observedRoleTransition(
  priorMajority: RoleLabel,
  targetObserved: RoleLabel
): ObservedRoleTransition {
  if (priorMajority === 'unknown' || targetObserved === 'unknown') return 'unknown';
  if (priorMajority === 'starter' && targetObserved === 'starter') return 'starter_to_starter';
  if (priorMajority === 'bench' && targetObserved === 'bench') return 'bench_to_bench';
  if (priorMajority === 'bench' && targetObserved === 'starter') return 'bench_to_starter';
  return 'starter_to_bench';
}

export function reconstructFromPrior(
  prior: ProjectionV1Log[],
  target: ProjectionV1Log
): PregameMinutesRoleFeatures | null {
  const leakageViolations = countAsOfLeakage(prior, target.start_time);
  const played = prior.filter(isPlayedGame);
  if (played.length === 0) return null;

  const l3Min = windowMinutesMean(prior, 3);
  const l5Min = windowMinutesMean(prior, 5);
  const l10Min = windowMinutesMean(prior, 10);
  const seasonMin = windowMinutesMean(prior, 'all');
  const ewm = {
    0.25: ewmPlayedMinutes(prior, 0.25),
    0.4: ewmPlayedMinutes(prior, 0.4),
    0.55: ewmPlayedMinutes(prior, 0.55),
  } as Record<EwmAlpha, number | null>;

  return {
    priorLogCount: prior.length,
    priorPlayedCount: played.length,
    l3PlayedCount: Math.min(3, played.length),
    l5PlayedCount: Math.min(5, played.length),
    l10PlayedCount: Math.min(10, played.length),
    seasonPlayedCount: played.length,
    l3Min,
    l5Min,
    l10Min,
    seasonMin,
    ewm,
    trendMin: trendAdjustedMinutes(l3Min, l10Min),
    roleMin: roleAwareMinutes(prior, l5Min),
    starterRateL5: starterRate(prior, 5),
    starterRateSeason: starterRate(prior, 'all'),
    consecutiveStarts: consecutiveStarts(prior),
    priorKnownRoleCount: knownRolePlayed(prior).length,
    minutesChangeBucket: minutesChangeBucket(l5Min, l10Min),
    volumeBucket: volumeBucket(seasonMin),
    location: locationForLog(target),
    leakageViolations,
  };
}

export function reconstructPregameMinutesRole(
  allPlayerGames: ProjectionV1Log[],
  target: ProjectionV1Log,
  definition: FeatureDefinition = FEATURE_DEFINITION
): PregameMinutesRoleFeatures | null {
  const prior = selectPriorGames(allPlayerGames, target.start_time, target.season, definition) as ProjectionV1Log[];
  return reconstructFromPrior(prior, target);
}

export function playedOnlyTrackA(
  priorNewestFirst: MinutesEvalLog[],
  propType: SupportedPropType
): number | null {
  const inputs = buildPlayedOnlyAsOfModelInputs(priorNewestFirst, 'research');
  return trackAProjection(inputs, propType);
}

export function minutesEstimate(
  features: PregameMinutesRoleFeatures,
  id: MinutesEstimatorId
): number | null {
  switch (id) {
    case 'min_l5':
      return features.l5Min;
    case 'min_l5_season':
      return blendTrackA(features.l5Min, features.seasonMin);
    case 'min_ewm_a025':
      return features.ewm[0.25];
    case 'min_ewm_a040':
      return features.ewm[0.4];
    case 'min_ewm_a055':
      return features.ewm[0.55];
    case 'min_trend':
      return features.trendMin;
    case 'min_role':
      return features.roleMin;
    default:
      return null;
  }
}

export function rateWindow(
  priorNewestFirst: MinutesEvalLog[],
  propType: SupportedPropType,
  window: 'season' | 'l10' | 'blended'
): number | null {
  const season = windowPerMinuteRate(priorNewestFirst, propType, 'all');
  const l10 = windowPerMinuteRate(priorNewestFirst, propType, 10);
  if (window === 'season') return season;
  if (window === 'l10') return l10;
  return blendTrackA(l10, season);
}

export function minutesTimesRate(
  expectedMinutes: number | null,
  rate: number | null
): number | null {
  if (expectedMinutes == null || rate == null) return null;
  if (!Number.isFinite(expectedMinutes) || !Number.isFinite(rate)) return null;
  if (expectedMinutes <= 0) return null;
  return expectedMinutes * rate;
}

export function withBaselineFallback(candidate: number | null, baseline: number): number {
  return candidate != null && Number.isFinite(candidate) ? candidate : baseline;
}

export function roleShiftToL5(
  baseline: number,
  l5Counting: number | null,
  l5Min: number | null,
  seasonMin: number | null,
  tau: number
): number {
  if (l5Counting == null || l5Min == null || seasonMin == null || seasonMin <= 0) return baseline;
  const rel = Math.abs(l5Min - seasonMin) / seasonMin;
  return rel >= tau ? l5Counting : baseline;
}

export function actualForProp(log: MinutesEvalLog, propType: SupportedPropType): number | null {
  const key = propTypeToStatKey(propType);
  if (!key) return null;
  return statFromLog(log, key);
}

export function compactMetrics(pairs: Array<{ projection: number | null; actual: number }>): {
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  medianAe: number | null;
  n: number;
} {
  const m: MetricBlock = computeMetricBlock(pairs, pairs.length);
  return {
    mae: m.mae,
    rmse: m.rmse,
    bias: m.bias,
    medianAe: m.medianAe,
    n: m.nScored,
  };
}

/** Paired MAE(candidate) − MAE(baseline) from signed errors (projection − actual). Negative = improvement. */
export function pairedDelta(
  baselineSignedErrors: number[],
  candidateSignedErrors: number[],
  iterations = BOOTSTRAP_ITERS,
  seed = BOOTSTRAP_SEED
): {
  candidateMae: number | null;
  baselineMae: number | null;
  delta: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  n: number;
} {
  const n = Math.min(baselineSignedErrors.length, candidateSignedErrors.length);
  const errA = baselineSignedErrors.slice(0, n);
  const errB = candidateSignedErrors.slice(0, n);
  const boot = bootstrapMaeDifference(errA, errB, iterations, seed);
  const baselineMae = n === 0 ? null : errA.reduce((a, b) => a + Math.abs(b), 0) / n;
  const candidateMae = n === 0 ? null : errB.reduce((a, b) => a + Math.abs(b), 0) / n;
  return {
    candidateMae,
    baselineMae,
    delta: boot.delta,
    ciLow: boot.ciLow,
    ciHigh: boot.ciHigh,
    n,
  };
}

export const ALL_PROP_TYPES: readonly SupportedPropType[] = SUPPORTED_PROP_TYPES;

export function isPlayedTarget(log: MinutesEvalLog): boolean {
  return isPlayedGame(log);
}

export function countingWindow(
  priorNewestFirst: MinutesEvalLog[],
  propType: SupportedPropType,
  n: number | 'all'
): number | null {
  return windowCountingMean(priorNewestFirst, propType, n, true);
}

export const DEFAULT_CLIP = CLIP_GRIDS[1]; // 0.85–1.15

/** Frozen from minutes/role val-selection. Do not retune on the usage experiment. */
export const FROZEN_MINUTES_EWM_ALPHA = 0.25 as const;
export const FROZEN_MINUTES_CLIP = { id: 'clip_085_115', lo: 0.85, hi: 1.15 } as const;
export const FROZEN_MINUTES_CHANGE_THRESHOLD = 0.25;
export const BENCHMARK_B_ID = 'track_a_conditional_ewm_minutes' as const;

export function minutesChangeRelative(l5: number | null, l10: number | null): number | null {
  if (l5 == null || l10 == null || l10 <= 0) return null;
  return Math.abs(l5 - l10) / l10;
}

export function isLargeMinutesChange(l5: number | null, l10: number | null): boolean {
  const rel = minutesChangeRelative(l5, l10);
  return rel != null && rel >= FROZEN_MINUTES_CHANGE_THRESHOLD;
}

/**
 * Benchmark B: Played-only Track A, plus EWM/L10 minutes scaling only when
 * pregame |L5min-L10min|/L10min >= 0.25. Never applied to 3PM.
 * α=0.25 and clip 0.85–1.15 are frozen from the minutes/role val pass.
 */
export function conditionalMinutesAdjustedProjection(args: {
  trackA: number;
  features: PregameMinutesRoleFeatures;
  propType: SupportedPropType;
}): number {
  if (args.propType === 'threes') return args.trackA;
  if (!isLargeMinutesChange(args.features.l5Min, args.features.l10Min)) return args.trackA;
  return withBaselineFallback(
    scaleByMinutesRatio(
      args.trackA,
      args.features.ewm[FROZEN_MINUTES_EWM_ALPHA],
      args.features.l10Min,
      FROZEN_MINUTES_CLIP
    ),
    args.trackA
  );
}
export const SEGMENT_CANDIDATE_IDS = [
  BENCHMARK_ID,
  'a_min_l5__clip_085_115',
  'a_min_ewm_a040__clip_085_115',
  'a_min_role__clip_085_115',
  'b_min_l5__blended_rate',
  'r_shift_l5__tau_020',
] as const;

function aId(estimator: MinutesEstimatorId, clip: ClipGrid): string {
  return `a_${estimator}__${clip.id}`;
}

function pushA(
  out: Record<string, number>,
  baseline: number,
  features: PregameMinutesRoleFeatures,
  estimator: MinutesEstimatorId,
  clips: readonly ClipGrid[]
) {
  const expected = minutesEstimate(features, estimator);
  for (const clip of clips) {
    out[aId(estimator, clip)] = withBaselineFallback(
      scaleByMinutesRatio(baseline, expected, features.l10Min, clip),
      baseline
    );
  }
}

/** All research candidates for one player-game-prop. Missing features fall back to baseline so N stays paired. */
export function scoreMinutesRoleCandidates(args: {
  prior: MinutesEvalLog[];
  features: PregameMinutesRoleFeatures;
  propType: SupportedPropType;
  baseline: number;
}): Record<string, number> {
  const { prior, features, propType, baseline } = args;
  const out: Record<string, number> = { [BENCHMARK_ID]: baseline };
  pushA(out, baseline, features, 'min_l5', CLIP_GRIDS);
  pushA(out, baseline, features, 'min_l5_season', CLIP_GRIDS);
  pushA(out, baseline, features, 'min_ewm_a040', CLIP_GRIDS);
  pushA(out, baseline, features, 'min_trend', CLIP_GRIDS);
  pushA(out, baseline, features, 'min_role', CLIP_GRIDS);
  out[aId('min_ewm_a025', DEFAULT_CLIP)] = withBaselineFallback(
    scaleByMinutesRatio(baseline, features.ewm[0.25], features.l10Min, DEFAULT_CLIP),
    baseline
  );
  out[aId('min_ewm_a055', DEFAULT_CLIP)] = withBaselineFallback(
    scaleByMinutesRatio(baseline, features.ewm[0.55], features.l10Min, DEFAULT_CLIP),
    baseline
  );

  const l5 = minutesEstimate(features, 'min_l5');
  const l5Season = minutesEstimate(features, 'min_l5_season');
  const ewm = features.ewm[0.4];
  const role = features.roleMin;
  const seasonRate = rateWindow(prior, propType, 'season');
  const l10Rate = rateWindow(prior, propType, 'l10');
  const blendedRate = rateWindow(prior, propType, 'blended');
  out['b_min_l5__season_rate'] = withBaselineFallback(minutesTimesRate(l5, seasonRate), baseline);
  out['b_min_l5__l10_rate'] = withBaselineFallback(minutesTimesRate(l5, l10Rate), baseline);
  out['b_min_l5__blended_rate'] = withBaselineFallback(minutesTimesRate(l5, blendedRate), baseline);
  out['b_min_l5_season__blended_rate'] = withBaselineFallback(minutesTimesRate(l5Season, blendedRate), baseline);
  out['b_min_ewm_a040__blended_rate'] = withBaselineFallback(minutesTimesRate(ewm, blendedRate), baseline);
  out['b_min_role__blended_rate'] = withBaselineFallback(minutesTimesRate(role, blendedRate), baseline);

  const l5Counting = countingWindow(prior, propType, 5);
  const tauKeys: Record<(typeof ROLE_SHIFT_TAUS)[number], string> = {
    0.15: 'r_shift_l5__tau_015',
    0.2: 'r_shift_l5__tau_020',
    0.25: 'r_shift_l5__tau_025',
  };
  for (const tau of ROLE_SHIFT_TAUS) {
    out[tauKeys[tau]] = roleShiftToL5(baseline, l5Counting, features.l5Min, features.seasonMin, tau);
  }
  return out;
}

