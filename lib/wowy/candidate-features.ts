/**
 * Cutoff-safe WOWY candidate features for projection research (wowy-r1).
 *
 * Reuses classifyWowyAppearance, isUsableWowyPrior, and summarizeWowyBeforeCutoff.
 * Does not import frozen PTS C / REB C or production serving.
 *
 * Overlap policy: primary_teammate_only. Rank teammates by prior played minutes
 * on this team stint. Do not rank by historical WOWY impact. Do not sum diffs
 * across absent teammates.
 */

import { classifyWowyAppearance, parseMinutes } from './appearance';
import { etCalendarDate } from './calendar';
import { isUsableWowyPrior } from './cutoff';
import { summarizeWowyBeforeCutoff, WOWY_SCENARIO_UNKNOWN } from './model-adapter';
import { wowySupportTier } from './policy';
import {
  hypotheticalScenario,
  selectObservedPregameScenario,
  type PregameAvailabilityObservation,
} from './availability-gate';
import type {
  WowyLoadedGame,
  WowyPairQuery,
  WowyScenarioSelection,
  WowyStatKey,
  WowySupportTier,
} from './types';

export const WOWY_R1_FEATURE_SPEC_VERSION = 'player-projection-wowy-features-r1';
export const WOWY_R1_OVERLAP_POLICY = 'primary_teammate_only' as const;
export const WOWY_R1_MAX_TRACKED_TEAMMATES = 3;
export const WOWY_R1_MIN_PRIMARY_PRIOR_MINUTES = 50;
export const WOWY_R1_MIN_PRIMARY_SHARED_GAMES = 2;

export const WOWY_R1_COUNTING_STATS = ['pts', 'reb', 'ast', 'fga', 'tpa', 'fta'] as const;
export type WowyR1CountingStat = (typeof WOWY_R1_COUNTING_STATS)[number];

export type WowyRosterAppearance = {
  playerId: string;
  gameId: string;
  startTime: string;
  teamId: string;
  minutes: string | number | null;
};

export type RankedTeammate = {
  playerId: string;
  priorPlayedMinutes: number;
  priorSharedPlayedGames: number;
  rank: number;
};

export type WowyCandidateNumericFeatures = {
  wowy_primary_with_games: number | null;
  wowy_primary_without_games: number | null;
  wowy_primary_with_minutes: number | null;
  wowy_primary_without_minutes: number | null;
  wowy_primary_with_pts: number | null;
  wowy_primary_without_pts: number | null;
  wowy_primary_delta_pts: number | null;
  wowy_primary_with_reb: number | null;
  wowy_primary_without_reb: number | null;
  wowy_primary_delta_reb: number | null;
  wowy_primary_with_ast: number | null;
  wowy_primary_without_ast: number | null;
  wowy_primary_delta_ast: number | null;
  wowy_primary_with_fga: number | null;
  wowy_primary_without_fga: number | null;
  wowy_primary_delta_fga: number | null;
  wowy_primary_with_tpa: number | null;
  wowy_primary_without_tpa: number | null;
  wowy_primary_delta_tpa: number | null;
  wowy_primary_with_fta: number | null;
  wowy_primary_without_fta: number | null;
  wowy_primary_delta_fta: number | null;
  wowy_primary_with_pts_per_min: number | null;
  wowy_primary_without_pts_per_min: number | null;
  wowy_primary_delta_pts_per_min: number | null;
  wowy_primary_with_reb_per_min: number | null;
  wowy_primary_without_reb_per_min: number | null;
  wowy_primary_delta_reb_per_min: number | null;
  wowy_primary_support_insufficient: number | null;
  wowy_primary_support_low: number | null;
  wowy_primary_support_adequate: number | null;
  wowy_unknown_participation_count: number | null;
  wowy_unknown_membership_count: number | null;
  wowy_excluded_count: number | null;
  wowy_days_since_last_with: number | null;
  wowy_days_since_last_without: number | null;
  wowy_tracked_teammate_count: number | null;
  wowy_overlap_flag: number | null;
  wowy_scenario_known: number | null;
  wowy_scenario_without: number | null;
  wowy_predictive_eligible: number | null;
};

