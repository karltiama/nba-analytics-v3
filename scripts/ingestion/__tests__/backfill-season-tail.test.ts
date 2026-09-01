import { describe, expect, it } from 'vitest';
import {
  addOneDay,
  buildSteps,
  defaultTailEnd,
  parseArgs,
  resolveWindow,
  type SeasonTailReport,
} from '../backfill-season-tail';

function emptyReport(over: Partial<SeasonTailReport> = {}): SeasonTailReport {
  return {
    season: 2025,
    analyticsGames: 0,
    analyticsFinal: 0,
    analyticsLogs: 0,
    lastGameEt: null,
    lastFinalEt: null,
    rawGames: 0,
    rawPostseason: 0,
    rawRegular: 0,
    lastRawPostseasonEt: null,
    rawGamesAfterLastFinal: 0,
    rawGamesAfterLastFinalWithStats: 0,
    gamesByMonth: [],
    ...over,
  };
}

describe('backfill-season-tail', () => {
  it('defaults playoff-safe end date to June 30', () => {
    expect(defaultTailEnd(2025)).toBe('2026-06-30');
  });

  it('starts the day after last Final when --start is omitted', () => {
    const args = parseArgs(['--season=2025']);
    const window = resolveWindow(args, emptyReport({ lastFinalEt: '2026-05-12', lastGameEt: '2026-05-12' }));
    expect(window.start).toBe('2026-05-13');
    expect(window.end).toBe('2026-06-30');
    expect(window.startSource).toContain('2026-05-12');
  });

  it('buildSteps does not hit the API and pins June 30 end', () => {
    const steps = buildSteps(2025, '2026-05-13', '2026-06-30');
    expect(steps).toHaveLength(2);
    expect(steps[0].args).toEqual(
      expect.arrayContaining(['--season', '2025', '--start', '2026-05-13', '--end', '2026-06-30', '--stats'])
    );
    expect(steps[1].args).toContain('scripts/transform-raw-to-analytics.ts');
  });

  it('addOneDay crosses months', () => {
    expect(addOneDay('2026-04-30')).toBe('2026-05-01');
  });
});
