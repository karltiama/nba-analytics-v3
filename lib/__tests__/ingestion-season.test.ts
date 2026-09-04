import { describe, expect, it } from 'vitest';
import {
  getAnalyticsSeason,
  PINNED_ANALYTICS_SEASON,
  resolveIngestionSeasonStartYear,
} from '@/lib/season';

function env(partial: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return partial as NodeJS.ProcessEnv;
}

describe('resolveIngestionSeasonStartYear', () => {
  it('explicit season wins (manual 2026 seed path)', () => {
    expect(resolveIngestionSeasonStartYear(2026, env())).toBe(2026);
    expect(resolveIngestionSeasonStartYear(2026, env({ CURRENT_ANALYTICS_SEASON: '2025' }))).toBe(2026);
  });

  it('uses CURRENT_ANALYTICS_SEASON when season omitted', () => {
    expect(resolveIngestionSeasonStartYear(undefined, env({ CURRENT_ANALYTICS_SEASON: '2026' }))).toBe(2026);
    expect(resolveIngestionSeasonStartYear(null, env({ CURRENT_ANALYTICS_SEASON: '2026-27' }))).toBe(2026);
  });

  it('falls back to pin, not calendar July cutoff', () => {
    const sep2026 = new Date('2026-09-01T12:00:00.000Z');
    expect(resolveIngestionSeasonStartYear(undefined, env(), sep2026)).toBe(Number(PINNED_ANALYTICS_SEASON));
    expect(getAnalyticsSeason(env(), sep2026)).toBe('2025');
  });
});
