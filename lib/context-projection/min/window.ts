/**
 * Phase 18B — Auxiliary MIN prospective window accounting.
 * Ordering: prediction_created_at ASC, shadow_prediction_id ASC (design freeze).
 * N counts resolved PLAYED only; delayed outcomes cannot reorder by arrival time.
 */

import {
  AUX_MIN_PROSPECTIVE_WINDOW,
  PRIMARY_AUX_MIN_BRANCH,
  PROSPECTIVE_MIN_REQUIRED_N,
  PTS_PROSPECTIVE_WINDOW_ID,
  type AuxMinBranch,
} from '@/lib/context-projection/min/protocol';
import { SHADOW_CUTOFF_MINUTES } from '@/lib/context-projection/protocol';

export type MinPregameEligibilityStatus =
  | 'PRIMARY_ELIGIBLE'
  | 'FALLBACK_NOT_PRIMARY'
  | 'LATE'
  | 'VERSION_MISMATCH'
  | 'INVALID'
  | 'NOT_COUNTED';

export type MinCanonicalSnapshotStatus =
  | 'CANONICAL_T60'
  | 'LATE_AFTER_T60'
  | 'INVALID'
  | 'SUPERSEDED_NOT_STORED';

export type MinProspectiveCollectionStatus =
  | 'NOT_ARMED'
  | 'READY_FOR_PROSPECTIVE_COLLECTION'
  | 'COLLECTING'
  | 'READY_FOR_READOUT'
  | 'COMPLETE';

export type ResolvedAppearanceClass =
  | 'played'
  | 'dnp'
  | 'malformed'
  | 'no_pgl'
  | 'postponed'
  | 'cancelled'
  | 'unresolved';

export interface MinWindowCandidateRow {
  shadowPredictionId: string;
  prospectiveWindowId: string;
  predictionCreatedAt: string;
  branch: AuxMinBranch;
  pregameEligibilityStatus: MinPregameEligibilityStatus;
  /** null = unresolved / no outcome row yet */
  resolvedAppearanceClass: ResolvedAppearanceClass | null;
}

export interface MinWindowCounters {
  PREGAME_JOINT_PREDICTIONS_N: number;
  RESOLVED_PLAYED_N: number;
  RESOLVED_DNP_N: number;
  UNRESOLVED_N: number;
  FINALIZED_PRIMARY_N: number;
  PROSPECTIVE_MIN_REQUIRED_N: number;
  blockedByEarlierUnresolved: boolean;
}

export interface PrimarySequenceAssignment {
  shadowPredictionId: string;
  primaryScoringEligible: boolean;
  primarySequenceNumber: number | null;
}

export function intendedMinCutoffIso(
  gameStartIso: string,
  minutes = SHADOW_CUTOFF_MINUTES
): string {
  const tip = Date.parse(gameStartIso);
  if (!Number.isFinite(tip)) throw new Error(`invalid game_start: ${gameStartIso}`);
  return new Date(tip - minutes * 60_000).toISOString();
}

/** Inclusive: prediction_created_at <= T−60 is on-time. */
export function isOnTimeMinPrediction(
  predictionCreatedAtIso: string,
  intendedCutoffIsoStr: string
): boolean {
  return Date.parse(predictionCreatedAtIso) <= Date.parse(intendedCutoffIsoStr);
}

export function isPregameMinPrediction(
  predictionCreatedAtIso: string,
  gameStartIso: string
): boolean {
  return Date.parse(predictionCreatedAtIso) < Date.parse(gameStartIso);
}

export function minCanonicalSnapshotIdentity(opts: {
  prospectiveWindowId: string;
  playerEntityId: string;
  gameId: string;
  modelId: string;
}): string {
  return [
    opts.prospectiveWindowId,
    opts.playerEntityId,
    opts.gameId,
    opts.modelId,
  ].join('|');
}

export function assertNotPtsWindowId(windowId: string | null | undefined): boolean {
  return windowId != null && windowId !== PTS_PROSPECTIVE_WINDOW_ID;
}

export function assertMinWindowId(windowId: string): boolean {
  return windowId === AUX_MIN_PROSPECTIVE_WINDOW && assertNotPtsWindowId(windowId);
}

/**
 * Among candidate snapshot timestamps that are eligible (<= T−60 and pregame),
 * return the latest. Snapshots after T−60 are excluded.
 */
export function selectLatestEligibleAtOrBeforeT60(
  snapshotIsos: string[],
  intendedCutoffIsoStr: string,
  gameStartIso: string
): string | null {
  const eligible = snapshotIsos
    .filter(
      (t) =>
        isPregameMinPrediction(t, gameStartIso) &&
        isOnTimeMinPrediction(t, intendedCutoffIsoStr)
    )
    .sort();
  return eligible.length ? eligible[eligible.length - 1]! : null;
}

