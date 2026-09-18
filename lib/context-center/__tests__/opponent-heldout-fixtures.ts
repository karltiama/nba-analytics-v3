/**
 * Blind held-out fixtures for opponent-context-v1.
 * Frozen before final certification — SHA locked in opponent-heldout.test.ts.
 */

import { POSSESSION_FTA_WEIGHT } from '../opponent/team-box';
import type { OpponentGameMeta, OpponentTeamBox } from '@/lib/context-center';

export type OpponentHeldOutCase = {
  id: string;
  category: string;
  teamId: string;
  target: OpponentGameMeta;
  historyBoxes: OpponentTeamBox[];
  expect: {
    historyN: number;
    completeness: 'COMPLETE' | 'PARTIAL' | 'SOURCE_ONLY' | 'SOURCE_UNKNOWN';
    opponentTeamId: string;
    pace: number | null;
    defensiveRating: number | null;
    defensiveReboundPct: number | null;
    offensiveReboundPct: number | null;
    turnoverRate: number | null;
    threePointAttemptRateAllowed: number | null;
    latestGameStart: string | null;
  };
};

function box(args: {
  teamId: string;
  oppId: string;
  gameId: string;
  startTime: string;
  season: string;
  pa: number;
  poss: number;
  fga: number;
  fta: number;
  tov: number;
  orb: number;
  drb: number;
  oFga: number;
  oFta: number;
  oTov: number;
  oOrb: number;
  oDrb: number;
  oTpa: number;
  tpa?: number;
  pts?: number;
}): OpponentTeamBox {
  return {
    usable: true,
    teamId: args.teamId,
    opponentTeamId: args.oppId,
    gameId: args.gameId,
    season: args.season,
    startTime: args.startTime,
    points: args.pts ?? 100,
    pointsAllowed: args.pa,
    fga: args.fga,
    fta: args.fta,
    tpa: args.tpa ?? 30,
    tov: args.tov,
    orb: args.orb,
    drb: args.drb,
    opponentFga: args.oFga,
    opponentFta: args.oFta,
    opponentTpa: args.oTpa,
    opponentTov: args.oTov,
    opponentOrb: args.oOrb,
    opponentDrb: args.oDrb,
    estimatedPossessions: args.poss,
    pglPointsSum: args.pts ?? 100,
  };
}

const tip = '2025-12-15T00:00:00Z';
const targetBase: OpponentGameMeta = {
  gameId: 'HOLD_TARGET',
  season: '2025',
  startTime: tip,
  status: 'Final',
  homeTeamId: 'BOS',
  awayTeamId: 'DET',
  homeScore: 110,
  awayScore: 100,
};

const h1 = box({
  teamId: 'BOS',
  oppId: 'NYK',
  gameId: 'H1',
  startTime: '2025-11-01T00:00:00Z',
  season: '2025',
  pa: 110,
  poss: 100,
  fga: 80,
  fta: 20,
  tov: 10,
  orb: 10,
  drb: 40,
  oFga: 80,
  oFta: 20,
  oTov: 10,
  oOrb: 10,
  oDrb: 30,
  oTpa: 40,
});

const h2 = box({
  teamId: 'BOS',
  oppId: 'CHI',
  gameId: 'H2',
  startTime: '2025-11-10T00:00:00Z',
  season: '2025',
  pa: 112,
  poss: 104,
  fga: 70,
  fta: 10,
  tov: 20,
  orb: 5,
  drb: 20,
  oFga: 100,
  oFta: 10,
  oTov: 12,
  oOrb: 20,
  oDrb: 35,
  oTpa: 30,
});

const detHist = box({
  teamId: 'DET',
  oppId: 'ORL',
  gameId: 'D1',
  startTime: '2025-11-05T00:00:00Z',
  season: '2025',
  pa: 105,
  poss: 98,
  fga: 82,
  fta: 18,
  tov: 11,
  orb: 9,
  drb: 33,
  oFga: 85,
  oFta: 15,
  oTov: 9,
  oOrb: 7,
  oDrb: 31,
  oTpa: 25,
});

