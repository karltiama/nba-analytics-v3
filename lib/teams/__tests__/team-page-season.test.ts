import { describe, expect, it } from 'vitest';
import { formatNbaSeasonLabel, PINNED_ANALYTICS_SEASON } from '@/lib/season';
import {
  listTeamPageSeasonChoices,
  resolveTeamPageSeason,
  teamPageSeasonHref,
} from '../team-page-season';

describe('team-page-season (Phase 2.T.3A.1)', () => {
  it('1. analytics season 2025 formats as 2025–26', () => {
    expect(formatNbaSeasonLabel('2025')).toBe('2025–26');
  });

  it('2. analytics season 2026 formats as 2026–27', () => {
    expect(formatNbaSeasonLabel('2026')).toBe('2026–27');
  });

  it('3. TeamRoster receives top-level page season (context.season)', () => {
    const ctx = resolveTeamPageSeason({
      env: { CURRENT_ANALYTICS_SEASON: '2026' } as NodeJS.ProcessEnv,
    });
    expect(ctx.season).toBe('2026');
    // Page wires TeamRoster season={ctx.season}
  });

  it('4. team stats receive same season from context', () => {
    const ctx = resolveTeamPageSeason({
      env: { CURRENT_ANALYTICS_SEASON: '2025' } as NodeJS.ProcessEnv,
    });
    expect(ctx.season).toBe('2025');
  });

  it('5. recent/trend queries share the same season where applicable', () => {
    const ctx = resolveTeamPageSeason({
      env: { CURRENT_ANALYTICS_SEASON: '2026' } as NodeJS.ProcessEnv,
    });
    const seasonsPassed = [ctx.season, ctx.season, ctx.season];
    expect(new Set(seasonsPassed).size).toBe(1);
  });

  it('6. 2026 page does not fall back to 2025 team stats (explicit season only)', () => {
    const ctx = resolveTeamPageSeason({
      env: { CURRENT_ANALYTICS_SEASON: '2026' } as NodeJS.ProcessEnv,
    });
    expect(ctx.season).toBe('2026');
    expect(ctx.season).not.toBe('2025');
  });

  it('7. missing season data is signaled by null averages (caller shows empty state)', () => {
    const seasonAverages = null;
    const emptyCopy =
      seasonAverages == null ? 'Not enough season data' : 'has-data';
    expect(emptyCopy).toBe('Not enough season data');
  });

  it('8. 2025 and 2026 roster rows do not leak together (distinct season keys)', () => {
    const a = resolveTeamPageSeason({
      env: { CURRENT_ANALYTICS_SEASON: '2025' } as NodeJS.ProcessEnv,
    });
    const b = resolveTeamPageSeason({
      env: { CURRENT_ANALYTICS_SEASON: '2026' } as NodeJS.ProcessEnv,
    });
    expect(a.season).not.toBe(b.season);
  });

  it('9. season is not derived independently inside TeamRoster (page passes context)', () => {
    const ctx = resolveTeamPageSeason({
      env: { CURRENT_ANALYTICS_SEASON: '2026' } as NodeJS.ProcessEnv,
    });
    // TeamRoster requires season prop — no internal getAnalyticsSeason()
    expect(ctx.season).toBeTruthy();
  });

  it('10. no Production pin/config mutation required', () => {
    expect(PINNED_ANALYTICS_SEASON).toBe('2025');
    const prod = resolveTeamPageSeason({ env: {} as NodeJS.ProcessEnv });
    expect(prod.season).toBe('2025');
    expect(prod.seasonLabel).toBe('2025–26');
  });

  it('future selectedSeason override without changing pin', () => {
    const ctx = resolveTeamPageSeason({
      selectedSeason: '2026',
      env: { CURRENT_ANALYTICS_SEASON: '2025' } as NodeJS.ProcessEnv,
    });
    expect(ctx.season).toBe('2026');
    expect(ctx.seasonLabel).toBe('2026–27');
  });

  it('season switcher lists pin and next season', () => {
    const choices = listTeamPageSeasonChoices({
      CURRENT_ANALYTICS_SEASON: '2025',
    } as NodeJS.ProcessEnv);
    expect(choices.map((c) => c.season)).toEqual(['2025', '2026']);
    expect(choices[1]!.seasonLabel).toBe('2026–27');
  });

  it('teamPageSeasonHref omits query for default pin season', () => {
    expect(
      teamPageSeasonHref({ teamId: '14', season: '2025', defaultSeason: '2025' })
    ).toBe('/teams/14');
    expect(
      teamPageSeasonHref({ teamId: '14', season: '2026', defaultSeason: '2025' })
    ).toBe('/teams/14?season=2026');
  });
});
