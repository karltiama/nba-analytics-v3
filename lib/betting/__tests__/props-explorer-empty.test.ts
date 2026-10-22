import { describe, expect, it } from 'vitest';
import { propsExplorerEmptyCopy } from '../props-explorer-empty';

describe('propsExplorerEmptyCopy', () => {
  it('explains missing props for the selected date under freeze', () => {
    const copy = propsExplorerEmptyCopy({ frozen: true, dateLabel: 'Today' });
    expect(copy.title).toMatch(/No prop data is available for Today/);
    expect(copy.detail).toMatch(/not currently being refreshed/i);
    expect(copy.detail).not.toMatch(/failed to load/i);
    expect(copy.detail).not.toMatch(/Adjust filters/i);
  });

  it('does not imply a load failure when simply empty', () => {
    const copy = propsExplorerEmptyCopy({ frozen: false, dateLabel: 'Sep 6' });
    expect(copy.title).toMatch(/No prop data is available for Sep 6/);
    expect(copy.detail).toMatch(/no player-prop rows/i);
  });

  it('labels a historical empty date as missing archived closing lines, not a live board', () => {
    const copy = propsExplorerEmptyCopy({
      frozen: true,
      dateLabel: 'May 6',
      marketContext: 'historical',
    });
    expect(copy.title).toMatch(/No prop data is available for May 6/);
    expect(copy.detail).toMatch(/archived closing lines/i);
    expect(copy.detail).toMatch(/not a live sportsbook board/i);
    expect(copy.detail).toMatch(/do not pull lines from another date/i);
    expect(copy.detail).not.toMatch(/currently being refreshed/i);
  });

  it('explains a selected game with no stored observations without implying a load failure', () => {
    const live = propsExplorerEmptyCopy({
      frozen: false,
      dateLabel: 'Oct 21',
      marketContext: 'live',
      gameSelected: true,
    });
    expect(live.title).toBe('No stored prop observations for this game.');
    expect(live.detail).toMatch(/already collected/i);
    expect(live.detail).toMatch(/does not request a new price/i);
    expect(live.detail).not.toMatch(/failed to load/i);

    const past = propsExplorerEmptyCopy({
      frozen: false,
      dateLabel: 'Oct 20',
      marketContext: 'historical',
      gameSelected: true,
    });
    expect(past.title).toBe('No stored prop observations for this game.');
    expect(past.detail).toMatch(/archived closing lines/i);
    expect(past.detail).toMatch(/not a live sportsbook board/i);
  });

  it('names an unknown game id instead of borrowing another game', () => {
    const copy = propsExplorerEmptyCopy({
      frozen: false,
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
