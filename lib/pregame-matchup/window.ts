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

/** Games already played this season, before the matchup's ET date. Null before opening night. */
export type CurrentSeasonWindow = {
  season: string;
  startInclusive: string;
  /** The matchup's ET date. Games on that date are excluded. */
  endExclusive: string;
  /** Cup Final date when it is known; it is not a regular-season game. */
  excludeDate: string | null;
};

export function currentSeasonWindow(season: string, gameEtDate: string): CurrentSeasonWindow | null {
  if (season === HISTORICAL_SEASON) return null;
  const startInclusive = REGULAR_SEASON_OPEN_ET[season];
  if (!startInclusive || gameEtDate <= startInclusive) return null;
  const postseason = POSTSEASON_START_ET[season];
  const endExclusive = postseason && postseason < gameEtDate ? postseason : gameEtDate;
  return { season, startInclusive, endExclusive, excludeDate: NBA_CUP_FINAL_ET[season] ?? null };
}

export function historicalWindow(season = HISTORICAL_SEASON): HistoricalWindow {
  const startInclusive = REGULAR_SEASON_OPEN_ET[season];
  const endExclusive = POSTSEASON_START_ET[season];
  const excludeDate = NBA_CUP_FINAL_ET[season];
  if (!startInclusive || !endExclusive || !excludeDate) {
    throw new Error(`missing regular-season window for ${season}`);
  }
  return { season, startInclusive, endExclusive, excludeDate };
}
