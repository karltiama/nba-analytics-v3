/**
 * Quick Builds product events. Closed sportsbook, preset, and outcome values only.
 * Never send player names, player ids, game ids, lines, prices, pull ids, or response bodies.
 */

import { QUICK_BUILD_EMPTY_REASONS, type QuickBuildEmptyReason } from '@/lib/quick-builds/types';
import {
  PRODUCT_EVENTS,
  type QuickBuildAgeBucket,
  type QuickBuildAnalyticsPreset,
  type QuickBuildAnalyticsSportsbook,
  type QuickBuildsHandoffCompletedProperties,
  type QuickBuildsSearchCompletedProperties,
} from '@/lib/product-analytics/track-event';

export const QUICK_BUILDS_SEARCH_COMPLETED = PRODUCT_EVENTS.QUICK_BUILDS_SEARCH_COMPLETED;
export const QUICK_BUILDS_HANDOFF_COMPLETED = PRODUCT_EVENTS.QUICK_BUILDS_HANDOFF_COMPLETED;

export const QUICK_BUILD_SHORTLIST_EVENT_CAP = 5;

const FIVE_MINUTES_MS = 5 * 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;
const THIRTY_MINUTES_MS = 30 * 60_000;
const SIXTY_MINUTES_MS = 60 * 60_000;
const THREE_HOURS_MS = 180 * 60_000;

const SPORTSBOOKS = new Set<string>(['draftkings', 'fanduel', 'betmgm', 'caesars']);
const PRESETS = new Set<string>([
  'higher_hit_chance',
  'balanced',
  'higher_payout',
  'shorter_payout',
  'midrange',
  'longer_payout',
]);
const EMPTY_REASONS = new Set<string>(QUICK_BUILD_EMPTY_REASONS);

export type QuickBuildSearchKind =
  | 'ok'
  | 'empty'
  | 'unauthorized'
  | 'invalid'
  | 'limit'
  | 'server'
  | 'network'
  | 'malformed'
  | 'aborted';

export type QuickBuildHandoffEventStatus =
  | 'replaced'
  | 'needs_confirmation'
  | 'tipped'
  | 'rejected'
  | 'canceled';

/** Half-open age buckets. An exact boundary belongs to the older bucket. */
export function quickBuildAgeBucket(ageMs: number | null | undefined): QuickBuildAgeBucket {
  if (typeof ageMs !== 'number' || !Number.isFinite(ageMs) || ageMs < 0) return 'unknown';
  if (ageMs < FIVE_MINUTES_MS) return 'under_5m';
  if (ageMs < FIFTEEN_MINUTES_MS) return '5_15m';
  if (ageMs < THIRTY_MINUTES_MS) return '15_30m';
  if (ageMs < SIXTY_MINUTES_MS) return '30_60m';
  if (ageMs < THREE_HOURS_MS) return '1_3h';
  return 'over_3h';
}

/**
 * Oldest valid observation age among the returned shortlist.
 * Invalid ages are skipped. No valid age returns null, which buckets as unknown.
 */
export function oldestShortlistAgeMs(body: unknown): number | null {
  if (body == null || typeof body !== 'object' || !Array.isArray((body as { builds?: unknown }).builds)) {
    return null;
  }
  const builds = (body as { builds: unknown[] }).builds.slice(0, QUICK_BUILD_SHORTLIST_EVENT_CAP);
  let oldest: number | null = null;
  for (const build of builds) {
    if (build == null || typeof build !== 'object') continue;
    const age = (build as { maxAgeMs?: unknown }).maxAgeMs;
    if (typeof age !== 'number' || !Number.isFinite(age) || age < 0) continue;
    oldest = oldest == null ? age : Math.max(oldest, age);
  }
  return oldest;
}

function closedSportsbook(value: string): QuickBuildAnalyticsSportsbook | null {
  return SPORTSBOOKS.has(value) ? (value as QuickBuildAnalyticsSportsbook) : null;
}

function closedPreset(value: string): QuickBuildAnalyticsPreset | null {
  return PRESETS.has(value) ? (value as QuickBuildAnalyticsPreset) : null;
}

/**
 * One event for an accepted terminal search. Aborted and stale searches pass accepted=false.
 * Empty and error ages are unknown. A nonempty search uses the shortlist's oldest valid age.
 */
export function quickBuildsSearchEvent(input: {
  accepted: boolean;
  sportsbook: string;
  preset: string;
  /** Omitted means the historical two-leg event. New events pass 2 or 3. */
  legCount?: 2 | 3;
  kind: QuickBuildSearchKind;
  buildCount: number;
  emptyReason: string | null;
  ageMs: number | null;
}): QuickBuildsSearchCompletedProperties | null {
  if (!input.accepted || input.kind === 'aborted') return null;
  const sportsbook = closedSportsbook(input.sportsbook);
  const preset = closedPreset(input.preset);
  const legCount = input.legCount ?? 2;
  if (!sportsbook || !preset || (legCount !== 2 && legCount !== 3)) return null;
  if (input.kind === 'ok') {
    if (!Number.isInteger(input.buildCount) || input.buildCount < 1 || input.buildCount > QUICK_BUILD_SHORTLIST_EVENT_CAP) {
      return null;
    }
    return {
      sportsbook,
      preset,
      leg_count: legCount,
      result: 'success',
      build_count: input.buildCount,
      age_bucket: quickBuildAgeBucket(input.ageMs),
    };
  }
  if (input.kind === 'empty') {
    if (!input.emptyReason || !EMPTY_REASONS.has(input.emptyReason)) return null;
    return {
      sportsbook,
      preset,
      leg_count: legCount,
      result: 'empty',
      build_count: 0,
      empty_reason: input.emptyReason as QuickBuildEmptyReason,
      age_bucket: 'unknown',
    };
  }
  return {
    sportsbook,
    preset,
    leg_count: legCount,
    result: 'error',
    build_count: 0,
    age_bucket: 'unknown',
  };
}

/** One event only after canonical replacement. Confirmation, cancel, rejection, and tip do not emit. */
export function quickBuildsHandoffEvent(input: {
  status: QuickBuildHandoffEventStatus;
  sportsbook: string;
  preset: string;
  /** Omitted means the historical two-leg event. */
  legCount?: 2 | 3;
}): QuickBuildsHandoffCompletedProperties | null {
  if (input.status !== 'replaced') return null;
  const sportsbook = closedSportsbook(input.sportsbook);
  const preset = closedPreset(input.preset);
  const legCount = input.legCount ?? 2;
  if (!sportsbook || !preset || (legCount !== 2 && legCount !== 3)) return null;
  return { sportsbook, preset, leg_count: legCount, result: 'successful_handoff' };
}
