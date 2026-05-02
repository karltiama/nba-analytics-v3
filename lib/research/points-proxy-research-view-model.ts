import type { ComparedStrategy } from '@/lib/research/proxy-strategy-comparison';
import type {
  BreakdownDimension,
  PlayerSignalStats,
  StrategyBreakdownBundle,
  StrategyNarrativeAssessment,
} from '@/lib/research/proxy-strategy-breakdowns';
import { normalizePlayerIdForLookup, trimPlayerDisplayName } from '@/lib/research/player-display-name-lookup-builder';

/** Default multi-season tag aligned with generated artifacts. */
export const DEFAULT_POINTS_PROXY_SEASONS_TAG = '2023-2024-2025';

export function comparisonResultsS3Key(seasonsTag: string): string {
  return `research/strategy-sweeps/league=nba/target=score_above_season_avg/comparison/seasons=${seasonsTag}/results.json`;
}

export function breakdownResultsS3Key(seasonsTag: string): string {
  return `research/strategy-sweeps/league=nba/target=score_above_season_avg/comparison/seasons=${seasonsTag}/breakdowns/results.json`;
}

export type ParsedComparisonPayload = {
  seasons: number[];
  missing_seasons: number[];
  target_definition: string;
  generated_at: string;
  strategy_summary: ComparedStrategy[];
};

export type ParsedBreakdownPayload = {
  seasons: number[];
  strategies: string[];
  target_definition: string;
  generated_at: string;
  total_rows_loaded: number;
  strategies_breakdown: StrategyBreakdownBundle[];
  narratives: StrategyNarrativeAssessment[];
};

export type LeaderboardRowVM = {
  rank: number;
  strategy_name: string;
  weighted_hit_rate: number | null;
  total_signals: number;
  hit_rate_range: number | null;
  narrative_label: string;
  narrative_reasons: string[];
  unique_players: number;
  top10_player_signal_share: number | null;
};

export type StrategyDetailVM = {
  strategy_name: string;
  rank: number;
  narrative_label: string;
  narrative_reasons: string[];
  signal_count: number;
  unique_players: number;
  top10_player_signal_share: number | null;
  overall_hit_rate: number | null;
  short_interpretation: string;
  recommended_next_step: string;
  by_season: StrategyBreakdownBundle['by_season'];
  by_prior_games: StrategyBreakdownBundle['by_prior_games'];
  by_minutes_l5: StrategyBreakdownBundle['by_minutes_l5'];
  by_points_season_avg: StrategyBreakdownBundle['by_points_season_avg'];
  best_worst_by_dimension: StrategyBreakdownBundle['best_worst_by_dimension'];
  /** Top players by signal volume with share of strategy signals. */
  player_concentration_rows: Array<{
    player_id: string;
    player_name: string | null;
    signal_count: number;
    hit_count: number;
    hit_rate: number | null;
    share_of_strategy_signals: number;
  }>;
};

