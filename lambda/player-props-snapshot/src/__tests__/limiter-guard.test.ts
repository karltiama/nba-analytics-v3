import { describe, expect, it } from 'vitest';
import { assertPropsLiveLimiter, PROPS_LIVE_LIMITER_PROFILE, PropsLimiterError } from '../limiter-guard';

const safe = { ...PROPS_LIVE_LIMITER_PROFILE };

describe('props live limiter guard', () => {
  it('accepts the 13-second single-token profile with no retries', () => {
    expect(() => assertPropsLiveLimiter(safe)).not.toThrow();
  });

  it('rejects a 500ms interval', () => {
    expect(() => assertPropsLiveLimiter({ ...safe, BDL_RATE_LIMIT_INTERVAL_MS: '500' })).toThrow(PropsLimiterError);
  });

  it('rejects a burst greater than 1', () => {
    expect(() => assertPropsLiveLimiter({ ...safe, BDL_RATE_LIMIT_BURST: '5' })).toThrow(/BURST/);
  });

  it('rejects retries greater than 0', () => {
    expect(() => assertPropsLiveLimiter({ ...safe, BDL_RATE_LIMIT_MAX_RETRIES: '3' })).toThrow(/MAX_RETRIES/);
  });

  it('rejects a missing critical setting instead of using a default', () => {
    const env: Record<string, string> = { ...safe };
    delete env.BDL_RATE_LIMIT_INTERVAL_MS;
    expect(() => assertPropsLiveLimiter(env)).toThrow(/INTERVAL_MS/);
    expect(() => assertPropsLiveLimiter({ ...safe, BDL_RATE_LIMIT_MAX_REQUESTS: '  ' })).toThrow(/MAX_REQUESTS/);
  });
});
