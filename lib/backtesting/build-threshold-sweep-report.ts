/**
 * Slice 11: aggregate BacktestReportSummary rows across seasons per threshold.
 * Pure only — no S3 or strategy execution.
 */

import type {
  BacktestReportSummary,
} from './backtest-report-types';
import type {
  ThresholdSweepConfig,
  ThresholdSweepReport,
  ThresholdSweepRow,
} from './backtest-threshold-sweep-types';

const LOW_SIGNAL_WARNING_THRESHOLD = 200;

export type ThresholdSweepSummaryInput = {
  threshold: number;
  summary: BacktestReportSummary;
};

function uniqueSortedSeasons(rows: readonly ThresholdSweepSummaryInput[]): number[] {
  return [...new Set(rows.map((r) => r.summary.season))].sort((a, b) => a - b);
}

function uniqueSortedThresholds(rows: readonly ThresholdSweepSummaryInput[]): number[] {
  return [...new Set(rows.map((r) => r.threshold))].sort((a, b) => a - b);
}

function buildRowForThreshold(
  threshold: number,
  seasonRows: readonly ThresholdSweepSummaryInput[]
): ThresholdSweepRow {
  const seasonsIncluded = [...new Set(seasonRows.map((r) => r.summary.season))].sort((a, b) => a - b);
  let totalRowsScanned = 0;
  let totalSignalsGenerated = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let weightedEdge = 0;
  let weightedMargin = 0;
  let edgeWeight = 0;
  let marginWeight = 0;
  const seasonWinRates: number[] = [];
  const warnings: string[] = [];

  for (const { summary: s } of seasonRows) {
    totalRowsScanned += s.rowsScanned;
    totalSignalsGenerated += s.signalsGenerated;
    wins += s.wins;
    losses += s.losses;
    pushes += s.pushes;
    if (s.winRate != null) seasonWinRates.push(s.winRate);
    if (s.signalsGenerated > 0 && s.averageEdge != null) {
      weightedEdge += s.averageEdge * s.signalsGenerated;
      edgeWeight += s.signalsGenerated;
    }
    if (s.signalsGenerated > 0 && s.averageActualMargin != null) {
      weightedMargin += s.averageActualMargin * s.signalsGenerated;
      marginWeight += s.signalsGenerated;
    }
  }

  const signalRate = totalRowsScanned > 0 ? totalSignalsGenerated / totalRowsScanned : null;
  const winRate = totalSignalsGenerated > 0 ? wins / totalSignalsGenerated : null;
  const averageEdge = edgeWeight > 0 ? weightedEdge / edgeWeight : null;
  const averageActualMargin = marginWeight > 0 ? weightedMargin / marginWeight : null;
  const minSeasonWinRate =
    seasonWinRates.length === 0 ? null : Math.min(...seasonWinRates);
  const maxSeasonWinRate =
    seasonWinRates.length === 0 ? null : Math.max(...seasonWinRates);

  const sampleAdjustedWinRate =
    totalSignalsGenerated > 0 ? (wins + 1) / (totalSignalsGenerated + 2) : null;

  if (totalSignalsGenerated < LOW_SIGNAL_WARNING_THRESHOLD) {
    warnings.push(
      `Low aggregate sample: totalSignalsGenerated=${totalSignalsGenerated} (< ${LOW_SIGNAL_WARNING_THRESHOLD}). Interpret win rates cautiously.`
    );
  }

  return {
    threshold,
    seasonsIncluded,
    totalRowsScanned,
    totalSignalsGenerated,
    signalRate,
    wins,
    losses,
    pushes,
    winRate,
    averageEdge,
    averageActualMargin,
    minSeasonWinRate,
    maxSeasonWinRate,
    sampleAdjustedWinRate,
    warnings,
  };
}

/** Pick best threshold; tie-break lower `threshold`. */
function pickBestByMetric(
  rows: readonly ThresholdSweepRow[],
  metric: (r: ThresholdSweepRow) => number | null
): number | null {
  let best: { t: number; v: number } | null = null;
  for (const r of rows) {
    const v = metric(r);
    if (v == null || !Number.isFinite(v)) continue;
    if (best === null || v > best.v || (v === best.v && r.threshold < best.t)) {
      best = { t: r.threshold, v };
    }
  }
  return best?.t ?? null;
}

/**
 * One entry per (threshold, season) expected; grouped by threshold.
 * All summaries must share the same strategyName / strategyVersion.
 */
