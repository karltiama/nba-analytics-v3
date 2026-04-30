/**
 * Public types for the backtesting library.
 *
 * Pure, framework-free shapes. No DB or HTTP imports here so this module can
 * be consumed safely from server routes, scripts, and tests alike.
 */

/**
 * Single player-game row consumed by strategy evaluators.
 *
 * Identifiers are strings to stay consistent with `analytics.player_game_logs`
 * and BDL ids serialized as strings in our archive. `game_date` is a calendar
 * date in `YYYY-MM-DD` (ET, matching the rest of this codebase). Comparisons
 * use lexicographic order which is correct for ISO calendar dates.
 *
 * `minutes` is nullable because BDL emits null for DNPs. The strategy treats
 * null minutes as "ignore from the L5-minutes average" (see strategy file).
 *
 * Display fields (`player_name`, `team_abbr`, `opponent_abbr`) are optional;
 * the strategy never branches on them. They flow through to the emitted
 * Signal so the UI/CLI can render rows without re-joining.
 */
export type PlayerGameLog = {
  player_id: string;
  player_name?: string | null;
  game_id: string;
  game_date: string;
  team_abbr?: string | null;
  opponent_abbr?: string | null;

  minutes: number | null;

  points: number;
  rebounds: number;
  assists: number;
  /** 3-pt field goals made (FG3M). */
  threes: number;
};

/** Stat keys the strategy can be parameterized over. `pra = points + rebounds + assists`. */
export type Stat = 'points' | 'rebounds' | 'assists' | 'threes' | 'pra';

/**
 * Inputs to `evaluateRecentFormMinutes`.
 *
 * `evaluationStartDate` / `evaluationEndDate` are inclusive `YYYY-MM-DD` ET
 * bounds. Games outside this window are still allowed for lookback (so the
 * caller can fetch from season start), but signals are only emitted for
 * target games inside the window.
 */
export type RecentFormMinutesConfig = {
  stat: Stat;
  evaluationStartDate: string;
  evaluationEndDate: string;
  /** Minimum number of prior games required before a signal is considered. Default 8. */
  minPriorGames?: number;
  /** Minimum average minutes over the last 5 games (using only games where minutes is non-null). Default 28. */
  minMinutesL5?: number;
  /** Last-10 stat avg must be `>= seasonAvg * threshold` to fire. Default 1.15. */
  recentFormThreshold?: number;
  /** Weight on last-10 average in the weighted projection. Default 0.7. */
  projectionWeightL10?: number;
  /** Weight on season average in the weighted projection. Default 0.3. */
  projectionWeightSeason?: number;
};

/** Same as `RecentFormMinutesConfig` but with all defaults resolved. */
export type ResolvedRecentFormMinutesConfig = Required<RecentFormMinutesConfig>;

/** A single per-target-game evaluation result. */
export type Signal = {
  playerId: string;
  playerName: string | null;
  gameId: string;
  gameDate: string;
  team: string | null;
  opponent: string | null;

  stat: Stat;
  actual: number;

  seasonAvgBeforeGame: number;
  last5AvgBeforeGame: number;
  last10AvgBeforeGame: number;
  last5MinutesAvgBeforeGame: number;

  /** projectionWeightL10 * last10Avg + projectionWeightSeason * seasonAvg */
  weightedProjection: number;

  /** Strict inequality: `actual > seasonAvgBeforeGame`. */
  hitVsSeasonAvg: boolean;
  /** Strict inequality: `actual > weightedProjection`. */
  hitVsProjection: boolean;

  marginVsSeasonAvg: number;
  marginVsProjection: number;

  priorGames: number;
};

/** Aggregate over all emitted signals. All fields are 0 when totalSignals = 0. */
export type Summary = {
  totalSignals: number;
  hitRateVsSeasonAvg: number;
  hitRateVsProjection: number;
  averageMarginVsSeasonAvg: number;
  averageMarginVsProjection: number;
  medianMarginVsSeasonAvg: number;
  medianMarginVsProjection: number;
};

/** Top-level return type of any backtesting strategy. */
export type BacktestResult = {
  strategy: 'RECENT_FORM_MINUTES';
  config: ResolvedRecentFormMinutesConfig;
  summary: Summary;
  signals: Signal[];
};
