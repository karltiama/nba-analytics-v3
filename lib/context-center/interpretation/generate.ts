/**
 * Deterministic interpretation generator from certified Context Center snapshots.
 * No raw-source reads. No LLM.
 */

import type { TeamGameAvailabilitySnapshot } from '../team-injury-burden';
import type { TeamGameScheduleSnapshot } from '../schedule-context';
import type { PlayerRoleContextSnapshot } from '../role/player-role-context';
import type { RecentFormContextSnapshot } from '../form/recent-form-context';
import type { MatchupContextSnapshot } from '../matchup/compose';
import {
  CONTEXT_COMPLETENESS,
  MATCHUP_CONTEXT_VERSION,
  OPPONENT_CONTEXT_VERSION,
  PLAYER_ROLE_CONTEXT_VERSION,
  RECENT_FORM_CONTEXT_VERSION,
  SCHEDULE_CONTEXT_VERSION,
  TEAM_INJURY_CONTEXT_VERSION,
  type ContextCompleteness,
} from '../types';
import { compareRecentMinusSeason } from './compare';
import { equalAtDisplayPrecision1 } from './format';
import { renderInterpretation } from './render';
import {
  CONTEXT_INTERPRETATION_VERSION,
  INTERPRETATION_DIMENSION,
  INTERPRETATION_ID,
  INTERPRETATION_V1_ORDER,
  OBSERVATION_TYPE,
  TEMPLATE_KEY,
  UPSTREAM_COMPAT,
  type ContextInterpretation,
  type InterpretationEvidence,
  type InterpretationId,
  type RenderedInterpretation,
} from './types';

export class InterpretationGenerationError extends Error {
  readonly code:
    | 'TARGET_MISMATCH'
    | 'VERSION_MISMATCH'
    | 'IDENTITY'
    | 'MISSING_BUNDLE';

  constructor(code: InterpretationGenerationError['code'], message: string) {
    super(message);
    this.name = 'InterpretationGenerationError';
    this.code = code;
  }
}

export type InterpretationInputBundle = {
  gameId: string;
  playerEntityId: string;
  teamId: string;
  opponentTeamId: string;
  targetGameStart: string;
  availability: TeamGameAvailabilitySnapshot | null;
  schedule: TeamGameScheduleSnapshot | null;
  role: PlayerRoleContextSnapshot | null;
  form: RecentFormContextSnapshot | null;
  matchup: MatchupContextSnapshot | null;
};

export type InterpretationEligibilityStatus =
  | 'full'
  | 'reduced'
  | 'suppressed'
  | 'missing_required';

export type InterpretationRunResult = {
  interpretations: ContextInterpretation[];
  rendered: RenderedInterpretation[];
  eligibility: Record<InterpretationId, InterpretationEligibilityStatus | 'skipped'>;
};

function ev(
  contextId: string,
  contextVersion: string,
  value: number | string | boolean | null,
  unit: string,
  completeness: ContextCompleteness
): InterpretationEvidence {
  return { contextId, contextVersion, value, unit, completeness };
}

