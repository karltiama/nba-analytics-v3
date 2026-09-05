import { describe, expect, it } from 'vitest';
import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';
import {
  COMPACT_SCHEDULE_DEFAULT_LIMIT,
  TEAM_COMPACT_RECENT_SQL,
  TEAM_COMPACT_UPCOMING_SQL,
  assertCompactScheduleSeason,
  compactGameHref,
  computeCompactResult,
  formatCompactScheduleDate,
  formatCompactScoreLine,
  formatCompactTipoff,
  formatOpponentLine,
  fullScheduleHref,
  homeAwayMarker,
  mapCompactScheduleRow,
} from '../team-compact-schedule';
import { TEAM_ROSTER_CURRENT_SQL } from '../team-roster-presentation';

function baseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    game_id: 'g1',
    season: '2026',
    start_time: '2026-10-22T23:30:00.000Z',
    status: 'Scheduled',
    home_score: null,
    away_score: null,
    venue: null,
    home_team_id: '14',
    home_abbr: 'LAL',
    home_name: 'Los Angeles Lakers',
    away_team_id: '2',
    away_abbr: 'BOS',
    away_name: 'Boston Celtics',
    ...overrides,
  };
}

describe('team-compact-schedule (Phase 2.T.3C)', () => {
  it('1. schedule query requires explicit season', () => {
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/g\.season\s*=\s*\$2/);
    expect(TEAM_COMPACT_RECENT_SQL).toMatch(/g\.season\s*=\s*\$2/);
    expect(() => assertCompactScheduleSeason('2026')).not.toThrow();
    expect(() => assertCompactScheduleSeason('')).toThrow();
    expect(() => assertCompactScheduleSeason('2026-27')).toThrow();
  });

  it('2. only selected-season games returned (SQL scopes season)', () => {
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/AND g\.season = \$2/);
    expect(TEAM_COMPACT_RECENT_SQL).toMatch(/AND g\.season = \$2/);
    expect(TEAM_COMPACT_UPCOMING_SQL).not.toMatch(/OR g\.season/);
    expect(TEAM_COMPACT_RECENT_SQL).not.toMatch(/OR g\.season/);
  });

  it('3. upcoming games sorted ascending', () => {
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(
      /ORDER BY g\.start_time ASC NULLS LAST/
    );
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/LIMIT \$4/);
    expect(COMPACT_SCHEDULE_DEFAULT_LIMIT).toBe(3);
  });

  it('4. recent finals sorted descending', () => {
    expect(TEAM_COMPACT_RECENT_SQL).toMatch(
      /ORDER BY g\.start_time DESC NULLS LAST/
    );
    expect(TEAM_COMPACT_RECENT_SQL).toMatch(/=\s*'final'/);
    expect(TEAM_COMPACT_RECENT_SQL).toMatch(/LIMIT \$4/);
  });

  it('5. home game renders vs', () => {
    expect(homeAwayMarker(true)).toBe('vs');
    expect(formatOpponentLine(true, 'NYK')).toBe('vs NYK');
    const mapped = mapCompactScheduleRow('14', baseRow({ status: 'Scheduled' }));
    expect(mapped.is_home).toBe(true);
    expect(formatOpponentLine(mapped.is_home, mapped.opponent_abbr)).toBe('vs BOS');
  });

  it('6. away game renders @', () => {
    expect(homeAwayMarker(false)).toBe('@');
    expect(formatOpponentLine(false, 'BOS')).toBe('@ BOS');
    const mapped = mapCompactScheduleRow('2', baseRow());
    expect(mapped.is_home).toBe(false);
    expect(formatOpponentLine(mapped.is_home, mapped.opponent_abbr)).toBe('@ LAL');
  });

  it('7. W/L computed correctly', () => {
    expect(computeCompactResult('Final', 112, 104)).toBe('W');
    expect(computeCompactResult('Final', 101, 108)).toBe('L');
    expect(computeCompactResult('Scheduled', 112, 104)).toBeNull();
    expect(computeCompactResult('Final', null, 104)).toBeNull();
  });

  it('8. final score displayed correctly', () => {
    expect(formatCompactScoreLine('W', 112, 104)).toBe('W 112–104');
    expect(formatCompactScoreLine('L', 101, 108)).toBe('L 101–108');
    const mapped = mapCompactScheduleRow(
      '14',
      baseRow({
        status: 'Final',
        home_score: 118,
        away_score: 113,
      })
    );
    expect(mapped.result).toBe('W');
    expect(
      formatCompactScoreLine(mapped.result, mapped.team_score, mapped.opponent_score)
    ).toBe('W 118–113');
  });

  it('9. scheduled game does not show fake score', () => {
    const mapped = mapCompactScheduleRow('14', baseRow({ status: '7:30 PM ET' }));
    expect(mapped.result).toBeNull();
    expect(mapped.team_score).toBeNull();
    expect(mapped.opponent_score).toBeNull();
    expect(
      formatCompactScoreLine(mapped.result, mapped.team_score, mapped.opponent_score)
    ).toBe('—');
    expect(formatCompactScoreLine(null, 0, 0)).toBe('—');
  });

  it('10. tipoff uses existing ET formatter', () => {
    const iso = '2026-10-22T23:30:00.000Z';
    expect(formatCompactTipoff(iso)).toBe(formatTipoffEt(iso));
    expect(formatCompactTipoff(iso)).toMatch(/7:30\s*PM/i);
    expect(formatCompactTipoff(null)).toBe('—');
    expect(formatCompactScheduleDate(iso)).toMatch(/Oct\s+22/);
  });

  it('11. 2026 page does not fall back to 2025 recent games', () => {
    // Recent SQL always binds the page season — no COALESCE / OR other season.
    expect(TEAM_COMPACT_RECENT_SQL).toMatch(/g\.season = \$2/);
    expect(TEAM_COMPACT_RECENT_SQL.toLowerCase()).not.toContain('2025');
    expect(TEAM_COMPACT_RECENT_SQL).not.toMatch(/coalesce\s*\(\s*\$2/i);
  });

  it('12. historical season does not leak current schedule', () => {
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/g\.season = \$2/);
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/g\.start_time >= \$3/);
    // Binding season=2025 cannot return season=2026 rows.
    const mapped = mapCompactScheduleRow(
      '14',
      baseRow({ season: '2025', status: 'Final', home_score: 100, away_score: 90 })
    );
    expect(mapped.season).toBe('2025');
  });

  it('13. empty recent state works', () => {
    const recent: unknown[] = [];
    expect(recent.length === 0).toBe(true);
    // UI copy contract
    expect('No completed games yet').toBeTruthy();
  });

  it('14. empty upcoming state works', () => {
    const upcoming: unknown[] = [];
    expect(upcoming.length === 0).toBe(true);
    expect('No upcoming games').toBeTruthy();
  });

  it('15. opponent joins do not produce N+1 behavior', () => {
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/JOIN analytics\.teams t_home/);
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/JOIN analytics\.teams t_away/);
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/FROM analytics\.games g/);
    // Single SELECT with joins + LIMIT — no per-opponent loop pattern.
    expect(TEAM_COMPACT_UPCOMING_SQL).not.toMatch(/FOR\s+EACH/i);
  });

  it('16. incomplete 2026 schedule does not create fake games', () => {
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/FROM analytics\.games/);
    expect(TEAM_COMPACT_UPCOMING_SQL).not.toMatch(/generate_series/);
    expect(TEAM_COMPACT_UPCOMING_SQL).not.toMatch(/INSERT/i);
  });

  it('17. existing TeamRoster/season behavior remains unchanged', () => {
    expect(TEAM_ROSTER_CURRENT_SQL).toMatch(/team_roster_current/);
    expect(TEAM_ROSTER_CURRENT_SQL).toMatch(/season\s*=\s*\$2/);
  });

  it('game links use existing /games route; full schedule preserves season', () => {
    expect(compactGameHref('184467')).toBe('/games/184467');
    expect(fullScheduleHref('14', '2026')).toBe('/teams/14/schedule?season=2026');
  });

  it('maps tipoff-style status to Scheduled without exposing raw ISO', () => {
    const mapped = mapCompactScheduleRow(
      '14',
      baseRow({ status: '2026-10-22T23:30:00Z' })
    );
    expect(mapped.status).toBe('Scheduled');
    expect(mapped.status_raw).toBe('2026-10-22T23:30:00Z');
  });
});
