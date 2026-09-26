import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('typography phase 2 desktop props explorer', () => {
  const page = read('app/betting/props-explorer/page.tsx');
  const tray = read('components/betting/PropsExplorerParlayTray.tsx');
  const context = read('components/betting/PropsExplorerGameContextPanel.tsx');
  const mobile = read('components/betting/PropsExplorerMobileControls.tsx');
  const list = read('components/betting/PropsExplorerPropList.tsx');
  const sheet = read('components/betting/PropsExplorerPropDetailSheet.tsx');
  const actions = read('components/betting/PropsExplorerDesktopActions.tsx');

  it('uses the page title role and semantic table data', () => {
    expect(page).toContain('type-page-title');
    expect(page).toContain('type-table-data');
    expect(page).toContain('type-metadata');
    expect(page).toContain('type-badge');
    expect(page).toContain('type-interactive');
    expect(page).toContain('explorerCardPlayerName');
    expect(page).toContain('explorerCardValueLabel');
    expect(page).not.toContain('formatPlayerLabel');
  });

  it('keeps the desktop table and filters behind the lg boundary', () => {
    expect(page).toContain('hidden lg:block');
    expect(page).toContain('lg:hidden min-w-0');
    expect(page).toContain('py-1.5 px-2');
    expect(page).not.toContain('text-[9px]');
    expect(page).not.toContain('text-[10px]');
    expect(page).not.toContain('text-[11px]');
    expect(page).not.toContain('#8aa0a3');
    expect(page).not.toContain('#72869A');
  });

  it('raises the desktop tray and injury context off 9–11px muted ink', () => {
    expect(tray).toContain('type-card-data');
    expect(tray).toContain('type-interactive');
    expect(tray).toContain('aria-label="Clear parlay"');
    expect(tray).toContain('Open Workspace');
    expect(context).toContain('type-section-heading');
    expect(context).toContain('type-badge');
    expect(context).toContain('type-table-data');
    expect(context).not.toContain('text-[9px]');
    expect(context).not.toContain('text-[10px]');
    expect(context).not.toContain('#8aa0a3');
    expect(context).not.toContain('#72869A');
    expect(tray).not.toContain('#8aa0a3');
    expect(tray).not.toContain('text-[10px]');
  });

  it('leaves the dense mobile list and filter contracts in place', () => {
    expect(mobile).toContain('data-mobile-toolbar');
    expect(mobile).toContain('data-filter-sheet');
    expect(mobile).toContain('sticky top-16');
    expect(mobile).toContain('lg:hidden');
    expect(list).toContain('data-prop-row');
    expect(list).toContain('type-table-data');
    expect(list).toContain('min-h-[4.5rem]');
    expect(list).toContain('max-h-[5.625rem]');
    expect(list).not.toContain('rounded-2xl');
    expect(sheet).toContain('data-prop-detail-sheet');
    expect(sheet).toContain('type-table-data');
    expect(actions).toContain('aria-label="More actions"');
    expect(actions).toContain('+ Parlay');
    expect(page).not.toContain('PropsExplorerPropCard');
    expect(tray).toContain('mobileParlayBarCopy');
    expect(tray).toContain('lg:hidden');
    expect(page).toContain('schedulePlayerSearch');
    expect(page).toContain('PLAYER_SEARCH_USED');
    expect(page).toContain('PROP_ADDED_TO_PARLAY');
  });
});