function assertAligned(bundle: InterpretationInputBundle): void {
  const {
    gameId,
    playerEntityId,
    teamId,
    opponentTeamId,
    targetGameStart,
    availability,
    schedule,
    role,
    form,
    matchup,
  } = bundle;

  if (!gameId || !playerEntityId || !teamId || !opponentTeamId || !targetGameStart) {
    throw new InterpretationGenerationError('IDENTITY', 'Missing target identity fields');
  }

  if (availability) {
    if (availability.contextVersion !== UPSTREAM_COMPAT.teamInjury) {
      throw new InterpretationGenerationError(
        'VERSION_MISMATCH',
        `availability version ${availability.contextVersion}`
      );
    }
    if (availability.gameId !== gameId || availability.teamId !== teamId) {
      throw new InterpretationGenerationError(
        'TARGET_MISMATCH',
        'availability game/team mismatch'
      );
    }
  }

  if (schedule) {
    if (schedule.contextVersion !== UPSTREAM_COMPAT.schedule) {
      throw new InterpretationGenerationError(
        'VERSION_MISMATCH',
        `schedule version ${schedule.contextVersion}`
      );
    }
    if (schedule.gameId !== gameId || schedule.teamId !== teamId) {
      throw new InterpretationGenerationError(
        'TARGET_MISMATCH',
        'schedule game/team mismatch'
      );
    }
    if (schedule.gameStart !== targetGameStart) {
      throw new InterpretationGenerationError(
        'TARGET_MISMATCH',
        'schedule tip mismatch'
      );
    }
  }

  if (role) {
    if (role.contextVersion !== UPSTREAM_COMPAT.role) {
      throw new InterpretationGenerationError(
        'VERSION_MISMATCH',
        `role version ${role.contextVersion}`
      );
    }
    if (
      role.gameId !== gameId ||
      role.playerEntityId !== playerEntityId ||
      role.teamId !== teamId ||
      role.targetGameStart !== targetGameStart
    ) {
      throw new InterpretationGenerationError('TARGET_MISMATCH', 'role identity mismatch');
    }
  }

  if (form) {
    if (form.contextVersion !== UPSTREAM_COMPAT.form) {
      throw new InterpretationGenerationError(
        'VERSION_MISMATCH',
        `form version ${form.contextVersion}`
      );
    }
    if (
      form.gameId !== gameId ||
      form.playerEntityId !== playerEntityId ||
      form.teamId !== teamId ||
      form.targetGameStart !== targetGameStart
    ) {
      throw new InterpretationGenerationError('TARGET_MISMATCH', 'form identity mismatch');
    }
  }

  if (matchup) {
    if (matchup.contextVersion !== UPSTREAM_COMPAT.matchup) {
      throw new InterpretationGenerationError(
        'VERSION_MISMATCH',
        `matchup version ${matchup.contextVersion}`
      );
    }
    if (
      matchup.gameId !== gameId ||
      matchup.playerEntityId !== playerEntityId ||
      matchup.teamId !== teamId ||
      matchup.opponentTeamId !== opponentTeamId ||
      matchup.targetGameStart !== targetGameStart
    ) {
      throw new InterpretationGenerationError(
        'TARGET_MISMATCH',
        'matchup identity mismatch'
      );
    }
  }
}

function baseMeta(bundle: InterpretationInputBundle) {
  return {
    interpretationVersion: CONTEXT_INTERPRETATION_VERSION,
    gameId: bundle.gameId,
    playerEntityId: bundle.playerEntityId,
    teamId: bundle.teamId,
    opponentTeamId: bundle.opponentTeamId,
    targetGameStart: bundle.targetGameStart,
    predictiveClaim: false as const,
  };
}

