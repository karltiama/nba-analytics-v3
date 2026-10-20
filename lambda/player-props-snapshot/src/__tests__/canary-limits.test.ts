import { describe, expect, it } from 'vitest';
import {
  assertCanaryGameRow,
  assertCanaryLimiter,
  assertCanaryRecord,
} from '../canary-limits';

const env = {
  PLAYER_PROPS_CANARY_ONLY: '1',
  PLAYER_PROPS_CANARY_GAME_ID: '21717855',
  BDL_RATE_LIMIT_INTERVAL_MS: '13000',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1',
  BDL_RATE_LIMIT_BURST: '1',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
};

const body = JSON.stringify({
  runId: 0,
  gameId: '21717855',
  bdlGameId: 21717855,
  date: '2026-10-20',
});

describe('player props canary authorization', () => {
  it('accepts the BOS game SQS record', () => {
    expect(assertCanaryRecord({ Records: [{ body }] }, env)).toEqual({
      runId: 0,
      gameId: '21717855',
      bdlGameId: 21717855,
      date: '2026-10-20',
    });
  });

  it('rejects a second record, another game, a controller run, and a missing id', () => {
    expect(() => assertCanaryRecord({ Records: [{ body }, { body }] }, env)).toThrow(/exactly one/);
    expect(() => assertCanaryRecord({ Records: [] }, env)).toThrow(/exactly one/);
    expect(() => assertCanaryRecord({
      Records: [{ body: JSON.stringify({ runId: 0, gameId: '21717856', bdlGameId: 21717856, date: '2026-10-20' }) }],
    }, env)).toThrow(/exactly one/);
    expect(() => assertCanaryRecord({
      Records: [{ body: JSON.stringify({ runId: 9, gameId: '21717855', bdlGameId: 21717855, date: '2026-10-20' }) }],
    }, env)).toThrow(/exactly one/);
    expect(() => assertCanaryRecord({ Records: [{ body }] }, { ...env, PLAYER_PROPS_CANARY_GAME_ID: '21717922' })).toThrow(
      /opening-night/
    );
  });

  it('rejects a limiter that would speed the shared bucket or retry a 429', () => {
    expect(() => assertCanaryLimiter({ ...env, BDL_RATE_LIMIT_INTERVAL_MS: '500' })).toThrow(/INTERVAL_MS/);
    expect(() => assertCanaryLimiter({ ...env, BDL_RATE_LIMIT_BURST: '5' })).toThrow(/BURST/);
    expect(() => assertCanaryLimiter({ ...env, BDL_RATE_LIMIT_MAX_RETRIES: undefined })).toThrow(/MAX_RETRIES/);
  });

  it('requires season 2026 regular', () => {
    expect(assertCanaryGameRow({ gameId: '21717855', season: '2026', seasonPhase: 'REGULAR' })).toBeUndefined();
    expect(() => assertCanaryGameRow({ gameId: '21717855', season: '2026', seasonPhase: 'PRESEASON' })).toThrow(/2026 regular/);
    expect(() => assertCanaryGameRow(null)).toThrow(/2026 regular/);
  });
});
