/**
 * Current NBA Teams directory query — one set-based SELECT, no N+1.
 */

import { query } from '@/lib/db';
import {
  CURRENT_NBA_TEAMS_SQL,
  assertCurrentNbaTeamSet,
  groupTeamsByConferenceDivision,
  mapTeamRow,
  type ConferenceDivisionGroup,
} from '@/lib/teams/team-directory';
import type { TeamInfo } from '@/lib/teams/types';

export type { ConferenceDivisionGroup } from '@/lib/teams/team-directory';

export async function listCurrentNbaTeams(): Promise<{
  teams: TeamInfo[];
  groups: ConferenceDivisionGroup[];
  integrity: ReturnType<typeof assertCurrentNbaTeamSet>;
}> {
  const rows = await query(CURRENT_NBA_TEAMS_SQL, []);
  const teams = (rows ?? []).map((r) => mapTeamRow(r as Record<string, unknown>));
  const integrity = assertCurrentNbaTeamSet(teams);
  const groups = groupTeamsByConferenceDivision(teams);
  return { teams, groups, integrity };
}
