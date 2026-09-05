/**
 * Previous-season statistical baseline (Phase 2.T.3E).
 * Reuses TeamSeasonSnapshot semantics — no second metric model.
 * Derives baseline season from the *viewed* season only (never Production pin).
 */

import { previousAnalyticsSeason } from '@/lib/teams/team-roster-continuity';
import {
  assertSnapshotSeason,
  emptyTeamSeasonSnapshot,
  type TeamSeasonSnapshot,
} from '@/lib/teams/team-season-snapshot';

export const PREVIOUS_BASELINE_UNAVAILABLE =
  'Previous season baseline unavailable';

export type PreviousSeasonBaseline = {
  /** Season the team page is viewing. */
  viewedSeason: string;
  /** Always viewedSeason − 1. */
  baselineSeason: string;
  available: boolean;
  unavailableReason: string | null;
  /** Same mapper/SQL semantics as current Team Snapshot. */
  snapshot: TeamSeasonSnapshot;
};

/** Baseline season follows the viewed season — not the Production pin. */
export function resolveBaselineSeason(viewedSeason: string): string {
  assertSnapshotSeason(viewedSeason);
  return previousAnalyticsSeason(viewedSeason);
}

/**
 * Wrap a prior-season snapshot into a labeled baseline result.
 * Caller must have fetched snapshot for baselineSeason only (no pin/latest).
 */
export function buildPreviousSeasonBaseline(args: {
  viewedSeason: string;
  /** Snapshot already scoped to resolveBaselineSeason(viewedSeason). */
  priorSnapshot: TeamSeasonSnapshot;
}): PreviousSeasonBaseline {
  const viewedSeason = assertSnapshotSeason(args.viewedSeason);
  const baselineSeason = resolveBaselineSeason(viewedSeason);

  // Fail closed if caller passed a snapshot for the wrong season.
  if (
    args.priorSnapshot.season !== baselineSeason ||
    !args.priorSnapshot.hasData
  ) {
    return {
      viewedSeason,
      baselineSeason,
      available: false,
      unavailableReason: PREVIOUS_BASELINE_UNAVAILABLE,
      snapshot: emptyTeamSeasonSnapshot(baselineSeason),
    };
  }

  return {
    viewedSeason,
    baselineSeason,
    available: true,
    unavailableReason: null,
    snapshot: args.priorSnapshot,
  };
}

/** Empty baseline for missing team / no prior data. */
export function emptyPreviousSeasonBaseline(
  viewedSeason: string
): PreviousSeasonBaseline {
  const season = assertSnapshotSeason(viewedSeason);
  const baselineSeason = resolveBaselineSeason(season);
  return {
    viewedSeason: season,
    baselineSeason,
    available: false,
    unavailableReason: PREVIOUS_BASELINE_UNAVAILABLE,
    snapshot: emptyTeamSeasonSnapshot(baselineSeason),
  };
}
