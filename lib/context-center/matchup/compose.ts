/**
 * matchup-context-v1 composer.
 *
 * HYBRID: composes certified Role / Form / Opponent snapshots into relational
 * dimension views. Does not recompute histories, invent scores, or transform values.
 */

import type { RecentFormContextSnapshot } from '../form/recent-form-context';
import type { OpponentContextSnapshot } from '../opponent/snapshot';
import type { PlayerRoleContextSnapshot } from '../role/player-role-context';
import {
  CONTEXT_COMPLETENESS,
  CONTEXT_DISPLAY_STATUS,
  CONTEXT_PREDICTIVE_STATUS,
  MATCHUP_CONTEXT_MODEL,
  MATCHUP_CONTEXT_VERSION,
  OPPONENT_CONTEXT_VERSION,
  PLAYER_ROLE_CONTEXT_VERSION,
  RECENT_FORM_CONTEXT_VERSION,
  type ContextCompleteness,
} from '../types';
import {
  MATCHUP_DIMENSION_DEFINITIONS,
  MATCHUP_DIMENSION_ID,
  PERIMETER_DEFINITION,
  SCORING_ENVIRONMENT_DEFINITION,
  type MatchupDimensionDefinition,
  type MatchupDimensionId,
} from './definitions';

export type MatchupResolvedInput = {
  contextId: string;
  sourceVersion: string;
  required: boolean;
  value: number | null;
  present: boolean;
};

export type MatchupDimensionSnapshot = {
  dimensionId: MatchupDimensionId;
  version: typeof MATCHUP_CONTEXT_VERSION;
  required: Record<string, MatchupResolvedInput>;
  optional: Record<string, MatchupResolvedInput>;
  completeness: ContextCompleteness;
  usable: boolean;
};

export type MatchupContextSnapshot = {
  grain: 'PLAYER_GAME';
  gameId: string;
  playerEntityId: string;
  teamId: string;
  opponentTeamId: string;
  season: string;
  targetGameStart: string;
  contextVersion: typeof MATCHUP_CONTEXT_VERSION;
  model: typeof MATCHUP_CONTEXT_MODEL;
  scoringEnvironment: MatchupDimensionSnapshot;
  perimeter: MatchupDimensionSnapshot;
  completeness: { status: ContextCompleteness };
  provenance: {
    version: typeof MATCHUP_CONTEXT_VERSION;
    model: typeof MATCHUP_CONTEXT_MODEL;
    roleContextVersion: typeof PLAYER_ROLE_CONTEXT_VERSION;
    formContextVersion: typeof RECENT_FORM_CONTEXT_VERSION;
    opponentContextVersion: typeof OPPONENT_CONTEXT_VERSION;
    newScalarFields: readonly [];
    dimensions: readonly MatchupDimensionId[];
  };
  predictiveStatus: typeof CONTEXT_PREDICTIVE_STATUS.NOT_TESTED;
  displayStatus:
    | typeof CONTEXT_DISPLAY_STATUS.DISPLAYABLE
    | typeof CONTEXT_DISPLAY_STATUS.RESEARCH;
};

export class MatchupCompositionError extends Error {
  readonly code: 'TARGET_MISMATCH' | 'PLAYER_MISMATCH' | 'TEAM_MISMATCH' | 'OPPONENT_INVERSION' | 'VERSION_MISMATCH' | 'IDENTITY';

  constructor(
    code: MatchupCompositionError['code'],
    message: string
  ) {
    super(message);
    this.name = 'MatchupCompositionError';
    this.code = code;
  }
}

