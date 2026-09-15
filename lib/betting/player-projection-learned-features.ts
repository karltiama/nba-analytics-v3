/**
 * Shared research feature specification for the first learned projection experiment.
 *
 * Does not change production serving, A/B formulas, or ingestion.
 * Historical rows are reconstructed from completed box scores: publication
 * timestamps and retrospective corrections are not fully observable.
 */

import { etCalendarDate, isPlayedGame, parseMinutes, windowCountingMean, windowMinutesMean, windowPerMinuteRate } from '@/lib/betting/minutes-projection-eval';
import {
  selectPriorGames,
  statFromLog,
  trackAProjection,
  type FeatureDefinition,
  type SupportedPropType,
} from '@/lib/betting/player-projection-eval';
import { buildPlayedOnlyAsOfModelInputs } from '@/lib/betting/shadow-projection-eval';
import {
  FEATURE_DEFINITION,
  FROZEN_MINUTES_CHANGE_THRESHOLD,
  FROZEN_MINUTES_EWM_ALPHA,
  chronoSplitForSeason,
  conditionalMinutesAdjustedProjection,
  countAsOfLeakage,
  ewmPlayedMinutes,
  isStrictlyBefore,
  locationForLog,
  minutesChangeRelative,
  reconstructFromPrior,
  volumeBucket,
  type ChronoSplit,
  type ProjectionV1Log,
} from '@/lib/betting/player-projection-v1-research';

export const LEARNED_FEATURE_SPEC_VERSION = 'player-projection-learned-features-r1';
export const LEARNED_EXPERIMENT_VERSION = 'player-projection-learned-r1';
export const BASKETBALL_DATE_TZ = 'America/New_York';
export const CUTOFF_POLICY_ID = 'exclude_target_et_basketball_date';
export const HISTORICAL_VALIDITY_CLASS = 'reconstructed_historical';
export const RATE_MINUTES_FLOOR = 5;
/** Same Oliver weight as nightly team_game_stats / usage research. Not tuned. */
export const POSSESSION_FTA_WEIGHT = 0.44;
export const LEARNED_BOOTSTRAP_SEED = 20260914;
export const LEARNED_BOOTSTRAP_ITERS = 400;
export const LEARNED_TARGETS = ['points', 'rebounds', 'assists', 'threes'] as const;
export type LearnedTarget = (typeof LEARNED_TARGETS)[number];

export const BENCHMARK_N = { train: 27653, validation: 27696, test: 28130 } as const;

export interface LearnedEvalLog extends ProjectionV1Log {
  field_goals_attempted?: number | null;
  three_pointers_attempted?: number | null;
  free_throws_attempted?: number | null;
}

export interface TeamGameContextRow {
  game_id: string;
  team_id: string;
  opponent_team_id: string | null;
  season: string;
  start_time: string;
  team_points: number | null;
  team_fga: number | null;
  team_3pa: number | null;
  team_fta: number | null;
  team_turnovers: number | null;
  offensive_rebounds: number | null;
  points_allowed: number | null;
  opponent_fga: number | null;
  opponent_fta: number | null;
  opponent_turnovers: number | null;
  opponent_offensive_rebounds: number | null;
}

export interface ReconstructedTeamMeasures {
  estPossessions: number | null;
  offRating: number | null;
  defRating: number | null;
}

export const FEATURE_C_ALLOWLIST = [
  'pts_l5',
  'pts_l10',
  'pts_l20',
  'pts_season',
  'pts_std10',
  'pred_track_a_pts',
  'reb_l5',
  'reb_l10',
  'reb_l20',
  'reb_season',
  'reb_std10',
  'pred_track_a_reb',
  'ast_l5',
  'ast_l10',
  'ast_l20',
  'ast_season',
  'ast_std10',
  'pred_track_a_ast',
  'threes_l5',
  'threes_l10',
  'threes_l20',
  'threes_season',
  'threes_std10',
  'pred_track_a_threes',
  'min_l5',
  'min_l10',
  'min_l20',
  'min_season',
  'min_ewm_a025',
  'min_std10',
  'min_l5_l10_rel_change',
  'min_change_large',
  'fga_l5',
  'fga_l10',
  'fga_season',
  'tpa_l5',
  'tpa_l10',
  'tpa_season',
  'fta_l5',
  'fta_l10',
  'fta_season',
  'pts_per_min_l10',
  'pts_per_min_season',
  'reb_per_min_l10',
  'ast_per_min_l10',
  'threes_per_min_l10',
  'fga_share_l5',
  'fga_share_l10',
  'fga_share_season',
  'tpa_share_l10',
  'fta_share_l10',
  'prior_played_count',
  'prior_log_count',
  'l5_played_count',
  'l10_played_count',
  'l20_played_count',
  'season_played_count',
  'opportunity_matched_l10',
] as const;