export const WOWY_R1_FEATURE_ALLOWLIST = [
  'wowy_primary_with_games',
  'wowy_primary_without_games',
  'wowy_primary_with_minutes',
  'wowy_primary_without_minutes',
  'wowy_primary_with_pts',
  'wowy_primary_without_pts',
  'wowy_primary_delta_pts',
  'wowy_primary_with_reb',
  'wowy_primary_without_reb',
  'wowy_primary_delta_reb',
  'wowy_primary_with_ast',
  'wowy_primary_without_ast',
  'wowy_primary_delta_ast',
  'wowy_primary_with_fga',
  'wowy_primary_without_fga',
  'wowy_primary_delta_fga',
  'wowy_primary_with_tpa',
  'wowy_primary_without_tpa',
  'wowy_primary_delta_tpa',
  'wowy_primary_with_fta',
  'wowy_primary_without_fta',
  'wowy_primary_delta_fta',
  'wowy_primary_with_pts_per_min',
  'wowy_primary_without_pts_per_min',
  'wowy_primary_delta_pts_per_min',
  'wowy_primary_with_reb_per_min',
  'wowy_primary_without_reb_per_min',
  'wowy_primary_delta_reb_per_min',
  'wowy_primary_support_insufficient',
  'wowy_primary_support_low',
  'wowy_primary_support_adequate',
  'wowy_unknown_participation_count',
  'wowy_unknown_membership_count',
  'wowy_excluded_count',
  'wowy_days_since_last_with',
  'wowy_days_since_last_without',
  'wowy_tracked_teammate_count',
  'wowy_overlap_flag',
  'wowy_scenario_known',
  'wowy_scenario_without',
  'wowy_predictive_eligible',
] as const satisfies ReadonlyArray<keyof WowyCandidateNumericFeatures>;

export type WowyCandidateFeatureName = (typeof WOWY_R1_FEATURE_ALLOWLIST)[number];

export type WowyCandidateFeatureRow = {
  historicalValidityClass: 'reconstructed_historical';
  overlapPolicy: typeof WOWY_R1_OVERLAP_POLICY;
  primaryTeammateId: string | null;
  trackedTeammateIds: string[];
  supportTier: WowySupportTier | null;
  scenario: WowyScenarioSelection;
  predictiveEligible: boolean;
  unavailableReason: string | null;
  features: WowyCandidateNumericFeatures;
};

const EMPTY_FEATURES: WowyCandidateNumericFeatures = {
  wowy_primary_with_games: null,
  wowy_primary_without_games: null,
  wowy_primary_with_minutes: null,
  wowy_primary_without_minutes: null,
  wowy_primary_with_pts: null,
  wowy_primary_without_pts: null,
  wowy_primary_delta_pts: null,
  wowy_primary_with_reb: null,
  wowy_primary_without_reb: null,
  wowy_primary_delta_reb: null,
  wowy_primary_with_ast: null,
  wowy_primary_without_ast: null,
  wowy_primary_delta_ast: null,
  wowy_primary_with_fga: null,
  wowy_primary_without_fga: null,
  wowy_primary_delta_fga: null,
  wowy_primary_with_tpa: null,
  wowy_primary_without_tpa: null,
  wowy_primary_delta_tpa: null,
  wowy_primary_with_fta: null,
  wowy_primary_without_fta: null,
  wowy_primary_delta_fta: null,
  wowy_primary_with_pts_per_min: null,
  wowy_primary_without_pts_per_min: null,
  wowy_primary_delta_pts_per_min: null,
  wowy_primary_with_reb_per_min: null,
  wowy_primary_without_reb_per_min: null,
  wowy_primary_delta_reb_per_min: null,
  wowy_primary_support_insufficient: null,
  wowy_primary_support_low: null,
  wowy_primary_support_adequate: null,
  wowy_unknown_participation_count: null,
  wowy_unknown_membership_count: null,
  wowy_excluded_count: null,
  wowy_days_since_last_with: null,
  wowy_days_since_last_without: null,
  wowy_tracked_teammate_count: null,
  wowy_overlap_flag: null,
  wowy_scenario_known: null,
  wowy_scenario_without: null,
  wowy_predictive_eligible: null,
};

function etDateDiffDays(fromDate: string | null, toIso: string): number | null {
  const toDate = etCalendarDate(toIso);
  if (!fromDate || !toDate) return null;
  const [y1, m1, d1] = fromDate.split('-').map(Number);
  const [y2, m2, d2] = toDate.split('-').map(Number);
  if (![y1, m1, d1, y2, m2, d2].every((n) => Number.isFinite(n))) return null;
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}

function emptyRow(
  extra: Partial<WowyCandidateFeatureRow> & Pick<WowyCandidateFeatureRow, 'unavailableReason'>
): WowyCandidateFeatureRow {
  return {
    historicalValidityClass: 'reconstructed_historical',
    overlapPolicy: WOWY_R1_OVERLAP_POLICY,
    primaryTeammateId: null,
    trackedTeammateIds: [],
    supportTier: null,
    scenario: WOWY_SCENARIO_UNKNOWN,
    predictiveEligible: false,
    features: { ...EMPTY_FEATURES },
    ...extra,
  };
}

