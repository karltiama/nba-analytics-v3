import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import {
  buildAsOfModelInputs,
  computeMetricBlock,
  consensusMarketLine,
  filterPregameLines,
  scoreOpportunity,
  selectPriorGames,
  trackAProjection,
  trackBProjection,
  windowMean,
  type EvalGameLog,
} from '@/lib/betting/player-projection-eval';
import { computeProjection, computeTrackB1PlayerPropProbability } from '@/lib/betting/player-prop-model';
import { getStatsForPropType } from '@/lib/betting/player-prop-inputs';
import { isComboPropType } from '@/lib/betting/track-b1-policy';

function log(
  partial: Partial<EvalGameLog> & Pick<EvalGameLog, 'game_id' | 'start_time' | 'season'>
): EvalGameLog {
  return {
    player_id: 'p1',
    minutes: 30,
    points: 20,
    rebounds: 5,
    assists: 4,
    three_pointers_made: 2,
    ...partial,
  };
}

const GAMES: EvalGameLog[] = [
  log({ game_id: 'g-target', start_time: '2026-04-10T00:00:00.000Z', season: '2025', points: 40 }),
  log({ game_id: 'g-same-season-1', start_time: '2026-04-08T00:00:00.000Z', season: '2025', points: 10 }),
  log({ game_id: 'g-same-season-2', start_time: '2026-04-06T00:00:00.000Z', season: '2025', points: 20 }),
  log({ game_id: 'g-prior-season', start_time: '2025-12-01T00:00:00.000Z', season: '2024', points: 30 }),
  log({ game_id: 'g-later', start_time: '2026-04-12T00:00:00.000Z', season: '2025', points: 99 }),
];

describe('selectPriorGames lookahead', () => {
  it('excludes the target game, later games, and (active_season) other seasons', () => {
    const prior = selectPriorGames(GAMES, '2026-04-10T00:00:00.000Z', '2025', 'active_season');
    expect(prior.map((g) => g.game_id)).toEqual(['g-same-season-1', 'g-same-season-2']);
  });

  it('career includes prior seasons but still excludes later games and the target', () => {
    const prior = selectPriorGames(GAMES, '2026-04-10T00:00:00.000Z', '2025', 'career');
    expect(prior.map((g) => g.game_id)).toEqual([
      'g-same-season-1',
      'g-same-season-2',
      'g-prior-season',
    ]);
  });

  it('uses start_time not calendar date (same-day later tip is excluded)', () => {
    const sameDay: EvalGameLog[] = [
      log({ game_id: 'early', start_time: '2026-04-10T17:00:00.000Z', season: '2025', points: 8 }),
      log({ game_id: 'late', start_time: '2026-04-10T23:00:00.000Z', season: '2025', points: 50 }),
    ];
    const prior = selectPriorGames(sameDay, '2026-04-10T23:00:00.000Z', '2025', 'active_season');
    expect(prior.map((g) => g.game_id)).toEqual(['early']);
  });
});

describe('missing projections stay null', () => {
  it('does not replace an empty window with 0', () => {
    expect(windowMean([], 'points', 10)).toBeNull();
    expect(buildAsOfModelInputs([], '2025')).toBeNull();
    expect(trackAProjection(null, 'points')).toBeNull();
    expect(trackBProjection(null, 'points')).toBeNull();
  });

  it('scores unavailable models as null, not 0', () => {
    const row = scoreOpportunity({
      gameId: 'g-target',
      playerId: 'p1',
      propType: 'points',
      season: '2025',
      startTime: '2026-04-10T00:00:00.000Z',
      split: 'holdout',
      actual: 40,
      featureDefinition: 'active_season',
      allPlayerGames: [
        log({ game_id: 'g-target', start_time: '2026-04-10T00:00:00.000Z', season: '2025', points: 40 }),
      ],
      pregameLines: [],
    });
    expect(row.projections.season_avg).toBeNull();
    expect(row.projections.l10).toBeNull();
    expect(row.projections.l5).toBeNull();
    expect(row.projections.track_a).toBeNull();
    expect(row.projections.track_b).toBeNull();
    expect(row.projections.market_line).toBeNull();
    expect(row.priorCount).toBe(0);
  });
});

