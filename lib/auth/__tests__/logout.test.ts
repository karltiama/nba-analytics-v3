import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { LOGGED_OUT_PATH, signOutToLogin } from '@/lib/auth/logout';

describe('signOutToLogin', () => {
  it('calls signOut and returns the public login path', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    await expect(signOutToLogin(signOut)).resolves.toBe('/login');
    expect(signOut).toHaveBeenCalledOnce();
    expect(LOGGED_OUT_PATH).toBe('/login');
  });

  it('still leaves for login when signOut throws', async () => {
    const signOut = vi.fn().mockRejectedValue(new Error('network'));
    await expect(signOutToLogin(signOut)).resolves.toBe('/login');
  });

  it('header uses getUser and a full navigation after sign-out', () => {
    const src = readFileSync(join(__dirname, '../../../components/betting/Header.tsx'), 'utf8');
    expect(src).toMatch(/auth\.getUser\(/);
    expect(src).not.toMatch(/auth\.getSession\(/);
    expect(src).toMatch(/signOutToLogin/);
    expect(src).toMatch(/window\.location\.assign/);
  });
});
