/**
 * Team schedule season scoping.
 *
 * Uses the NBA start-year convention (resolveTeamPageSeason / getAnalyticsSeason),
 * never calendar-year filtering of start_time.
 */

import { resolveTeamPageSeason } from '@/lib/teams/team-page-season';

export function resolveTeamScheduleSeason(
  selectedSeason?: string | null,
  env?: NodeJS.ProcessEnv
): string {
  return resolveTeamPageSeason({ selectedSeason, env }).season;
}

/** Drop any row whose stored analytics season is not the requested season. */
export function filterScheduleRowsToSeason<T extends { season: string }>(
  rows: T[],
  season: string
): T[] {
  return rows.filter((row) => row.season === season);
}