describe('Track A / Track B reuse live functions', () => {
  it('Track A equals 0.7 * L10 + 0.3 * season on as-of games', () => {
    const prior = selectPriorGames(GAMES, '2026-04-10T00:00:00.000Z', '2025', 'active_season');
    const inputs = buildAsOfModelInputs(prior, '2025');
    const a = trackAProjection(inputs, 'points');
    expect(a).toBeCloseTo(0.7 * 15 + 0.3 * 15, 10);
    expect(a).toBeCloseTo(computeProjection(15, 15), 10);
  });

  it('Track B matches computeTrackB1PlayerPropProbability on the same inputs', () => {
    const prior = selectPriorGames(GAMES, '2026-04-10T00:00:00.000Z', '2025', 'career');
    const inputs = buildAsOfModelInputs(prior, '2025')!;
    const stats = getStatsForPropType(inputs, 'points')!;
    const expected = computeTrackB1PlayerPropProbability(
      {
        last10Avg: stats.last10Avg,
        seasonAvg: stats.seasonAvg,
        line: 0,
        propType: 'points',
        last5Avg: stats.last5Avg,
        observedStdDev: stats.observedStdDev,
      },
      { signals: stats.stability, isCombo: isComboPropType('points') }
    ).projection;
    expect(trackBProjection(inputs, 'points')).toBeCloseTo(expected, 10);
  });
});

describe('pregame market lines', () => {
  it('drops snapshots at or after tipoff', () => {
    const kept = filterPregameLines(
      [
        {
          sportsbook: 'betmgm',
          lineValue: 27.5,
          oddsAmerican: -110,
          oddsDecimal: 1.91,
          decisionAt: '2026-04-10T00:00:00.000Z',
        },
        {
          sportsbook: 'fanduel',
          lineValue: 26.5,
          oddsAmerican: -110,
          oddsDecimal: 1.91,
          decisionAt: '2026-04-09T23:00:00.000Z',
        },
      ],
      '2026-04-10T00:00:00.000Z'
    );
    expect(kept.map((l) => l.sportsbook)).toEqual(['fanduel']);
  });

  it('uses the median across books and does not call a 1-book line consensus', () => {
    const c = consensusMarketLine(
      [
        {
          sportsbook: 'betmgm',
          lineValue: 25.5,
          oddsAmerican: -110,
          oddsDecimal: 1.91,
          decisionAt: '2026-04-09T20:00:00.000Z',
        },
        {
          sportsbook: 'fanduel',
          lineValue: 27.5,
          oddsAmerican: -110,
          oddsDecimal: 1.91,
          decisionAt: '2026-04-09T21:00:00.000Z',
        },
        {
          sportsbook: 'draftkings',
          lineValue: 26.5,
          oddsAmerican: -105,
          oddsDecimal: 1.95,
          decisionAt: '2026-04-09T22:00:00.000Z',
        },
      ],
      '2026-04-10T00:00:00.000Z'
    );
    expect(c?.line).toBe(26.5);
    expect(c?.bookCount).toBe(3);
    expect(c?.isConsensus).toBe(true);
    expect(c?.rule).toBe('latest_available_pregame_median');
  });
});

describe('metrics', () => {
  it('MAE / bias ignore null projections and do not treat them as 0', () => {
    const m = computeMetricBlock(
      [
        { projection: 10, actual: 8 },
        { projection: null, actual: 0 },
      ],
      2
    );
    expect(m.nScored).toBe(1);
    expect(m.mae).toBe(2);
    expect(m.bias).toBe(2);
    expect(m.coverage).toBe(0.5);
  });
});
