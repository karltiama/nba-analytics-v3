import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { authorizeCronRequest } from '@/lib/auth/cron-auth';

function makeRequest(opts?: {
  bearer?: string;
  secretQuery?: string;
}): NextRequest {
  const url = new URL('http://localhost/api/cron/paper-settle');
  if (opts?.secretQuery != null) {
    url.searchParams.set('secret', opts.secretQuery);
  }
  const headers = new Headers();
  if (opts?.bearer != null) {
    headers.set('authorization', `Bearer ${opts.bearer}`);
  }
  return new NextRequest(url, { headers });
}

describe('authorizeCronRequest', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.CRON_SECRET;
    delete process.env.PAPER_SETTLE_CRON_SECRET;
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects when production has no cron secret configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.CRON_SECRET;
    delete process.env.PAPER_SETTLE_CRON_SECRET;
    const result = authorizeCronRequest(makeRequest({ bearer: 'anything' }));
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: 'CRON_SECRET must be set in production',
    });
  });

  it('rejects incorrect cron secret', () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const result = authorizeCronRequest(makeRequest({ bearer: 'wrong-secret' }));
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    });
  });

  it('allows correct Bearer cron secret', () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const result = authorizeCronRequest(makeRequest({ bearer: 'correct-secret' }));
    expect(result).toEqual({ ok: true });
  });

  it('allows correct ?secret= query (manual testing)', () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const result = authorizeCronRequest(makeRequest({ secretQuery: 'correct-secret' }));
    expect(result).toEqual({ ok: true });
  });

  it('allows paper-settle secrets via PAPER_SETTLE_CRON_SECRET override', () => {
    vi.stubEnv('PAPER_SETTLE_CRON_SECRET', 'paper-only');
    const result = authorizeCronRequest(makeRequest({ bearer: 'paper-only' }), {
      secretEnvKeys: ['PAPER_SETTLE_CRON_SECRET', 'CRON_SECRET'],
    });
    expect(result).toEqual({ ok: true });
  });

  it('allows requests in non-production when no secret is configured', () => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.CRON_SECRET;
    delete process.env.PAPER_SETTLE_CRON_SECRET;
    const result = authorizeCronRequest(makeRequest());
    expect(result).toEqual({ ok: true });
  });
});
