/**
 * Compact Advanced Stats V2 archive → serving transform (Step 12D).
 * Read-only S3 pages. Selected fields only. IDs, never names.
 * Duplicate game_id+player_id is a hard fail — do not pick first/last.
 */

import {
  ADVANCED_ONLY_ALEX_LEN_2023,
  PLAYER_GAME_ADVANCED_SEASONS,
  PLAYER_GAME_ADVANCED_SOURCE,
  type HistoricalPlayerAdvanced,
} from '@/lib/betting/historical-advanced';

export {
  ADVANCED_ONLY_ALEX_LEN_2023,
  PLAYER_GAME_ADVANCED_SEASONS,
  PLAYER_GAME_ADVANCED_SOURCE,
};

export const ADVANCED_STATS_V2_ENTITY = 'advanced_stats_v2';

export const SELECTED_ADVANCED_FIELDS = [
  'usage_percentage',
  'true_shooting_percentage',
  'effective_field_goal_percentage',
  'offensive_rating',
  'defensive_rating',
  'net_rating',
  'pace',
  'possessions',
  'assist_percentage',
  'rebound_percentage',
  'turnover_ratio',
  'pie',
] as const;

export type SelectedAdvancedField = (typeof SELECTED_ADVANCED_FIELDS)[number];

/** Explicitly never copied into serving. */
export const EXCLUDED_ADVANCED_FIELDS = [
  'switches_on',
  'matchup_minutes',
  'estimated_usage_percentage',
  'estimated_offensive_rating',
  'estimated_defensive_rating',
  'estimated_net_rating',
  'estimated_pace',
] as const;

export type AdvancedArchiveJson = Record<string, unknown>;

export type PlayerGameAdvancedMetrics = {
  usage_percentage: number | null;
  true_shooting_percentage: number | null;
  effective_field_goal_percentage: number | null;
  offensive_rating: number | null;
  defensive_rating: number | null;
  net_rating: number | null;
  pace: number | null;
  possessions: number | null;
  assist_percentage: number | null;
  rebound_percentage: number | null;
  turnover_ratio: number | null;
  pie: number | null;
};

export type PlayerGameAdvancedCandidate = {
  gameId: string;
  playerId: string;
  season: string;
  archiveSeason: string;
  archiveTeamId: string | null;
  nestedGameSeason: string | null;
  period: number | null;
  metrics: PlayerGameAdvancedMetrics;
  source: string;
};

export type AdvancedGrainReport = {
  archiveRows: number;
  validLogicalRows: number;
  nullGameIds: number;
  nullPlayerIds: number;
  nonFullGamePeriod: number;
  duplicateKeys: number;
  duplicateKeySamples: string[];
};

export type AdvancedIdentityGame = {
  game_id: string;
  season: string;
};

export type AdvancedIdentityAudit = {
  mapped: number;
  unmappedGames: number;
  unmappedPlayers: number;
  seasonMismatch: number;
  nestedSeasonConflict: number;
  unmappedGameSamples: string[];
  unmappedPlayerSamples: string[];
  seasonMismatchSamples: string[];
  advancedOnlyValid: number;
};

export class DuplicateAdvancedKeyError extends Error {
  readonly keys: string[];
  constructor(keys: string[]) {
    super(`Duplicate Advanced grain keys (game_id|player_id): ${keys.slice(0, 8).join(', ')}`);
    this.name = 'DuplicateAdvancedKeyError';
    this.keys = keys;
  }
}

export class AdvancedIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdvancedIdentityError';
  }
}

type Json = AdvancedArchiveJson;

function sid(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'object') return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function nestedId(row: Json, key: string): string | null {
  const direct = sid(row[`${key}_id`]);
  if (direct) return direct;
  const nested = row[key];
  if (nested != null && typeof nested !== 'object') return sid(nested);
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return sid((nested as Json).id);
  }
  return null;
}

/** Preserve provider number/null. Never coerce missing to 0. Never rescale 0–1 vs 0–100. */
export function preserveAdvancedNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isSelectedAdvancedField(name: string): boolean {
  return (SELECTED_ADVANCED_FIELDS as readonly string[]).includes(name);
}

export function isExcludedAdvancedField(name: string): boolean {
  if ((EXCLUDED_ADVANCED_FIELDS as readonly string[]).includes(name)) return true;
  return name.startsWith('matchup_');
}

