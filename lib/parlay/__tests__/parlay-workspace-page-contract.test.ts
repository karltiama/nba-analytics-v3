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
  const header = read('components/parlay-workspace/WorkspaceHeader.tsx');
  const legList = read('components/parlay-workspace/WorkspaceLegList.tsx');
  const read_ = read('components/parlay-workspace/WorkspaceParlayRead.tsx');
  const rail = read('components/parlay-workspace/WorkspaceTicketRail.tsx');
  const workspace = [view, header, legList, read_, rail].join('\n');
  const client = read('app/parlay-workspace/ParlayWorkspaceClient.tsx');
  const page = read('app/parlay-workspace/page.tsx');
  const layout = read('app/parlay-workspace/layout.tsx');
  const tray = read('components/betting/PropsExplorerParlayTray.tsx');
  const store = read('lib/parlay/selection-store.ts');
  const hook = read('lib/parlay/use-parlay-selection.ts');

  it('is routed at /parlay-workspace with Court Context shell and a primary-nav item', () => {
    expect(shouldShowLayoutHeader('/parlay-workspace')).toBe(true);
    expect(layout).toMatch(/BettingAppShell/);
    expect(page).toMatch(/ParlayWorkspaceEntry/);
    expect(read('app/parlay-workspace/ParlayWorkspaceEntry.tsx')).toMatch(/ParlayWorkspaceClient/);
    expect(read('app/parlay-workspace/ParlayWorkspaceEntry.tsx')).toMatch(/ParlayWorkspacePreviewClient/);
    expect(PRIMARY_NAV.some((item) => item.href === '/parlay-workspace' && item.label === 'Parlay Workspace')).toBe(true);
    expect(PRIMARY_NAV.some((item) => item.href.includes('parlay-explorer'))).toBe(false);
  });

  it('renders empty and selected-leg review without duplicating discovery', () => {
    expect(view).toMatch(/WorkspaceHeader/);
    expect(header).toMatch(/Parlay Workspace/);
    expect(header).toMatch(/text-\[#55ddb1\]">Parlay<\/span> <span className="text-\[#063f46\]">Workspace/);
    expect(header).toMatch(/Organize, review, and refine your parlay with data-driven context/);
    expect(legList).toMatch(/Your Parlay Legs/);
    expect(read_).toMatch(/Key signals/);
    expect(read_).toMatch(/Why this could fail/);
    expect(read_).toMatch(/grid-cols-2 gap-2 sm:grid-cols-4/);
    expect(legList).toMatch(/View Context/);
    expect(view).toMatch(/Your parlay is empty/);
    expect(view).toMatch(/Add legs from Props Explorer/);
    expect(view).toMatch(/Import with XRay/);
    expect(view).toMatch(/Explore Props/);
    expect(view).toMatch(/Try a Quick Build/);
    expect(legList).toMatch(/Add More Props/);
    expect(legList).toMatch(/Clear Parlay/);
    expect(view).toMatch(/Building Court Context analysis/);
    expect(view).toMatch(/Try again/);
    expect(legList).toMatch(/snapshotDisplayLabel/);
    expect(view).toMatch(/WorkspaceTicketRail/);
    expect(view).not.toMatch(/Edit Parlay|Analyze with Court Context|Saved parlays are not available yet/);
    expect(workspace).not.toMatch(/XrayResultsPanel/);
    expect(workspace).not.toMatch(/Why this parlay could fail/);
    expect(workspace).not.toMatch(/Legs needing review/);
    expect(workspace).not.toMatch(/Supporting parlay context/);
    expect(read('lib/parlay/workspace-analysis.ts')).toMatch(
      /Historical Court Context analysis currently supports parlays from one game/
    );
    expect(read('lib/parlay/workspace-analysis.ts')).toMatch(
      /Current-season Court Context analysis is not enabled yet/
    );
    expect(workspace).not.toMatch(/All games \(|player_name|min_ev|updateParams/);
    expect(workspace).not.toMatch(/MarketMovement|3-Hour|3_hour_pre_tip/);
    expect(workspace).not.toMatch(/correlat/i);
  });

  it('hands off through the in-memory store without persistence or providers', () => {
    expect(client).toMatch(/useParlaySelection/);
    expect(hook).toMatch(/useSyncExternalStore/);
    expect(hook).toMatch(/addExplorerOfferToSelection/);
    expect(store).toMatch(/Survives client-side App Router navigations/);
    expect(store).not.toMatch(/localStorage\.|sessionStorage\.|document\.cookie/);
    expect(read('lib/parlay/adapt-xray-confirmed.ts')).not.toMatch(/localStorage|sessionStorage/);
    expect(workspace).not.toMatch(/localStorage|sessionStorage/);
    expect(client).toMatch(/onAnalyze/);
    expect(client).toMatch(/useEffect/);
    expect(client).toMatch(/runAnalyze/);
    expect(client).not.toMatch(/fetch\(|openai|balldontlie/i);
    expect(workspace).not.toMatch(/fetch\(|openai|balldontlie|interpretXray|assembleContext/i);
    expect(tray).toMatch(/Open Workspace/);
    expect(tray).toMatch(/Review Parlay/);
    expect(tray).not.toMatch(/View Parlay/);
    expect(view).toMatch(/workspaceSourceLabel/);
    expect(legList).toMatch(/Screenshot read/);
    expect(header).toMatch(/Edited after import/);
    expect(read('lib/parlay/selection.ts')).toMatch(/Imported from Parlay XRay/);
    expect(read('lib/parlay/selection.ts')).toMatch(/Built from Props Explorer/);
  });
});
