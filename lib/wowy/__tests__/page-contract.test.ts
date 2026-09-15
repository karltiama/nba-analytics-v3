import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldShowLayoutHeader } from '@/components/betting/betting-shell-paths';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';
import { parseWowyPairQuery } from '../parse-query';

const ROOT = join(__dirname, '../../../');

describe('WOWY page contract', () => {
  it('is routed at /wowy with Court Context shell', () => {
    expect(shouldShowLayoutHeader('/wowy')).toBe(true);
    expect(PRIMARY_NAV.some((n) => n.href === '/wowy' && n.label === 'WOWY')).toBe(true);
    const layout = readFileSync(join(ROOT, 'app/wowy/layout.tsx'), 'utf8');
    expect(layout).toMatch(/BettingAppShell/);
  });

  it('uses game-level wording and avoids causal / injury claims', () => {
    const src = readFileSync(join(ROOT, 'app/wowy/WowyExplorer.tsx'), 'utf8');
    expect(src).toMatch(/Game-level WOWY/);
    expect(src).toMatch(/In these games,/);
    expect(src).toMatch(/not shared-court possessions/);
    expect(src).not.toMatch(/being out causes/);
    expect(src).not.toMatch(/currently injured/);
    expect(src).toMatch(/Not labeled as injury/);
  });

  it('parses required pair query fields and rejects a missing team stint', () => {
    const ok = parseWowyPairQuery(
      new URLSearchParams({
        subjectPlayerId: '246',
        teammatePlayerId: '335',
        season: '2024',
        teamId: '8',
        seasonType: 'regular',
      })
    );
    expect(ok.ok).toBe(true);
    const missingTeam = parseWowyPairQuery(
      new URLSearchParams({
        subjectPlayerId: '246',
        teammatePlayerId: '335',
        season: '2024',
      })
    );
    expect(missingTeam.ok).toBe(false);
  });
});
