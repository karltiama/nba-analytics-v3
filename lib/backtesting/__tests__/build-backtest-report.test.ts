import { describe, expect, it } from 'vitest';
import type { BacktestManifest, BacktestResult } from '../backtest-types';
import {
  buildBacktestReport,
  buildSeasonComparison,
  canonicalizeJson,
  compareEdgeDesc,
  compareLosingMargin,
  compareWinningMargin,
  formatBacktestReportMarkdown,
  gameDateToMonthKey,
  parseBacktestResultLines,
  priorGamesBucketKey,
} from '../build-backtest-report';

function baseManifest(over: Partial<BacktestManifest> = {}): BacktestManifest {
  return {
    strategyName: 'points_l5_vs_season',
    strategyVersion: 'v1',
    season: 2023,
    threshold: 3,
    inputFeaturePrefix: 'features/league=nba/season=2023/entity=player_game_features',
    outputPrefix: 'backtests/league=nba/season=2023/strategy=points_l5_vs_season_v1',
    rowsScanned: 10,
    signalsGenerated: 2,
    wins: 1,
    losses: 1,
    pushes: 0,
    winRate: 0.5,
    averageEdge: 4,
    averageActualMargin: 1,
    skippedRows: 8,
    skippedReasons: {
      insufficient_prior_games: 5,
      missing_feature_values: 1,
      no_signal: 2,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success',
    ...over,
  };
}

function r(over: Partial<BacktestResult>): BacktestResult {
  return {
    strategyName: 'points_l5_vs_season',
    strategyVersion: 'v1',
    season: '2023',
    player_id: 'p1',
    game_id: 'g1',
    game_date: '2023-11-01',
    signalType: 'OVER_POINTS',
    syntheticLine: 20,
    edge: 4,
    points_season_avg_before_game: 20,
    points_l5_avg_before_game: 24,
    prior_games: 8,
    actual_points: 25,
    outcome: 'win',
    ...over,
  };
}

describe('priorGamesBucketKey', () => {
  it('buckets 5–9, 10–19, 20–39, 40+', () => {
    expect(priorGamesBucketKey(5)).toBe('5-9');
    expect(priorGamesBucketKey(9)).toBe('5-9');
    expect(priorGamesBucketKey(10)).toBe('10-19');
    expect(priorGamesBucketKey(19)).toBe('10-19');
    expect(priorGamesBucketKey(20)).toBe('20-39');
    expect(priorGamesBucketKey(39)).toBe('20-39');
    expect(priorGamesBucketKey(40)).toBe('40+');
    expect(priorGamesBucketKey(100)).toBe('40+');
  });
});

describe('gameDateToMonthKey', () => {
  it('uses YYYY-MM from ISO date', () => {
    expect(gameDateToMonthKey('2023-12-15')).toBe('2023-12');
  });
});

describe('parseBacktestResultLines', () => {
  it('parses valid NDJSON and skips junk', () => {
    const text = [
      JSON.stringify(r({ game_id: 'a', outcome: 'win' })),
      'not json',
      JSON.stringify(r({ game_id: 'b', outcome: 'loss', actual_points: 10, syntheticLine: 20, edge: 5 })),
    ].join('\n');
    const rows = parseBacktestResultLines(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].game_id).toBe('a');
    expect(rows[1].outcome).toBe('loss');
  });
});

