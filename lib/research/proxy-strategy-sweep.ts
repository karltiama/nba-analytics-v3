import { buildProxyTarget, computeDeltaFeatures } from '@/lib/research/feature-ranking';

export type ProxySweepRow = {
  prior_games: number | null;
  actual_points: number | null;
  points_season_avg_before_game: number | null;
  points_l5_avg_before_game: number | null;
  minutes_l5_avg_before_game: number | null;
  minutes_l10_avg_before_game: number | null;
  points_l5_minus_season_avg: number | null;
  minutes_l5_minus_l10_avg: number | null;
};

export type StrategyResult = {
  strategy_name: string;
  season: number;
  total_rows: number;
  signal_count: number;
  signal_rate: number;
  target_true_count: number;
  target_false_count: number;
  hit_rate: number | null;
  avg_actual_points: number | null;
  avg_points_season_avg_before_game: number | null;
  avg_points_over_baseline: number | null;
  avg_minutes_l5: number | null;
  avg_points_l5_minus_season: number | null;
  avg_minutes_l5_minus_l10: number | null;
};

export const PROXY_STRATEGIES = [
  'minutes_floor_v1',
  'points_trend_v1',
  'points_trend_minutes_floor_v1',
  'points_trend_minutes_trend_v1',
  'strong_recent_role_change_v1',
] as const;

export type ProxyStrategyName = (typeof PROXY_STRATEGIES)[number];

export type ProxySweepMetadata = {
  season: number;
  targetDefinition: string;
  generatedAt: string;
  inputPath: string;
  outputPath: string;
  totalRows: number;
};

export function enrichProxySweepRow(row: Record<string, unknown>): ProxySweepRow {
  const deltas = computeDeltaFeatures(row);
  return {
    prior_games: toNullableNumber(row.prior_games),
    actual_points: toNullableNumber(row.actual_points),
    points_season_avg_before_game: toNullableNumber(row.points_season_avg_before_game),
    points_l5_avg_before_game: toNullableNumber(row.points_l5_avg_before_game),
    minutes_l5_avg_before_game: toNullableNumber(row.minutes_l5_avg_before_game),
    minutes_l10_avg_before_game: toNullableNumber(row.minutes_l10_avg_before_game),
    points_l5_minus_season_avg:
      toNullableNumber(row.points_l5_minus_season_avg) ?? deltas.points_l5_minus_season_avg,
    minutes_l5_minus_l10_avg:
      toNullableNumber(row.minutes_l5_minus_l10_avg) ?? deltas.minutes_l5_minus_l10_avg,
  };
}

export function strategySignal(strategy: ProxyStrategyName, row: ProxySweepRow): boolean {
  const prior = row.prior_games;
  if (prior == null || prior < 10) return false;
  const pointsTrend = row.points_l5_minus_season_avg;
  const minutesL5 = row.minutes_l5_avg_before_game;
  const minutesTrend = row.minutes_l5_minus_l10_avg;

  switch (strategy) {
    case 'minutes_floor_v1':
      return minutesL5 != null && minutesL5 >= 24;
    case 'points_trend_v1':
      return pointsTrend != null && pointsTrend >= 2;
    case 'points_trend_minutes_floor_v1':
      return pointsTrend != null && pointsTrend >= 2 && minutesL5 != null && minutesL5 >= 24;
    case 'points_trend_minutes_trend_v1':
      return (
        pointsTrend != null &&
        pointsTrend >= 2 &&
        minutesTrend != null &&
        minutesTrend >= 1 &&
        minutesL5 != null &&
        minutesL5 >= 24
      );
    case 'strong_recent_role_change_v1':
      return (
        pointsTrend != null &&
        pointsTrend >= 3 &&
        minutesTrend != null &&
        minutesTrend >= 2 &&
        minutesL5 != null &&
        minutesL5 >= 24
      );
    default:
      return false;
  }
}

export function summarizeStrategy(args: {
  strategyName: ProxyStrategyName;
  season: number;
  rows: ProxySweepRow[];
}): StrategyResult {
  const { strategyName, season, rows } = args;
  const signaled = rows.filter((r) => strategySignal(strategyName, r));
  const targetTrueCount = signaled.filter((r) => buildProxyTarget(r) === true).length;
  const targetFalseCount = signaled.filter((r) => buildProxyTarget(r) === false).length;
  const signalCount = signaled.length;

  return {
    strategy_name: strategyName,
    season,
    total_rows: rows.length,
    signal_count: signalCount,
    signal_rate: rows.length > 0 ? signalCount / rows.length : 0,
    target_true_count: targetTrueCount,
    target_false_count: targetFalseCount,
    hit_rate: signalCount > 0 ? targetTrueCount / signalCount : null,
    avg_actual_points: mean(signaled.map((r) => r.actual_points)),
    avg_points_season_avg_before_game: mean(signaled.map((r) => r.points_season_avg_before_game)),
    avg_points_over_baseline: mean(
      signaled.map((r) =>
        r.actual_points != null && r.points_season_avg_before_game != null
          ? r.actual_points - r.points_season_avg_before_game
          : null
      )
    ),
    avg_minutes_l5: mean(signaled.map((r) => r.minutes_l5_avg_before_game)),
    avg_points_l5_minus_season: mean(signaled.map((r) => r.points_l5_minus_season_avg)),
    avg_minutes_l5_minus_l10: mean(signaled.map((r) => r.minutes_l5_minus_l10_avg)),
  };
}

