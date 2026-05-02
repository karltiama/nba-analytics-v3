import type { ProxyStrategyName } from '@/lib/research/proxy-strategy-sweep';
import { PROXY_STRATEGIES } from '@/lib/research/proxy-strategy-sweep';

/** One row after global target filter; includes per-strategy signal flags. */
export type BreakdownInputRow = {
  season: number;
  player_id: string;
  prior_games: number | null;
  minutes_l5_avg_before_game: number | null;
  points_season_avg_before_game: number | null;
  /** Precomputed: actual_points > points_season_avg_before_game */
  target_true: boolean;
  /** Which strategies fired on this row (same predicates as sweep). */
  signals: Partial<Record<ProxyStrategyName, boolean>>;
};

export type BucketBreakdown = {
  dimension: BreakdownDimension;
  bucket_key: string;
  signal_count: number;
  hit_count: number;
  hit_rate: number | null;
};

export type BreakdownDimension =
  | 'season'
  | 'prior_games_bucket'
  | 'minutes_l5_bucket'
  | 'points_season_avg_bucket';

export type PlayerSignalStats = {
  player_id: string;
  signal_count: number;
  hit_count: number;
  hit_rate: number | null;
  /** Present when serialized from enriched pipelines or manual JSON; optional for sweeps. */
  player_name?: string | null;
};

export type PlayerLeaderboardEntry = PlayerSignalStats;

export type BucketExtreme = {
  bucket_key: string;
  signal_count: number;
  hit_rate: number | null;
};

export type StrategyBestWorstBuckets = {
  strategy_name: string;
  best: BucketExtreme | null;
  worst: BucketExtreme | null;
  /** Buckets considered (had at least min_sample signals). */
  buckets_evaluated: number;
};

export type PlayerConcentrationSummary = {
  unique_players_with_signals: number;
  total_signals: number;
  /** Share of all signals accounted for by top-K players by signal volume (0–1). */
  top_k_signal_share: number;
  k_used: number;
};

export type StrategyBreakdownBundle = {
  strategy_name: string;
  total_signals: number;
  overall_hit_rate: number | null;
  by_season: BucketBreakdown[];
  by_prior_games: BucketBreakdown[];
  by_minutes_l5: BucketBreakdown[];
  by_points_season_avg: BucketBreakdown[];
  player_frequency: PlayerSignalStats[];
  player_hit_leaderboard: PlayerLeaderboardEntry[];
  best_worst_by_dimension: Partial<
    Record<BreakdownDimension, { best: BucketExtreme | null; worst: BucketExtreme | null }>
  >;
  concentration: PlayerConcentrationSummary;
};

const ALL_STRATEGIES = new Set<string>(PROXY_STRATEGIES);

export function isValidProxyStrategyName(name: string): name is ProxyStrategyName {
  return ALL_STRATEGIES.has(name);
}

export function assignPriorGamesBucket(priorGames: number | null): string {
  if (priorGames == null || !Number.isFinite(priorGames)) return 'unknown';
  if (priorGames < 10) return 'lt_10';
  if (priorGames < 15) return '10_14';
  if (priorGames < 20) return '15_19';
  if (priorGames < 30) return '20_29';
  return '30_plus';
}

export function assignMinutesL5Bucket(minutesL5: number | null): string {
  if (minutesL5 == null || !Number.isFinite(minutesL5)) return 'unknown';
  if (minutesL5 < 20) return 'lt_20';
  if (minutesL5 < 24) return '20_23';
  if (minutesL5 < 28) return '24_27';
  if (minutesL5 < 32) return '28_31';
  return '32_plus';
}

export function assignPointsSeasonAvgBucket(seasonAvg: number | null): string {
  if (seasonAvg == null || !Number.isFinite(seasonAvg)) return 'unknown';
  if (seasonAvg < 8) return 'lt_8';
  if (seasonAvg < 12) return '8_11';
  if (seasonAvg < 16) return '12_15';
  if (seasonAvg < 20) return '16_19';
  return '20_plus';
}

