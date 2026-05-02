export type FeatureRankingRow = {
  actual_points: number | null;
  points_season_avg_before_game: number | null;
  [key: string]: unknown;
};

export type ScoredFeature = {
  feature_name: string;
  sample_size: number;
  null_count: number;
  null_rate: number;
  target_true_count: number;
  target_false_count: number;
  mean_when_target_true: number | null;
  mean_when_target_false: number | null;
  mean_difference: number | null;
  abs_mean_difference: number | null;
  simple_correlation_with_target: number | null;
  rank: number;
};

export type FeatureRankingMetadata = {
  season: number;
  targetDefinition: string;
  generatedAt: string;
  inputPath: string;
  outputPath: string;
  totalRowsAnalyzed: number;
  totalUsableRows: number;
};

export function buildProxyTarget(row: FeatureRankingRow): boolean | null {
  if (row.actual_points == null || row.points_season_avg_before_game == null) {
    return null;
  }
  return row.actual_points > row.points_season_avg_before_game;
}

export function computeDeltaFeatures(row: Record<string, unknown>): Record<string, number | null> {
  const pointsL5 = toNullableNumber(row.points_l5_avg_before_game);
  const pointsL10 = toNullableNumber(row.points_l10_avg_before_game);
  const pointsSeason = toNullableNumber(row.points_season_avg_before_game);
  const minutesL5 = toNullableNumber(row.minutes_l5_avg_before_game);
  const minutesL10 = toNullableNumber(row.minutes_l10_avg_before_game);

  return {
    points_l5_minus_season_avg:
      pointsL5 != null && pointsSeason != null ? pointsL5 - pointsSeason : null,
    points_l10_minus_season_avg:
      pointsL10 != null && pointsSeason != null ? pointsL10 - pointsSeason : null,
    minutes_l5_minus_l10_avg:
      minutesL5 != null && minutesL10 != null ? minutesL5 - minutesL10 : null,
  };
}

export function scoreFeature(
  rows: Array<Record<string, unknown> & { target_score_above_season_avg: boolean }>,
  featureName: string
): Omit<ScoredFeature, 'rank'> {
  let nullCount = 0;
  let targetTrueCount = 0;
  let targetFalseCount = 0;
  let trueSum = 0;
  let falseSum = 0;

  const x: number[] = [];
  const y: number[] = [];

  for (const row of rows) {
    const featureValue = toNullableNumber(row[featureName]);
    if (featureValue == null) {
      nullCount += 1;
      continue;
    }

    if (row.target_score_above_season_avg) {
      targetTrueCount += 1;
      trueSum += featureValue;
    } else {
      targetFalseCount += 1;
      falseSum += featureValue;
    }

    x.push(featureValue);
    y.push(row.target_score_above_season_avg ? 1 : 0);
  }

  const sampleSize = targetTrueCount + targetFalseCount;
  const meanTrue = targetTrueCount > 0 ? trueSum / targetTrueCount : null;
  const meanFalse = targetFalseCount > 0 ? falseSum / targetFalseCount : null;
  const meanDifference = meanTrue != null && meanFalse != null ? meanTrue - meanFalse : null;

  return {
    feature_name: featureName,
    sample_size: sampleSize,
    null_count: nullCount,
    null_rate: rows.length > 0 ? nullCount / rows.length : 0,
    target_true_count: targetTrueCount,
    target_false_count: targetFalseCount,
    mean_when_target_true: meanTrue,
    mean_when_target_false: meanFalse,
    mean_difference: meanDifference,
    abs_mean_difference: meanDifference == null ? null : Math.abs(meanDifference),
    simple_correlation_with_target: sampleSize > 1 ? pearsonCorrelation(x, y) : null,
  };
}

export function rankFeatureScores(scores: Omit<ScoredFeature, 'rank'>[]): ScoredFeature[] {
  const sorted = [...scores].sort((a, b) => {
    const aScore = a.abs_mean_difference ?? Number.NEGATIVE_INFINITY;
    const bScore = b.abs_mean_difference ?? Number.NEGATIVE_INFINITY;
    if (aScore !== bScore) return bScore - aScore;
    if (a.sample_size !== b.sample_size) return b.sample_size - a.sample_size;
    return a.feature_name.localeCompare(b.feature_name);
  });

  return sorted.map((score, idx) => ({
    ...score,
    rank: idx + 1,
  }));
}

