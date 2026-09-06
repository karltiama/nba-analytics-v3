import { describe, expect, it } from 'vitest';
import { PINNED_ANALYTICS_SEASON } from '@/lib/season';
import { resolveTeamPageSeason } from '@/lib/teams/team-page-season';
import { hasCompletedSeasonStats } from '@/lib/players/season-stats-empty';

/**
 * Public /players/[playerId] follows resolveTeamPageSeason (app pin + ?season=).
 * Queries always receive that start-year so 2026 cannot silently show all-Finals 2025 BBRef.
 */
describe('player page season isolation', () => {
  it('defaults to the analytics pin (Production 2025), not all-seasons aggregate', () => {
    const ctx = resolveTeamPageSeason({ env: {} as NodeJS.ProcessEnv });
    expect(ctx.season).toBe(PINNED_ANALYTICS_SEASON);
    expect(ctx.seasonLabel).toBe('2025–26');
  });

  it('explicit ?season=2026 does not keep 2025 as the query season', () => {
    const ctx = resolveTeamPageSeason({
      selectedSeason: '2026',
      env: {} as NodeJS.ProcessEnv,
    });
    expect(ctx.season).toBe('2026');
    expect(ctx.season).not.toBe('2025');
    expect(ctx.seasonLabel).toBe('2026–27');
  });

  it('treats Postgres COUNT string "0" as no completed stats', () => {
    expect(hasCompletedSeasonStats('0')).toBe(false);
    expect(hasCompletedSeasonStats(0)).toBe(false);
    expect(hasCompletedSeasonStats(82)).toBe(true);
  });
});