export const FEATURE_D_EXTRA = [
  'is_home',
  'team_rest_days',
  'team_is_b2b',
  'team_games_last_7d',
  'player_days_since_last_appearance',
  'team_pts_l10',
  'team_fga_l10',
  'team_3pa_l10',
  'team_pts_allowed_l10',
  'team_est_possessions_l10',
  'team_off_rating_l10',
  'team_pts_season',
  'opp_pts_allowed_l10',
  'opp_fga_l10',
  'opp_3pa_l10',
  'opp_est_possessions_l10',
  'opp_def_rating_l10',
  'opp_def_rating_season',
] as const;

export const FEATURE_D_ALLOWLIST = [...FEATURE_C_ALLOWLIST, ...FEATURE_D_EXTRA] as const;

export type FeatureCName = (typeof FEATURE_C_ALLOWLIST)[number];
export type FeatureDName = (typeof FEATURE_D_ALLOWLIST)[number];
export type FeatureVector = Record<string, number | null>;

export const LABEL_FIELDS = [
  'actual_pts',
  'actual_reb',
  'actual_ast',
  'actual_threes',
  'actual_pra',
] as const;

export const POSTGAME_METADATA_FIELDS = ['actual_minutes', 'started'] as const;

export interface LearnedRowMeta {
  player_id: string;
  game_id: string;
  season: string;
  start_time: string;
  basketball_date: string | null;
  team_id: string | null;
  opponent_team_id: string | null;
  split: ChronoSplit;
  cutoff_policy: typeof CUTOFF_POLICY_ID;
  feature_spec_version: typeof LEARNED_FEATURE_SPEC_VERSION;
  historical_validity_class: typeof HISTORICAL_VALIDITY_CLASS;
  ab_prior_played_count: number;
  cd_prior_played_count: number;
  ab_leakage: number;
  cd_leakage: number;
  cd_includes_target_game: 0 | 1;
  minutes_change_bucket: 'stable' | 'moderate' | 'large' | 'unknown';
  volume_bucket: 'low' | 'rotation' | 'high' | 'unknown';
  limited_history: 0 | 1;
}

const basketballDateCache = new Map<string, string | null>();

export function basketballDateEt(iso: string): string | null {
  if (basketballDateCache.has(iso)) return basketballDateCache.get(iso) ?? null;
  const date = etCalendarDate(iso);
  basketballDateCache.set(iso, date);
  return date;
}

export function etDateDiffDays(laterYmd: string | null, earlierYmd: string | null): number | null {
  if (!laterYmd || !earlierYmd) return null;
  const later = parseYmdUtc(laterYmd);
  const earlier = parseYmdUtc(earlierYmd);
  if (later == null || earlier == null) return null;
  return Math.round((later - earlier) / 86_400_000);
}

