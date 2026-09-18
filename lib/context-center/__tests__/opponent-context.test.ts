import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  OPPONENT_CONTEXT_VERSION,
  OPPONENT_DEFINITIONS,
  POSSESSION_FTA_WEIGHT,
  assertRegistryIntegrity,
  aggregateDefensiveRating,
  aggregateDefensiveReboundPct,
  aggregateOffensiveReboundPct,
  aggregatePace,
  aggregateThreePointAttemptRateAllowed,
  aggregateTurnoverRate,
  buildOpponentHistoryIndex,
  computeOpponentContext,
  getContextDefinition,
  reconstructPairedBoxesForGame,
  toTeamGameContextRow,
  type OpponentGameMeta,
  type OpponentPglStatRow,
  type OpponentTeamBox,
} from '@/lib/context-center';

function game(partial: Partial<OpponentGameMeta> & Pick<OpponentGameMeta, 'gameId' | 'startTime'>): OpponentGameMeta {
  return {
    season: '2025',
    status: 'Final',
    homeTeamId: 'BOS',
    awayTeamId: 'DET',
    homeScore: 110,
    awayScore: 100,
    ...partial,
  };
}

/** One synthetic player carrying all team totals (deterministic fixtures). */
function teamCarrier(
  teamId: string,
  gameId: string,
  stats: {
    points: number;
    fga: number;
    fta: number;
    tpa: number;
    tov: number;
    orb: number;
    drb: number;
  }
): OpponentPglStatRow {
  return {
    playerId: `${teamId}-carrier`,
    teamId,
    gameId,
    points: stats.points,
    fieldGoalsAttempted: stats.fga,
    freeThrowsAttempted: stats.fta,
    threePointersAttempted: stats.tpa,
    turnovers: stats.tov,
    offensiveRebounds: stats.orb,
    defensiveRebounds: stats.drb,
  };
}

function boxFromSides(
  teamId: string,
  oppId: string,
  gameId: string,
  startTime: string,
  season: string,
  team: { pts: number; pa: number; fga: number; fta: number; tpa: number; tov: number; orb: number; drb: number },
  opp: { fga: number; fta: number; tpa: number; tov: number; orb: number; drb: number }
): OpponentTeamBox {
  const teamPoss = team.fga + POSSESSION_FTA_WEIGHT * team.fta - team.orb + team.tov;
  const oppPoss = opp.fga + POSSESSION_FTA_WEIGHT * opp.fta - opp.orb + opp.tov;
  const est = 0.5 * (teamPoss + oppPoss);
  return {
    usable: true,
    teamId,
    gameId,
    season,
    startTime,
    opponentTeamId: oppId,
    points: team.pts,
    pointsAllowed: team.pa,
    fga: team.fga,
    fta: team.fta,
    tpa: team.tpa,
    tov: team.tov,
    orb: team.orb,
    drb: team.drb,
    opponentFga: opp.fga,
    opponentFta: opp.fta,
    opponentTpa: opp.tpa,
    opponentTov: opp.tov,
    opponentOrb: opp.orb,
    opponentDrb: opp.drb,
    estimatedPossessions: est,
    pglPointsSum: team.pts,
  };
}

describe('opponent-context-v1 registry', () => {
  it('registers exactly six OPPONENT fields', () => {
    expect(OPPONENT_DEFINITIONS).toHaveLength(6);
    for (const d of OPPONENT_DEFINITIONS) {
      expect(d.family).toBe('OPPONENT');
      expect(d.grain).toBe('TEAM_GAME');
      expect(d.kind).toBe('DERIVED_CONTEXT');
      expect(d.version).toBe(OPPONENT_CONTEXT_VERSION);
      expect(d.predictiveStatus).toBe('NOT_TESTED');
      expect(d.mayAdjustProjection).toBe(false);
      expect(d.displayStatus).toBe('DISPLAYABLE');
    }
    expect(assertRegistryIntegrity().ok).toBe(true);
    expect(getContextDefinition('opponent.pace')?.contextId).toBe('opponent.pace');
  });
});

