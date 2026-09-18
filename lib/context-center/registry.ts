/**
 * Context Center registry — definitions for Availability + Team Injury Burden V2.
 * Predictive status for new V2 derived contexts starts NOT_TESTED.
 * Display starts RESEARCH; certification may promote to DISPLAYABLE.
 */

import {
  CONTEXT_DISPLAY_STATUS,
  CONTEXT_FAMILY,
  CONTEXT_GRAIN,
  CONTEXT_KIND,
  CONTEXT_PREDICTIVE_STATUS,
  CONTEXT_REGISTRY_VERSION,
  CONTEXT_VALUE_TYPE,
  OPPONENT_CONTEXT_VERSION,
  PLAYER_ROLE_CONTEXT_VERSION,
  RECENT_FORM_CONTEXT_VERSION,
  SCHEDULE_CONTEXT_VERSION,
  TEAM_INJURY_CONTEXT_VERSION,
  type ContextDefinition,
} from './types';
import {
  MATCHUP_CONTEXT_V1_NEW_SCALAR_FIELDS,
  MATCHUP_DIMENSION_DEFINITIONS,
} from './matchup/definitions';

const TAPE = 'official-injury-asof-t60-v1';
const REASON = 'official-injury-reason-policy-v1';
const IDENTITY = 'official-injury-player-identity-v1';
const ROLE = 'player-role-expectation-v1';
const AS_OF = 'tip_minus_60m';
const COMPLETENESS = 'team-injury-completeness-v1';
const GAMES = 'analytics.games';
const PGL = 'analytics.player_game_logs';
const SCHEDULE_AS_OF = 'prior_final_start_time_lt_tip';
const SCHEDULE_COMPLETENESS = 'schedule-completeness-v1';
const OPPONENT_AS_OF = 'opponent_prior_final_start_time_lt_tip';
const OPPONENT_COMPLETENESS = 'opponent-completeness-v1';
const OPPONENT_SOURCE = `${PGL}+${GAMES}+opponent-team-box-pgl-v1`;
const ROLE_AS_OF = 'prior_played_start_time_lt_tip';
const ROLE_COMPLETENESS = 'player-role-completeness-v1';
const ROLE_SOURCE = `${PGL}+classifyWowyAppearance+player-role-expectation-v1`;
const FORM_AS_OF = 'prior_played_start_time_lt_tip';
const FORM_COMPLETENESS = 'recent-form-completeness-v1';
const FORM_SOURCE = `${PGL}+classifyWowyAppearance+recent-form-context-v1`;

function formDef(
  contextId: string,
  valueType: ContextDefinition['valueType'],
  description: string
): ContextDefinition {
  return {
    contextId,
    version: RECENT_FORM_CONTEXT_VERSION,
    family: CONTEXT_FAMILY.RECENT_FORM,
    grain: CONTEXT_GRAIN.PLAYER_GAME,
    valueType,
    kind: CONTEXT_KIND.DERIVED_CONTEXT,
    sourceType: FORM_SOURCE,
    sourceDescription: description,
    asOfPolicy: FORM_AS_OF,
    completenessPolicy: FORM_COMPLETENESS,
    displayStatus: CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
    predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_TESTED,
    mayAdjustProjection: false,
  };
}

function roleDef(contextId: string, description: string): ContextDefinition {
  return {
    contextId,
    version: PLAYER_ROLE_CONTEXT_VERSION,
    family: CONTEXT_FAMILY.ROLE,
    grain: CONTEXT_GRAIN.PLAYER_GAME,
    valueType: CONTEXT_VALUE_TYPE.STAT,
    kind: CONTEXT_KIND.DERIVED_CONTEXT,
    sourceType: ROLE_SOURCE,
    sourceDescription: description,
    asOfPolicy: ROLE_AS_OF,
    completenessPolicy: ROLE_COMPLETENESS,
    displayStatus: CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
    predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_TESTED,
    mayAdjustProjection: false,
  };
}

