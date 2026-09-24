import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';
import { shouldShowLayoutHeader } from '@/components/betting/betting-shell-paths';

const ROOT = join(__dirname, '../../../');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('Parlay Workspace page contract', () => {
  const view = read('components/parlay-workspace/ParlayWorkspaceView.tsx');
  const client = read('app/parlay-workspace/ParlayWorkspaceClient.tsx');
  const page = read('app/parlay-workspace/page.tsx');
  const layout = read('app/parlay-workspace/layout.tsx');
  const tray = read('components/betting/PropsExplorerParlayTray.tsx');
  const store = read('lib/parlay/selection-store.ts');
  const hook = read('lib/parlay/use-parlay-selection.ts');

  it('is routed at /parlay-workspace with Court Context shell and no primary-nav item', () => {
    expect(shouldShowLayoutHeader('/parlay-workspace')).toBe(true);
    expect(layout).toMatch(/BettingAppShell/);
    expect(page).toMatch(/ParlayWorkspaceEntry/);
    expect(read('app/parlay-workspace/ParlayWorkspaceEntry.tsx')).toMatch(/ParlayWorkspaceClient/);
    expect(read('app/parlay-workspace/ParlayWorkspaceEntry.tsx')).toMatch(/ParlayWorkspacePreviewClient/);
    expect(PRIMARY_NAV.some((item) => item.href === '/parlay-workspace')).toBe(false);
    expect(PRIMARY_NAV.some((item) => item.href.includes('parlay-explorer'))).toBe(false);
  });

  it('renders empty and selected-leg review without duplicating discovery', () => {
    expect(view).toMatch(/Parlay Workspace/);
    expect(view).toMatch(/Organize, review, and refine your parlay with data-driven context/);
    expect(view).toMatch(/Your Parlay Legs/);
    expect(view).toMatch(/Key signals/);
    expect(view).toMatch(/Main risks/);
    expect(view).toMatch(/View Context/);
    expect(view).toMatch(/Your parlay is empty/);
    expect(view).toMatch(/Add legs from Props Explorer/);
    expect(view).toMatch(/Import with XRay/);
    expect(view).toMatch(/Explore Props/);
    expect(view).toMatch(/Add More Props/);
    expect(view).toMatch(/Clear Parlay/);
    expect(view).toMatch(/Edit Parlay/);
    expect(view).toMatch(/Building Court Context analysis/);
    expect(view).toMatch(/snapshotDisplayLabel/);
    expect(view).toMatch(/Analyze with Court Context/);
    expect(view).not.toMatch(/XrayResultsPanel/);
    expect(view).not.toMatch(/Why this parlay could fail/);
    expect(view).not.toMatch(/Legs needing review/);
    expect(view).not.toMatch(/Supporting parlay context/);
    expect(read('lib/parlay/workspace-analysis.ts')).toMatch(
      /Historical Court Context analysis currently supports parlays from one game/
    );
    expect(read('lib/parlay/workspace-analysis.ts')).toMatch(
      /Current-season Court Context analysis is not enabled yet/
    );
    expect(view).not.toMatch(/All games \(|player_name|min_ev|updateParams/);
    expect(view).not.toMatch(/MarketMovement|3-Hour|3_hour_pre_tip/);
    expect(view).not.toMatch(/correlat/i);
  });

  it('hands off through the in-memory store without persistence or providers', () => {
    expect(client).toMatch(/useParlaySelection/);
    expect(hook).toMatch(/useSyncExternalStore/);
    expect(hook).toMatch(/addExplorerOfferToSelection/);
    expect(store).toMatch(/Survives client-side App Router navigations/);
    expect(store).not.toMatch(/localStorage\.|sessionStorage\.|document\.cookie/);
    expect(read('lib/parlay/adapt-xray-confirmed.ts')).not.toMatch(/localStorage|sessionStorage/);
    expect(view).not.toMatch(/localStorage|sessionStorage/);
    expect(client).toMatch(/onAnalyze/);
    expect(client).toMatch(/useEffect/);
    expect(client).toMatch(/runAnalyze/);
    expect(client).not.toMatch(/fetch\(|openai|balldontlie/i);
    expect(view).not.toMatch(/fetch\(|openai|balldontlie|interpretXray|assembleContext/i);
    expect(tray).toMatch(/Open Workspace/);
    expect(tray).toMatch(/Review Parlay/);
    expect(tray).not.toMatch(/View Parlay/);
    expect(view).toMatch(/workspaceSourceLabel/);
    expect(view).toMatch(/Screenshot read/);
    expect(view).toMatch(/Edited after import/);
    expect(read('lib/parlay/selection.ts')).toMatch(/Imported from Parlay XRay/);
    expect(read('lib/parlay/selection.ts')).toMatch(/Built from Props Explorer/);
  });
});
