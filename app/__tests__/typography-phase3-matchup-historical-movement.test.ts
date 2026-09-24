import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('typography phase 3 matchup historical movement', () => {
  const matchup = read('components/betting/MatchupPageLayout.tsx');
  const analysis = read('components/betting/MatchupAnalysis.tsx');
  const box = read('components/betting/HistoricalFinalBoxScore.tsx');
  const advanced = read('components/betting/HistoricalFinalAdvancedStats.tsx');
  const timeline = read('components/betting/HistoricalFinalTimeline.tsx');
  const role = read('components/betting/HistoricalFinalRoleProfile.tsx');
  const starters = read('components/betting/HistoricalStartingFive.tsx');
  const movement = read('components/betting/market-movement/MarketMovementSection.tsx');

  it('gives matchup groups and prop tables semantic roles', () => {
    expect(matchup).toContain('type-section-heading');
    expect(matchup).toContain('type-table-data');
    expect(matchup).toContain('type-badge');
    expect(matchup).toContain('Player props');
    expect(matchup).not.toContain('text-[9px]');
    expect(matchup).not.toContain('text-[10px]');
    expect(matchup).not.toContain('#8aa0a3');
    expect(matchup).not.toContain('#72869A');
  });

  it('keeps injury status and analysis copy on readable roles', () => {
    expect(matchup).toContain('injury.status');
    expect(analysis).toContain('type-section-heading');
    expect(analysis).toContain('type-card-data');
    expect(analysis).toContain('type-badge');
    expect(analysis).not.toContain('text-[9px]');
    expect(analysis).not.toContain('text-[10px]');
    expect(analysis).not.toContain('#8aa0a3');
  });

  it('uses table and interactive roles on historical surfaces', () => {
    expect(box).toContain('type-table-data');
    expect(box).toContain('type-metadata');
    expect(box).toContain('type-interactive');
    expect(advanced).toContain('type-table-data');
    expect(advanced).toContain('More');
    expect(timeline).toContain('type-interactive');
    expect(timeline).toContain('Key Events');
    expect(timeline).toContain('Full Play-by-Play');
    expect(role).toContain('type-card-data');
    expect(role).toContain('HISTORICAL_PLAYER_OPENED');
    expect(starters).toContain('type-table-data');
    for (const source of [box, advanced, timeline, role, starters]) {
      expect(source).not.toContain('text-[9px]');
      expect(source).not.toContain('text-[10px]');
    }
  });

  it('uses card data and metadata on Market Movement without renaming events', () => {
    expect(movement).toContain('type-card-data');
    expect(movement).toContain('type-metadata');
    expect(movement).toContain('type-section-heading');
    expect(movement).toContain('explorerBookDisplayName');
    expect(movement).toContain('MARKET_MOVEMENT_VIEWED');
    expect(movement).toContain('MARKET_MOVEMENT_UPGRADE_CLICKED');
    expect(movement).not.toContain('text-[11px]');
    expect(movement).not.toContain('uppercase');
    expect(movement).not.toContain('#8aa0a3');
  });
});
