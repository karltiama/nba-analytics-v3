/**
 * Time-to-tip bucket classification for coverage certification.
 */

import { TIME_TO_TIP_BUCKETS, type TimeToTipBucket } from './types';

export function hoursUntilCommence(
  commenceTimeIso: string,
  now: Date = new Date()
): number | null {
  const t = Date.parse(commenceTimeIso);
  if (!Number.isFinite(t)) return null;
  return (t - now.getTime()) / (60 * 60 * 1000);
}

/**
 * Classify hours-to-tip into certification buckets.
 * Past tips use `started_or_past` (excluded from "closer to tip improves" claims).
 */
export function classifyTimeToTipBucket(hoursToTip: number | null): TimeToTipBucket {
  if (hoursToTip == null || !Number.isFinite(hoursToTip)) return 'started_or_past';
  if (hoursToTip < 0) return 'started_or_past';
  if (hoursToTip < 1) return 'lt_1h';
  if (hoursToTip < 3) return 'h_1_3';
  if (hoursToTip < 6) return 'h_3_6';
  if (hoursToTip < 12) return 'h_6_12';
  if (hoursToTip < 24) return 'h_12_24';
  return 'gt_24h';
}

export function isFutureTipBucket(bucket: TimeToTipBucket): boolean {
  return bucket !== 'started_or_past';
}

export function listTimeToTipBuckets(): readonly TimeToTipBucket[] {
  return TIME_TO_TIP_BUCKETS;
}
