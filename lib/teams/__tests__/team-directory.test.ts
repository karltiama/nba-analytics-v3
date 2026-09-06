import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

import { query } from '@/lib/db';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';
import { shouldShowLayoutHeader } from '@/components/betting/betting-shell-paths';
import { teamPageSeasonHref } from '@/lib/teams/team-page-season';
import { listCurrentNbaTeams } from '@/lib/teams/team-directory-queries';
import {
  CURRENT_NBA_TEAMS_SQL,
  EAST_DIVISION_ORDER,
  EXPECTED_CURRENT_NBA_TEAM_COUNT,
  WEST_DIVISION_ORDER,
  assertCurrentNbaTeamSet,
  groupTeamsByConferenceDivision,
  mapTeamRow,
} from '@/lib/teams/team-directory';
import type { TeamInfo } from '@/lib/teams/types';

const mockQuery = query as ReturnType<typeof vi.fn>;

const ROOT = join(__dirname, '../../..');

function team(partial: Partial<TeamInfo> & Pick<TeamInfo, 'team_id' | 'abbreviation' | 'full_name' | 'conference' | 'division'>): TeamInfo {
  return {
    name: partial.full_name.split(' ').slice(-1)[0] ?? partial.full_name,
    city: partial.city ?? null,
    ...partial,
  };
}

/** Canonical 30 current franchises (identity from DB shape, not a product mapping layer). */
const CURRENT_30: TeamInfo[] = [
  team({ team_id: '1', abbreviation: 'ATL', full_name: 'Atlanta Hawks', conference: 'East', division: 'Southeast' }),
  team({ team_id: '2', abbreviation: 'BOS', full_name: 'Boston Celtics', conference: 'East', division: 'Atlantic' }),
  team({ team_id: '3', abbreviation: 'BKN', full_name: 'Brooklyn Nets', conference: 'East', division: 'Atlantic' }),
  team({ team_id: '4', abbreviation: 'CHA', full_name: 'Charlotte Hornets', conference: 'East', division: 'Southeast' }),
  team({ team_id: '5', abbreviation: 'CHI', full_name: 'Chicago Bulls', conference: 'East', division: 'Central' }),
  team({ team_id: '6', abbreviation: 'CLE', full_name: 'Cleveland Cavaliers', conference: 'East', division: 'Central' }),
  team({ team_id: '7', abbreviation: 'DET', full_name: 'Detroit Pistons', conference: 'East', division: 'Central' }),
  team({ team_id: '8', abbreviation: 'IND', full_name: 'Indiana Pacers', conference: 'East', division: 'Central' }),
  team({ team_id: '9', abbreviation: 'MIA', full_name: 'Miami Heat', conference: 'East', division: 'Southeast' }),
  team({ team_id: '10', abbreviation: 'MIL', full_name: 'Milwaukee Bucks', conference: 'East', division: 'Central' }),
  team({ team_id: '11', abbreviation: 'NYK', full_name: 'New York Knicks', conference: 'East', division: 'Atlantic' }),
  team({ team_id: '12', abbreviation: 'ORL', full_name: 'Orlando Magic', conference: 'East', division: 'Southeast' }),
  team({ team_id: '13', abbreviation: 'PHI', full_name: 'Philadelphia 76ers', conference: 'East', division: 'Atlantic' }),
  team({ team_id: '14', abbreviation: 'TOR', full_name: 'Toronto Raptors', conference: 'East', division: 'Atlantic' }),
  team({ team_id: '15', abbreviation: 'WAS', full_name: 'Washington Wizards', conference: 'East', division: 'Southeast' }),
  team({ team_id: '16', abbreviation: 'DAL', full_name: 'Dallas Mavericks', conference: 'West', division: 'Southwest' }),
  team({ team_id: '17', abbreviation: 'DEN', full_name: 'Denver Nuggets', conference: 'West', division: 'Northwest' }),
  team({ team_id: '18', abbreviation: 'GSW', full_name: 'Golden State Warriors', conference: 'West', division: 'Pacific' }),
  team({ team_id: '19', abbreviation: 'HOU', full_name: 'Houston Rockets', conference: 'West', division: 'Southwest' }),
  team({ team_id: '20', abbreviation: 'LAC', full_name: 'LA Clippers', conference: 'West', division: 'Pacific' }),
  team({ team_id: '21', abbreviation: 'LAL', full_name: 'Los Angeles Lakers', conference: 'West', division: 'Pacific' }),
  team({ team_id: '22', abbreviation: 'MEM', full_name: 'Memphis Grizzlies', conference: 'West', division: 'Southwest' }),
  team({ team_id: '23', abbreviation: 'MIN', full_name: 'Minnesota Timberwolves', conference: 'West', division: 'Northwest' }),
  team({ team_id: '24', abbreviation: 'NOP', full_name: 'New Orleans Pelicans', conference: 'West', division: 'Southwest' }),
  team({ team_id: '25', abbreviation: 'OKC', full_name: 'Oklahoma City Thunder', conference: 'West', division: 'Northwest' }),
  team({ team_id: '26', abbreviation: 'PHX', full_name: 'Phoenix Suns', conference: 'West', division: 'Pacific' }),
  team({ team_id: '27', abbreviation: 'POR', full_name: 'Portland Trail Blazers', conference: 'West', division: 'Northwest' }),
  team({ team_id: '28', abbreviation: 'SAC', full_name: 'Sacramento Kings', conference: 'West', division: 'Pacific' }),
  team({ team_id: '29', abbreviation: 'SAS', full_name: 'San Antonio Spurs', conference: 'West', division: 'Southwest' }),
  team({ team_id: '30', abbreviation: 'UTA', full_name: 'Utah Jazz', conference: 'West', division: 'Northwest' }),
];

