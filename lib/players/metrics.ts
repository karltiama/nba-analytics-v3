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
): number | null {
  switch (key) {
    case 'pts':
      return seasonAvg.avg_points == null ? null : Number(seasonAvg.avg_points);
    case 'reb':
      return seasonAvg.avg_rebounds == null ? null : Number(seasonAvg.avg_rebounds);
    case 'ast':
      return seasonAvg.avg_assists == null ? null : Number(seasonAvg.avg_assists);
    case '3pm': {
      const gp = Number(seasonAvg.games_active ?? 0);
      if (!(gp > 0) || seasonAvg.total_3pm == null) return null;
      return Number(seasonAvg.total_3pm) / gp;
    }
    case 'pra': {
      if (
        seasonAvg.avg_points == null &&
        seasonAvg.avg_rebounds == null &&
        seasonAvg.avg_assists == null
      ) {
        return null;
      }
      return (
        Number(seasonAvg.avg_points ?? 0) +
        Number(seasonAvg.avg_rebounds ?? 0) +
        Number(seasonAvg.avg_assists ?? 0)
      );
    }
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
    return { avg: null, last5: null, last10: null, high: null, low: null };
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const last5 = values.slice(0, 5);
  const last10 = values.slice(0, 10);
  const l5Avg = last5.reduce((a, b) => a + b, 0) / last5.length;
  const l10Avg = last10.reduce((a, b) => a + b, 0) / last10.length;
  const high = Math.max(...values);
  const low = Math.min(...values);

  return { avg, last5: l5Avg, last10: l10Avg, high, low };
}
