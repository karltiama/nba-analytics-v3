/**
 * Slice 10: pure report builders from Slice 9 manifest + results.jsonl rows.
 * Does not re-run strategy or touch feature/backtest inputs beyond parsing.
 */

import type { BacktestManifest, BacktestResult } from './backtest-types';
import type {
  BacktestBucketSummary,
  BacktestPlayerSample,
  BacktestReportSummary,
  BacktestSeasonComparison,
} from './backtest-report-types';

const PRIOR_BUCKETS = ['5-9', '10-19', '20-39', '40+'] as const;

export function priorGamesBucketKey(priorGames: number): string {
  if (priorGames >= 5 && priorGames <= 9) return '5-9';
  if (priorGames >= 10 && priorGames <= 19) return '10-19';
  if (priorGames >= 20 && priorGames <= 39) return '20-39';
  if (priorGames >= 40) return '40+';
  return 'other';
}

export function gameDateToMonthKey(gameDate: string): string {
  const d = gameDate.trim();
  if (d.length >= 7) return d.slice(0, 7);
  return d || 'unknown';
}

/** Parse NDJSON body into `BacktestResult` rows (invalid lines skipped). */
export function parseBacktestResultLines(text: string): BacktestResult[] {
  const out: BacktestResult[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t) as BacktestResult;
      if (
        typeof row.player_id === 'string' &&
        typeof row.game_id === 'string' &&
        typeof row.game_date === 'string' &&
        typeof row.syntheticLine === 'number' &&
        typeof row.edge === 'number' &&
        typeof row.actual_points === 'number' &&
        (row.outcome === 'win' || row.outcome === 'loss' || row.outcome === 'push')
      ) {
        out.push(row);
      }
    } catch {
      // skip bad line
    }
  }
  return out;
}

function emptyBucket(bucketKey: string): BacktestBucketSummary {
  return {
    bucketKey,
    signals: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    winRate: null,
    averageEdge: null,
    averageActualMargin: null,
  };
}

function finalizeBucket(b: BacktestBucketSummary): BacktestBucketSummary {
  const n = b.signals;
  if (n === 0) {
    return { ...b, winRate: null, averageEdge: null, averageActualMargin: null };
  }
  return {
    ...b,
    winRate: b.wins / n,
    averageEdge: b.averageEdge != null ? b.averageEdge / n : null,
    averageActualMargin: b.averageActualMargin != null ? b.averageActualMargin / n : null,
  };
}

function addResultToBucket(b: BacktestBucketSummary, r: BacktestResult): void {
  b.signals += 1;
  if (r.outcome === 'win') b.wins += 1;
  else if (r.outcome === 'loss') b.losses += 1;
  else b.pushes += 1;
  b.averageEdge = (b.averageEdge ?? 0) + r.edge;
  b.averageActualMargin = (b.averageActualMargin ?? 0) + (r.actual_points - r.syntheticLine);
}

function resultToSample(r: BacktestResult): BacktestPlayerSample {
  return {
    player_id: r.player_id,
    game_id: r.game_id,
    game_date: r.game_date,
    edge: r.edge,
    actual_margin: r.actual_points - r.syntheticLine,
    synthetic_line: r.syntheticLine,
    actual_points: r.actual_points,
    outcome: r.outcome,
  };
}

/** Stable: margin desc, then game_id asc, then player_id asc. */
export function compareWinningMargin(a: BacktestPlayerSample, b: BacktestPlayerSample): number {
  if (b.actual_margin !== a.actual_margin) return b.actual_margin - a.actual_margin;
  if (a.game_id !== b.game_id) return a.game_id < b.game_id ? -1 : 1;
  return a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0;
}

/** Stable: margin asc (worst loss first), then game_id, player_id. */
export function compareLosingMargin(a: BacktestPlayerSample, b: BacktestPlayerSample): number {
  if (a.actual_margin !== b.actual_margin) return a.actual_margin - b.actual_margin;
  if (a.game_id !== b.game_id) return a.game_id < b.game_id ? -1 : 1;
  return a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0;
}

/** Stable: edge desc, then game_id, player_id. */
export function compareEdgeDesc(a: BacktestPlayerSample, b: BacktestPlayerSample): number {
  if (b.edge !== a.edge) return b.edge - a.edge;
  if (a.game_id !== b.game_id) return a.game_id < b.game_id ? -1 : 1;
  return a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0;
}

