/**
 * Phase 19B — Frozen prospective competition universe.
 *
 * Historical fit/validation (PTS residual + aux MIN + selective validation) queried
 * analytics.games with season ∈ {2023,2024,2025} AND status='Final' (+ scores).
 * analytics.games has NO game_type column. Characterized Final tips begin at
 * regular-season opening night (no Final preseason rows in those seasons).
 * Tips on/after WOWY play-in floors are included (Play-In + Playoffs + Finals).
 * NBA Cup / IST games are not separately labeled and are treated as REGULAR.
 */

import { etCalendarDate, WOWY_POSTSEASON_START_ET } from '@/lib/wowy/calendar';

/** Protocol amendment id — freeze before first live cohort row. */
export const PROSPECTIVE_GAME_UNIVERSE_AMENDMENT_ID =
  'prospective-game-universe-v1' as const;

/**
 * Inclusive America/New_York calendar date of regular-season opening night
 * for each analytics season start-year. Tips strictly before this are PRESEASON.
 */
export const REGULAR_SEASON_OPEN_ET: Readonly<Record<string, string>> = {
  '2023': '2023-10-24',
  '2024': '2024-10-22',
  '2025': '2025-10-21',
  /** Official 2026–27 regular-season opening night (America/New_York). */
  '2026': '2026-10-20',
};

export const PROSPECTIVE_GAME_UNIVERSE = [
  'REGULAR_SEASON',
  'NBA_CUP_IN_SEASON_TOURNAMENT',
  'PLAY_IN',
  'PLAYOFFS',
  'FINALS',
] as const;

export type ProspectiveGameUniverseClass =
  | 'PRESEASON'
  | 'REGULAR_SEASON'
  | 'PLAY_IN_OR_PLAYOFFS'
  | 'CANCELLED_OR_POSTPONED'
  | 'EXHIBITION_OR_UNKNOWN'
  | 'INELIGIBLE_STATUS';

export const PRESEASON_PRIMARY_ELIGIBILITY = 'NO' as const;
export const PLAY_IN_ELIGIBILITY = 'YES' as const;
export const PLAYOFF_ELIGIBILITY = 'YES' as const;
export const ALL_STAR_EXHIBITION_ELIGIBILITY = 'NO' as const;

const TERMINAL_EXCLUDED = new Set(['Cancelled', 'Postponed', 'canceled', 'postponed']);

/** True when status looks like a provider tip ISO stamped into status (2026 schedule defect). */
export function isCorruptScheduleStatus(status: string | null | undefined): boolean {
  if (status == null || status === '') return false;
  if (status === 'Final' || status === 'Scheduled' || status === 'In Progress') return false;
  return /^\d{4}-\d{2}-\d{2}T/.test(status);
}

export function classifyProspectiveCompetition(opts: {
  season: string;
  startTimeIso: string;
  status?: string | null;
}): {
  class: ProspectiveGameUniverseClass;
  primaryEligible: boolean;
  reason: string;
} {
  const status = opts.status ?? null;
  if (status != null && TERMINAL_EXCLUDED.has(status)) {
    return {
      class: 'CANCELLED_OR_POSTPONED',
      primaryEligible: false,
      reason: 'status_cancelled_or_postponed',
    };
  }

  const et = etCalendarDate(opts.startTimeIso);
  if (et == null) {
    return {
      class: 'EXHIBITION_OR_UNKNOWN',
      primaryEligible: false,
      reason: 'unparseable_start_time',
    };
  }

  const open = REGULAR_SEASON_OPEN_ET[String(opts.season)];
  if (!open) {
    return {
      class: 'EXHIBITION_OR_UNKNOWN',
      primaryEligible: false,
      reason: 'season_open_not_frozen',
    };
  }
  if (et < open) {
    return {
      class: 'PRESEASON',
      primaryEligible: false,
      reason: 'before_regular_season_open_et',
    };
  }

  const postStart =
    WOWY_POSTSEASON_START_ET[String(opts.season)] ??
    // Extend map for 2026 when known; until then treat late-season as regular
    null;
  if (postStart && et >= postStart) {
    return {
      class: 'PLAY_IN_OR_PLAYOFFS',
      primaryEligible: true,
      reason: 'on_or_after_playin_floor_et',
    };
  }

  return {
    class: 'REGULAR_SEASON',
    primaryEligible: true,
    reason: 'on_or_after_regular_season_open_et',
  };
}

export function isPrimaryProspectiveCompetitionGame(opts: {
  season: string;
  startTimeIso: string;
  status?: string | null;
}): boolean {
  return classifyProspectiveCompetition(opts).primaryEligible;
}
