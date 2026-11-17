/**
 * Season boundary for raw.player_game_stats.
 * The live season is INGESTION_SEASON_START_YEAR. A calendar year is not a season.
 * Ordinary recovery refuses any other season. Historical recovery is a named contract,
 * not a fallback inside the current-season writer.
 */

export const HISTORICAL_RAW_STAT_RECOVERY_AUTHORIZATION = 'historical-raw-stat-recovery';

export class RawStatSeasonBoundaryError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'season_missing'
      | 'season_not_current'
      | 'game_not_in_serving_set'
      | 'historical_not_authorized'
      | 'historical_targets_live_season'
      | 'season_disagrees'
  ) {
    super(message);
    this.name = 'RawStatSeasonBoundaryError';
  }
}

/** Four-digit season start year. A date string is not a season. */
export function canonicalSeasonStartYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1946 && value <= 2100) return value;
  if (typeof value === 'string' && /^\d{4}$/.test(value.trim())) {
    const year = Number(value.trim());
    if (year >= 1946 && year <= 2100) return year;
  }
  return null;
}

export function assertCurrentSeasonRawStat(input: {
  liveSeasonStartYear: number;
  gameSeason: unknown;
  gameId: number;
}): void {
  const season = canonicalSeasonStartYear(input.gameSeason);
  if (season == null || !Number.isSafeInteger(input.gameId) || input.gameId <= 0) {
    throw new RawStatSeasonBoundaryError(
      `Game ${input.gameId} has no canonical season start year`,
      'season_missing'
    );
  }
  if (season !== input.liveSeasonStartYear) {
    throw new RawStatSeasonBoundaryError(
      `Game ${input.gameId} is season ${season}; current recovery accepts only ${input.liveSeasonStartYear}`,
      'season_not_current'
    );
  }
}

export function assertCurrentSeasonStatBatch(input: {
  liveSeasonStartYear: number;
  games: readonly { id?: unknown; season?: unknown }[];
  stats: readonly { game?: { id?: unknown; season?: unknown } | null }[];
}): void {
  const allowed = new Map<number, unknown>();
  for (const game of input.games) {
    const gameId = typeof game.id === 'number' ? game.id : Number(game.id);
    assertCurrentSeasonRawStat({
      liveSeasonStartYear: input.liveSeasonStartYear,
      gameSeason: game.season,
      gameId,
    });
    allowed.set(gameId, game.season);
  }
  for (const stat of input.stats) {
    const gameId = typeof stat.game?.id === 'number' ? stat.game.id : Number(stat.game?.id);
    if (!allowed.has(gameId)) {
      throw new RawStatSeasonBoundaryError(
        `Game ${gameId} is not in the current-season serving set`,
        'game_not_in_serving_set'
      );
    }
    assertCurrentSeasonRawStat({
      liveSeasonStartYear: input.liveSeasonStartYear,
      gameSeason: stat.game?.season ?? allowed.get(gameId),
      gameId,
    });
  }
}

/**
 * Explicit historical contract. It does not write SQL and it does not accept the live season.
 * Callers must pass the authorization string. A missing string is a refusal.
 */
export function planHistoricalRawStatRecovery(input: {
  liveSeasonStartYear: number;
  targetSeasonStartYear: number;
  gameSeason: unknown;
  gameId: number;
  authorization: string | null;
}): { seasonStartYear: number; gameId: number; writesCurrentSeasonRaw: false } {
  if (input.authorization !== HISTORICAL_RAW_STAT_RECOVERY_AUTHORIZATION) {
    throw new RawStatSeasonBoundaryError(
      'Historical raw-stat recovery requires an explicit authorization',
      'historical_not_authorized'
    );
  }
  const season = canonicalSeasonStartYear(input.gameSeason);
  const target = canonicalSeasonStartYear(input.targetSeasonStartYear);
  if (season == null || target == null || season !== target || !Number.isSafeInteger(input.gameId) || input.gameId <= 0) {
    throw new RawStatSeasonBoundaryError(
      `Game ${input.gameId} does not match the authorized historical season`,
      'season_disagrees'
    );
  }
  if (season === input.liveSeasonStartYear) {
    throw new RawStatSeasonBoundaryError(
      `Season ${season} is the live ingestion season and cannot use the historical contract`,
      'historical_targets_live_season'
    );
  }
  return { seasonStartYear: season, gameId: input.gameId, writesCurrentSeasonRaw: false };
}