export function renderFeatureRankingMarkdownReport(args: {
  metadata: FeatureRankingMetadata;
  scores: ScoredFeature[];
}): string {
  const { metadata, scores } = args;
  const top10 = scores.slice(0, 10);
  const top3 = scores.slice(0, 3).map((s) => s.feature_name);
  const highNulls = scores.filter((s) => s.null_rate >= 0.25);
  const smallSamples = scores.filter((s) => s.sample_size < 100);

  const lines: string[] = [];
  lines.push('# Player Points Feature Ranking Report');
  lines.push('');
  lines.push('## Metadata');
  lines.push(`- season: ${metadata.season}`);
  lines.push(`- target definition: ${metadata.targetDefinition}`);
  lines.push(`- generated_at: ${metadata.generatedAt}`);
  lines.push(`- input path: ${metadata.inputPath}`);
  lines.push(`- output path: ${metadata.outputPath}`);
  lines.push(`- total rows analyzed: ${metadata.totalRowsAnalyzed}`);
  lines.push(`- total usable rows: ${metadata.totalUsableRows}`);
  lines.push('');
  lines.push('## 1. Top 10 Features by Absolute Mean Difference');
  lines.push('');
  lines.push(
    '| rank | feature_name | abs_mean_difference | mean_difference | sample_size | null_rate | correlation |'
  );
  lines.push('|---:|---|---:|---:|---:|---:|---:|');
  for (const score of top10) {
    lines.push(
      `| ${score.rank} | ${score.feature_name} | ${fmt(score.abs_mean_difference)} | ${fmt(score.mean_difference)} | ${score.sample_size} | ${fmtPct(score.null_rate)} | ${fmt(score.simple_correlation_with_target)} |`
    );
  }
  if (top10.length === 0) {
    lines.push('| - | _no features scored_ | - | - | - | - | - |');
  }
  lines.push('');
  lines.push('## 2. Full Feature Score Table');
  lines.push('');
  lines.push(
    '| rank | feature_name | sample_size | null_count | null_rate | target_true_count | target_false_count | mean_when_target_true | mean_when_target_false | mean_difference | abs_mean_difference | simple_correlation_with_target |'
  );
  lines.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const score of scores) {
    lines.push(
      `| ${score.rank} | ${score.feature_name} | ${score.sample_size} | ${score.null_count} | ${fmtPct(score.null_rate)} | ${score.target_true_count} | ${score.target_false_count} | ${fmt(score.mean_when_target_true)} | ${fmt(score.mean_when_target_false)} | ${fmt(score.mean_difference)} | ${fmt(score.abs_mean_difference)} | ${fmt(score.simple_correlation_with_target)} |`
    );
  }
  if (scores.length === 0) {
    lines.push('| - | _no features scored_ | - | - | - | - | - | - | - | - | - | - |');
  }
  lines.push('');
  lines.push('## 3. Notes / Interpretation');
  lines.push('');
  lines.push(
    top3.length > 0
      ? `- Top 3 features by abs mean difference: ${top3.join(', ')}.`
      : '- No scored features were available for ranking.'
  );
  lines.push(
    highNulls.length > 0
      ? `- High null-rate features (>=25%): ${highNulls.map((s) => `${s.feature_name} (${fmtPct(s.null_rate)})`).join(', ')}.`
      : '- No features crossed the high null-rate warning threshold (>=25%).'
  );
  lines.push(
    smallSamples.length > 0
      ? `- Small-sample features (<100 usable rows): ${smallSamples.map((s) => `${s.feature_name} (${s.sample_size})`).join(', ')}.`
      : '- No features had very small sample size (<100 rows).'
  );
  lines.push(
    '- This is a proxy signal-discovery report and does not evaluate betting profitability.'
  );
  lines.push('');
  lines.push('## 4. Data Quality Warnings');
  lines.push('');
  lines.push('- Rows with null `actual_points` or null `points_season_avg_before_game` are excluded globally.');
  lines.push('- Per-feature scoring excludes rows where that feature value is null.');
  lines.push('- Rankings are v1 and use absolute mean difference as the primary metric.');

  return lines.join('\n') + '\n';
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function pearsonCorrelation(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 2) return null;
  const n = x.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (let i = 0; i < n; i += 1) {
    const xi = x[i];
    const yi = y[i];
    sumX += xi;
    sumY += yi;
    sumXY += xi * yi;
    sumXX += xi * xi;
    sumYY += yi * yi;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denomLeft = n * sumXX - sumX * sumX;
  const denomRight = n * sumYY - sumY * sumY;
  const denominator = Math.sqrt(denomLeft * denomRight);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function fmt(n: number | null): string {
  return n == null || !Number.isFinite(n) ? 'n/a' : n.toFixed(4);
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(2)}%`;
}
