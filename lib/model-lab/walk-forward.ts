/**
 * Permanent Model Lab walk-forward rule: features for target game G may use
 * only rows/events with timestamps before G's context cutoff.
 */

export type TimestampedRow = {
  timestamp: string;
  [key: string]: unknown;
};

export function parseTs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function rowUsableBeforeCutoff(rowTimestamp: string, cutoffAt: string): boolean {
  const row = parseTs(rowTimestamp);
  const cutoff = parseTs(cutoffAt);
  if (row == null || cutoff == null) return false;
  return row < cutoff;
}

export function filterWalkForwardRows<T extends TimestampedRow>(rows: readonly T[], cutoffAt: string): T[] {
  return rows.filter((row) => rowUsableBeforeCutoff(row.timestamp, cutoffAt));
}

export function futureRowsPresent(rows: readonly TimestampedRow[], cutoffAt: string): boolean {
  return rows.some((row) => !rowUsableBeforeCutoff(row.timestamp, cutoffAt));
}

export function assertNoFutureRowsInCapturedFeatures(
  capturedFeatureEventTimestamps: readonly string[],
  cutoffAt: string
): void {
  const future = capturedFeatureEventTimestamps.filter((ts) => !rowUsableBeforeCutoff(ts, cutoffAt));
  if (future.length > 0) {
    throw new Error(
      `Walk-forward violation: ${future.length} captured feature event(s) are on or after cutoff ${cutoffAt}.`
    );
  }
}

export function assertPredictionPrecedesCutoff(generatedAt: string, cutoffAt: string): void {
  const generated = parseTs(generatedAt);
  const cutoff = parseTs(cutoffAt);
  if (generated == null || cutoff == null) {
    throw new Error('Prospective prediction requires finite generated_at and context cutoff timestamps.');
  }
  if (generated > cutoff) {
    throw new Error(`Prospective prediction generated_at ${generatedAt} is after context cutoff ${cutoffAt}.`);
  }
}
