/**
 * Context Center core types.
 * Aligns with approved context-center-architecture + court-context-engine-c1 layering.
 *
 * FACT / DERIVED / INTERPRETATION layering.
 * Interpretation lives in ./interpretation (deterministic, evidence-linked).
 * Predictive adjustment remains out of scope until separately validated.
 */

export const CONTEXT_REGISTRY_VERSION = 'context-registry-v1' as const;
export const CONTEXT_CENTER_CORE_VERSION = 'context-center-core-v1' as const;
export const PLAYER_ROLE_EXPECTATION_VERSION = 'player-role-expectation-v1' as const;
export const PLAYER_ROLE_CONTEXT_VERSION = 'player-role-context-v1' as const;
/** Recent role window: last ≤N prior same-season/same-team PLAYED games. */
export const PLAYER_RECENT_ROLE_WINDOW_MAX = 10 as const;
export const RECENT_FORM_CONTEXT_VERSION = 'recent-form-context-v1' as const;
/** Recent form window: last ≤N prior same-season/same-team PLAYED games (aligned with Role). */
export const PLAYER_RECENT_FORM_WINDOW_MAX = 10 as const;
export const TEAM_INJURY_CONTEXT_VERSION = 'team-injury-context-v2' as const;
export const ROTATION_PLAYER_DEFINITION_VERSION = 'rotation-player-definition-v1' as const;
export const SCHEDULE_CONTEXT_VERSION = 'schedule-context-v1' as const;
export const OPPONENT_CONTEXT_VERSION = 'opponent-context-v1' as const;
/** PGL → paired team-box reconstruction for Opponent Context (not stale TGS advanced cols). */
export const OPPONENT_TEAM_BOX_VERSION = 'opponent-team-box-pgl-v1' as const;
/** Possession estimate: 0.5*((FGA+0.44*FTA-ORB+TOV)_team + same_opp); FTA weight shared with reconstructTeamMeasures. */
export const OPPONENT_POSSESSIONS_FORMULA_VERSION = 'possessions-avg-both-sides-fta0.44-v1' as const;
export const MATCHUP_CONTEXT_VERSION = 'matchup-context-v1' as const;
export const MATCHUP_CONTEXT_MODEL = 'HYBRID' as const;
export const BASKETBALL_DATE_TIMEZONE = 'America/New_York' as const;

export const CONTEXT_GRAIN = {
  GAME: 'GAME',
  TEAM_GAME: 'TEAM_GAME',
  PLAYER_GAME: 'PLAYER_GAME',
} as const;

export type ContextGrain = (typeof CONTEXT_GRAIN)[keyof typeof CONTEXT_GRAIN];

export const CONTEXT_FAMILY = {
  AVAILABILITY: 'AVAILABILITY',
  SCHEDULE: 'SCHEDULE',
  OPPONENT: 'OPPONENT',
  ROLE: 'ROLE',
  MATCHUP: 'MATCHUP',
  RECENT_FORM: 'RECENT_FORM',
  ENVIRONMENT: 'ENVIRONMENT',
  RESEARCH: 'RESEARCH',
} as const;

export type ContextFamily = (typeof CONTEXT_FAMILY)[keyof typeof CONTEXT_FAMILY];

export const CONTEXT_KIND = {
  SOURCE_FACT: 'SOURCE_FACT',
  DERIVED_CONTEXT: 'DERIVED_CONTEXT',
} as const;

export type ContextKind = (typeof CONTEXT_KIND)[keyof typeof CONTEXT_KIND];

export const CONTEXT_VALUE_TYPE = {
  COUNT: 'count',
  RATE: 'rate',
  MINUTES: 'minutes',
  STAT: 'stat',
  ENUM: 'enum',
  BOOLEAN: 'boolean',
} as const;

export type ContextValueType = (typeof CONTEXT_VALUE_TYPE)[keyof typeof CONTEXT_VALUE_TYPE];

/** Display maturity — can we show this as context? */
export const CONTEXT_DISPLAY_STATUS = {
  NOT_READY: 'NOT_READY',
  RESEARCH: 'RESEARCH',
  DISPLAYABLE: 'DISPLAYABLE',
} as const;

export type ContextDisplayStatus =
  (typeof CONTEXT_DISPLAY_STATUS)[keyof typeof CONTEXT_DISPLAY_STATUS];

/**
 * Predictive maturity — may this modify a projection?
 * DISPLAYABLE ≠ SUPPORTED.
 */
export const CONTEXT_PREDICTIVE_STATUS = {
  NOT_TESTED: 'NOT_TESTED',
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  INCONCLUSIVE: 'INCONCLUSIVE',
  SUPPORTED: 'SUPPORTED',
} as const;

export type ContextPredictiveStatus =
  (typeof CONTEXT_PREDICTIVE_STATUS)[keyof typeof CONTEXT_PREDICTIVE_STATUS];

export const CONTEXT_COMPLETENESS = {
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  SOURCE_ONLY: 'SOURCE_ONLY',
  SOURCE_UNKNOWN: 'SOURCE_UNKNOWN',
} as const;

export type ContextCompleteness =
  (typeof CONTEXT_COMPLETENESS)[keyof typeof CONTEXT_COMPLETENESS];

export type ContextDefinition = {
  contextId: string;
  version: string;
  family: ContextFamily;
  grain: ContextGrain;
  valueType: ContextValueType;
  kind: ContextKind;
  sourceType: string;
  sourceDescription: string;
  asOfPolicy: string;
  completenessPolicy: string;
  displayStatus: ContextDisplayStatus;
  predictiveStatus: ContextPredictiveStatus;
  /** Must be false unless predictiveStatus === SUPPORTED. */
  mayAdjustProjection: false | true;
};

export const REGULATION_TEAM_MINUTES = 240; // 5 × 48
export const ROTATION_PLAYER_MIN_MPG = 20;

/** Upstream T−60 team_state values that are not usable source. */
export const SOURCE_UNKNOWN_TEAM_STATES = [
  'NOT_YET_SUBMITTED',
  'SOURCE_ABSENT',
  'TEAM_BLOCK_MISSING',
] as const;

export type SourceUnknownTeamState = (typeof SOURCE_UNKNOWN_TEAM_STATES)[number];

export function isSourceUnknownTeamState(state: string): boolean {
  return (SOURCE_UNKNOWN_TEAM_STATES as readonly string[]).includes(state);
}
