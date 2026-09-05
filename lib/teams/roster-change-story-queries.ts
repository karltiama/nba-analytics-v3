/**
 * Set-based prior-season role enrichment for roster-change storytelling.
 * One stats query + roster-team lookups — no N+1.
 */

import { query } from '@/lib/db';
import type { TeamRosterContinuity } from '@/lib/teams/team-roster-continuity';
import {
  ENTITY_OPEN_ROSTER_TEAM_SQL,
  PRIOR_SEASON_ROLE_STATS_SQL,
  buildRosterChangeStory,
  emptyRosterChangeStory,
  type PriorSeasonRoleStats,
  type RosterChangeStory,
} from '@/lib/teams/roster-change-story';

export type { RosterChangeStory } from '@/lib/teams/roster-change-story';
export { PRIOR_SEASON_ROLE_STATS_SQL, ENTITY_OPEN_ROSTER_TEAM_SQL };

function collectBdlIds(continuity: TeamRosterContinuity): string[] {
  const ids = new Set<string>();
  for (const p of [...continuity.added, ...continuity.departed]) {
    if (p.playerId) ids.add(p.playerId);
  }
  return [...ids];
}

function collectEntityIds(
  players: { playerEntityId: string }[]
): string[] {
  return [...new Set(players.map((p) => p.playerEntityId))];
}

export async function getRosterChangeStory(
  teamId: string,
  continuity: TeamRosterContinuity
): Promise<RosterChangeStory> {
  if (!continuity.available) {
    return emptyRosterChangeStory(continuity);
  }

  const priorSeason = continuity.previousSeason;
  const bdlIds = collectBdlIds(continuity);
  const addedEntityIds = collectEntityIds(continuity.added);
  const departedEntityIds = collectEntityIds(continuity.departed);

  const [statRows, priorTeamRows, currentTeamRows] = await Promise.all([
    bdlIds.length > 0
      ? query(PRIOR_SEASON_ROLE_STATS_SQL, [priorSeason, bdlIds])
      : Promise.resolve([]),
    addedEntityIds.length > 0
      ? query(ENTITY_OPEN_ROSTER_TEAM_SQL, [priorSeason, addedEntityIds])
      : Promise.resolve([]),
    departedEntityIds.length > 0
      ? query(ENTITY_OPEN_ROSTER_TEAM_SQL, [
          continuity.season,
          departedEntityIds,
        ])
      : Promise.resolve([]),
  ]);

  const statsByPlayerId = new Map<string, PriorSeasonRoleStats>();
  for (const raw of statRows) {
    const r = raw as Record<string, unknown>;
    const playerId = String(r.player_id);
    statsByPlayerId.set(playerId, {
      playerId,
      gamesPlayed: r.games_played != null ? Number(r.games_played) : null,
      mpg: r.mpg != null ? Number(r.mpg) : null,
      ppg: r.pts_avg != null ? Number(r.pts_avg) : null,
    });
  }

  const priorTeamByEntity = new Map<string, string>();
  for (const raw of priorTeamRows) {
    const r = raw as Record<string, unknown>;
    const eid = String(r.player_entity_id);
    if (String(r.team_id) === teamId) continue;
    if (!priorTeamByEntity.has(eid)) {
      priorTeamByEntity.set(eid, String(r.team_abbr));
    }
  }

  const currentOtherTeamByEntity = new Map<string, string>();
  for (const raw of currentTeamRows) {
    const r = raw as Record<string, unknown>;
    if (String(r.team_id) === teamId) continue;
    const eid = String(r.player_entity_id);
    if (!currentOtherTeamByEntity.has(eid)) {
      currentOtherTeamByEntity.set(eid, String(r.team_abbr));
    }
  }

  return buildRosterChangeStory({
    continuity,
    statsByPlayerId,
    priorTeamByEntity,
    currentOtherTeamByEntity,
  });
}