export type PointsProxyLabViewModel = {
  seasons_tag: string;
  target_definition: string;
  comparison_generated_at: string | null;
  breakdown_generated_at: string | null;
  comparison_s3_key: string;
  breakdown_s3_key: string;
  missing_seasons: number[];
  total_rows_loaded: number | null;
  leaderboard: LeaderboardRowVM[];
  strategies: StrategyDetailVM[];
  data_quality_warnings: string[];
  /** Optional S3 JSON lookup for player_id → display label (never required for page load). */
  player_display_name_enrichment: {
    s3_lookup_keys_tried: readonly string[];
    s3_lookup_files_found: number;
    s3_lookup_entry_count: number;
    /** Names merged from BallDontLie API when S3 lookup missed ids (server-only). */
    bdl_filled_count: number;
  };
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

export function parseComparisonResultsJson(raw: unknown): ParsedComparisonPayload | null {
  if (!isRecord(raw)) return null;
  const strategy_summary = raw.strategy_summary;
  if (!Array.isArray(strategy_summary)) return null;
  const seasons = Array.isArray(raw.seasons)
    ? (raw.seasons as unknown[]).filter((s): s is number => typeof s === 'number')
    : [];
  const missing = Array.isArray(raw.missing_seasons)
    ? (raw.missing_seasons as unknown[]).filter((s): s is number => typeof s === 'number')
    : [];
  return {
    seasons,
    missing_seasons: missing,
    target_definition: typeof raw.target_definition === 'string' ? raw.target_definition : '',
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
    strategy_summary: strategy_summary as ComparedStrategy[],
  };
}

/**
 * Coerce `player_frequency` entries from persisted JSON so optional `player_name` survives parse
 * without trusting a blind cast.
 */
export function mapPlayerFrequencyFromJson(arr: unknown): PlayerSignalStats[] {
  if (!Array.isArray(arr)) return [];
  const out: PlayerSignalStats[] = [];
  for (const item of arr) {
    if (!isRecord(item)) continue;
    const player_id = normalizePlayerIdForLookup(item.player_id);
    if (!player_id) continue;
    const signal_count = typeof item.signal_count === 'number' && Number.isFinite(item.signal_count) ? item.signal_count : 0;
    const hit_count = typeof item.hit_count === 'number' && Number.isFinite(item.hit_count) ? item.hit_count : 0;
    const hit_rate =
      typeof item.hit_rate === 'number' && Number.isFinite(item.hit_rate)
        ? item.hit_rate
        : signal_count > 0
          ? hit_count / signal_count
          : null;
    const player_name = trimPlayerDisplayName(item.player_name);
    out.push({ player_id, signal_count, hit_count, hit_rate, player_name });
  }
  return out;
}

function normalizeStrategyBreakdownBundleJson(bundle: unknown): StrategyBreakdownBundle {
  const b = bundle as StrategyBreakdownBundle;
  if (!isRecord(bundle) || !Array.isArray(bundle.player_frequency)) return b;
  return { ...b, player_frequency: mapPlayerFrequencyFromJson(bundle.player_frequency) };
}

export function parseBreakdownResultsJson(raw: unknown): ParsedBreakdownPayload | null {
  if (!isRecord(raw)) return null;
  const bundles = raw.strategies_breakdown;
  const narratives = raw.narratives;
  if (!Array.isArray(bundles) || !Array.isArray(narratives)) return null;
  const seasons = Array.isArray(raw.seasons)
    ? (raw.seasons as unknown[]).filter((s): s is number => typeof s === 'number')
    : [];
  const strategies = Array.isArray(raw.strategies)
    ? (raw.strategies as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const strategies_breakdown = bundles.map((x) => normalizeStrategyBreakdownBundleJson(x));
  return {
    seasons,
    strategies,
    target_definition: typeof raw.target_definition === 'string' ? raw.target_definition : '',
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
    total_rows_loaded: typeof raw.total_rows_loaded === 'number' ? raw.total_rows_loaded : 0,
    strategies_breakdown,
    narratives: narratives as StrategyNarrativeAssessment[],
  };
}

export function recommendedNextStep(label: StrategyNarrativeAssessment['label']): string {
  switch (label) {
    case 'narrow':
      return 'Audit top signal contributors and time windows before any odds-backed validation.';
    case 'noisy':
      return 'Tighten filters or add holdout evaluation; confirm stability before line shopping.';
    case 'insufficient_data':
      return 'Regenerate breakdowns or widen seasons before drawing conclusions.';
    case 'broad':
    default:
      return 'Proceed to walk-forward or holdout checks, then historical line validation when odds data is wired.';
  }
}

function effectiveNarrativeLabel(
  narrative: StrategyNarrativeAssessment | undefined,
  bundle: StrategyBreakdownBundle | undefined
): StrategyNarrativeAssessment['label'] {
  if (narrative?.label) return narrative.label;
  if (!bundle || bundle.total_signals === 0) return 'insufficient_data';
  return 'broad';
}

export function shortInterpretation(
  narrative: StrategyNarrativeAssessment | undefined,
  bundle: StrategyBreakdownBundle | undefined
): string {
  if (!bundle || bundle.total_signals === 0) {
    return 'No breakdown signals available for this strategy.';
  }
  const label = effectiveNarrativeLabel(narrative, bundle);
  const share = bundle.concentration.top_k_signal_share;
  if (label === 'broad') {
    return `Hit profile is spread across ${bundle.concentration.unique_players_with_signals} players; top-${bundle.concentration.k_used} volume share is ${(share * 100).toFixed(1)}%.`;
  }
  if (label === 'narrow') {
    return `Signals appear concentrated among fewer accounts (top-${bundle.concentration.k_used} share ${(share * 100).toFixed(1)}%).`;
  }
  if (label === 'noisy') {
    return 'Mixed concentration or uneven cross-bucket performance — treat as exploratory until further validation.';
  }
  return 'Insufficient signal mass for a reliable read.';
}

function narrativeForStrategy(
  narratives: readonly StrategyNarrativeAssessment[],
  name: string
): StrategyNarrativeAssessment | undefined {
  return narratives.find((n) => n.strategy_name === name);
}

function bundleForStrategy(
  bundles: readonly StrategyBreakdownBundle[],
  name: string
): StrategyBreakdownBundle | undefined {
  return bundles.find((b) => b.strategy_name === name);
}

/**
 * Split display name vs id for concentration tables. `resolvedName` is only a
 * human name when enrichment succeeded — never the numeric `player_id`.
 */
export function playerConcentrationDisplayFields(row: {
  player_id: string;
  player_name: string | null;
}): { resolvedName: string | null; canonicalPlayerId: string } {
  const canonicalPlayerId =
    normalizePlayerIdForLookup(row.player_id) ?? (String(row.player_id ?? '').trim() || 'unknown');
  const resolvedName = trimPlayerDisplayName(row.player_name);
  return { resolvedName, canonicalPlayerId };
}

function lookupDisplayNameInMap(map: ReadonlyMap<string, string>, pid: string): string | null {
  const tryName = (key: string | undefined): string | null => {
    if (!key) return null;
    return trimPlayerDisplayName(map.get(key));
  };
  const direct = tryName(pid);
  if (direct) return direct;
  if (/^\d+$/.test(pid) && pid.length <= 16) {
    const canon = String(Number(pid));
    if (canon !== pid) {
      const alt = tryName(canon);
      if (alt) return alt;
    }
  }
  return null;
}

function displayNameFromStats(
  p: PlayerSignalStats,
  displayNameById?: ReadonlyMap<string, string>
): string | null {
  const fromRow = trimPlayerDisplayName(p.player_name);
  if (fromRow) return fromRow;
  const pid = normalizePlayerIdForLookup(p.player_id);
  if (!pid || !displayNameById) return null;
  return lookupDisplayNameInMap(displayNameById, pid);
}

export function buildPlayerConcentrationRows(
  bundle: StrategyBreakdownBundle | undefined,
  limit: number,
  displayNameById?: ReadonlyMap<string, string>
): StrategyDetailVM['player_concentration_rows'] {
  if (!bundle || bundle.total_signals <= 0) return [];
  const sorted = [...bundle.player_frequency].sort((a, b) => b.signal_count - a.signal_count);
  const total = bundle.total_signals;
  return sorted
    .slice(0, limit)
    .map((p) => {
      const pid = normalizePlayerIdForLookup(p.player_id);
      if (!pid) return null;
      return {
        player_id: pid,
        player_name: displayNameFromStats(p, displayNameById),
        signal_count: p.signal_count,
        hit_count: p.hit_count,
        hit_rate: p.hit_rate,
        share_of_strategy_signals: p.signal_count / total,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
}

export function buildPointsProxyLabViewModel(args: {
  seasonsTag: string;
  comparison: ParsedComparisonPayload | null;
  breakdown: ParsedBreakdownPayload | null;
  /** Optional id → display name (S3 lookup); breakdown `player_name` still wins per row. */
  playerDisplayNameById?: ReadonlyMap<string, string>;
  playerDisplayNameLookupMeta?: {
    s3_lookup_keys_tried: readonly string[];
    s3_lookup_files_found: number;
    s3_lookup_entry_count: number;
    bdl_filled_count: number;
  };
}): PointsProxyLabViewModel {
  const { seasonsTag, comparison, breakdown, playerDisplayNameById, playerDisplayNameLookupMeta } = args;
  const warnings: string[] = [];
  if (!comparison) {
    warnings.push('Multi-season comparison artifact (results.json) was not found or could not be parsed.');
  }
  if (!breakdown) {
    warnings.push('Strategy breakdown artifact (breakdowns/results.json) was not found or could not be parsed.');
  }
  if (comparison?.missing_seasons?.length) {
    warnings.push(
      `Comparison was built with missing seasons: ${comparison.missing_seasons.join(', ')}. Interpret cross-season metrics cautiously.`
    );
  }

  const target_definition =
    comparison?.target_definition ||
    breakdown?.target_definition ||
    'actual_points > points_season_avg_before_game';

  const narratives = breakdown?.narratives ?? [];
  const bundles = breakdown?.strategies_breakdown ?? [];
  const summary = comparison?.strategy_summary ?? [];

  const leaderboard: LeaderboardRowVM[] = summary.map((s) => {
    const b = bundleForStrategy(bundles, s.strategy_name);
    const n = narrativeForStrategy(narratives, s.strategy_name);
    const eff = effectiveNarrativeLabel(n, b);
    return {
      rank: s.rank,
      strategy_name: s.strategy_name,
      weighted_hit_rate: s.weighted_hit_rate,
      total_signals: s.total_signal_count,
      hit_rate_range: s.hit_rate_range,
      narrative_label: b ? eff : 'no breakdown',
      narrative_reasons: n?.reasons ?? [],
      unique_players: b?.concentration.unique_players_with_signals ?? 0,
      top10_player_signal_share: b ? b.concentration.top_k_signal_share : null,
    };
  });

  const strategies: StrategyDetailVM[] = summary.map((s) => {
    const b = bundleForStrategy(bundles, s.strategy_name);
    const n = narrativeForStrategy(narratives, s.strategy_name);
    const label = effectiveNarrativeLabel(n, b);
    return {
      strategy_name: s.strategy_name,
      rank: s.rank,
      narrative_label: label,
      narrative_reasons: n?.reasons ?? [],
      signal_count: b?.total_signals ?? 0,
      unique_players: b?.concentration.unique_players_with_signals ?? 0,
      top10_player_signal_share: b ? b.concentration.top_k_signal_share : null,
      overall_hit_rate: b?.overall_hit_rate ?? null,
      short_interpretation: shortInterpretation(n, b),
      recommended_next_step: recommendedNextStep(label),
      by_season: b?.by_season ?? [],
      by_prior_games: b?.by_prior_games ?? [],
      by_minutes_l5: b?.by_minutes_l5 ?? [],
      by_points_season_avg: b?.by_points_season_avg ?? [],
      best_worst_by_dimension: b?.best_worst_by_dimension ?? {},
      player_concentration_rows: buildPlayerConcentrationRows(b, 25, playerDisplayNameById),
    };
  });

  return {
    seasons_tag: seasonsTag,
    target_definition,
    comparison_generated_at: comparison?.generated_at ?? null,
    breakdown_generated_at: breakdown?.generated_at ?? null,
    comparison_s3_key: comparisonResultsS3Key(seasonsTag),
    breakdown_s3_key: breakdownResultsS3Key(seasonsTag),
    missing_seasons: comparison?.missing_seasons ?? [],
    total_rows_loaded: breakdown?.total_rows_loaded ?? null,
    leaderboard,
    strategies,
    data_quality_warnings: warnings,
    player_display_name_enrichment: {
      s3_lookup_keys_tried: playerDisplayNameLookupMeta?.s3_lookup_keys_tried ?? [],
      s3_lookup_files_found: playerDisplayNameLookupMeta?.s3_lookup_files_found ?? 0,
      s3_lookup_entry_count: playerDisplayNameLookupMeta?.s3_lookup_entry_count ?? 0,
      bdl_filled_count: playerDisplayNameLookupMeta?.bdl_filled_count ?? 0,
    },
  };
}

export function dimensionLabel(d: BreakdownDimension): string {
  switch (d) {
    case 'season':
      return 'Season';
    case 'prior_games_bucket':
      return 'Prior games bucket';
    case 'minutes_l5_bucket':
      return 'L5 minutes bucket';
    case 'points_season_avg_bucket':
      return 'Season points avg (pre-game) bucket';
    default:
      return d;
  }
}
