import { describe, expect, it } from 'vitest';
import { assertLegacyRawStatsPathAllowed, parseSeedRawArgs } from '../legacy-raw-guard';

describe('legacy raw historical stats guard', () => {
  it('refuses --season=2024 --stats without override and names the serving backfill', () => {
    const args = parseSeedRawArgs(['--season=2024', '--stats']);
    expect(args.withStats).toBe(true);
    expect(args.season).toBe(2024);
    expect(() => assertLegacyRawStatsPathAllowed(args, {})).toThrow(/backfill-historical-season-serving/);
  });

  it('refuses --season 2023 --stats', () => {
    const args = parseSeedRawArgs(['--season', '2023', '--stats']);
    expect(() => assertLegacyRawStatsPathAllowed(args, {})).toThrow(/2023/);
  });

  it('allows 2025 live/repair --stats', () => {
    const args = parseSeedRawArgs(['--season=2025', '--stats']);
    expect(() => assertLegacyRawStatsPathAllowed(args, {})).not.toThrow();
  });

  it('allows an explicit unsafe override', () => {
    const args = parseSeedRawArgs(['--season=2024', '--stats', '--allow-historical-raw-stats']);
    expect(() => assertLegacyRawStatsPathAllowed(args, {})).not.toThrow();
  });
});
