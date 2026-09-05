import { describe, expect, it } from 'vitest';
import {
  PINNED_ANALYTICS_SEASON,
  getLiveAvailabilitySeason,
  shouldShowCurrentAvailability,
} from '@/lib/season';
import { TEAM_INJURIES_BY_PLAYER_IDS_SQL } from '../team-injury-sql';
import {
  formatInjuryDetail,
  formatAvailabilityLabel,
  mergeRosterAvailability,
  normalizeAvailabilityStatus,
  type RosterPlayerWithAvailability,
} from '../roster-availability';
import {
  rosterPlayerHref,
  type CanonicalRosterPlayer,
} from '../team-roster-presentation';

function player(
  partial: Partial<CanonicalRosterPlayer> &
    Pick<CanonicalRosterPlayer, 'playerEntityId' | 'displayName'>
): CanonicalRosterPlayer {
  return {
    playerId: '111',
    firstName: null,
    lastName: null,
    position: 'G',
    jersey: '7',
    membershipType: null,
    observedFrom: '2026-09-04',
    source: 'nba_stats',
    ...partial,
  };
}

describe('roster availability (Phase 2.T.3B)', () => {
  it('1. injured roster player stays visible', () => {
    const roster = [player({ playerEntityId: 'e1', displayName: 'Vet' })];
    const merged = mergeRosterAvailability({
      roster,
      injuries: [
        {
          playerId: '111',
          teamId: 't1',
          status: 'Out',
          description: 'Ankle',
          returnDateRaw: null,
          snapshotAt: '2026-05-06',
          updatedAt: '2026-05-06',
        },
      ],
      rosterTeamId: 't1',
      viewedSeason: '2026',
      liveAvailabilitySeason: '2026',
    });
    expect(merged.players).toHaveLength(1);
    expect(merged.players[0]!.availability?.status).toBe('Out');
  });

  it('2. Out status renders', () => {
    expect(normalizeAvailabilityStatus('Out')).toBe('Out');
    expect(formatAvailabilityLabel('Out', 'Ankle')).toBe('Out — Ankle');
  });

  it('3. Questionable status renders', () => {
    expect(normalizeAvailabilityStatus('Questionable')).toBe('Questionable');
  });

  it('4. injury detail renders when present and concise', () => {
    expect(formatInjuryDetail('Ankle')).toBe('Ankle');
    expect(formatInjuryDetail('Knee')).toBe('Knee');
  });

  it('5. no injury row does not create fake Healthy state', () => {
    const merged = mergeRosterAvailability({
      roster: [player({ playerEntityId: 'e2', displayName: 'Active Vet' })],
      injuries: [],
      rosterTeamId: 't1',
      viewedSeason: '2026',
      liveAvailabilitySeason: '2026',
    });
    expect(merged.players[0]!.availability).toBeNull();
    const statuses = merged.players.map((p) => p.availability?.status ?? null);
    expect(statuses).toEqual([null]);
    expect(statuses).not.toContain('Healthy');
  });

  it('6. BDL-backed injury identity merges correctly', () => {
    const merged = mergeRosterAvailability({
      roster: [
        player({
          playerEntityId: 'e3',
          displayName: 'BDL',
          playerId: '999',
        }),
      ],
      injuries: [
        {
          playerId: '999',
          teamId: 't1',
          status: 'Doubtful',
          description: 'Hamstring',
          returnDateRaw: null,
          snapshotAt: 'x',
          updatedAt: 'y',
        },
      ],
      rosterTeamId: 't1',
      viewedSeason: '2026',
      liveAvailabilitySeason: '2026',
    });
    expect(merged.players[0]!.availability?.label).toBe('Doubtful — Hamstring');
  });

  it('7. NBA-only player remains visible without injury match', () => {
    const merged = mergeRosterAvailability({
      roster: [
        player({
          playerEntityId: 'e4',
          displayName: 'Rookie',
          playerId: null,
        }),
      ],
      injuries: [
        {
          playerId: 'someone-else',
          teamId: 't1',
          status: 'Out',
          description: null,
          returnDateRaw: null,
          snapshotAt: 'x',
          updatedAt: 'y',
        },
      ],
      rosterTeamId: 't1',
      viewedSeason: '2026',
      liveAvailabilitySeason: '2026',
    });
    expect(merged.players).toHaveLength(1);
    expect(merged.players[0]!.availability).toBeNull();
    expect(rosterPlayerHref(merged.players[0]!)).toBeNull();
  });

  it('8. injury merge does not reduce roster count', () => {
    const roster = [
      player({ playerEntityId: 'a', displayName: 'A', playerId: '1' }),
      player({ playerEntityId: 'b', displayName: 'B', playerId: null }),
      player({ playerEntityId: 'c', displayName: 'C', playerId: '3' }),
    ];
    const merged = mergeRosterAvailability({
      roster,
      injuries: [],
      rosterTeamId: 't1',
      viewedSeason: '2026',
      liveAvailabilitySeason: '2026',
    });
    expect(merged.players.length).toBe(roster.length);
  });

  it('9. team-mismatched injury fails closed', () => {
    const merged = mergeRosterAvailability({
      roster: [
        player({
          playerEntityId: 'e5',
          displayName: 'Traded',
          playerId: '55',
        }),
      ],
      injuries: [
        {
          playerId: '55',
          teamId: 'other-team',
          status: 'Out',
          description: 'Ankle',
          returnDateRaw: null,
          snapshotAt: 'x',
          updatedAt: 'y',
        },
      ],
      rosterTeamId: 't1',
      viewedSeason: '2026',
      liveAvailabilitySeason: '2026',
    });
    expect(merged.players[0]!.availability).toBeNull();
    expect(merged.teamMismatches).toEqual([
      { playerId: '55', injuryTeamId: 'other-team' },
    ]);
  });

  it('10. historical selected season hides current injury status', () => {
    const merged = mergeRosterAvailability({
      roster: [player({ playerEntityId: 'e6', displayName: 'Vet' })],
      injuries: [
        {
          playerId: '111',
          teamId: 't1',
          status: 'Out',
          description: 'Ankle',
          returnDateRaw: null,
          snapshotAt: 'x',
          updatedAt: 'y',
        },
      ],
      rosterTeamId: 't1',
      viewedSeason: '2025',
      liveAvailabilitySeason: '2026',
    });
    expect(merged.showAvailability).toBe(false);
    expect(merged.players[0]!.availability).toBeNull();
    expect(merged.queryCount).toBe(0);
  });

  it('11. current selected season permits current injury status', () => {
    expect(shouldShowCurrentAvailability('2026', '2026')).toBe(true);
    const merged = mergeRosterAvailability({
      roster: [player({ playerEntityId: 'e7', displayName: 'Vet' })],
      injuries: [
        {
          playerId: '111',
          teamId: 't1',
          status: 'Questionable',
          description: null,
          returnDateRaw: null,
          snapshotAt: 'x',
          updatedAt: 'y',
        },
      ],
      rosterTeamId: 't1',
      viewedSeason: '2026',
      liveAvailabilitySeason: '2026',
    });
    expect(merged.players[0]!.availability?.status).toBe('Questionable');
  });

  it('12. Production pin is not treated as live injury season', () => {
    expect(PINNED_ANALYTICS_SEASON).toBe('2025');
    const live = getLiveAvailabilitySeason(
      {} as NodeJS.ProcessEnv,
      new Date('2026-09-05T12:00:00.000Z')
    );
    expect(live).toBe('2026');
    expect(shouldShowCurrentAvailability('2025', live)).toBe(false);
    expect(shouldShowCurrentAvailability('2026', live)).toBe(true);
  });

  it('13. roster season isolation remains intact (historical hide)', () => {
    expect(shouldShowCurrentAvailability('2025', '2026')).toBe(false);
  });

  it('14. player links remain unchanged', () => {
    const withBdl: RosterPlayerWithAvailability = {
      ...player({
        playerEntityId: 'e8',
        displayName: 'Link',
        playerId: '56677722',
      }),
      availability: {
        status: 'Out',
        detail: null,
        label: 'Out',
        priority: 'high',
        returnDateRaw: null,
        updatedAt: null,
      },
    };
    expect(rosterPlayerHref(withBdl)).toBe('/betting/players/56677722');
    expect(
      rosterPlayerHref({
        ...player({ playerEntityId: 'e9', displayName: 'R', playerId: null }),
        availability: null,
      })
    ).toBeNull();
  });

  it('15. no N+1 injury query pattern (single ANY query)', () => {
    expect(TEAM_INJURIES_BY_PLAYER_IDS_SQL).toMatch(/ANY\(\$1::text\[\]\)/);
    expect(TEAM_INJURIES_BY_PLAYER_IDS_SQL).not.toMatch(/FOR\s+\(/i);
  });

  it('16. roster/stint tables are not mutated (pure merge)', () => {
    const roster = [player({ playerEntityId: 'e10', displayName: 'X' })];
    const before = JSON.stringify(roster);
    mergeRosterAvailability({
      roster,
      injuries: [],
      rosterTeamId: 't1',
      viewedSeason: '2026',
      liveAvailabilitySeason: '2026',
    });
    expect(JSON.stringify(roster)).toBe(before);
  });

  it('drops long narrative injury descriptions', () => {
    expect(
      formatInjuryDetail(
        'Cryer suffered the ankle injury late in Thursday\'s loss to the Lakers.'
      )
    ).toBeNull();
  });

  it('LIVE_AVAILABILITY_SEASON env override works', () => {
    expect(
      getLiveAvailabilitySeason(
        { LIVE_AVAILABILITY_SEASON: '2025' } as NodeJS.ProcessEnv,
        new Date('2026-09-05T12:00:00.000Z')
      )
    ).toBe('2025');
  });
});