export function bucketKeyForDimension(row: BreakdownInputRow, dimension: BreakdownDimension): string {
  switch (dimension) {
    case 'season':
      return String(row.season);
    case 'prior_games_bucket':
      return assignPriorGamesBucket(row.prior_games);
    case 'minutes_l5_bucket':
      return assignMinutesL5Bucket(row.minutes_l5_avg_before_game);
    case 'points_season_avg_bucket':
      return assignPointsSeasonAvgBucket(row.points_season_avg_before_game);
    default:
      return 'unknown';
  }
}

export function filterSignaledRows(
  rows: readonly BreakdownInputRow[],
  strategy: ProxyStrategyName
): BreakdownInputRow[] {
  return rows.filter((r) => r.signals[strategy] === true);
}

/** Hit rate among signaled rows in each bucket for the given dimension. */
export function aggregateBucketBreakdowns(args: {
  rows: readonly BreakdownInputRow[];
  strategy: ProxyStrategyName;
  dimension: BreakdownDimension;
}): BucketBreakdown[] {
  const signaled = filterSignaledRows(args.rows, args.strategy);
  const byBucket = new Map<string, { hits: number; n: number }>();
  for (const row of signaled) {
    const key = bucketKeyForDimension(row, args.dimension);
    const cur = byBucket.get(key) ?? { hits: 0, n: 0 };
    cur.n += 1;
    if (row.target_true) cur.hits += 1;
    byBucket.set(key, cur);
  }
  const out: BucketBreakdown[] = [...byBucket.entries()]
    .map(([bucket_key, v]) => ({
      dimension: args.dimension,
      bucket_key,
      signal_count: v.n,
      hit_count: v.hits,
      hit_rate: v.n > 0 ? v.hits / v.n : null,
    }))
    .sort((a, b) => a.bucket_key.localeCompare(b.bucket_key));
  return out;
}

export function aggregatePlayerSignalStats(
  rows: readonly BreakdownInputRow[],
  strategy: ProxyStrategyName
): PlayerSignalStats[] {
  const signaled = filterSignaledRows(rows, strategy);
  const byPlayer = new Map<string, { hits: number; n: number }>();
  for (const row of signaled) {
    const pid = row.player_id?.trim() || '_unknown';
    const cur = byPlayer.get(pid) ?? { hits: 0, n: 0 };
    cur.n += 1;
    if (row.target_true) cur.hits += 1;
    byPlayer.set(pid, cur);
  }
  return [...byPlayer.entries()]
    .map(([player_id, v]) => ({
      player_id,
      signal_count: v.n,
      hit_count: v.hits,
      hit_rate: v.n > 0 ? v.hits / v.n : null,
    }))
    .sort((a, b) => b.signal_count - a.signal_count);
}

export function playerHitRateLeaderboard(
  stats: readonly PlayerSignalStats[],
  minSignals: number
): PlayerLeaderboardEntry[] {
  return stats
    .filter((s) => s.signal_count >= minSignals && s.hit_rate != null)
    .sort((a, b) => {
      if ((b.hit_rate ?? 0) !== (a.hit_rate ?? 0)) return (b.hit_rate ?? 0) - (a.hit_rate ?? 0);
      return b.signal_count - a.signal_count;
    });
}

export function detectBestWorstBuckets(
  buckets: readonly BucketBreakdown[],
  minSample: number
): { best: BucketExtreme | null; worst: BucketExtreme | null; buckets_evaluated: number } {
  const eligible = buckets.filter((b) => b.signal_count >= minSample && b.hit_rate != null);
  if (eligible.length === 0) {
    return { best: null, worst: null, buckets_evaluated: 0 };
  }
  const sorted = [...eligible].sort((a, b) => (b.hit_rate ?? 0) - (a.hit_rate ?? 0));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return {
    best: { bucket_key: best.bucket_key, signal_count: best.signal_count, hit_rate: best.hit_rate },
    worst: { bucket_key: worst.bucket_key, signal_count: worst.signal_count, hit_rate: worst.hit_rate },
    buckets_evaluated: eligible.length,
  };
}

