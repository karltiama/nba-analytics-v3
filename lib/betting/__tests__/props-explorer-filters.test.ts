import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  explorerActiveFilterCount,
  explorerCalendarDateLabel,
  playerSearchUpdates,
  toggleSportsbookParam,
} from '@/lib/betting/props-explorer-filters';

const ROOT = join(__dirname, '../../..');

describe('explorer active filter count', () => {
  const base = {
    date: '2026-09-23',
    today: '2026-09-23',
    gameId: '',
    propType: '',
    side: 'all',
    minEv: '',
    sportsbook: '',
  };

  it('ignores defaults, search, sort, and the advanced-metrics toggle', () => {
    expect(explorerActiveFilterCount(base)).toBe(0);
  });

  it('counts each non-default sheet filter, including each sportsbook', () => {
    expect(
      explorerActiveFilterCount({
        ...base,
        date: '2026-09-22',
        gameId: '18447934',
        propType: 'points',
        side: 'over',
        minEv: '1',
        sportsbook: 'draftkings,fanduel',
      })
    ).toBe(7);
  });
});

describe('player search url updates', () => {
  it('clears the param when the draft is empty and keeps the offset reset', () => {
    expect(playerSearchUpdates('')).toEqual({ player_name: null, offset: '0' });
    expect(playerSearchUpdates('Pell')).toEqual({ player_name: 'Pell', offset: '0' });
  });

  it('toggles sportsbook ids without renaming them', () => {
    expect(toggleSportsbookParam('', 'draftkings')).toBe('draftkings');
    expect(toggleSportsbookParam('draftkings,fanduel', 'draftkings')).toBe('fanduel');
    expect(toggleSportsbookParam('fanduel', 'fanduel')).toBeNull();
  });
});

describe('mobile date presentation', () => {
  it('shows a calendar date and does not use the word Today as the date label', () => {
    const label = explorerCalendarDateLabel('2026-09-23');
    expect(label).toContain('2026');
    expect(label).not.toMatch(/Today/i);
  });
});

describe('props explorer mobile phase 2 contract', () => {
  const page = readFileSync(join(ROOT, 'app/betting/props-explorer/page.tsx'), 'utf8');
  const mobile = readFileSync(join(ROOT, 'components/betting/PropsExplorerMobileControls.tsx'), 'utf8');

  it('keeps the phase 1 card and table split', () => {
    expect(page).toContain('lg:hidden min-w-0 space-y-3');
    expect(page).toContain('<PropsExplorerPropCard');
    expect(page).toContain('hidden lg:block');
  });

  it('shows mobile controls below lg and keeps the desktop filter card', () => {
    expect(page).toContain('<PropsExplorerMobileControls');
    expect(page).toContain('hidden lg:block bg-white border border-[#DCE9EA] rounded-2xl');
    expect(mobile).toContain('lg:hidden');
    expect(mobile).toContain('data-filter-sheet');
    expect(mobile).toContain('data-coachmark="props-discover"');
    expect(page).toContain('data-coachmark="props-discover"');
  });

  it('commits search through the existing param helper and preserves analytics names', () => {
    expect(page).toContain('schedulePlayerSearch');
    expect(page).toContain('clearPlayerSearch');
    expect(page).toContain('playerSearchUpdates');
    expect(page).toContain('PLAYER_SEARCH_USED');
    expect(page).toContain('PLAYER_SEARCH_RESULT_OPENED');
    expect(mobile).toContain('Clear player search');
    expect(mobile).toContain('safe-area-inset-bottom');
    expect(mobile).not.toContain('text-[10px]');
    expect(mobile).not.toContain('#8aa0a3');
    expect(mobile).not.toContain('#72869A');
  });
});
