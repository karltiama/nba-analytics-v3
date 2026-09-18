/**
 * context-interpretation-v1 types.
 *
 * DETERMINISTIC_EVIDENCE_LINKED observations from certified Context Center snapshots.
 * No LLM, scores, polarity, or predictive claims.
 */

import type { ContextCompleteness } from '../types';
import {
  MATCHUP_CONTEXT_VERSION,
  OPPONENT_CONTEXT_VERSION,
  PLAYER_ROLE_CONTEXT_VERSION,
  RECENT_FORM_CONTEXT_VERSION,
  SCHEDULE_CONTEXT_VERSION,
  TEAM_INJURY_CONTEXT_VERSION,
} from '../types';

export const CONTEXT_INTERPRETATION_VERSION = 'context-interpretation-v1' as const;
export const CONTEXT_INTERPRETATION_MODEL = 'DETERMINISTIC_EVIDENCE_LINKED' as const;
export const CORE_INTERPRETATION_LLM_POLICY = 'NO_LLM' as const;

export const INTERPRETATION_ID = {
  AVAILABILITY_SUMMARY: 'interpretation.availability_summary',
  SCHEDULE_SUMMARY: 'interpretation.schedule_summary',
  ROLE_PLAYING_TIME: 'interpretation.role_playing_time',
  ROLE_SHOT_OPPORTUNITY: 'interpretation.role_shot_opportunity',
  FORM_SCORING: 'interpretation.form_scoring',
  FORM_SHOOTING: 'interpretation.form_shooting',
  MATCHUP_SCORING_ENVIRONMENT: 'interpretation.matchup_scoring_environment',
  MATCHUP_PERIMETER: 'interpretation.matchup_perimeter',
} as const;

export type InterpretationId =
  (typeof INTERPRETATION_ID)[keyof typeof INTERPRETATION_ID];

/** Frozen V1 observation order (presentation, not importance). */
export const INTERPRETATION_V1_ORDER: readonly InterpretationId[] = [
  INTERPRETATION_ID.AVAILABILITY_SUMMARY,
  INTERPRETATION_ID.SCHEDULE_SUMMARY,
  INTERPRETATION_ID.ROLE_PLAYING_TIME,
  INTERPRETATION_ID.ROLE_SHOT_OPPORTUNITY,
  INTERPRETATION_ID.FORM_SCORING,
  INTERPRETATION_ID.FORM_SHOOTING,
  INTERPRETATION_ID.MATCHUP_SCORING_ENVIRONMENT,
  INTERPRETATION_ID.MATCHUP_PERIMETER,
] as const;

export const OBSERVATION_TYPE = {
  FACTUAL_SUMMARY: 'FACTUAL_SUMMARY',
  RECENT_VS_BASELINE: 'RECENT_VS_BASELINE',
  RELATIONAL_MATCHUP: 'RELATIONAL_MATCHUP',
  COMPLETENESS_CAVEAT: 'COMPLETENESS_CAVEAT',
} as const;

export type ObservationType =
  (typeof OBSERVATION_TYPE)[keyof typeof OBSERVATION_TYPE];

export const INTERPRETATION_DIMENSION = {
  AVAILABILITY: 'AVAILABILITY',
  SCHEDULE: 'SCHEDULE',
  ROLE: 'ROLE',
  FORM: 'FORM',
  MATCHUP: 'MATCHUP',
} as const;

export type InterpretationDimension =
  (typeof INTERPRETATION_DIMENSION)[keyof typeof INTERPRETATION_DIMENSION];