export function playerSignalConcentration(
  stats: readonly PlayerSignalStats[],
  topK: number
): PlayerConcentrationSummary {
  if (stats.length === 0) {
    return { unique_players_with_signals: 0, total_signals: 0, top_k_signal_share: 0, k_used: 0 };
  }
  const total_signals = stats.reduce((s, p) => s + p.signal_count, 0);
  const sorted = [...stats].sort((a, b) => b.signal_count - a.signal_count);
  const k = Math.min(topK, sorted.length);
  const topSum = sorted.slice(0, k).reduce((s, p) => s + p.signal_count, 0);
  return {
    unique_players_with_signals: stats.length,
    total_signals,
    top_k_signal_share: total_signals > 0 ? topSum / total_signals : 0,
    k_used: k,
  };
}

export function buildStrategyBreakdownBundle(args: {
  rows: readonly BreakdownInputRow[];
  strategy: ProxyStrategyName;
  leaderboardMinSignals?: number;
  bucketExtremeMinSample?: number;
  concentrationTopK?: number;
}): StrategyBreakdownBundle {
  const {
    rows,
    strategy,
    leaderboardMinSignals = 5,
    bucketExtremeMinSample = 50,
    concentrationTopK = 10,
  } = args;
  const signaled = filterSignaledRows(rows, strategy);
  const hits = signaled.filter((r) => r.target_true).length;
  const total_signals = signaled.length;
  const overall_hit_rate = total_signals > 0 ? hits / total_signals : null;

  const by_season = aggregateBucketBreakdowns({ rows, strategy, dimension: 'season' });
  const by_prior_games = aggregateBucketBreakdowns({ rows, strategy, dimension: 'prior_games_bucket' });
  const by_minutes_l5 = aggregateBucketBreakdowns({ rows, strategy, dimension: 'minutes_l5_bucket' });
  const by_points_season_avg = aggregateBucketBreakdowns({
    rows,
    strategy,
    dimension: 'points_season_avg_bucket',
  });

  const player_frequency = aggregatePlayerSignalStats(rows, strategy);
  const player_hit_leaderboard = playerHitRateLeaderboard(player_frequency, leaderboardMinSignals);

  const dims: BreakdownDimension[] = [
    'season',
    'prior_games_bucket',
    'minutes_l5_bucket',
    'points_season_avg_bucket',
  ];
  const best_worst_by_dimension: StrategyBreakdownBundle['best_worst_by_dimension'] = {};
  const dimBuckets: Record<BreakdownDimension, BucketBreakdown[]> = {
    season: by_season,
    prior_games_bucket: by_prior_games,
    minutes_l5_bucket: by_minutes_l5,
    points_season_avg_bucket: by_points_season_avg,
  };
  for (const d of dims) {
    const { best, worst } = detectBestWorstBuckets(dimBuckets[d], bucketExtremeMinSample);
    best_worst_by_dimension[d] = { best, worst };
  }

  const concentration = playerSignalConcentration(player_frequency, concentrationTopK);

  return {
    strategy_name: strategy,
    total_signals,
    overall_hit_rate,
    by_season,
    by_prior_games,
    by_minutes_l5,
    by_points_season_avg,
    player_frequency,
    player_hit_leaderboard,
    best_worst_by_dimension,
    concentration,
  };
}

export type StrategyNarrativeAssessment = {
  strategy_name: string;
  label: 'broad' | 'narrow' | 'noisy' | 'insufficient_data';
  reasons: string[];
};

/**
 * Heuristic narrative: high top-K share => concentration; tiny buckets dominating => noisy;
 * even season + bucket spread => broad.
 */