export function buildBacktestReport(args: {
  manifest: BacktestManifest;
  results: BacktestResult[];
}): BacktestReportSummary {
  const { manifest, results } = args;
  if (results.length !== manifest.signalsGenerated) {
    throw new Error(
      `results length ${results.length} !== manifest.signalsGenerated ${manifest.signalsGenerated}`
    );
  }

  const rowsScanned = manifest.rowsScanned;
  const signalsGenerated = manifest.signalsGenerated;
  const signalRate = rowsScanned > 0 ? signalsGenerated / rowsScanned : null;

  let sumEdge = 0;
  let sumMargin = 0;
  for (const r of results) {
    sumEdge += r.edge;
    sumMargin += r.actual_points - r.syntheticLine;
  }

  const wins = manifest.wins;
  const losses = manifest.losses;
  const pushes = manifest.pushes;
  const winRate = signalsGenerated > 0 ? wins / signalsGenerated : null;
  const averageEdge = signalsGenerated > 0 ? sumEdge / signalsGenerated : null;
  const averageActualMargin = signalsGenerated > 0 ? sumMargin / signalsGenerated : null;

  const monthMap = new Map<string, BacktestBucketSummary>();
  const priorMap = new Map<string, BacktestBucketSummary>();
  for (const k of PRIOR_BUCKETS) priorMap.set(k, emptyBucket(k));

  for (const r of results) {
    const mk = gameDateToMonthKey(r.game_date);
    if (!monthMap.has(mk)) monthMap.set(mk, emptyBucket(mk));
    addResultToBucket(monthMap.get(mk)!, r);

    const pk = priorGamesBucketKey(r.prior_games);
    if (priorMap.has(pk)) addResultToBucket(priorMap.get(pk)!, r);
  }

  const byMonth = [...monthMap.keys()]
    .sort()
    .map((k) => finalizeBucket({ ...monthMap.get(k)! }));

  const byPriorGamesBucket = PRIOR_BUCKETS.map((k) => finalizeBucket({ ...priorMap.get(k)! }));

  const samples = results.map(resultToSample);
  const winsOnly = samples.filter((s) => s.outcome === 'win').sort(compareWinningMargin);
  const lossesOnly = samples.filter((s) => s.outcome === 'loss').sort(compareLosingMargin);
  const byEdge = [...samples].sort(compareEdgeDesc);

  const topWinningMargins = winsOnly.slice(0, 10);
  const worstLosingMargins = lossesOnly.slice(0, 10);
  const topEdges = byEdge.slice(0, 10);

  return {
    season: manifest.season,
    strategyName: manifest.strategyName,
    strategyVersion: manifest.strategyVersion,
    threshold: manifest.threshold,
    rowsScanned,
    signalsGenerated,
    signalRate,
    wins,
    losses,
    pushes,
    winRate,
    averageEdge,
    averageActualMargin,
    skippedRows: manifest.skippedRows,
    skippedReasons: { ...manifest.skippedReasons },
    byMonth,
    byPriorGamesBucket,
    topWinningMargins,
    worstLosingMargins,
    topEdges,
  };
}

export function buildSeasonComparison(
  summaries: readonly BacktestReportSummary[]
): BacktestSeasonComparison {
  if (summaries.length === 0) {
    throw new Error('buildSeasonComparison requires at least one summary');
  }
  const strategyName = summaries[0].strategyName;
  const strategyVersion = summaries[0].strategyVersion;
  for (const s of summaries) {
    if (s.strategyName !== strategyName || s.strategyVersion !== strategyVersion) {
      throw new Error('Mixed strategy in buildSeasonComparison');
    }
  }
  const seasons = [...new Set(summaries.map((s) => s.season))].sort((a, b) => a - b);
  const perSeason = seasons.map((season) => {
    const s = summaries.find((x) => x.season === season);
    if (!s) throw new Error(`Missing summary for season ${season}`);
    return {
      season: s.season,
      threshold: s.threshold,
      rowsScanned: s.rowsScanned,
      signalsGenerated: s.signalsGenerated,
      signalRate: s.signalRate,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      winRate: s.winRate,
      averageEdge: s.averageEdge,
      averageActualMargin: s.averageActualMargin,
      skippedRows: s.skippedRows,
    };
  });
  return { strategyName, strategyVersion, seasons, perSeason };
}

function fmtNum(n: number | null): string {
  if (n == null) return '—';
  return n.toFixed(4);
}