/**
 * Rank other players by minutes they played in prior subject-played games on this stint.
 * Does not inspect WOWY diffs or target-game participation.
 */
export function rankTeammatesByPriorMinutes(args: {
  subjectPlayerId: string;
  teamId: string;
  cutoffStartTime: string;
  appearances: WowyRosterAppearance[];
}): RankedTeammate[] {
  const subjectPlayedGames = new Set<string>();
  for (const row of args.appearances) {
    if (row.playerId !== args.subjectPlayerId) continue;
    if (row.teamId !== args.teamId) continue;
    if (!isUsableWowyPrior(row.startTime, args.cutoffStartTime)) continue;
    if (classifyWowyAppearance({ minutes: row.minutes }).class !== 'played') continue;
    subjectPlayedGames.add(row.gameId);
  }

  const totals = new Map<string, { minutes: number; games: number }>();
  for (const row of args.appearances) {
    if (row.playerId === args.subjectPlayerId) continue;
    if (row.teamId !== args.teamId) continue;
    if (!subjectPlayedGames.has(row.gameId)) continue;
    if (classifyWowyAppearance({ minutes: row.minutes }).class !== 'played') continue;
    const mins = parseMinutes(row.minutes) ?? 0;
    const prev = totals.get(row.playerId) ?? { minutes: 0, games: 0 };
    totals.set(row.playerId, { minutes: prev.minutes + mins, games: prev.games + 1 });
  }

  return [...totals.entries()]
    .sort((a, b) => {
      if (b[1].minutes !== a[1].minutes) return b[1].minutes - a[1].minutes;
      if (b[1].games !== a[1].games) return b[1].games - a[1].games;
      return a[0].localeCompare(b[0]);
    })
    .map(([playerId, t], i) => ({
      playerId,
      priorPlayedMinutes: t.minutes,
      priorSharedPlayedGames: t.games,
      rank: i + 1,
    }));
}

function pickPrimary(ranked: RankedTeammate[]): {
  primary: RankedTeammate | null;
  tracked: RankedTeammate[];
} {
  const tracked = ranked.slice(0, WOWY_R1_MAX_TRACKED_TEAMMATES);
  const primary = tracked[0];
  if (
    !primary ||
    primary.priorPlayedMinutes < WOWY_R1_MIN_PRIMARY_PRIOR_MINUTES ||
    primary.priorSharedPlayedGames < WOWY_R1_MIN_PRIMARY_SHARED_GAMES
  ) {
    return { primary: null, tracked };
  }
  return { primary, tracked };
}

function counting(
  perGame: Record<WowyStatKey, number | null>,
  key: WowyR1CountingStat
): number | null {
  const v = perGame[key];
  return v != null && Number.isFinite(v) ? v : null;
}

function fillScenarioFlags(
  features: WowyCandidateNumericFeatures,
  scenario: WowyScenarioSelection,
  predictiveEligible: boolean
): void {
  features.wowy_scenario_known = scenario.status === 'observed_pregame' ? 1 : 0;
  if (scenario.status === 'observed_pregame' || scenario.status === 'hypothetical') {
    features.wowy_scenario_without = scenario.choice === 'without' ? 1 : 0;
  } else {
    features.wowy_scenario_without = null;
  }
  features.wowy_predictive_eligible = predictiveEligible ? 1 : 0;
}

