/**
 * Chart-ready line movement. Missing lines stay missing; a real 0.0 sportsbook
 * line is kept. Never invent Open 0 / Now 0 to fill an empty series.
 */

export type LineMovementPoint = { time: string; value: number };

export type LineMovementSeries = {
  spreadMovement: LineMovementPoint[];
  totalMovement: LineMovementPoint[];
};

function finiteLine(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function timeLabel(index: number, length: number, snapshotAt: string): string {
  if (index === 0) return 'Open';
  if (index === length - 1) return 'Now';
  const parsed = new Date(snapshotAt);
  if (Number.isNaN(parsed.getTime())) return String(index);
  return parsed.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function seriesFromOddsHistoryRows(
  rows: { snapshot_at: string; home_spread: number | null; total: number | null }[]
): LineMovementSeries {
  const spreadMovement: LineMovementPoint[] = [];
  const totalMovement: LineMovementPoint[] = [];

  rows.forEach((row, index) => {
    const label = timeLabel(index, rows.length, row.snapshot_at);
    const spreadVal = finiteLine(row.home_spread);
    const totalVal = finiteLine(row.total);
    if (spreadVal != null) spreadMovement.push({ time: label, value: spreadVal });
    if (totalVal != null) totalMovement.push({ time: label, value: totalVal });
  });

  return { spreadMovement, totalMovement };
}

export type ResolvedLineMovementChart =
  | { kind: 'empty' }
  | { kind: 'series'; points: LineMovementPoint[] };

/**
 * Empty history stays empty. A single real snapshot is shown as a flat Open→Now
 * line using that snapshot's value (including a real 0).
 */
export function resolveLineMovementChartData(
  data: LineMovementPoint[] | null | undefined
): ResolvedLineMovementChart {
  if (!data?.length) return { kind: 'empty' };
  if (data.length === 1) {
    return {
      kind: 'series',
      points: [
        { time: 'Open', value: data[0].value },
        { time: 'Now', value: data[0].value },
      ],
    };
  }
  return { kind: 'series', points: data };
}
