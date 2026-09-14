/**
 * Research-only Court Context shadow pipeline.
 *
 * Played-game input semantics + Track A/B scoring + research calibration.
 * Does not change production serving, Track A, Track B.1, APIs, UI, or
 * `lib/betting/ev-calibration-artifacts.json`.
 *
 * Projection means stay market-independent. Lines/odds enter only after
 * the mean, as a threshold for P(stat > line) and later calibration/EV.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  computePlayerPropProbability,
  computeTrackB1PlayerPropProbability,
} from '@/lib/betting/player-prop-model';
import { getStatsForPropType, type PlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import { calibrateProbability } from '@/lib/betting/ev-calibration';
import { getImpliedProbAnchorBand } from '@/lib/betting/player-prop-ev-row';
import { brierScore, expectedCalibrationError } from '@/lib/betting/ev-eval-metrics';
import { isPlayedGame } from '@/lib/betting/minutes-projection-eval';
import {
  buildAsOfModelInputs,
  selectPriorGames,
  trackAProjection,
  trackBProjection,
  type EvalGameLog,
  type FeatureDefinition,
  type SupportedPropType,
} from '@/lib/betting/player-projection-eval';
import { isComboPropType } from '@/lib/betting/track-b1-policy';

export const SHADOW_EVAL_VERSION = 'played-only-shadow-v1';

/** Research artifacts only. Never write production calibration here. */
export const SHADOW_CALIBRATION_RELATIVE_PATH = 'reports/model-validation/shadow-calibration.json';
export const PRODUCTION_CALIBRATION_RELATIVE_PATH = 'lib/betting/ev-calibration-artifacts.json';

/** Same identity-shrink used by scripts/fit-ev-calibration.ts. */
export const CALIBRATION_SHRINK_LAMBDA = 0.35;
export const CALIBRATION_MIN_SAMPLES = 100;

export const THREE_SHRINK_K = [5, 10, 20] as const;
export type ThreeShrinkK = (typeof THREE_SHRINK_K)[number];

export type ShadowMeanId =
  | 'production_track_a'
  | 'production_track_b'
  | 'played_track_a'
  | 'played_track_b';

export type MaeDeltaClass = 'materially better' | 'marginal' | 'tied' | 'worse';

export interface LinearCal {
  slope: number;
  intercept: number;
}

export interface FittedLinearCal extends LinearCal {
  rawSlope: number;
  rawIntercept: number;
  n: number;
  identityFallback: boolean;
  shrinkLambda: number;
  meanP: number | null;
  meanY: number | null;
  varP: number | null;
  cov: number | null;
}

export interface ShadowMeans {
  productionTrackA: number | null;
  productionTrackB: number | null;
  playedTrackA: number | null;
  playedTrackB: number | null;
}

export interface ProbabilityScore {
  p: number;
  win: 0 | 1;
}

export function isProductionCalibrationPath(relativePath: string): boolean {
  const norm = relativePath.replace(/\\/g, '/');
  return (
    norm === PRODUCTION_CALIBRATION_RELATIVE_PATH ||
    norm.endsWith(`/${PRODUCTION_CALIBRATION_RELATIVE_PATH}`)
  );
}

export function resolveResearchCalibrationWritePath(cwd: string, relativePath = SHADOW_CALIBRATION_RELATIVE_PATH): string {
  const norm = relativePath.replace(/\\/g, '/');
  if (isProductionCalibrationPath(norm)) {
    throw new Error(
      `Refusing to write research calibration to production path ${PRODUCTION_CALIBRATION_RELATIVE_PATH}`
    );
  }
  return join(cwd, relativePath);
}

