import { describe, expect, it } from 'vitest';
import { parseRequiredStatusSyncTargetSeason, STATUS_SYNC_TARGET_SEASON_ENV } from '@/lib/games/status-sync-query';
import { PROTECTED_HISTORY_SEASONS } from '@/lib/games/status-sync';

describe('STATUS_SYNC_TARGET_SEASON fail-closed parser', () => {
  it('accepts 2026 independently of the product pin', () => {
    const parsed = parseRequiredStatusSyncTargetSeason(
      { [STATUS_SYNC_TARGET_SEASON_ENV]: '2026' },
      PROTECTED_HISTORY_SEASONS
    );
    expect(parsed).toEqual({ ok: true, season: 2026 });
  });

  it('refuses missing, invalid, and protected historical seasons', () => {
    expect(parseRequiredStatusSyncTargetSeason({}, PROTECTED_HISTORY_SEASONS).ok).toBe(false);
    expect(
      parseRequiredStatusSyncTargetSeason({ [STATUS_SYNC_TARGET_SEASON_ENV]: 'abc' }, PROTECTED_HISTORY_SEASONS).reason
    ).toMatch(/invalid/);
    expect(
      parseRequiredStatusSyncTargetSeason({ [STATUS_SYNC_TARGET_SEASON_ENV]: '2025' }, PROTECTED_HISTORY_SEASONS).reason
    ).toMatch(/protected historical season 2025/);
    expect(
      parseRequiredStatusSyncTargetSeason({ [STATUS_SYNC_TARGET_SEASON_ENV]: '2024' }, PROTECTED_HISTORY_SEASONS).ok
    ).toBe(false);
  });
});