describe('team directory (Phase 2.T.4B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. exactly 30 current teams under fixture / integrity helper', () => {
    const integrity = assertCurrentNbaTeamSet(CURRENT_30);
    expect(integrity.ok).toBe(true);
    expect(integrity.count).toBe(EXPECTED_CURRENT_NBA_TEAM_COUNT);
    expect(integrity.warning).toBeNull();
  });

  it('2. historical teams excluded by SQL filter (blank conference)', () => {
    expect(CURRENT_NBA_TEAMS_SQL).toMatch(/conference IN \('East', 'West'\)/);
    expect(CURRENT_NBA_TEAMS_SQL).not.toMatch(/Seattle|Vancouver|New Jersey/i);

    const withHistorical = [
      ...CURRENT_30,
      team({
        team_id: '99',
        abbreviation: 'SEA',
        full_name: 'Seattle SuperSonics',
        conference: null,
        division: null,
      }),
    ];
    // App grouping also drops non-East/West
    const groups = groupTeamsByConferenceDivision(withHistorical);
    const ids = groups.flatMap((c) => c.divisions.flatMap((d) => d.teams.map((t) => t.team_id)));
    expect(ids).not.toContain('99');
    expect(ids).toHaveLength(30);
  });

  it('3. 15 East / 15 West', () => {
    const integrity = assertCurrentNbaTeamSet(CURRENT_30);
    expect(integrity.east).toBe(15);
    expect(integrity.west).toBe(15);
  });

  it('4. six expected divisions represented', () => {
    const groups = groupTeamsByConferenceDivision(CURRENT_30);
    const divisions = groups.flatMap((c) => c.divisions.map((d) => d.division));
    expect(divisions).toEqual([
      ...EAST_DIVISION_ORDER,
      ...WEST_DIVISION_ORDER,
    ]);
    for (const d of groups.flatMap((c) => c.divisions)) {
      expect(d.teams).toHaveLength(5);
    }
  });

  it('5. every current team appears exactly once', () => {
    const groups = groupTeamsByConferenceDivision(CURRENT_30);
    const ids = groups.flatMap((c) =>
      c.divisions.flatMap((d) => d.teams.map((t) => t.team_id))
    );
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
  });

  it('6. team entries link to canonical /teams/{teamId} route', () => {
    expect(
      teamPageSeasonHref({
        teamId: '2',
        season: '2025',
        defaultSeason: '2025',
      })
    ).toBe('/teams/2');
  });

  it('7. ?season=2026 preserved when present', () => {
    expect(
      teamPageSeasonHref({
        teamId: '21',
        season: '2026',
        defaultSeason: '2025',
      })
    ).toBe('/teams/21?season=2026');
  });

  it('8. absence of season query does not invent one when season equals default', () => {
    expect(
      teamPageSeasonHref({
        teamId: '21',
        season: '2025',
        defaultSeason: '2025',
      })
    ).toBe('/teams/21');
    expect(
      teamPageSeasonHref({
        teamId: '21',
        season: '2025',
        defaultSeason: '2025',
      })
    ).not.toMatch(/\?season=/);
  });

  it('9. Teams exists in desktop primary navigation', () => {
    const teams = PRIMARY_NAV.find((n) => n.label === 'Teams');
    expect(teams).toEqual({ href: '/teams', label: 'Teams' });
    const labels = PRIMARY_NAV.map((n) => n.label);
    expect(labels.indexOf('Dashboard')).toBeLessThan(labels.indexOf('Teams'));
    expect(labels.indexOf('Teams')).toBeLessThan(labels.indexOf('Props Explorer'));

    const headerSrc = readFileSync(
      join(ROOT, 'components/betting/Header.tsx'),
      'utf8'
    );
    expect(headerSrc).toMatch(/hidden md:flex/);
    expect(headerSrc).toMatch(/PRIMARY_NAV\.map/);
    expect(headerSrc).toMatch(/aria-label="Primary"/);
  });

  it('9b. /teams keeps betting shell Header (layout outside /betting)', () => {
    expect(shouldShowLayoutHeader('/teams')).toBe(true);
    expect(shouldShowLayoutHeader('/teams/2')).toBe(true);
    expect(shouldShowLayoutHeader('/betting')).toBe(true);
    expect(shouldShowLayoutHeader('/betting/players/x')).toBe(false);

    const teamsLayout = readFileSync(join(ROOT, 'app/teams/layout.tsx'), 'utf8');
    expect(teamsLayout).toMatch(/BettingAppShell/);
  });

  it('10. Teams accessible through mobile navigation', () => {
    const headerSrc = readFileSync(
      join(ROOT, 'components/betting/Header.tsx'),
      'utf8'
    );
    expect(headerSrc).toMatch(/md:hidden/);
    expect(headerSrc).toMatch(/Open primary navigation/);
    expect(headerSrc).toMatch(/PRIMARY_NAV\.map/);
    expect(PRIMARY_NAV.some((n) => n.href === '/teams')).toBe(true);
  });

  it('11–13. directory before rankings; rankings preserved; primary browse is not rankings table', () => {
    const pageSrc = readFileSync(join(ROOT, 'app/teams/page.tsx'), 'utf8');
    const dirIdx = pageSrc.indexOf('Team directory by conference');
    const rankIdx = pageSrc.indexOf('Team Defensive Rankings');
    expect(dirIdx).toBeGreaterThan(-1);
    expect(rankIdx).toBeGreaterThan(-1);
    expect(dirIdx).toBeLessThan(rankIdx);
    expect(pageSrc).toMatch(/listCurrentNbaTeams/);
    expect(pageSrc).toMatch(/getAllTeamsDefensiveRankings/);
    // Primary directory uses links in a grid/list, not the rankings Table as browse UX
    const sectionDir = pageSrc.indexOf('aria-labelledby="teams-directory-heading"');
    const sectionRank = pageSrc.indexOf('aria-labelledby="defensive-rankings-heading"');
    expect(sectionDir).toBeLessThan(sectionRank);
    const dirSlice = pageSrc.slice(sectionDir, sectionRank);
    expect(dirSlice).toMatch(/TeamDirectoryItem/);
    expect(dirSlice).not.toMatch(/<Table>/);
  });

  it('14. no new team identity mapping in directory module (DB-driven SQL only)', () => {
    const mod = readFileSync(join(ROOT, 'lib/teams/team-directory.ts'), 'utf8');
    expect(mod).toMatch(/FROM analytics\.teams/);
    expect(mod).toMatch(/WHERE conference IN \('East', 'West'\)/);
    // No hard-coded franchise name table
    expect(mod).not.toMatch(/Boston Celtics/);
    expect(mod).not.toMatch(/team_id:\s*['"]2['"]/);
  });

  it('15. single set-based query — no N+1', async () => {
    mockQuery.mockResolvedValue(
      CURRENT_30.map((t) => ({
        team_id: t.team_id,
        abbreviation: t.abbreviation,
        full_name: t.full_name,
        name: t.name,
        city: t.city,
        conference: t.conference,
        division: t.division,
      }))
    );
    const result = await listCurrentNbaTeams();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]![0]).toBe(CURRENT_NBA_TEAMS_SQL);
    expect(mockQuery.mock.calls[0]![1]).toEqual([]);
    expect(result.teams).toHaveLength(30);
    expect(result.integrity.ok).toBe(true);
    expect(result.groups).toHaveLength(2);
  });

  it('mapTeamRow + incomplete set warns (does not hard-fail)', () => {
    const row = mapTeamRow({
      team_id: 2,
      abbreviation: 'BOS',
      full_name: 'Boston Celtics',
      name: 'Celtics',
      city: 'Boston',
      conference: 'East',
      division: 'Atlantic',
    });
    expect(row.team_id).toBe('2');
    const integrity = assertCurrentNbaTeamSet([row]);
    expect(integrity.ok).toBe(false);
    expect(integrity.warning).toMatch(/Expected 30/);
  });

  it('conference labels are Eastern / Western Conference', () => {
    const groups = groupTeamsByConferenceDivision(CURRENT_30);
    expect(groups[0]!.conferenceLabel).toBe('Eastern Conference');
    expect(groups[1]!.conferenceLabel).toBe('Western Conference');
  });
});