function mdTable(headers: string[], rows: string[][]): string {
  const esc = (c: string) => c.replace(/\|/g, '\\|');
  const line = (cells: string[]) => `| ${cells.map(esc).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

export function formatBacktestReportMarkdown(summary: BacktestReportSummary): string {
  const lines: string[] = [];
  lines.push(`# Backtest report: ${summary.strategyName} ${summary.strategyVersion}`);
  lines.push('');
  lines.push('## Config');
  lines.push('');
  lines.push(`- **Season:** ${summary.season}`);
  lines.push(`- **Strategy:** ${summary.strategyName} ${summary.strategyVersion}`);
  lines.push(`- **Threshold (edge):** ${summary.threshold}`);
  lines.push(`- **Rows scanned:** ${summary.rowsScanned}`);
  lines.push(`- **Signals generated:** ${summary.signalsGenerated}`);
  lines.push('');

  lines.push('## Overall summary');
  lines.push('');
  lines.push(
    mdTable(
      ['Metric', 'Value'],
      [
        ['Signal rate', fmtNum(summary.signalRate)],
        ['Win rate', fmtNum(summary.winRate)],
        ['Wins', String(summary.wins)],
        ['Losses', String(summary.losses)],
        ['Pushes', String(summary.pushes)],
        ['Average edge', fmtNum(summary.averageEdge)],
        ['Average actual margin', fmtNum(summary.averageActualMargin)],
        ['Skipped rows', String(summary.skippedRows)],
      ]
    )
  );
  lines.push('');

  lines.push('## Skip reason summary');
  lines.push('');
  lines.push(
    mdTable(
      ['Reason', 'Count'],
      [
        ['insufficient_prior_games', String(summary.skippedReasons.insufficient_prior_games)],
        ['missing_feature_values', String(summary.skippedReasons.missing_feature_values)],
        ['no_signal', String(summary.skippedReasons.no_signal)],
      ]
    )
  );
  lines.push('');

  lines.push('## Monthly breakdown');
  lines.push('');
  lines.push(
    mdTable(
      ['Month', 'Signals', 'Wins', 'Losses', 'Pushes', 'Win rate', 'Avg edge', 'Avg margin'],
      summary.byMonth.map((b) => [
        b.bucketKey,
        String(b.signals),
        String(b.wins),
        String(b.losses),
        String(b.pushes),
        fmtNum(b.winRate),
        fmtNum(b.averageEdge),
        fmtNum(b.averageActualMargin),
      ])
    )
  );
  lines.push('');

  lines.push('## Prior games bucket');
  lines.push('');
  lines.push(
    mdTable(
      ['Bucket', 'Signals', 'Wins', 'Losses', 'Pushes', 'Win rate', 'Avg edge', 'Avg margin'],
      summary.byPriorGamesBucket.map((b) => [
        b.bucketKey,
        String(b.signals),
        String(b.wins),
        String(b.losses),
        String(b.pushes),
        fmtNum(b.winRate),
        fmtNum(b.averageEdge),
        fmtNum(b.averageActualMargin),
      ])
    )
  );
  lines.push('');

  const sampleRows = (xs: BacktestPlayerSample[]) =>
    xs.map((s) => [
      s.player_id,
      s.game_id,
      s.game_date,
      String(s.actual_points),
      fmtNum(s.synthetic_line),
      fmtNum(s.actual_margin),
      fmtNum(s.edge),
      s.outcome,
    ]);

  lines.push('## Top 10 winning margins');
  lines.push('');
  lines.push(
    mdTable(
      ['Player', 'Game', 'Date', 'Actual', 'Line', 'Margin', 'Edge', 'Outcome'],
      sampleRows(summary.topWinningMargins)
    )
  );
  lines.push('');

  lines.push('## Top 10 losing margins');
  lines.push('');
  lines.push(
    mdTable(
      ['Player', 'Game', 'Date', 'Actual', 'Line', 'Margin', 'Edge', 'Outcome'],
      sampleRows(summary.worstLosingMargins)
    )
  );
  lines.push('');

  lines.push('## Top 10 pre-game edges');
  lines.push('');
  lines.push(
    mdTable(
      ['Player', 'Game', 'Date', 'Actual', 'Line', 'Margin', 'Edge', 'Outcome'],
      sampleRows(summary.topEdges)
    )
  );
  lines.push('');

  lines.push('## Notes');
  lines.push('');
  lines.push(
    '- This strategy uses a **synthetic season-average line**, not sportsbook odds.'
  );
  lines.push('- This does **not** prove profitability.');
  lines.push(
    '- It is a **baseline validation layer** before adding real market lines.'
  );
  lines.push('');

  return lines.join('\n');
}

/**
 * Round finite numbers to 6 dp and sort object keys lexicographically at every
 * object level (arrays keep order). Used so report JSON files are stable run-to-run.
 */
export function canonicalizeJson(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 1e6) / 1e6;
  }
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = canonicalizeJson(o[k]);
    return out;
  }
  return value;
}

export function formatSeasonComparisonMarkdown(c: BacktestSeasonComparison): string {
  const lines: string[] = [];
  lines.push(`# Season comparison: ${c.strategyName} ${c.strategyVersion}`);
  lines.push('');
  lines.push('## Per-season summary');
  lines.push('');
  lines.push(
    mdTable(
      [
        'Season',
        'Thr',
        'Scanned',
        'Signals',
        'Sig rate',
        'Wins',
        'Losses',
        'Push',
        'Win rate',
        'Avg edge',
        'Avg margin',
        'Skipped',
      ],
      c.perSeason.map((p) => [
        String(p.season),
        String(p.threshold),
        String(p.rowsScanned),
        String(p.signalsGenerated),
        fmtNum(p.signalRate),
        String(p.wins),
        String(p.losses),
        String(p.pushes),
        fmtNum(p.winRate),
        fmtNum(p.averageEdge),
        fmtNum(p.averageActualMargin),
        String(p.skippedRows),
      ])
    )
  );
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push(
    '- This strategy uses a **synthetic season-average line**, not sportsbook odds.'
  );
  lines.push('- This does **not** prove profitability.');
  lines.push(
    '- It is a **baseline validation layer** before adding real market lines.'
  );
  lines.push('');
  return lines.join('\n');
}