export function writeResearchCalibration(cwd: string, payload: unknown, relativePath = SHADOW_CALIBRATION_RELATIVE_PATH): string {
  const dest = resolveResearchCalibrationWritePath(cwd, relativePath);
  writeFileSync(dest, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return dest;
}

export function filterPlayedGames(priorNewestFirst: EvalGameLog[]): EvalGameLog[] {
  return priorNewestFirst.filter(isPlayedGame);
}

/**
 * As-of PlayerPropModelInputs from PLAYED games only.
 * Reuses production `buildAsOfModelInputs` after DNP filter so Track B.1
 * receives clean L5 / L10 / season / std / stability without a Track B fork.
 */
export function buildPlayedOnlyAsOfModelInputs(
  priorNewestFirst: EvalGameLog[],
  seasonKey: string
): PlayerPropModelInputs | null {
  return buildAsOfModelInputs(filterPlayedGames(priorNewestFirst), seasonKey);
}

export function priorGamesForTarget(
  allPlayerGames: EvalGameLog[],
  target: Pick<EvalGameLog, 'start_time' | 'season' | 'game_id'>,
  definition: FeatureDefinition = 'active_season'
): EvalGameLog[] {
  return selectPriorGames(allPlayerGames, target.start_time, target.season, definition);
}

export function shadowMeansFromInputs(
  productionInputs: PlayerPropModelInputs | null,
  playedInputs: PlayerPropModelInputs | null,
  propType: string
): ShadowMeans {
  return {
    productionTrackA: trackAProjection(productionInputs, propType),
    productionTrackB: trackBProjection(productionInputs, propType),
    playedTrackA: trackAProjection(playedInputs, propType),
    playedTrackB: trackBProjection(playedInputs, propType),
  };
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** P(stat > line) from existing Normal CDF. Mean is independent of the line. */
export function rawOverProbability(
  inputs: PlayerPropModelInputs | null,
  propType: string,
  line: number,
  track: 'A' | 'B'
): number | null {
  if (!inputs || !Number.isFinite(line)) return null;
  const stats = getStatsForPropType(inputs, propType);
  if (!stats) return null;
  if (track === 'A') {
    const out = computePlayerPropProbability({
      last10Avg: stats.last10Avg,
      seasonAvg: stats.seasonAvg,
      line,
      propType,
    });
    return Number.isFinite(out.probability) ? out.probability : null;
  }
  const out = computeTrackB1PlayerPropProbability(
    {
      last10Avg: stats.last10Avg,
      seasonAvg: stats.seasonAvg,
      line,
      propType,
      last5Avg: stats.last5Avg,
      observedStdDev: stats.observedStdDev,
    },
    { signals: stats.stability, isCombo: isComboPropType(propType) }
  );
  return Number.isFinite(out.probability) ? out.probability : null;
}

export function applyLinearCalibration(raw: number, cal: LinearCal): number {
  return clamp01(cal.slope * clamp01(raw) + cal.intercept);
}

/** Diagnostic only: production artifacts fit on DNP-inclusive features. */
export function applyMismatchedProductionCalibration(
  raw: number,
  propType: string,
  track: 'trackA' | 'trackB' = 'trackA'
): number {
  return clamp01(calibrateProbability(raw, propType, track));
}

function identityCal(
  n: number,
  extras: { meanP?: number | null; meanY?: number | null; varP?: number | null; cov?: number | null } = {}
): FittedLinearCal {
  return {
    slope: 1,
    intercept: 0,
    rawSlope: 1,
    rawIntercept: 0,
    n,
    identityFallback: true,
    shrinkLambda: CALIBRATION_SHRINK_LAMBDA,
    meanP: extras.meanP ?? null,
    meanY: extras.meanY ?? null,
    varP: extras.varP ?? null,
    cov: extras.cov ?? null,
  };
}

export function fitLinearCalibration(
  samples: Array<{ p: number; y?: 0 | 1; win?: 0 | 1 }>
): FittedLinearCal {
  const clean = samples
    .map((s) => ({
      p: clamp01(s.p),
      y: (s.y === 1 || s.win === 1 ? 1 : 0) as 0 | 1,
    }))
    .filter((s) => Number.isFinite(s.p));
  const n = clean.length;
  if (n < CALIBRATION_MIN_SAMPLES) return identityCal(n);
  const meanP = clean.reduce((a, s) => a + s.p, 0) / n;
  const meanY = clean.reduce((a, s) => a + s.y, 0) / n;
  let cov = 0;
  let varP = 0;
  for (const s of clean) {
    cov += (s.p - meanP) * (s.y - meanY);
    varP += (s.p - meanP) * (s.p - meanP);
  }
  if (!Number.isFinite(meanP) || !Number.isFinite(meanY) || !Number.isFinite(varP) || varP <= 1e-8) {
    return identityCal(n, { meanP, meanY, varP, cov });
  }
  const rawSlope = cov / varP;
  const rawIntercept = meanY - rawSlope * meanP;
  const slope = CALIBRATION_SHRINK_LAMBDA * 1 + (1 - CALIBRATION_SHRINK_LAMBDA) * rawSlope;
  const intercept = CALIBRATION_SHRINK_LAMBDA * 0 + (1 - CALIBRATION_SHRINK_LAMBDA) * rawIntercept;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept) || !Number.isFinite(rawSlope)) {
    return identityCal(n, { meanP, meanY, varP, cov });
  }
  return {
    slope,
    intercept,
    rawSlope,
    rawIntercept,
    n,
    identityFallback: false,
    shrinkLambda: CALIBRATION_SHRINK_LAMBDA,
    meanP,
    meanY,
    varP,
    cov,
  };
}

