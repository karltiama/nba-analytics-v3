/**
 * Blind held-out fixtures for matchup-context-v1.
 */

import type {
  OpponentContextSnapshot,
  PlayerRoleContextSnapshot,
  RecentFormContextSnapshot,
} from '@/lib/context-center';
import {
  OPPONENT_CONTEXT_VERSION,
  PLAYER_ROLE_CONTEXT_VERSION,
  RECENT_FORM_CONTEXT_VERSION,
} from '@/lib/context-center';

export type MatchupHeldOutCase = {
  id: string;
  category: string;
  role: PlayerRoleContextSnapshot;
  form: RecentFormContextSnapshot;
  opponent: OpponentContextSnapshot;
  expect?: {
    scoring: 'COMPLETE' | 'PARTIAL' | 'SOURCE_ONLY' | 'SOURCE_UNKNOWN';
    perimeter: 'COMPLETE' | 'PARTIAL' | 'SOURCE_ONLY' | 'SOURCE_UNKNOWN';
    overall: 'COMPLETE' | 'PARTIAL' | 'SOURCE_ONLY' | 'SOURCE_UNKNOWN';
    opponentTeamId?: string;
  };
  expectError?: 'TARGET_MISMATCH' | 'PLAYER_MISMATCH' | 'TEAM_MISMATCH' | 'OPPONENT_INVERSION' | 'VERSION_MISMATCH';
};

const TIP = '2024-02-01T00:00:00Z';

