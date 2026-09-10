/**
 * Compact historical Advanced serving contract (Step 12D).
 * Client-safe: no fs/S3. Metrics preserve certified archive scale (percentages 0–1).
 * Attach Advanced onto existing box-score players only — never fabricate a box row.
 */

export const PLAYER_GAME_ADVANCED_SEASONS = ['2023', '2024', '2025'] as const;

export const PLAYER_GAME_ADVANCED_SOURCE = 'bdl_advanced_stats_v2_archive';

/** Known 2023 Advanced-only identity (valid game+player, no player_game_logs row). */
export const ADVANCED_ONLY_ALEX_LEN_2023 = {
  gameId: '1038324',
  playerId: '273',
  playerName: 'Alex Len',
  matchup: 'SAC vs DET',
  date: '2024-02-08',
} as const;

export type PlayerGameAdvancedSeason = (typeof PLAYER_GAME_ADVANCED_SEASONS)[number];

/**
 * Certified archive scale (sampled 2025 page=1 and preserved as-is):
 * - usage / AST% / REB%: 0–1 fractions (0.14 = 14%)
 * - TS / eFG: typically 0–1; can exceed 1.0 on tiny 3-point samples
 * - PIE: typically 0–1; extremes outside that range exist on tiny samples
 * - ORtg / DRtg / Net: provider points per 100 possessions
 * - pace: provider pace estimate
 * - possessions: player Advanced possessions (integer-valued in sample)
 * - turnover_ratio: provider ratio (sample 5.3), not a 0–1 percentage
 */
export type HistoricalPlayerAdvanced = {
  usagePercentage: number | null;
  trueShootingPercentage: number | null;
  effectiveFieldGoalPercentage: number | null;
  offensiveRating: number | null;
  defensiveRating: number | null;
  netRating: number | null;
  pace: number | null;
  possessions: number | null;
  assistPercentage: number | null;
  reboundPercentage: number | null;
  turnoverRatio: number | null;
  pie: number | null;
};

export type HistoricalAdvancedServingRow = HistoricalPlayerAdvanced & {
  playerId: string;
  gameId: string;
  season: string;
};

export function isAdvancedServingSeason(season: string | number | null | undefined): boolean {
  return PLAYER_GAME_ADVANCED_SEASONS.includes(String(season ?? '') as PlayerGameAdvancedSeason);
}

/** UI must use the Final contract flag, not season number. */
export function shouldShowHistoricalAdvanced(
  availability: { advanced?: boolean } | null | undefined
): boolean {
  return availability?.advanced === true;
}

export const HISTORICAL_PLAYER_VIEW_BOX = 'box' as const;
export const HISTORICAL_PLAYER_VIEW_ADVANCED = 'advanced' as const;
export type HistoricalPlayerView =
  | typeof HISTORICAL_PLAYER_VIEW_BOX
  | typeof HISTORICAL_PLAYER_VIEW_ADVANCED;
export const HISTORICAL_PLAYER_VIEW_DEFAULT: HistoricalPlayerView = HISTORICAL_PLAYER_VIEW_BOX;

export function emptyPlayerAdvanced(): HistoricalPlayerAdvanced {
  return {
    usagePercentage: null,
    trueShootingPercentage: null,
    effectiveFieldGoalPercentage: null,
    offensiveRating: null,
    defensiveRating: null,
    netRating: null,
    pace: null,
    possessions: null,
    assistPercentage: null,
    reboundPercentage: null,
    turnoverRatio: null,
    pie: null,
  };
}

export function mapServingAdvancedRow(row: {
  player_id?: unknown;
  game_id?: unknown;
  season?: unknown;
  usage_percentage?: unknown;
  true_shooting_percentage?: unknown;
  effective_field_goal_percentage?: unknown;
  offensive_rating?: unknown;
  defensive_rating?: unknown;
  net_rating?: unknown;
  pace?: unknown;
  possessions?: unknown;
  assist_percentage?: unknown;
  rebound_percentage?: unknown;
  turnover_ratio?: unknown;
  pie?: unknown;
}): HistoricalAdvancedServingRow {
  return {
    playerId: String(row.player_id ?? ''),
    gameId: String(row.game_id ?? ''),
    season: String(row.season ?? ''),
    usagePercentage: finiteOrNull(row.usage_percentage),
    trueShootingPercentage: finiteOrNull(row.true_shooting_percentage),
    effectiveFieldGoalPercentage: finiteOrNull(row.effective_field_goal_percentage),
    offensiveRating: finiteOrNull(row.offensive_rating),
    defensiveRating: finiteOrNull(row.defensive_rating),
    netRating: finiteOrNull(row.net_rating),
    pace: finiteOrNull(row.pace),
    possessions: finiteOrNull(row.possessions),
    assistPercentage: finiteOrNull(row.assist_percentage),
    reboundPercentage: finiteOrNull(row.rebound_percentage),
    turnoverRatio: finiteOrNull(row.turnover_ratio),
    pie: finiteOrNull(row.pie),
  };
}

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function advancedByPlayerId(
  rows: HistoricalAdvancedServingRow[]
): Map<string, HistoricalPlayerAdvanced> {
  const map = new Map<string, HistoricalPlayerAdvanced>();
  for (const row of rows) {
    if (!row.playerId) continue;
    map.set(row.playerId, {
      usagePercentage: row.usagePercentage,
      trueShootingPercentage: row.trueShootingPercentage,
      effectiveFieldGoalPercentage: row.effectiveFieldGoalPercentage,
      offensiveRating: row.offensiveRating,
      defensiveRating: row.defensiveRating,
      netRating: row.netRating,
      pace: row.pace,
      possessions: row.possessions,
      assistPercentage: row.assistPercentage,
      reboundPercentage: row.reboundPercentage,
      turnoverRatio: row.turnoverRatio,
      pie: row.pie,
    });
  }
  return map;
}