function buildAvailability(
  bundle: InterpretationInputBundle
): { interp: ContextInterpretation; status: InterpretationEligibilityStatus } | null {
  const snap = bundle.availability;
  if (!snap) return null;
  const status = snap.completeness.status;
  if (status === CONTEXT_COMPLETENESS.SOURCE_UNKNOWN) {
    return null;
  }

  const healthOut =
    snap.availability.healthOutCount ?? snap.availability.healthOutCanonicalCount;
  const burden = snap.injuryBurden.expectedMissingMinutes;
  const roleRequired = snap.completeness.roleRequiredCount;
  const roleEstimated = snap.completeness.roleEstimatedCount;

  if (status === CONTEXT_COMPLETENESS.SOURCE_ONLY) {
    if (healthOut == null || !Number.isFinite(healthOut)) {
      return null;
    }
    const completeness = CONTEXT_COMPLETENESS.SOURCE_ONLY;
    return {
      status: 'reduced',
      interp: {
        ...baseMeta(bundle),
        interpretationId: INTERPRETATION_ID.AVAILABILITY_SUMMARY,
        observationType: OBSERVATION_TYPE.COMPLETENESS_CAVEAT,
        dimension: INTERPRETATION_DIMENSION.AVAILABILITY,
        evidence: [
          ev(
            'availability.health_out_count',
            TEAM_INJURY_CONTEXT_VERSION,
            healthOut,
            'count',
            completeness
          ),
        ],
        templateKey: TEMPLATE_KEY.AVAILABILITY_SOURCE_ONLY_COUNTS,
        templateParameters: { healthOutCount: healthOut },
        completeness,
        provenance: {
          upstreamVersions: { teamInjuryContext: TEAM_INJURY_CONTEXT_VERSION },
        },
      },
    };
  }

  if (status === CONTEXT_COMPLETENESS.PARTIAL) {
    if (burden == null || !Number.isFinite(burden)) {
      // Fall back to source-only wording if counts exist
      if (healthOut == null || !Number.isFinite(healthOut)) return null;
      return {
        status: 'reduced',
        interp: {
          ...baseMeta(bundle),
          interpretationId: INTERPRETATION_ID.AVAILABILITY_SUMMARY,
          observationType: OBSERVATION_TYPE.COMPLETENESS_CAVEAT,
          dimension: INTERPRETATION_DIMENSION.AVAILABILITY,
          evidence: [
            ev(
              'availability.health_out_count',
              TEAM_INJURY_CONTEXT_VERSION,
              healthOut,
              'count',
              CONTEXT_COMPLETENESS.PARTIAL
            ),
          ],
          templateKey: TEMPLATE_KEY.AVAILABILITY_SOURCE_ONLY_COUNTS,
          templateParameters: { healthOutCount: healthOut },
          completeness: CONTEXT_COMPLETENESS.PARTIAL,
          provenance: {
            upstreamVersions: { teamInjuryContext: TEAM_INJURY_CONTEXT_VERSION },
          },
        },
      };
    }
    const missingRoles = Math.max(0, roleRequired - roleEstimated);
    return {
      status: 'reduced',
      interp: {
        ...baseMeta(bundle),
        interpretationId: INTERPRETATION_ID.AVAILABILITY_SUMMARY,
        observationType: OBSERVATION_TYPE.COMPLETENESS_CAVEAT,
        dimension: INTERPRETATION_DIMENSION.AVAILABILITY,
        evidence: [
          ev(
            'injury.expected_missing_minutes',
            TEAM_INJURY_CONTEXT_VERSION,
            burden,
            'minutes',
            CONTEXT_COMPLETENESS.PARTIAL
          ),
          ev(
            'availability.health_out_count',
            TEAM_INJURY_CONTEXT_VERSION,
            healthOut,
            'count',
            CONTEXT_COMPLETENESS.PARTIAL
          ),
        ],
        templateKey: TEMPLATE_KEY.AVAILABILITY_PARTIAL_BURDEN,
        templateParameters: {
          burdenMinutesFloor: burden,
          outWithoutRoleHistory: missingRoles > 0 ? missingRoles : 1,
        },
        completeness: CONTEXT_COMPLETENESS.PARTIAL,
        provenance: {
          upstreamVersions: { teamInjuryContext: TEAM_INJURY_CONTEXT_VERSION },
        },
      },
    };
  }

  // COMPLETE
  if (
    healthOut == null ||
    !Number.isFinite(healthOut) ||
    burden == null ||
    !Number.isFinite(burden)
  ) {
    return null;
  }
  return {
    status: 'full',
    interp: {
      ...baseMeta(bundle),
      interpretationId: INTERPRETATION_ID.AVAILABILITY_SUMMARY,
      observationType: OBSERVATION_TYPE.FACTUAL_SUMMARY,
      dimension: INTERPRETATION_DIMENSION.AVAILABILITY,
      evidence: [
        ev(
          'availability.health_out_count',
          TEAM_INJURY_CONTEXT_VERSION,
          healthOut,
          'count',
          CONTEXT_COMPLETENESS.COMPLETE
        ),
        ev(
          'injury.expected_missing_minutes',
          TEAM_INJURY_CONTEXT_VERSION,
          burden,
          'minutes',
          CONTEXT_COMPLETENESS.COMPLETE
        ),
      ],
      templateKey: TEMPLATE_KEY.AVAILABILITY_HEALTH_OUT_WITH_BURDEN,
      templateParameters: {
        healthOutCount: healthOut,
        expectedMissingMinutes: burden,
      },
      completeness: CONTEXT_COMPLETENESS.COMPLETE,
      provenance: {
        upstreamVersions: { teamInjuryContext: TEAM_INJURY_CONTEXT_VERSION },
      },
    },
  };
}

