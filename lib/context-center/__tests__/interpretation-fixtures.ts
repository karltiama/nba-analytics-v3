/**
 * Shared certified-snapshot fixtures for interpretation tests.
 */

import { composeMatchupContext } from '../matchup/compose';
import type { RecentFormContextSnapshot } from '../form/recent-form-context';
import type { OpponentContextSnapshot } from '../opponent/snapshot';
import type { PlayerRoleContextSnapshot } from '../role/player-role-context';
import type { TeamGameScheduleSnapshot } from '../schedule-context';
import type { TeamGameAvailabilitySnapshot } from '../team-injury-burden';
import {
  MATCHUP_CONTEXT_VERSION,
  OPPONENT_CONTEXT_VERSION,
  PLAYER_ROLE_CONTEXT_VERSION,
  RECENT_FORM_CONTEXT_VERSION,
  SCHEDULE_CONTEXT_VERSION,
  TEAM_INJURY_CONTEXT_VERSION,
} from '../types';
import type { InterpretationInputBundle } from '../interpretation/generate';

export const TIP = '2024-01-15T00:30:00Z';

export function baseAvailability(
  overrides: Partial<TeamGameAvailabilitySnapshot> & {
    availability?: Partial<TeamGameAvailabilitySnapshot['availability']>;
    injuryBurden?: Partial<TeamGameAvailabilitySnapshot['injuryBurden']>;
    completeness?: Partial<TeamGameAvailabilitySnapshot['completeness']>;
  } = {}
): TeamGameAvailabilitySnapshot {
  const { availability, injuryBurden, completeness, ...rest } = overrides;
  return {
    grain: 'TEAM_GAME',
    gameId: 'G1',
    teamId: 'DET',
    season: '2023',
    gameStart: TIP,
    asOf: '2024-01-14T23:30:00Z',
    injuryReportPublishedAt: '2024-01-14T22:00:00Z',
    teamState: 'SUBMITTED',
    contextVersion: TEAM_INJURY_CONTEXT_VERSION,
    availability: {
      healthOutSourceCount: 2,
      healthOutCanonicalCount: 2,
      healthOutUnresolvedCount: 0,
      healthQuestionableCount: 0,
      healthDoubtfulCount: 0,
      healthProbableCount: 0,
      nonHealthOutCount: 0,
      healthOutCount: 2,
      ...availability,
    },
    injuryBurden: {
      expectedMissingMinutes: 65.5,
      expectedMissingFga: 20,
      expectedMissingPoints: 30,
      missingRotationShare: 0.27,
      maxMissingPriorMpg: 34,
      rotationPlayersOutCount: 2,
      ...injuryBurden,
    },
    completeness: {
      status: 'COMPLETE',
      roleRequiredCount: 2,
      roleEstimatedCount: 2,
      coverageRate: 1,
      ...completeness,
    },
    provenance: {
      injuryTapeVersion: 'official-injury-asof-t60-v1',
      reasonPolicyVersion: 'official-injury-reason-policy-v1',
      identityVersion: 'official-injury-player-identity-v1',
      roleExpectationVersion: 'player-role-expectation-v1',
      contextVersion: TEAM_INJURY_CONTEXT_VERSION,
      rotationDefinitionVersion: 'rotation-player-definition-v1',
    },
    duplicateBurdenContributions: 0,
    predictiveStatus: 'NOT_TESTED',
    displayStatus: 'DISPLAYABLE',
    ...rest,
  };
}

export function baseSchedule(
  overrides: Partial<TeamGameScheduleSnapshot> & {
    schedule?: Partial<TeamGameScheduleSnapshot['schedule']>;
  } = {}
): TeamGameScheduleSnapshot {
  const { schedule, ...rest } = overrides;
  return {
    grain: 'TEAM_GAME',
    gameId: 'G1',
    teamId: 'DET',
    season: '2023',
    gameStart: TIP,
    contextVersion: SCHEDULE_CONTEXT_VERSION,
    schedule: {
      homeAway: 'HOME',
      daysRest: 2,
      backToBack: false,
      isSeasonOpener: false,
      ...schedule,
    },
    daysSinceLastGame: 3,
    completeness: { status: 'COMPLETE' },
    provenance: {
      previousGameId: 'G0',
      previousGameStart: '2024-01-12T00:30:00Z',
      targetBasketballDate: '2024-01-14',
      previousBasketballDate: '2024-01-11',
      timezone: 'America/New_York',
      version: SCHEDULE_CONTEXT_VERSION,
      priorGameEligibility: 'status_Final_with_scores',
      seasonOpenerPolicy: 'same_season_only_no_cross_season_rest',
    },
    predictiveStatus: 'NOT_TESTED',
    displayStatus: 'DISPLAYABLE',
    ...rest,
  };
}

export function baseRole(
  overrides: Partial<PlayerRoleContextSnapshot> & {
    seasonRole?: Partial<PlayerRoleContextSnapshot['seasonRole']>;
    recentRole?: Partial<PlayerRoleContextSnapshot['recentRole']>;
  } = {}
): PlayerRoleContextSnapshot {
  const { seasonRole, recentRole, ...rest } = overrides;
  return {
    grain: 'PLAYER_GAME',
    gameId: 'G1',
    playerEntityId: 'P1',
    teamId: 'DET',
    season: '2023',
    targetGameStart: TIP,
    contextVersion: PLAYER_ROLE_CONTEXT_VERSION,
    seasonRole: {
      historyN: 20,
      latestHistoryGameId: 'H1',
      latestHistoryGameStart: '2024-01-10T00:00:00Z',
      minutes: 34.1,
      fga: 17.9,
      fta: 5,
      ast: 6,
      tpa: 7.1,
      ...seasonRole,
    },
    recentRole: {
      historyN: 10,
      latestHistoryGameId: 'H1',
      latestHistoryGameStart: '2024-01-10T00:00:00Z',
      windowMax: 10,
      minutes: 36.8,
      fga: 20.4,
      fta: 5.8,
      ast: 7,
      tpa: 8.6,
      ...recentRole,
    },
    completeness: { status: 'COMPLETE' },
    provenance: {
      version: PLAYER_ROLE_CONTEXT_VERSION,
      roleExpectationVersion: 'player-role-expectation-v1',
      playedClassification: 'classifyWowyAppearance',
      baselineMethod: 'EXPANDING_SAME_SEASON_SAME_TEAM_PRIOR_PLAYED_MEAN',
      recentWindow: 'LAST_10_PRIOR_PLAYED_GAMES',
      priorSeasonFallback: false,
      priorTeamFallback: false,
    },
    predictiveStatus: 'NOT_TESTED',
    displayStatus: 'DISPLAYABLE',
    ...rest,
  };
}