function sourceFact(
  contextId: string,
  valueType: ContextDefinition['valueType'],
  description: string
): ContextDefinition {
  return {
    contextId,
    version: TEAM_INJURY_CONTEXT_VERSION,
    family: CONTEXT_FAMILY.AVAILABILITY,
    grain: CONTEXT_GRAIN.TEAM_GAME,
    valueType,
    kind: CONTEXT_KIND.SOURCE_FACT,
    sourceType: `${TAPE}+${REASON}+${IDENTITY}`,
    sourceDescription: description,
    asOfPolicy: AS_OF,
    completenessPolicy: COMPLETENESS,
    displayStatus: CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
    predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_TESTED,
    mayAdjustProjection: false,
  };
}

function derived(
  contextId: string,
  valueType: ContextDefinition['valueType'],
  description: string
): ContextDefinition {
  return {
    contextId,
    version: TEAM_INJURY_CONTEXT_VERSION,
    family: CONTEXT_FAMILY.AVAILABILITY,
    grain: CONTEXT_GRAIN.TEAM_GAME,
    valueType,
    kind: CONTEXT_KIND.DERIVED_CONTEXT,
    sourceType: `${TAPE}+${ROLE}`,
    sourceDescription: description,
    asOfPolicy: AS_OF,
    completenessPolicy: COMPLETENESS,
    displayStatus: CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
    predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_TESTED,
    mayAdjustProjection: false,
  };
}

function opponentDef(
  contextId: string,
  description: string
): ContextDefinition {
  return {
    contextId,
    version: OPPONENT_CONTEXT_VERSION,
    family: CONTEXT_FAMILY.OPPONENT,
    grain: CONTEXT_GRAIN.TEAM_GAME,
    valueType: CONTEXT_VALUE_TYPE.STAT,
    kind: CONTEXT_KIND.DERIVED_CONTEXT,
    sourceType: OPPONENT_SOURCE,
    sourceDescription: description,
    asOfPolicy: OPPONENT_AS_OF,
    completenessPolicy: OPPONENT_COMPLETENESS,
    displayStatus: CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
    predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_TESTED,
    mayAdjustProjection: false,
  };
}

function scheduleDef(
  contextId: string,
  kind: ContextDefinition['kind'],
  valueType: ContextDefinition['valueType'],
  description: string
): ContextDefinition {
  return {
    contextId,
    version: SCHEDULE_CONTEXT_VERSION,
    family: CONTEXT_FAMILY.SCHEDULE,
    grain: CONTEXT_GRAIN.TEAM_GAME,
    valueType,
    kind,
    sourceType: GAMES,
    sourceDescription: description,
    asOfPolicy: SCHEDULE_AS_OF,
    completenessPolicy: SCHEDULE_COMPLETENESS,
    displayStatus: CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
    predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_TESTED,
    mayAdjustProjection: false,
  };
}

/** Historical research artifact — methodology certified, predictive NOT_SUPPORTED. */
const INDIVIDUAL_TEAMMATE_INJURY_WOWY: ContextDefinition = {
  contextId: 'research.individual_teammate_injury_wowy',
  version: 'injury-wowy-estimator-v1',
  family: CONTEXT_FAMILY.RESEARCH,
  grain: CONTEXT_GRAIN.PLAYER_GAME,
  valueType: CONTEXT_VALUE_TYPE.STAT,
  kind: CONTEXT_KIND.DERIVED_CONTEXT,
  sourceType: 'injury-wowy-estimator-v1',
  sourceDescription:
    'Certified Subject×Focal injury WOWY estimator. Predictive signal NOT_SUPPORTED. Audit only.',
  asOfPolicy: AS_OF,
  completenessPolicy: 'n/a',
  displayStatus: CONTEXT_DISPLAY_STATUS.RESEARCH,
  predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_SUPPORTED,
  mayAdjustProjection: false,
};

