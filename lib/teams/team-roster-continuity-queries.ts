/**
 * Set-based roster continuity query (two season-scoped roster reads + set diff).
 * No N+1 per player. No PGL / raw.players fallback.
 */

import { query, queryOne } from '@/lib/db';
import {
  ROSTER_SEASON_EXISTS_SQL,
  TEAM_ROSTER_ENTITY_SQL,
  assertContinuitySeason,
  computeRosterContinuity,
  previousAnalyticsSeason,
  type ContinuityPlayer,
  type TeamRosterContinuity,
} from '@/lib/teams/team-roster-continuity';

export type { TeamRosterContinuity, ContinuityPlayer } from '@/lib/teams/team-roster-continuity';

function mapRows(rows: unknown[]): ContinuityPlayer[] {
  return (rows ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      playerEntityId: String(r.player_entity_id),
      displayName: String(r.display_name ?? '—'),
    };
  });
}

export async function getTeamRosterContinuity(
  teamId: string,
  season: string
): Promise<TeamRosterContinuity> {
  const seasonNorm = assertContinuitySeason(season);
  const previousSeason = previousAnalyticsSeason(seasonNorm);

  const existsRow = await queryOne<{ ok: boolean }>(ROSTER_SEASON_EXISTS_SQL, [
    previousSeason,
  ]);
  const previousSeasonAvailable = Boolean(existsRow?.ok);

  if (!previousSeasonAvailable) {
    return computeRosterContinuity({
      season: seasonNorm,
      previousSeason,
      current: [],
      previous: [],
      previousSeasonAvailable: false,
    });
  }

  const [currentRows, previousRows] = await Promise.all([
    query(TEAM_ROSTER_ENTITY_SQL, [teamId, seasonNorm]),
    query(TEAM_ROSTER_ENTITY_SQL, [teamId, previousSeason]),
  ]);

  return computeRosterContinuity({
    season: seasonNorm,
    previousSeason,
    current: mapRows(currentRows),
    previous: mapRows(previousRows),
    previousSeasonAvailable: true,
  });
}
