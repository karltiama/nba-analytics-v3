/**
 * 2025–26 regular-season fence for pregame matchup context.
 * Dates are the canonical season-eligibility constants, not a second calendar.
 */

import { NBA_CUP_FINAL_ET, POSTSEASON_START_ET, REGULAR_SEASON_OPEN_ET } from '@/lib/games/season-eligibility';

/** Analytics season key for the last completed season (2025–26). */
export const HISTORICAL_SEASON = '2025';

export const HISTORICAL_SEASON_LABEL = '2025–26 Regular Season';

export const EXPECTED_TEAM_GAMES = 82;
export const EXPECTED_LEAGUE_GAMES = 1230;
export const EXPECTED_TEAM_COUNT = 30;

export type HistoricalWindow = {
  season: string;
  startInclusive: string;
  endExclusive: string;
  excludeDate: string;
};

export function historicalWindow(season = HISTORICAL_SEASON): HistoricalWindow {
  const startInclusive = REGULAR_SEASON_OPEN_ET[season];
  const endExclusive = POSTSEASON_START_ET[season];
  const excludeDate = NBA_CUP_FINAL_ET[season];
  if (!startInclusive || !endExclusive || !excludeDate) {
    throw new Error(`missing regular-season window for ${season}`);
  }
  return { season, startInclusive, endExclusive, excludeDate };
}
