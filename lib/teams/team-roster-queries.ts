/**
 * Canonical team roster from analytics.team_roster_current (entity-first).
 * Always season-scoped. Does not use PGL or raw.players for membership.
 */

import { query } from '@/lib/db';
import {
  TEAM_ROSTER_CURRENT_SQL,
  assertAnalyticsSeason,
  sortCanonicalRoster,
  type CanonicalRosterPlayer,
} from './team-roster-presentation';

export type { CanonicalRosterPlayer } from './team-roster-presentation';
export {
  TEAM_ROSTER_CURRENT_SQL,
  assertAnalyticsSeason,
  assertRosterSeasonScoped,
  groupRosterByPosition,
  hasAnalyticsPlayerLink,
  rosterPlayerHref,
  sortCanonicalRoster,
} from './team-roster-presentation';

type RosterRow = {
  player_entity_id: string;
  player_id: string | null;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  jersey: string | null;
  membership_type: string | null;
  observed_from: string;
  source: string;
};

/**
 * Current open roster for one team + analytics season.
 * Requires season — never query the view without it.
 */
export async function getTeamCanonicalRoster(
  teamId: string,
  season: string
): Promise<CanonicalRosterPlayer[]> {
  assertAnalyticsSeason(season);

  const rows = await query<RosterRow>(TEAM_ROSTER_CURRENT_SQL, [teamId, season]);
  const mapped = (rows ?? []).map(
    (r): CanonicalRosterPlayer => ({
      playerEntityId: r.player_entity_id,
      playerId: r.player_id,
      displayName: r.display_name,
      firstName: r.first_name,
      lastName: r.last_name,
      position: r.position,
      jersey: r.jersey,
      membershipType: r.membership_type,
      observedFrom: r.observed_from,
      source: r.source,
    })
  );
  return sortCanonicalRoster(mapped);
}