export function advancedStatsV2Prefix(season: number, rawPrefix = process.env.NBA_RAW_PREFIX ?? 'raw'): string {
  const raw = rawPrefix.replace(/^\/+|\/+$/g, '') || 'raw';
  return `${raw}/source=balldontlie/league=nba/season=${season}/entity=${ADVANCED_STATS_V2_ENTITY}`;
}

export function isAdvancedArchivePageKey(key: string): boolean {
  if (!key.endsWith('.json')) return false;
  if (key.includes('_manifest') || key.includes('_run') || key.includes('_characterization')) {
    return false;
  }
  return key.includes('page=');
}

export function extractAdvancedArchiveRows(body: unknown): Json[] {
  if (!body) return [];
  if (Array.isArray(body)) return body as Json[];
  if (typeof body !== 'object') return [];
  const obj = body as Json;
  if (Array.isArray(obj.data)) return obj.data as Json[];
  if (Array.isArray(obj.pages)) {
    const rows: Json[] = [];
    for (const page of obj.pages as unknown[]) {
      if (Array.isArray(page)) rows.push(...(page as Json[]));
      else if (page && typeof page === 'object' && Array.isArray((page as Json).data)) {
        rows.push(...((page as Json).data as Json[]));
      }
    }
    return rows;
  }
  return [];
}

export function parseAdvancedIdentity(row: Json): {
  gameId: string | null;
  playerId: string | null;
  archiveTeamId: string | null;
  playerListedTeamId: string | null;
  nestedGameSeason: string | null;
  period: number | null;
} {
  const gameId = nestedId(row, 'game');
  const playerId = nestedId(row, 'player');
  const archiveTeamId = nestedId(row, 'team');
  const player = row.player && typeof row.player === 'object' ? (row.player as Json) : null;
  const playerListedTeamId = player ? sid(player.team_id) : null;
  const game = row.game && typeof row.game === 'object' ? (row.game as Json) : null;
  const nestedGameSeason = game ? sid(game.season) : sid(row.season);
  const period = preserveAdvancedNumber(row.period);
  return { gameId, playerId, archiveTeamId, playerListedTeamId, nestedGameSeason, period };
}

export function extractSelectedMetrics(row: Json): PlayerGameAdvancedMetrics {
  return {
    usage_percentage: preserveAdvancedNumber(row.usage_percentage),
    true_shooting_percentage: preserveAdvancedNumber(row.true_shooting_percentage),
    effective_field_goal_percentage: preserveAdvancedNumber(row.effective_field_goal_percentage),
    offensive_rating: preserveAdvancedNumber(row.offensive_rating),
    defensive_rating: preserveAdvancedNumber(row.defensive_rating),
    net_rating: preserveAdvancedNumber(row.net_rating),
    pace: preserveAdvancedNumber(row.pace),
    possessions: preserveAdvancedNumber(row.possessions),
    assist_percentage: preserveAdvancedNumber(row.assist_percentage),
    rebound_percentage: preserveAdvancedNumber(row.rebound_percentage),
    turnover_ratio: preserveAdvancedNumber(row.turnover_ratio),
    pie: preserveAdvancedNumber(row.pie),
  };
}

export function candidateKey(gameId: string, playerId: string): string {
  return `${gameId}|${playerId}`;
}

export function emptyGrainReport(): AdvancedGrainReport {
  return {
    archiveRows: 0,
    validLogicalRows: 0,
    nullGameIds: 0,
    nullPlayerIds: 0,
    nonFullGamePeriod: 0,
    duplicateKeys: 0,
    duplicateKeySamples: [],
  };
}

/**
 * Map one archive row to a candidate. Returns null when identity/period is invalid.
 * Duplicate detection is the caller's grain map — this function does not pick first/last.
 */