export function decimalOddsFromAmerican(american: number | null, decimal: number | null): number | null {
  if (decimal != null && Number.isFinite(decimal) && decimal > 1) return decimal;
  if (american != null && Number.isFinite(american) && american !== 0) {
    return american < 0 ? 1 + 100 / Math.abs(american) : 1 + american / 100;
  }
  return null;
}

export function marketImpliedProbability(decimalOdds: number): number {
  return clamp01(1 / decimalOdds);
}

export function anchorToMarket(modelProb: number, marketProb: number, decimalOdds: number): number {
  const { lo, hi } = getImpliedProbAnchorBand(marketProb, decimalOdds);
  return Math.max(lo, Math.min(hi, modelProb));
}

export function evFromProbability(p: number, decimalOdds: number): number {
  return p * decimalOdds - 1;
}

export function realizedUnitReturn(win: 0 | 1, decimalOdds: number): number {
  return win === 1 ? decimalOdds - 1 : -1;
}

export function logLoss(rows: ProbabilityScore[], eps = 1e-15): number | null {
  if (rows.length === 0) return null;
  let sum = 0;
  for (const r of rows) {
    const p = Math.min(1 - eps, Math.max(eps, clamp01(r.p)));
    sum += r.win === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / rows.length;
}

export function probabilityMetrics(rows: ProbabilityScore[]): {
  brier: number | null;
  ece: number | null;
  logLoss: number | null;
  n: number;
} {
  if (rows.length === 0) {
    return { brier: null, ece: null, logLoss: null, n: 0 };
  }
  return {
    brier: brierScore(rows),
    ece: expectedCalibrationError(rows),
    logLoss: logLoss(rows),
    n: rows.length,
  };
}

/**
 * MAE(B) − MAE(A). Negative = B better.
 *
 * Thresholds are descriptive, not significance tests:
 * 0.01 MAE is ~0.2% of PTS MAE (~4.6) and ~4% of the DNP-cleanup gain (0.24).
 * 0.03 is ~10% of that cleanup gain. Use bootstrap CI when available.
 */
export function classifyMaeDelta(deltaBMinusA: number): MaeDeltaClass {
  if (!Number.isFinite(deltaBMinusA)) return 'tied';
  if (deltaBMinusA <= -0.03) return 'materially better';
  if (deltaBMinusA <= -0.01) return 'marginal';
  if (deltaBMinusA < 0.01) return 'tied';
  return 'worse';
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Paired bootstrap of MAE(B) − MAE(A) from signed errors (projection − actual).
 * Deterministic LCG seed. Returns null CI when n < 2.
 */
export function bootstrapMaeDifference(
  errA: ArrayLike<number>,
  errB: ArrayLike<number>,
  iterations = 400,
  seed = 20260913
): {
  delta: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  n: number;
  iterations: number;
} {
  const n = Math.min(errA.length, errB.length);
  if (n === 0) {
    return { delta: null, ciLow: null, ciHigh: null, n: 0, iterations: 0 };
  }
  let absA = 0;
  let absB = 0;
  for (let i = 0; i < n; i++) {
    absA += Math.abs(errA[i]);
    absB += Math.abs(errB[i]);
  }
  const delta = absB / n - absA / n;
  if (n < 2 || iterations <= 0) {
    return { delta, ciLow: null, ciHigh: null, n, iterations: 0 };
  }
  const rand = lcg(seed);
  const boot: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let a = 0;
    let bb = 0;
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rand() * n);
      a += Math.abs(errA[j]);
      bb += Math.abs(errB[j]);
    }
    boot.push(bb / n - a / n);
  }
  boot.sort((x, y) => x - y);
  const loIdx = Math.max(0, Math.floor(0.025 * boot.length));
  const hiIdx = Math.min(boot.length - 1, Math.floor(0.975 * boot.length));
  return {
    delta,
    ciLow: boot[loIdx],
    ciHigh: boot[hiIdx],
    n,
    iterations,
  };
}

