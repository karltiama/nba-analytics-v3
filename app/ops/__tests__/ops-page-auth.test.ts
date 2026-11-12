import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdminPage, getCachedPlatformHealth, redirect } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  getCachedPlatformHealth: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/auth/require-admin', () => ({
  requireAdminPage: (...args: unknown[]) => requireAdminPage(...args),
}));

vi.mock('@/lib/ops/platform-health', () => ({
  getCachedPlatformHealth: (...args: unknown[]) => getCachedPlatformHealth(...args),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
}));

import OpsHealthPage from '@/app/ops/page';

function propsOf(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object' || !('props' in node)) {
    throw new Error('expected a React element');
  }
  return (node as { props: Record<string, unknown> }).props;
}

describe('OpsHealthPage admin gate', () => {
  beforeEach(() => {
    requireAdminPage.mockReset();
    getCachedPlatformHealth.mockReset();
    redirect.mockClear();
    getCachedPlatformHealth.mockImplementation(() => {
      throw new Error('health read before auth');
    });
  });

  it('redirects a signed-out user before reading platform health', async () => {
    requireAdminPage.mockResolvedValue({ ok: false, reason: 'unauthenticated', email: null });
    await expect(OpsHealthPage()).rejects.toThrow('REDIRECT:/login?next=%2Fops');
    expect(getCachedPlatformHealth).not.toHaveBeenCalled();
  });

  it('shows forbidden for a signed-in non-admin and does not read health', async () => {
    requireAdminPage.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      email: 'other@example.com',
    });
    const page = await OpsHealthPage();
    expect(propsOf(page)).toMatchObject({ reason: 'forbidden', email: 'other@example.com' });
    expect(getCachedPlatformHealth).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('shows forbidden when the allowlist is empty and does not read health', async () => {
    requireAdminPage.mockResolvedValue({
      ok: false,
      reason: 'allowlist_empty',
      email: 'owner@example.com',
    });
    const page = await OpsHealthPage();
    expect(propsOf(page).reason).toBe('allowlist_empty');
    expect(getCachedPlatformHealth).not.toHaveBeenCalled();
  });

  it('reads platform health only after an admin is admitted', async () => {
    requireAdminPage.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      email: 'owner@example.com',
    });
    getCachedPlatformHealth.mockResolvedValue({ overall: 'UNKNOWN' });
    const page = await OpsHealthPage();
    expect(getCachedPlatformHealth).toHaveBeenCalledTimes(1);
    expect(propsOf(page).report).toEqual({ overall: 'UNKNOWN' });
  });

  it('renders the unavailable state when health fails after admin admission', async () => {
    requireAdminPage.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      email: 'owner@example.com',
    });
    getCachedPlatformHealth.mockRejectedValue(new Error('db down'));
    const page = await OpsHealthPage();
    expect(page).toMatchObject({ type: 'main' });
    expect(propsOf(page).report).toBeUndefined();
    expect(getCachedPlatformHealth).toHaveBeenCalledTimes(1);
  });
});