export function classifyMinSnapshotStatus(opts: {
  predictionCreatedAt: string;
  gameStart: string;
  intendedCutoffAt: string;
}): MinCanonicalSnapshotStatus {
  if (!isPregameMinPrediction(opts.predictionCreatedAt, opts.gameStart)) {
    return 'INVALID';
  }
  if (!isOnTimeMinPrediction(opts.predictionCreatedAt, opts.intendedCutoffAt)) {
    return 'LATE_AFTER_T60';
  }
  return 'CANONICAL_T60';
}

/** Joint primary pregame rows only (enter first-N pool). */
export function isJointPrimaryPregameRow(row: MinWindowCandidateRow): boolean {
  return (
    row.prospectiveWindowId === AUX_MIN_PROSPECTIVE_WINDOW &&
    row.branch === PRIMARY_AUX_MIN_BRANCH &&
    row.pregameEligibilityStatus === 'PRIMARY_ELIGIBLE'
  );
}

function sortPrimaryPool(rows: MinWindowCandidateRow[]): MinWindowCandidateRow[] {
  return [...rows].filter(isJointPrimaryPregameRow).sort((a, b) => {
    const ta = Date.parse(a.predictionCreatedAt);
    const tb = Date.parse(b.predictionCreatedAt);
    if (ta !== tb) return ta - tb;
    return a.shadowPredictionId < b.shadowPredictionId
      ? -1
      : a.shadowPredictionId > b.shadowPredictionId
        ? 1
        : 0;
  });
}

/**
 * Assign primary_sequence_number by prediction_created_at order among joint
 * PRIMARY_ELIGIBLE rows. An earlier unresolved row blocks finalizing further
 * primary slots that depend on whether it becomes PLAYED.
 * DNP / quarantine do not consume N. Only PLAYED get sequences 1..REQUIRED_N.
 */
export function assignPrimarySequences(
  rows: MinWindowCandidateRow[],
  requiredN = PROSPECTIVE_MIN_REQUIRED_N
): {
  assignments: PrimarySequenceAssignment[];
  counters: MinWindowCounters;
} {
  const pool = sortPrimaryPool(rows);
  const byId = new Map<string, PrimarySequenceAssignment>();
  for (const r of rows) {
    byId.set(r.shadowPredictionId, {
      shadowPredictionId: r.shadowPredictionId,
      primaryScoringEligible: false,
      primarySequenceNumber: null,
    });
  }

  let seq = 0;
  let blockedByEarlierUnresolved = false;

  for (const r of pool) {
    const cls = r.resolvedAppearanceClass;
    if (cls == null || cls === 'unresolved') {
      if (seq < requiredN) blockedByEarlierUnresolved = true;
      break;
    }
    if (cls === 'played') {
      if (seq < requiredN) {
        seq += 1;
        byId.set(r.shadowPredictionId, {
          shadowPredictionId: r.shadowPredictionId,
          primaryScoringEligible: true,
          primarySequenceNumber: seq,
        });
      }
      continue;
    }
    // dnp / quarantine / malformed / no_pgl / postponed / cancelled — skip
  }

  let resolvedPlayed = 0;
  let resolvedDnp = 0;
  let unresolved = 0;
  for (const r of pool) {
    const cls = r.resolvedAppearanceClass;
    if (cls == null || cls === 'unresolved') unresolved += 1;
    else if (cls === 'played') resolvedPlayed += 1;
    else if (cls === 'dnp') resolvedDnp += 1;
  }

  const assignments = [...byId.values()];
  const finalized = assignments.filter(
    (a) => a.primarySequenceNumber != null && a.primarySequenceNumber <= requiredN
  ).length;

  return {
    assignments,
    counters: {
      PREGAME_JOINT_PREDICTIONS_N: pool.length,
      RESOLVED_PLAYED_N: resolvedPlayed,
      RESOLVED_DNP_N: resolvedDnp,
      UNRESOLVED_N: unresolved,
      FINALIZED_PRIMARY_N: finalized,
      PROSPECTIVE_MIN_REQUIRED_N: requiredN,
      blockedByEarlierUnresolved,
    },
  };
}

export function minCollectionStatus(opts: {
  armed: boolean;
  pregameJointN: number;
  finalizedPrimaryN: number;
  requiredN?: number;
  blockedByEarlierUnresolved?: boolean;
}): MinProspectiveCollectionStatus {
  const required = opts.requiredN ?? PROSPECTIVE_MIN_REQUIRED_N;
  if (!opts.armed) return 'NOT_ARMED';
  if (opts.finalizedPrimaryN >= required && !opts.blockedByEarlierUnresolved) {
    return 'READY_FOR_READOUT';
  }
  if (opts.pregameJointN > 0 || opts.finalizedPrimaryN > 0) return 'COLLECTING';
  return 'READY_FOR_PROSPECTIVE_COLLECTION';
}

export function assertNoHistoricalMinBackfill(
  predictionCreatedAtIso: string,
  windowOpenedAtIso: string
): void {
  if (Date.parse(predictionCreatedAtIso) < Date.parse(windowOpenedAtIso)) {
    throw new Error('HISTORICAL_ROWS_IN_MIN_PROSPECTIVE_COHORT_FORBIDDEN');
  }
}
