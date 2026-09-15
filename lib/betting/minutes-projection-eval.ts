/**
 * Research-only expected-minutes and rate-based projection helpers.
 *
 * Does not change production serving, calibration, or APIs.
 * Sportsbook lines are never used as inputs to expected minutes, rates,
 * or the projection mean — market data is evaluation-only.
 */

import { computeProjection } from '@/lib/betting/player-prop-model';
import { propTypeToStatKey } from '@/lib/betting/track-b1-policy';
import {
  computeMetricBlock,
  sampleBucketForCount,
  selectPriorGames,
  statFromLog,
  windowMean,
  type EvalGameLog,
  type FeatureDefinition,
  type MetricBlock,
  type SampleBucket,
  type SupportedPropType,
  SUPPORTED_PROP_TYPES,
} from '@/lib/betting/player-projection-eval';

export const MINUTES_EVAL_VERSION = 'minutes-rate-v1';

/** First play-in date (ET) for each analytics start-year. Includes play-in as postseason. */
export const POSTSEASON_START_ET: Record<string, string> = {
  '2023': '2024-04-16',
  '2024': '2025-04-15',
  '2025': '2026-04-14',
};

export const MINUTES_MODEL_IDS = ['season', 'l10', 'l5', 'track_a'] as const;
export type MinutesModelId = (typeof MINUTES_MODEL_IDS)[number];

export const MINUTES_MODEL_LABEL: Record<MinutesModelId, string> = {
  season: 'Season minutes avg',
  l10: 'L10 minutes avg',
  l5: 'L5 minutes avg',
  track_a: 'Track-A minutes (0.7 L10 + 0.3 season)',
};

export const STAT_MODEL_IDS = [
  'season_avg',
  'l10',
  'track_a',
  'r1_min_x_season_rate',
  'r2_min_x_l10_rate',
  'r3_min_x_blended_rate',
  'perfect_min_x_blended_rate',
  'track_a_min_x_actual_rate',
  'market_line',
] as const;
export type StatModelId = (typeof STAT_MODEL_IDS)[number];

export const STAT_MODEL_LABEL: Record<StatModelId, string> = {
  season_avg: 'Season Avg',
  l10: 'L10',
  track_a: 'Track A',
  r1_min_x_season_rate: 'Minutes × Season Rate',
  r2_min_x_l10_rate: 'Minutes × L10 Rate',
  r3_min_x_blended_rate: 'Minutes × Blended Rate',
  perfect_min_x_blended_rate: 'Actual minutes × Blended Rate',
  track_a_min_x_actual_rate: 'Track-A minutes × Actual Rate',
  market_line: 'Market Line',
};

export type MinutesErrorBucket = 'actual_over_5+' | 'within_pm2' | 'actual_under_5+' | 'other';

export type AppearanceClass = 'played' | 'dnp' | 'malformed';

export interface MinutesEvalLog extends EvalGameLog {
  team_id: string | null;
  field_goals_attempted?: number | null;
  free_throws_attempted?: number | null;
}

export interface AppearanceClassification {
  class: AppearanceClass;
  minutes: number | null;
  minutesToken: string | null;
  hasBoxActivity: boolean;
  reason: string;
}

export interface RateTriple {
  season: number | null;
  l10: number | null;
  l5: number | null;
  blended: number | null;
}

export interface CountingTriple {
  season: number | null;
  l10: number | null;
  l5: number | null;
  trackA: number | null;
}

export interface AsOfUsageFeatures {
  priorLogCount: number;
  priorPlayedCount: number;
  priorDnpCount: number;
  priorMalformedCount: number;
  dnpInCurrentL10: number;
  dnpInCurrentSeason: number;
  l5PlayedCount: number;
  l10PlayedCount: number;
  seasonPlayedCount: number;
  sampleBucket: SampleBucket | 'none';
  minutes: Record<MinutesModelId, number | null>;
  rates: Record<SupportedPropType, RateTriple>;
  meanGameRates: Record<SupportedPropType, RateTriple>;
  ratesMin3: Record<SupportedPropType, RateTriple>;
  ratesMin5: Record<SupportedPropType, RateTriple>;
  counting: Record<SupportedPropType, CountingTriple>;
  playedCounting: Record<SupportedPropType, CountingTriple>;
  teamChanged: boolean;
  gamesOnCurrentTeamIncludingTonight: number | null;
}