function pooledDrtg(boxes: OpponentTeamBox[]): number {
  const a = boxes.reduce((s, b) => s + b.pointsAllowed, 0);
  const p = boxes.reduce((s, b) => s + b.estimatedPossessions, 0);
  return (100 * a) / p;
}
function pooledDrb(boxes: OpponentTeamBox[]): number {
  const n = boxes.reduce((s, b) => s + b.drb, 0);
  const d = boxes.reduce((s, b) => s + b.drb + b.opponentOrb, 0);
  return n / d;
}
function pooledOrb(boxes: OpponentTeamBox[]): number {
  const n = boxes.reduce((s, b) => s + b.orb, 0);
  const d = boxes.reduce((s, b) => s + b.orb + b.opponentDrb, 0);
  return n / d;
}
function pooledTov(boxes: OpponentTeamBox[]): number {
  const n = boxes.reduce((s, b) => s + b.tov, 0);
  const d = boxes.reduce((s, b) => s + b.fga + POSSESSION_FTA_WEIGHT * b.fta + b.tov, 0);
  return n / d;
}
function pooled3(boxes: OpponentTeamBox[]): number {
  const n = boxes.reduce((s, b) => s + b.opponentTpa, 0);
  const d = boxes.reduce((s, b) => s + b.opponentFga, 0);
  return n / d;
}
function meanPace(boxes: OpponentTeamBox[]): number {
  return boxes.reduce((s, b) => s + b.estimatedPossessions, 0) / boxes.length;
}

const manyBos: OpponentTeamBox[] = Array.from({ length: 12 }, (_, i) =>
  box({
    teamId: 'BOS',
    oppId: `T${i}`,
    gameId: `M${i}`,
    startTime: `2025-10-${String(20 + (i % 9)).padStart(2, '0')}T0${i % 6}:00:00Z`,
    season: '2025',
    pa: 108 + (i % 5),
    poss: 100 + (i % 4),
    fga: 80,
    fta: 20,
    tov: 12,
    orb: 10,
    drb: 34,
    oFga: 88,
    oFta: 18,
    oTov: 11,
    oOrb: 8,
    oDrb: 30,
    oTpa: 36,
  })
);