const AVAILABILITY_DEFINITIONS: readonly ContextDefinition[] = [
  sourceFact(
    'availability.health_out_count',
    CONTEXT_VALUE_TYPE.COUNT,
    'Canonical health-related Out count at T−60 (alias of health_out_canonical_count).'
  ),
  sourceFact(
    'availability.health_out_source_count',
    CONTEXT_VALUE_TYPE.COUNT,
    'Source health-related Out rows including unresolved identities.'
  ),
  sourceFact(
    'availability.health_out_canonical_count',
    CONTEXT_VALUE_TYPE.COUNT,
    'Canonical health-related Out players (resolved entity, eligible).'
  ),
  sourceFact(
    'availability.health_out_unresolved_count',
    CONTEXT_VALUE_TYPE.COUNT,
    'Health-related Out source rows without usable canonical identity.'
  ),
  sourceFact(
    'availability.health_questionable_count',
    CONTEXT_VALUE_TYPE.COUNT,
    'Health-related Questionable count (uncertainty only).'
  ),
  sourceFact(
    'availability.health_doubtful_count',
    CONTEXT_VALUE_TYPE.COUNT,
    'Health-related Doubtful count (uncertainty only).'
  ),
  sourceFact(
    'availability.health_probable_count',
    CONTEXT_VALUE_TYPE.COUNT,
    'Health-related Probable count (uncertainty only).'
  ),
  sourceFact(
    'availability.non_health_out_count',
    CONTEXT_VALUE_TYPE.COUNT,
    'Non-health Out count; never mixed into health burden.'
  ),
  derived(
    'injury.expected_missing_minutes',
    CONTEXT_VALUE_TYPE.MINUTES,
    'Sum of expanding same-season/team prior minutes for role-estimated health Outs.'
  ),
  derived(
    'injury.expected_missing_fga',
    CONTEXT_VALUE_TYPE.STAT,
    'Sum of expanding same-season/team prior FGA for role-estimated health Outs.'
  ),
  derived(
    'injury.expected_missing_points',
    CONTEXT_VALUE_TYPE.STAT,
    'Sum of expanding same-season/team prior PTS for role-estimated health Outs.'
  ),
  derived(
    'injury.missing_rotation_share',
    CONTEXT_VALUE_TYPE.RATE,
    'expected_missing_minutes / 240 (regulation team minutes normalization).'
  ),
  derived(
    'injury.max_missing_prior_mpg',
    CONTEXT_VALUE_TYPE.MINUTES,
    'Max prior expected minutes among role-estimated health Outs; null if none.'
  ),
  derived(
    'injury.rotation_players_out_count',
    CONTEXT_VALUE_TYPE.COUNT,
    'Count of role-estimated health Outs with expected_minutes >= 20.'
  ),
  INDIVIDUAL_TEAMMATE_INJURY_WOWY,
];

const SCHEDULE_DEFINITIONS: readonly ContextDefinition[] = [
  scheduleDef(
    'schedule.home_away',
    CONTEXT_KIND.SOURCE_FACT,
    CONTEXT_VALUE_TYPE.ENUM,
    'HOME if team_id==home_team_id else AWAY. No neutral-site flag in analytics.games.'
  ),
  scheduleDef(
    'schedule.days_rest',
    CONTEXT_KIND.DERIVED_CONTEXT,
    CONTEXT_VALUE_TYPE.COUNT,
    'ET basketball calendar off-days between prior same-season Final and target: (date_gap - 1). Null on season opener.'
  ),
  scheduleDef(
    'schedule.back_to_back',
    CONTEXT_KIND.DERIVED_CONTEXT,
    CONTEXT_VALUE_TYPE.BOOLEAN,
    'True iff days_rest===0 when prior exists; false on season opener.'
  ),
  scheduleDef(
    'schedule.is_season_opener',
    CONTEXT_KIND.DERIVED_CONTEXT,
    CONTEXT_VALUE_TYPE.BOOLEAN,
    'True when no same-season Final prior game with start_time < tip exists.'
  ),
];

