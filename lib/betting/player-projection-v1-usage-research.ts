/**
 * Research-only player-projection v1 usage / rate-change helpers.
 *
 * Does not change production. Does not retune the frozen minutes candidate.
 * Target-game FGA / FTA / usage / minutes are outcomes, never inputs.
 */

import { isPlayedGame } from '@/lib/betting/minutes-projection-eval';
import {
  BENCHMARK_B_ID,
  clipRatio,
  countingWindow,
  FROZEN_MINUTES_CHANGE_THRESHOLD,
  minutesChangeRelative,
  withBaselineFallback,
  type PregameMinutesRoleFeatures,
  type ProjectionV1Log,
} from '@/lib/betting/player-projection-v1-research';
import type { SupportedPropType } from '@/lib/betting/player-projection-eval';

export const USAGE_RESEARCH_VERSION = 'player-projection-v1-usage-rate-r1';

/** Oliver's FTA possession weight. Documented, not tuned. */
export const FTA_SHOT_VOLUME_WEIGHT = 0.44;

export const USAGE_CLIPS = [
  { id: 'clip_090_110', lo: 0.9, hi: 1.1 },
  { id: 'clip_085_115', lo: 0.85, hi: 1.15 },
] as const;

export const USAGE_CHANGE_TAUS = [0.15, 0.25] as const;
export type UsageChangeTau = (typeof USAGE_CHANGE_TAUS)[number];

export const USAGE_REF_FLOOR = 0.08;
export const FGA_REF_FLOOR = 3;
export const TPA_REF_FLOOR = 1.5;
export const FTA_REF_FLOOR = 1;

export const RECENT_BLEND_WEIGHTS = [
  { id: 'w85', l10: 0.85, season: 0.15 },
  { id: 'w90', l10: 0.9, season: 0.1 },
] as const;

export interface UsageEvalLog extends ProjectionV1Log {
  field_goals_attempted?: number | null;
  free_throws_attempted?: number | null;
  three_pointers_attempted?: number | null;
  offensive_rebounds?: number | null;
  defensive_rebounds?: number | null;
  turnovers?: number | null;
  usage_percentage?: number | null;
  possessions?: number | null;
  assist_percentage?: number | null;
  rebound_percentage?: number | null;
}

export type RateWindows = {
  l3: number | null;
  l5: number | null;
  l10: number | null;
  season: number | null;
};

export type SignedChange = {
  ratioL5L10: number | null;
  diffL5L10: number | null;
  ratioL5Season: number | null;
  diffL5Season: number | null;
};

export type ChangeDirection = 'increase' | 'decrease' | 'stable' | 'unknown';
export type ChangeMagnitude = 'stable' | 'moderate' | 'large' | 'unknown';

export interface PregameUsageFeatures {
  fga: RateWindows;
  fta: RateWindows;
  tpa: RateWindows;
  usage: RateWindows;
  shotVolume: RateWindows;
  orb: RateWindows;
  drb: RateWindows;
  tov: RateWindows;
  possessions: RateWindows;
  fgaChange: SignedChange;
  ftaChange: SignedChange;
  tpaChange: SignedChange;
  usageChange: SignedChange;
  shotVolumeChange: SignedChange;
  usageKnownPrior: number;
  leakageViolations: number;
}

