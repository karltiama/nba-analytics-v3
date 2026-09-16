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
    const explorer = readFileSync(join(ROOT, 'app/wowy/WowyExplorer.tsx'), 'utf8');
    const results = readFileSync(join(ROOT, 'app/wowy/WowyResults.tsx'), 'utf8');
    const src = `${explorer}\n${results}`;
    expect(src).toMatch(/Game-level WOWY/);
    expect(src).toMatch(/When /);
    expect(src).toMatch(/not shared-court possessions/);
    expect(src).not.toMatch(/being out causes/);
    expect(src).not.toMatch(/currently injured/);
    expect(src).not.toMatch(/in the box/);
    expect(results).toMatch(/Not labeled as injury/);
    expect(results).toMatch(/Key metric comparison/);
    expect(results).toMatch(/Insights/);
    expect(results).toMatch(/Top 5 lineup combinations/);
    expect(results).toMatch(/Insufficient sample/);
    expect(explorer).toMatch(/verified DNP/);
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

  it('allows a player-only query with no teammate', () => {
    const self = parseWowyPairQuery(
      new URLSearchParams({
        subjectPlayerId: '246',
        season: '2024',
        teamId: '8',
        seasonType: 'regular',
      })
    );
    expect(self.ok).toBe(true);
    if (self.ok) expect(self.query.teammatePlayerId).toBeNull();
  });

  it('rejects an explicit teammate equal to the subject', () => {
    const same = parseWowyPairQuery(
      new URLSearchParams({
        subjectPlayerId: '246',
        teammatePlayerId: '246',
        season: '2024',
        teamId: '8',
        seasonType: 'regular',
      })
    );
    expect(same.ok).toBe(false);
    if (!same.ok) {
      expect(same.code).toBe('same_player');
      expect(same.error).toMatch(/different players/i);
    }
  });
});