const OPPONENT_DEFINITIONS: readonly ContextDefinition[] = [
  opponentDef(
    'opponent.pace',
    'Mean estimated possessions per prior same-season opponent team-game (possessions/game, not /48).'
  ),
  opponentDef(
    'opponent.defensive_rating',
    'Pooled 100 * Σ points_allowed / Σ estimated_possessions for opponent prior Finals.'
  ),
  opponentDef(
    'opponent.defensive_rebound_pct',
    'Pooled DRB / (DRB + opp_ORB) for opponent prior Finals.'
  ),
  opponentDef(
    'opponent.offensive_rebound_pct',
    'Pooled ORB / (ORB + opp_DRB) for opponent prior Finals.'
  ),
  opponentDef(
    'opponent.turnover_rate',
    'Pooled offensive TOV / (FGA + 0.44*FTA + TOV) for opponent prior Finals.'
  ),
  opponentDef(
    'opponent.three_point_attempt_rate_allowed',
    'Pooled opp_3PA / opp_FGA (volume allowed while opponent defended) for prior Finals.'
  ),
];

const ROLE_DEFINITIONS: readonly ContextDefinition[] = [
  roleDef(
    'role.season_minutes',
    'Expanding same-season/same-team prior PLAYED mean minutes as of tip (not final-season average).'
  ),
  roleDef(
    'role.recent_minutes',
    'Mean minutes over last ≤10 prior same-season/same-team PLAYED games as of tip.'
  ),
  roleDef(
    'role.season_fga',
    'Expanding same-season/same-team prior PLAYED mean FGA/game as of tip (shot opportunity, not usage).'
  ),
  roleDef(
    'role.recent_fga',
    'Mean FGA over last ≤10 prior same-season/same-team PLAYED games as of tip.'
  ),
  roleDef(
    'role.season_fta',
    'Expanding same-season/same-team prior PLAYED mean FTA/game as of tip.'
  ),
  roleDef(
    'role.recent_fta',
    'Mean FTA over last ≤10 prior same-season/same-team PLAYED games as of tip.'
  ),
  roleDef(
    'role.season_ast',
    'Expanding same-season/same-team prior PLAYED mean AST/game as of tip (creation proxy, not playmaking usage).'
  ),
  roleDef(
    'role.recent_ast',
    'Mean AST over last ≤10 prior same-season/same-team PLAYED games as of tip.'
  ),
  roleDef(
    'role.season_tpa',
    'Expanding same-season/same-team prior PLAYED mean 3PA/game as of tip (opportunity, not 3PM).'
  ),
  roleDef(
    'role.recent_tpa',
    'Mean 3PA over last ≤10 prior same-season/same-team PLAYED games as of tip.'
  ),
];

const FORM_DEFINITIONS: readonly ContextDefinition[] = [
  formDef(
    'form.season_points',
    CONTEXT_VALUE_TYPE.STAT,
    'Expanding same-season/same-team prior PLAYED mean PTS/game as of tip (historical outcome, not projection).'
  ),
  formDef(
    'form.recent_points',
    CONTEXT_VALUE_TYPE.STAT,
    'Mean PTS over last ≤10 prior same-season/same-team PLAYED games as of tip (historical outcome, not projection).'
  ),
  formDef(
    'form.season_rebounds',
    CONTEXT_VALUE_TYPE.STAT,
    'Expanding same-season/same-team prior PLAYED mean REB/game as of tip (descriptive outcome context).'
  ),
  formDef(
    'form.recent_rebounds',
    CONTEXT_VALUE_TYPE.STAT,
    'Mean REB over last ≤10 prior same-season/same-team PLAYED games as of tip.'
  ),
  formDef(
    'form.season_tpm',
    CONTEXT_VALUE_TYPE.STAT,
    'Expanding same-season/same-team prior PLAYED mean 3PM/game as of tip (realized makes; Role has 3PA).'
  ),
  formDef(
    'form.recent_tpm',
    CONTEXT_VALUE_TYPE.STAT,
    'Mean 3PM over last ≤10 prior same-season/same-team PLAYED games as of tip.'
  ),
  formDef(
    'form.season_fg_pct',
    CONTEXT_VALUE_TYPE.RATE,
    'Pooled sum(FGM)/sum(FGA) over prior same-season/same-team PLAYED games as of tip; null if 0 FGA. Fraction 0–1.'
  ),
  formDef(
    'form.recent_fg_pct',
    CONTEXT_VALUE_TYPE.RATE,
    'Pooled sum(FGM)/sum(FGA) over last ≤10 prior PLAYED games as of tip; null if 0 FGA. Fraction 0–1.'
  ),
  formDef(
    'form.season_three_pct',
    CONTEXT_VALUE_TYPE.RATE,
    'Pooled sum(3PM)/sum(3PA) over prior same-season/same-team PLAYED games as of tip; null if 0 3PA. Fraction 0–1.'
  ),
  formDef(
    'form.recent_three_pct',
    CONTEXT_VALUE_TYPE.RATE,
    'Pooled sum(3PM)/sum(3PA) over last ≤10 prior PLAYED games as of tip; null if 0 3PA. Fraction 0–1.'
  ),
];