describe('buildBacktestReport', () => {
  it('computes signalRate and winRate', () => {
    const manifest = baseManifest({
      rowsScanned: 100,
      signalsGenerated: 4,
      wins: 3,
      losses: 1,
      pushes: 0,
    });
    const results: BacktestResult[] = [
      r({ game_id: 'a', outcome: 'win' }),
      r({ game_id: 'b', outcome: 'win' }),
      r({ game_id: 'c', outcome: 'win' }),
      r({ game_id: 'd', outcome: 'loss' }),
    ];
    const s = buildBacktestReport({ manifest, results });
    expect(s.signalRate).toBeCloseTo(0.04);
    expect(s.winRate).toBeCloseTo(0.75);
  });

  it('computes average actual margin from rows', () => {
    const manifest = baseManifest({
      rowsScanned: 2,
      signalsGenerated: 2,
      wins: 2,
      losses: 0,
      pushes: 0,
    });
    const results: BacktestResult[] = [
      r({ game_id: 'a', syntheticLine: 10, actual_points: 13, edge: 1 }),
      r({ game_id: 'b', syntheticLine: 10, actual_points: 15, edge: 2 }),
    ];
    const s = buildBacktestReport({ manifest, results });
    expect(s.averageActualMargin).toBeCloseTo(4);
    expect(s.averageEdge).toBeCloseTo(1.5);
  });

  it('groups by month', () => {
    const manifest = baseManifest({
      rowsScanned: 3,
      signalsGenerated: 3,
      wins: 3,
      losses: 0,
      pushes: 0,
    });
    const results: BacktestResult[] = [
      r({ game_id: 'a', game_date: '2023-10-01', outcome: 'win' }),
      r({ game_id: 'b', game_date: '2023-11-01', outcome: 'win' }),
      r({ game_id: 'c', game_date: '2023-11-05', outcome: 'win' }),
    ];
    const s = buildBacktestReport({ manifest, results });
    const oct = s.byMonth.find((b) => b.bucketKey === '2023-10');
    const nov = s.byMonth.find((b) => b.bucketKey === '2023-11');
    expect(oct?.signals).toBe(1);
    expect(nov?.signals).toBe(2);
  });

  it('groups prior games into fixed buckets', () => {
    const manifest = baseManifest({
      rowsScanned: 4,
      signalsGenerated: 4,
      wins: 4,
      losses: 0,
      pushes: 0,
    });
    const results: BacktestResult[] = [
      r({ game_id: 'a', prior_games: 5, outcome: 'win' }),
      r({ game_id: 'b', prior_games: 12, outcome: 'win' }),
      r({ game_id: 'c', prior_games: 25, outcome: 'win' }),
      r({ game_id: 'd', prior_games: 50, outcome: 'win' }),
    ];
    const s = buildBacktestReport({ manifest, results });
    expect(s.byPriorGamesBucket.map((b) => [b.bucketKey, b.signals])).toEqual([
      ['5-9', 1],
      ['10-19', 1],
      ['20-39', 1],
      ['40+', 1],
    ]);
  });

  it('throws when results length does not match manifest', () => {
    expect(() =>
      buildBacktestReport({
        manifest: baseManifest(),
        results: [r({})],
      })
    ).toThrow(/signalsGenerated/);
  });

  it('sorts top winning margins and top edges with tie-breakers', () => {
    const manifest = baseManifest({
      rowsScanned: 4,
      signalsGenerated: 4,
      wins: 2,
      losses: 2,
      pushes: 0,
    });
    const results: BacktestResult[] = [
      r({
        game_id: 'z',
        player_id: 'p2',
        syntheticLine: 10,
        actual_points: 20,
        edge: 3,
        outcome: 'win',
      }),
      r({
        game_id: 'a',
        player_id: 'p1',
        syntheticLine: 10,
        actual_points: 15,
        edge: 5,
        outcome: 'win',
      }),
      r({
        game_id: 'm',
        syntheticLine: 10,
        actual_points: 5,
        edge: 5,
        outcome: 'loss',
      }),
      r({
        game_id: 'n',
        syntheticLine: 10,
        actual_points: 4,
        edge: 5,
        outcome: 'loss',
      }),
    ];
    const s = buildBacktestReport({ manifest, results });
    expect(s.topWinningMargins[0].game_id).toBe('z');
    expect(s.topWinningMargins[1].game_id).toBe('a');
    expect(s.worstLosingMargins[0].game_id).toBe('n');
    expect(s.worstLosingMargins[1].game_id).toBe('m');
    expect(s.topEdges.map((x) => x.game_id)).toEqual(['a', 'm', 'n', 'z']);
  });
});