export function transformAdvancedArchiveRow(
  row: Json,
  archiveSeason: string
):
  | { ok: true; candidate: PlayerGameAdvancedCandidate }
  | {
      ok: false;
      reason: 'null_game' | 'null_player' | 'non_full_game_period' | 'unsupported_season';
    } {
  if (!PLAYER_GAME_ADVANCED_SEASONS.includes(archiveSeason as (typeof PLAYER_GAME_ADVANCED_SEASONS)[number])) {
    return { ok: false, reason: 'unsupported_season' };
  }
  const ids = parseAdvancedIdentity(row);
  if (!ids.gameId) return { ok: false, reason: 'null_game' };
  if (!ids.playerId) return { ok: false, reason: 'null_player' };
  if (ids.period != null && ids.period !== 0) {
    return { ok: false, reason: 'non_full_game_period' };
  }
  return {
    ok: true,
    candidate: {
      gameId: ids.gameId,
      playerId: ids.playerId,
      season: archiveSeason,
      archiveSeason,
      archiveTeamId: ids.archiveTeamId,
      nestedGameSeason: ids.nestedGameSeason,
      period: ids.period,
      metrics: extractSelectedMetrics(row),
      source: PLAYER_GAME_ADVANCED_SOURCE,
    },
  };
}

export function ingestArchiveRowIntoGrain(args: {
  row: Json;
  archiveSeason: string;
  byKey: Map<string, PlayerGameAdvancedCandidate>;
  grain: AdvancedGrainReport;
}): void {
  args.grain.archiveRows += 1;
  const result = transformAdvancedArchiveRow(args.row, args.archiveSeason);
  if (!result.ok) {
    if (result.reason === 'null_game') args.grain.nullGameIds += 1;
    if (result.reason === 'null_player') args.grain.nullPlayerIds += 1;
    if (result.reason === 'non_full_game_period') args.grain.nonFullGamePeriod += 1;
    return;
  }
  const key = candidateKey(result.candidate.gameId, result.candidate.playerId);
  if (args.byKey.has(key)) {
    args.grain.duplicateKeys += 1;
    if (args.grain.duplicateKeySamples.length < 12) {
      args.grain.duplicateKeySamples.push(key);
    }
    return;
  }
  args.byKey.set(key, result.candidate);
  args.grain.validLogicalRows += 1;
}

export function assertAdvancedGrainOrThrow(grain: AdvancedGrainReport): void {
  if (grain.duplicateKeys > 0) {
    throw new DuplicateAdvancedKeyError(grain.duplicateKeySamples);
  }
}

export function auditAdvancedIdentity(args: {
  candidates: PlayerGameAdvancedCandidate[];
  gamesById: Map<string, AdvancedIdentityGame>;
  playerIds: Set<string>;
  pglKeys?: Set<string>;
}): { candidates: PlayerGameAdvancedCandidate[]; audit: AdvancedIdentityAudit } {
  const audit: AdvancedIdentityAudit = {
    mapped: 0,
    unmappedGames: 0,
    unmappedPlayers: 0,
    seasonMismatch: 0,
    nestedSeasonConflict: 0,
    unmappedGameSamples: [],
    unmappedPlayerSamples: [],
    seasonMismatchSamples: [],
    advancedOnlyValid: 0,
  };
  const mapped: PlayerGameAdvancedCandidate[] = [];
  for (const row of args.candidates) {
    const game = args.gamesById.get(row.gameId);
    const playerOk = args.playerIds.has(row.playerId);
    if (!game) {
      audit.unmappedGames += 1;
      if (audit.unmappedGameSamples.length < 12) {
        audit.unmappedGameSamples.push(candidateKey(row.gameId, row.playerId));
      }
      continue;
    }
    if (!playerOk) {
      audit.unmappedPlayers += 1;
      if (audit.unmappedPlayerSamples.length < 12) {
        audit.unmappedPlayerSamples.push(candidateKey(row.gameId, row.playerId));
      }
      continue;
    }
    if (String(game.season) !== row.archiveSeason) {
      audit.seasonMismatch += 1;
      if (audit.seasonMismatchSamples.length < 12) {
        audit.seasonMismatchSamples.push(
          `${candidateKey(row.gameId, row.playerId)} archive=${row.archiveSeason} game=${game.season}`
        );
      }
      continue;
    }
    if (row.nestedGameSeason != null && row.nestedGameSeason !== row.archiveSeason) {
      audit.nestedSeasonConflict += 1;
    }
    const next = { ...row, season: String(game.season) };
    mapped.push(next);
    audit.mapped += 1;
    if (args.pglKeys && !args.pglKeys.has(candidateKey(row.gameId, row.playerId))) {
      audit.advancedOnlyValid += 1;
    }
  }
  return { candidates: mapped, audit };
}

