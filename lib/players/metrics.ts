import type { GameLog, MetricKey, SummaryResult, HitRateResult, StreakResult } from './types';

export function extractMetric(games: GameLog[], key: MetricKey): number[] {
  return games.map((g) => {
    switch (key) {
      case 'pts':
        return g.points ?? 0;
      case 'reb':
        return g.rebounds ?? 0;
      case 'ast':
        return g.assists ?? 0;
      case '3pm':
        return g.three_pointers_made ?? 0;
      case 'pra':
        return (g.points ?? 0) + (g.rebounds ?? 0) + (g.assists ?? 0);
    }
  });
}

export function getSeasonAvgForMetric(
  seasonAvg: { avg_points?: number; avg_rebounds?: number; avg_assists?: number; total_3pm?: number; games_active?: number },
  key: MetricKey
): number {
  switch (key) {
    case 'pts':
      return Number(seasonAvg.avg_points ?? 0);
    case 'reb':
      return Number(seasonAvg.avg_rebounds ?? 0);
    case 'ast':
      return Number(seasonAvg.avg_assists ?? 0);
    case '3pm': {
      const gp = Number(seasonAvg.games_active ?? 0);
      return gp > 0 ? Number(seasonAvg.total_3pm ?? 0) / gp : 0;
    }
    case 'pra':
      return (
        Number(seasonAvg.avg_points ?? 0) +
        Number(seasonAvg.avg_rebounds ?? 0) +
        Number(seasonAvg.avg_assists ?? 0)
      );
  }
}

export function hitRate(values: number[], line: number): HitRateResult {
  if (values.length === 0) return { last10: 0, last20: 0 };

  const last10 = values.slice(0, 10);
  const last20 = values.slice(0, 20);

  const rate = (arr: number[]) =>
    arr.length === 0 ? 0 : (arr.filter((v) => v > line).length / arr.length) * 100;

  return {
    last10: rate(last10),
    last20: rate(last20),
  };
}

export function avgMargin(values: number[], line: number): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + (v - line), 0);
  return sum / values.length;
}

export function streak(values: number[], line: number): StreakResult {
  if (values.length === 0) return { count: 0, type: 'over' };

  const firstOver = values[0] > line;
  let count = 0;

  for (const v of values) {
    if ((v > line) === firstOver) {
      count++;
    } else {
      break;
    }
  }

  return { count, type: firstOver ? 'over' : 'under' };
}

export function rollingAvg(values: number[], window: number): number[] {
  if (values.length === 0 || window <= 0) return [];

  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

export function summaryStats(values: number[]): SummaryResult {
  if (values.length === 0) {
    return { avg: 0, last5: 0, last10: 0, high: 0, low: 0 };
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const last5 = values.slice(0, 5);
  const last10 = values.slice(0, 10);
  const l5Avg = last5.length > 0 ? last5.reduce((a, b) => a + b, 0) / last5.length : 0;
  const l10Avg = last10.length > 0 ? last10.reduce((a, b) => a + b, 0) / last10.length : 0;
  const high = Math.max(...values);
  const low = Math.min(...values);

  return { avg, last5: l5Avg, last10: l10Avg, high, low };
}