export function baseForm(
  overrides: Partial<RecentFormContextSnapshot> & {
    seasonForm?: Partial<RecentFormContextSnapshot['seasonForm']>;
    recentForm?: Partial<RecentFormContextSnapshot['recentForm']>;
  } = {}
): RecentFormContextSnapshot {
  const { seasonForm, recentForm, ...rest } = overrides;
  return {
    grain: 'PLAYER_GAME',
    gameId: 'G1',
    playerEntityId: 'P1',
    teamId: 'DET',
    season: '2023',
    targetGameStart: TIP,
    contextVersion: RECENT_FORM_CONTEXT_VERSION,
    seasonForm: {
      historyN: 20,
      latestHistoryGameId: 'H1',
      latestHistoryGameStart: '2024-01-10T00:00:00Z',
      points: 24,
      rebounds: 5,
      tpm: 2.6,
      fgMade: 80,
      fgAttempted: 180,
      fgPct: 80 / 180,
      threeMade: 26,
      threeAttempted: 71,
      threePct: 0.366,
      ...seasonForm,
    },
    recentForm: {
      historyN: 10,
      latestHistoryGameId: 'H1',
      latestHistoryGameStart: '2024-01-10T00:00:00Z',
      windowMax: 10,
      points: 27.5,
      rebounds: 6,
      tpm: 3.2,
      fgMade: 90,
      fgAttempted: 200,
      fgPct: 0.45,
      threeMade: 32,
      threeAttempted: 86,
      threePct: 0.372,
      ...recentForm,
    },
    completeness: { status: 'COMPLETE' },
    provenance: {
      version: RECENT_FORM_CONTEXT_VERSION,
      playedClassification: 'classifyWowyAppearance',
      baselineMethod: 'EXPANDING_SAME_SEASON_SAME_TEAM_PRIOR_PLAYED',
      recentWindow: 'LAST_10_PRIOR_PLAYED_GAMES',
      countingAggregation: 'arithmetic_mean_per_played_game',
      percentageAggregation: 'pooled_made_over_attempts',
      percentageUnit: 'fraction_0_1',
      priorSeasonFallback: false,
      priorTeamFallback: false,
    },
    predictiveStatus: 'NOT_TESTED',
    displayStatus: 'DISPLAYABLE',
    ...rest,
  };
}

export function baseOpp(
  overrides: Partial<OpponentContextSnapshot> & {
    opponent?: Partial<OpponentContextSnapshot['opponent']>;
  } = {}
): OpponentContextSnapshot {
  const { opponent, ...rest } = overrides;
  return {
    grain: 'TEAM_GAME',
    gameId: 'G1',
    teamId: 'DET',
    opponentTeamId: 'BOS',
    targetGameStart: TIP,
    season: '2023',
    contextVersion: OPPONENT_CONTEXT_VERSION,
    opponent: {
      pace: 101.2,
      defensiveRating: 113.7,
      offensiveRating: 115,
      turnoverRate: 0.13,
      offensiveReboundRate: 0.28,
      threePointAttemptRateAllowed: 0.418,
      ...opponent,
    },
    history: { n: 40, latestGameStart: '2024-01-12T00:00:00Z' },
    completeness: { status: 'COMPLETE' },
    provenance: {
      version: OPPONENT_CONTEXT_VERSION,
      teamBoxVersion: 'opponent-team-box-pgl-v1',
      possessionsFormulaVersion: 'possessions-avg-both-sides-fta0.44-v1',
      sourcePath: 'pgl_team_box_v1',
      staleTgsAdvancedColumnsUsed: false,
      historyPolicy: 'same_season_final_start_time_lt_tip',
      priorSeasonFallback: false,
      paceUnit: 'estimated_possessions_per_team_game',
    },
    predictiveStatus: 'NOT_TESTED',
    displayStatus: 'DISPLAYABLE',
    ...rest,
  };
}

export function fullBundle(
  overrides: Partial<{
    availability: TeamGameAvailabilitySnapshot;
    schedule: TeamGameScheduleSnapshot;
    role: PlayerRoleContextSnapshot;
    form: RecentFormContextSnapshot;
    opponent: OpponentContextSnapshot;
  }> = {}
): InterpretationInputBundle {
  const role = overrides.role ?? baseRole();
  const form = overrides.form ?? baseForm();
  const opponent = overrides.opponent ?? baseOpp();
  const matchup = composeMatchupContext({ role, form, opponent });
  return {
    gameId: 'G1',
    playerEntityId: 'P1',
    teamId: 'DET',
    opponentTeamId: 'BOS',
    targetGameStart: TIP,
    availability: overrides.availability ?? baseAvailability(),
    schedule: overrides.schedule ?? baseSchedule(),
    role,
    form,
    matchup,
  };
}

export { MATCHUP_CONTEXT_VERSION };
