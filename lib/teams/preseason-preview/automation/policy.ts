/**
 * Transparent thresholds for preseason context signals (V1.1).
 *
 * Minutes role floors reuse roster-change-story constants.
 * Recent competitive minutes ratio reuses RECENT_FORM_MINUTES backtest (1.15).
 * Window intentionally includes postseason → signal name is not "late-season RS".
 */

import {
  ROLE_MAJOR_MPG,
  ROLE_ROTATION_MPG,
} from '@/lib/teams/roster-change-story';

export const PRESEASON_SIGNAL_POLICY_ID = 'preseason-context-signals-v1.1';

/** Meaningful vacated / high-minute floor — same as major rotation storytelling. */
export const HIGH_MINUTE_MPG = ROLE_MAJOR_MPG; // 28

/** Lower bound for “rotation minutes vacated” storytelling. */
export const MEANINGFUL_MINUTE_MPG = ROLE_ROTATION_MPG; // 15

/**
 * Canonical HIGH_USAGE_RETURNER aggregation method id.
 *
 * Method: unweighted arithmetic mean of
 *   analytics.player_game_advanced.usage_percentage
 * for rows in the prior analytics season where:
 *   - usage_percentage IS NOT NULL
 *   - joined analytics.player_game_logs.minutes parses to a number
 *     strictly greater than MIN_USAGE_MINUTES_PER_GAME
 * Scope: all teams that season (not previous-team-only).
 * Units: fraction 0–1 (same as stored column).
 * Not possession-weighted; not minutes-weighted.
 */
export const USAGE_AGGREGATION_METHOD = 'mean_usage_pct_played_games_v1';

/** Exclude garbage / DNP-adjacent advanced rows from usage mean. */
export const MIN_USAGE_MINUTES_PER_GAME = 5;

/**
 * High-usage returner floor (fraction). Editorial threshold — not a model score.
 */
export const HIGH_USAGE_AVG = 0.24;

/** Min usage-eligible games before HIGH_USAGE_RETURNER fires. */
export const MIN_USAGE_GAMES = 20;

/** Min total minutes across usage-eligible games. */
export const MIN_USAGE_TOTAL_MINUTES = 400;

/** Min prior-season GP (PSA/PGL) before high-minute signals fire. */
export const MIN_SEASON_GP_FOR_ROLE_SIGNAL = 20;

/**
 * Recent competitive minutes window: last N *played* games of prior season
 * by tipoff DESC. Intentionally includes postseason when those games fall
 * in the window — see RECENT_COMPETITIVE_MINUTES_INCREASE.
 */
export const RECENT_COMPETITIVE_WINDOW_GAMES = 10;

/**
 * Ratio: recentMpg >= baselineMpg * RECENT_COMPETITIVE_MINUTES_RATIO
 * Aligned with lib/backtesting/strategies/recent-form-minutes DEFAULTS.recentFormThreshold.
 */
export const RECENT_COMPETITIVE_MINUTES_RATIO = 1.15;

/** Min season GP before recent-competitive comparison is allowed. */
export const RECENT_COMPETITIVE_MIN_SEASON_GP = 20;

/** Min games in the recent window. */
export const RECENT_COMPETITIVE_MIN_WINDOW_GP = 8;

/** Min baseline MPG so “increase” is not noise on tiny roles. */
export const RECENT_COMPETITIVE_MIN_BASELINE_MPG = ROLE_ROTATION_MPG;

/** @deprecated alias — prefer RECENT_COMPETITIVE_* */
export const LATE_SEASON_WINDOW_GAMES = RECENT_COMPETITIVE_WINDOW_GAMES;
/** @deprecated */
export const LATE_SEASON_MINUTES_RATIO = RECENT_COMPETITIVE_MINUTES_RATIO;
/** @deprecated */
export const LATE_SEASON_MIN_SEASON_GP = RECENT_COMPETITIVE_MIN_SEASON_GP;
/** @deprecated */
export const LATE_SEASON_MIN_WINDOW_GP = RECENT_COMPETITIVE_MIN_WINDOW_GP;
/** @deprecated */
export const LATE_SEASON_MIN_SEASON_MPG = RECENT_COMPETITIVE_MIN_BASELINE_MPG;

/**
 * Deferred (not implemented):
 * - VACATED_USAGE
 * - LATE_SEASON_USAGE_INCREASE / recent usage increase
 */
export const DEFERRED_SIGNAL_TYPES = [
  'VACATED_USAGE',
  'LATE_SEASON_USAGE_INCREASE',
] as const;

export const WOWY_PREVIEW_DISCLAIMER =
  'Historical with/without results describe previous outcomes and do not guarantee the same effect in a new lineup. Game-level WOWY is not possession-level chemistry.';