export function parseMinutes(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

export function minutesToken(value: number | string | null | undefined): string | null {
  if (value == null) return null;
  const token = String(value).trim();
  return token.length === 0 ? null : token;
}

export function hasBoxActivity(log: EvalGameLog): boolean {
  const fga = 'field_goals_attempted' in log ? (log as MinutesEvalLog).field_goals_attempted : null;
  const fta = 'free_throws_attempted' in log ? (log as MinutesEvalLog).free_throws_attempted : null;
  const box =
    (log.points ?? 0) +
    (log.rebounds ?? 0) +
    (log.assists ?? 0) +
    (log.three_pointers_made ?? 0) +
    (fga ?? 0) +
    (fta ?? 0);
  return box > 0;
}

/**
 * Canonical research appearance class for analytics.player_game_logs.
 *
 * Inspected 2023–2025 Final logs (n=138,296):
 * - no DNP/inactive/DND column on analytics.player_game_logs
 * - public.bbref_player_game_stats.dnp_reason is unused (all null)
 * - minutes is integer-like text; no MM:SS; no nulls
 * - "00" (53,094) is the DNP/inactive roster row (~zero box)
 * - "0" (210) is a recorded 0-minute appearance, sometimes with stats
 * - minutes > 0 includes legitimate 0-point games (10,112)
 */
export function classifyAppearance(log: EvalGameLog): AppearanceClassification {
  const token = minutesToken(log.minutes);
  const minutes = parseMinutes(log.minutes);
  const box = hasBoxActivity(log);
  if (token == null || minutes == null) {
    return {
      class: 'malformed',
      minutes,
      minutesToken: token,
      hasBoxActivity: box,
      reason: 'null_or_non_numeric_minutes',
    };
  }
  if (minutes > 0) {
    return {
      class: 'played',
      minutes,
      minutesToken: token,
      hasBoxActivity: box,
      reason: 'minutes_gt_0',
    };
  }
  if (token === '00') {
    return {
      class: 'dnp',
      minutes: 0,
      minutesToken: token,
      hasBoxActivity: box,
      reason: box ? 'minutes_00_dnp_with_anomalous_box' : 'minutes_00_dnp',
    };
  }
  if (token === '0' || token === '0.0') {
    return {
      class: 'played',
      minutes: 0,
      minutesToken: token,
      hasBoxActivity: box,
      reason: 'zero_minute_appearance',
    };
  }
  if (box) {
    return {
      class: 'played',
      minutes: 0,
      minutesToken: token,
      hasBoxActivity: box,
      reason: 'zero_minutes_with_box_activity',
    };
  }
  return {
    class: 'dnp',
    minutes: 0,
    minutesToken: token,
    hasBoxActivity: box,
    reason: token === '00' ? 'minutes_00_dnp' : 'zero_minutes_no_box',
  };
}

/** Played-game predicate: DNP roster rows out; 0-point appearances with minutes stay in. */
export function isPlayedGame(log: EvalGameLog): boolean {
  return classifyAppearance(log).class === 'played';
}

/** Mean minutes over a newest-first window. Empty / all-null → null (never 0). */
export function windowMinutesMean(
  priorNewestFirst: EvalGameLog[],
  n: number | 'all',
  opts: { playedOnly: boolean } = { playedOnly: true }
): number | null {
  const source = opts.playedOnly ? priorNewestFirst.filter(isPlayedGame) : priorNewestFirst;
  const slice = n === 'all' ? source : source.slice(0, n);
  let sum = 0;
  let count = 0;
  for (const g of slice) {
    const m = parseMinutes(g.minutes);
    if (m == null) continue;
    if (opts.playedOnly && m <= 0) continue;
    sum += m;
    count += 1;
  }
  if (count === 0) return null;
  return sum / count;
}

/**
 * Minutes-weighted per-minute rate: sum(stat) / sum(minutes) over played games.
 * Zero-minute logs do not enter either sum. Empty → null.
 * Optional minMinutes drops tiny appearances from the rate window only.
 */
export function windowPerMinuteRate(
  priorNewestFirst: EvalGameLog[],
  propType: string,
  n: number | 'all',
  opts: { minMinutes?: number } = {}
): number | null {
  const key = propTypeToStatKey(propType);
  if (!key) return null;
  const minFloor = opts.minMinutes ?? 0;
  const played = priorNewestFirst.filter((g) => {
    if (!isPlayedGame(g)) return false;
    const m = parseMinutes(g.minutes);
    return m != null && m >= minFloor && (minFloor > 0 || m > 0);
  });
  const slice = n === 'all' ? played : played.slice(0, n);
  let statSum = 0;
  let minSum = 0;
  let nUsed = 0;
  for (const g of slice) {
    const minutes = parseMinutes(g.minutes);
    const stat = statFromLog(g, key);
    if (minutes == null || minutes <= 0 || stat == null || !Number.isFinite(stat)) continue;
    if (minutes < minFloor) continue;
    statSum += stat;
    minSum += minutes;
    nUsed += 1;
  }
  if (nUsed === 0 || minSum <= 0) return null;
  return statSum / minSum;
}

/** Unweighted mean of per-game rates (stat/minutes). Tiny-minute games get equal weight. */
export function windowMeanGameRate(
  priorNewestFirst: EvalGameLog[],
  propType: string,
  n: number | 'all'
): number | null {
  const key = propTypeToStatKey(propType);
  if (!key) return null;
  const played = priorNewestFirst.filter(isPlayedGame);
  const slice = n === 'all' ? played : played.slice(0, n);
  const rates: number[] = [];
  for (const g of slice) {
    const minutes = parseMinutes(g.minutes);
    const stat = statFromLog(g, key);
    if (minutes == null || minutes <= 0 || stat == null || !Number.isFinite(stat)) continue;
    rates.push(stat / minutes);
  }
  if (rates.length === 0) return null;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

/** Counting-stat mean. playedOnly=true uses last N played games; false uses last N Final logs (production Track A). */
export function windowCountingMean(
  priorNewestFirst: EvalGameLog[],
  propType: string,
  n: number | 'all',
  playedOnly: boolean
): number | null {
  const source = playedOnly ? priorNewestFirst.filter(isPlayedGame) : priorNewestFirst;
  return windowMean(source, propType, n);
}

export function countingTriple(priorNewestFirst: EvalGameLog[], propType: string, playedOnly: boolean): CountingTriple {
  const season = windowCountingMean(priorNewestFirst, propType, 'all', playedOnly);
  const l10 = windowCountingMean(priorNewestFirst, propType, 10, playedOnly);
  const l5 = windowCountingMean(priorNewestFirst, propType, 5, playedOnly);
  return { season, l10, l5, trackA: blendTrackA(l10, season) };
}

export function rateTriple(
  priorNewestFirst: EvalGameLog[],
  propType: string,
  rateFn: (prior: EvalGameLog[], prop: string, n: number | 'all') => number | null
): RateTriple {
  const season = rateFn(priorNewestFirst, propType, 'all');
  const l10 = rateFn(priorNewestFirst, propType, 10);
  const l5 = rateFn(priorNewestFirst, propType, 5);
  return { season, l10, l5, blended: blendTrackA(l10, season) };
}

export function comboComponentProjection(
  pts: number | null,
  reb: number | null,
  ast: number | null,
  kind: 'pra' | 'pa' | 'pr' | 'ra'
): number | null {
  if (kind === 'pra') {
    if (pts == null || reb == null || ast == null) return null;
    return pts + reb + ast;
  }
  if (kind === 'pa') {
    if (pts == null || ast == null) return null;
    return pts + ast;
  }
  if (kind === 'pr') {
    if (pts == null || reb == null) return null;
    return pts + reb;
  }
  if (reb == null || ast == null) return null;
  return reb + ast;
}

export function blendTrackA(recent: number | null, season: number | null): number | null {
  if (recent == null || season == null) return null;
  if (!Number.isFinite(recent) || !Number.isFinite(season)) return null;
  return computeProjection(recent, season);
}

export function productOrNull(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a * b;
}

const ET_CALENDAR_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function etCalendarDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return ET_CALENDAR_DATE.format(new Date(ms));
}

export function isPostseasonGame(season: string, startTime: string): boolean {
  const start = POSTSEASON_START_ET[String(season)];
  if (!start) return false;
  const d = etCalendarDate(startTime);
  return d != null && d >= start;
}

export function minutesErrorBucket(
  predictedMinutes: number | null,
  actualMinutes: number
): MinutesErrorBucket {
  if (predictedMinutes == null || !Number.isFinite(predictedMinutes)) return 'other';
  const signed = actualMinutes - predictedMinutes;
  if (signed >= 5) return 'actual_over_5+';
  if (signed <= -5) return 'actual_under_5+';
  if (Math.abs(signed) <= 2) return 'within_pm2';
  return 'other';
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let used = 0;
  for (let i = 0; i < n; i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    used += 1;
  }
  if (used < 3) return null;
  const num = used * sxy - sx * sy;
  const den = Math.sqrt((used * sxx - sx * sx) * (used * syy - sy * sy));
  if (!Number.isFinite(den) || den === 0) return null;
  return num / den;
}

/**
 * Count of consecutive newest-first prior games on tonight's team, plus tonight.
 * teamChanged = at least one prior game on a different team.
 */
export function teamChangeContext(
  priorNewestFirst: MinutesEvalLog[],
  tonightTeamId: string | null
): { teamChanged: boolean; gamesOnCurrentTeamIncludingTonight: number | null } {
  if (tonightTeamId == null || tonightTeamId === '') {
    return { teamChanged: false, gamesOnCurrentTeamIncludingTonight: null };
  }
  let consecutive = 0;
  let sawOther = false;
  for (const g of priorNewestFirst) {
    if (g.team_id == null || g.team_id === '') continue;
    if (g.team_id === tonightTeamId) {
      if (!sawOther) consecutive += 1;
    } else {
      sawOther = true;
    }
  }
  return {
    teamChanged: sawOther,
    gamesOnCurrentTeamIncludingTonight: consecutive + 1,
  };
}

export function reconstructAsOfUsage(
  allPlayerGames: MinutesEvalLog[],
  target: MinutesEvalLog,
  definition: FeatureDefinition = 'active_season'
): AsOfUsageFeatures | null {
  const prior = selectPriorGames(
    allPlayerGames,
    target.start_time,
    target.season,
    definition
  ) as MinutesEvalLog[];
  const appearance = prior.map((g) => classifyAppearance(g));
  const played = prior.filter((_, i) => appearance[i].class === 'played');
  const priorDnpCount = appearance.filter((a) => a.class === 'dnp').length;
  const priorMalformedCount = appearance.filter((a) => a.class === 'malformed').length;
  if (played.length === 0) return null;

  const currentL10 = prior.slice(0, 10);
  const dnpInCurrentL10 = currentL10.filter((g) => classifyAppearance(g).class === 'dnp').length;
  const dnpInCurrentSeason = priorDnpCount;

  const seasonMin = windowMinutesMean(prior, 'all');
  const l10Min = windowMinutesMean(prior, 10);
  const l5Min = windowMinutesMean(prior, 5);
  const minutes: Record<MinutesModelId, number | null> = {
    season: seasonMin,
    l10: l10Min,
    l5: l5Min,
    track_a: blendTrackA(l10Min, seasonMin),
  };

  const rates = {} as Record<SupportedPropType, RateTriple>;
  const meanGameRates = {} as Record<SupportedPropType, RateTriple>;
  const ratesMin3 = {} as Record<SupportedPropType, RateTriple>;
  const ratesMin5 = {} as Record<SupportedPropType, RateTriple>;
  const counting = {} as Record<SupportedPropType, CountingTriple>;
  const playedCounting = {} as Record<SupportedPropType, CountingTriple>;
  for (const prop of SUPPORTED_PROP_TYPES) {
    rates[prop] = rateTriple(prior, prop, windowPerMinuteRate);
    meanGameRates[prop] = rateTriple(prior, prop, windowMeanGameRate);
    ratesMin3[prop] = rateTriple(prior, prop, (p, t, n) => windowPerMinuteRate(p, t, n, { minMinutes: 3 }));
    ratesMin5[prop] = rateTriple(prior, prop, (p, t, n) => windowPerMinuteRate(p, t, n, { minMinutes: 5 }));
    counting[prop] = countingTriple(prior, prop, false);
    playedCounting[prop] = countingTriple(prior, prop, true);
  }

  const team = teamChangeContext(prior, target.team_id);
  return {
    priorLogCount: prior.length,
    priorPlayedCount: played.length,
    priorDnpCount,
    priorMalformedCount,
    dnpInCurrentL10,
    dnpInCurrentSeason,
    l5PlayedCount: Math.min(5, played.length),
    l10PlayedCount: Math.min(10, played.length),
    seasonPlayedCount: played.length,
    sampleBucket: sampleBucketForCount(played.length),
    minutes,
    rates,
    meanGameRates,
    ratesMin3,
    ratesMin5,
    counting,
    playedCounting,
    teamChanged: team.teamChanged,
    gamesOnCurrentTeamIncludingTonight: team.gamesOnCurrentTeamIncludingTonight,
  };
}

export function rateBasedProjection(
  expectedMinutes: number | null,
  rate: number | null
): number | null {
  if (expectedMinutes == null || rate == null) return null;
  if (!Number.isFinite(expectedMinutes) || !Number.isFinite(rate)) return null;
  if (expectedMinutes <= 0) return null;
  return expectedMinutes * rate;
}

export function actualPerMinuteRate(actualStat: number, actualMinutes: number): number | null {
  if (!Number.isFinite(actualStat) || !Number.isFinite(actualMinutes) || actualMinutes <= 0) {
    return null;
  }
  return actualStat / actualMinutes;
}

export function playedMinutesBucket(minutes: number): string {
  if (minutes > 0 && minutes < 3) return '0-3';
  if (minutes < 8) return '3-8';
  if (minutes < 15) return '8-15';
  if (minutes < 25) return '15-25';
  if (minutes < 35) return '25-35';
  return '35+';
}

export const PLAYED_GAME_DEFINITION = {
  version: 'played-v1',
  predicate:
    'played if parsed minutes > 0, or minutes token is "0"/"0.0"; minutes token "00" is always DNP (even if a box score is present); other numeric-zero without box is DNP; non-numeric minutes are malformed',
  targetUniverse: 'Final games with parsed minutes > 0 (same scoring universe as the prior minutes experiment)',
  dnpConvention: 'analytics.player_game_logs.minutes = "00" is the DNP/inactive roster row; no DNP-CD/inactive flags exist on this table',
  countingCurrent: 'mean over last N Final logs including DNP zeros (production Track A semantics)',
  countingPlayed: 'mean over last N played games (0-point played games included)',
  aggregateRate: 'sum(stat) / sum(minutes) over played games with minutes > 0',
  meanGameRate: 'mean(stat/minutes) over played games with minutes > 0',
};

export function metricsFromPairs(
  pairs: Array<{ projection: number | null; actual: number }>,
  nEligible: number
): MetricBlock {
  return computeMetricBlock(pairs, nEligible);
}

export function identityGap(
  countingAvg: number | null,
  minutesTimesMatchingRate: number | null
): number | null {
  if (countingAvg == null || minutesTimesMatchingRate == null) return null;
  return Math.abs(countingAvg - minutesTimesMatchingRate);
}
