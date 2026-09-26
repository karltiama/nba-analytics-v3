/**
 * Research-only player-projection evaluation helpers.
 *
 * Does not change production serving, calibration artifacts, or APIs.
 * Reconstructs L5 / L10 / season averages from game logs as-of a target
 * tipoff. Track A / Track B call the live functions in player-prop-model.ts.
 */

import type { GameLog } from '@/lib/players/types';
import {
  computePlayerPropProbability,
  computeProjection,
  computeTrackB1PlayerPropProbability,
} from '@/lib/betting/player-prop-model';
import { computePropEvFields, type PropEvRowInput } from '@/lib/betting/player-prop-ev-row';
import type { PlayerPropModelInputs, ModelInputStats } from '@/lib/betting/player-prop-inputs';
import { getStatsForPropType, inputWindowProvenance } from '@/lib/betting/player-prop-inputs';
import { getCalibrationVersion } from '@/lib/betting/ev-calibration';
import { brierScore, expectedCalibrationError } from '@/lib/betting/ev-eval-metrics';
import {
  buildStabilitySignals,
  computeConfidenceTier,
  isComboPropType,
  propTypeToStatKey,
  type ConfidenceTier,
  type PropStatSeriesKey,
  type StabilitySignals,
} from '@/lib/betting/track-b1-policy';

export const EVAL_MODEL_VERSION = 'trackB.1';

export const SUPPORTED_PROP_TYPES = [
  'points',
  'rebounds',
  'assists',
  'threes',
  'points_rebounds_assists',
  'points_assists',
  'points_rebounds',
  'rebounds_assists',
] as const;

export type SupportedPropType = (typeof SUPPORTED_PROP_TYPES)[number];

export const PROP_TYPE_LABEL: Record<SupportedPropType, string> = {
  points: 'PTS',
  rebounds: 'REB',
  assists: 'AST',
  threes: '3PM',
  points_rebounds_assists: 'PRA',
  points_assists: 'PA',
  points_rebounds: 'PR',
  rebounds_assists: 'RA',
};

export const MODEL_IDS = [
  'season_avg',
  'l10',
  'l5',
  'track_a',
  'track_b',
  'market_line',
] as const;

export type ModelId = (typeof MODEL_IDS)[number];

export const MODEL_LABEL: Record<ModelId, string> = {
  season_avg: 'Season Avg',
  l10: 'L10',
  l5: 'L5',
  track_a: 'Track A',
  track_b: 'Track B',
  market_line: 'Market Line',
};

export type FeatureDefinition = 'active_season' | 'career';

export const SAMPLE_BUCKETS = ['1-4', '5-9', '10-19', '20+'] as const;
export type SampleBucket = (typeof SAMPLE_BUCKETS)[number];

export const GAP_BUCKETS = ['0-1', '1-2', '2-3', '3-4', '4+'] as const;
export type GapBucket = (typeof GAP_BUCKETS)[number];

const STAT_KEYS: PropStatSeriesKey[] = ['pts', 'reb', 'ast', 'threes', 'pra', 'pa', 'pr', 'ra'];

const PREFERRED_BOOK_ORDER = [
  'betmgm',
  'fanduel',
  'draftkings',
  'betway',
  'caesars',
  'betrivers',
  'betparx',
  'fanatics',
];

export interface EvalGameLog {
  game_id: string;
  player_id: string;
  start_time: string;
  season: string;
  minutes: number | string | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  three_pointers_made: number | null;
}

export interface BookPregameLine {
  sportsbook: string;
  lineValue: number;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
  decisionAt: string;
}

export interface ConsensusMarketLine {
  /** Median of latest pregame OVER lines across books. */
  line: number;
  bookCount: number;
  isConsensus: boolean;
  preferredBook: BookPregameLine | null;
  closestToMedian: BookPregameLine | null;
  minutesBeforeTip: number | null;
  rule: 'latest_available_pregame_median';
}

