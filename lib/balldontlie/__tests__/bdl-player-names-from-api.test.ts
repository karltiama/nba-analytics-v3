import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBdlPlayerNamesByIds } from '@/lib/balldontlie/bdl-player-names-from-api';

describe('fetchBdlPlayerNamesByIds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps BDL /players response data array to id -> first last', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [{ id: 335, first_name: 'Test', last_name: 'Player' }],
        }),
      }))
    );

    const m = await fetchBdlPlayerNamesByIds({ playerIds: ['335'], apiKey: 'secret' });
    expect(m.get('335')).toBe('Test Player');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('returns empty map on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const m = await fetchBdlPlayerNamesByIds({ playerIds: ['1'], apiKey: 'secret' });
    expect(m.size).toBe(0);
  });
});
