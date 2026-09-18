/**
 * matchup-context-v1 dimension definitions.
 *
 * Structured dimensions only — no new scalar registry metrics.
 * Consumes player-role-context-v1, recent-form-context-v1, opponent-context-v1.
 */

import {
  MATCHUP_CONTEXT_VERSION,
  OPPONENT_CONTEXT_VERSION,
  PLAYER_ROLE_CONTEXT_VERSION,
  RECENT_FORM_CONTEXT_VERSION,
} from '../types';

export const MATCHUP_DIMENSION_ID = {
  SCORING_ENVIRONMENT: 'matchup.scoring_environment',
  PERIMETER: 'matchup.perimeter',
} as const;

export type MatchupDimensionId =
  (typeof MATCHUP_DIMENSION_ID)[keyof typeof MATCHUP_DIMENSION_ID];

export type MatchupInputRef = {
  contextId: string;
  sourceVersion: string;
  required: boolean;
};

export type MatchupDimensionDefinition = {
  dimensionId: MatchupDimensionId;
  version: typeof MATCHUP_CONTEXT_VERSION;
  family: 'MATCHUP';
  grain: 'PLAYER_GAME';
  requiredInputs: readonly MatchupInputRef[];
  optionalInputs: readonly MatchupInputRef[];
  semanticDescription: string;
  completenessPolicy: 'matchup-dimension-completeness-v1';
  newScalar: false;
};

const ROLE_V = PLAYER_ROLE_CONTEXT_VERSION;
const FORM_V = RECENT_FORM_CONTEXT_VERSION;
const OPP_V = OPPONENT_CONTEXT_VERSION;

function req(contextId: string, sourceVersion: string): MatchupInputRef {
  return { contextId, sourceVersion, required: true };
}

function opt(contextId: string, sourceVersion: string): MatchupInputRef {
  return { contextId, sourceVersion, required: false };
}

export const SCORING_ENVIRONMENT_DEFINITION: MatchupDimensionDefinition = {
  dimensionId: MATCHUP_DIMENSION_ID.SCORING_ENVIRONMENT,
  version: MATCHUP_CONTEXT_VERSION,
  family: 'MATCHUP',
  grain: 'PLAYER_GAME',
  requiredInputs: [
    req('form.recent_points', FORM_V),
    req('opponent.defensive_rating', OPP_V),
  ],
  optionalInputs: [
    opt('form.season_points', FORM_V),
    opt('role.recent_fga', ROLE_V),
    opt('role.recent_fta', ROLE_V),
    opt('opponent.pace', OPP_V),
  ],
  semanticDescription:
    "Structured view of the player's recent scoring production and opportunity alongside the opponent's historical defensive scoring environment. Not a projection or favorability score.",
  completenessPolicy: 'matchup-dimension-completeness-v1',
  newScalar: false,
};

export const PERIMETER_DEFINITION: MatchupDimensionDefinition = {
  dimensionId: MATCHUP_DIMENSION_ID.PERIMETER,
  version: MATCHUP_CONTEXT_VERSION,
  family: 'MATCHUP',
  grain: 'PLAYER_GAME',
  requiredInputs: [
    req('role.recent_tpa', ROLE_V),
    req('opponent.three_point_attempt_rate_allowed', OPP_V),
  ],
  optionalInputs: [
    opt('role.season_tpa', ROLE_V),
    opt('form.season_tpm', FORM_V),
    opt('form.recent_tpm', FORM_V),
    opt('form.season_three_pct', FORM_V),
    opt('form.recent_three_pct', FORM_V),
  ],
  semanticDescription:
    "Structured view of the player's three-point volume/production alongside the opponent's historical 3PA-rate-allowed (volume environment). Not opponent 3P% defense or expected makes.",
  completenessPolicy: 'matchup-dimension-completeness-v1',
  newScalar: false,
};

export const MATCHUP_DIMENSION_DEFINITIONS: readonly MatchupDimensionDefinition[] = [
  SCORING_ENVIRONMENT_DEFINITION,
  PERIMETER_DEFINITION,
];

/** Locked: no new scalar Matchup registry IDs. */
export const MATCHUP_CONTEXT_V1_NEW_SCALAR_FIELDS: readonly string[] = [];