export function buildThresholdSweepReport(args: {
  config: ThresholdSweepConfig;
  summaries: readonly ThresholdSweepSummaryInput[];
}): ThresholdSweepReport {
  const { config, summaries } = args;
  if (summaries.length === 0) {
    throw new Error('buildThresholdSweepReport: summaries is empty');
  }
  const seen = new Set<string>();
  for (const row of summaries) {
    const k = `${row.threshold}::${row.summary.season}`;
    if (seen.has(k)) throw new Error(`Duplicate threshold/season in sweep input: ${k}`);
    seen.add(k);
  }
  const strategyName = config.strategyName;
  const strategyVersion = config.strategyVersion;
  for (const row of summaries) {
    if (row.summary.strategyName !== strategyName || row.summary.strategyVersion !== strategyVersion) {
      throw new Error('Mixed strategy in buildThresholdSweepReport');
    }
    if (row.summary.threshold !== row.threshold) {
      throw new Error(
        `Summary threshold ${row.summary.threshold} does not match row threshold ${row.threshold}`
      );
    }
  }

  const seasons = uniqueSortedSeasons(summaries);
  const thresholds = uniqueSortedThresholds(summaries);

  const byTh = new Map<number, ThresholdSweepSummaryInput[]>();
  for (const th of thresholds) byTh.set(th, []);
  for (const row of summaries) {
    const list = byTh.get(row.threshold);
    if (!list) throw new Error(`Unexpected threshold ${row.threshold}`);
    list.push(row);
  }

  const rows: ThresholdSweepRow[] = thresholds.map((t) =>
    buildRowForThreshold(t, byTh.get(t)!)
  );

  const bestThresholdByWinRate = pickBestByMetric(rows, (r) => r.winRate);
  const bestThresholdBySampleAdjustedWinRate = pickBestByMetric(
    rows,
    (r) => r.sampleAdjustedWinRate
  );

  return {
    strategyName,
    strategyVersion,
    seasons,
    thresholds,
    rows,
    bestThresholdByWinRate,
    bestThresholdBySampleAdjustedWinRate,
  };
}

function fmtNum(n: number | null): string {
  if (n == null) return '—';
  return n.toFixed(4);
}

function mdTable(headers: string[], bodyRows: string[][]): string {
  const esc = (c: string) => c.replace(/\|/g, '\\|');
  const line = (cells: string[]) => `| ${cells.map(esc).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  return [line(headers), sep, ...bodyRows.map(line)].join('\n');
}

export function formatThresholdSweepMarkdown(sweep: ThresholdSweepReport): string {
  const lines: string[] = [];
  lines.push(`# Threshold sweep: ${sweep.strategyName} ${sweep.strategyVersion}`);
  lines.push('');
  lines.push('## Config');
  lines.push('');
  lines.push(`- **Seasons:** ${sweep.seasons.join(', ')}`);
  lines.push(`- **Thresholds:** ${sweep.thresholds.join(', ')}`);
  lines.push('');

  lines.push('## Threshold sweep');
  lines.push('');
  lines.push(
    mdTable(
      [
        'Thr',
        'Seasons',
        'Rows',
        'Signals',
        'Sig rate',
        'W/L/P',
        'Win rate',
        'Adj win†',
        'Avg edge',
        'Avg margin',
        'Min S WR',
        'Max S WR',
      ],
      sweep.rows.map((r) => [
        String(r.threshold),
        r.seasonsIncluded.join(','),
        String(r.totalRowsScanned),
        String(r.totalSignalsGenerated),
        fmtNum(r.signalRate),
        `${r.wins}/${r.losses}/${r.pushes}`,
        fmtNum(r.winRate),
        fmtNum(r.sampleAdjustedWinRate),
        fmtNum(r.averageEdge),
        fmtNum(r.averageActualMargin),
        fmtNum(r.minSeasonWinRate),
        fmtNum(r.maxSeasonWinRate),
      ])
    )
  );
  lines.push('');
  lines.push('† Adj win = (wins+1)/(signals+2) for small-sample ranking.');
  lines.push('');

  lines.push('## Best threshold (raw win rate)');
  lines.push('');
  lines.push(
    sweep.bestThresholdByWinRate == null
      ? '_No finite win rate in any row._'
      : `- **Threshold:** ${sweep.bestThresholdByWinRate}`
  );
  lines.push('');

  lines.push('## Best threshold (sample-adjusted usefulness)');
  lines.push('');
  lines.push(
    'Uses shrinkage **(wins+1)/(signals+2)** so extreme win rates from tiny signal counts are not ranked above steadier thresholds.'
  );
  lines.push('');
  lines.push(
    sweep.bestThresholdBySampleAdjustedWinRate == null
      ? '_No row had computable adjusted rate._'
      : `- **Threshold:** ${sweep.bestThresholdBySampleAdjustedWinRate}`
  );
  lines.push('');

  const warnRows = sweep.rows.filter((r) => r.warnings.length > 0);
  if (warnRows.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const r of warnRows) {
      lines.push(`- **threshold=${r.threshold}:** ${r.warnings.join(' ')}`);
    }
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('');
  lines.push('- This strategy uses a **synthetic season-average line** only — not sportsbook odds.');
  lines.push('- This does **not** prove profitability.');
  lines.push('- **Higher thresholds** usually reduce signal count; compare signal rate and warnings.');
  lines.push('- Use this sweep to pick **candidate thresholds** before adding market odds.');
  lines.push('');

  return lines.join('\n');
}
