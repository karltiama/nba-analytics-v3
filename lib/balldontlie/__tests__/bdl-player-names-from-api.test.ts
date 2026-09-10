import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBdlPlayerNamesByIds } from '@/lib/balldontlie/bdl-player-names-from-api';
import { resetDefaultMemoryLiveRateLimitStore } from '@/lib/balldontlie/live-rate-limit';

describe('fetchBdlPlayerNamesByIds', () => {
  beforeEach(() => {
    vi.stubEnv('DATA_MODE', 'live_api');
    vi.stubEnv('OFFSEASON_MODE', '0');
    vi.stubEnv('CRON_DRY_RUN', '0');
    vi.stubEnv('BDL_RATE_LIMIT_BACKEND', 'memory');
    vi.stubEnv('BDL_RATE_LIMIT_ALLOW_FAST', '1');
    resetDefaultMemoryLiveRateLimitStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps BDL /players response data array to id -> first last', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 335, first_name: 'Test', last_name: 'Player' }],
        }),
      }))
    );

    const m = await fetchBdlPlayerNamesByIds({ playerIds: ['335'], apiKey: 'secret' });
    expect(m.get('335')).toBe('Test Player');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('does not call BDL when freeze flags are on', async () => {
    vi.stubEnv('DATA_MODE', 'replay');
    vi.stubEnv('OFFSEASON_MODE', '1');
    vi.stubEnv('CRON_DRY_RUN', '1');
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const m = await fetchBdlPlayerNamesByIds({ playerIds: ['335'], apiKey: 'secret' });
    expect(m.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns empty map on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    );
    const m = await fetchBdlPlayerNamesByIds({ playerIds: ['1'], apiKey: 'secret' });
    expect(m.size).toBe(0);
  });
});
