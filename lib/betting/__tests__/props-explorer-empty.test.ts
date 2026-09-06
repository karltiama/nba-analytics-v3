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
});
