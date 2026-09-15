import { etCalendarDate } from './calendar';

/**
 * ET basketball-date exclusion, matching the learned-feature / as-of convention:
 * a prior game is usable only when it is strictly before tipoff AND on an
 * earlier America/New_York calendar date. Same-night / same-ET-date games
 * are excluded even if their start_time is slightly earlier.
 */
export function isUsableWowyPrior(featureStartTime: string, cutoffStartTime: string): boolean {
  const featureMs = Date.parse(featureStartTime);
  const cutoffMs = Date.parse(cutoffStartTime);
  if (!Number.isFinite(featureMs) || !Number.isFinite(cutoffMs)) return false;
  if (featureMs >= cutoffMs) return false;
  const featureDate = etCalendarDate(featureStartTime);
  const cutoffDate = etCalendarDate(cutoffStartTime);
  if (!featureDate || !cutoffDate) return false;
  return featureDate < cutoffDate;
}

export function isOnOrAfterCutoff(startTime: string, cutoffStartTime: string): boolean {
  return !isUsableWowyPrior(startTime, cutoffStartTime);
}
