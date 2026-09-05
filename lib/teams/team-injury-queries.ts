/**
 * Team current-injury query (Phase 2.T.3B).
 * Source: analytics.player_injury_status_current (BDL player_id keyed).
 */

import { query } from '@/lib/db';
import { TEAM_INJURIES_BY_PLAYER_IDS_SQL } from './team-injury-sql';

export { TEAM_INJURIES_BY_PLAYER_IDS_SQL } from './team-injury-sql';

export type TeamInjuryRow = {
  playerId: string;
  teamId: string | null;
  status: string | null;
  description: string | null;
  returnDateRaw: string | null;
  snapshotAt: string;
  updatedAt: string;
};

/**
 * One query for all BDL-backed players on a roster.
 * Does not use injuries as membership — caller merges onto canonical roster.
 */
export async function getInjuriesForPlayerIds(
  playerIds: string[]
): Promise<TeamInjuryRow[]> {
  const ids = [...new Set(playerIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const rows = await query<{
    player_id: string;
    team_id: string | null;
    status: string | null;
    description: string | null;
    return_date_raw: string | null;
    snapshot_at: string;
    updated_at: string;
  }>(TEAM_INJURIES_BY_PLAYER_IDS_SQL, [ids]);

  return (rows ?? []).map((r) => ({
    playerId: r.player_id,
    teamId: r.team_id,
    status: r.status,
    description: r.description,
    returnDateRaw: r.return_date_raw,
    snapshotAt: r.snapshot_at,
    updatedAt: r.updated_at,
  }));
}