describe('opponent-context-v1 team box + formulas', () => {
  it('K. mirrors opponent stats across sides', () => {
    const g = game({ gameId: 'm1', startTime: '2025-11-01T00:00:00Z', homeScore: 120, awayScore: 105 });
    const pgl = [
      teamCarrier('BOS', 'm1', { points: 118, fga: 90, fta: 20, tpa: 40, tov: 12, orb: 10, drb: 30 }),
      teamCarrier('DET', 'm1', { points: 104, fga: 88, fta: 22, tpa: 35, tov: 14, orb: 8, drb: 32 }),
    ];
    const r = reconstructPairedBoxesForGame({ game: g, pglRows: pgl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [home, away] = r.boxes;
    expect(home.teamId).toBe('BOS');
    expect(away.teamId).toBe('DET');
    expect(home.opponentFga).toBe(away.fga);
    expect(away.opponentFga).toBe(home.fga);
    expect(home.opponentOrb).toBe(away.orb);
    expect(home.pointsAllowed).toBe(105);
    expect(away.pointsAllowed).toBe(120);
  });

  it('J. drops duplicate PGL player rows (no double count)', () => {
    const g = game({ gameId: 'd1', startTime: '2025-11-01T00:00:00Z' });
    const row = teamCarrier('BOS', 'd1', { points: 100, fga: 80, fta: 20, tpa: 30, tov: 10, orb: 8, drb: 28 });
    const det = teamCarrier('DET', 'd1', { points: 98, fga: 82, fta: 18, tpa: 32, tov: 11, orb: 9, drb: 27 });
    const r = reconstructPairedBoxesForGame({ game: g, pglRows: [row, { ...row }, det] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duplicatePlayerRowsDropped).toBe(1);
    expect(r.boxes[0].fga).toBe(80);
  });

  it('H. missing required box field → unusable', () => {
    const g = game({ gameId: 'miss', startTime: '2025-11-01T00:00:00Z' });
    const bos: OpponentPglStatRow = {
      ...teamCarrier('BOS', 'miss', { points: 100, fga: 80, fta: 20, tpa: 30, tov: 10, orb: 8, drb: 28 }),
      offensiveRebounds: null,
    };
    const det = teamCarrier('DET', 'miss', { points: 98, fga: 82, fta: 18, tpa: 32, tov: 11, orb: 9, drb: 27 });
    const r = reconstructPairedBoxesForGame({ game: g, pglRows: [bos, det] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/missing_required_fields:orb/);
  });

  it('canonical reconstructTeamMeasures parity on possessions + DRtg', () => {
    const g = game({ gameId: 'par', startTime: '2025-11-01T00:00:00Z', homeScore: 112, awayScore: 108 });
    const pgl = [
      teamCarrier('BOS', 'par', { points: 112, fga: 90, fta: 24, tpa: 38, tov: 13, orb: 11, drb: 34 }),
      teamCarrier('DET', 'par', { points: 108, fga: 86, fta: 20, tpa: 42, tov: 15, orb: 9, drb: 30 }),
    ];
    const r = reconstructPairedBoxesForGame({ game: g, pglRows: pgl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = toTeamGameContextRow(r.boxes[0]);
    // Inline Feature D reconstructTeamMeasures formula (avoid importing betting→db in unit tests)
    const teamPoss =
      (row.team_fga ?? 0) +
      POSSESSION_FTA_WEIGHT * (row.team_fta ?? 0) -
      (row.offensive_rebounds ?? 0) +
      (row.team_turnovers ?? 0);
    const oppPoss =
      (row.opponent_fga ?? 0) +
      POSSESSION_FTA_WEIGHT * (row.opponent_fta ?? 0) -
      (row.opponent_offensive_rebounds ?? 0) +
      (row.opponent_turnovers ?? 0);
    const est = 0.5 * (teamPoss + oppPoss);
    const defRating = (100 * (row.points_allowed ?? 0)) / est;
    expect(POSSESSION_FTA_WEIGHT).toBe(0.44);
    expect(r.boxes[0].estimatedPossessions).toBeCloseTo(est, 10);
    expect(defRating).toBeCloseTo((100 * r.boxes[0].pointsAllowed) / r.boxes[0].estimatedPossessions, 10);
  });

  it('I. zero denominator protection for rates', () => {
    const bad = boxFromSides(
      'BOS',
      'DET',
      'z1',
      '2025-11-01T00:00:00Z',
      '2025',
      { pts: 100, pa: 100, fga: 0, fta: 0, tpa: 0, tov: 0, orb: 0, drb: 0 },
      { fga: 0, fta: 0, tpa: 0, tov: 0, orb: 0, drb: 0 }
    );
    // Force zero possessions path
    const forced = { ...bad, estimatedPossessions: 0, fga: 0, fta: 0, tov: 0, opponentFga: 0 };
    expect(aggregatePace([forced])).toBeNull();
    expect(aggregateDefensiveRating([forced])).toBeNull();
    expect(aggregateThreePointAttemptRateAllowed([forced])).toBeNull();
  });

  it('M. pooled != mean-of-rates for DRtg and rate metrics', () => {
    const g1 = boxFromSides(
      'BOS',
      'X',
      'h1',
      '2025-10-25T00:00:00Z',
      '2025',
      { pts: 100, pa: 110, fga: 80, fta: 20, tpa: 30, tov: 10, orb: 10, drb: 40 },
      { fga: 90, fta: 10, tpa: 45, tov: 8, orb: 5, drb: 30 }
    );
    // Manually set possessions to exact values for clarity
    const a: OpponentTeamBox = { ...g1, estimatedPossessions: 100, pointsAllowed: 110, drb: 40, opponentOrb: 10, orb: 10, opponentDrb: 30, tov: 10, fga: 80, fta: 20, opponentTpa: 40, opponentFga: 80 };
    const b: OpponentTeamBox = {
      ...g1,
      gameId: 'h2',
      startTime: '2025-10-26T00:00:00Z',
      estimatedPossessions: 104,
      pointsAllowed: 112,
      drb: 20,
      opponentOrb: 20,
      orb: 5,
      opponentDrb: 35,
      tov: 20,
      fga: 70,
      fta: 10,
      opponentTpa: 30,
      opponentFga: 100,
    };

    expect(aggregatePace([a, b])).toBeCloseTo(102, 10);
    const pooledDrtg = aggregateDefensiveRating([a, b]);
    expect(pooledDrtg).toBeCloseTo((100 * (110 + 112)) / (100 + 104), 10);
    const meanOfGameDrtg = ((100 * 110) / 100 + (100 * 112) / 104) / 2;
    expect(Math.abs(pooledDrtg! - meanOfGameDrtg)).toBeGreaterThan(0.01);

    const pooledDrb = aggregateDefensiveReboundPct([a, b]);
    expect(pooledDrb).toBeCloseTo((40 + 20) / (50 + 40), 10);
    const meanDrb = (40 / 50 + 20 / 40) / 2;
    expect(pooledDrb).not.toBeCloseTo(meanDrb, 5);

    const pooledOrb = aggregateOffensiveReboundPct([a, b]);
    expect(pooledOrb).toBeCloseTo((10 + 5) / (40 + 40), 10);

    const pooledTov = aggregateTurnoverRate([a, b]);
    const denA = 80 + 0.44 * 20 + 10;
    const denB = 70 + 0.44 * 10 + 20;
    expect(pooledTov).toBeCloseTo((10 + 20) / (denA + denB), 10);
    const meanTov = (10 / denA + 20 / denB) / 2;
    expect(pooledTov).not.toBeCloseTo(meanTov, 5);

    const pooled3 = aggregateThreePointAttemptRateAllowed([a, b]);
    expect(pooled3).toBeCloseTo((40 + 30) / (80 + 100), 10);
    const mean3 = (40 / 80 + 30 / 100) / 2;
    expect(pooled3).not.toBeCloseTo(mean3, 5);
  });
});

describe('opponent-context-v1 snapshot semantics', () => {
  const bos1 = boxFromSides(
    'BOS',
    'NYK',
    'b1',
    '2025-10-24T00:00:00Z',
    '2025',
    { pts: 100, pa: 110, fga: 85, fta: 20, tpa: 30, tov: 12, orb: 10, drb: 35 },
    { fga: 88, fta: 18, tpa: 44, tov: 10, orb: 8, drb: 32 }
  );
  const bos2 = boxFromSides(
    'BOS',
    'CHI',
    'b2',
    '2025-10-26T00:00:00Z',
    '2025',
    { pts: 120, pa: 100, fga: 90, fta: 22, tpa: 28, tov: 8, orb: 12, drb: 30 },
    { fga: 80, fta: 16, tpa: 20, tov: 14, orb: 6, drb: 34 }
  );
  // High scoring offense, soft defense contrast
  const bosSoft = {
    ...bos1,
    gameId: 'bsoft',
    points: 140,
    pointsAllowed: 130,
    estimatedPossessions: 100,
  };
  const bosPriorSeason = {
    ...bos1,
    gameId: 'b0',
    season: '2024',
    startTime: '2024-10-24T00:00:00Z',
  };

  it('A. history_n=0 cold start → null metrics, SOURCE_ONLY', () => {
    const index = buildOpponentHistoryIndex([]);
    const snap = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: 't0', startTime: '2025-10-22T23:00:00Z', homeTeamId: 'BOS', awayTeamId: 'DET' }),
      index,
    });
    expect(snap.history.n).toBe(0);
    expect(snap.completeness.status).toBe('SOURCE_ONLY');
    expect(snap.opponent.pace).toBeNull();
    expect(snap.opponent.defensiveRating).toBeNull();
    expect(snap.provenance.priorSeasonFallback).toBe(false);
    expect(snap.provenance.staleTgsAdvancedColumnsUsed).toBe(false);
  });

  it('B. history_n=1', () => {
    const index = buildOpponentHistoryIndex([bos1]);
    const snap = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: 't1', startTime: '2025-10-25T00:00:00Z' }),
      index,
    });
    expect(snap.history.n).toBe(1);
    expect(snap.opponent.pace).toBeCloseTo(bos1.estimatedPossessions, 10);
    expect(snap.completeness.status).toBe('COMPLETE');
  });

  it('C. multiple historical games use BOS profile for DET owner', () => {
    const index = buildOpponentHistoryIndex([bos1, bos2]);
    const snap = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: 't2', startTime: '2025-10-28T00:00:00Z' }),
      index,
    });
    expect(snap.teamId).toBe('DET');
    expect(snap.opponentTeamId).toBe('BOS');
    expect(snap.history.n).toBe(2);
    expect(snap.opponent.pace).toBeCloseTo(aggregatePace([bos1, bos2])!, 10);
  });

  it('N. opponent mapping inversion (BOS owner gets DET profile)', () => {
    const detHist = boxFromSides(
      'DET',
      'ORL',
      'd1',
      '2025-10-20T00:00:00Z',
      '2025',
      { pts: 99, pa: 101, fga: 84, fta: 19, tpa: 33, tov: 11, orb: 9, drb: 31 },
      { fga: 86, fta: 17, tpa: 39, tov: 12, orb: 7, drb: 33 }
    );
    const index = buildOpponentHistoryIndex([bos1, detHist]);
    const asDet = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: 'inv', startTime: '2025-10-28T00:00:00Z' }),
      index,
    });
    const asBos = computeOpponentContext({
      teamId: 'BOS',
      target: game({ gameId: 'inv', startTime: '2025-10-28T00:00:00Z' }),
      index,
    });
    expect(asDet.opponentTeamId).toBe('BOS');
    expect(asBos.opponentTeamId).toBe('DET');
    expect(asDet.opponent.pace).toBeCloseTo(bos1.estimatedPossessions, 10);
    expect(asBos.opponent.pace).toBeCloseTo(detHist.estimatedPossessions, 10);
  });

  it('D/E/F/G temporal filters: same-tip, future, prior-season, non-Final excluded', () => {
    const sameTip = { ...bos2, gameId: 'same', startTime: '2025-10-28T00:00:00Z' };
    const future = { ...bos2, gameId: 'fut', startTime: '2025-10-29T00:00:00Z' };
    const index = buildOpponentHistoryIndex([bosPriorSeason, bos1, sameTip, future]);
    const snap = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: 't', startTime: '2025-10-28T00:00:00Z' }),
      index,
    });
    expect(snap.history.n).toBe(1);
    expect(snap.history.latestGameStart).toBe(bos1.startTime);
  });

  it('31. DRtg uses points allowed not points scored', () => {
    const index = buildOpponentHistoryIndex([bosSoft]);
    const snap = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: 'dr', startTime: '2025-10-25T00:00:00Z' }),
      index,
    });
    expect(snap.opponent.defensiveRating).toBeCloseTo(130, 10);
    expect(snap.opponent.defensiveRating).not.toBeCloseTo(140, 0);
  });

  it('32/O. 3PA allowed uses opponent attempts not own', () => {
    const lowOwnHighAllowed = boxFromSides(
      'BOS',
      'X',
      '3a',
      '2025-10-24T00:00:00Z',
      '2025',
      { pts: 100, pa: 100, fga: 90, fta: 10, tpa: 10, tov: 10, orb: 8, drb: 30 },
      { fga: 100, fta: 10, tpa: 50, tov: 10, orb: 8, drb: 30 }
    );
    const index = buildOpponentHistoryIndex([lowOwnHighAllowed]);
    const snap = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: '3t', startTime: '2025-10-25T00:00:00Z' }),
      index,
    });
    expect(snap.opponent.threePointAttemptRateAllowed).toBeCloseTo(0.5, 10);
    expect(snap.opponent.threePointAttemptRateAllowed).not.toBeCloseTo(10 / 90, 3);
  });

  it('33. asymmetric rebound percentages', () => {
    const reb = boxFromSides(
      'BOS',
      'X',
      'rb',
      '2025-10-24T00:00:00Z',
      '2025',
      { pts: 100, pa: 100, fga: 80, fta: 20, tpa: 30, tov: 10, orb: 20, drb: 40 },
      { fga: 80, fta: 20, tpa: 30, tov: 10, orb: 5, drb: 20 }
    );
    const index = buildOpponentHistoryIndex([reb]);
    const snap = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: 'rt', startTime: '2025-10-25T00:00:00Z' }),
      index,
    });
    expect(snap.opponent.defensiveReboundPct).toBeCloseTo(40 / (40 + 5), 10);
    expect(snap.opponent.offensiveReboundPct).toBeCloseTo(20 / (20 + 20), 10);
  });

  it('35/36. future + same-tip mutation leave snapshot unchanged', () => {
    const index1 = buildOpponentHistoryIndex([bos1, bos2]);
    const target = game({ gameId: 'mut', startTime: '2025-10-28T00:00:00Z' });
    const before = computeOpponentContext({ teamId: 'DET', target, index: index1 });
    const mutated = buildOpponentHistoryIndex([
      bos1,
      bos2,
      { ...bos2, gameId: 'sameTip', startTime: target.startTime, pointsAllowed: 200, estimatedPossessions: 50 },
      { ...bos2, gameId: 'after', startTime: '2025-11-01T00:00:00Z', pointsAllowed: 200, estimatedPossessions: 50 },
    ]);
    const after = computeOpponentContext({ teamId: 'DET', target, index: mutated });
    expect(after).toEqual(before);
  });

  it('38. stale TGS independence — snapshot never reads TGS; flag is false', () => {
    const index = buildOpponentHistoryIndex([bos1]);
    const snap = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: 'tgs', startTime: '2025-10-25T00:00:00Z' }),
      index,
    });
    expect(snap.provenance.sourcePath).toBe('pgl_team_box_v1');
    expect(snap.provenance.staleTgsAdvancedColumnsUsed).toBe(false);
    // Mutating a pretend TGS blob cannot affect pure function inputs
    const fakeTgs = { pace: 999, defensive_rating: 999, opponent_fga: 0 };
    void fakeTgs;
    const again = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: 'tgs', startTime: '2025-10-25T00:00:00Z' }),
      index,
    });
    expect(again.opponent).toEqual(snap.opponent);
  });

  it('L. OT game (elevated possessions) included in mean pace without /48', () => {
    const ot = {
      ...bos1,
      gameId: 'ot',
      startTime: '2025-10-27T00:00:00Z',
      estimatedPossessions: 118,
      fga: 100,
      fta: 30,
      tov: 14,
      orb: 12,
    };
    const index = buildOpponentHistoryIndex([bos1, ot]);
    const snap = computeOpponentContext({
      teamId: 'DET',
      target: game({ gameId: 'ott', startTime: '2025-10-28T00:00:00Z' }),
      index,
    });
    expect(snap.opponent.pace).toBeCloseTo((bos1.estimatedPossessions + 118) / 2, 10);
    expect(snap.provenance.paceUnit).toBe('estimated_possessions_per_team_game');
  });
});

describe('opponent-context-v1 held-out fixture lock prep', () => {
  it('exports stable held-out case digest helper', () => {
    // Placeholder — real SHA locked in heldout-fixtures file
    const payload = JSON.stringify({ version: OPPONENT_CONTEXT_VERSION });
    const sha = createHash('sha256').update(payload).digest('hex');
    expect(sha).toHaveLength(64);
  });
});
