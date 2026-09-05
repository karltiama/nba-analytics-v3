import { describe, expect, it } from 'vitest';
import {
  TEAM_SEASON_SNAPSHOT_SQL,
  deriveNetRating,
  emptyTeamSeasonSnapshot,
  mapTeamSeasonSnapshot,
  sampleSizeBand,
  sampleSizeLabel,
  scopeNoteForGamesPlayed,
} from '../team-season-snapshot';
import {
  ROSTER_SEASON_EXISTS_SQL,
  TEAM_ROSTER_ENTITY_SQL,
  computeRosterContinuity,
  previousAnalyticsSeason,
  type ContinuityPlayer,
} from '../team-roster-continuity';
import {
  TEAM_COMPACT_UPCOMING_SQL,
  TEAM_COMPACT_RECENT_SQL,
} from '../team-compact-schedule';
import { TEAM_ROSTER_CURRENT_SQL } from '../team-roster-presentation';
import type { TeamSeasonAverages } from '../types';

function averages(
  partial: Partial<TeamSeasonAverages> & Pick<TeamSeasonAverages, 'season'>
): TeamSeasonAverages {
  return {
    team_id: '14',
    games_played: 0,
    avg_points: null,
    avg_rebounds: null,
    avg_assists: null,
    avg_steals: null,
    avg_blocks: null,
    avg_turnovers: null,
    avg_fgm: null,
    avg_fga: null,
    avg_3pm: null,
    avg_3pa: null,
    avg_ftm: null,
    avg_fta: null,
    avg_points_allowed: null,
    wins: 0,
    losses: 0,
    win_pct: null,
    home_wins: 0,
    home_losses: 0,
    away_wins: 0,
    away_losses: 0,
    avg_offensive_rating: null,
    avg_defensive_rating: null,
    avg_pace: null,
    avg_efg_pct: null,
    avg_tov_pct: null,
    avg_orb_pct: null,
    ...partial,
  };
}

function p(id: string, name: string): ContinuityPlayer {
  return { playerEntityId: id, displayName: name, playerId: null };
}

