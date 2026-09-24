import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('typography phase 5 player team ledgers', () => {
  const header = read('app/betting/players/[playerId]/components/PlayerHeader.tsx');
  const summary = read('app/betting/players/[playerId]/components/SummaryCardsRow.tsx');
  const gameLog = read('app/betting/players/[playerId]/components/GameLogTable.tsx');
  const tabs = read('app/betting/players/[playerId]/components/StatTabs.tsx');
  const betting = read('app/betting/players/[playerId]/components/BettingLinePanel.tsx');
  const roster = read('app/teams/[teamId]/components/TeamRoster.tsx');
  const schedule = read('app/teams/[teamId]/components/TeamCompactSchedule.tsx');
  const snapshot = read('app/teams/[teamId]/components/TeamSeasonSnapshotPanel.tsx');
  const paper = read('app/betting/paper/page.tsx');
  const saved = read('app/betting/saved/page.tsx');

  it('keeps player identity prominent and raises summary labels', () => {
    expect(header).toContain('text-2xl font-bold text-[#063f46]');
    expect(header).not.toContain('type-page-title');
    expect(header).toContain('type-metadata');
    expect(header).toContain('type-badge');
    expect(header).not.toContain('text-[10px]');
    expect(summary).toContain('text-2xl font-bold font-mono');
    expect(summary).toContain('type-metadata');
    expect(summary).not.toContain('text-[10px]');
    expect(summary).not.toContain('#8aa0a3');
  });

  it('uses table roles on the game log and keeps compact rows tighter', () => {
    expect(gameLog).toContain("compact ? 'type-table-data py-1 px-1.5' : 'type-table-data'");
    expect(gameLog).toContain("compact ? 'type-metadata h-8 px-1.5' : 'type-metadata'");
    expect(gameLog).toContain('type-interactive');
    expect(gameLog).not.toContain('text-[9px]');
    expect(gameLog).not.toContain('text-[10px]');
  });

  it('keeps profile StatTabs interactive without copying the mobile tray height', () => {
    expect(tabs).toContain("'type-interactive min-h-11 shrink-0 whitespace-nowrap px-3'");
    expect(tabs).toContain("'type-interactive px-4 py-2'");
    expect(tabs).not.toContain('text-sm font-medium');
    expect(betting).toContain('type-section-heading');
    expect(betting).toContain('type-badge');
    expect(betting).not.toContain('text-[9px]');
    expect(betting).not.toContain('text-[10px]');
  });

  it('uses readable roster, schedule, and snapshot roles', () => {
    expect(roster).toContain('type-table-data');
    expect(roster).toContain('type-secondary');
    expect(roster).toContain('type-section-heading');
    expect(roster).not.toContain('#8aa0a3');
    expect(roster).not.toContain('#72869A');
    expect(roster).not.toContain('text-[10px]');
    expect(schedule).toContain('type-table-data');
    expect(schedule).toContain('type-metadata');
    expect(schedule).toContain('type-badge');
    expect(schedule).not.toContain('text-[10px]');
    expect(snapshot).toContain('type-section-heading');
    expect(snapshot).toContain('type-card-data');
    expect(snapshot).toContain('type-metadata');
    expect(snapshot).not.toContain('text-[10px]');
  });

  it('raises paper and saved ledger actions without 9px or 10px text', () => {
    for (const source of [paper, saved]) {
      expect(source).toContain('type-page-title');
      expect(source).toContain('type-table-data');
      expect(source).toContain('type-interactive');
      expect(source).toContain('type-metadata');
      expect(source).not.toContain('text-[9px]');
      expect(source).not.toContain('text-[10px]');
      expect(source).not.toContain('#8aa0a3');
      expect(source).not.toContain('#72869A');
    }
    expect(paper).toContain('Remove');
    expect(saved).toContain('Compare');
  });
});
