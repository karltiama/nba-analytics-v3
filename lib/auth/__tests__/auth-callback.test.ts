import { describe, expect, it } from 'vitest';
import { finishAuthCallback, planAuthCallback } from '@/lib/auth/auth-callback';
import { AUTHENTICATED_HOME } from '@/lib/auth/safe-next';

const origin = 'https://courtcontext.com';

describe('planAuthCallback', () => {
  it('exchanges a valid code and keeps an internal return path', () => {
    const plan = planAuthCallback({
      origin,
      code: 'pkce-code',
      next: '/betting/props-explorer?date=2026-09-24',
      providerError: null,
    });
    expect(plan).toEqual({
      action: 'exchange',
      code: 'pkce-code',
      next: '/betting/props-explorer?date=2026-09-24',
    });
    expect(
      finishAuthCallback({ origin, next: plan.action === 'exchange' ? plan.next : '', exchangeOk: true })
    ).toBe('https://courtcontext.com/betting/props-explorer?date=2026-09-24');
  });

  it('sends an invalid callback to login without a raw provider error', () => {
    const plan = planAuthCallback({
      origin,
      code: null,
      next: '/dashboard',
      providerError: 'otp_expired',
    });
    expect(plan).toEqual({
      action: 'redirect',
      location: 'https://courtcontext.com/login?error=auth_callback',
    });
  });

  it('sends a failed recovery exchange back to forgot password', () => {
    expect(
      finishAuthCallback({
        origin,
        next: '/update-password',
        exchangeOk: false,
      })
    ).toBe('https://courtcontext.com/forgot-password?error=recovery_expired');
  });

  it('does not rewrite onboarding or existing-user destinations', () => {
    const newer = planAuthCallback({
      origin,
      code: 'code',
      next: '/dashboard',
      providerError: null,
    });
    const existing = planAuthCallback({
      origin,
      code: 'code',
      next: '/betting/props-explorer',
      providerError: null,
    });
    expect(newer).toMatchObject({ next: '/dashboard' });
    expect(existing).toMatchObject({ next: '/betting/props-explorer' });
    expect(JSON.stringify(newer)).not.toMatch(/onboard/);
    expect(JSON.stringify(existing)).not.toMatch(/onboard/);
  });

  it('falls back when next is an external URL', () => {
    const plan = planAuthCallback({
      origin,
      code: 'code',
      next: 'https://evil.example',
      providerError: null,
    });
    expect(plan).toMatchObject({ action: 'exchange', next: AUTHENTICATED_HOME });
  });

  it('keeps a password recovery callback on the update page', () => {
    const plan = planAuthCallback({
      origin,
      code: 'recovery-code',
      next: '/update-password',
      providerError: null,
    });
    expect(plan).toEqual({ action: 'exchange', code: 'recovery-code', next: '/update-password' });
  });
});
