import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdminPage, listPreseasonDrafts, readPreseasonDraft, readFile, redirect, notFound } =
  vi.hoisted(() => ({
    requireAdminPage: vi.fn(),
    listPreseasonDrafts: vi.fn(),
    readPreseasonDraft: vi.fn(),
    readFile: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    notFound: vi.fn(() => {
      throw new Error('NOT_FOUND');
    }),
  }));

vi.mock('@/lib/auth/require-admin', () => ({
  requireAdminPage: (...args: unknown[]) => requireAdminPage(...args),
}));

vi.mock('@/lib/teams/preseason-preview/automation/storage', () => ({
  listPreseasonDrafts: (...args: unknown[]) => listPreseasonDrafts(...args),
  readPreseasonDraft: (...args: unknown[]) => readPreseasonDraft(...args),
  draftPath: () => 'draft.json',
  packetPath: () => 'packet.json',
}));

vi.mock('fs', () => ({
  promises: {
    readFile: (...args: unknown[]) => readFile(...args),
  },
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  notFound: () => notFound(),
}));

import PreseasonContentAdminPage from '@/app/admin/content/preseason/page';
import PreseasonDraftDetailPage from '@/app/admin/content/preseason/[slug]/page';

function propsOf(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object' || !('props' in node)) {
    throw new Error('expected a React element');
  }
  return (node as { props: Record<string, unknown> }).props;
}

const draft = {
  team: { name: 'Boston Celtics' },
  review: { status: 'pending', warnings: [] as string[] },
  contextSignals: {},
  headline: 'Headline',
  dek: 'Dek',
  bigPicture: '',
  playersToWatch: [],
  roleWatch: [],
  keyQuestions: [],
  outlook: '',
  snapshot: {},
  rosterChanges: {},
  projectedRotation: {},
  sourceSummary: '',
};

describe('preseason admin pages', () => {
  beforeEach(() => {
    requireAdminPage.mockReset();
    listPreseasonDrafts.mockReset();
    readPreseasonDraft.mockReset();
    readFile.mockReset();
    redirect.mockClear();
    notFound.mockClear();
    listPreseasonDrafts.mockImplementation(() => {
      throw new Error('draft index read before auth');
    });
    readPreseasonDraft.mockImplementation(() => {
      throw new Error('draft read before auth');
    });
    readFile.mockImplementation(() => {
      throw new Error('packet read before auth');
    });
  });

  it('redirects a signed-out user before listing drafts', async () => {
    requireAdminPage.mockResolvedValue({ ok: false, reason: 'unauthenticated', email: null });
    await expect(PreseasonContentAdminPage()).rejects.toThrow(
      'REDIRECT:/login?next=%2Fadmin%2Fcontent%2Fpreseason'
    );
    expect(listPreseasonDrafts).not.toHaveBeenCalled();
  });

  it('blocks a signed-in non-admin before listing drafts', async () => {
    requireAdminPage.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      email: 'other@example.com',
    });
    const page = await PreseasonContentAdminPage();
    expect(propsOf(page)).toMatchObject({ reason: 'forbidden', email: 'other@example.com' });
    expect(listPreseasonDrafts).not.toHaveBeenCalled();
  });

  it('blocks an empty allowlist before listing drafts', async () => {
    requireAdminPage.mockResolvedValue({
      ok: false,
      reason: 'allowlist_empty',
      email: 'owner@example.com',
    });
    const page = await PreseasonContentAdminPage();
    expect(propsOf(page).reason).toBe('allowlist_empty');
    expect(listPreseasonDrafts).not.toHaveBeenCalled();
  });

  it('lists drafts only after an admin is admitted', async () => {
    requireAdminPage.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      email: 'owner@example.com',
    });
    listPreseasonDrafts.mockResolvedValue([]);
    await PreseasonContentAdminPage();
    expect(listPreseasonDrafts).toHaveBeenCalledTimes(1);
    expect(listPreseasonDrafts).toHaveBeenCalledWith('2026');
  });

  it('redirects a signed-out detail request before reading the draft or packet', async () => {
    requireAdminPage.mockResolvedValue({ ok: false, reason: 'unauthenticated', email: null });
    await expect(
      PreseasonDraftDetailPage({ params: Promise.resolve({ slug: 'bos' }) })
    ).rejects.toThrow('REDIRECT:/login?next=%2Fadmin%2Fcontent%2Fpreseason%2FBOS');
    expect(readPreseasonDraft).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('blocks a non-admin detail request before reading the draft or packet', async () => {
    requireAdminPage.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      email: 'other@example.com',
    });
    const page = await PreseasonDraftDetailPage({ params: Promise.resolve({ slug: 'bos' }) });
    expect(propsOf(page).reason).toBe('forbidden');
    expect(readPreseasonDraft).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('reads a draft only after an admin is admitted', async () => {
    requireAdminPage.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      email: 'owner@example.com',
    });
    readPreseasonDraft.mockResolvedValue(draft);
    readFile.mockRejectedValue(new Error('missing packet'));
    await PreseasonDraftDetailPage({ params: Promise.resolve({ slug: 'bos' }) });
    expect(readPreseasonDraft).toHaveBeenCalledWith('2026', 'BOS');
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