export const TEMPLATE_KEY = {
  AVAILABILITY_HEALTH_OUT_WITH_BURDEN: 'AVAILABILITY_HEALTH_OUT_WITH_BURDEN',
  AVAILABILITY_PARTIAL_BURDEN: 'AVAILABILITY_PARTIAL_BURDEN',
  AVAILABILITY_SOURCE_ONLY_COUNTS: 'AVAILABILITY_SOURCE_ONLY_COUNTS',
  SCHEDULE_SEASON_OPENER: 'SCHEDULE_SEASON_OPENER',
  SCHEDULE_B2B: 'SCHEDULE_B2B',
  SCHEDULE_REST: 'SCHEDULE_REST',
  ROLE_RECENT_VS_SEASON: 'ROLE_RECENT_VS_SEASON',
  ROLE_SHOT_OPPORTUNITY: 'ROLE_SHOT_OPPORTUNITY',
  FORM_RECENT_VS_SEASON: 'FORM_RECENT_VS_SEASON',
  FORM_SHOOTING_PP: 'FORM_SHOOTING_PP',
  MATCHUP_SCORING_ENVIRONMENT: 'MATCHUP_SCORING_ENVIRONMENT',
  MATCHUP_PERIMETER: 'MATCHUP_PERIMETER',
  MATCHUP_PERIMETER_REDUCED: 'MATCHUP_PERIMETER_REDUCED',
} as const;

export type TemplateKey = (typeof TEMPLATE_KEY)[keyof typeof TEMPLATE_KEY];

export type InterpretationEvidence = {
  contextId: string;
  contextVersion: string;
  value: number | string | boolean | null;
  unit: string;
  completeness: ContextCompleteness;
};

export type InterpretationComparison = {
  recentContextId: string;
  baselineContextId: string;
  delta: number;
  unit: string;
};

export type UpstreamVersionManifest = {
  [TEAM_INJURY_CONTEXT_VERSION]?: typeof TEAM_INJURY_CONTEXT_VERSION;
  [SCHEDULE_CONTEXT_VERSION]?: typeof SCHEDULE_CONTEXT_VERSION;
  [OPPONENT_CONTEXT_VERSION]?: typeof OPPONENT_CONTEXT_VERSION;
  [PLAYER_ROLE_CONTEXT_VERSION]?: typeof PLAYER_ROLE_CONTEXT_VERSION;
  [RECENT_FORM_CONTEXT_VERSION]?: typeof RECENT_FORM_CONTEXT_VERSION;
  [MATCHUP_CONTEXT_VERSION]?: typeof MATCHUP_CONTEXT_VERSION;
  teamInjuryContext?: typeof TEAM_INJURY_CONTEXT_VERSION;
  scheduleContext?: typeof SCHEDULE_CONTEXT_VERSION;
  opponentContext?: typeof OPPONENT_CONTEXT_VERSION;
  playerRoleContext?: typeof PLAYER_ROLE_CONTEXT_VERSION;
  recentFormContext?: typeof RECENT_FORM_CONTEXT_VERSION;
  matchupContext?: typeof MATCHUP_CONTEXT_VERSION;
};

export type ContextInterpretation = {
  interpretationId: InterpretationId;
  interpretationVersion: typeof CONTEXT_INTERPRETATION_VERSION;
  gameId: string;
  playerEntityId?: string;
  teamId: string;
  opponentTeamId?: string;
  targetGameStart: string;
  observationType: ObservationType;
  dimension: InterpretationDimension;
  evidence: InterpretationEvidence[];
  comparison?: InterpretationComparison;
  templateKey: TemplateKey;
  templateParameters: Record<string, unknown>;
  completeness: ContextCompleteness;
  provenance: {
    upstreamVersions: Record<string, string>;
  };
  predictiveClaim: false;
};

export type RenderedInterpretation = {
  interpretation: ContextInterpretation;
  renderedText: string;
};

export const UPSTREAM_COMPAT = {
  teamInjury: TEAM_INJURY_CONTEXT_VERSION,
  schedule: SCHEDULE_CONTEXT_VERSION,
  opponent: OPPONENT_CONTEXT_VERSION,
  role: PLAYER_ROLE_CONTEXT_VERSION,
  form: RECENT_FORM_CONTEXT_VERSION,
  matchup: MATCHUP_CONTEXT_VERSION,
} as const;

export const DISPLAY_PRECISION = {
  minutes: 1,
  countingAverages: 1,
  ratings: 1,
  ratesAsPercent: 1,
  percentagePoints: 1,
  counts: 0,
} as const;

export const RECENT_WINDOW_FULL = 10 as const;