function buildSchedule(
  bundle: InterpretationInputBundle
): { interp: ContextInterpretation; status: InterpretationEligibilityStatus } | null {
  const snap = bundle.schedule;
  if (!snap) return null;
  const { homeAway, daysRest, backToBack, isSeasonOpener } = snap.schedule;
  const completeness = snap.completeness.status;

  if (isSeasonOpener) {
    return {
      status: 'full',
      interp: {
        ...baseMeta(bundle),
        interpretationId: INTERPRETATION_ID.SCHEDULE_SUMMARY,
        observationType: OBSERVATION_TYPE.FACTUAL_SUMMARY,
        dimension: INTERPRETATION_DIMENSION.SCHEDULE,
        evidence: [
          ev('schedule.home_away', SCHEDULE_CONTEXT_VERSION, homeAway, 'enum', completeness),
          ev(
            'schedule.is_season_opener',
            SCHEDULE_CONTEXT_VERSION,
            true,
            'boolean',
            completeness
          ),
          ev(
            'schedule.days_rest',
            SCHEDULE_CONTEXT_VERSION,
            daysRest,
            'days',
            completeness
          ),
        ],
        templateKey: TEMPLATE_KEY.SCHEDULE_SEASON_OPENER,
        templateParameters: { homeAway, isSeasonOpener: true, daysRest: null },
        completeness,
        provenance: {
          upstreamVersions: { scheduleContext: SCHEDULE_CONTEXT_VERSION },
        },
      },
    };
  }

  if (backToBack) {
    return {
      status: 'full',
      interp: {
        ...baseMeta(bundle),
        interpretationId: INTERPRETATION_ID.SCHEDULE_SUMMARY,
        observationType: OBSERVATION_TYPE.FACTUAL_SUMMARY,
        dimension: INTERPRETATION_DIMENSION.SCHEDULE,
        evidence: [
          ev('schedule.home_away', SCHEDULE_CONTEXT_VERSION, homeAway, 'enum', completeness),
          ev(
            'schedule.back_to_back',
            SCHEDULE_CONTEXT_VERSION,
            true,
            'boolean',
            completeness
          ),
          ev(
            'schedule.days_rest',
            SCHEDULE_CONTEXT_VERSION,
            daysRest,
            'days',
            completeness
          ),
        ],
        templateKey: TEMPLATE_KEY.SCHEDULE_B2B,
        templateParameters: { homeAway, backToBack: true, daysRest },
        completeness,
        provenance: {
          upstreamVersions: { scheduleContext: SCHEDULE_CONTEXT_VERSION },
        },
      },
    };
  }

  if (daysRest == null || !Number.isFinite(daysRest)) {
    return null;
  }

  return {
    status: 'full',
    interp: {
      ...baseMeta(bundle),
      interpretationId: INTERPRETATION_ID.SCHEDULE_SUMMARY,
      observationType: OBSERVATION_TYPE.FACTUAL_SUMMARY,
      dimension: INTERPRETATION_DIMENSION.SCHEDULE,
      evidence: [
        ev('schedule.home_away', SCHEDULE_CONTEXT_VERSION, homeAway, 'enum', completeness),
        ev('schedule.days_rest', SCHEDULE_CONTEXT_VERSION, daysRest, 'days', completeness),
        ev(
          'schedule.back_to_back',
          SCHEDULE_CONTEXT_VERSION,
          false,
          'boolean',
          completeness
        ),
      ],
      templateKey: TEMPLATE_KEY.SCHEDULE_REST,
      templateParameters: { homeAway, daysRest, backToBack: false },
      completeness,
      provenance: {
        upstreamVersions: { scheduleContext: SCHEDULE_CONTEXT_VERSION },
      },
    },
  };
}

function buildRolePlayingTime(
  bundle: InterpretationInputBundle
): {
  interp: ContextInterpretation | null;
  status: InterpretationEligibilityStatus;
} {
  const role = bundle.role;
  if (!role || role.seasonRole.historyN === 0) {
    return { interp: null, status: 'missing_required' };
  }
  const cmp = compareRecentMinusSeason(
    role.recentRole.minutes,
    role.seasonRole.minutes,
    'minutes'
  );
  if (cmp.status === 'missing') return { interp: null, status: 'missing_required' };
  if (cmp.status === 'suppressed') return { interp: null, status: 'suppressed' };

  const completeness = role.completeness.status;
  return {
    status: 'full',
    interp: {
      ...baseMeta(bundle),
      interpretationId: INTERPRETATION_ID.ROLE_PLAYING_TIME,
      observationType: OBSERVATION_TYPE.RECENT_VS_BASELINE,
      dimension: INTERPRETATION_DIMENSION.ROLE,
      evidence: [
        ev(
          'role.recent_minutes',
          PLAYER_ROLE_CONTEXT_VERSION,
          role.recentRole.minutes,
          'minutes',
          completeness
        ),
        ev(
          'role.season_minutes',
          PLAYER_ROLE_CONTEXT_VERSION,
          role.seasonRole.minutes,
          'minutes',
          completeness
        ),
      ],
      comparison: {
        recentContextId: 'role.recent_minutes',
        baselineContextId: 'role.season_minutes',
        delta: cmp.delta,
        unit: 'minutes',
      },
      templateKey: TEMPLATE_KEY.ROLE_RECENT_VS_SEASON,
      templateParameters: {
        metric: 'minutes',
        recent: role.recentRole.minutes,
        season: role.seasonRole.minutes,
        delta: cmp.delta,
        recentHistoryN: role.recentRole.historyN,
        seasonHistoryN: role.seasonRole.historyN,
      },
      completeness,
      provenance: {
        upstreamVersions: { playerRoleContext: PLAYER_ROLE_CONTEXT_VERSION },
      },
    },
  };
}

