import { describe, expect, it } from 'vitest';
import {
  MATCHUP_CONTEXT_MODEL,
  MATCHUP_CONTEXT_VERSION,
  MATCHUP_CONTEXT_V1_NEW_SCALAR_FIELDS,
  MATCHUP_DIMENSION_DEFINITIONS,
  MATCHUP_DIMENSION_ID,
  MatchupCompositionError,
  OPPONENT_CONTEXT_VERSION,
  PLAYER_ROLE_CONTEXT_VERSION,
  RECENT_FORM_CONTEXT_VERSION,
  assertMatchupInputValueParity,
  assertRegistryIntegrity,
  composeMatchupContext,
  type OpponentContextSnapshot,
  type PlayerRoleContextSnapshot,
  type RecentFormContextSnapshot,
} from '@/lib/context-center';

const TIP = '2024-01-15T00:30:00Z';

function baseRole(
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
      historyN: 10,
      latestHistoryGameId: 'H1',
      latestHistoryGameStart: '2024-01-10T00:00:00Z',
      minutes: 34,
      fga: 18,
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
      minutes: 36,
      fga: 20.1,
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

function baseForm(
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
      historyN: 10,
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

function baseOpp(
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
      defensiveReboundPct: 0.74,
      offensiveReboundPct: 0.26,
      turnoverRate: 0.12,
      threePointAttemptRateAllowed: 0.418,
      ...opponent,
    },
    history: { n: 20, latestGameStart: '2024-01-12T00:00:00Z' },
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

describe('matchup-context-v1 registry / definitions', () => {
  it('exposes exactly 2 dimensions and zero new scalars', () => {
    expect(MATCHUP_DIMENSION_DEFINITIONS).toHaveLength(2);
    expect(MATCHUP_CONTEXT_V1_NEW_SCALAR_FIELDS).toEqual([]);
    expect(assertRegistryIntegrity().matchupNewScalarRegistryIds).toBe(0);
    expect(MATCHUP_CONTEXT_VERSION).toBe('matchup-context-v1');
    expect(MATCHUP_CONTEXT_MODEL).toBe('HYBRID');
  });
});

describe('matchup-context-v1 compose', () => {
  it('62. synthetic scoring COMPLETE', () => {
    const snap = composeMatchupContext({
      role: baseRole(),
      form: baseForm(),
      opponent: baseOpp(),
    });
    expect(snap.scoringEnvironment.completeness).toBe('COMPLETE');
    expect(snap.scoringEnvironment.usable).toBe(true);
    expect(snap.scoringEnvironment.required['form.recent_points']!.value).toBe(27.5);
    expect(snap.scoringEnvironment.required['opponent.defensive_rating']!.value).toBe(113.7);
    expect(snap.scoringEnvironment.optional['form.season_points']!.value).toBe(24);
    expect(snap.scoringEnvironment.optional['role.recent_fga']!.value).toBe(20.1);
    expect(snap.scoringEnvironment.optional['role.recent_fta']!.value).toBe(5.8);
    expect(snap.scoringEnvironment.optional['opponent.pace']!.value).toBe(101.2);
    assertMatchupInputValueParity(snap);
  });

  it('63. synthetic perimeter COMPLETE', () => {
    const snap = composeMatchupContext({
      role: baseRole(),
      form: baseForm(),
      opponent: baseOpp(),
    });
    expect(snap.perimeter.completeness).toBe('COMPLETE');
    expect(snap.perimeter.required['role.recent_tpa']!.value).toBe(8.6);
    expect(snap.perimeter.required['opponent.three_point_attempt_rate_allowed']!.value).toBe(0.418);
    expect(snap.perimeter.optional['form.recent_three_pct']!.value).toBe(0.372);
  });

  it('36. scoring PARTIAL when optional pace missing', () => {
    const snap = composeMatchupContext({
      role: baseRole(),
      form: baseForm(),
      opponent: baseOpp({ opponent: { pace: null } }),
    });
    expect(snap.scoringEnvironment.completeness).toBe('PARTIAL');
    expect(snap.scoringEnvironment.usable).toBe(true);
  });

  it('38/64. perimeter PARTIAL when optional 3P% null (non-shooter)', () => {
    const snap = composeMatchupContext({
      role: baseRole({ recentRole: { tpa: 1.2 } }),
      form: baseForm({
        recentForm: { threePct: null, tpm: 0 },
        seasonForm: { threePct: null, tpm: 0 },
      }),
      opponent: baseOpp({ opponent: { threePointAttemptRateAllowed: 0.41 } }),
    });
    expect(snap.perimeter.completeness).toBe('PARTIAL');
    expect(snap.perimeter.usable).toBe(true);
    expect(snap.perimeter.optional['form.recent_three_pct']!.value).toBeNull();
    expect(snap.perimeter.optional['form.recent_three_pct']!.present).toBe(false);
  });

  it('35. scoring SOURCE_ONLY when recent points null — no season fallback', () => {
    const snap = composeMatchupContext({
      role: baseRole(),
      form: baseForm({ recentForm: { points: null } }),
      opponent: baseOpp(),
    });
    expect(snap.scoringEnvironment.completeness).toBe('SOURCE_ONLY');
    expect(snap.scoringEnvironment.usable).toBe(false);
    expect(snap.scoringEnvironment.optional['form.season_points']!.value).toBe(24);
  });

  it('37. perimeter SOURCE_ONLY when recent TPA null — no season substitute', () => {
    const snap = composeMatchupContext({
      role: baseRole({ recentRole: { tpa: null } }),
      form: baseForm(),
      opponent: baseOpp(),
    });
    expect(snap.perimeter.completeness).toBe('SOURCE_ONLY');
    expect(snap.perimeter.usable).toBe(false);
  });

  it('P. all optionals missing but required present → PARTIAL', () => {
    const snap = composeMatchupContext({
      role: baseRole({
        seasonRole: { tpa: null, fga: null, fta: null },
        recentRole: { fga: null, fta: null, tpa: 8 },
      }),
      form: baseForm({
        seasonForm: { points: null, tpm: null, threePct: null },
        recentForm: { points: 22, tpm: null, threePct: null },
      }),
      opponent: baseOpp({
        opponent: { pace: null, threePointAttemptRateAllowed: 0.4, defensiveRating: 112 },
      }),
    });
    expect(snap.scoringEnvironment.completeness).toBe('PARTIAL');
    expect(snap.perimeter.completeness).toBe('PARTIAL');
    expect(snap.completeness.status).toBe('PARTIAL');
  });

  it('31. TARGET_ALIGNMENT_TEST rejects different games', () => {
    expect(() =>
      composeMatchupContext({
        role: baseRole({ gameId: 'A' }),
        form: baseForm({ gameId: 'A' }),
        opponent: baseOpp({ gameId: 'B' }),
      })
    ).toThrow(MatchupCompositionError);
  });

  it('32. player mismatch rejected', () => {
    expect(() =>
      composeMatchupContext({
        role: baseRole({ playerEntityId: 'A' }),
        form: baseForm({ playerEntityId: 'B' }),
        opponent: baseOpp(),
      })
    ).toThrow(/player mismatch/);
  });

  it('33. team mismatch rejected', () => {
    expect(() =>
      composeMatchupContext({
        role: baseRole({ teamId: 'DET' }),
        form: baseForm({ teamId: 'DET' }),
        opponent: baseOpp({ teamId: 'BOS', opponentTeamId: 'DET' }),
      })
    ).toThrow(/opponent owner team/);
  });

  it('34. opponent inversion rejected', () => {
    expect(() =>
      composeMatchupContext({
        role: baseRole({ teamId: 'DET' }),
        form: baseForm({ teamId: 'DET' }),
        // Boston-owned snapshot (profile = DET) — wrong ownership for DET player
        opponent: baseOpp({ teamId: 'BOS', opponentTeamId: 'DET' }),
      })
    ).toThrow(MatchupCompositionError);
  });

  it('correct DET@BOS ownership accepted', () => {
    const snap = composeMatchupContext({
      role: baseRole({ teamId: 'DET' }),
      form: baseForm({ teamId: 'DET' }),
      opponent: baseOpp({ teamId: 'DET', opponentTeamId: 'BOS' }),
    });
    expect(snap.opponentTeamId).toBe('BOS');
    expect(snap.teamId).toBe('DET');
  });

  it('45. version mismatch rejected', () => {
    expect(() =>
      composeMatchupContext({
        role: baseRole({ contextVersion: 'player-role-context-v0' as typeof PLAYER_ROLE_CONTEXT_VERSION }),
        form: baseForm(),
        opponent: baseOpp(),
      })
    ).toThrow(/role version/);
  });

  it('44. source value parity', () => {
    const role = baseRole();
    const form = baseForm();
    const opponent = baseOpp();
    const snap = composeMatchupContext({ role, form, opponent });
    expect(snap.perimeter.required['role.recent_tpa']!.value).toBe(role.recentRole.tpa);
    expect(snap.scoringEnvironment.required['form.recent_points']!.value).toBe(
      form.recentForm.points
    );
    expect(snap.scoringEnvironment.required['opponent.defensive_rating']!.value).toBe(
      opponent.opponent.defensiveRating
    );
    assertMatchupInputValueParity(snap);
  });

  it('no new derived math fields on snapshot', () => {
    const snap = composeMatchupContext({
      role: baseRole(),
      form: baseForm(),
      opponent: baseOpp(),
    });
    expect(snap.provenance.newScalarFields).toEqual([]);
    expect(snap.model).toBe('HYBRID');
    expect(JSON.stringify(snap)).not.toMatch(/matchup_score|edge|advantage/i);
    expect(snap.scoringEnvironment.dimensionId).toBe(MATCHUP_DIMENSION_ID.SCORING_ENVIRONMENT);
  });

  it('G. opponent cold → SOURCE_ONLY scoring/perimeter', () => {
    const snap = composeMatchupContext({
      role: baseRole(),
      form: baseForm(),
      opponent: baseOpp({
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
    });
    expect(snap.scoringEnvironment.completeness).toBe('SOURCE_ONLY');
    expect(snap.perimeter.completeness).toBe('SOURCE_ONLY');
  });
});
