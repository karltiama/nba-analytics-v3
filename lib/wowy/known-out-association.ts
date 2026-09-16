/**
 * Conservative known-Out game association without a stored game_id.
 *
 * Missing game_id is a schema gap. It is not proof that a game cannot be
 * associated: a unique Final team-night on an America/New_York date plus
 * matching injury team_id is unambiguous in the inspected tape (0 collisions).
 */

import { etCalendarDate } from './calendar';
import { WOWY_R1_WITHOUT_STATUSES } from './availability-gate';
import type { PregameAvailabilityObservation } from './availability-gate';

/** Same T−60 cutoff as the frozen shadow protocol. Research reuse only. */
export const WOWY_R1_PREDICTION_CUTOFF_MINUTES_BEFORE_TIP = 60;

/**
 * Latest observation must be this fresh at cutoff. Covers the observed max
 * inter-snapshot gap on the Mar–May 2026 tape (~42 hours).
 */
export const WOWY_R1_OBS_FRESHNESS_MAX_HOURS = 48;

export type KnownOutExcludeReason =
  | 'ambiguous_team_et_date'
  | 'no_precutoff_observation'
  | 'observation_stale'
  | 'status_not_explicit_out'
  | 'missing_tip_or_cutoff';

/** Ordered terminal reasons after the played-subject filter. */
export const KNOWN_OUT_TERMINAL_REASONS = [
  'no_primary_teammate',
  'ambiguous_team_et_date',
  'missing_tip_or_cutoff',
  'no_precutoff_observation',
  'observation_stale',
  'status_not_explicit_out',
  'insufficient_wowy_support',
  'eligible',
] as const;

export type KnownOutTerminalReason = (typeof KNOWN_OUT_TERMINAL_REASONS)[number];

export type TeamGameRef = {
  gameId: string;
  teamId: string;
  startTime: string;
};

export function intendedCutoffIso(tipIso: string): string | null {
  const tipMs = Date.parse(tipIso);
  if (!Number.isFinite(tipMs)) return null;
  return new Date(tipMs - WOWY_R1_PREDICTION_CUTOFF_MINUTES_BEFORE_TIP * 60_000).toISOString();
}

export function teamEtDateKey(teamId: string, startTime: string): string | null {
  const et = etCalendarDate(startTime);
  if (!et) return null;
  return `${teamId}|${et}`;
}

/** Unique Final team-night on that ET date → unambiguous. 2+ games → skip. */
export function uniqueGameForTeamEtDate(
  games: TeamGameRef[],
  teamId: string,
  startTime: string
): { gameId: string } | { ambiguous: true; count: number } | { ambiguous: false; count: 0 } {
  const key = teamEtDateKey(teamId, startTime);
  if (!key) return { ambiguous: false, count: 0 };
  const matches = games.filter((g) => teamEtDateKey(g.teamId, g.startTime) === key);
  if (matches.length === 1) return { gameId: matches[0].gameId };
  if (matches.length === 0) return { ambiguous: false, count: 0 };
  return { ambiguous: true, count: matches.length };
}

export type KnownOutObservationResult = {
  eligible: boolean;
  reason: KnownOutExcludeReason | null;
  usedSnapshotAt: string | null;
  usedStatus: string | null;
  ageHoursAtCutoff: number | null;
};

function isExplicitOut(status: string): boolean {
  return (WOWY_R1_WITHOUT_STATUSES as readonly string[]).includes(status);
}

/**
 * Latest observation for this player on this team strictly before cutoff.
 *
 * Pass last-*observed* rows (raw successful pulls), not last-*changed* history
 * rows, when measuring freshness. Status may be unchanged while later pulls
 * still list the player.
 */
export function selectKnownOutObservation(args: {
  teammatePlayerId: string;
  teamId: string;
  cutoffStartTime: string;
  observations: PregameAvailabilityObservation[];
}): KnownOutObservationResult {
  const cutoffMs = Date.parse(args.cutoffStartTime);
  if (!Number.isFinite(cutoffMs)) {
    return {
      eligible: false,
      reason: 'missing_tip_or_cutoff',
      usedSnapshotAt: null,
      usedStatus: null,
      ageHoursAtCutoff: null,
    };
  }

  const eligible = args.observations.filter((row) => {
    if (row.playerId !== args.teammatePlayerId) return false;
    if (row.teamId !== args.teamId) return false;
    const t = Date.parse(row.snapshotAt);
    return Number.isFinite(t) && t < cutoffMs;
  });

  if (eligible.length === 0) {
    return {
      eligible: false,
      reason: 'no_precutoff_observation',
      usedSnapshotAt: null,
      usedStatus: null,
      ageHoursAtCutoff: null,
    };
  }

  eligible.sort((a, b) => Date.parse(b.snapshotAt) - Date.parse(a.snapshotAt));
  const latest = eligible[0];
  const ageHours = (cutoffMs - Date.parse(latest.snapshotAt)) / 3_600_000;

  if (ageHours > WOWY_R1_OBS_FRESHNESS_MAX_HOURS) {
    return {
      eligible: false,
      reason: 'observation_stale',
      usedSnapshotAt: latest.snapshotAt,
      usedStatus: latest.status,
      ageHoursAtCutoff: ageHours,
    };
  }

  if (!isExplicitOut(latest.status)) {
    return {
      eligible: false,
      reason: 'status_not_explicit_out',
      usedSnapshotAt: latest.snapshotAt,
      usedStatus: latest.status,
      ageHoursAtCutoff: ageHours,
    };
  }

  return {
    eligible: true,
    reason: null,
    usedSnapshotAt: latest.snapshotAt,
    usedStatus: latest.status,
    ageHoursAtCutoff: ageHours,
  };
}

export function hadObservationOnOrAfterCutoff(args: {
  teammatePlayerId: string;
  cutoffStartTime: string;
  observations: PregameAvailabilityObservation[];
}): boolean {
  const cutoffMs = Date.parse(args.cutoffStartTime);
  if (!Number.isFinite(cutoffMs)) return false;
  return args.observations.some((row) => {
    if (row.playerId !== args.teammatePlayerId) return false;
    const t = Date.parse(row.snapshotAt);
    return Number.isFinite(t) && t >= cutoffMs;
  });
}
