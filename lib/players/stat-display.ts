/**
 * Shared display helpers for nullable player trend stats.
 * Distinguishes missing sample from a real statistical zero.
 */

export function formatNullableStat(
  value: number | null | undefined,
  digits = 1
): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

export function formatStatDiffVsAvg(
  value: number | null | undefined,
  avg: number | null | undefined,
  digits = 1
): string | null {
  if (value == null || avg == null) return null;
  const v = Number(value);
  const a = Number(avg);
  if (!Number.isFinite(v) || !Number.isFinite(a)) return null;
  const diff = v - a;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(digits)} vs avg`;
}

export function hasSummarySample(summary: {
  avg: number | null;
}): boolean {
  return summary.avg != null && Number.isFinite(summary.avg);
}
