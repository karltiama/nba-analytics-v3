/**
 * Compact upcoming + recent schedule for the team page.
 * Reads analytics.games only; requires explicit season (page season).
 */

import { query } from '@/lib/db';
import {
  COMPACT_SCHEDULE_DEFAULT_LIMIT,
  TEAM_COMPACT_RECENT_SQL,
  TEAM_COMPACT_UPCOMING_SQL,
  assertCompactScheduleSeason,
  mapCompactScheduleRow,
  type TeamCompactSchedule,
} from '@/lib/teams/team-compact-schedule';

export type { CompactScheduleGame, TeamCompactSchedule } from '@/lib/teams/team-compact-schedule';

export async function getTeamCompactSchedule(
  teamId: string,
  season: string,
  opts?: {
    limitUpcoming?: number;
    limitRecent?: number;
    /** Clock used for upcoming/recent split (tests). Default: now. */
    asOf?: Date;
  }
): Promise<TeamCompactSchedule> {
  const seasonNorm = assertCompactScheduleSeason(season);
  const limitUpcoming = opts?.limitUpcoming ?? COMPACT_SCHEDULE_DEFAULT_LIMIT;
  const limitRecent = opts?.limitRecent ?? COMPACT_SCHEDULE_DEFAULT_LIMIT;
  const asOf = opts?.asOf ?? new Date();

  const [upcomingRows, recentRows] = await Promise.all([
    query(TEAM_COMPACT_UPCOMING_SQL, [teamId, seasonNorm, asOf.toISOString(), limitUpcoming]),
    query(TEAM_COMPACT_RECENT_SQL, [teamId, seasonNorm, asOf.toISOString(), limitRecent]),
  ]);

  return {
    season: seasonNorm,
    upcoming: upcomingRows.map((r) =>
      mapCompactScheduleRow(teamId, r as Record<string, unknown>)
    ),
    recent: recentRows.map((r) =>
      mapCompactScheduleRow(teamId, r as Record<string, unknown>)
    ),
  };
}