function buildRoleShotOpportunity(
  bundle: InterpretationInputBundle
): {
  interp: ContextInterpretation | null;
  status: InterpretationEligibilityStatus;
} {
  const role = bundle.role;
  if (!role || role.seasonRole.historyN === 0) {
    return { interp: null, status: 'missing_required' };
  }
  const cmp = compareRecentMinusSeason(
    role.recentRole.fga,
    role.seasonRole.fga,
    'counting'
  );
  if (cmp.status === 'missing') return { interp: null, status: 'missing_required' };
  if (cmp.status === 'suppressed') return { interp: null, status: 'suppressed' };

  const completeness = role.completeness.status;
  const tpaCmp = compareRecentMinusSeason(
    role.recentRole.tpa,
    role.seasonRole.tpa,
    'counting'
  );
  const includeTpaDelta = tpaCmp.status === 'ok';

  const params: Record<string, unknown> = {
    recentFga: role.recentRole.fga,
    seasonFga: role.seasonRole.fga,
    fgaDelta: cmp.delta,
    recentHistoryN: role.recentRole.historyN,
    seasonHistoryN: role.seasonRole.historyN,
    includeTpaDelta,
  };
  if (includeTpaDelta && tpaCmp.status === 'ok') {
    params.recentTpa = role.recentRole.tpa;
    params.seasonTpa = role.seasonRole.tpa;
    params.tpaDelta = tpaCmp.delta;
  }
  if (
    role.recentRole.fta != null &&
    role.seasonRole.fta != null &&
    !equalAtDisplayPrecision1(role.recentRole.fta, role.seasonRole.fta)
  ) {
    params.recentFta = role.recentRole.fta;
    params.seasonFta = role.seasonRole.fta;
    params.ftaDelta = role.recentRole.fta - role.seasonRole.fta;
  }

  return {
    status: 'full',
    interp: {
      ...baseMeta(bundle),
      interpretationId: INTERPRETATION_ID.ROLE_SHOT_OPPORTUNITY,
      observationType: OBSERVATION_TYPE.RECENT_VS_BASELINE,
      dimension: INTERPRETATION_DIMENSION.ROLE,
      evidence: [
        ev(
          'role.recent_fga',
          PLAYER_ROLE_CONTEXT_VERSION,
          role.recentRole.fga,
          'count_per_game',
          completeness
        ),
        ev(
          'role.season_fga',
          PLAYER_ROLE_CONTEXT_VERSION,
          role.seasonRole.fga,
          'count_per_game',
          completeness
        ),
      ],
      comparison: {
        recentContextId: 'role.recent_fga',
        baselineContextId: 'role.season_fga',
        delta: cmp.delta,
        unit: 'count_per_game',
      },
      templateKey: TEMPLATE_KEY.ROLE_SHOT_OPPORTUNITY,
      templateParameters: params,
      completeness,
      provenance: {
        upstreamVersions: { playerRoleContext: PLAYER_ROLE_CONTEXT_VERSION },
      },
    },
  };
}

function buildFormScoring(
  bundle: InterpretationInputBundle
): {
  interp: ContextInterpretation | null;
  status: InterpretationEligibilityStatus;
} {
  const form = bundle.form;
  if (!form || form.seasonForm.historyN === 0) {
    return { interp: null, status: 'missing_required' };
  }
  const cmp = compareRecentMinusSeason(
    form.recentForm.points,
    form.seasonForm.points,
    'counting'
  );
  if (cmp.status === 'missing') return { interp: null, status: 'missing_required' };
  if (cmp.status === 'suppressed') return { interp: null, status: 'suppressed' };

  const completeness = form.completeness.status;
  return {
    status: 'full',
    interp: {
      ...baseMeta(bundle),
      interpretationId: INTERPRETATION_ID.FORM_SCORING,
      observationType: OBSERVATION_TYPE.RECENT_VS_BASELINE,
      dimension: INTERPRETATION_DIMENSION.FORM,
      evidence: [
        ev(
          'form.recent_points',
          RECENT_FORM_CONTEXT_VERSION,
          form.recentForm.points,
          'points_per_game',
          completeness
        ),
        ev(
          'form.season_points',
          RECENT_FORM_CONTEXT_VERSION,
          form.seasonForm.points,
          'points_per_game',
          completeness
        ),
      ],
      comparison: {
        recentContextId: 'form.recent_points',
        baselineContextId: 'form.season_points',
        delta: cmp.delta,
        unit: 'points_per_game',
      },
      templateKey: TEMPLATE_KEY.FORM_RECENT_VS_SEASON,
      templateParameters: {
        metric: 'points',
        recent: form.recentForm.points,
        season: form.seasonForm.points,
        delta: cmp.delta,
        recentHistoryN: form.recentForm.historyN,
        seasonHistoryN: form.seasonForm.historyN,
      },
      completeness,
      provenance: {
        upstreamVersions: { recentFormContext: RECENT_FORM_CONTEXT_VERSION },
      },
    },
  };
}

