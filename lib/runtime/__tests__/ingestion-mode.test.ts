import { describe, expect, it } from 'vitest';
import {
  isLiveBdlScheduleRefreshEnabled,
  readIngestionMode,
  shouldSkipLiveMutations,
} from '@/lib/runtime/ingestion-mode';

const live = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
};

describe('readIngestionMode / shouldSkipLiveMutations', () => {
  it('treats missing DATA_MODE as skip (never live_api)', () => {
    const mode = readIngestionMode({});
    expect(mode.dataMode).toBe('');
    expect(mode.shouldSkipMutations).toBe(true);
    expect(shouldSkipLiveMutations({})).toBe(true);
  });

  it('treats unknown DATA_MODE as skip, not live', () => {
    expect(shouldSkipLiveMutations({ DATA_MODE: 'liv_api' })).toBe(true);
    expect(shouldSkipLiveMutations({ DATA_MODE: 'replay' })).toBe(true);
  });

  it('allows mutations only for exact live_api without freeze flags', () => {
    expect(shouldSkipLiveMutations(live)).toBe(false);
  });

  it('skips when live_api is set but freeze flags are on', () => {
    expect(
      shouldSkipLiveMutations({ ...live, OFFSEASON_MODE: '1' })
    ).toBe(true);
    expect(shouldSkipLiveMutations({ ...live, CRON_DRY_RUN: '1' })).toBe(true);
  });
});

describe('isLiveBdlScheduleRefreshEnabled', () => {
  it('is off when DATA_MODE is missing', () => {
    expect(isLiveBdlScheduleRefreshEnabled({})).toBe(false);
  });

  it('is off during freeze even if DISABLE flag is unset', () => {
    expect(
      isLiveBdlScheduleRefreshEnabled({
        DATA_MODE: 'replay',
        OFFSEASON_MODE: '1',
        CRON_DRY_RUN: '1',
      })
    ).toBe(false);
  });

  it('is on only for explicit live mode unless DISABLE=1', () => {
    expect(isLiveBdlScheduleRefreshEnabled(live)).toBe(true);
    expect(
      isLiveBdlScheduleRefreshEnabled({
        ...live,
        DISABLE_BDL_LIVE_SCHEDULE_REFRESH: '1',
      })
    ).toBe(false);
  });
});
