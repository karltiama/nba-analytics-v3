import { describe, expect, it } from 'vitest';
import { isPropsCollectionPaused, propsExplorerEmptyCopy } from '../props-explorer-empty';

describe('propsExplorerEmptyCopy', () => {
  it('names a pause only when the offseason flag is set', () => {
    expect(isPropsCollectionPaused({ OFFSEASON_MODE: '1' })).toBe(true);
    expect(isPropsCollectionPaused({})).toBe(false);
    expect(isPropsCollectionPaused({ DATA_MODE: 'replay', CRON_DRY_RUN: '1' })).toBe(false);

    const paused = propsExplorerEmptyCopy({
      collectorPaused: true,
      dateLabel: 'Today',
      marketContext: 'live',
    });
    expect(paused.title).toBe('No stored prop observations for this date yet.');
    expect(paused.detail).toMatch(/paused by the offseason freeze/i);
    expect(paused.detail).not.toMatch(/failed to load/i);
  });

  it('does not call an empty regular-season date a freeze', () => {
    const copy = propsExplorerEmptyCopy({
      collectorPaused: false,
      dateLabel: 'Oct 22',
      marketContext: 'live',
    });
    expect(copy.title).toBe('No stored prop observations for this date yet.');
    expect(copy.detail).toMatch(/Oct 22/);
    expect(copy.detail).not.toMatch(/offseason freeze/i);
    expect(copy.detail).not.toMatch(/failed to load/i);
  });

  it('labels a historical empty date as stored observations, not a live board', () => {
    const copy = propsExplorerEmptyCopy({
      collectorPaused: true,
      dateLabel: 'May 6',
      marketContext: 'historical',
    });
    expect(copy.title).toBe('No stored prop observations for this date yet.');
    expect(copy.detail).toMatch(/May 6/);
    expect(copy.detail).toMatch(/not a live sportsbook board/i);
    expect(copy.detail).not.toMatch(/offseason freeze/i);
  });

  it('explains a selected game with no stored observations without implying a load failure', () => {
    const live = propsExplorerEmptyCopy({
      collectorPaused: false,
      dateLabel: 'Oct 21',
      marketContext: 'live',
      gameSelected: true,
    });
    expect(live.title).toBe('No stored prop observations for this game yet.');
    expect(live.detail).toMatch(/already collected/i);
    expect(live.detail).toMatch(/does not request a new price/i);
    expect(live.detail).not.toMatch(/failed to load/i);
    expect(live.detail).not.toMatch(/offseason freeze/i);

    const past = propsExplorerEmptyCopy({
      collectorPaused: false,
      dateLabel: 'Oct 20',
      marketContext: 'historical',
      gameSelected: true,
    });
    expect(past.title).toBe('No stored prop observations for this game yet.');
    expect(past.detail).toMatch(/not a live sportsbook board/i);
  });

  it('names an unknown game id instead of borrowing another game', () => {
    const copy = propsExplorerEmptyCopy({
      collectorPaused: false,
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