export const OPPONENT_HELDOUT_CASES: OpponentHeldOutCase[] = [
  {
    id: 'HO-cold',
    category: 'cold_start',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-cold', startTime: '2025-10-22T00:00:00Z' },
    historyBoxes: [],
    expect: {
      historyN: 0,
      completeness: 'SOURCE_ONLY',
      opponentTeamId: 'BOS',
      pace: null,
      defensiveRating: null,
      defensiveReboundPct: null,
      offensiveReboundPct: null,
      turnoverRate: null,
      threePointAttemptRateAllowed: null,
      latestGameStart: null,
    },
  },
  {
    id: 'HO-n1',
    category: 'history_n_1',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-n1', startTime: '2025-11-05T00:00:00Z' },
    historyBoxes: [h1],
    expect: {
      historyN: 1,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: h1.estimatedPossessions,
      defensiveRating: pooledDrtg([h1]),
      defensiveReboundPct: pooledDrb([h1]),
      offensiveReboundPct: pooledOrb([h1]),
      turnoverRate: pooledTov([h1]),
      threePointAttemptRateAllowed: pooled3([h1]),
      latestGameStart: h1.startTime,
    },
  },
  {
    id: 'HO-n2-pooled',
    category: 'pooled_rates',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-n2', startTime: tip },
    historyBoxes: [h1, h2],
    expect: {
      historyN: 2,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: meanPace([h1, h2]),
      defensiveRating: pooledDrtg([h1, h2]),
      defensiveReboundPct: pooledDrb([h1, h2]),
      offensiveReboundPct: pooledOrb([h1, h2]),
      turnoverRate: pooledTov([h1, h2]),
      threePointAttemptRateAllowed: pooled3([h1, h2]),
      latestGameStart: h2.startTime,
    },
  },
  {
    id: 'HO-gt10',
    category: 'history_n_gt10',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-gt10', startTime: '2025-12-01T00:00:00Z' },
    historyBoxes: manyBos,
    expect: {
      historyN: 12,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: meanPace(manyBos),
      defensiveRating: pooledDrtg(manyBos),
      defensiveReboundPct: pooledDrb(manyBos),
      offensiveReboundPct: pooledOrb(manyBos),
      turnoverRate: pooledTov(manyBos),
      threePointAttemptRateAllowed: pooled3(manyBos),
      latestGameStart: [...manyBos].sort((a, b) =>
        a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.gameId.localeCompare(b.gameId)
      )[11]!.startTime,
    },
  },
  {
    id: 'HO-same-tip',
    category: 'same_tip_exclusion',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-same', startTime: tip },
    historyBoxes: [h1, { ...h2, gameId: 'SAME', startTime: tip, pointsAllowed: 999, estimatedPossessions: 50 }],
    expect: {
      historyN: 1,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: h1.estimatedPossessions,
      defensiveRating: pooledDrtg([h1]),
      defensiveReboundPct: pooledDrb([h1]),
      offensiveReboundPct: pooledOrb([h1]),
      turnoverRate: pooledTov([h1]),
      threePointAttemptRateAllowed: pooled3([h1]),
      latestGameStart: h1.startTime,
    },
  },
  {
    id: 'HO-future',
    category: 'future_exclusion',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-fut', startTime: tip },
    historyBoxes: [h1, { ...h2, gameId: 'FUT', startTime: '2025-12-20T00:00:00Z', pointsAllowed: 999 }],
    expect: {
      historyN: 1,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: h1.estimatedPossessions,
      defensiveRating: pooledDrtg([h1]),
      defensiveReboundPct: pooledDrb([h1]),
      offensiveReboundPct: pooledOrb([h1]),
      turnoverRate: pooledTov([h1]),
      threePointAttemptRateAllowed: pooled3([h1]),
      latestGameStart: h1.startTime,
    },
  },
  {
    id: 'HO-prior-season',
    category: 'prior_season_exclusion',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-ps', startTime: tip },
    historyBoxes: [{ ...h1, season: '2024', gameId: 'PS', startTime: '2024-11-01T00:00:00Z' }, h2],
    expect: {
      historyN: 1,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: h2.estimatedPossessions,
      defensiveRating: pooledDrtg([h2]),
      defensiveReboundPct: pooledDrb([h2]),
      offensiveReboundPct: pooledOrb([h2]),
      turnoverRate: pooledTov([h2]),
      threePointAttemptRateAllowed: pooled3([h2]),
      latestGameStart: h2.startTime,
    },
  },
  {
    id: 'HO-perspective',
    category: 'perspective_correctness',
    teamId: 'BOS',
    target: { ...targetBase, gameId: 'HO-persp', startTime: tip },
    historyBoxes: [h1, h2, detHist],
    expect: {
      historyN: 1,
      completeness: 'COMPLETE',
      opponentTeamId: 'DET',
      pace: detHist.estimatedPossessions,
      defensiveRating: pooledDrtg([detHist]),
      defensiveReboundPct: pooledDrb([detHist]),
      offensiveReboundPct: pooledOrb([detHist]),
      turnoverRate: pooledTov([detHist]),
      threePointAttemptRateAllowed: pooled3([detHist]),
      latestGameStart: detHist.startTime,
    },
  },
  {
    id: 'HO-drtg-perspective',
    category: 'pooled_drtg',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-drtg', startTime: tip },
    historyBoxes: [
      box({
        teamId: 'BOS',
        oppId: 'X',
        gameId: 'SCORER',
        startTime: '2025-11-01T00:00:00Z',
        season: '2025',
        pts: 140,
        pa: 90,
        poss: 100,
        fga: 80,
        fta: 20,
        tov: 10,
        orb: 10,
        drb: 35,
        oFga: 80,
        oFta: 20,
        oTov: 10,
        oOrb: 8,
        oDrb: 30,
        oTpa: 32,
      }),
    ],
    expect: {
      historyN: 1,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: 100,
      defensiveRating: 90,
      defensiveReboundPct: 35 / (35 + 8),
      offensiveReboundPct: 10 / (10 + 30),
      turnoverRate: 10 / (80 + POSSESSION_FTA_WEIGHT * 20 + 10),
      threePointAttemptRateAllowed: 32 / 80,
      latestGameStart: '2025-11-01T00:00:00Z',
    },
  },
  {
    id: 'HO-3pa-allowed',
    category: 'pooled_3pa_allowed',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-3pa', startTime: tip },
    historyBoxes: [
      box({
        teamId: 'BOS',
        oppId: 'X',
        gameId: '3PA',
        startTime: '2025-11-01T00:00:00Z',
        season: '2025',
        pa: 100,
        poss: 100,
        fga: 90,
        fta: 10,
        tov: 10,
        orb: 8,
        drb: 30,
        tpa: 5,
        oFga: 100,
        oFta: 10,
        oTov: 10,
        oOrb: 8,
        oDrb: 30,
        oTpa: 55,
      }),
    ],
    expect: {
      historyN: 1,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: 100,
      defensiveRating: 100,
      defensiveReboundPct: 30 / (30 + 8),
      offensiveReboundPct: 8 / (8 + 30),
      turnoverRate: 10 / (90 + POSSESSION_FTA_WEIGHT * 10 + 10),
      threePointAttemptRateAllowed: 0.55,
      latestGameStart: '2025-11-01T00:00:00Z',
    },
  },
  {
    id: 'HO-ot',
    category: 'ot',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-ot', startTime: tip },
    historyBoxes: [
      { ...h1, gameId: 'OT', estimatedPossessions: 118, startTime: '2025-11-02T00:00:00Z' },
    ],
    expect: {
      historyN: 1,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: 118,
      defensiveRating: pooledDrtg([{ ...h1, estimatedPossessions: 118 }]),
      defensiveReboundPct: pooledDrb([h1]),
      offensiveReboundPct: pooledOrb([h1]),
      turnoverRate: pooledTov([h1]),
      threePointAttemptRateAllowed: pooled3([h1]),
      latestGameStart: '2025-11-02T00:00:00Z',
    },
  },
  {
    id: 'HO-pace-mean',
    category: 'pace_mean',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-pace', startTime: tip },
    historyBoxes: [h1, h2],
    expect: {
      historyN: 2,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: 102,
      defensiveRating: pooledDrtg([h1, h2]),
      defensiveReboundPct: pooledDrb([h1, h2]),
      offensiveReboundPct: pooledOrb([h1, h2]),
      turnoverRate: pooledTov([h1, h2]),
      threePointAttemptRateAllowed: pooled3([h1, h2]),
      latestGameStart: h2.startTime,
    },
  },
  {
    id: 'HO-drb',
    category: 'pooled_dreb',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-drb', startTime: tip },
    historyBoxes: [h1, h2],
    expect: {
      historyN: 2,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: meanPace([h1, h2]),
      defensiveRating: pooledDrtg([h1, h2]),
      defensiveReboundPct: (40 + 20) / (50 + 40),
      offensiveReboundPct: pooledOrb([h1, h2]),
      turnoverRate: pooledTov([h1, h2]),
      threePointAttemptRateAllowed: pooled3([h1, h2]),
      latestGameStart: h2.startTime,
    },
  },
  {
    id: 'HO-orb',
    category: 'pooled_oreb',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-orb', startTime: tip },
    historyBoxes: [h1, h2],
    expect: {
      historyN: 2,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: meanPace([h1, h2]),
      defensiveRating: pooledDrtg([h1, h2]),
      defensiveReboundPct: pooledDrb([h1, h2]),
      offensiveReboundPct: (10 + 5) / (40 + 40),
      turnoverRate: pooledTov([h1, h2]),
      threePointAttemptRateAllowed: pooled3([h1, h2]),
      latestGameStart: h2.startTime,
    },
  },
  {
    id: 'HO-tov',
    category: 'pooled_tov',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-tov', startTime: tip },
    historyBoxes: [h1, h2],
    expect: {
      historyN: 2,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: meanPace([h1, h2]),
      defensiveRating: pooledDrtg([h1, h2]),
      defensiveReboundPct: pooledDrb([h1, h2]),
      offensiveReboundPct: pooledOrb([h1, h2]),
      turnoverRate: pooledTov([h1, h2]),
      threePointAttemptRateAllowed: pooled3([h1, h2]),
      latestGameStart: h2.startTime,
    },
  },
  {
    id: 'HO-stale-tgs',
    category: 'stale_tgs_independence',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-tgs', startTime: tip },
    historyBoxes: [h1],
    expect: {
      historyN: 1,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: 100,
      defensiveRating: 110,
      defensiveReboundPct: pooledDrb([h1]),
      offensiveReboundPct: pooledOrb([h1]),
      turnoverRate: pooledTov([h1]),
      threePointAttemptRateAllowed: pooled3([h1]),
      latestGameStart: h1.startTime,
    },
  },
  {
    id: 'HO-missing-hist',
    category: 'missing_source_case',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-miss', startTime: tip },
    historyBoxes: [], // no reconstructed boxes for opponent
    expect: {
      historyN: 0,
      completeness: 'SOURCE_ONLY',
      opponentTeamId: 'BOS',
      pace: null,
      defensiveRating: null,
      defensiveReboundPct: null,
      offensiveReboundPct: null,
      turnoverRate: null,
      threePointAttemptRateAllowed: null,
      latestGameStart: null,
    },
  },
  {
    id: 'HO-nonfinal-not-in-index',
    category: 'non_final_exclusion',
    teamId: 'DET',
    target: { ...targetBase, gameId: 'HO-nf', startTime: tip },
    // Non-Final games never enter the box index by construction; only Final boxes listed.
    historyBoxes: [h1],
    expect: {
      historyN: 1,
      completeness: 'COMPLETE',
      opponentTeamId: 'BOS',
      pace: 100,
      defensiveRating: 110,
      defensiveReboundPct: pooledDrb([h1]),
      offensiveReboundPct: pooledOrb([h1]),
      turnoverRate: pooledTov([h1]),
      threePointAttemptRateAllowed: pooled3([h1]),
      latestGameStart: h1.startTime,
    },
  },
];
