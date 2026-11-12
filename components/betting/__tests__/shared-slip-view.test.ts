// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedSlipView } from '@/components/betting/SharedSlipView';
import type { PublicSharedBetSlip } from '@/lib/bet-slip/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const share: PublicSharedBetSlip = {
  shareId: 'local-fixture',
  title: 'Local fixture slip',
  source: 'props_explorer',
  snapshotVersion: 1,
  createdAt: '2026-11-12T18:00:00.000Z',
  path: '/slip/local-fixture',
  legs: [
    {
      selectionKey: 'leg-1',
      sport: 'nba',
      gameId: '21718093',
      playerId: '1',
      market: 'assists',
      side: 'over',
      line: 3.5,
      playerName: 'Jaden McDaniels',
      selectedSportsbook: 'caesars',
      selectedOdds: 124,
      selectedAt: '2026-11-12T18:00:00.000Z',
      gameLabel: 'DAL @ MIN',
    },
  ],
};

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('SharedSlipView fixture', () => {
  it('renders the shared price and does not offer a sportsbook handoff', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(SharedSlipView, { share, signedIn: true }));
    });
    const text = host.textContent ?? '';
    expect(text).toContain('Jaden McDaniels');
    expect(text).toContain('+124');
    expect(text).toContain('DAL @ MIN');
    expect(text).toContain('from when this slip was shared');
    expect(text).not.toMatch(/Send to Sportsbook/i);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
  });
});
