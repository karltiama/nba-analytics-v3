import type { StrategyResult } from '@/lib/research/proxy-strategy-sweep';

export type SeasonSweepResultsPayload = {
  season: number;
  target_definition: string;
  generated_at: string;
  input_path: string;
  output_path: string;
  total_rows: number;
  strategies: StrategyResult[];
};

export type PerSeasonStrategyRow = {
  season: number;
  strategy_name: string;
  signal_count: number;
  hit_rate: number | null;
  avg_points_over_baseline: number | null;
  signal_rate: number;
};

export type ComparedStrategy = {
  strategy_name: string;
  seasons_included: number[];
  total_signal_count: number;
  weighted_hit_rate: number | null;
  simple_avg_hit_rate: number | null;
  min_hit_rate: number | null;
  max_hit_rate: number | null;
  hit_rate_range: number | null;
  avg_signal_count_per_season: number;
  min_signal_count: number;
  max_signal_count: number;
  weighted_avg_points_over_baseline: number | null;
  best_season: number | null;
  worst_season: number | null;
  rank: number;
};

export type ComparisonBuildResult = {
  requested_seasons: number[];
  included_seasons: number[];
  missing_seasons: number[];
  per_season_rows: PerSeasonStrategyRow[];
  strategy_summary: ComparedStrategy[];
};

export function loadSeasonResults(args: {
  requestedSeasons: number[];
  availablePayloads: SeasonSweepResultsPayload[];
}): {
  requestedSeasons: number[];
  includedSeasons: number[];
  missingSeasons: number[];
  availablePayloads: SeasonSweepResultsPayload[];
} {
  const requestedSeasons = uniqueSorted(args.requestedSeasons);
  const bySeason = new Map<number, SeasonSweepResultsPayload>();
  for (const payload of args.availablePayloads) {
    bySeason.set(payload.season, payload);
  }
  const includedSeasons = requestedSeasons.filter((s) => bySeason.has(s));
  const missingSeasons = requestedSeasons.filter((s) => !bySeason.has(s));
  return {
    requestedSeasons,
    includedSeasons,
    missingSeasons,
    availablePayloads: includedSeasons.map((s) => bySeason.get(s)!),
  };
}

export function calculateWeightedHitRate(rows: PerSeasonStrategyRow[]): number | null {
  let weightedHits = 0;
  let totalSignals = 0;
  for (const row of rows) {
    if (row.hit_rate == null || !Number.isFinite(row.hit_rate) || row.signal_count <= 0) continue;
    weightedHits += row.hit_rate * row.signal_count;
    totalSignals += row.signal_count;
  }
  return totalSignals > 0 ? weightedHits / totalSignals : null;
}