function buildFormShooting(
  bundle: InterpretationInputBundle
): {
  interp: ContextInterpretation | null;
  status: InterpretationEligibilityStatus;
} {
  const form = bundle.form;
  if (!form || form.seasonForm.historyN === 0) {
    return { interp: null, status: 'missing_required' };
  }

  const fg = compareRecentMinusSeason(
    form.recentForm.fgPct,
    form.seasonForm.fgPct,
    'percentage_fraction'
  );
  const thr = compareRecentMinusSeason(
    form.recentForm.threePct,
    form.seasonForm.threePct,
    'percentage_fraction'
  );

  const fgOk = fg.status === 'ok';
  const thrOk = thr.status === 'ok';

  if (!fgOk && !thrOk) {
    if (
      (form.recentForm.fgPct == null && form.recentForm.threePct == null) ||
      (form.seasonForm.fgPct == null && form.seasonForm.threePct == null)
    ) {
      return { interp: null, status: 'missing_required' };
    }
    return { interp: null, status: 'suppressed' };
  }

  const completeness =
    fgOk && thrOk ? CONTEXT_COMPLETENESS.COMPLETE : CONTEXT_COMPLETENESS.PARTIAL;
  const evidence: InterpretationEvidence[] = [];
  const params: Record<string, unknown> = {
    includeFg: fgOk,
    includeThree: thrOk,
    recentHistoryN: form.recentForm.historyN,
    seasonHistoryN: form.seasonForm.historyN,
  };

  if (fgOk && fg.status === 'ok') {
    evidence.push(
      ev(
        'form.recent_fg_pct',
        RECENT_FORM_CONTEXT_VERSION,
        form.recentForm.fgPct,
        'fraction',
        completeness
      ),
      ev(
        'form.season_fg_pct',
        RECENT_FORM_CONTEXT_VERSION,
        form.seasonForm.fgPct,
        'fraction',
        completeness
      )
    );
    params.recentFgPct = form.recentForm.fgPct;
    params.seasonFgPct = form.seasonForm.fgPct;
    params.fgDeltaFraction = fg.delta;
  }
  if (thrOk && thr.status === 'ok') {
    evidence.push(
      ev(
        'form.recent_three_pct',
        RECENT_FORM_CONTEXT_VERSION,
        form.recentForm.threePct,
        'fraction',
        completeness
      ),
      ev(
        'form.season_three_pct',
        RECENT_FORM_CONTEXT_VERSION,
        form.seasonForm.threePct,
        'fraction',
        completeness
      )
    );
    params.recentThreePct = form.recentForm.threePct;
    params.seasonThreePct = form.seasonForm.threePct;
    params.threeDeltaFraction = thr.delta;
  }

  return {
    status: fgOk && thrOk ? 'full' : 'reduced',
    interp: {
      ...baseMeta(bundle),
      interpretationId: INTERPRETATION_ID.FORM_SHOOTING,
      observationType: OBSERVATION_TYPE.RECENT_VS_BASELINE,
      dimension: INTERPRETATION_DIMENSION.FORM,
      evidence,
      comparison: thrOk && thr.status === 'ok'
        ? {
            recentContextId: 'form.recent_three_pct',
            baselineContextId: 'form.season_three_pct',
            delta: thr.delta,
            unit: 'fraction',
          }
        : fgOk && fg.status === 'ok'
          ? {
              recentContextId: 'form.recent_fg_pct',
              baselineContextId: 'form.season_fg_pct',
              delta: fg.delta,
              unit: 'fraction',
            }
          : undefined,
      templateKey: TEMPLATE_KEY.FORM_SHOOTING_PP,
      templateParameters: params,
      completeness,
      provenance: {
        upstreamVersions: { recentFormContext: RECENT_FORM_CONTEXT_VERSION },
      },
    },
  };
}

function matchupValue(
  dim: MatchupContextSnapshot['scoringEnvironment'] | MatchupContextSnapshot['perimeter'],
  contextId: string
): number | null {
  const hit =
    dim.required[contextId] ??
    dim.optional[contextId] ??
    Object.values({ ...dim.required, ...dim.optional }).find(
      (r) => r.contextId === contextId
    );
  if (!hit || !hit.present || hit.value == null) return null;
  return hit.value;
}