function role(
  o: Partial<PlayerRoleContextSnapshot> & {
    seasonRole?: Partial<PlayerRoleContextSnapshot['seasonRole']>;
    recentRole?: Partial<PlayerRoleContextSnapshot['recentRole']>;
  } = {}
): PlayerRoleContextSnapshot {
  const { seasonRole, recentRole, ...rest } = o;
  return {
    grain: 'PLAYER_GAME',
    gameId: 'G',
    playerEntityId: 'P',
    teamId: '10',
    season: '2023',
    targetGameStart: TIP,
    contextVersion: PLAYER_ROLE_CONTEXT_VERSION,
    seasonRole: {
      historyN: 12,
      latestHistoryGameId: 'H',
      latestHistoryGameStart: '2024-01-20T00:00:00Z',
      minutes: 30,
      fga: 15,
      fta: 4,
      ast: 5,
      tpa: 6,
      ...seasonRole,
    },
    recentRole: {
      historyN: 10,
      latestHistoryGameId: 'H',
      latestHistoryGameStart: '2024-01-20T00:00:00Z',
      windowMax: 10,
      minutes: 32,
      fga: 16,
      fta: 5,
      ast: 6,
      tpa: 7,
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

function form(
  o: Partial<RecentFormContextSnapshot> & {
    seasonForm?: Partial<RecentFormContextSnapshot['seasonForm']>;
    recentForm?: Partial<RecentFormContextSnapshot['recentForm']>;
  } = {}
): RecentFormContextSnapshot {
  const { seasonForm, recentForm, ...rest } = o;
  return {
    grain: 'PLAYER_GAME',
    gameId: 'G',
    playerEntityId: 'P',
    teamId: '10',
    season: '2023',
    targetGameStart: TIP,
    contextVersion: RECENT_FORM_CONTEXT_VERSION,
    seasonForm: {
      historyN: 12,
      latestHistoryGameId: 'H',
      latestHistoryGameStart: '2024-01-20T00:00:00Z',
      points: 20,
      rebounds: 5,
      tpm: 2,
      fgMade: 50,
      fgAttempted: 120,
      fgPct: 50 / 120,
      threeMade: 20,
      threeAttempted: 60,
      threePct: 1 / 3,
      ...seasonForm,
    },
    recentForm: {
      historyN: 10,
      latestHistoryGameId: 'H',
      latestHistoryGameStart: '2024-01-20T00:00:00Z',
      windowMax: 10,
      points: 22,
      rebounds: 6,
      tpm: 2.5,
      fgMade: 40,
      fgAttempted: 100,
      fgPct: 0.4,
      threeMade: 20,
      threeAttempted: 50,
      threePct: 0.4,
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

function opp(
  o: Partial<OpponentContextSnapshot> & {
    opponent?: Partial<OpponentContextSnapshot['opponent']>;
  } = {}
): OpponentContextSnapshot {
  const { opponent, ...rest } = o;
  return {
    grain: 'TEAM_GAME',
    gameId: 'G',
    teamId: '10',
    opponentTeamId: '20',
    targetGameStart: TIP,
    season: '2023',
    contextVersion: OPPONENT_CONTEXT_VERSION,
    opponent: {
      pace: 100,
      defensiveRating: 112,
      defensiveReboundPct: 0.75,
      offensiveReboundPct: 0.25,
      turnoverRate: 0.12,
      threePointAttemptRateAllowed: 0.4,
      ...opponent,
    },
    history: { n: 15, latestGameStart: '2024-01-22T00:00:00Z' },
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

export const MATCHUP_HELDOUT_CASES: MatchupHeldOutCase[] = [
  {
    id: 'MH-both-complete',
    category: 'both_complete',
    role: role(),
    form: form(),
    opponent: opp(),
    expect: { scoring: 'COMPLETE', perimeter: 'COMPLETE', overall: 'COMPLETE', opponentTeamId: '20' },
  },
  {
    id: 'MH-scoring-partial-pace',
    category: 'scoring_partial',
    role: role(),
    form: form(),
    opponent: opp({ opponent: { pace: null } }),
    expect: { scoring: 'PARTIAL', perimeter: 'COMPLETE', overall: 'PARTIAL' },
  },
  {
    id: 'MH-perimeter-partial-3pct',
    category: 'perimeter_partial',
    role: role(),
    form: form({ recentForm: { threePct: null }, seasonForm: { threePct: null } }),
    opponent: opp(),
    expect: { scoring: 'COMPLETE', perimeter: 'PARTIAL', overall: 'PARTIAL' },
  },
  {
    id: 'MH-scoring-cold-points',
    category: 'scoring_source_only',
    role: role({ recentRole: { fga: null, fta: null }, seasonRole: { fga: null, fta: null } }),
    form: form({
      recentForm: { points: null, tpm: null, threePct: null, fgPct: null },
      seasonForm: { points: null, tpm: null, threePct: null, fgPct: null },
      completeness: { status: 'SOURCE_ONLY' },
    }),
    opponent: opp(),
    expect: { scoring: 'SOURCE_ONLY', perimeter: 'PARTIAL', overall: 'PARTIAL' },
  },
  {
    id: 'MH-perimeter-cold-tpa',
    category: 'perimeter_source_only',
    role: role({
      recentRole: { tpa: null, fga: null, fta: null },
      seasonRole: { tpa: null, fga: null, fta: null },
      completeness: { status: 'SOURCE_ONLY' },
    }),
    form: form({ recentForm: { points: 18 } }),
    opponent: opp(),
    expect: { scoring: 'PARTIAL', perimeter: 'SOURCE_ONLY', overall: 'PARTIAL' },
  },
  {
    id: 'MH-opp-cold',
    category: 'opponent_cold_start',
    role: role(),
    form: form(),
    opponent: opp({
      opponent: {
        pace: null,
        defensiveRating: null,
        threePointAttemptRateAllowed: null,
        defensiveReboundPct: null,
        offensiveReboundPct: null,
        turnoverRate: null,
      },
      history: { n: 0, latestGameStart: null },
      completeness: { status: 'SOURCE_ONLY' },
    }),
    expect: { scoring: 'SOURCE_ONLY', perimeter: 'SOURCE_ONLY', overall: 'SOURCE_ONLY' },
  },
  {
    id: 'MH-player-cold',
    category: 'player_cold_start',
    role: role({
      seasonRole: {
        historyN: 0,
        minutes: null,
        fga: null,
        fta: null,
        ast: null,
        tpa: null,
        latestHistoryGameId: null,
        latestHistoryGameStart: null,
      },
      recentRole: {
        historyN: 0,
        minutes: null,
        fga: null,
        fta: null,
        ast: null,
        tpa: null,
        latestHistoryGameId: null,
        latestHistoryGameStart: null,
        windowMax: 10,
      },
      completeness: { status: 'SOURCE_ONLY' },
    }),
    form: form({
      seasonForm: {
        historyN: 0,
        points: null,
        rebounds: null,
        tpm: null,
        fgMade: null,
        fgAttempted: null,
        fgPct: null,
        threeMade: null,
        threeAttempted: null,
        threePct: null,
        latestHistoryGameId: null,
        latestHistoryGameStart: null,
      },
      recentForm: {
        historyN: 0,
        points: null,
        rebounds: null,
        tpm: null,
        fgMade: null,
        fgAttempted: null,
        fgPct: null,
        threeMade: null,
        threeAttempted: null,
        threePct: null,
        latestHistoryGameId: null,
        latestHistoryGameStart: null,
        windowMax: 10,
      },
      completeness: { status: 'SOURCE_ONLY' },
    }),
    opponent: opp(),
    expect: { scoring: 'SOURCE_ONLY', perimeter: 'SOURCE_ONLY', overall: 'SOURCE_ONLY' },
  },
  {
    id: 'MH-non-shooter',
    category: 'non_shooter',
    role: role({ recentRole: { tpa: 0.2 }, seasonRole: { tpa: 0.1 } }),
    form: form({
      recentForm: { threePct: null, tpm: 0, threeAttempted: 0 },
      seasonForm: { threePct: null, tpm: 0, threeAttempted: 0 },
    }),
    opponent: opp(),
    expect: { scoring: 'COMPLETE', perimeter: 'PARTIAL', overall: 'PARTIAL' },
  },
  {
    id: 'MH-history-rich',
    category: 'history_rich',
    role: role({ seasonRole: { historyN: 40 }, recentRole: { historyN: 10, tpa: 9.2 } }),
    form: form({ seasonForm: { historyN: 40, points: 26 }, recentForm: { points: 29 } }),
    opponent: opp({ opponent: { defensiveRating: 108.5, threePointAttemptRateAllowed: 0.43 } }),
    expect: { scoring: 'COMPLETE', perimeter: 'COMPLETE', overall: 'COMPLETE' },
  },
  {
    id: 'MH-early-opp',
    category: 'early_season_opponent',
    role: role(),
    form: form(),
    opponent: opp({
      history: { n: 1, latestGameStart: '2024-01-25T00:00:00Z' },
      opponent: { pace: 99, defensiveRating: 118, threePointAttemptRateAllowed: 0.38 },
    }),
    expect: { scoring: 'COMPLETE', perimeter: 'COMPLETE', overall: 'COMPLETE' },
  },
  {
    id: 'MH-target-mismatch',
    category: 'target_mismatch',
    role: role({ gameId: 'A' }),
    form: form({ gameId: 'A' }),
    opponent: opp({ gameId: 'B' }),
    expectError: 'TARGET_MISMATCH',
  },
  {
    id: 'MH-player-mismatch',
    category: 'player_mismatch',
    role: role({ playerEntityId: 'A' }),
    form: form({ playerEntityId: 'B' }),
    opponent: opp(),
    expectError: 'PLAYER_MISMATCH',
  },
  {
    id: 'MH-team-mismatch',
    category: 'team_mismatch',
    role: role({ teamId: '10' }),
    form: form({ teamId: '10' }),
    opponent: opp({ teamId: '20', opponentTeamId: '10' }),
    expectError: 'TEAM_MISMATCH',
  },
  {
    id: 'MH-opp-inversion',
    category: 'opponent_inversion',
    role: role({ teamId: 'DET' }),
    form: form({ teamId: 'DET' }),
    opponent: opp({ teamId: 'BOS', opponentTeamId: 'DET' }),
    expectError: 'TEAM_MISMATCH',
  },
  {
    id: 'MH-version',
    category: 'version_mismatch',
    role: role({ contextVersion: 'bad' as typeof PLAYER_ROLE_CONTEXT_VERSION }),
    form: form(),
    opponent: opp(),
    expectError: 'VERSION_MISMATCH',
  },
  {
    id: 'MH-parity',
    category: 'source_parity',
    role: role({ recentRole: { tpa: 8.4, fga: 19.5 } }),
    form: form({ recentForm: { points: 27.5 }, seasonForm: { points: 24 } }),
    opponent: opp({ opponent: { defensiveRating: 113.7, pace: 101.2, threePointAttemptRateAllowed: 0.418 } }),
    expect: { scoring: 'COMPLETE', perimeter: 'COMPLETE', overall: 'COMPLETE' },
  },
  {
    id: 'MH-optionals-missing',
    category: 'all_optionals_missing',
    role: role({
      seasonRole: { tpa: null, fga: null, fta: null },
      recentRole: { fga: null, fta: null, tpa: 5 },
    }),
    form: form({
      seasonForm: { points: null, tpm: null, threePct: null },
      recentForm: { points: 15, tpm: null, threePct: null },
    }),
    opponent: opp({ opponent: { pace: null, defensiveRating: 115, threePointAttemptRateAllowed: 0.39 } }),
    expect: { scoring: 'PARTIAL', perimeter: 'PARTIAL', overall: 'PARTIAL' },
  },
  {
    id: 'MH-det-bos',
    category: 'ownership_det_bos',
    role: role({ teamId: 'DET', playerEntityId: 'CADE' }),
    form: form({ teamId: 'DET', playerEntityId: 'CADE' }),
    opponent: opp({ teamId: 'DET', opponentTeamId: 'BOS' }),
    expect: { scoring: 'COMPLETE', perimeter: 'COMPLETE', overall: 'COMPLETE', opponentTeamId: 'BOS' },
  },
  {
    id: 'MH-tip-mismatch',
    category: 'target_tip_mismatch',
    role: role({ targetGameStart: TIP }),
    form: form({ targetGameStart: TIP }),
    opponent: opp({ targetGameStart: '2024-03-01T00:00:00Z' }),
    expectError: 'TARGET_MISMATCH',
  },
  {
    id: 'MH-scoring-req-only',
    category: 'scoring_required_present',
    role: role({ recentRole: { fga: null, fta: null }, seasonRole: { fga: null, fta: null } }),
    form: form({ seasonForm: { points: null }, recentForm: { points: 21 } }),
    opponent: opp({ opponent: { pace: null, defensiveRating: 110 } }),
    expect: { scoring: 'PARTIAL', perimeter: 'COMPLETE', overall: 'PARTIAL' },
  },
];