function isPresent(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

function resolveInput(
  contextId: string,
  sourceVersion: string,
  required: boolean,
  value: number | null | undefined
): MatchupResolvedInput {
  const v = value == null ? null : Number(value);
  const present = isPresent(v);
  return {
    contextId,
    sourceVersion,
    required,
    value: present ? v : null,
    present,
  };
}

function dimensionCompleteness(
  required: MatchupResolvedInput[],
  optional: MatchupResolvedInput[]
): ContextCompleteness {
  if (!required.every((r) => r.present)) {
    return CONTEXT_COMPLETENESS.SOURCE_ONLY;
  }
  if (optional.every((o) => o.present)) {
    return CONTEXT_COMPLETENESS.COMPLETE;
  }
  return CONTEXT_COMPLETENESS.PARTIAL;
}

function overallCompleteness(
  dims: MatchupDimensionSnapshot[]
): ContextCompleteness {
  const statuses = dims.map((d) => d.completeness);
  if (statuses.every((s) => s === CONTEXT_COMPLETENESS.COMPLETE)) {
    return CONTEXT_COMPLETENESS.COMPLETE;
  }
  const usable = dims.some(
    (d) =>
      d.completeness === CONTEXT_COMPLETENESS.COMPLETE ||
      d.completeness === CONTEXT_COMPLETENESS.PARTIAL
  );
  if (usable) return CONTEXT_COMPLETENESS.PARTIAL;
  if (statuses.every((s) => s === CONTEXT_COMPLETENESS.SOURCE_ONLY)) {
    return CONTEXT_COMPLETENESS.SOURCE_ONLY;
  }
  return CONTEXT_COMPLETENESS.SOURCE_UNKNOWN;
}

function assertVersions(
  role: PlayerRoleContextSnapshot,
  form: RecentFormContextSnapshot,
  opponent: OpponentContextSnapshot
): void {
  if (role.contextVersion !== PLAYER_ROLE_CONTEXT_VERSION) {
    throw new MatchupCompositionError(
      'VERSION_MISMATCH',
      `role version ${role.contextVersion} != ${PLAYER_ROLE_CONTEXT_VERSION}`
    );
  }
  if (form.contextVersion !== RECENT_FORM_CONTEXT_VERSION) {
    throw new MatchupCompositionError(
      'VERSION_MISMATCH',
      `form version ${form.contextVersion} != ${RECENT_FORM_CONTEXT_VERSION}`
    );
  }
  if (opponent.contextVersion !== OPPONENT_CONTEXT_VERSION) {
    throw new MatchupCompositionError(
      'VERSION_MISMATCH',
      `opponent version ${opponent.contextVersion} != ${OPPONENT_CONTEXT_VERSION}`
    );
  }
}

function assertAlignment(
  role: PlayerRoleContextSnapshot,
  form: RecentFormContextSnapshot,
  opponent: OpponentContextSnapshot
): void {
  if (role.gameId !== form.gameId || role.gameId !== opponent.gameId) {
    throw new MatchupCompositionError(
      'TARGET_MISMATCH',
      `gameId mismatch role=${role.gameId} form=${form.gameId} opp=${opponent.gameId}`
    );
  }
  if (role.targetGameStart !== form.targetGameStart || role.targetGameStart !== opponent.targetGameStart) {
    throw new MatchupCompositionError(
      'TARGET_MISMATCH',
      `targetGameStart mismatch`
    );
  }
  if (role.playerEntityId !== form.playerEntityId) {
    throw new MatchupCompositionError(
      'PLAYER_MISMATCH',
      `player mismatch role=${role.playerEntityId} form=${form.playerEntityId}`
    );
  }
  if (role.teamId !== form.teamId) {
    throw new MatchupCompositionError(
      'TEAM_MISMATCH',
      `role/form team mismatch role=${role.teamId} form=${form.teamId}`
    );
  }
  // Opponent snapshot must be owned by the player's team (profile = opposing team)
  if (String(opponent.teamId) !== String(role.teamId)) {
    throw new MatchupCompositionError(
      'TEAM_MISMATCH',
      `opponent owner team ${opponent.teamId} != player team ${role.teamId}`
    );
  }
  if (String(opponent.opponentTeamId) === String(role.teamId)) {
    throw new MatchupCompositionError(
      'OPPONENT_INVERSION',
      `opponentTeamId equals player team (inverted ownership)`
    );
  }
  if (String(role.teamId) === String(opponent.opponentTeamId)) {
    throw new MatchupCompositionError(
      'IDENTITY',
      `team_id === opponent_team_id`
    );
  }
}

function buildScoring(
  role: PlayerRoleContextSnapshot,
  form: RecentFormContextSnapshot,
  opponent: OpponentContextSnapshot
): MatchupDimensionSnapshot {
  const def = SCORING_ENVIRONMENT_DEFINITION;
  const required = {
    'form.recent_points': resolveInput(
      'form.recent_points',
      RECENT_FORM_CONTEXT_VERSION,
      true,
      form.recentForm.points
    ),
    'opponent.defensive_rating': resolveInput(
      'opponent.defensive_rating',
      OPPONENT_CONTEXT_VERSION,
      true,
      opponent.opponent.defensiveRating
    ),
  };
  const optional = {
    'form.season_points': resolveInput(
      'form.season_points',
      RECENT_FORM_CONTEXT_VERSION,
      false,
      form.seasonForm.points
    ),
    'role.recent_fga': resolveInput(
      'role.recent_fga',
      PLAYER_ROLE_CONTEXT_VERSION,
      false,
      role.recentRole.fga
    ),
    'role.recent_fta': resolveInput(
      'role.recent_fta',
      PLAYER_ROLE_CONTEXT_VERSION,
      false,
      role.recentRole.fta
    ),
    'opponent.pace': resolveInput(
      'opponent.pace',
      OPPONENT_CONTEXT_VERSION,
      false,
      opponent.opponent.pace
    ),
  };
  const completeness = dimensionCompleteness(
    Object.values(required),
    Object.values(optional)
  );
  return {
    dimensionId: def.dimensionId,
    version: MATCHUP_CONTEXT_VERSION,
    required,
    optional,
    completeness,
    usable:
      completeness === CONTEXT_COMPLETENESS.COMPLETE ||
      completeness === CONTEXT_COMPLETENESS.PARTIAL,
  };
}

function buildPerimeter(
  role: PlayerRoleContextSnapshot,
  form: RecentFormContextSnapshot,
  opponent: OpponentContextSnapshot
): MatchupDimensionSnapshot {
  const def = PERIMETER_DEFINITION;
  const required = {
    'role.recent_tpa': resolveInput(
      'role.recent_tpa',
      PLAYER_ROLE_CONTEXT_VERSION,
      true,
      role.recentRole.tpa
    ),
    'opponent.three_point_attempt_rate_allowed': resolveInput(
      'opponent.three_point_attempt_rate_allowed',
      OPPONENT_CONTEXT_VERSION,
      true,
      opponent.opponent.threePointAttemptRateAllowed
    ),
  };
  const optional = {
    'role.season_tpa': resolveInput(
      'role.season_tpa',
      PLAYER_ROLE_CONTEXT_VERSION,
      false,
      role.seasonRole.tpa
    ),
    'form.season_tpm': resolveInput(
      'form.season_tpm',
      RECENT_FORM_CONTEXT_VERSION,
      false,
      form.seasonForm.tpm
    ),
    'form.recent_tpm': resolveInput(
      'form.recent_tpm',
      RECENT_FORM_CONTEXT_VERSION,
      false,
      form.recentForm.tpm
    ),
    'form.season_three_pct': resolveInput(
      'form.season_three_pct',
      RECENT_FORM_CONTEXT_VERSION,
      false,
      form.seasonForm.threePct
    ),
    'form.recent_three_pct': resolveInput(
      'form.recent_three_pct',
      RECENT_FORM_CONTEXT_VERSION,
      false,
      form.recentForm.threePct
    ),
  };
  const completeness = dimensionCompleteness(
    Object.values(required),
    Object.values(optional)
  );
  return {
    dimensionId: def.dimensionId,
    version: MATCHUP_CONTEXT_VERSION,
    required,
    optional,
    completeness,
    usable:
      completeness === CONTEXT_COMPLETENESS.COMPLETE ||
      completeness === CONTEXT_COMPLETENESS.PARTIAL,
  };
}

/**
 * Compose Matchup from certified upstream snapshots.
 * Throws MatchupCompositionError on identity/version/inversion failures.
 */
export function composeMatchupContext(args: {
  role: PlayerRoleContextSnapshot;
  form: RecentFormContextSnapshot;
  opponent: OpponentContextSnapshot;
  displayStatus?: MatchupContextSnapshot['displayStatus'];
}): MatchupContextSnapshot {
  const { role, form, opponent } = args;
  assertVersions(role, form, opponent);
  assertAlignment(role, form, opponent);

  const scoringEnvironment = buildScoring(role, form, opponent);
  const perimeter = buildPerimeter(role, form, opponent);
  const completenessStatus = overallCompleteness([scoringEnvironment, perimeter]);

  return {
    grain: 'PLAYER_GAME',
    gameId: String(role.gameId),
    playerEntityId: String(role.playerEntityId),
    teamId: String(role.teamId),
    opponentTeamId: String(opponent.opponentTeamId),
    season: String(role.season),
    targetGameStart: role.targetGameStart,
    contextVersion: MATCHUP_CONTEXT_VERSION,
    model: MATCHUP_CONTEXT_MODEL,
    scoringEnvironment,
    perimeter,
    completeness: { status: completenessStatus },
    provenance: {
      version: MATCHUP_CONTEXT_VERSION,
      model: MATCHUP_CONTEXT_MODEL,
      roleContextVersion: PLAYER_ROLE_CONTEXT_VERSION,
      formContextVersion: RECENT_FORM_CONTEXT_VERSION,
      opponentContextVersion: OPPONENT_CONTEXT_VERSION,
      newScalarFields: [],
      dimensions: [
        MATCHUP_DIMENSION_ID.SCORING_ENVIRONMENT,
        MATCHUP_DIMENSION_ID.PERIMETER,
      ],
    },
    predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_TESTED,
    displayStatus: args.displayStatus ?? CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
  };
}

/** Source-value parity: every resolved Matchup input equals upstream field. */
export function assertMatchupInputValueParity(snap: MatchupContextSnapshot): void {
  for (const dim of [snap.scoringEnvironment, snap.perimeter]) {
    for (const inp of [...Object.values(dim.required), ...Object.values(dim.optional)]) {
      if (inp.present && inp.value == null) {
        throw new Error(`parity: present but null ${inp.contextId}`);
      }
      if (!inp.present && inp.value != null) {
        throw new Error(`parity: absent but value set ${inp.contextId}`);
      }
    }
  }
}

export function getMatchupDimensionDefinition(
  dimensionId: MatchupDimensionId
): MatchupDimensionDefinition | undefined {
  return MATCHUP_DIMENSION_DEFINITIONS.find((d) => d.dimensionId === dimensionId);
}
