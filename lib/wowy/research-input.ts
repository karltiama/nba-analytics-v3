/**
 * Append-only WOWY research inputs. Not a prediction adjustment.
 * Captured pregame rows stay distinct from reconstructed historical rows.
 */
import type { InjuryGameAssociation } from '@/lib/injuries/game-association';

export const WOWY_RESEARCH_INPUT_VERSION = 'wowy-research-input-r1';

export type WowyResearchValueKind = 'captured_pregame' | 'reconstructed_historical';

export type WowyResearchAvailabilityState = 'with' | 'without' | 'unknown';

export type WowyResearchInputRecord = {
  playerId: string;
  gameId: string;
  intendedCutoffAt: string;
  teammateIds: string[];
  teammateSelection: 'prior_minutes_primary';
  wowyHistory: Record<string, unknown> | null;
  sampleSupport: {
    withGames: number;
    withoutGames: number;
    tier: string;
  };
  calculationVersion: string;
  pregameAvailability: {
    providerStatus: string | null;
    lastObservedAt: string | null;
    lastChangedAt: string | null;
    reportMembership: 'in_report' | 'removed_from_report' | 'not_in_report' | 'unknown';
  };
  availabilityState: WowyResearchAvailabilityState;
  valueKind: WowyResearchValueKind;
  gameAssociation: InjuryGameAssociation;
};

export function buildWowyResearchInput(
  partial: Omit<WowyResearchInputRecord, 'teammateSelection'> & {
    teammateSelection?: WowyResearchInputRecord['teammateSelection'];
  }
): WowyResearchInputRecord {
  if (partial.valueKind === 'captured_pregame' && partial.pregameAvailability.lastObservedAt == null) {
    throw new Error('captured_pregame requires lastObservedAt');
  }
  if (partial.availabilityState === 'with') {
    throw new Error('WITH is not selectable from BDL injuries; leave unknown');
  }
  return {
    ...partial,
    teammateSelection: partial.teammateSelection ?? 'prior_minutes_primary',
  };
}

export const INSERT_WOWY_RESEARCH_INPUT_SQL = `
INSERT INTO analytics.wowy_research_inputs (
  player_id, game_id, intended_cutoff_at, teammate_ids, teammate_selection,
  wowy_history, sample_support, calculation_version, pregame_availability,
  availability_state, value_kind, game_association, captured_at
) VALUES (
  $1, $2, $3, $4::jsonb, $5,
  $6::jsonb, $7::jsonb, $8, $9::jsonb,
  $10, $11, $12::jsonb, now()
)
`;