export function calculateSimpleAvgHitRate(rows: PerSeasonStrategyRow[]): number | null {
  const vals = rows.map((r) => r.hit_rate).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function calculateHitRateRange(rows: PerSeasonStrategyRow[]): {
  min_hit_rate: number | null;
  max_hit_rate: number | null;
  hit_rate_range: number | null;
} {
  const vals = rows.map((r) => r.hit_rate).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return { min_hit_rate: null, max_hit_rate: null, hit_rate_range: null };
  const min_hit_rate = Math.min(...vals);
  const max_hit_rate = Math.max(...vals);
  return { min_hit_rate, max_hit_rate, hit_rate_range: max_hit_rate - min_hit_rate };
}

export function compareStrategyAcrossSeasons(args: {
  strategyName: string;
  rows: PerSeasonStrategyRow[];
}): Omit<ComparedStrategy, 'rank'> {
  const { strategyName, rows } = args;
  const seasonsIncluded = uniqueSorted(rows.map((r) => r.season));
  const totalSignalCount = rows.reduce((acc, row) => acc + row.signal_count, 0);
  const weightedHitRate = calculateWeightedHitRate(rows);
  const simpleAvgHitRate = calculateSimpleAvgHitRate(rows);
  const { min_hit_rate, max_hit_rate, hit_rate_range } = calculateHitRateRange(rows);
  const avgSignalCountPerSeason = rows.length > 0 ? totalSignalCount / rows.length : 0;
  const minSignalCount = rows.length > 0 ? Math.min(...rows.map((r) => r.signal_count)) : 0;
  const maxSignalCount = rows.length > 0 ? Math.max(...rows.map((r) => r.signal_count)) : 0;

  let weightedBaselineNumerator = 0;
  let weightedBaselineDenominator = 0;
  for (const row of rows) {
    if (
      row.avg_points_over_baseline == null ||
      !Number.isFinite(row.avg_points_over_baseline) ||
      row.signal_count <= 0
    ) {
      continue;
    }
    weightedBaselineNumerator += row.avg_points_over_baseline * row.signal_count;
    weightedBaselineDenominator += row.signal_count;
  }
  const weightedAvgPointsOverBaseline =
    weightedBaselineDenominator > 0
      ? weightedBaselineNumerator / weightedBaselineDenominator
      : null;

  const rankedByHit = [...rows]
    .filter((r) => r.hit_rate != null && Number.isFinite(r.hit_rate))
    .sort((a, b) => {
      if ((a.hit_rate ?? -1) !== (b.hit_rate ?? -1)) return (b.hit_rate ?? -1) - (a.hit_rate ?? -1);
      return b.signal_count - a.signal_count;
    });

  return {
    strategy_name: strategyName,
    seasons_included: seasonsIncluded,
    total_signal_count: totalSignalCount,
    weighted_hit_rate: weightedHitRate,
    simple_avg_hit_rate: simpleAvgHitRate,
    min_hit_rate,
    max_hit_rate,
    hit_rate_range,
    avg_signal_count_per_season: avgSignalCountPerSeason,
    min_signal_count: minSignalCount,
    max_signal_count: maxSignalCount,
    weighted_avg_points_over_baseline: weightedAvgPointsOverBaseline,
    best_season: rankedByHit[0]?.season ?? null,
    worst_season: rankedByHit.length > 0 ? rankedByHit[rankedByHit.length - 1].season : null,
  };
}

export function rankComparedStrategies(
  rows: Omit<ComparedStrategy, 'rank'>[]
): ComparedStrategy[] {
  const sorted = [...rows].sort((a, b) => {
    const aw = a.weighted_hit_rate ?? Number.NEGATIVE_INFINITY;
    const bw = b.weighted_hit_rate ?? Number.NEGATIVE_INFINITY;
    if (aw !== bw) return bw - aw;
    if (a.total_signal_count !== b.total_signal_count) return b.total_signal_count - a.total_signal_count;
    const ar = a.hit_rate_range ?? Number.POSITIVE_INFINITY;
    const br = b.hit_rate_range ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return a.strategy_name.localeCompare(b.strategy_name);
  });
  return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function buildProxyStrategyComparison(args: {
  requestedSeasons: number[];
  availablePayloads: SeasonSweepResultsPayload[];
}): ComparisonBuildResult {
  const loaded = loadSeasonResults(args);
  const perSeasonRows: PerSeasonStrategyRow[] = [];
  for (const payload of loaded.availablePayloads) {
    for (const strategy of payload.strategies) {
      perSeasonRows.push({
        season: payload.season,
        strategy_name: strategy.strategy_name,
        signal_count: strategy.signal_count,
        hit_rate: strategy.hit_rate,
        avg_points_over_baseline: strategy.avg_points_over_baseline,
        signal_rate: strategy.signal_rate,
      });
    }
  }

  const grouped = new Map<string, PerSeasonStrategyRow[]>();
  for (const row of perSeasonRows) {
    if (!grouped.has(row.strategy_name)) grouped.set(row.strategy_name, []);
    grouped.get(row.strategy_name)!.push(row);
  }
  const compared = rankComparedStrategies(
    [...grouped.entries()].map(([strategyName, rows]) =>
      compareStrategyAcrossSeasons({ strategyName, rows })
    )
  );

  return {
    requested_seasons: loaded.requestedSeasons,
    included_seasons: loaded.includedSeasons,
    missing_seasons: loaded.missingSeasons,
    per_season_rows: perSeasonRows,
    strategy_summary: compared,
  };
}

export function renderProxyStrategyComparisonMarkdownReport(args: {
  seasons: number[];
  targetDefinition: string;
  generatedAt: string;
  inputPaths: string[];
  outputPath: string;
  missingSeasons: number[];
  strategySummary: ComparedStrategy[];
  perSeasonRows: PerSeasonStrategyRow[];
}): string {
  const stable = [...args.strategySummary]
    .sort((a, b) => {
      const ar = a.hit_rate_range ?? Number.POSITIVE_INFINITY;
      const br = b.hit_rate_range ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return b.total_signal_count - a.total_signal_count;
    })
    .slice(0, 3);
  const highestHit = [...args.strategySummary]
    .sort((a, b) => {
      const aw = a.weighted_hit_rate ?? Number.NEGATIVE_INFINITY;
      const bw = b.weighted_hit_rate ?? Number.NEGATIVE_INFINITY;
      if (aw !== bw) return bw - aw;
      return b.total_signal_count - a.total_signal_count;
    })
    .slice(0, 3);

  const lines: string[] = [];
  lines.push('# Player Points Proxy Strategy Multi-Season Comparison');
  lines.push('');
  lines.push('## Metadata');
  lines.push(`- seasons: ${args.seasons.join(', ')}`);
  lines.push(`- target definition: ${args.targetDefinition}`);
  lines.push(`- generated_at: ${args.generatedAt}`);
  lines.push(`- input paths: ${args.inputPaths.join('; ')}`);
  lines.push(`- output path: ${args.outputPath}`);
  lines.push(
    `- missing seasons: ${args.missingSeasons.length > 0 ? args.missingSeasons.join(', ') : 'none'}`
  );
  lines.push('');
  lines.push('## 1. Cross-Season Strategy Summary');
  lines.push('');
  lines.push(
    '| rank | strategy_name | seasons_included | total_signal_count | weighted_hit_rate | simple_avg_hit_rate | hit_rate_range | weighted_avg_points_over_baseline | best_season | worst_season |'
  );
  lines.push('|---:|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of args.strategySummary) {
    lines.push(
      `| ${r.rank} | ${r.strategy_name} | ${r.seasons_included.join(',')} | ${r.total_signal_count} | ${fmtPct(r.weighted_hit_rate)} | ${fmtPct(r.simple_avg_hit_rate)} | ${fmtPct(r.hit_rate_range)} | ${fmt(r.weighted_avg_points_over_baseline)} | ${r.best_season ?? 'n/a'} | ${r.worst_season ?? 'n/a'} |`
    );
  }
  lines.push('');
  lines.push('## 2. Per-Season Results');
  lines.push('');
  lines.push(
    '| season | strategy_name | signal_count | signal_rate | hit_rate | avg_points_over_baseline |'
  );
  lines.push('|---:|---|---:|---:|---:|---:|');
  for (const row of [...args.perSeasonRows].sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return a.strategy_name.localeCompare(b.strategy_name);
  })) {
    lines.push(
      `| ${row.season} | ${row.strategy_name} | ${row.signal_count} | ${fmtPct(row.signal_rate)} | ${fmtPct(row.hit_rate)} | ${fmt(row.avg_points_over_baseline)} |`
    );
  }
  lines.push('');
  lines.push('## 3. Most Stable Strategies');
  lines.push('');
  for (const s of stable) {
    lines.push(
      `- ${s.strategy_name}: hit_rate_range=${fmtPct(s.hit_rate_range)}, weighted_hit_rate=${fmtPct(s.weighted_hit_rate)}, total_signal_count=${s.total_signal_count}`
    );
  }
  lines.push('');
  lines.push('## 4. Highest Hit Rate Strategies');
  lines.push('');
  for (const s of highestHit) {
    lines.push(
      `- ${s.strategy_name}: weighted_hit_rate=${fmtPct(s.weighted_hit_rate)}, total_signal_count=${s.total_signal_count}, hit_rate_range=${fmtPct(s.hit_rate_range)}`
    );
  }
  lines.push('');
  lines.push('## 5. Interpretation Notes');
  lines.push('');
  lines.push('- This is a proxy validation report, not betting profitability.');
  lines.push('- Strategies with high hit rate but tiny sample size should be treated carefully.');
  lines.push(
    '- Strategies that remain strong across multiple seasons are better candidates for future odds-data testing.'
  );
  lines.push(
    '- Weighted hit rate should matter more than simple average when signal counts differ by season.'
  );
  lines.push('');
  lines.push('## 6. Data Quality Warnings');
  lines.push('');
  lines.push('- No odds data is used in this comparison.');
  lines.push('- Existing seasonal sweep outputs are read-only inputs and are not modified.');
  lines.push('- Missing season outputs reduce comparison coverage and confidence.');
  return lines.join('\n') + '\n';
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function fmt(n: number | null): string {
  return n == null || !Number.isFinite(n) ? 'n/a' : n.toFixed(4);
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(2)}%`;
}