function buildMatchupScoring(
  bundle: InterpretationInputBundle
): {
  interp: ContextInterpretation | null;
  status: InterpretationEligibilityStatus;
} {
  const m = bundle.matchup;
  if (!m) return { interp: null, status: 'missing_required' };
  const dim = m.scoringEnvironment;
  if (!dim.usable) return { interp: null, status: 'missing_required' };

  const recentPts = matchupValue(dim, 'form.recent_points');
  const drtg = matchupValue(dim, 'opponent.defensive_rating');
  if (recentPts == null || drtg == null) {
    return { interp: null, status: 'missing_required' };
  }

  const seasonPts = matchupValue(dim, 'form.season_points');
  const recentFga = matchupValue(dim, 'role.recent_fga');
  const recentFta = matchupValue(dim, 'role.recent_fta');
  const pace = matchupValue(dim, 'opponent.pace');
  const allOptional =
    seasonPts != null && recentFga != null && recentFta != null && pace != null;

  const completeness = dim.completeness;
  const params: Record<string, unknown> = {
    recentPoints: recentPts,
    defensiveRating: drtg,
    includePace: pace != null,
    pace: pace ?? undefined,
    includeOpportunity: recentFga != null,
    recentFga: recentFga ?? undefined,
  };

  return {
    status: allOptional ? 'full' : 'reduced',
    interp: {
      ...baseMeta(bundle),
      interpretationId: INTERPRETATION_ID.MATCHUP_SCORING_ENVIRONMENT,
      observationType: OBSERVATION_TYPE.RELATIONAL_MATCHUP,
      dimension: INTERPRETATION_DIMENSION.MATCHUP,
      evidence: [
        ev(
          'form.recent_points',
          RECENT_FORM_CONTEXT_VERSION,
          recentPts,
          'points_per_game',
          completeness
        ),
        ev(
          'opponent.defensive_rating',
          OPPONENT_CONTEXT_VERSION,
          drtg,
          'rating',
          completeness
        ),
      ],
      templateKey: TEMPLATE_KEY.MATCHUP_SCORING_ENVIRONMENT,
      templateParameters: params,
      completeness,
      provenance: {
        upstreamVersions: {
          matchupContext: MATCHUP_CONTEXT_VERSION,
          recentFormContext: RECENT_FORM_CONTEXT_VERSION,
          opponentContext: OPPONENT_CONTEXT_VERSION,
        },
      },
    },
  };
}

function buildMatchupPerimeter(
  bundle: InterpretationInputBundle,
  roleShotEmitted: boolean
): {
  interp: ContextInterpretation | null;
  status: InterpretationEligibilityStatus;
} {
  const m = bundle.matchup;
  if (!m) return { interp: null, status: 'missing_required' };
  const dim = m.perimeter;
  if (!dim.usable) return { interp: null, status: 'missing_required' };

  const recentTpa = matchupValue(dim, 'role.recent_tpa');
  const rate = matchupValue(dim, 'opponent.three_point_attempt_rate_allowed');
  if (recentTpa == null || rate == null) {
    return { interp: null, status: 'missing_required' };
  }

  const seasonTpa = matchupValue(dim, 'role.season_tpa');
  const recentThreePct = matchupValue(dim, 'form.recent_three_pct');
  // Redundancy: Role owns 3PA vs-season; Perimeter omits season clause when Role shot emitted.
  const includeSeasonTpa =
    !roleShotEmitted &&
    seasonTpa != null &&
    !equalAtDisplayPrecision1(recentTpa, seasonTpa);

  const optionalComplete =
    seasonTpa != null &&
    matchupValue(dim, 'form.season_tpm') != null &&
    matchupValue(dim, 'form.recent_tpm') != null &&
    matchupValue(dim, 'form.season_three_pct') != null &&
    recentThreePct != null;

  const completeness = dim.completeness;
  const reduced = !optionalComplete || recentThreePct == null;

  return {
    status: reduced ? 'reduced' : 'full',
    interp: {
      ...baseMeta(bundle),
      interpretationId: INTERPRETATION_ID.MATCHUP_PERIMETER,
      observationType: OBSERVATION_TYPE.RELATIONAL_MATCHUP,
      dimension: INTERPRETATION_DIMENSION.MATCHUP,
      evidence: [
        ev(
          'role.recent_tpa',
          PLAYER_ROLE_CONTEXT_VERSION,
          recentTpa,
          'count_per_game',
          completeness
        ),
        ev(
          'opponent.three_point_attempt_rate_allowed',
          OPPONENT_CONTEXT_VERSION,
          rate,
          'share_of_opposing_fga_from_three',
          completeness
        ),
      ],
      templateKey: reduced
        ? TEMPLATE_KEY.MATCHUP_PERIMETER_REDUCED
        : TEMPLATE_KEY.MATCHUP_PERIMETER,
      templateParameters: {
        recentTpa,
        seasonTpa: seasonTpa ?? undefined,
        includeSeasonTpa,
        threePointAttemptRateAllowed: rate,
        // Explicit semantic marker for tests — never render as opponent 3P%.
        rateUnit: 'share_of_opposing_fga_from_three',
      },
      completeness,
      provenance: {
        upstreamVersions: {
          matchupContext: MATCHUP_CONTEXT_VERSION,
          playerRoleContext: PLAYER_ROLE_CONTEXT_VERSION,
          opponentContext: OPPONENT_CONTEXT_VERSION,
        },
      },
    },
  };
}