export const CONTEXT_DEFINITIONS: readonly ContextDefinition[] = [
  ...AVAILABILITY_DEFINITIONS,
  ...SCHEDULE_DEFINITIONS,
  ...OPPONENT_DEFINITIONS,
  ...ROLE_DEFINITIONS,
  ...FORM_DEFINITIONS,
];

export { SCHEDULE_DEFINITIONS, OPPONENT_DEFINITIONS, ROLE_DEFINITIONS, FORM_DEFINITIONS };
export { MATCHUP_DIMENSION_DEFINITIONS, MATCHUP_CONTEXT_V1_NEW_SCALAR_FIELDS };

export function getContextDefinition(contextId: string): ContextDefinition | undefined {
  return CONTEXT_DEFINITIONS.find((d) => d.contextId === contextId);
}

export function assertRegistryIntegrity(): {
  ok: true;
  registryVersion: typeof CONTEXT_REGISTRY_VERSION;
  count: number;
  matchupNewScalarRegistryIds: number;
} {
  const ids = new Set<string>();
  for (const d of CONTEXT_DEFINITIONS) {
    if (!d.contextId) throw new Error('empty contextId');
    if (!d.version) throw new Error(`empty version for ${d.contextId}`);
    if (ids.has(d.contextId)) throw new Error(`duplicate contextId ${d.contextId}`);
    ids.add(d.contextId);
    if (d.contextId.startsWith('matchup.') && d.family === CONTEXT_FAMILY.MATCHUP) {
      // Matchup V1 must not register duplicate scalar metrics
      throw new Error(`unexpected Matchup scalar registry id ${d.contextId}`);
    }
    if (d.mayAdjustProjection && d.predictiveStatus !== CONTEXT_PREDICTIVE_STATUS.SUPPORTED) {
      throw new Error(`${d.contextId}: mayAdjustProjection requires SUPPORTED`);
    }
  }
  if (MATCHUP_CONTEXT_V1_NEW_SCALAR_FIELDS.length !== 0) {
    throw new Error('MATCHUP_CONTEXT_V1_NEW_SCALAR_FIELDS must be empty');
  }
  if (MATCHUP_DIMENSION_DEFINITIONS.length !== 2) {
    throw new Error('expected exactly 2 Matchup dimensions');
  }
  return {
    ok: true,
    registryVersion: CONTEXT_REGISTRY_VERSION,
    count: CONTEXT_DEFINITIONS.length,
    matchupNewScalarRegistryIds: 0,
  };
}

/** Promote derived V2 + source availability defs to DISPLAYABLE after certification. */
export function withDisplayableAvailability(
  defs: readonly ContextDefinition[] = CONTEXT_DEFINITIONS
): ContextDefinition[] {
  return defs.map((d) => {
    if (d.contextId === 'research.individual_teammate_injury_wowy') return { ...d };
    if (d.family !== CONTEXT_FAMILY.AVAILABILITY) return { ...d };
    return {
      ...d,
      displayStatus: CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
      // predictive remains NOT_TESTED (or NOT_SUPPORTED for research)
      mayAdjustProjection: false as const,
    };
  });
}
