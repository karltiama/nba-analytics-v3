/**
 * Prospective first-500 window counter + canonical snapshot identity.
 */

import {
  PROSPECTIVE_REQUIRED_N,
  PROSPECTIVE_WINDOW_ID,
  SHADOW_CUTOFF_MINUTES,
  type EligibilityStatus,
} from '@/lib/context-projection/protocol';

export type ProspectiveCollectionStatus =
  | 'NOT_STARTED'
  | 'READY_FOR_PROSPECTIVE_COLLECTION'
  | 'COLLECTING'
  | 'READY_FOR_READOUT'
  | 'COMPLETE';

export function intendedCutoffIso(gameStartIso: string, minutes = SHADOW_CUTOFF_MINUTES): string {
  const tip = Date.parse(gameStartIso);
  if (!Number.isFinite(tip)) throw new Error(`invalid game_start: ${gameStartIso}`);
  return new Date(tip - minutes * 60_000).toISOString();
}

export function isOnTimePrediction(predictionCreatedAtIso: string, intendedCutoffIsoStr: string): boolean {
  return Date.parse(predictionCreatedAtIso) <= Date.parse(intendedCutoffIsoStr);
}

export function isPregame(predictionCreatedAtIso: string, gameStartIso: string): boolean {
  return Date.parse(predictionCreatedAtIso) < Date.parse(gameStartIso);
}

/**
 * Canonical snapshot identity for one certification unit.
 * Multiple pregame updates collapse to (window, player, game, model).
 */
export function canonicalSnapshotIdentity(opts: {
  prospectiveWindowId: string;
  playerEntityId: string;
  gameId: string;
  contextModelVersion: string;
}): string {
  return [
    opts.prospectiveWindowId,
    opts.playerEntityId,
    opts.gameId,
    opts.contextModelVersion,
  ].join('|');
}

/** Only PRIMARY_ELIGIBLE rows increment the first-500 counter. */
export function countsTowardPrimaryWindow(eligibility: EligibilityStatus): boolean {
  return eligibility === 'PRIMARY_ELIGIBLE';
}

export function collectionStatus(currentPrimaryN: number): ProspectiveCollectionStatus {
  if (currentPrimaryN <= 0) return 'READY_FOR_PROSPECTIVE_COLLECTION';
  if (currentPrimaryN < PROSPECTIVE_REQUIRED_N) return 'COLLECTING';
  return 'READY_FOR_READOUT';
}

export function assertNoHistoricalBackfill(predictionCreatedAtIso: string, windowOpenedAtIso: string): void {
  if (Date.parse(predictionCreatedAtIso) < Date.parse(windowOpenedAtIso)) {
    throw new Error('HISTORICAL_ROWS_IN_PROSPECTIVE_WINDOW_FORBIDDEN');
  }
}

export { PROSPECTIVE_WINDOW_ID, PROSPECTIVE_REQUIRED_N, SHADOW_CUTOFF_MINUTES };
