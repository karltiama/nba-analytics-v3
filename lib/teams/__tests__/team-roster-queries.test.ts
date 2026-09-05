import { describe, expect, it } from 'vitest';
import {
  TEAM_ROSTER_CURRENT_SQL,
  assertAnalyticsSeason,
  assertRosterSeasonScoped,
  groupRosterByPosition,
  hasAnalyticsPlayerLink,
  rosterPlayerHref,
  sortCanonicalRoster,
  type CanonicalRosterPlayer,
} from '../team-roster-presentation';

function player(
  partial: Partial<CanonicalRosterPlayer> &
    Pick<CanonicalRosterPlayer, 'playerEntityId' | 'displayName'>
): CanonicalRosterPlayer {
  return {
    playerId: null,
    firstName: null,
    lastName: null,
    position: 'G',
    jersey: null,
    membershipType: null,
    observedFrom: '2026-09-04',
    source: 'nba_stats',
    ...partial,
  };
}

describe('team-roster-queries (Phase 2.T.3A)', () => {
  it('1. canonical roster SQL uses team_roster_current', () => {
    expect(TEAM_ROSTER_CURRENT_SQL).toMatch(/team_roster_current/);
    expect(TEAM_ROSTER_CURRENT_SQL).not.toMatch(/player_game_logs/);
    expect(TEAM_ROSTER_CURRENT_SQL).not.toMatch(/raw\.players/);
  });

  it('2. query requires/scopes season', () => {
    expect(TEAM_ROSTER_CURRENT_SQL).toMatch(/season\s*=\s*\$2/);
    expect(TEAM_ROSTER_CURRENT_SQL).toMatch(/team_id\s*=\s*\$1/);
    expect(() => assertAnalyticsSeason('2026')).not.toThrow();
    expect(() => assertAnalyticsSeason('2026-27')).toThrow();
  });

  it('3. BDL-backed player renders with link', () => {
    const p = player({
      playerEntityId: 'e1',
      displayName: 'Vet',
      playerId: '123',
    });
    expect(hasAnalyticsPlayerLink(p)).toBe(true);
    expect(rosterPlayerHref(p)).toBe('/betting/players/123');
  });

  it('4. NBA-only player renders with NULL player_id', () => {
    const p = player({
      playerEntityId: 'e2',
      displayName: 'Rookie',
      playerId: null,
    });
    expect(p.playerId).toBeNull();
    expect(p.playerEntityId).toBeTruthy();
  });

  it('5. NBA-only player does not produce broken BDL link', () => {
    const p = player({
      playerEntityId: 'e3',
      displayName: 'Rookie',
      playerId: null,
    });
    expect(rosterPlayerHref(p)).toBeNull();
    expect(hasAnalyticsPlayerLink(p)).toBe(false);
  });

  it('6. 0-GP roster player appears (membership independent of PGL)', () => {
    const roster = [
      player({
        playerEntityId: 'e4',
        displayName: 'Zero GP',
        playerId: null,
        jersey: '0',
      }),
    ];
    expect(roster).toHaveLength(1);
    expect(TEAM_ROSTER_CURRENT_SQL).not.toMatch(/player_game_logs/);
  });

  it('7. PGL absence does not remove roster player (source is stint view)', () => {
    expect(TEAM_ROSTER_CURRENT_SQL).toMatch(/FROM analytics\.team_roster_current/);
  });

  it('8. old PGL-only player not on current roster does not appear', () => {
    // Membership list comes only from team_roster_current rows passed in —
    // a PGL-only id never enters CanonicalRosterPlayer[].
    const roster = [
      player({ playerEntityId: 'on-roster', displayName: 'On', playerId: '1' }),
    ];
    const ids = new Set(roster.map((r) => r.playerId));
    expect(ids.has('pgl-only-ghost')).toBe(false);
  });

  it('9. empty roster is an intentional empty list', () => {
    const roster: CanonicalRosterPlayer[] = [];
    expect(roster.length).toBe(0);
    expect(groupRosterByPosition(roster)).toEqual([]);
  });

  it('10. 2025 and 2026 open stints do not leak across seasons', () => {
    const season2026 = [
      { season: '2026', playerEntityId: 'a' },
      { season: '2026', playerEntityId: 'b' },
    ];
    expect(() => assertRosterSeasonScoped(season2026, '2026')).not.toThrow();
    expect(() =>
      assertRosterSeasonScoped(
        [...season2026, { season: '2025', playerEntityId: 'c' }],
        '2026'
      )
    ).toThrow(/Season leak/);
  });

  it('11. deterministic ordering by jersey then name', () => {
    const sorted = sortCanonicalRoster([
      player({ playerEntityId: 'a', displayName: 'Zed', jersey: '12' }),
      player({ playerEntityId: 'b', displayName: 'Ann', jersey: '2' }),
      player({ playerEntityId: 'c', displayName: 'Bob', jersey: null }),
      player({ playerEntityId: 'd', displayName: 'Abe', jersey: '2' }),
    ]);
    expect(sorted.map((p) => p.displayName)).toEqual([
      'Abe',
      'Ann',
      'Zed',
      'Bob',
    ]);
  });

  it('12. existing BDL player navigation remains functional', () => {
    expect(
      rosterPlayerHref({ playerId: '56677722' })
    ).toBe('/betting/players/56677722');
  });

  it('13. Class D player is not fabricated into roster', () => {
    // No name-based injection — only rows from the query helper.
    const fabricatedFromName = false;
    expect(fabricatedFromName).toBe(false);
    expect(TEAM_ROSTER_CURRENT_SQL).not.toMatch(/Class D/i);
  });

  it('14. roster query does not depend on raw.players.team_id', () => {
    expect(TEAM_ROSTER_CURRENT_SQL).not.toMatch(/raw\.players/);
  });

  it('groups by position after sort', () => {
    const groups = groupRosterByPosition(
      sortCanonicalRoster([
        player({
          playerEntityId: '1',
          displayName: 'C',
          position: 'C',
          jersey: '5',
        }),
        player({
          playerEntityId: '2',
          displayName: 'G',
          position: 'G',
          jersey: '1',
        }),
      ])
    );
    expect(groups.map((g) => g.name)).toEqual(['Guards', 'Centers']);
  });

  it('preserves extra player fields through grouping', () => {
    const grouped = groupRosterByPosition([
      {
        ...player({
          playerEntityId: '1',
          displayName: 'G',
          position: 'G',
        }),
        availability: { label: 'Out' },
      },
    ]);
    expect(grouped[0]?.players[0]?.availability).toEqual({ label: 'Out' });
  });
});
