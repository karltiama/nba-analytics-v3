import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adaptPropsExplorerOffer, type PropsExplorerOfferInput } from '@/lib/parlay/adapt-props-explorer-offer';
import { mobileParlayBarCopy } from '@/lib/parlay/mobile-bar-copy';
import { addExplorerOfferToSelection, emptyParlaySelection } from '@/lib/parlay/selection';
import { explorerBookDisplayName, explorerPropContextLabel } from '@/lib/betting/props-explorer-filters';

const ROOT = join(__dirname, '../../..');

const ELLISON: PropsExplorerOfferInput = {
  playerId: 1,
  playerName: 'Mara Ellison',
  gameId: 10,
  propType: 'points',
  side: 'over',
  lineValue: 27.5,
  sportsbook: 'DraftKings',
  oddsAmerican: -110,
  snapshotAt: '2026-04-02T20:00:00.000Z',
  marketContext: 'live',
  sourceTable: 'research.prop_decision_lines',
};

function legsFor(inputs: PropsExplorerOfferInput[]) {
  let legs = emptyParlaySelection();
  for (const input of inputs) {
    const result = addExplorerOfferToSelection(legs, input);
    expect(result.status).toBe('added');
    if (result.status !== 'added') throw new Error(result.status);
    legs = result.legs;
  }
  return legs;
}

describe('mobile parlay bar copy', () => {
  it('names the single selected leg and does not use that string as an analytics payload', () => {
    const adapted = adaptPropsExplorerOffer(ELLISON);
    expect(adapted.ok).toBe(true);
    expect(mobileParlayBarCopy(legsFor([ELLISON]))).toBe('Mara Ellison · Over 27.5 Points');
  });

  it('uses an aggregate line once a second leg exists', () => {
    const second: PropsExplorerOfferInput = {
      ...ELLISON,
      playerId: 2,
      playerName: 'Andre Pell',
      propType: 'rebounds',
      lineValue: 8.5,
    };
    expect(mobileParlayBarCopy(legsFor([ELLISON, second]))).toBe('2 legs selected');
  });
});

describe('compare and player display helpers', () => {
  it('normalizes known sportsbook names without changing the id', () => {
    expect(explorerBookDisplayName('fanduel')).toBe('FanDuel');
    expect(explorerBookDisplayName('draftkings')).toBe('DraftKings');
    expect(explorerBookDisplayName(null)).toBe('—');
  });

  it('repeats the selected prop from the row fields', () => {
    expect(explorerPropContextLabel('points', 'over', 27.5)).toBe('points · Over 27.5');
  });
});

describe('props explorer mobile phase 3 contract', () => {
  const page = readFileSync(join(ROOT, 'app/betting/props-explorer/page.tsx'), 'utf8');
  const tray = readFileSync(join(ROOT, 'components/betting/PropsExplorerParlayTray.tsx'), 'utf8');
  const header = readFileSync(join(ROOT, 'components/betting/Header.tsx'), 'utf8');
  const player = readFileSync(join(ROOT, 'components/betting/PropsExplorerPlayerPanel.tsx'), 'utf8');
  const market = readFileSync(join(ROOT, 'components/betting/PropsExplorerMarketPanel.tsx'), 'utf8');
  const tabs = readFileSync(
    join(ROOT, 'app/betting/players/[playerId]/components/StatTabs.tsx'),
    'utf8'
  );

  it('keeps phase 1 cards and phase 2 filters', () => {
    expect(page).toContain('lg:hidden min-w-0 space-y-3');
    expect(page).toContain('<PropsExplorerPropCard');
    expect(page).toContain('<PropsExplorerMobileControls');
    expect(page).toContain('PLAYER_SEARCH_USED');
    expect(page).toContain('PROP_ADDED_TO_PARLAY');
    expect(page).toContain('PROP_CONTEXT_OPENED');
  });

  it('shows one mobile workspace entry and a leg-specific bar', () => {
    expect(tray).toContain('lg:hidden');
    expect(tray).toContain('mobileParlayBarCopy');
    expect(tray).toContain('safe-area-inset-bottom');
    expect(tray).toContain('Review Parlay');
    expect(header).toContain('variant="mobile-badge"');
    expect(header).toContain('hideBelowLg={explorerOwnsWorkspaceEntry}');
    expect(header).toContain("pathname.startsWith('/betting/props-explorer')");
  });

  it('gives the drawers a 44px close, prop context, scrolling tabs, and safe-area padding', () => {
    expect(player).toContain('explorerPropContextLabel');
    expect(player).toContain('min-h-11 min-w-11');
    expect(player).toContain('scrollable');
    expect(player).toContain('safe-area-inset-bottom');
    expect(page).toContain('side: r.side');
    expect(tabs).toContain('overflow-x-auto');
    expect(tabs).toContain('whitespace-nowrap');
    const movement = readFileSync(
      join(ROOT, 'components/betting/market-movement/MarketMovementSection.tsx'),
      'utf8'
    );
    expect(market).toContain('explorerBookDisplayName');
    expect(movement).toContain('explorerBookDisplayName');
    expect(market).toContain('min-h-11 min-w-11');
    expect(market).toContain('safe-area-inset-bottom');
    expect(market).toContain('border-dashed');
  });
});
