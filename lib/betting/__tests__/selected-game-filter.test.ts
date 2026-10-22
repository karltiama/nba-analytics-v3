import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SelectedGameFilter } from '@/components/betting/SelectedGameFilter';
import { clearSelectedGameUpdates, selectedGameDateLabel } from '@/lib/betting/selected-game-filter';

describe('selected game filter', () => {
  it('clears only the game id and keeps the date by omission', () => {
    expect(clearSelectedGameUpdates()).toEqual({ game_id: null, offset: '0' });
    expect(Object.keys(clearSelectedGameUpdates())).toEqual(['game_id', 'offset']);
  });

  it('formats the slate date as a calendar label', () => {
    expect(selectedGameDateLabel('2026-10-21')).toBe('October 21, 2026');
  });

  it('shows the matchup and a touch-sized remove control', () => {
    const onClear = vi.fn();
    const html = renderToStaticMarkup(
      createElement(SelectedGameFilter, { matchup: 'ATL @ ORL', date: '2026-10-21', onClear })
    );
    expect(html).toContain('data-selected-game');
    expect(html).toContain('Selected Game');
    expect(html).toContain('ATL @ ORL');
    expect(html).toContain('October 21, 2026');
    expect(html).toContain('aria-label="Remove game filter"');
    expect(html).toContain('min-h-11');
    expect(html).toContain('truncate');
  });
});