/**
 * Generate ordered interpretation objects from certified snapshots only.
 */
export function generateInterpretations(
  bundle: InterpretationInputBundle
): InterpretationRunResult {
  assertAligned(bundle);

  const eligibility = {} as Record<
    InterpretationId,
    InterpretationEligibilityStatus | 'skipped'
  >;
  for (const id of INTERPRETATION_V1_ORDER) {
    eligibility[id] = 'skipped';
  }

  const out: ContextInterpretation[] = [];

  // Availability
  if (!bundle.availability) {
    eligibility[INTERPRETATION_ID.AVAILABILITY_SUMMARY] = 'missing_required';
  } else if (
    bundle.availability.completeness.status === CONTEXT_COMPLETENESS.SOURCE_UNKNOWN
  ) {
    eligibility[INTERPRETATION_ID.AVAILABILITY_SUMMARY] = 'missing_required';
  } else {
    const built = buildAvailability(bundle);
    if (!built) {
      eligibility[INTERPRETATION_ID.AVAILABILITY_SUMMARY] = 'missing_required';
    } else {
      eligibility[INTERPRETATION_ID.AVAILABILITY_SUMMARY] = built.status;
      out.push(built.interp);
    }
  }

  // Schedule
  if (!bundle.schedule) {
    eligibility[INTERPRETATION_ID.SCHEDULE_SUMMARY] = 'missing_required';
  } else {
    const built = buildSchedule(bundle);
    if (!built) {
      eligibility[INTERPRETATION_ID.SCHEDULE_SUMMARY] = 'missing_required';
    } else {
      eligibility[INTERPRETATION_ID.SCHEDULE_SUMMARY] = built.status;
      out.push(built.interp);
    }
  }

  const roleTime = buildRolePlayingTime(bundle);
  eligibility[INTERPRETATION_ID.ROLE_PLAYING_TIME] = roleTime.status;
  if (roleTime.interp) out.push(roleTime.interp);

  const roleShot = buildRoleShotOpportunity(bundle);
  eligibility[INTERPRETATION_ID.ROLE_SHOT_OPPORTUNITY] = roleShot.status;
  if (roleShot.interp) out.push(roleShot.interp);

  const formScore = buildFormScoring(bundle);
  eligibility[INTERPRETATION_ID.FORM_SCORING] = formScore.status;
  if (formScore.interp) out.push(formScore.interp);

  const formShoot = buildFormShooting(bundle);
  eligibility[INTERPRETATION_ID.FORM_SHOOTING] = formShoot.status;
  if (formShoot.interp) out.push(formShoot.interp);

  const mScore = buildMatchupScoring(bundle);
  eligibility[INTERPRETATION_ID.MATCHUP_SCORING_ENVIRONMENT] = mScore.status;
  if (mScore.interp) out.push(mScore.interp);

  const mPerim = buildMatchupPerimeter(bundle, roleShot.interp != null);
  eligibility[INTERPRETATION_ID.MATCHUP_PERIMETER] = mPerim.status;
  if (mPerim.interp) out.push(mPerim.interp);

  // Enforce frozen order
  const orderIndex = new Map(INTERPRETATION_V1_ORDER.map((id, i) => [id, i]));
  out.sort(
    (a, b) =>
      (orderIndex.get(a.interpretationId) ?? 99) -
      (orderIndex.get(b.interpretationId) ?? 99)
  );

  if (out.length > 8) {
    throw new InterpretationGenerationError(
      'IDENTITY',
      `MAX_OBSERVATIONS_PER_PLAYER_GAME exceeded: ${out.length}`
    );
  }

  for (const interp of out) {
    if (!interp.evidence.length) {
      throw new InterpretationGenerationError(
        'IDENTITY',
        `Interpretation without evidence: ${interp.interpretationId}`
      );
    }
  }

  const rendered: RenderedInterpretation[] = out.map((interpretation) => ({
    interpretation,
    renderedText: renderInterpretation(interpretation),
  }));

  return { interpretations: out, rendered, eligibility };
}