function finite(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

export function shotVolume(fga: number | null, fta: number | null): number | null {
  const g = finite(fga);
  const t = finite(fta);
  if (g == null && t == null) return null;
  return (g ?? 0) + FTA_SHOT_VOLUME_WEIGHT * (t ?? 0);
}

export function windowMeanNumeric(
  priorNewestFirst: UsageEvalLog[],
  value: (g: UsageEvalLog) => number | null,
  n: number | 'all'
): number | null {
  const played = priorNewestFirst.filter(isPlayedGame);
  const slice = n === 'all' ? played : played.slice(0, n);
  let sum = 0;
  let count = 0;
  for (const g of slice) {
    const v = value(g);
    if (v == null || !Number.isFinite(v)) continue;
    sum += v;
    count += 1;
  }
  if (count === 0) return null;
  return sum / count;
}

export function rateWindows(
  prior: UsageEvalLog[],
  value: (g: UsageEvalLog) => number | null
): RateWindows {
  return {
    l3: windowMeanNumeric(prior, value, 3),
    l5: windowMeanNumeric(prior, value, 5),
    l10: windowMeanNumeric(prior, value, 10),
    season: windowMeanNumeric(prior, value, 'all'),
  };
}

export function signedChange(recent: number | null, reference: number | null): { ratio: number | null; diff: number | null } {
  if (recent == null || reference == null) return { ratio: null, diff: null };
  return {
    ratio: reference === 0 ? null : recent / reference,
    diff: recent - reference,
  };
}

function packChange(windows: RateWindows): SignedChange {
  const l5l10 = signedChange(windows.l5, windows.l10);
  const l5szn = signedChange(windows.l5, windows.season);
  return {
    ratioL5L10: l5l10.ratio,
    diffL5L10: l5l10.diff,
    ratioL5Season: l5szn.ratio,
    diffL5Season: l5szn.diff,
  };
}

export function relativeAbsChange(recent: number | null, reference: number | null, floor: number): number | null {
  if (recent == null || reference == null || reference < floor || reference <= 0) return null;
  return Math.abs(recent - reference) / reference;
}

export function changeMagnitude(rel: number | null): ChangeMagnitude {
  if (rel == null) return 'unknown';
  if (rel < 0.15) return 'stable';
  if (rel < 0.25) return 'moderate';
  return 'large';
}

export function changeDirection(recent: number | null, reference: number | null, tau: number, floor: number): ChangeDirection {
  const rel = relativeAbsChange(recent, reference, floor);
  if (rel == null || recent == null || reference == null) return 'unknown';
  if (rel < tau) return 'stable';
  return recent > reference ? 'increase' : 'decrease';
}

export function reconstructPregameUsage(prior: UsageEvalLog[]): PregameUsageFeatures {
  const fga = rateWindows(prior, (g) => finite(g.field_goals_attempted ?? null));
  const fta = rateWindows(prior, (g) => finite(g.free_throws_attempted ?? null));
  const tpa = rateWindows(prior, (g) => finite(g.three_pointers_attempted ?? null));
  const usage = rateWindows(prior, (g) => finite(g.usage_percentage ?? null));
  const shotVolumeW = rateWindows(prior, (g) => shotVolume(g.field_goals_attempted ?? null, g.free_throws_attempted ?? null));
  const orb = rateWindows(prior, (g) => finite(g.offensive_rebounds ?? null));
  const drb = rateWindows(prior, (g) => finite(g.defensive_rebounds ?? null));
  const tov = rateWindows(prior, (g) => finite(g.turnovers ?? null));
  const possessions = rateWindows(prior, (g) => finite(g.possessions ?? null));
  return {
    fga,
    fta,
    tpa,
    usage,
    shotVolume: shotVolumeW,
    orb,
    drb,
    tov,
    possessions,
    fgaChange: packChange(fga),
    ftaChange: packChange(fta),
    tpaChange: packChange(tpa),
    usageChange: packChange(usage),
    shotVolumeChange: packChange(shotVolumeW),
    usageKnownPrior: prior.filter((g) => isPlayedGame(g) && finite(g.usage_percentage ?? null) != null).length,
    leakageViolations: 0,
  };
}

export function usageChangeRel(features: PregameUsageFeatures): number | null {
  return relativeAbsChange(features.usage.l5, features.usage.l10, USAGE_REF_FLOOR);
}

export function fgaChangeRel(features: PregameUsageFeatures): number | null {
  return relativeAbsChange(features.fga.l5, features.fga.l10, FGA_REF_FLOOR);
}

export function ftaChangeRel(features: PregameUsageFeatures): number | null {
  return relativeAbsChange(features.fta.l5, features.fta.l10, FTA_REF_FLOOR);
}

export function tpaChangeRel(features: PregameUsageFeatures): number | null {
  return relativeAbsChange(features.tpa.l5, features.tpa.l10, TPA_REF_FLOOR);
}

export function isLargeUsageChange(features: PregameUsageFeatures, tau: UsageChangeTau): boolean {
  const rel = usageChangeRel(features);
  return rel != null && rel >= tau;
}

export function isLargeFgaChange(features: PregameUsageFeatures, tau: UsageChangeTau): boolean {
  const rel = fgaChangeRel(features);
  return rel != null && rel >= tau;
}

export function isLargeFtaChange(features: PregameUsageFeatures, tau: UsageChangeTau): boolean {
  const rel = ftaChangeRel(features);
  return rel != null && rel >= tau;
}

export function minutesUsageQuad(
  minutes: PregameMinutesRoleFeatures,
  usage: PregameUsageFeatures,
  usageTau: UsageChangeTau
): 'stable_min_stable_usg' | 'changing_min_stable_usg' | 'stable_min_changing_usg' | 'changing_min_changing_usg' | 'unknown' {
  const minRel = minutesChangeRelative(minutes.l5Min, minutes.l10Min);
  const usgRel = usageChangeRel(usage);
  if (minRel == null || usgRel == null) return 'unknown';
  const minCh = minRel >= FROZEN_MINUTES_CHANGE_THRESHOLD;
  const usgCh = usgRel >= usageTau;
  if (!minCh && !usgCh) return 'stable_min_stable_usg';
  if (minCh && !usgCh) return 'changing_min_stable_usg';
  if (!minCh && usgCh) return 'stable_min_changing_usg';
  return 'changing_min_changing_usg';
}

export function scaleByRatio(
  baseline: number,
  recent: number | null,
  reference: number | null,
  clip: { lo: number; hi: number },
  floor: number
): number | null {
  if (recent == null || reference == null || reference < floor || reference <= 0) return null;
  return baseline * clipRatio(recent / reference, clip.lo, clip.hi);
}

export function recentCountingBlend(
  prior: UsageEvalLog[],
  propType: SupportedPropType,
  l10Weight: number,
  seasonWeight: number
): number | null {
  const l10 = countingWindow(prior, propType, 10);
  const season = countingWindow(prior, propType, 'all');
  if (l10 == null || season == null) return null;
  return l10Weight * l10 + seasonWeight * season;
}

/** Scale Benchmark B by a ratio only when `apply` is true; otherwise return Benchmark B. */
export function maybeScale(
  benchmarkB: number,
  recent: number | null,
  reference: number | null,
  clip: { lo: number; hi: number },
  floor: number,
  apply: boolean
): number {
  if (!apply) return benchmarkB;
  return withBaselineFallback(scaleByRatio(benchmarkB, recent, reference, clip, floor), benchmarkB);
}

export function scoreUsageRateCandidates(args: {
  prior: UsageEvalLog[];
  usage: PregameUsageFeatures;
  benchmarkA: number;
  benchmarkB: number;
  propType: SupportedPropType;
}): Record<string, number> {
  const { usage, benchmarkB, propType } = args;
  const out: Record<string, number> = {
    [BENCHMARK_B_ID]: benchmarkB,
  };

  for (const clip of USAGE_CLIPS) {
    out[`usg_l5_l10_always__${clip.id}`] = maybeScale(
      benchmarkB,
      usage.usage.l5,
      usage.usage.l10,
      clip,
      USAGE_REF_FLOOR,
      true
    );
    out[`fga_l5_l10_always__${clip.id}`] = maybeScale(
      benchmarkB,
      usage.fga.l5,
      usage.fga.l10,
      clip,
      FGA_REF_FLOOR,
      true
    );
  }

  for (const tau of USAGE_CHANGE_TAUS) {
    const usgLarge = isLargeUsageChange(usage, tau);
    const fgaLarge = isLargeFgaChange(usage, tau);
    const ftaLarge = isLargeFtaChange(usage, tau);
    const tpaLarge = (tpaChangeRel(usage) ?? 0) >= tau && tpaChangeRel(usage) != null;
    const tauKey = tau === 0.15 ? '015' : '025';
    out[`usg_l5_l10_cond_${tauKey}__clip_085_115`] = maybeScale(
      benchmarkB,
      usage.usage.l5,
      usage.usage.l10,
      USAGE_CLIPS[1],
      USAGE_REF_FLOOR,
      usgLarge
    );
    out[`usg_l5_season_cond_${tauKey}__clip_085_115`] = maybeScale(
      benchmarkB,
      usage.usage.l5,
      usage.usage.season,
      USAGE_CLIPS[1],
      USAGE_REF_FLOOR,
      usgLarge
    );
    out[`fga_l5_l10_cond_${tauKey}__clip_085_115`] = maybeScale(
      benchmarkB,
      usage.fga.l5,
      usage.fga.l10,
      USAGE_CLIPS[1],
      FGA_REF_FLOOR,
      fgaLarge
    );
    out[`shotvol_l5_l10_cond_${tauKey}__clip_085_115`] = maybeScale(
      benchmarkB,
      usage.shotVolume.l5,
      usage.shotVolume.l10,
      USAGE_CLIPS[1],
      FGA_REF_FLOOR,
      fgaLarge || ftaLarge
    );
    if (propType === 'threes') {
      out[`tpa_l5_l10_cond_${tauKey}__clip_085_115`] = maybeScale(
        benchmarkB,
        usage.tpa.l5,
        usage.tpa.l10,
        USAGE_CLIPS[1],
        TPA_REF_FLOOR,
        tpaLarge
      );
    }
  }

  return out;
}

/**
 * Concept B: when usage is changing, replace Track A weights with a more-recent
 * blend, then apply the frozen conditional minutes adjustment.
 */
export function recentBlendThenFrozenMinutes(args: {
  prior: UsageEvalLog[];
  minutes: PregameMinutesRoleFeatures;
  usage: PregameUsageFeatures;
  propType: SupportedPropType;
  benchmarkA: number;
  tau: UsageChangeTau;
  l10Weight: number;
  seasonWeight: number;
  applyFrozenMinutes: (counting: number) => number;
}): number {
  const counting = isLargeUsageChange(args.usage, args.tau)
    ? withBaselineFallback(
        recentCountingBlend(args.prior, args.propType, args.l10Weight, args.seasonWeight),
        args.benchmarkA
      )
    : args.benchmarkA;
  return args.applyFrozenMinutes(counting);
}