export interface MetricBlock {
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  medianAe: number | null;
  p90Ae: number | null;
  coverage: number;
  nEligible: number;
  nScored: number;
}

export interface ScoredOpportunity {
  gameId: string;
  playerId: string;
  propType: SupportedPropType;
  season: string;
  startTime: string;
  split: 'development' | 'holdout';
  actual: number;
  featureDefinition: FeatureDefinition;
  priorCount: number;
  l5Count: number;
  l10Count: number;
  seasonCount: number;
  sampleBucket: SampleBucket | 'none';
  projections: Record<ModelId, number | null>;
  marketLine: number | null;
  preferredBookLine: number | null;
  marketBookCount: number;
  marketMinutesBeforeTip: number | null;
  confidenceTier: ConfidenceTier | null;
  pRaw: number | null;
  pCalibrated: number | null;
  pAnchored: number | null;
  pTrackARaw: number | null;
  pTrackACalibrated: number | null;
  pTrackAAnchored: number | null;
  overWon: boolean | null;
  isPush: boolean;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function startMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
}

export function isSupportedPropType(raw: string): raw is SupportedPropType {
  const k = raw.toLowerCase().trim();
  return (SUPPORTED_PROP_TYPES as readonly string[]).includes(k);
}

export function sampleBucketForCount(n: number): SampleBucket | 'none' {
  if (n <= 0) return 'none';
  if (n <= 4) return '1-4';
  if (n <= 9) return '5-9';
  if (n <= 19) return '10-19';
  return '20+';
}

export function gapBucketForAbs(absGap: number): GapBucket {
  if (absGap < 1) return '0-1';
  if (absGap < 2) return '1-2';
  if (absGap < 3) return '2-3';
  if (absGap < 4) return '3-4';
  return '4+';
}

export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2 === 1) return xs[mid];
  return (xs[mid - 1] + xs[mid]) / 2;
}