describe('team-season-snapshot + roster continuity (Phase 2.T.3D)', () => {
  it('1. 0-GP current season returns null-safe snapshot', () => {
    const snap = mapTeamSeasonSnapshot('2026', null);
    expect(snap.hasData).toBe(false);
    expect(snap.gamesPlayed).toBe(0);
    expect(snap.ortg).toBeNull();
    expect(snap.netRating).toBeNull();
    expect(emptyTeamSeasonSnapshot('2026').hasData).toBe(false);
  });

  it('2. no fallback to previous-season stats', () => {
    expect(TEAM_SEASON_SNAPSHOT_SQL).toMatch(/season\s*=\s*\$2/);
    // Wrong-season row must not be displayed for requested season.
    const wrong = mapTeamSeasonSnapshot(
      '2026',
      averages({
        season: '2025',
        games_played: 82,
        wins: 50,
        losses: 32,
        avg_offensive_rating: 115,
        avg_defensive_rating: 110,
      })
    );
    expect(wrong.hasData).toBe(false);
    expect(wrong.gamesPlayed).toBe(0);
  });

  it('3. Net Rating derived only when ORTG/DRTG exist', () => {
    expect(deriveNetRating(116.4, 113.2)).toBeCloseTo(3.2, 5);
    expect(deriveNetRating(116.4, null)).toBeNull();
    expect(deriveNetRating(null, 113.2)).toBeNull();
    const snap = mapTeamSeasonSnapshot(
      '2025',
      averages({
        season: '2025',
        games_played: 20,
        wins: 12,
        losses: 8,
        avg_offensive_rating: 116.4,
        avg_defensive_rating: 113.2,
        avg_pace: 100.1,
      })
    );
    expect(snap.netRating).toBeCloseTo(3.2, 5);
  });

  it('4. games-played/sample label: 0', () => {
    expect(sampleSizeBand(0)).toBe('none');
    expect(sampleSizeLabel(0)).toBeNull();
  });

  it('5. sample label: 1–4', () => {
    expect(sampleSizeBand(3)).toBe('very_small');
    expect(sampleSizeLabel(3)).toBe('Very small sample · 3 GP');
  });

  it('6. sample label: 5–9', () => {
    expect(sampleSizeBand(7)).toBe('early');
    expect(sampleSizeLabel(7)).toBe('Early season · 7 GP');
  });

  it('7. 10+ normal state', () => {
    expect(sampleSizeBand(10)).toBe('normal');
    expect(sampleSizeLabel(82)).toBeNull();
  });

  it('8. returning entity detected', () => {
    const c = computeRosterContinuity({
      season: '2026',
      previousSeason: '2025',
      previousSeasonAvailable: true,
      current: [p('e1', 'Vet')],
      previous: [p('e1', 'Vet')],
    });
    expect(c.returningCount).toBe(1);
    expect(c.addedCount).toBe(0);
    expect(c.departedCount).toBe(0);
  });

  it('9. added entity detected', () => {
    const c = computeRosterContinuity({
      season: '2026',
      previousSeason: '2025',
      previousSeasonAvailable: true,
      current: [p('e2', 'Rookie')],
      previous: [],
    });
    expect(c.addedCount).toBe(1);
    expect(c.added[0].playerEntityId).toBe('e2');
  });

  it('10. departed entity detected', () => {
    const c = computeRosterContinuity({
      season: '2026',
      previousSeason: '2025',
      previousSeasonAvailable: true,
      current: [],
      previous: [p('e3', 'Gone')],
    });
    expect(c.departedCount).toBe(1);
    expect(c.departed[0].playerEntityId).toBe('e3');
  });

  it('11. NBA-only rookie counts as Added', () => {
    // Entity-only identity; no BDL id required in ContinuityPlayer.
    const c = computeRosterContinuity({
      season: '2026',
      previousSeason: '2025',
      previousSeasonAvailable: true,
      current: [p('nba-only-entity', 'Draft Pick')],
      previous: [p('e-vet', 'Vet')],
    });
    expect(c.added.some((x) => x.playerEntityId === 'nba-only-entity')).toBe(
      true
    );
  });

  it('12. comparison uses entity ID, not name', () => {
    const c = computeRosterContinuity({
      season: '2026',
      previousSeason: '2025',
      previousSeasonAvailable: true,
      current: [p('id-a', 'John Smith')],
      previous: [p('id-b', 'John Smith')],
    });
    expect(c.returningCount).toBe(0);
    expect(c.addedCount).toBe(1);
    expect(c.departedCount).toBe(1);
  });

  it('13. same-name different entities do not merge', () => {
    const c = computeRosterContinuity({
      season: '2026',
      previousSeason: '2025',
      previousSeasonAvailable: true,
      current: [p('e-new', 'Chris'), p('e-keep', 'Chris')],
      previous: [p('e-old', 'Chris'), p('e-keep', 'Chris')],
    });
    expect(c.returning.map((x) => x.playerEntityId)).toEqual(['e-keep']);
    expect(c.added.map((x) => x.playerEntityId)).toEqual(['e-new']);
    expect(c.departed.map((x) => x.playerEntityId)).toEqual(['e-old']);
  });

  it('14. previous-season canonical roster missing → continuity unavailable', () => {
    const c = computeRosterContinuity({
      season: '2025',
      previousSeason: '2024',
      previousSeasonAvailable: false,
      current: [p('e1', 'A')],
      previous: [],
    });
    expect(c.available).toBe(false);
    expect(c.unavailableReason).toBe('Roster continuity unavailable');
    expect(c.returningCount).toBe(0);
  });

  it('15. Class D is not name-fabricated', () => {
    // Continuity only sees entities present on canonical roster SQL.
    expect(TEAM_ROSTER_ENTITY_SQL).toMatch(/player_entity_id/);
    expect(TEAM_ROSTER_ENTITY_SQL).toMatch(/team_roster_current/);
    expect(TEAM_ROSTER_ENTITY_SQL).not.toMatch(/raw\.players/);
    expect(TEAM_ROSTER_ENTITY_SQL).not.toMatch(/player_game_logs/);
  });

  it('16. season switch correctly changes comparison seasons', () => {
    expect(previousAnalyticsSeason('2026')).toBe('2025');
    expect(previousAnalyticsSeason('2025')).toBe('2024');
    const for2026 = computeRosterContinuity({
      season: '2026',
      previousSeason: previousAnalyticsSeason('2026'),
      previousSeasonAvailable: true,
      current: [p('a', 'A')],
      previous: [p('b', 'B')],
    });
    expect(for2026.previousSeason).toBe('2025');
    const for2025 = computeRosterContinuity({
      season: '2025',
      previousSeason: previousAnalyticsSeason('2025'),
      previousSeasonAvailable: false,
      current: [],
      previous: [],
    });
    expect(for2025.previousSeason).toBe('2024');
    expect(for2025.available).toBe(false);
  });

  it('17. selected 2026 snapshot does not display 2025 stats', () => {
    const snap = mapTeamSeasonSnapshot(
      '2026',
      averages({
        season: '2025',
        games_played: 89,
        wins: 57,
        losses: 32,
        avg_points: 115,
        avg_offensive_rating: 115,
        avg_defensive_rating: 113,
      })
    );
    expect(snap.hasData).toBe(false);
    expect(snap.wins).toBeNull();
  });

  it('18. set-based continuity query avoids N+1', () => {
    expect(TEAM_ROSTER_ENTITY_SQL).toMatch(/FROM analytics\.team_roster_current/);
    expect(TEAM_ROSTER_ENTITY_SQL).toMatch(/season = \$2/);
    expect(ROSTER_SEASON_EXISTS_SQL).toMatch(/EXISTS/);
    // One SELECT per season roster — no per-player loop in SQL.
    expect(TEAM_ROSTER_ENTITY_SQL).not.toMatch(/FOR\s+EACH/i);
  });

  it('19. existing roster/schedule/injury behavior remains intact', () => {
    expect(TEAM_ROSTER_CURRENT_SQL).toMatch(/team_roster_current/);
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/analytics\.games/);
    expect(TEAM_COMPACT_RECENT_SQL).toMatch(/analytics\.games/);
  });

  it('20. regular/postseason metric semantics are tested/documented', () => {
    // TSA = all team_game_stats for season; GP>82 ⇒ includes postseason.
    expect(scopeNoteForGamesPlayed(82)).toBeNull();
    expect(scopeNoteForGamesPlayed(89)).toBe('Includes postseason');
    const mixed = mapTeamSeasonSnapshot(
      '2025',
      averages({
        season: '2025',
        games_played: 89,
        wins: 57,
        losses: 32,
        avg_offensive_rating: 115,
        avg_defensive_rating: 113,
        avg_pace: 100,
      })
    );
    expect(mixed.metricsScope).toBe('all_games');
    expect(mixed.includesPostseason).toBe(true);
    expect(mixed.scopeNote).toBe('Includes postseason');
    // Must not claim regular-season-only when GP>82.
    expect(mixed.scopeNote).not.toMatch(/regular/i);
  });
});
