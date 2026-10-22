import { describe, expect, it } from 'vitest';
import { propsExplorerEmptyCopy } from '../props-explorer-empty';

describe('propsExplorerEmptyCopy', () => {
  it('does not call an empty date an offseason freeze', () => {
    const copy = propsExplorerEmptyCopy({
      dateLabel: 'Oct 22',
      marketContext: 'live',
    });
    expect(copy.title).toBe('No stored prop observations for this date yet.');
    expect(copy.detail).toMatch(/Oct 22/);
    expect(copy.detail).not.toMatch(/offseason/i);
    expect(copy.detail).not.toMatch(/freeze/i);
    expect(copy.detail).not.toMatch(/failed to load/i);
  });

  it('labels a historical empty date as stored observations, not a live board', () => {
    const copy = propsExplorerEmptyCopy({
      dateLabel: 'May 6',
      marketContext: 'historical',
    });
    expect(copy.title).toBe('No stored prop observations for this date yet.');
    expect(copy.detail).toMatch(/May 6/);
    expect(copy.detail).toMatch(/not a live sportsbook board/i);
    expect(copy.detail).not.toMatch(/offseason/i);
    expect(copy.detail).not.toMatch(/freeze/i);
  });

  it('explains a selected game with no stored observations without implying a load failure', () => {
    const live = propsExplorerEmptyCopy({
      dateLabel: 'Oct 21',
      marketContext: 'live',
      gameSelected: true,
    });
    expect(live.title).toBe('No stored prop observations for this game yet.');
    expect(live.detail).toMatch(/already collected/i);
    expect(live.detail).toMatch(/does not request a new price/i);
    expect(live.detail).not.toMatch(/failed to load/i);
    expect(live.detail).not.toMatch(/offseason/i);

    const past = propsExplorerEmptyCopy({
      dateLabel: 'Oct 20',
      marketContext: 'historical',
      gameSelected: true,
    });
    expect(past.title).toBe('No stored prop observations for this game yet.');
    expect(past.detail).toMatch(/not a live sportsbook board/i);
    expect(past.detail).not.toMatch(/freeze/i);
  });

  it('names an unknown game id instead of borrowing another game', () => {
    const copy = propsExplorerEmptyCopy({
      dateLabel: 'Oct 21',
      marketContext: 'live',
      gameSelected: true,
      gameUnknown: true,
    });
    expect(copy.title).toBe('This game was not found.');
    expect(copy.detail).toMatch(/not on the schedule/i);
    expect(copy.detail).toMatch(/other games are not shown/i);
  });
});
