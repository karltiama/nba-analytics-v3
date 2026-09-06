import { describe, expect, it } from 'vitest';
import {
  resolveLineMovementChartData,
  seriesFromOddsHistoryRows,
} from '../line-movement-series';

describe('seriesFromOddsHistoryRows', () => {
  it('does not coerce missing lines to 0', () => {
    const out = seriesFromOddsHistoryRows([
      { snapshot_at: '2025-04-01T00:00:00Z', home_spread: null, total: null },
      { snapshot_at: '2025-04-01T12:00:00Z', home_spread: null, total: null },
    ]);
    expect(out.spreadMovement).toEqual([]);
    expect(out.totalMovement).toEqual([]);
  });

  it('keeps a real zero sportsbook line', () => {
    const out = seriesFromOddsHistoryRows([
      { snapshot_at: '2025-04-01T00:00:00Z', home_spread: 0, total: 220 },
      { snapshot_at: '2025-04-01T12:00:00Z', home_spread: 0, total: 220.5 },
    ]);
    expect(out.spreadMovement.map((p) => p.value)).toEqual([0, 0]);
    expect(out.totalMovement.map((p) => p.value)).toEqual([220, 220.5]);
  });
});

describe('resolveLineMovementChartData', () => {
  it('empty history is empty, not Open 0 / Now 0', () => {
    expect(resolveLineMovementChartData([])).toEqual({ kind: 'empty' });
    expect(resolveLineMovementChartData(null)).toEqual({ kind: 'empty' });
  });

  it('a single real snapshot including 0 is a flat Open→Now series', () => {
    expect(resolveLineMovementChartData([{ time: 'Open', value: 0 }])).toEqual({
      kind: 'series',
      points: [
        { time: 'Open', value: 0 },
        { time: 'Now', value: 0 },
      ],
    });
  });
});