function parseYmdUtc(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** C/D prior: strictly before tipoff AND earlier America/New_York basketball date. */
export function isUsableLearnedPrior(
  featureStartTime: string,
  targetStartTime: string
): boolean {
  if (!isStrictlyBefore(featureStartTime, targetStartTime)) return false;
  const featureDate = basketballDateEt(featureStartTime);
  const targetDate = basketballDateEt(targetStartTime);
  if (!featureDate || !targetDate) return false;
  return featureDate < targetDate;
}

export function selectLearnedPriors<T extends { start_time: string; season: string }>(
  games: T[],
  targetStartTime: string,
  targetSeason: string,
  definition: FeatureDefinition = FEATURE_DEFINITION
): T[] {
  const prior = games.filter((g) => {
    if (!isUsableLearnedPrior(g.start_time, targetStartTime)) return false;
    if (definition === 'active_season' && String(g.season) !== String(targetSeason)) return false;
    return true;
  });
  prior.sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  return prior;
}

export function countDateCutoffLeakage(
  prior: Array<{ start_time: string }>,
  targetStartTime: string
): number {
  let n = 0;
  for (const row of prior) {
    if (!isUsableLearnedPrior(row.start_time, targetStartTime)) n += 1;
  }
  return n;
}

const teamMeasuresCache = new WeakMap<TeamGameContextRow, ReconstructedTeamMeasures>();

export function reconstructTeamMeasures(row: TeamGameContextRow): ReconstructedTeamMeasures {
  const cached = teamMeasuresCache.get(row);
  if (cached) return cached;
  const teamPoss =
    (row.team_fga ?? 0) +
    POSSESSION_FTA_WEIGHT * (row.team_fta ?? 0) -
    (row.offensive_rebounds ?? 0) +
    (row.team_turnovers ?? 0);
  const oppPoss =
    (row.opponent_fga ?? 0) +
    POSSESSION_FTA_WEIGHT * (row.opponent_fta ?? 0) -
    (row.opponent_offensive_rebounds ?? 0) +
    (row.opponent_turnovers ?? 0);
  const estPossessions = 0.5 * (teamPoss + oppPoss);
  const pts = row.team_points;
  const allowed = row.points_allowed;
  const measures: ReconstructedTeamMeasures =
    !(estPossessions > 0) || !Number.isFinite(estPossessions)
      ? { estPossessions: null, offRating: null, defRating: null }
      : {
          estPossessions,
          offRating: pts != null && Number.isFinite(pts) ? (100 * pts) / estPossessions : null,
          defRating: allowed != null && Number.isFinite(allowed) ? (100 * allowed) / estPossessions : null,
        };
  teamMeasuresCache.set(row, measures);
  return measures;
}

function sampleStd(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(Math.max(v, 0));
}

function mean(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function counting(prior: LearnedEvalLog[], prop: SupportedPropType, n: number | 'all'): number | null {
  return windowCountingMean(prior, prop, n, true);
}

function attemptMean(
  prior: LearnedEvalLog[],
  field: 'field_goals_attempted' | 'three_pointers_attempted' | 'free_throws_attempted',
  n: number | 'all'
): number | null {
  const played = prior.filter(isPlayedGame);
  const slice = n === 'all' ? played : played.slice(0, n);
  return mean(slice.map((g) => g[field] ?? null));
}

function safeguardedPerMinute(prior: LearnedEvalLog[], prop: SupportedPropType, n: number | 'all'): number | null {
  const rate = windowPerMinuteRate(prior, prop, n);
  if (rate == null) return null;
  const played = prior.filter(isPlayedGame);
  const slice = n === 'all' ? played : played.slice(0, n);
  let minutes = 0;
  for (const g of slice) {
    const m = parseMinutes(g.minutes);
    if (m != null && m > 0) minutes += m;
  }
  if (minutes < RATE_MINUTES_FLOOR) return null;
  return rate;
}

function opportunityShare(
  prior: LearnedEvalLog[],
  tgsByGameTeam: Map<string, TeamGameContextRow>,
  field: 'field_goals_attempted' | 'three_pointers_attempted' | 'free_throws_attempted',
  teamField: 'team_fga' | 'team_3pa' | 'team_fta',
  n: number | 'all'
): { share: number | null; matched: number } {
  const played = prior.filter(isPlayedGame);
  const slice = n === 'all' ? played : played.slice(0, n);
  const ratios: number[] = [];
  for (const g of slice) {
    if (!g.team_id) continue;
    const teamRow = tgsByGameTeam.get(`${g.game_id}|${g.team_id}`);
    if (!teamRow) continue;
    const playerAttempts = g[field];
    const teamAttempts = teamRow[teamField];
    if (playerAttempts == null || teamAttempts == null) continue;
    if (!(teamAttempts > 0) || !Number.isFinite(playerAttempts) || !Number.isFinite(teamAttempts)) continue;
    ratios.push(playerAttempts / teamAttempts);
  }
  return { share: mean(ratios), matched: ratios.length };
}

function windowTeamMean(
  rows: TeamGameContextRow[],
  n: number | 'all',
  pick: (row: TeamGameContextRow, measures: ReconstructedTeamMeasures) => number | null
): number | null {
  const slice = n === 'all' ? rows : rows.slice(0, n);
  return mean(slice.map((row) => pick(row, reconstructTeamMeasures(row))));
}

export function opponentTeamId(log: LearnedEvalLog): string | null {
  if (!log.team_id) return null;
  if (log.team_id === log.home_team_id) return log.away_team_id;
  if (log.team_id === log.away_team_id) return log.home_team_id;
  return null;
}

export function buildLearnedFeatureVector(args: {
  cdPrior: LearnedEvalLog[];
  target: LearnedEvalLog;
  tgsByGameTeam: Map<string, TeamGameContextRow>;
  teamGamesByTeam: Map<string, TeamGameContextRow[]>;
  predTrackA: Record<LearnedTarget, number | null>;
}): { c: FeatureVector; d: FeatureVector } {
  const { cdPrior, target, tgsByGameTeam, teamGamesByTeam, predTrackA } = args;
  const played = cdPrior.filter(isPlayedGame);
  const loc = locationForLog(target);

  const ptsPlayed = played.map((g) => statFromLog(g, 'pts'));
  const rebPlayed = played.map((g) => statFromLog(g, 'reb'));
  const astPlayed = played.map((g) => statFromLog(g, 'ast'));
  const threesPlayed = played.map((g) => statFromLog(g, 'threes'));
  const minPlayed = played.map((g) => {
    const m = parseMinutes(g.minutes);
    return m != null && m > 0 ? m : null;
  });

  const l5Min = windowMinutesMean(cdPrior, 5);
  const l10Min = windowMinutesMean(cdPrior, 10);
  const rel = minutesChangeRelative(l5Min, l10Min);
  const fgaShareL5 = opportunityShare(cdPrior, tgsByGameTeam, 'field_goals_attempted', 'team_fga', 5);
  const fgaShareL10 = opportunityShare(cdPrior, tgsByGameTeam, 'field_goals_attempted', 'team_fga', 10);
  const fgaShareSeason = opportunityShare(cdPrior, tgsByGameTeam, 'field_goals_attempted', 'team_fga', 'all');
  const tpaShareL10 = opportunityShare(cdPrior, tgsByGameTeam, 'three_pointers_attempted', 'team_3pa', 10);
  const ftaShareL10 = opportunityShare(cdPrior, tgsByGameTeam, 'free_throws_attempted', 'team_fta', 10);

  const c: FeatureVector = {
    pts_l5: counting(cdPrior, 'points', 5),
    pts_l10: counting(cdPrior, 'points', 10),
    pts_l20: counting(cdPrior, 'points', 20),
    pts_season: counting(cdPrior, 'points', 'all'),
    pts_std10: sampleStd(ptsPlayed.slice(0, 10)),
    pred_track_a_pts: predTrackA.points,
    reb_l5: counting(cdPrior, 'rebounds', 5),
    reb_l10: counting(cdPrior, 'rebounds', 10),
    reb_l20: counting(cdPrior, 'rebounds', 20),
    reb_season: counting(cdPrior, 'rebounds', 'all'),
    reb_std10: sampleStd(rebPlayed.slice(0, 10)),
    pred_track_a_reb: predTrackA.rebounds,
    ast_l5: counting(cdPrior, 'assists', 5),
    ast_l10: counting(cdPrior, 'assists', 10),
    ast_l20: counting(cdPrior, 'assists', 20),
    ast_season: counting(cdPrior, 'assists', 'all'),
    ast_std10: sampleStd(astPlayed.slice(0, 10)),
    pred_track_a_ast: predTrackA.assists,
    threes_l5: counting(cdPrior, 'threes', 5),
    threes_l10: counting(cdPrior, 'threes', 10),
    threes_l20: counting(cdPrior, 'threes', 20),
    threes_season: counting(cdPrior, 'threes', 'all'),
    threes_std10: sampleStd(threesPlayed.slice(0, 10)),
    pred_track_a_threes: predTrackA.threes,
    min_l5: l5Min,
    min_l10: l10Min,
    min_l20: windowMinutesMean(cdPrior, 20),
    min_season: windowMinutesMean(cdPrior, 'all'),
    min_ewm_a025: ewmPlayedMinutes(cdPrior, FROZEN_MINUTES_EWM_ALPHA),
    min_std10: sampleStd(minPlayed.slice(0, 10)),
    min_l5_l10_rel_change: rel,
    min_change_large: rel == null ? null : rel >= FROZEN_MINUTES_CHANGE_THRESHOLD ? 1 : 0,
    fga_l5: attemptMean(cdPrior, 'field_goals_attempted', 5),
    fga_l10: attemptMean(cdPrior, 'field_goals_attempted', 10),
    fga_season: attemptMean(cdPrior, 'field_goals_attempted', 'all'),
    tpa_l5: attemptMean(cdPrior, 'three_pointers_attempted', 5),
    tpa_l10: attemptMean(cdPrior, 'three_pointers_attempted', 10),
    tpa_season: attemptMean(cdPrior, 'three_pointers_attempted', 'all'),
    fta_l5: attemptMean(cdPrior, 'free_throws_attempted', 5),
    fta_l10: attemptMean(cdPrior, 'free_throws_attempted', 10),
    fta_season: attemptMean(cdPrior, 'free_throws_attempted', 'all'),
    pts_per_min_l10: safeguardedPerMinute(cdPrior, 'points', 10),
    pts_per_min_season: safeguardedPerMinute(cdPrior, 'points', 'all'),
    reb_per_min_l10: safeguardedPerMinute(cdPrior, 'rebounds', 10),
    ast_per_min_l10: safeguardedPerMinute(cdPrior, 'assists', 10),
    threes_per_min_l10: safeguardedPerMinute(cdPrior, 'threes', 10),
    fga_share_l5: fgaShareL5.share,
    fga_share_l10: fgaShareL10.share,
    fga_share_season: fgaShareSeason.share,
    tpa_share_l10: tpaShareL10.share,
    fta_share_l10: ftaShareL10.share,
    prior_played_count: played.length,
    prior_log_count: cdPrior.length,
    l5_played_count: Math.min(5, played.length),
    l10_played_count: Math.min(10, played.length),
    l20_played_count: Math.min(20, played.length),
    season_played_count: played.length,
    opportunity_matched_l10: fgaShareL10.matched,
  };

  const teamId = target.team_id;
  const oppId = opponentTeamId(target);
  const targetDate = basketballDateEt(target.start_time);
  const teamGames = teamId ? teamGamesByTeam.get(teamId) ?? [] : [];
  const oppGames = oppId ? teamGamesByTeam.get(oppId) ?? [] : [];
  const teamPrior = selectLearnedPriors(teamGames, target.start_time, target.season);
  const oppPrior = selectLearnedPriors(oppGames, target.start_time, target.season);

  const lastTeam = teamPrior[0] ?? null;
  const lastPlayed = played[0] ?? null;
  const teamRest = lastTeam ? etDateDiffDays(targetDate, basketballDateEt(lastTeam.start_time)) : null;
  const playerRest = lastPlayed
    ? etDateDiffDays(targetDate, basketballDateEt(lastPlayed.start_time))
    : null;

  let teamGamesLast7 = 0;
  if (targetDate) {
    const targetUtc = parseYmdUtc(targetDate);
    if (targetUtc != null) {
      for (const g of teamPrior) {
        const d = basketballDateEt(g.start_time);
        const gUtc = parseYmdUtc(d ?? '');
        if (gUtc == null) continue;
        const delta = (targetUtc - gUtc) / 86_400_000;
        if (delta >= 1 && delta <= 7) teamGamesLast7 += 1;
      }
    }
  }

  const d: FeatureVector = {
    ...c,
    is_home: loc === 'unknown' ? null : loc === 'home' ? 1 : 0,
    team_rest_days: teamRest,
    team_is_b2b: teamRest == null ? null : teamRest === 1 ? 1 : 0,
    team_games_last_7d: teamId ? teamGamesLast7 : null,
    player_days_since_last_appearance: playerRest,
    team_pts_l10: windowTeamMean(teamPrior, 10, (row) => row.team_points),
    team_fga_l10: windowTeamMean(teamPrior, 10, (row) => row.team_fga),
    team_3pa_l10: windowTeamMean(teamPrior, 10, (row) => row.team_3pa),
    team_pts_allowed_l10: windowTeamMean(teamPrior, 10, (row) => row.points_allowed),
    team_est_possessions_l10: windowTeamMean(teamPrior, 10, (_row, m) => m.estPossessions),
    team_off_rating_l10: windowTeamMean(teamPrior, 10, (_row, m) => m.offRating),
    team_pts_season: windowTeamMean(teamPrior, 'all', (row) => row.team_points),
    opp_pts_allowed_l10: windowTeamMean(oppPrior, 10, (row) => row.points_allowed),
    opp_fga_l10: windowTeamMean(oppPrior, 10, (row) => row.team_fga),
    opp_3pa_l10: windowTeamMean(oppPrior, 10, (row) => row.team_3pa),
    opp_est_possessions_l10: windowTeamMean(oppPrior, 10, (_row, m) => m.estPossessions),
    opp_def_rating_l10: windowTeamMean(oppPrior, 10, (_row, m) => m.defRating),
    opp_def_rating_season: windowTeamMean(oppPrior, 'all', (_row, m) => m.defRating),
  };

  return { c, d };
}

export function pickAllowlist(vector: FeatureVector, names: readonly string[]): FeatureVector {
  const out: FeatureVector = {};
  for (const name of names) out[name] = vector[name] ?? null;
  return out;
}

export function assertNoLabelLeak(featureNames: readonly string[]): void {
  const banned = new Set<string>([...LABEL_FIELDS, ...POSTGAME_METADATA_FIELDS]);
  for (const name of featureNames) {
    if (banned.has(name) || name.startsWith('actual_')) {
      throw new Error(`Feature allowlist includes postgame/label field: ${name}`);
    }
  }
}

export interface BuiltLearnedRow {
  meta: LearnedRowMeta;
  labels: Record<(typeof LABEL_FIELDS)[number], number | null>;
  predA: Record<LearnedTarget, number | null>;
  predB: Record<LearnedTarget, number | null>;
  featuresC: FeatureVector;
  featuresD: FeatureVector;
  commonEligible: boolean;
}

export function buildLearnedRow(args: {
  allPlayerGames: LearnedEvalLog[];
  target: LearnedEvalLog;
  tgsByGameTeam: Map<string, TeamGameContextRow>;
  teamGamesByTeam: Map<string, TeamGameContextRow[]>;
}): BuiltLearnedRow | null {
  const { allPlayerGames, target, tgsByGameTeam, teamGamesByTeam } = args;
  if (!isPlayedGame(target)) return null;
  const abPrior = selectPriorGames(
    allPlayerGames,
    target.start_time,
    target.season,
    FEATURE_DEFINITION
  ) as LearnedEvalLog[];
  const abPlayed = abPrior.filter(isPlayedGame);
  if (abPlayed.length === 0) return null;

  const cdPrior = selectLearnedPriors(allPlayerGames, target.start_time, target.season);
  const cdPlayed = cdPrior.filter(isPlayedGame);
  const minutesFeatures = reconstructFromPrior(abPrior as ProjectionV1Log[], target);
  const playedInputs = buildPlayedOnlyAsOfModelInputs(abPrior, 'research');
  const predA = {
    points: trackAProjection(playedInputs, 'points'),
    rebounds: trackAProjection(playedInputs, 'rebounds'),
    assists: trackAProjection(playedInputs, 'assists'),
    threes: trackAProjection(playedInputs, 'threes'),
  };
  const predB = {
    points:
      minutesFeatures && predA.points != null
        ? conditionalMinutesAdjustedProjection({
            trackA: predA.points,
            features: minutesFeatures,
            propType: 'points',
          })
        : predA.points,
    rebounds:
      minutesFeatures && predA.rebounds != null
        ? conditionalMinutesAdjustedProjection({
            trackA: predA.rebounds,
            features: minutesFeatures,
            propType: 'rebounds',
          })
        : predA.rebounds,
    assists:
      minutesFeatures && predA.assists != null
        ? conditionalMinutesAdjustedProjection({
            trackA: predA.assists,
            features: minutesFeatures,
            propType: 'assists',
          })
        : predA.assists,
    threes:
      minutesFeatures && predA.threes != null
        ? conditionalMinutesAdjustedProjection({
            trackA: predA.threes,
            features: minutesFeatures,
            propType: 'threes',
          })
        : predA.threes,
  };

  const vectors = buildLearnedFeatureVector({
    cdPrior,
    target,
    tgsByGameTeam,
    teamGamesByTeam,
    predTrackA: predA,
  });

  const pts = target.points;
  const reb = target.rebounds;
  const ast = target.assists;
  const threes = target.three_pointers_made;
  const pra =
    pts != null && reb != null && ast != null && Number.isFinite(pts) && Number.isFinite(reb) && Number.isFinite(ast)
      ? pts + reb + ast
      : null;

  return {
    meta: {
      player_id: target.player_id,
      game_id: target.game_id,
      season: target.season,
      start_time: target.start_time,
      basketball_date: basketballDateEt(target.start_time),
      team_id: target.team_id,
      opponent_team_id: opponentTeamId(target),
      split: chronoSplitForSeason(target.season),
      cutoff_policy: CUTOFF_POLICY_ID,
      feature_spec_version: LEARNED_FEATURE_SPEC_VERSION,
      historical_validity_class: HISTORICAL_VALIDITY_CLASS,
      ab_prior_played_count: abPlayed.length,
      cd_prior_played_count: cdPlayed.length,
      ab_leakage: countAsOfLeakage(abPrior, target.start_time),
      cd_leakage: countDateCutoffLeakage(cdPrior, target.start_time),
      cd_includes_target_game: cdPrior.some((g) => g.game_id === target.game_id) ? 1 : 0,
      minutes_change_bucket: minutesFeatures?.minutesChangeBucket ?? 'unknown',
      volume_bucket: minutesFeatures ? volumeBucket(minutesFeatures.seasonMin) : 'unknown',
      limited_history: abPlayed.length < 5 ? 1 : 0,
    },
    labels: {
      actual_pts: pts,
      actual_reb: reb,
      actual_ast: ast,
      actual_threes: threes,
      actual_pra: pra,
    },
    predA,
    predB,
    featuresC: pickAllowlist(vectors.c, FEATURE_C_ALLOWLIST),
    featuresD: pickAllowlist(vectors.d, FEATURE_D_ALLOWLIST),
    commonEligible: cdPlayed.length >= 1,
  };
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Paired MAE(B)−MAE(A). Resamples entire game-date groups, not i.i.d. rows. */
export function bootstrapMaeDifferenceGrouped(
  errA: number[],
  errB: number[],
  groupIds: string[],
  iterations = LEARNED_BOOTSTRAP_ITERS,
  seed = LEARNED_BOOTSTRAP_SEED
): {
  delta: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  n: number;
  nGroups: number;
  iterations: number;
} {
  const n = Math.min(errA.length, errB.length, groupIds.length);
  if (n === 0) {
    return { delta: null, ciLow: null, ciHigh: null, n: 0, nGroups: 0, iterations: 0 };
  }
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i += 1) {
    const id = groupIds[i] ?? '';
    const list = groups.get(id);
    if (list) list.push(i);
    else groups.set(id, [i]);
  }
  const keys = [...groups.keys()];
  let absA = 0;
  let absB = 0;
  for (let i = 0; i < n; i += 1) {
    absA += Math.abs(errA[i]);
    absB += Math.abs(errB[i]);
  }
  const delta = absB / n - absA / n;
  if (keys.length < 2 || iterations <= 0) {
    return { delta, ciLow: null, ciHigh: null, n, nGroups: keys.length, iterations: 0 };
  }
  const rand = lcg(seed);
  const boot: number[] = [];
  for (let b = 0; b < iterations; b += 1) {
    let a = 0;
    let bb = 0;
    let count = 0;
    for (let g = 0; g < keys.length; g += 1) {
      const pick = keys[Math.floor(rand() * keys.length)];
      const idxs = groups.get(pick) ?? [];
      for (const i of idxs) {
        a += Math.abs(errA[i]);
        bb += Math.abs(errB[i]);
        count += 1;
      }
    }
    if (count > 0) boot.push(bb / count - a / count);
  }
  boot.sort((x, y) => x - y);
  const loIdx = Math.max(0, Math.floor(0.025 * boot.length));
  const hiIdx = Math.min(boot.length - 1, Math.floor(0.975 * boot.length));
  return {
    delta,
    ciLow: boot[loIdx] ?? null,
    ciHigh: boot[hiIdx] ?? null,
    n,
    nGroups: keys.length,
    iterations: boot.length,
  };
}

assertNoLabelLeak(FEATURE_C_ALLOWLIST);
assertNoLabelLeak(FEATURE_D_ALLOWLIST);
