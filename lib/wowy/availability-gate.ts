/**
 * Pregame availability → WOWY scenario. Never reads box scores or `"00"` DNP.
 *
 * Current injury tape has Out / Questionable / … and no Available membership.
 * WITH cannot be certified from that vocabulary. Missing evidence stays unknown.
 */

import type { WowyScenarioSelection } from './types';
import { WOWY_SCENARIO_UNKNOWN } from './model-adapter';

export const WOWY_R1_WITHOUT_STATUSES = ['Out', 'Out For Season'] as const;

export type WowyUnavailableReason =
  | 'pregame_availability_unknown'
  | 'observation_on_or_after_cutoff'
  | 'no_primary_teammate'
  | 'status_not_binary'
  | 'no_available_membership_vocabulary';

export type PregameAvailabilityObservation = {
  playerId: string;
  teamId: string | null;
  status: string;
  /** Court Context observation time. Must be strictly before cutoff to count. */
  snapshotAt: string;
  gameId?: string | null;
};

export type AvailabilityGateResult = {
  scenario: WowyScenarioSelection;
  predictiveEligible: boolean;
  reason: WowyUnavailableReason | null;
  usedSnapshotAt: string | null;
  usedStatus: string | null;
};

function isWithoutStatus(status: string): boolean {
  return (WOWY_R1_WITHOUT_STATUSES as readonly string[]).includes(status);
}

/**
 * Latest observation for this player strictly before cutoff.
 * Target-game box / realized minutes are not parameters and cannot be used.
 */
export function selectObservedPregameScenario(args: {
  teammatePlayerId: string;
  cutoffStartTime: string;
  observations: PregameAvailabilityObservation[];
}): AvailabilityGateResult {
  const cutoffMs = Date.parse(args.cutoffStartTime);
  if (!Number.isFinite(cutoffMs)) {
    return {
      scenario: WOWY_SCENARIO_UNKNOWN,
      predictiveEligible: false,
      reason: 'pregame_availability_unknown',
      usedSnapshotAt: null,
      usedStatus: null,
    };
  }

  const eligible = args.observations.filter((row) => {
    if (row.playerId !== args.teammatePlayerId) return false;
    const t = Date.parse(row.snapshotAt);
    return Number.isFinite(t) && t < cutoffMs;
  });

  if (eligible.length === 0) {
    const hadLater = args.observations.some((row) => {
      if (row.playerId !== args.teammatePlayerId) return false;
      const t = Date.parse(row.snapshotAt);
      return Number.isFinite(t) && t >= cutoffMs;
    });
    return {
      scenario: WOWY_SCENARIO_UNKNOWN,
      predictiveEligible: false,
      reason: hadLater ? 'observation_on_or_after_cutoff' : 'pregame_availability_unknown',
      usedSnapshotAt: null,
      usedStatus: null,
    };
  }

  eligible.sort((a, b) => Date.parse(b.snapshotAt) - Date.parse(a.snapshotAt));
  const latest = eligible[0];
  if (!isWithoutStatus(latest.status)) {
    return {
      scenario: WOWY_SCENARIO_UNKNOWN,
      predictiveEligible: false,
      reason: latest.status ? 'status_not_binary' : 'pregame_availability_unknown',
      usedSnapshotAt: latest.snapshotAt,
      usedStatus: latest.status,
    };
  }

  return {
    scenario: {
      status: 'observed_pregame',
      choice: 'without',
      source: 'timestamped_pregame_availability',
      observedAt: latest.snapshotAt,
    },
    predictiveEligible: true,
    reason: null,
    usedSnapshotAt: latest.snapshotAt,
    usedStatus: latest.status,
  };
}

export function hypotheticalScenario(choice: 'with' | 'without'): WowyScenarioSelection {
  return { status: 'hypothetical', choice, source: 'user_explicit' };
}
