import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';

const ROOT = join(__dirname, '../../../');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('Props Explorer Add to Parlay page contract', () => {
  const page = read('app/betting/props-explorer/page.tsx');
  const tray = read('components/betting/PropsExplorerParlayTray.tsx');
  const selection = read('lib/parlay/selection.ts');
  const adapter = read('lib/parlay/adapt-props-explorer-offer.ts');

  it('keeps Save, Compare, and Paper actions', () => {
    expect(page).toMatch(/isSaved \? 'Saved' : 'Save'/);
    expect(page).toMatch(/>Compare</);
    expect(page).toMatch(/title="Compare books"/);
    expect(page).toMatch(/addToPaper/);
    expect(page).toMatch(/title=\{[\s\S]*Add to paper bets/);
    expect(page).toMatch(/setSelectedMarket/);
    expect(page).toMatch(/PropsExplorerMarketPanel/);
  });

  it('adds a local Add to Parlay action through the certified E1 adapter', () => {
    expect(page).toMatch(/rowToParlayOfferInput/);
    expect(page).toMatch(/addExplorerOffer/);
    expect(page).toMatch(/useParlaySelection/);
    expect(page).toMatch(/Add to Parlay/);
    expect(page).toMatch(/\+ Parlay/);
    expect(page).toMatch(/isOnParlay \? 'Added' : '\+ Parlay'/);
    expect(selection).toMatch(/adaptPropsExplorerOffer\(input\)/);
    expect(adapter).toMatch(/export function adaptPropsExplorerOffer/);
    expect(read('lib/parlay/use-parlay-selection.ts')).toMatch(/addExplorerOfferToSelection/);
  });

  it('does not add Workspace to primary nav or connect analysis', () => {
    expect(page).not.toMatch(/\/parlay-explorer/);
    expect(tray).not.toMatch(/\/parlay-explorer/);
    expect(tray).not.toMatch(/Analyze/);
    expect(page).not.toMatch(/Analyze Parlay/);
    expect(page).not.toMatch(/Why This Could Fail/);
    expect(page).not.toMatch(/localStorage/);
    expect(tray).not.toMatch(/localStorage/);
    expect(selection).not.toMatch(/localStorage/);
    expect(PRIMARY_NAV.some((item) => item.href.includes('parlay-workspace'))).toBe(false);
    expect(PRIMARY_NAV.some((item) => item.href.includes('parlay-explorer'))).toBe(false);
  });

  it('does not trigger analysis or provider calls when adding a leg', () => {
    expect(page).toMatch(/const addToParlay = useCallback\(\(r: ExplorerRow\) => \{/);
    expect(page).not.toMatch(/addToParlay[\s\S]{0,400}fetch\(/);
    expect(selection).not.toMatch(/interpretXrayLeg|assembleContext|detectStructuralDependencies/);
    expect(selection).not.toMatch(/openai|balldontlie|umami/i);
    expect(tray).not.toMatch(/openai|balldontlie|umami|correlat/i);
    expect(page).not.toMatch(/openai|balldontlie/i);
  });

  it('makes the mobile tray CTA Review Parlay into Workspace, and keeps desktop Open Workspace', () => {
    expect(tray).toMatch(/Review Parlay/);
    expect(tray).toMatch(/Open Workspace/);
    expect(tray).toMatch(/PARLAY_WORKSPACE_HREF/);
    expect(tray).not.toMatch(/View Parlay/);
    expect(tray).not.toMatch(/role="dialog"/);
    expect(tray).toMatch(/aria-label="Clear parlay"/);
    expect(tray).toMatch(/Remove .* from parlay/);
    expect(tray).not.toMatch(/Analyze/);
    expect(page).not.toMatch(/setParlayDrawerOpen|parlayDrawerOpen/);
  });

  it('does not move Market Movement into the tray or select 3-Hour', () => {
    expect(tray).not.toMatch(/3-Hour|MarketMovement|3_hour_pre_tip/);
    expect(page).not.toMatch(/threeHourLine/);
    expect(selection).toMatch(/adaptPropsExplorerOffer/);
    expect(page).toMatch(/marketContext: r\.marketContext/);
    expect(page).toMatch(/sourceTable: r\.sourceTable/);
  });
});
