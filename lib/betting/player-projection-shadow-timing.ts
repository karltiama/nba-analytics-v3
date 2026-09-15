/**
 * T−60 timing helpers for shadow protocol amendment r1.1.
 * Does not reclassify late predictions as on-time.
 */

import { etCalendarDate } from '@/lib/betting/minutes-projection-eval';
import { historicalSeasonWindow } from '@/lib/ingestion/historical-serving/season-window';
import {
  SHADOW_ALLOWABLE_EXECUTION_LATENCY_SECONDS,
  SHADOW_PRIMARY_WINDOW_DAYS,
  SHADOW_REGULAR_SEASON_FLOOR_MMDD,
  SHADOW_SEASON,
} from '@/lib/betting/player-projection-shadow-protocol';
import type { PredictionDelivery, ShadowEligibility } from '@/lib/betting/player-projection-shadow-scoring';

export type ScheduledTipoffRow = {
  gameId: string;
  startTime: string;
  season: string;
};

export type ShadowWindowAnchor = {
  season: string;
  firstRegularSeasonTipoff: string;
  observedAt: string;
  source: string;
  revision: number;
  previousTipoff: string | null;
};

export function regularSeasonFloorEt(season: string = SHADOW_SEASON): string {
  const year = Number(season);
  const window = historicalSeasonWindow(year);
  const expected = `${season}-${SHADOW_REGULAR_SEASON_FLOOR_MMDD}`;
  if (window.servingMinDate !== expected) {
    throw new Error(
      `RS floor mismatch: historicalSeasonWindow=${window.servingMinDate} protocol=${expected}`
    );
  }
  return window.servingMinDate;
}

export function isRegularSeasonScheduledTip(args: {
  startTime: string;
  season: string;
}): boolean {
  const et = etCalendarDate(args.startTime);
  if (!et) return false;
  return et >= regularSeasonFloorEt(args.season);
}

/**
 * First scheduled regular-season tipoff from the authoritative schedule,
 * not the first successful prediction.
 */
export function observeFirstRegularSeasonTipoff(args: {
  games: ScheduledTipoffRow[];
  season?: string;
  observedAt: string;
  source?: string;
  previous?: ShadowWindowAnchor | null;
}): ShadowWindowAnchor | null {
  const season = args.season ?? SHADOW_SEASON;
  const tips = args.games
    .filter((g) => String(g.season) === season && isRegularSeasonScheduledTip(g))
    .map((g) => g.startTime)
    .filter((t) => Number.isFinite(Date.parse(t)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const first = tips[0];
  if (!first) return null;
  const previous = args.previous;
  if (previous && previous.firstRegularSeasonTipoff === first) {
    return previous;
  }
  return {
    season,
    firstRegularSeasonTipoff: first,
    observedAt: args.observedAt,
    source: args.source ?? 'analytics.games',
    revision: previous ? previous.revision + 1 : 1,
    previousTipoff: previous?.firstRegularSeasonTipoff ?? null,
  };
}

export function qualifiesForPrimaryEvaluation(args: {
  delivery: PredictionDelivery;
  eligibility: ShadowEligibility;
  scheduledTipoff: string;
  windowStart: string | null;
}): boolean {
  if (!args.windowStart) return false;
  if (args.delivery !== 'on_time' || args.eligibility !== 'ok') return false;
  const tip = Date.parse(args.scheduledTipoff);
  const start = Date.parse(args.windowStart);
  if (!Number.isFinite(tip) || !Number.isFinite(start) || tip < start) return false;
  const end = start + SHADOW_PRIMARY_WINDOW_DAYS * 86_400_000;
  return tip < end;
}

/** Ops SLA only. Never used to rewrite delivery=late to on_time. */
export function executionLatencyWithinSla(args: {
  dueAt: string;
  startedAt: string;
  slaSeconds?: number;
}): boolean {
  const due = Date.parse(args.dueAt);
  const started = Date.parse(args.startedAt);
  if (!Number.isFinite(due) || !Number.isFinite(started)) return false;
  const sla = (args.slaSeconds ?? SHADOW_ALLOWABLE_EXECUTION_LATENCY_SECONDS) * 1000;
  return started - due <= sla;
}
