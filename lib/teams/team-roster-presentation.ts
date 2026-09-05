/**
 * Pure helpers + SQL for canonical TeamRoster (no DB import).
 */

export type CanonicalRosterPlayer = {
  playerEntityId: string;
  playerId: string | null;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  jersey: string | null;
  membershipType: string | null;
  observedFrom: string;
  source: string;
};

/** SQL used by getTeamCanonicalRoster — exported for tests. */
export const TEAM_ROSTER_CURRENT_SQL = `
  SELECT
    player_entity_id::text,
    player_id,
    display_name,
    first_name,
    last_name,
    position,
    jersey,
    membership_type,
    observed_from::text,
    source
  FROM analytics.team_roster_current
  WHERE team_id = $1
    AND season = $2
`;

export function assertAnalyticsSeason(season: string): void {
  if (!season || !/^\d{4}$/.test(season)) {
    throw new Error(
      `getTeamCanonicalRoster requires analytics season start-year (YYYY), got: ${season}`
    );
  }
}

/** Jersey ascending (numeric when possible), then display name. */
export function sortCanonicalRoster(
  players: CanonicalRosterPlayer[]
): CanonicalRosterPlayer[] {
  return [...players].sort((a, b) => {
    const aj = jerseySortKey(a.jersey);
    const bj = jerseySortKey(b.jersey);
    if (aj !== bj) return aj - bj;
    return a.displayName.localeCompare(b.displayName, 'en');
  });
}

function jerseySortKey(jersey: string | null): number {
  if (jersey == null || jersey === '') return Number.POSITIVE_INFINITY;
  const n = Number.parseInt(jersey, 10);
  if (Number.isFinite(n)) return n;
  return Number.POSITIVE_INFINITY;
}

/**
 * Existing player pages are BDL-id based. NBA-only (null player_id) → no link.
 */
export function rosterPlayerHref(player: {
  playerId: string | null;
}): string | null {
  if (!player.playerId) return null;
  return `/betting/players/${player.playerId}`;
}

export function hasAnalyticsPlayerLink(player: {
  playerId: string | null;
}): boolean {
  return rosterPlayerHref(player) != null;
}

export type PositionGroupName = 'Guards' | 'Forwards' | 'Centers' | 'Other';

export function groupRosterByPosition(
  players: CanonicalRosterPlayer[]
): Array<{ name: PositionGroupName; players: CanonicalRosterPlayer[] }> {
  const guards = players.filter(
    (p) => p.position && ['G', 'PG', 'SG'].includes(p.position)
  );
  const forwards = players.filter(
    (p) => p.position && ['F', 'PF', 'SF'].includes(p.position)
  );
  const centers = players.filter(
    (p) => p.position && ['C'].includes(p.position)
  );
  const others = players.filter(
    (p) =>
      !p.position ||
      !['G', 'PG', 'SG', 'F', 'PF', 'SF', 'C'].includes(p.position)
  );

  return (
    [
      { name: 'Guards' as const, players: guards },
      { name: 'Forwards' as const, players: forwards },
      { name: 'Centers' as const, players: centers },
      { name: 'Other' as const, players: others },
    ] as const
  ).filter((g) => g.players.length > 0);
}

/** Pure assertion helper for season-leak regression tests. */
export function assertRosterSeasonScoped(
  players: Array<{ season?: string }>,
  expectedSeason: string
): void {
  for (const p of players) {
    if (p.season != null && p.season !== expectedSeason) {
      throw new Error(
        `Season leak: expected ${expectedSeason}, got ${p.season}`
      );
    }
  }
}
