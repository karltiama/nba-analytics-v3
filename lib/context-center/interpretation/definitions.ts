/**
 * Frozen observation definition metadata for context-interpretation-v1.
 * Not Context Center registry metrics — interpretation definitions only.
 */

import {
  INTERPRETATION_ID,
  OBSERVATION_TYPE,
  TEMPLATE_KEY,
  type InterpretationId,
  type ObservationType,
  type TemplateKey,
} from './types';

export type InterpretationDefinitionMeta = {
  interpretationId: InterpretationId;
  observationType: ObservationType | string;
  requiredEvidence: readonly string[];
  optionalEvidence: readonly string[];
  templateKeys: readonly TemplateKey[];
};

export const INTERPRETATION_DEFINITIONS: readonly InterpretationDefinitionMeta[] = [
  {
    interpretationId: INTERPRETATION_ID.AVAILABILITY_SUMMARY,
    observationType: `${OBSERVATION_TYPE.FACTUAL_SUMMARY}|${OBSERVATION_TYPE.COMPLETENESS_CAVEAT}`,
    requiredEvidence: [
      'availability.health_out_count',
      'injury.expected_missing_minutes (COMPLETE)',
    ],
    optionalEvidence: [
      'availability.non_health_out_count',
      'availability.health_out_unresolved_count',
    ],
    templateKeys: [
      TEMPLATE_KEY.AVAILABILITY_HEALTH_OUT_WITH_BURDEN,
      TEMPLATE_KEY.AVAILABILITY_PARTIAL_BURDEN,
      TEMPLATE_KEY.AVAILABILITY_SOURCE_ONLY_COUNTS,
    ],
  },
  {
    interpretationId: INTERPRETATION_ID.SCHEDULE_SUMMARY,
    observationType: OBSERVATION_TYPE.FACTUAL_SUMMARY,
    requiredEvidence: [
      'schedule.home_away',
      'schedule.back_to_back',
      'schedule.is_season_opener',
    ],
    optionalEvidence: ['schedule.days_rest'],
    templateKeys: [
      TEMPLATE_KEY.SCHEDULE_SEASON_OPENER,
      TEMPLATE_KEY.SCHEDULE_B2B,
      TEMPLATE_KEY.SCHEDULE_REST,
    ],
  },
  {
    interpretationId: INTERPRETATION_ID.ROLE_PLAYING_TIME,
    observationType: OBSERVATION_TYPE.RECENT_VS_BASELINE,
    requiredEvidence: ['role.recent_minutes', 'role.season_minutes'],
    optionalEvidence: ['season_history_n', 'recent_history_n'],
    templateKeys: [TEMPLATE_KEY.ROLE_RECENT_VS_SEASON],
  },
  {
    interpretationId: INTERPRETATION_ID.ROLE_SHOT_OPPORTUNITY,
    observationType: OBSERVATION_TYPE.RECENT_VS_BASELINE,
    requiredEvidence: ['role.recent_fga', 'role.season_fga'],
    optionalEvidence: ['role.recent_fta', 'role.season_fta', 'role.recent_tpa', 'role.season_tpa'],
    templateKeys: [TEMPLATE_KEY.ROLE_SHOT_OPPORTUNITY],
  },
  {
    interpretationId: INTERPRETATION_ID.FORM_SCORING,
    observationType: OBSERVATION_TYPE.RECENT_VS_BASELINE,
    requiredEvidence: ['form.recent_points', 'form.season_points'],
    optionalEvidence: ['season_history_n', 'recent_history_n'],
    templateKeys: [TEMPLATE_KEY.FORM_RECENT_VS_SEASON],
  },
  {
    interpretationId: INTERPRETATION_ID.FORM_SHOOTING,
    observationType: OBSERVATION_TYPE.RECENT_VS_BASELINE,
    requiredEvidence: ['form FG% and/or 3P% recent/season pairs'],
    optionalEvidence: ['the other shooting pair', 'history_n'],
    templateKeys: [TEMPLATE_KEY.FORM_SHOOTING_PP],
  },
  {
    interpretationId: INTERPRETATION_ID.MATCHUP_SCORING_ENVIRONMENT,
    observationType: OBSERVATION_TYPE.RELATIONAL_MATCHUP,
    requiredEvidence: ['form.recent_points', 'opponent.defensive_rating'],
    optionalEvidence: [
      'form.season_points',
      'role.recent_fga',
      'role.recent_fta',
      'opponent.pace',
    ],
    templateKeys: [TEMPLATE_KEY.MATCHUP_SCORING_ENVIRONMENT],
  },
  {
    interpretationId: INTERPRETATION_ID.MATCHUP_PERIMETER,
    observationType: OBSERVATION_TYPE.RELATIONAL_MATCHUP,
    requiredEvidence: [
      'role.recent_tpa',
      'opponent.three_point_attempt_rate_allowed',
    ],
    optionalEvidence: [
      'role.season_tpa',
      'form.season_tpm',
      'form.recent_tpm',
      'form.season_three_pct',
      'form.recent_three_pct',
    ],
    templateKeys: [TEMPLATE_KEY.MATCHUP_PERIMETER, TEMPLATE_KEY.MATCHUP_PERIMETER_REDUCED],
  },
] as const;

export const CONTEXT_INTERPRETATION_V1_OBSERVATIONS = INTERPRETATION_DEFINITIONS.map(
  (d) => d.interpretationId
);