export function assertIdentityOrThrow(audit: AdvancedIdentityAudit): void {
  if (audit.unmappedGames > 0 || audit.unmappedPlayers > 0 || audit.seasonMismatch > 0) {
    throw new AdvancedIdentityError(
      `Advanced identity failed: unmappedGames=${audit.unmappedGames} unmappedPlayers=${audit.unmappedPlayers} seasonMismatch=${audit.seasonMismatch}`
    );
  }
}

export function toApiAdvanced(metrics: PlayerGameAdvancedMetrics): HistoricalPlayerAdvanced {
  return {
    usagePercentage: metrics.usage_percentage,
    trueShootingPercentage: metrics.true_shooting_percentage,
    effectiveFieldGoalPercentage: metrics.effective_field_goal_percentage,
    offensiveRating: metrics.offensive_rating,
    defensiveRating: metrics.defensive_rating,
    netRating: metrics.net_rating,
    pace: metrics.pace,
    possessions: metrics.possessions,
    assistPercentage: metrics.assist_percentage,
    reboundPercentage: metrics.rebound_percentage,
    turnoverRatio: metrics.turnover_ratio,
    pie: metrics.pie,
  };
}

export const ADVANCED_METRIC_SEMANTICS = {
  usage_percentage: {
    api: 'usagePercentage',
    meaning: 'Share of team possessions/plays used by the player, as defined by the provider',
    scale: '0–1 fraction (0.14 = 14%). Certified archive representation.',
    nullBehavior: 'Preserve null. Do not substitute estimated_usage_percentage.',
  },
  true_shooting_percentage: {
    api: 'trueShootingPercentage',
    meaning: 'Scoring efficiency including 2s, 3s, and free throws',
    scale: 'Typically a 0–1 fraction; can exceed 1.0 on tiny 3-point samples. Do not clamp.',
    nullBehavior: 'Preserve null. Do not invent from the box score.',
  },
  effective_field_goal_percentage: {
    api: 'effectiveFieldGoalPercentage',
    meaning: 'FG% adjusted for three-point value',
    scale: 'Typically a 0–1 fraction; can exceed 1.0 on tiny 3-point samples. Do not clamp.',
    nullBehavior: 'Preserve null.',
  },
  offensive_rating: {
    api: 'offensiveRating',
    meaning: 'Provider estimated points produced per 100 possessions',
    scale: 'Points per 100 possessions (e.g. 111.9)',
    nullBehavior: 'Preserve null. Do not clamp extremes.',
  },
  defensive_rating: {
    api: 'defensiveRating',
    meaning: 'Provider estimated points allowed per 100 possessions',
    scale: 'Points per 100 possessions',
    nullBehavior: 'Preserve null. Do not clamp extremes.',
  },
  net_rating: {
    api: 'netRating',
    meaning: 'Provider estimated point differential per 100 possessions',
    scale: 'Points per 100 possessions (can be negative)',
    nullBehavior: 'Preserve null. Do not clamp extremes.',
  },
  pace: {
    api: 'pace',
    meaning: 'Provider pace estimate for the player-game sample',
    scale: 'Possessions per 48 minutes (sample 91.22)',
    nullBehavior: 'Preserve null. Low-possession samples can look extreme.',
  },
  possessions: {
    api: 'possessions',
    meaning: 'Player Advanced possessions in this game (sample size)',
    scale: 'Count; integer-valued in sampled archive, stored as float to preserve provider number',
    nullBehavior: 'Preserve null.',
  },
  assist_percentage: {
    api: 'assistPercentage',
    meaning: 'Share of teammate field goals assisted while the player was on the floor, as defined by the provider',
    scale: '0–1 fraction',
    nullBehavior: 'Preserve null.',
  },
  rebound_percentage: {
    api: 'reboundPercentage',
    meaning: 'Share of available rebounds gathered, as defined by the provider',
    scale: '0–1 fraction',
    nullBehavior: 'Preserve null.',
  },
  turnover_ratio: {
    api: 'turnoverRatio',
    meaning: 'Provider turnover ratio (not a derived TOV%)',
    scale: 'Provider ratio, not 0–1 (sample 5.3)',
    nullBehavior: 'Preserve null. Do not compute a fake percentage.',
  },
  pie: {
    api: 'pie',
    meaning: 'Player Impact Estimate — one-number contribution share',
    scale: 'Typically a 0–1 fraction (0.015 = 1.5%); extremes outside 0–1 exist on tiny samples. Do not clamp.',
    nullBehavior: 'Preserve null.',
  },
} as const;
