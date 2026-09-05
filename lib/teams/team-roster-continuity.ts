/**
 * Roster continuity: entity-set diff between selected season and previous season.
 * Uses player_entity_id only — never names or BDL IDs for identity.
 */

import { assertAnalyticsSeason } from '@/lib/teams/team-roster-presentation';

/** Entity ids for one team + season from team_roster_current. */
export const TEAM_ROSTER_ENTITY_SQL = `
  SELECT
    player_entity_id::text AS player_entity_id,
    display_name
  FROM analytics.team_roster_current
  WHERE team_id = $1
    AND season = $2
`;

/** League-wide probe: does this season have any canonical open roster rows? */
export const ROSTER_SEASON_EXISTS_SQL = `
  SELECT EXISTS (
    SELECT 1
    FROM analytics.team_roster_current
    WHERE season = $1
    LIMIT 1
  ) AS ok
`;

export const CONTINUITY_LIST_PREVIEW = 5;

export type ContinuityPlayer = {
  playerEntityId: string;
  displayName: string;
};

export type TeamRosterContinuity = {
  season: string;
  previousSeason: string;
  available: boolean;
  unavailableReason: string | null;
  returningCount: number;
  addedCount: number;
  departedCount: number;
  returning: ContinuityPlayer[];
  added: ContinuityPlayer[];
  departed: ContinuityPlayer[];
};

export function previousAnalyticsSeason(season: string): string {
  assertAnalyticsSeason(season);
  return String(Number(season) - 1);
}

export function assertContinuitySeason(season: string): string {
  assertAnalyticsSeason(season);
  return season;
}

function sortByName(a: ContinuityPlayer, b: ContinuityPlayer): number {
  return a.displayName.localeCompare(b.displayName, 'en', {
    sensitivity: 'base',
  });
}

/**
 * Pure set diff on entity ids. Display names are labels only.
 * Same display name + different entity ids do not merge.
 */
export function computeRosterContinuity(args: {
  season: string;
  previousSeason: string;
  current: ContinuityPlayer[];
  previous: ContinuityPlayer[];
  previousSeasonAvailable: boolean;
}): TeamRosterContinuity {
  const { season, previousSeason, current, previous, previousSeasonAvailable } =
    args;

  if (!previousSeasonAvailable) {
    return {
      season,
      previousSeason,
      available: false,
      unavailableReason: 'Roster continuity unavailable',
      returningCount: 0,
      addedCount: 0,
      departedCount: 0,
      returning: [],
      added: [],
      departed: [],
    };
  }

  const prevById = new Map(previous.map((p) => [p.playerEntityId, p]));
  const currById = new Map(current.map((p) => [p.playerEntityId, p]));

  const returning: ContinuityPlayer[] = [];
  const added: ContinuityPlayer[] = [];
  const departed: ContinuityPlayer[] = [];

  for (const [id, player] of currById) {
    if (prevById.has(id)) returning.push(player);
    else added.push(player);
  }
  for (const [id, player] of prevById) {
    if (!currById.has(id)) departed.push(player);
  }

  returning.sort(sortByName);
  added.sort(sortByName);
  departed.sort(sortByName);

  return {
    season,
    previousSeason,
    available: true,
    unavailableReason: null,
    returningCount: returning.length,
    addedCount: added.length,
    departedCount: departed.length,
    returning,
    added,
    departed,
  };
}

export function previewContinuityList(
  players: ContinuityPlayer[],
  limit: number = CONTINUITY_LIST_PREVIEW
): { shown: ContinuityPlayer[]; more: number } {
  if (players.length <= limit) return { shown: players, more: 0 };
  return { shown: players.slice(0, limit), more: players.length - limit };
}
