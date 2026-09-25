import { describe, expect, it, vi } from 'vitest';
import {
  PASSWORD_MISMATCH_ERROR,
  PASSWORD_TOO_SHORT_ERROR,
  PASSWORD_UPDATE_ERROR,
  RESET_PROVIDER_ERROR,
  RESET_SUCCESS_MESSAGE,
  recoveryPresence,
  recoveryRedirectUrl,
  requestPasswordReset,
  updateRecoveredPassword,
} from '@/lib/auth/password-recovery';

describe('requestPasswordReset', () => {
  it('rejects an invalid email before calling Supabase', async () => {
    const resetPasswordForEmail = vi.fn();
    const result = await requestPasswordReset({
      email: 'not-an-email',
      origin: 'https://courtcontext.com',
      inFlight: { current: false },
      resetPasswordForEmail,
    });
    expect(result.status).toBe('invalid_email');
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('calls reset with a safe callback redirect', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    const result = await requestPasswordReset({
      email: ' Fan@Example.com ',
      origin: 'https://courtcontext.com',
      inFlight: { current: false },
      resetPasswordForEmail,
    });
    expect(result).toEqual({ status: 'success', message: RESET_SUCCESS_MESSAGE });
    expect(resetPasswordForEmail).toHaveBeenCalledWith('Fan@Example.com', {
      redirectTo: recoveryRedirectUrl('https://courtcontext.com'),
    });
    expect(recoveryRedirectUrl('http://localhost:3000')).toBe(
      'http://localhost:3000/auth/callback?next=%2Fupdate-password'
    );
    expect(recoveryRedirectUrl('https://courtcontext.com')).not.toContain('localhost');
  });

  it('uses the same success copy when the account is missing', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({
      error: { message: 'User not found' },
    });
    const result = await requestPasswordReset({
      email: 'missing@example.com',
      origin: 'https://courtcontext.com',
      inFlight: { current: false },
      resetPasswordForEmail,
    });
    expect(result).toEqual({ status: 'success', message: RESET_SUCCESS_MESSAGE });
    expect(JSON.stringify(result)).not.toMatch(/not found|does not exist/i);
  });

  it('handles a provider failure without echoing the raw error', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({
      error: { message: 'smtp token leaked' },
    });
    const result = await requestPasswordReset({
      email: 'fan@example.com',
      origin: 'https://courtcontext.com',
      inFlight: { current: false },
      resetPasswordForEmail,
    });
    expect(result).toEqual({ status: 'error', message: RESET_PROVIDER_ERROR });
    expect(JSON.stringify(result)).not.toMatch(/smtp|token/);
  });

  it('ignores a second submit while the first is in flight', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resetPasswordForEmail = vi.fn(() => gate.then(() => ({ error: null })));
    const inFlight = { current: false };
    const first = requestPasswordReset({
      email: 'fan@example.com',
      origin: 'https://courtcontext.com',
      inFlight,
      resetPasswordForEmail,
    });
    const second = await requestPasswordReset({
      email: 'fan@example.com',
      origin: 'https://courtcontext.com',
      inFlight,
      resetPasswordForEmail,
    });
    expect(second.status).toBe('ignored');
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    release?.();
    await first;
  });
});

describe('updateRecoveredPassword', () => {
  it('rejects a mismatch and does not call Supabase', async () => {
    const updateUser = vi.fn();
    const result = await updateRecoveredPassword({
      password: 'abcdef',
      confirm: 'abcdeg',
      updateUser,
    });
    expect(result).toEqual({ status: 'invalid', message: PASSWORD_MISMATCH_ERROR });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('rejects a short password', async () => {
    const result = await updateRecoveredPassword({
      password: 'abc',
      confirm: 'abc',
      updateUser: vi.fn(),
    });
    expect(result).toEqual({ status: 'invalid', message: PASSWORD_TOO_SHORT_ERROR });
  });

  it('updates the password when the pair matches', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const result = await updateRecoveredPassword({
      password: 'new-pass',
      confirm: 'new-pass',
      updateUser,
    });
    expect(result.status).toBe('success');
    expect(updateUser).toHaveBeenCalledWith({ password: 'new-pass' });
  });

  it('hides provider failures', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: { message: 'recovery token abc' } });
    const result = await updateRecoveredPassword({
      password: 'new-pass',
      confirm: 'new-pass',
      updateUser,
    });
    expect(result).toEqual({ status: 'error', message: PASSWORD_UPDATE_ERROR });
    expect(JSON.stringify(result)).not.toMatch(/token/);
  });
});

describe('recoveryPresence', () => {
  it('treats a missing user as an unusable recovery session', () => {
    expect(recoveryPresence(null)).toBe('missing');
    expect(recoveryPresence('user-1')).toBe('ready');
  });
});
