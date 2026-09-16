export {
  WOWY_CALCULATION_VERSION,
  WOWY_DATA_VERSION,
  WOWY_STAT_KEYS,
  WOWY_RATE_STAT_KEYS,
  WOWY_SEASON_TYPES,
  isSelfWowyQuery,
} from './types';
export type {
  WowyPairQuery,
  WowyPairSummary,
  WowyModelPairResult,
  WowyScenarioSelection,
  WowyLoadedGame,
  WowyClassifiedGame,
  WowyTeammateOption,
  WowyTeamStintOption,
} from './types';

export { classifyWowyGame, classifyWowyGames } from './eligibility';
export { aggregateWowyGroup, summarizeWowyPair, diffWowyGroups } from './aggregate';
export { summarizeWowyBeforeCutoff, WOWY_SCENARIO_UNKNOWN } from './model-adapter';
export { isUsableWowyPrior, isOnOrAfterCutoff } from './cutoff';
export {
  selectObservedPregameScenario,
  hypotheticalScenario,
  WOWY_R1_WITHOUT_STATUSES,
} from './availability-gate';
export type { PregameAvailabilityObservation, AvailabilityGateResult } from './availability-gate';
export {
  buildWowyCandidateFeatures,
  rankTeammatesByPriorMinutes,
  numericFeatureVector,
  WOWY_R1_FEATURE_ALLOWLIST,
  WOWY_R1_FEATURE_SPEC_VERSION,
  WOWY_R1_OVERLAP_POLICY,
  WOWY_R1_MAX_TRACKED_TEAMMATES,
  WOWY_R1_MIN_PRIMARY_PRIOR_MINUTES,
  WOWY_R1_MIN_PRIMARY_SHARED_GAMES,
} from './candidate-features';
export type {
  WowyCandidateFeatureRow,
  WowyCandidateNumericFeatures,
  WowyRosterAppearance,
} from './candidate-features';
export {
  WOWY_SUPPORT_POLICY_ID,
  WOWY_INSUFFICIENT_MIN_GAMES,
  WOWY_LOW_SUPPORT_MIN_GAMES,
  wowySupportTier,
  wowyShowsComparisonHero,
} from './policy';
export { wowyCacheKey, WOWY_CACHE_REVALIDATE_SECONDS } from './cache';
export {
  buildWowyInsights,
  rankedPerGameDiffs,
  wowyChartStats,
  wowyDiffPolarity,
  wowyDiffTone,
  WOWY_CHART_STATS,
} from './insights';
export type { WowyInsight, WowyInsightTone } from './insights';
export {
  resolveWowyExplorerSelection,
  wowySummaryMatchesSelection,
  formatWowyTeammatePickerLabel,
} from './explorer-selection';
export { teammatePickerCountsFromGames } from './picker-counts';
export {
  searchWowyPlayers,
  loadWowyTeamStints,
  loadWowyTeammates,
  loadWowyPairGames,
  loadWowyPairSummary,
  loadWowyModelPair,
  resolveWowyPlayerIdentity,
} from './queries';
