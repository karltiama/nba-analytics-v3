export interface ScoredRow {
  p: number;
  win: 0 | 1;
  ev?: number;
  roi?: number;
}

export interface CalibrationBin {
  low: number;
  high: number;
  n: number;
  avgPred: number;
  hitRate: number;
}

export interface DecileRow {
  decile: number;
  n: number;
  avgEv: number;
  avgRoi: number;
  hitRate: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function brierScore(rows: ScoredRow[]): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((acc, r) => {
    const p = clamp01(r.p);
    return acc + (p - r.win) * (p - r.win);
  }, 0);
  return sum / rows.length;
}

export function expectedCalibrationError(rows: ScoredRow[], bins = 10): number {
  if (rows.length === 0 || bins <= 0) return 0;
  let ece = 0;
  for (let i = 0; i < bins; i++) {
    const low = i / bins;
    const high = (i + 1) / bins;
    const bucket = rows.filter((r) => {
      const p = clamp01(r.p);
      return i === bins - 1 ? p >= low && p <= high : p >= low && p < high;
    });
    if (bucket.length === 0) continue;
    const avgPred = bucket.reduce((a, r) => a + clamp01(r.p), 0) / bucket.length;
    const hitRate = bucket.reduce((a, r) => a + r.win, 0) / bucket.length;
    ece += Math.abs(avgPred - hitRate) * (bucket.length / rows.length);
  }
  return ece;
}

export function calibrationBins(rows: ScoredRow[], bins = 10): CalibrationBin[] {
  const out: CalibrationBin[] = [];
  for (let i = 0; i < bins; i++) {
    const low = i / bins;
    const high = (i + 1) / bins;
    const bucket = rows.filter((r) => {
      const p = clamp01(r.p);
      return i === bins - 1 ? p >= low && p <= high : p >= low && p < high;
    });
    if (bucket.length === 0) continue;
    out.push({
      low,
      high,
      n: bucket.length,
      avgPred: bucket.reduce((a, r) => a + clamp01(r.p), 0) / bucket.length,
      hitRate: bucket.reduce((a, r) => a + r.win, 0) / bucket.length,
    });
  }
  return out;
}

export function decileScorecard(rows: ScoredRow[]): DecileRow[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));
  const size = Math.ceil(sorted.length / 10);
  const out: DecileRow[] = [];
  for (let i = 0; i < 10; i++) {
    const slice = sorted.slice(i * size, (i + 1) * size);
    if (slice.length === 0) continue;
    out.push({
      decile: i + 1,
      n: slice.length,
      avgEv: slice.reduce((a, r) => a + (r.ev ?? 0), 0) / slice.length,
      avgRoi: slice.reduce((a, r) => a + (r.roi ?? 0), 0) / slice.length,
      hitRate: slice.reduce((a, r) => a + r.win, 0) / slice.length,
    });
  }
  return out;
}