/** reliability = n / (n + k); market-independent. */
export function shrinkToward(playerProjection: number, center: number, n: number, k: number): number {
  if (!Number.isFinite(playerProjection) || !Number.isFinite(center) || n <= 0 || k < 0) {
    return playerProjection;
  }
  const r = n / (n + k);
  return r * playerProjection + (1 - r) * center;
}

export function chronologicalCutIso(
  startTimes: string[],
  fitFraction = 0.7
): { cutIso: string | null; uniqueStarts: number; fitStarts: number; holdStarts: number } {
  const unique = [...new Set(startTimes.filter((s) => Number.isFinite(Date.parse(s))))].sort(
    (a, b) => Date.parse(a) - Date.parse(b)
  );
  if (unique.length === 0) {
    return { cutIso: null, uniqueStarts: 0, fitStarts: 0, holdStarts: 0 };
  }
  if (unique.length === 1) {
    return { cutIso: unique[0], uniqueStarts: 1, fitStarts: 0, holdStarts: 1 };
  }
  const cut = Math.max(1, Math.min(unique.length - 1, Math.floor(unique.length * fitFraction)));
  return {
    cutIso: unique[cut],
    uniqueStarts: unique.length,
    fitStarts: cut,
    holdStarts: unique.length - cut,
  };
}

export function isOnOrAfter(iso: string, cutIso: string | null): boolean {
  if (cutIso == null) return false;
  return Date.parse(iso) >= Date.parse(cutIso);
}

export interface ShadowLeakageCounters {
  targetGameInFeatures: number;
  laterGamesInFeatures: number;
  dnpRetainedInPlayedInputs: number;
  zeroStatPlayedDropped: number;
  postTipMarketLines: number;
  usedSeasonAverageTable: false;
  usedInjuryState: false;
  usedSportsbookInMean: false;
  comparedUsingStartTimeNotGameDate: true;
}

export function countShadowLeakage(args: {
  target: EvalGameLog;
  priorAll: EvalGameLog[];
  playedInputsPrior: EvalGameLog[];
  marketMinutesBeforeTip: number | null;
}): {
  targetIncluded: boolean;
  laterIncluded: boolean;
  dnpInPlayedInputs: boolean;
  zeroStatPlayedDropped: boolean;
  postTipMarket: boolean;
} {
  const targetMs = Date.parse(args.target.start_time);
  const targetIncluded = args.priorAll.some((g) => g.game_id === args.target.game_id);
  const laterIncluded = args.priorAll.some((g) => Date.parse(g.start_time) >= targetMs);
  const dnpInPlayedInputs = args.playedInputsPrior.some((g) => !isPlayedGame(g));
  const zeroStatPlayedDropped = args.priorAll.some(
    (g) =>
      isPlayedGame(g) &&
      (g.points ?? 0) === 0 &&
      !args.playedInputsPrior.some((p) => p.game_id === g.game_id)
  );
  const postTipMarket = args.marketMinutesBeforeTip != null && args.marketMinutesBeforeTip < 0;
  return { targetIncluded, laterIncluded, dnpInPlayedInputs, zeroStatPlayedDropped, postTipMarket };
}

export const SHADOW_MEAN_LABEL: Record<ShadowMeanId, string> = {
  production_track_a: 'Production Track A',
  production_track_b: 'Production Track B',
  played_track_a: 'Played-only Track A',
  played_track_b: 'Played-only Track B',
};

export function preferredCleanBaseline(deltaBMinusA: number, propType: SupportedPropType): ShadowMeanId {
  if (propType === 'threes') {
    return deltaBMinusA <= -0.01 ? 'played_track_b' : 'played_track_a';
  }
  return deltaBMinusA < -0.01 ? 'played_track_b' : 'played_track_a';
}
