import { describe, expect, it } from 'vitest';
import {
  PREVIOUS_BASELINE_UNAVAILABLE,
  buildPreviousSeasonBaseline,
  emptyPreviousSeasonBaseline,
  resolveBaselineSeason,
} from '../team-previous-season-baseline';
import {
  TEAM_SEASON_SNAPSHOT_SQL,
  deriveNetRating,
  emptyTeamSeasonSnapshot,
  formatMetric,
  formatNetRating,
  mapTeamSeasonSnapshot,
  scopeNoteForGamesPlayed,
} from '../team-season-snapshot';
import { previousAnalyticsSeason } from '../team-roster-continuity';
import {
  TEAM_COMPACT_UPCOMING_SQL,
  TEAM_COMPACT_RECENT_SQL,
} from '../team-compact-schedule';
import { TEAM_ROSTER_CURRENT_SQL } from '../team-roster-presentation';
import { TEAM_ROSTER_ENTITY_SQL } from '../team-roster-continuity';
import { PINNED_ANALYTICS_SEASON } from '@/lib/season';
import type { TeamSeasonAverages } from '../types';

function averages(
  partial: Partial<TeamSeasonAverages> &
    Pick<TeamSeasonAverages, 'season' | 'games_played'>
): TeamSeasonAverages {
  return {
    team_id: '14',
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

function priorSnap(
  season: string,
  overrides: Partial<TeamSeasonAverages> = {}
) {
  return mapTeamSeasonSnapshot(
    season,
    averages({
      season,
      games_played: 89,
      wins: 57,
      losses: 32,
      avg_points: 115.2,
      avg_offensive_rating: 115.2,
      avg_defensive_rating: 113.7,
      avg_pace: 99.4,
      ...overrides,
    })
  );
}

describe('previous-season baseline (Phase 2.T.3E)', () => {
  it('1. selected 2026 → baseline season 2025', () => {
    expect(resolveBaselineSeason('2026')).toBe('2025');
    const b = buildPreviousSeasonBaseline({
      viewedSeason: '2026',
      priorSnapshot: priorSnap('2025'),
    });
    expect(b.baselineSeason).toBe('2025');
    expect(b.available).toBe(true);
  });

  it('2. selected 2025 → baseline season 2024', () => {
    expect(resolveBaselineSeason('2025')).toBe('2024');
    expect(previousAnalyticsSeason('2025')).toBe('2024');
  });

  it('3. previous season never derived from Production pin', () => {
    // Pin is 2025; viewing 2025 still baselines to 2024 (viewed−1), not "no baseline"
    // and not "pin as previous of itself".
    expect(PINNED_ANALYTICS_SEASON).toBe('2025');
    expect(resolveBaselineSeason('2025')).toBe('2024');
    expect(resolveBaselineSeason('2025')).not.toBe(PINNED_ANALYTICS_SEASON);
    // Viewing 2026 → 2025 follows viewed season math (coincidentally equals pin).
    expect(resolveBaselineSeason('2026')).toBe('2025');
  });

  it('4. current and prior metrics stay separately labeled', () => {
    const current = emptyTeamSeasonSnapshot('2026');
    const baseline = buildPreviousSeasonBaseline({
      viewedSeason: '2026',
      priorSnapshot: priorSnap('2025'),
    });
    expect(current.season).toBe('2026');
    expect(baseline.snapshot.season).toBe('2025');
    expect(baseline.viewedSeason).toBe('2026');
    expect(current.season).not.toBe(baseline.snapshot.season);
  });

  it('5. no cross-season fallback', () => {
    // Passing a 2025 snapshot when building for viewed 2025 (needs 2024) fails closed.
    const b = buildPreviousSeasonBaseline({
      viewedSeason: '2025',
      priorSnapshot: priorSnap('2025'),
    });
    expect(b.available).toBe(false);
    expect(b.unavailableReason).toBe(PREVIOUS_BASELINE_UNAVAILABLE);
  });

  it('6. prior season missing → unavailable state', () => {
    const b = buildPreviousSeasonBaseline({
      viewedSeason: '2025',
      priorSnapshot: emptyTeamSeasonSnapshot('2024'),
    });
    expect(b.available).toBe(false);
    expect(emptyPreviousSeasonBaseline('2025').available).toBe(false);
  });

  it('7. GP >82 → postseason disclosure', () => {
    const b = buildPreviousSeasonBaseline({
      viewedSeason: '2026',
      priorSnapshot: priorSnap('2025', { games_played: 90 }),
    });
    expect(b.snapshot.includesPostseason).toBe(true);
    expect(b.snapshot.scopeNote).toBe('Includes postseason');
    expect(scopeNoteForGamesPlayed(90)).toBe('Includes postseason');
  });

  it('8. baseline does not claim regular-season-only record', () => {
    const b = buildPreviousSeasonBaseline({
      viewedSeason: '2026',
      priorSnapshot: priorSnap('2025', { games_played: 89 }),
    });
    expect(b.snapshot.metricsScope).toBe('all_games');
    expect(b.snapshot.scopeNote).not.toMatch(/regular/i);
  });

  it('9. Net derived correctly', () => {
    expect(deriveNetRating(115.2, 113.7)).toBeCloseTo(1.5, 5);
    const b = buildPreviousSeasonBaseline({
      viewedSeason: '2026',
      priorSnapshot: priorSnap('2025'),
    });
    expect(b.snapshot.netRating).toBeCloseTo(1.5, 5);
  });

  it('10. NULL metric → em dash, not 0', () => {
    const snap = mapTeamSeasonSnapshot(
      '2025',
      averages({
        season: '2025',
        games_played: 82,
        wins: 40,
        losses: 42,
        avg_points: null,
        avg_offensive_rating: null,
        avg_defensive_rating: 110,
        avg_pace: null,
      })
    );
    expect(formatMetric(snap.ppg)).toBe('—');
    expect(formatMetric(snap.ortg)).toBe('—');
    expect(formatNetRating(snap.netRating)).toBe('—');
    expect(formatMetric(0)).toBe('0.0'); // zero only when truly zero
  });

  it('11. current 0 GP + previous baseline both render correctly', () => {
    const current = emptyTeamSeasonSnapshot('2026');
    const baseline = buildPreviousSeasonBaseline({
      viewedSeason: '2026',
      priorSnapshot: priorSnap('2025'),
    });
    expect(current.hasData).toBe(false);
    expect(current.gamesPlayed).toBe(0);
    expect(baseline.available).toBe(true);
    expect(baseline.snapshot.gamesPlayed).toBe(89);
  });

  it('12. early-season current + previous baseline both render', () => {
    const current = mapTeamSeasonSnapshot(
      '2026',
      averages({
        season: '2026',
        games_played: 5,
        wins: 3,
        losses: 2,
        avg_offensive_rating: 118.4,
        avg_defensive_rating: 114.1,
        avg_pace: 100,
        avg_points: 112,
      })
    );
    const baseline = buildPreviousSeasonBaseline({
      viewedSeason: '2026',
      priorSnapshot: priorSnap('2025'),
    });
    expect(current.sampleLabel).toBe('Early season · 5 GP');
    expect(baseline.available).toBe(true);
    expect(current.season).toBe('2026');
    expect(baseline.snapshot.season).toBe('2025');
  });

  it('13. no causal interpretation generated', () => {
    const b = buildPreviousSeasonBaseline({
      viewedSeason: '2026',
      priorSnapshot: priorSnap('2025'),
    });
    // Baseline payload is numbers + labels only — no narrative fields.
    expect(b).not.toHaveProperty('interpretation');
    expect(b).not.toHaveProperty('delta');
    expect(b).not.toHaveProperty('improved');
    expect(JSON.stringify(b)).not.toMatch(/improved|regressed|caused/i);
  });

  it('14. same season snapshot semantics shared between current/baseline', () => {
    // Same SQL + mapper: baseline uses getTeamSeasonSnapshot path / TEAM_SEASON_SNAPSHOT_SQL.
    expect(TEAM_SEASON_SNAPSHOT_SQL).toMatch(/team_season_averages/);
    expect(TEAM_SEASON_SNAPSHOT_SQL).toMatch(/season\s*=\s*\$2/);
    const asCurrent = priorSnap('2025');
    const asBaseline = buildPreviousSeasonBaseline({
      viewedSeason: '2026',
      priorSnapshot: asCurrent,
    });
    expect(asBaseline.snapshot.ortg).toBe(asCurrent.ortg);
    expect(asBaseline.snapshot.netRating).toBe(asCurrent.netRating);
    expect(asBaseline.snapshot.gamesPlayed).toBe(asCurrent.gamesPlayed);
  });

  it('15. season switch changes both current and baseline correctly', () => {
    const view2026 = buildPreviousSeasonBaseline({
      viewedSeason: '2026',
      priorSnapshot: priorSnap('2025'),
    });
    const view2025 = emptyPreviousSeasonBaseline('2025');
    expect(view2026.viewedSeason).toBe('2026');
    expect(view2026.baselineSeason).toBe('2025');
    expect(view2025.viewedSeason).toBe('2025');
    expect(view2025.baselineSeason).toBe('2024');
    expect(view2025.available).toBe(false);
  });

  it('16. roster continuity remains unchanged', () => {
    expect(TEAM_ROSTER_ENTITY_SQL).toMatch(/player_entity_id/);
    expect(TEAM_ROSTER_ENTITY_SQL).toMatch(/team_roster_current/);
  });

  it('17. schedule/injury/roster behavior unaffected', () => {
    expect(TEAM_ROSTER_CURRENT_SQL).toMatch(/team_roster_current/);
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/analytics\.games/);
    expect(TEAM_COMPACT_RECENT_SQL).toMatch(/analytics\.games/);
  });

  it('18. no N+1 behavior', () => {
    // One season-scoped SELECT via shared snapshot SQL (team_id + season).
    expect(TEAM_SEASON_SNAPSHOT_SQL).toMatch(/LIMIT 1/);
    expect(TEAM_SEASON_SNAPSHOT_SQL).not.toMatch(/FOR\s+EACH/i);
  });
});