describe('compare functions', () => {
  it('compareWinningMargin uses margin then game_id', () => {
    const a = {
      player_id: 'p',
      game_id: 'b',
      game_date: 'd',
      edge: 1,
      actual_margin: 5,
      synthetic_line: 10,
      actual_points: 15,
      outcome: 'win' as const,
    };
    const b = {
      player_id: 'p',
      game_id: 'a',
      game_date: 'd',
      edge: 1,
      actual_margin: 5,
      synthetic_line: 10,
      actual_points: 15,
      outcome: 'win' as const,
    };
    expect(compareWinningMargin(a, b)).toBeGreaterThan(0);
  });

  it('compareEdgeDesc sorts edge desc then game_id', () => {
    const x10 = {
      player_id: 'p',
      game_id: 'x',
      game_date: 'd',
      edge: 10,
      actual_margin: 0,
      synthetic_line: 10,
      actual_points: 10,
      outcome: 'push' as const,
    };
    const y10 = { ...x10, game_id: 'y' };
    expect(compareEdgeDesc(x10, y10)).toBeLessThan(0);
    const hi = { ...x10, game_id: 'b', edge: 10 };
    const lo = { ...x10, game_id: 'a', edge: 5 };
    expect(compareEdgeDesc(hi, lo)).toBeLessThan(0);
  });

  it('compareLosingMargin sorts margin asc', () => {
    const a = { ...r({ game_id: 'a' }), actual_margin: -5, outcome: 'loss' as const };
    const b = { ...r({ game_id: 'b' }), actual_margin: -2, outcome: 'loss' as const };
    expect(compareLosingMargin(
      { ...a, edge: 1, synthetic_line: 10, actual_points: 5, game_date: 'd' },
      { ...b, edge: 1, synthetic_line: 10, actual_points: 8, game_date: 'd' }
    )).toBeLessThan(0);
  });
});

describe('buildSeasonComparison', () => {
  it('builds per-season rows in sorted season order', () => {
    const m2024 = baseManifest({ season: 2024, threshold: 3, rowsScanned: 50, signalsGenerated: 10 });
    const m2023 = baseManifest({ season: 2023, threshold: 3, rowsScanned: 100, signalsGenerated: 20 });
    const s2024 = buildBacktestReport({
      manifest: { ...m2024, signalsGenerated: 10, wins: 5, losses: 5, pushes: 0 },
      results: Array.from({ length: 10 }, (_, i) => r({ game_id: `g${i}`, outcome: i % 2 ? 'loss' : 'win' })),
    });
    const s2023 = buildBacktestReport({
      manifest: { ...m2023, signalsGenerated: 20, wins: 10, losses: 10, pushes: 0 },
      results: Array.from({ length: 20 }, (_, i) => r({ game_id: `h${i}`, outcome: i % 2 ? 'loss' : 'win' })),
    });
    const c = buildSeasonComparison([s2024, s2023]);
    expect(c.seasons).toEqual([2023, 2024]);
    expect(c.perSeason[0].season).toBe(2023);
    expect(c.perSeason[1].season).toBe(2024);
  });

  it('rejects mixed strategy names', () => {
    const a = buildBacktestReport({
      manifest: baseManifest(),
      results: [r({ game_id: 'a' }), r({ game_id: 'b' })],
    });
    const b = {
      ...a,
      strategyName: 'other',
    };
    expect(() => buildSeasonComparison([a, b])).toThrow(/Mixed strategy/);
  });
});

describe('canonicalizeJson', () => {
  it('sorts object keys and rounds numbers for stable serialization', () => {
    const a = { z: 1, b: { m: 1 / 3 }, arr: [{ y: 2, x: 1 }] };
    const b = { b: { m: 0.3333333333 }, z: 1, arr: [{ x: 1, y: 2 }] };
    expect(JSON.stringify(canonicalizeJson(a))).toBe(JSON.stringify(canonicalizeJson(b)));
  });
});

describe('formatBacktestReportMarkdown', () => {
  it('includes title, tables, and notes', () => {
    const manifest = baseManifest({
      signalsGenerated: 1,
      wins: 1,
      losses: 0,
      pushes: 0,
      rowsScanned: 5,
    });
    const summary = buildBacktestReport({ manifest, results: [r({ game_id: 'x' })] });
    const md = formatBacktestReportMarkdown(summary);
    expect(md).toContain('# Backtest report');
    expect(md).toContain('## Overall summary');
    expect(md).toContain('## Notes');
    expect(md).toContain('synthetic season-average line');
    expect(md).toContain('does **not** prove profitability');
  });
});
