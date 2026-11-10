import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';
import { PARLAY_WORKSPACE_HREF } from '@/lib/parlay/selection';

const header = readFileSync(join(__dirname, '../Header.tsx'), 'utf8');

describe('authenticated primary navigation', () => {
  const labels = PRIMARY_NAV.map((item) => item.label);
  const hrefs = PRIMARY_NAV.map((item) => item.href);

  it('uses the approved nine-destination order', () => {
    expect(labels).toEqual([
      'Dashboard',
      'Props Explorer',
      'Parlay Workspace',
      'Parlay XRay',
      'WOWY',
      'Teams',
      'Saved',
      'Paper',
      'Profile',
    ]);
    expect(hrefs).toEqual([
      '/dashboard',
      '/betting/props-explorer',
      PARLAY_WORKSPACE_HREF,
      '/parlay-xray',
      '/wowy',
      '/teams',
      '/betting/saved',
      '/betting/paper',
      '/betting/profile',
    ]);
  });

  it('keeps one unconditional Parlay Workspace entry', () => {
    expect(PRIMARY_NAV.filter((item) => item.label === 'Parlay Workspace')).toHaveLength(1);
    expect(PRIMARY_NAV.filter((item) => item.href === PARLAY_WORKSPACE_HREF)).toHaveLength(1);
    expect(labels.indexOf('Parlay Workspace')).toBe(labels.indexOf('Props Explorer') + 1);
    expect(labels.indexOf('Parlay XRay')).toBe(labels.indexOf('Parlay Workspace') + 1);
    expect(header.match(/PRIMARY_NAV\.map/g)).toHaveLength(2);
    expect(header).not.toMatch(/ContextualParlayNav|variant="mobile-badge"|Parlay ·/);
    expect(header).not.toMatch(/if \(!label\) return null/);
    expect(header).not.toMatch(/replaceParlaySelectionLegs|clearSelectedLegs|addExplorerOfferToSelection/);
  });

  it('highlights the active route and keeps the mobile menu', () => {
    expect(header).toMatch(/aria-current=\{active \? 'page' : undefined\}/);
    expect(header).toMatch(/aria-label="Primary"/);
    expect(header).toMatch(/aria-label="Open primary navigation"/);
    expect(header).toMatch(/hidden lg:flex/);
    expect(header).toMatch(/lg:hidden/);
    expect(header).toMatch(/selectedLegCount/);
  });
});