export function assessStrategyNarrative(bundle: StrategyBreakdownBundle): StrategyNarrativeAssessment {
  const reasons: string[] = [];
  if (bundle.total_signals === 0) {
    return { strategy_name: bundle.strategy_name, label: 'insufficient_data', reasons: ['No signals.'] };
  }

  const share = bundle.concentration.top_k_signal_share;
  if (share >= 0.35) {
    reasons.push(`Top ${bundle.concentration.k_used} players account for ${(share * 100).toFixed(1)}% of signals.`);
  }

  const seasonBw = bundle.best_worst_by_dimension.season;
  const hrSpread =
    seasonBw?.best?.hit_rate != null && seasonBw?.worst?.hit_rate != null
      ? seasonBw.best.hit_rate - seasonBw.worst.hit_rate
      : null;

  if (hrSpread != null && hrSpread > 0.12) {
    reasons.push(`Large hit-rate spread across seasons (${(hrSpread * 100).toFixed(1)} pts).`);
  }

  let label: StrategyNarrativeAssessment['label'] = 'broad';
  if (share >= 0.45) {
    label = 'narrow';
    reasons.push('Player concentration is high relative to typical broad strategies.');
  } else if (share >= 0.3 || (hrSpread != null && hrSpread > 0.15)) {
    label = 'noisy';
    if (label === 'broad') reasons.push('Mixed concentration or cross-season instability.');
  }

  if (label === 'broad' && reasons.length === 0) {
    reasons.push('Signals spread across many players with moderate top-K share.');
  }

  return { strategy_name: bundle.strategy_name, label, reasons };
}

export type ComparisonLeaderRow = {
  rank: number;
  strategy_name: string;
  weighted_hit_rate: number | null;
  total_signal_count: number;
};