export function buildWowyCandidateFeatures(args: {
  subjectPlayerId: string;
  subjectName: string;
  teammateNames?: Record<string, string>;
  teamId: string;
  season: string;
  seasonType?: WowyPairQuery['seasonType'];
  cutoffStartTime: string;
  appearances: WowyRosterAppearance[];
  gamesByTeammate: Record<string, WowyLoadedGame[]>;
  observations?: PregameAvailabilityObservation[];
  /**
   * Explicit hypothetical only. Never pass a choice inferred from the target box.
   * Ignored when timestamped pregame observations select a scenario.
   */
  hypotheticalChoice?: 'with' | 'without';
}): WowyCandidateFeatureRow {
  const ranked = rankTeammatesByPriorMinutes({
    subjectPlayerId: args.subjectPlayerId,
    teamId: args.teamId,
    cutoffStartTime: args.cutoffStartTime,
    appearances: args.appearances,
  });
  const { primary, tracked } = pickPrimary(ranked);
  const trackedIds = tracked.map((t) => t.playerId);

  if (!primary) {
    const row = emptyRow({
      trackedTeammateIds: trackedIds,
      unavailableReason: 'no_primary_teammate',
      features: {
        ...EMPTY_FEATURES,
        wowy_tracked_teammate_count: trackedIds.length,
        wowy_overlap_flag: trackedIds.length >= 2 ? 1 : 0,
        wowy_predictive_eligible: 0,
        wowy_scenario_known: 0,
        wowy_scenario_without: null,
      },
    });
    return row;
  }

  const pairGames = args.gamesByTeammate[primary.playerId] ?? [];
  const query: WowyPairQuery = {
    subjectPlayerId: args.subjectPlayerId,
    teammatePlayerId: primary.playerId,
    season: args.season,
    teamId: args.teamId,
    seasonType: args.seasonType ?? 'regular',
    cutoffStartTime: args.cutoffStartTime,
  };

  const gate = selectObservedPregameScenario({
    teammatePlayerId: primary.playerId,
    cutoffStartTime: args.cutoffStartTime,
    observations: args.observations ?? [],
  });

  let scenario: WowyScenarioSelection = gate.scenario;
  if (scenario.status === 'unknown' && args.hypotheticalChoice) {
    scenario = hypotheticalScenario(args.hypotheticalChoice);
  }

  const pair = summarizeWowyBeforeCutoff({
    games: pairGames,
    query,
    subjectName: args.subjectName,
    teammateName: args.teammateNames?.[primary.playerId] ?? primary.playerId,
    scenario,
  });

  const support = wowySupportTier(pair.history.with.gameCount, pair.history.without.gameCount);
  const diffsUsable = support !== 'insufficient';
  const features: WowyCandidateNumericFeatures = { ...EMPTY_FEATURES };

  features.wowy_primary_with_games = pair.history.with.gameCount;
  features.wowy_primary_without_games = pair.history.without.gameCount;
  features.wowy_primary_with_minutes = pair.history.with.perGame.minutes;
  features.wowy_primary_without_minutes = pair.history.without.perGame.minutes;

  for (const stat of WOWY_R1_COUNTING_STATS) {
    features[`wowy_primary_with_${stat}`] = counting(pair.history.with.perGame, stat);
    features[`wowy_primary_without_${stat}`] = counting(pair.history.without.perGame, stat);
    features[`wowy_primary_delta_${stat}`] = diffsUsable
      ? pair.history.diff.absolutePerGame[stat]
      : null;
  }

  features.wowy_primary_with_pts_per_min = pair.history.with.perMinute.pts;
  features.wowy_primary_without_pts_per_min = pair.history.without.perMinute.pts;
  features.wowy_primary_delta_pts_per_min = diffsUsable ? pair.history.diff.absolutePerMinute.pts : null;
  features.wowy_primary_with_reb_per_min = pair.history.with.perMinute.reb;
  features.wowy_primary_without_reb_per_min = pair.history.without.perMinute.reb;
  features.wowy_primary_delta_reb_per_min = diffsUsable ? pair.history.diff.absolutePerMinute.reb : null;

  features.wowy_primary_support_insufficient = support === 'insufficient' ? 1 : 0;
  features.wowy_primary_support_low = support === 'low_support' ? 1 : 0;
  features.wowy_primary_support_adequate = support === 'adequate' ? 1 : 0;
  features.wowy_unknown_participation_count = pair.history.unknownParticipationCount;
  features.wowy_unknown_membership_count = pair.history.unknownMembershipCount;
  const cutoffExcluded =
    pair.history.exclusions.find((e) => e.reason === 'on_or_after_cutoff')?.count ?? 0;
  features.wowy_excluded_count = pair.history.excludedCount - cutoffExcluded;
  features.wowy_days_since_last_with = etDateDiffDays(
    pair.history.with.dateCoverage.last,
    args.cutoffStartTime
  );
  features.wowy_days_since_last_without = etDateDiffDays(
    pair.history.without.dateCoverage.last,
    args.cutoffStartTime
  );
  features.wowy_tracked_teammate_count = trackedIds.length;
  features.wowy_overlap_flag = trackedIds.length >= 2 ? 1 : 0;

  const predictiveEligible = gate.predictiveEligible && diffsUsable;
  fillScenarioFlags(features, pair.scenario, predictiveEligible);

  const unavailableReason = predictiveEligible
    ? null
    : !diffsUsable
      ? 'insufficient_wowy_support'
      : gate.reason ?? 'pregame_availability_unknown';

  return {
    historicalValidityClass: 'reconstructed_historical',
    overlapPolicy: WOWY_R1_OVERLAP_POLICY,
    primaryTeammateId: primary.playerId,
    trackedTeammateIds: trackedIds,
    supportTier: support,
    scenario: pair.scenario,
    predictiveEligible,
    unavailableReason,
    features,
  };
}

export function numericFeatureVector(row: WowyCandidateFeatureRow): Array<{
  name: WowyCandidateFeatureName;
  value: number | null;
}> {
  return WOWY_R1_FEATURE_ALLOWLIST.map((name) => ({ name, value: row.features[name] }));
}
