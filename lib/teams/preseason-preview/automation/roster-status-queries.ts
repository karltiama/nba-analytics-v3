/**
 * Load elsewhere open-roster membership for continuity classification.
 */

import { query } from '@/lib/db';
import type { OtherTeamMembership } from './roster-status';

export const ELSEWHERE_OPEN_ROSTER_SQL = `
  SELECT
    c.player_entity_id::text AS player_entity_id,
    t.abbreviation AS team_abbr,
    c.team_id
  FROM analytics.team_roster_current c
  JOIN analytics.teams t ON t.team_id = c.team_id
  WHERE c.season = $1
    AND c.team_id <> $2
    AND c.player_entity_id = ANY($3::uuid[])
`;

export async function loadElsewhereOpenRoster(args: {
  season: string;
  excludeTeamId: string;
  entityIds: string[];
}): Promise<Map<string, OtherTeamMembership>> {
  const map = new Map<string, OtherTeamMembership>();
  if (args.entityIds.length === 0) return map;

  const rows = await query(ELSEWHERE_OPEN_ROSTER_SQL, [
    args.season,
    args.excludeTeamId,
    args.entityIds,
  ]);

  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const eid = String(r.player_entity_id);
    if (map.has(eid)) continue;
    map.set(eid, {
      playerEntityId: eid,
      teamAbbr: String(r.team_abbr),
      teamId: String(r.team_id),
    });
  }
  return map;
}
