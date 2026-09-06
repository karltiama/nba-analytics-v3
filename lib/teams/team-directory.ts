/**
 * Current NBA Teams directory helpers (Phase 2.T.4B).
 * Source: analytics.teams filtered to conference East/West (30 franchises).
 * Historical rows with blank conference are excluded — no hard-coded identity map.
 */

import type { TeamInfo } from '@/lib/teams/types';

export const EXPECTED_CURRENT_NBA_TEAM_COUNT = 30;

export const CURRENT_NBA_TEAMS_SQL = `
  SELECT
    team_id,
    abbreviation,
    full_name,
    name,
    city,
    conference,
    division
  FROM analytics.teams
  WHERE conference IN ('East', 'West')
  ORDER BY
    CASE conference WHEN 'East' THEN 0 WHEN 'West' THEN 1 ELSE 2 END,
    CASE division
      WHEN 'Atlantic' THEN 0
      WHEN 'Central' THEN 1
      WHEN 'Southeast' THEN 2
      WHEN 'Northwest' THEN 3
      WHEN 'Pacific' THEN 4
      WHEN 'Southwest' THEN 5
      ELSE 6
    END,
    full_name ASC
`;

export const EAST_DIVISION_ORDER = ['Atlantic', 'Central', 'Southeast'] as const;
export const WEST_DIVISION_ORDER = ['Northwest', 'Pacific', 'Southwest'] as const;

export type ConferenceDivisionGroup = {
  conference: 'East' | 'West';
  conferenceLabel: string;
  divisions: {
    division: string;
    teams: TeamInfo[];
  }[];
};

export function mapTeamRow(r: Record<string, unknown>): TeamInfo {
  return {
    team_id: String(r.team_id),
    abbreviation: String(r.abbreviation),
    full_name: String(r.full_name),
    name: String(r.name),
    city: r.city != null ? String(r.city) : null,
    conference: r.conference != null ? String(r.conference) : null,
    division: r.division != null ? String(r.division) : null,
  };
}

/** Group flat East/West teams into conference → division lists. */
export function groupTeamsByConferenceDivision(
  teams: TeamInfo[]
): ConferenceDivisionGroup[] {
  const byConfDiv = new Map<string, TeamInfo[]>();
  for (const t of teams) {
    const conf = t.conference?.trim();
    const div = t.division?.trim();
    if (conf !== 'East' && conf !== 'West') continue;
    if (!div) continue;
    const key = `${conf}::${div}`;
    const list = byConfDiv.get(key) ?? [];
    list.push(t);
    byConfDiv.set(key, list);
  }

  function build(
    conference: 'East' | 'West',
    order: readonly string[]
  ): ConferenceDivisionGroup {
    const divisions = order.map((division) => ({
      division,
      teams: byConfDiv.get(`${conference}::${division}`) ?? [],
    }));
    return {
      conference,
      conferenceLabel:
        conference === 'East' ? 'Eastern Conference' : 'Western Conference',
      divisions,
    };
  }

  return [
    build('East', EAST_DIVISION_ORDER),
    build('West', WEST_DIVISION_ORDER),
  ];
}

export function countTeamsInGroups(groups: ConferenceDivisionGroup[]): number {
  return groups.reduce(
    (n, g) => n + g.divisions.reduce((m, d) => m + d.teams.length, 0),
    0
  );
}

export function assertCurrentNbaTeamSet(teams: TeamInfo[]): {
  ok: boolean;
  count: number;
  east: number;
  west: number;
  warning: string | null;
} {
  const east = teams.filter((t) => t.conference === 'East').length;
  const west = teams.filter((t) => t.conference === 'West').length;
  const count = teams.length;
  const ok =
    count === EXPECTED_CURRENT_NBA_TEAM_COUNT && east === 15 && west === 15;
  return {
    ok,
    count,
    east,
    west,
    warning: ok
      ? null
      : `Expected ${EXPECTED_CURRENT_NBA_TEAM_COUNT} current NBA teams (15 East / 15 West); got ${count} (${east} East / ${west} West).`,
  };
}