export function summarizeAllStrategies(args: {
  season: number;
  rows: ProxySweepRow[];
}): StrategyResult[] {
  const { season, rows } = args;
  return PROXY_STRATEGIES.map((name) => summarizeStrategy({ strategyName: name, season, rows }));
}

export function bestHitRateStrategy(results: StrategyResult[]): StrategyResult | null {
  if (results.length === 0) return null;
  return [...results].sort((a, b) => {
    const ah = a.hit_rate ?? Number.NEGATIVE_INFINITY;
    const bh = b.hit_rate ?? Number.NEGATIVE_INFINITY;
    if (ah !== bh) return bh - ah;
    return b.signal_count - a.signal_count;
  })[0];
}

export function bestSampleAdjustedStrategy(results: StrategyResult[]): StrategyResult | null {
  if (results.length === 0) return null;
  return [...results].sort((a, b) => {
    const as = sampleAdjustedScore(a);
    const bs = sampleAdjustedScore(b);
    if (as !== bs) return bs - as;
    return b.signal_count - a.signal_count;
  })[0];
}

export function renderProxyStrategySweepMarkdownReport(args: {
  metadata: ProxySweepMetadata;
  results: StrategyResult[];
}): string {
  const { metadata, results } = args;
  const bestHit = bestHitRateStrategy(results);
  const bestAdj = bestSampleAdjustedStrategy(results);

  const lines: string[] = [];
  lines.push('# Player Points Proxy Strategy Sweep');
  lines.push('');
  lines.push('## Metadata');
  lines.push(`- season: ${metadata.season}`);
  lines.push(`- target definition: ${metadata.targetDefinition}`);
  lines.push(`- generated_at: ${metadata.generatedAt}`);
  lines.push(`- input path: ${metadata.inputPath}`);
  lines.push(`- output path: ${metadata.outputPath}`);
  lines.push(`- total rows: ${metadata.totalRows}`);
  lines.push('');
  lines.push('## 1. Strategy Summary Table');
  lines.push('');
  lines.push(
    '| strategy_name | signal_count | signal_rate | target_true_count | target_false_count | hit_rate | avg_points_over_baseline |'
  );
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const r of results) {
    lines.push(
      `| ${r.strategy_name} | ${r.signal_count} | ${fmtPct(r.signal_rate)} | ${r.target_true_count} | ${r.target_false_count} | ${fmtPct(r.hit_rate)} | ${fmt(r.avg_points_over_baseline)} |`
    );
  }
  lines.push('');
  lines.push('## 2. Best Hit Rate');
  lines.push('');
  lines.push(
    bestHit
      ? `- ${bestHit.strategy_name} (hit_rate=${fmtPct(bestHit.hit_rate)}, signal_count=${bestHit.signal_count})`
      : '- No strategies available.'
  );
  lines.push('');
  lines.push('## 3. Best Sample Size Adjusted Strategy');
  lines.push('');
  lines.push(
    bestAdj
      ? `- ${bestAdj.strategy_name} (adjusted_score=${fmt(sampleAdjustedScore(bestAdj))}, hit_rate=${fmtPct(bestAdj.hit_rate)}, signal_count=${bestAdj.signal_count})`
      : '- No strategies available.'
  );
  lines.push('');
  lines.push('## 4. Notes / Interpretation');
  lines.push('');
  lines.push('- This is a proxy signal validation report and does not use odds data.');
  lines.push('- This is not a betting profitability test.');
  lines.push('- Strategies use only pre-game no-lookahead features.');
  lines.push('');
  lines.push('## 5. Data Quality Warnings');
  lines.push('');
  lines.push('- Rows with null `actual_points` or null `points_season_avg_before_game` are excluded globally.');
  lines.push('- Signals requiring prior game history enforce `prior_games >= 10` in strategy logic.');
  lines.push('- Null feature values for strategy predicates result in no signal for that row.');
  return lines.join('\n') + '\n';
}

function sampleAdjustedScore(result: StrategyResult): number {
  if (result.hit_rate == null || !Number.isFinite(result.hit_rate) || result.signal_count <= 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return result.hit_rate * Math.log10(result.signal_count + 1);
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(values: Array<number | null>): number | null {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    sum += v;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

function fmt(n: number | null): string {
  return n == null || !Number.isFinite(n) ? 'n/a' : n.toFixed(4);
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(2)}%`;
}