export function renderProxyStrategyBreakdownMarkdownReport(args: {
  seasons: number[];
  strategies: string[];
  generatedAt: string;
  inputPaths: string[];
  outputPath: string;
  targetDefinition: string;
  leaderboardRecap: ComparisonLeaderRow[];
  bundles: StrategyBreakdownBundle[];
  narratives: StrategyNarrativeAssessment[];
  /** One line per strategy; caller should include robustness / concentration callouts. */
  executiveBullets?: string[];
}): string {
  const lines: string[] = [];
  lines.push('# Player Points Proxy Strategy — Quality Breakdowns');
  lines.push('');
  lines.push('## Executive summary');
  lines.push('');
  lines.push(
    `This report slices **${args.strategies.join(', ')}** across seasons **${args.seasons.join(', ')}** using the same proxy target: \`${args.targetDefinition}\`.`
  );
  lines.push(
    'Use bucket tables and player concentration to judge whether performance is **broad and stable** or **concentrated / fragile** — still **not** a betting profitability test.'
  );
  lines.push('');
  if (args.executiveBullets && args.executiveBullets.length > 0) {
    for (const b of args.executiveBullets) {
      lines.push(`- ${b}`);
    }
    lines.push('');
  }
  lines.push('## Metadata');
  lines.push(`- seasons: ${args.seasons.join(', ')}`);
  lines.push(`- strategies: ${args.strategies.join(', ')}`);
  lines.push(`- target definition: ${args.targetDefinition}`);
  lines.push(`- generated_at: ${args.generatedAt}`);
  lines.push(`- input paths: ${args.inputPaths.join('; ')}`);
  lines.push(`- output path: ${args.outputPath}`);
  lines.push('');
  lines.push('## Strategy leaderboard recap');
  lines.push('');
  lines.push('| rank | strategy_name | weighted_hit_rate | total_signal_count |');
  lines.push('|---:|---|---:|---:|');
  for (const r of args.leaderboardRecap) {
    lines.push(
      `| ${r.rank} | ${r.strategy_name} | ${fmtPct(r.weighted_hit_rate)} | ${r.total_signal_count} |`
    );
  }
  if (args.leaderboardRecap.length === 0) {
    lines.push('| — | _no comparison data_ | — | — |');
  }
  lines.push('');

  for (const bundle of args.bundles) {
    const narrative = args.narratives.find((n) => n.strategy_name === bundle.strategy_name);
    lines.push(`## Per-strategy breakdown: \`${bundle.strategy_name}\``);
    lines.push('');
    lines.push(
      `- **Total signals:** ${bundle.total_signals} · **Overall hit rate:** ${fmtPct(bundle.overall_hit_rate)}`
    );
    lines.push(
      `- **Unique players (with ≥1 signal):** ${bundle.concentration.unique_players_with_signals} · **Top-${bundle.concentration.k_used} signal share:** ${fmtPct(bundle.concentration.top_k_signal_share)}`
    );
    if (narrative) {
      lines.push(`- **Assessment:** **${narrative.label}** — ${narrative.reasons.join(' ')}`);
    }
    lines.push('');
    lines.push('### By season');
    lines.push(...markdownBucketTable(bundle.by_season));
    lines.push('### By prior games bucket');
    lines.push(...markdownBucketTable(bundle.by_prior_games));
    lines.push('### By minutes L5 bucket');
    lines.push(...markdownBucketTable(bundle.by_minutes_l5));
    lines.push('### By points season average bucket');
    lines.push(...markdownBucketTable(bundle.by_points_season_avg));
    lines.push('### Best buckets (min sample for extremes)');
    lines.push('');
    for (const [dim, bw] of Object.entries(bundle.best_worst_by_dimension)) {
      if (!bw) continue;
      lines.push(
        `- **${dim}** — best: \`${bw.best?.bucket_key ?? 'n/a'}\` (${fmtPct(bw.best?.hit_rate ?? null)}, n=${bw.best?.signal_count ?? 0}) · worst: \`${bw.worst?.bucket_key ?? 'n/a'}\` (${fmtPct(bw.worst?.hit_rate ?? null)}, n=${bw.worst?.signal_count ?? 0})`
      );
    }
    lines.push('');
    lines.push('### Weakest buckets (full table — interpret low n carefully)');
    lines.push(
      '_Weakest bucket per dimension is already summarized above; full tables list all buckets including small samples._'
    );
    lines.push('');
    lines.push('### Player concentration warnings');
    lines.push('');
    if (bundle.concentration.top_k_signal_share >= 0.35) {
      lines.push(
        `- **Warning:** top-${bundle.concentration.k_used} players by signal volume explain **${(bundle.concentration.top_k_signal_share * 100).toFixed(1)}%** of signals.`
      );
    } else {
      lines.push('- **No strong concentration warning** under the default top-K threshold.');
    }
    lines.push('');
    lines.push('### Player hit rate leaderboard (min signals threshold)');
    lines.push('');
    lines.push('| player_id | signal_count | hit_count | hit_rate |');
    lines.push('|---|---:|---:|---:|');
    for (const p of bundle.player_hit_leaderboard.slice(0, 15)) {
      lines.push(
        `| ${p.player_id} | ${p.signal_count} | ${p.hit_count} | ${fmtPct(p.hit_rate)} |`
      );
    }
    if (bundle.player_hit_leaderboard.length === 0) {
      lines.push('| — | — | — | — |');
    }
    lines.push('');
  }

  lines.push('## Notes — broad vs narrow vs noisy');
  lines.push('');
  for (const n of args.narratives) {
    lines.push(`- **${n.strategy_name}:** **${n.label}** — ${n.reasons.join(' ')}`);
  }
  lines.push('');
  lines.push('## Recommended next step');
  lines.push('');
  lines.push(
    '1. If a strategy is **narrow** (high player concentration), drill into those players and time windows before any odds integration.'
  );
  lines.push(
    '2. If **broad**, proceed to **holdout / walk-forward** style checks and then paper-test against closing lines when available.'
  );
  lines.push('3. Keep using **weighted** cross-season metrics when comparing strategies with different signal volumes.');
  lines.push('');
  lines.push('## Data quality warnings');
  lines.push('');
  lines.push('- No odds data; proxy target only.');
  lines.push('- Small bucket `signal_count` can produce extreme hit rates; use min-sample extremes where noted.');
  lines.push('- Rows require non-null `actual_points` and `points_season_avg_before_game` (same as sweep).');
  lines.push('');

  return lines.join('\n') + '\n';
}

function markdownBucketTable(rows: readonly BucketBreakdown[]): string[] {
  if (rows.length === 0) {
    return ['_No rows._', ''];
  }
  const out: string[] = [];
  out.push('| bucket | signals | hits | hit_rate |');
  out.push('|---|---:|---:|---:|');
  for (const b of rows) {
    out.push(`| ${b.bucket_key} | ${b.signal_count} | ${b.hit_count} | ${fmtPct(b.hit_rate)} |`);
  }
  out.push('');
  return out;
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(2)}%`;
}