function mean(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleStdDev(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(Math.max(v, 0));
}

function comboValue(g: EvalGameLog, key: PropStatSeriesKey): number {
  const p = g.points ?? 0;
  const r = g.rebounds ?? 0;
  const a = g.assists ?? 0;
  switch (key) {
    case 'pra':
      return p + r + a;
    case 'pa':
      return p + a;
    case 'pr':
      return p + r;
    case 'ra':
      return r + a;
    default:
      return 0;
  }
}

export function statFromLog(g: EvalGameLog, key: PropStatSeriesKey): number | null {
  switch (key) {
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
    case 'pa':
    case 'pr':
    case 'ra':
      return comboValue(g, key);
    default:
      return null;
  }
}

/**
 * Prior Final logs strictly before tipoff.
 * active_season: same season as the target game only (serving-compatible).
 * career: every prior NBA game (research comparison only).
 */
export function selectPriorGames(
  games: EvalGameLog[],
  targetStartTime: string,
  targetSeason: string,
  definition: FeatureDefinition
): EvalGameLog[] {
  const target = startMs(targetStartTime);
  if (!Number.isFinite(target)) return [];
  const prior = games.filter((g) => {
    const t = startMs(g.start_time);
    if (!Number.isFinite(t) || t >= target) return false;
    if (definition === 'active_season' && String(g.season) !== String(targetSeason)) return false;
    return true;
  });
  prior.sort((a, b) => startMs(b.start_time) - startMs(a.start_time));
  return prior;
}

function toStats(gameList: EvalGameLog[]): ModelInputStats {
  return {
    pts: mean(gameList.map((g) => statFromLog(g, 'pts'))) ?? 0,
    reb: mean(gameList.map((g) => statFromLog(g, 'reb'))) ?? 0,
    ast: mean(gameList.map((g) => statFromLog(g, 'ast'))) ?? 0,
    threes: mean(gameList.map((g) => statFromLog(g, 'threes'))) ?? 0,
    pra: mean(gameList.map((g) => statFromLog(g, 'pra'))) ?? 0,
    pa: mean(gameList.map((g) => statFromLog(g, 'pa'))) ?? 0,
    pr: mean(gameList.map((g) => statFromLog(g, 'pr'))) ?? 0,
    ra: mean(gameList.map((g) => statFromLog(g, 'ra'))) ?? 0,
  };
}

function toStd(gameList: EvalGameLog[]): ModelInputStats {
  return {
    pts: sampleStdDev(gameList.map((g) => statFromLog(g, 'pts'))) ?? 0,
    reb: sampleStdDev(gameList.map((g) => statFromLog(g, 'reb'))) ?? 0,
    ast: sampleStdDev(gameList.map((g) => statFromLog(g, 'ast'))) ?? 0,
    threes: sampleStdDev(gameList.map((g) => statFromLog(g, 'threes'))) ?? 0,
    pra: sampleStdDev(gameList.map((g) => statFromLog(g, 'pra'))) ?? 0,
    pa: sampleStdDev(gameList.map((g) => statFromLog(g, 'pa'))) ?? 0,
    pr: sampleStdDev(gameList.map((g) => statFromLog(g, 'pr'))) ?? 0,
    ra: sampleStdDev(gameList.map((g) => statFromLog(g, 'ra'))) ?? 0,
  };
}

function toGameLog(g: EvalGameLog): GameLog {
  return {
    game_id: g.game_id,
    game_date: g.start_time,
    start_time: g.start_time,
    season: g.season,
    team_id: '',
    team_abbr: '',
    team_name: '',
    opponent_id: '',
    opponent_abbr: '',
    opponent_name: '',
    location: 'home',
    result: null,
    team_score: null,
    opponent_score: null,
    minutes: num(g.minutes),
    points: g.points,
    rebounds: g.rebounds,
    assists: g.assists,
    steals: null,
    blocks: null,
    turnovers: null,
    field_goals_made: null,
    field_goals_attempted: null,
    three_pointers_made: g.three_pointers_made,
    three_pointers_attempted: null,
    free_throws_made: null,
    free_throws_attempted: null,
    plus_minus: null,
    started: null,
    dnp_reason: null,
    offensive_rebounds: null,
    defensive_rebounds: null,
    personal_fouls: null,
  };
}

/**
 * Build the same PlayerPropModelInputs shape production uses, from as-of logs.
 * Returns null when there are no prior games — never fabricates zeros as a projection.
 */
export function buildAsOfModelInputs(
  priorNewestFirst: EvalGameLog[],
  seasonKey: string
): PlayerPropModelInputs | null {
  if (priorNewestFirst.length === 0) return null;
  const last10Games = priorNewestFirst.slice(0, 10);
  const last5Games = priorNewestFirst.slice(0, 5);
  const signalsByStat = {} as Record<PropStatSeriesKey, StabilitySignals>;
  const mapped = last10Games.map(toGameLog);
  for (const k of STAT_KEYS) {
    signalsByStat[k] = buildStabilitySignals(mapped, k);
  }
  const provenance = inputWindowProvenance(last10Games);
  return {
    last10: toStats(last10Games),
    season: toStats(priorNewestFirst),
    ext: { last5: toStats(last5Games), std10: toStd(last10Games) },
    meta: { signalsByStat },
    seasonKey,
    sampleGamesUsed: last10Games.length,
    seasonGamesPlayed: priorNewestFirst.length,
    l10GameIds: provenance.l10GameIds,
    latestInputGameStartTime: provenance.latestInputGameStartTime,
  };
}

/** Mean of a stat over a newest-first window. Empty window → null (never 0). */
export function windowMean(
  priorNewestFirst: EvalGameLog[],
  propType: string,
  n: number | 'all'
): number | null {
  const key = propTypeToStatKey(propType);
  if (!key) return null;
  const slice = n === 'all' ? priorNewestFirst : priorNewestFirst.slice(0, n);
  if (slice.length === 0) return null;
  return mean(slice.map((g) => statFromLog(g, key)));
}

export function trackAProjection(inputs: PlayerPropModelInputs | null, propType: string): number | null {
  if (!inputs) return null;
  const stats = getStatsForPropType(inputs, propType);
  if (!stats) return null;
  if (inputs.sampleGamesUsed <= 0 || inputs.seasonGamesPlayed <= 0) return null;
  return computeProjection(stats.last10Avg, stats.seasonAvg);
}

export function trackBProjection(inputs: PlayerPropModelInputs | null, propType: string): number | null {
  if (!inputs) return null;
  const stats = getStatsForPropType(inputs, propType);
  if (!stats) return null;
  if (inputs.sampleGamesUsed <= 0 || inputs.seasonGamesPlayed <= 0) return null;
  const isCombo = isComboPropType(propType);
  const result = computeTrackB1PlayerPropProbability(
    {
      last10Avg: stats.last10Avg,
      seasonAvg: stats.seasonAvg,
      line: 0,
      propType,
      last5Avg: stats.last5Avg,
      observedStdDev: stats.observedStdDev,
    },
    { signals: stats.stability, isCombo }
  );
  return Number.isFinite(result.projection) ? result.projection : null;
}

/**
 * Keep only snapshots strictly before tipoff. Does not treat equal timestamps as pregame.
 */
export function filterPregameLines(
  lines: BookPregameLine[],
  gameStartTime: string
): BookPregameLine[] {
  const tip = startMs(gameStartTime);
  if (!Number.isFinite(tip)) return [];
  return lines.filter((l) => {
    const t = startMs(l.decisionAt);
    return Number.isFinite(t) && t < tip && Number.isFinite(l.lineValue);
  });
}

function bookRank(name: string): number {
  const i = PREFERRED_BOOK_ORDER.indexOf(name.toLowerCase());
  return i === -1 ? PREFERRED_BOOK_ORDER.length : i;
}

export function consensusMarketLine(
  pregameLines: BookPregameLine[],
  gameStartTime: string
): ConsensusMarketLine | null {
  if (pregameLines.length === 0) return null;
  const byBook = new Map<string, BookPregameLine>();
  for (const line of pregameLines) {
    const key = line.sportsbook.toLowerCase();
    const prev = byBook.get(key);
    if (!prev || startMs(line.decisionAt) > startMs(prev.decisionAt)) {
      byBook.set(key, line);
    }
  }
  const unique = [...byBook.values()];
  if (unique.length === 0) return null;
  const med = median(unique.map((l) => l.lineValue));
  if (med == null) return null;

  const preferred =
    unique
      .slice()
      .sort((a, b) => bookRank(a.sportsbook) - bookRank(b.sportsbook))[0] ?? null;

  const closest =
    unique
      .slice()
      .sort((a, b) => {
        const da = Math.abs(a.lineValue - med);
        const db = Math.abs(b.lineValue - med);
        if (da !== db) return da - db;
        return bookRank(a.sportsbook) - bookRank(b.sportsbook);
      })[0] ?? null;

  const tip = startMs(gameStartTime);
  const latestDecision = unique.reduce(
    (best, l) => Math.max(best, startMs(l.decisionAt)),
    Number.NEGATIVE_INFINITY
  );
  const minutesBeforeTip =
    Number.isFinite(tip) && Number.isFinite(latestDecision)
      ? (tip - latestDecision) / 60000
      : null;

  return {
    line: med,
    bookCount: unique.length,
    isConsensus: unique.length >= 3,
    preferredBook: preferred,
    closestToMedian: closest,
    minutesBeforeTip,
    rule: 'latest_available_pregame_median',
  };
}

export function emptyMetrics(nEligible: number): MetricBlock {
  return {
    mae: null,
    rmse: null,
    bias: null,
    medianAe: null,
    p90Ae: null,
    coverage: nEligible === 0 ? 0 : 0,
    nEligible,
    nScored: 0,
  };
}

export function computeMetricBlock(
  pairs: Array<{ projection: number | null; actual: number }>,
  nEligible: number
): MetricBlock {
  const scored = pairs.filter(
    (p): p is { projection: number; actual: number } =>
      p.projection != null && Number.isFinite(p.projection) && Number.isFinite(p.actual)
  );
  if (scored.length === 0) {
    return { ...emptyMetrics(nEligible), coverage: 0 };
  }
  const errors = scored.map((p) => p.projection - p.actual);
  const abs = errors.map((e) => Math.abs(e));
  const mae = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rmse = Math.sqrt(abs.reduce((a, b) => a + b * b, 0) / abs.length);
  const bias = errors.reduce((a, b) => a + b, 0) / errors.length;
  const sortedAbs = [...abs].sort((a, b) => a - b);
  const medianAe = median(sortedAbs);
  const p90Idx = Math.min(sortedAbs.length - 1, Math.max(0, Math.ceil(0.9 * sortedAbs.length) - 1));
  return {
    mae,
    rmse,
    bias,
    medianAe,
    p90Ae: sortedAbs[p90Idx],
    coverage: nEligible > 0 ? scored.length / nEligible : 0,
    nEligible,
    nScored: scored.length,
  };
}

export function assignChronologicalSplits(
  startTimes: string[],
  developmentFraction = 0.7
): Map<string, 'development' | 'holdout'> {
  const unique = [...new Set(startTimes.filter((s) => Number.isFinite(startMs(s))))].sort(
    (a, b) => startMs(a) - startMs(b)
  );
  const cut = Math.max(1, Math.floor(unique.length * developmentFraction));
  const map = new Map<string, 'development' | 'holdout'>();
  unique.forEach((t, i) => {
    map.set(t, i < cut ? 'development' : 'holdout');
  });
  return map;
}

function overUnderRow(
  propType: string,
  line: number,
  oddsAmerican: number | null,
  oddsDecimal: number | null
): PropEvRowInput {
  return {
    prop_type: propType,
    market_type: 'over_under',
    side: 'over',
    line_value: line,
    odds_american: oddsAmerican,
    odds_decimal: oddsDecimal,
  };
}

export function scoreOpportunity(args: {
  gameId: string;
  playerId: string;
  propType: SupportedPropType;
  season: string;
  startTime: string;
  split: 'development' | 'holdout';
  actual: number;
  featureDefinition: FeatureDefinition;
  allPlayerGames: EvalGameLog[];
  pregameLines: BookPregameLine[];
}): ScoredOpportunity {
  const prior = selectPriorGames(
    args.allPlayerGames,
    args.startTime,
    args.season,
    args.featureDefinition
  );
  const inputs = buildAsOfModelInputs(prior, args.season);
  const stats = inputs ? getStatsForPropType(inputs, args.propType) : null;
  const market = consensusMarketLine(filterPregameLines(args.pregameLines, args.startTime), args.startTime);
  const marketLine = market?.line ?? null;
  const oddsBook = market?.closestToMedian ?? null;

  const projections: Record<ModelId, number | null> = {
    season_avg: windowMean(prior, args.propType, 'all'),
    l10: windowMean(prior, args.propType, 10),
    l5: windowMean(prior, args.propType, 5),
    track_a: trackAProjection(inputs, args.propType),
    track_b: trackBProjection(inputs, args.propType),
    market_line: marketLine,
  };

  let pRaw: number | null = null;
  let pCalibrated: number | null = null;
  let pAnchored: number | null = null;
  let pTrackARaw: number | null = null;
  let pTrackACalibrated: number | null = null;
  let pTrackAAnchored: number | null = null;
  let confidenceTier: ConfidenceTier | null = null;

  if (inputs && stats && marketLine != null && oddsBook != null) {
    const ev = computePropEvFields(
      overUnderRow(
        args.propType,
        marketLine,
        oddsBook.oddsAmerican,
        oddsBook.oddsDecimal
      ),
      inputs,
      'trackB_calibrated'
    );
    pRaw = ev.modelProbabilityTrackBRaw;
    pCalibrated = ev.modelProbabilityTrackBCalibrated;
    pAnchored = ev.modelProbabilityTrackBAnchored;
    pTrackARaw = ev.modelProbabilityTrackARaw;
    pTrackACalibrated = ev.modelProbabilityTrackACalibrated;
    pTrackAAnchored = ev.modelProbabilityTrackAAnchored;
    confidenceTier = ev.confidenceTier;
  } else if (stats) {
    confidenceTier = computeConfidenceTier(isComboPropType(args.propType), stats.stability);
  }

  const isPush = marketLine != null && args.actual === marketLine;
  const overWon =
    marketLine == null || isPush ? null : args.actual > marketLine;

  return {
    gameId: args.gameId,
    playerId: args.playerId,
    propType: args.propType,
    season: args.season,
    startTime: args.startTime,
    split: args.split,
    actual: args.actual,
    featureDefinition: args.featureDefinition,
    priorCount: prior.length,
    l5Count: Math.min(5, prior.length),
    l10Count: Math.min(10, prior.length),
    seasonCount: prior.length,
    sampleBucket: sampleBucketForCount(prior.length),
    projections,
    marketLine,
    preferredBookLine: market?.preferredBook?.lineValue ?? null,
    marketBookCount: market?.bookCount ?? 0,
    marketMinutesBeforeTip: market?.minutesBeforeTip ?? null,
    confidenceTier,
    pRaw,
    pCalibrated,
    pAnchored,
    pTrackARaw,
    pTrackACalibrated,
    pTrackAAnchored,
    overWon,
    isPush,
  };
}

export function metricsByModel(rows: ScoredOpportunity[]): Record<ModelId, MetricBlock> {
  const out = {} as Record<ModelId, MetricBlock>;
  for (const id of MODEL_IDS) {
    out[id] = computeMetricBlock(
      rows.map((r) => ({ projection: r.projections[id], actual: r.actual })),
      rows.length
    );
  }
  return out;
}

export function calibrationFor(
  rows: ScoredOpportunity[],
  field: 'pRaw' | 'pCalibrated' | 'pAnchored'
): { brier: number | null; ece: number | null; n: number } {
  const scored = rows.filter(
    (r) => r[field] != null && r.overWon != null && Number.isFinite(r[field] as number)
  );
  if (scored.length === 0) return { brier: null, ece: null, n: 0 };
  const packed = scored.map((r) => ({ p: r[field] as number, win: (r.overWon ? 1 : 0) as 0 | 1 }));
  return {
    brier: brierScore(packed),
    ece: expectedCalibrationError(packed),
    n: packed.length,
  };
}

export function directionalStats(
  rows: ScoredOpportunity[],
  projectionId: ModelId = 'track_b'
): {
  n: number;
  pushes: number;
  modelPushes: number;
  directionalHitRate: number | null;
  overHitRate: number | null;
  underHitRate: number | null;
} {
  let pushes = 0;
  let modelPushes = 0;
  let nDir = 0;
  let hits = 0;
  let overN = 0;
  let overHits = 0;
  let underN = 0;
  let underHits = 0;
  for (const r of rows) {
    const proj = r.projections[projectionId];
    const line = r.marketLine;
    if (proj == null || line == null) continue;
    if (r.isPush) {
      pushes += 1;
      continue;
    }
    if (proj === line) {
      modelPushes += 1;
      continue;
    }
    const predOver = proj > line;
    const actualOver = r.actual > line;
    nDir += 1;
    if (predOver === actualOver) hits += 1;
    if (predOver) {
      overN += 1;
      if (actualOver) overHits += 1;
    } else {
      underN += 1;
      if (!actualOver) underHits += 1;
    }
  }
  return {
    n: nDir,
    pushes,
    modelPushes,
    directionalHitRate: nDir > 0 ? hits / nDir : null,
    overHitRate: overN > 0 ? overHits / overN : null,
    underHitRate: underN > 0 ? underHits / underN : null,
  };
}

export function gapAnalysis(rows: ScoredOpportunity[], projectionId: ModelId = 'track_b') {
  const byBucket: Record<
    GapBucket,
    {
      n: number;
      ccMae: number | null;
      marketMae: number | null;
      overHitRate: number | null;
      underHitRate: number | null;
      actualMinusLine: number | null;
      directionalHitRate: number | null;
    }
  > = {
    '0-1': emptyGap(),
    '1-2': emptyGap(),
    '2-3': emptyGap(),
    '3-4': emptyGap(),
    '4+': emptyGap(),
  };

  const grouped: Record<GapBucket, ScoredOpportunity[]> = {
    '0-1': [],
    '1-2': [],
    '2-3': [],
    '3-4': [],
    '4+': [],
  };

  for (const r of rows) {
    const proj = r.projections[projectionId];
    const line = r.marketLine;
    if (proj == null || line == null) continue;
    grouped[gapBucketForAbs(Math.abs(proj - line))].push(r);
  }

  for (const bucket of GAP_BUCKETS) {
    const list = grouped[bucket];
    const cc = computeMetricBlock(
      list.map((r) => ({ projection: r.projections[projectionId], actual: r.actual })),
      list.length
    );
    const mkt = computeMetricBlock(
      list.map((r) => ({ projection: r.marketLine, actual: r.actual })),
      list.length
    );
    const dir = directionalStats(list, projectionId);
    const signed = list.filter((r) => r.marketLine != null);
    const actualMinusLine =
      signed.length === 0
        ? null
        : signed.reduce((a, r) => a + (r.actual - (r.marketLine as number)), 0) / signed.length;
    byBucket[bucket] = {
      n: list.length,
      ccMae: cc.mae,
      marketMae: mkt.mae,
      overHitRate: dir.overHitRate,
      underHitRate: dir.underHitRate,
      actualMinusLine,
      directionalHitRate: dir.directionalHitRate,
    };
  }
  return byBucket;
}

function emptyGap() {
  return {
    n: 0,
    ccMae: null,
    marketMae: null,
    overHitRate: null,
    underHitRate: null,
    actualMinusLine: null,
    directionalHitRate: null,
  };
}

export function leakageFlags(rows: ScoredOpportunity[], allGamesByPlayer: Map<string, EvalGameLog[]>) {
  let targetIncluded = 0;
  let laterIncluded = 0;
  let missingStart = 0;
  let postTipMarket = 0;
  for (const r of rows) {
    const games = allGamesByPlayer.get(r.playerId) ?? [];
    const target = startMs(r.startTime);
    if (!Number.isFinite(target)) missingStart += 1;
    const prior = selectPriorGames(games, r.startTime, r.season, r.featureDefinition);
    if (prior.some((g) => g.game_id === r.gameId)) targetIncluded += 1;
    if (prior.some((g) => startMs(g.start_time) >= target)) laterIncluded += 1;
    if (r.marketMinutesBeforeTip != null && r.marketMinutesBeforeTip < 0) postTipMarket += 1;
  }
  return {
    targetGameInFeatures: targetIncluded,
    laterGamesInFeatures: laterIncluded,
    missingStartTime: missingStart,
    postTipMarketLinesInScoredRows: postTipMarket,
    usedSeasonAverageTable: false,
    usedInjuryState: false,
    comparedUsingStartTimeNotGameDate: true,
  };
}

export function getCalibrationMeta(): string {
  return getCalibrationVersion();
}

/** Baseline Track A probability (unused line still required by the live wrapper). */
export function trackAProbability(last10Avg: number, seasonAvg: number, line: number, propType: string): number {
  return computePlayerPropProbability({ last10Avg, seasonAvg, line, propType }).probability;
}
