/**
 * Historical Option B serving seasons. 2022 stays S3-archive-only.
 * Arbitrary historical materialization is rejected.
 */

export const HISTORICAL_SERVING_SEASONS = [2024, 2023] as const;
export type HistoricalServingSeason = (typeof HISTORICAL_SERVING_SEASONS)[number];

export const HISTORICAL_ARCHIVE_ONLY_SEASONS = [2022] as const;

export function isHistoricalServingSeason(season: number): season is HistoricalServingSeason {
  return (HISTORICAL_SERVING_SEASONS as readonly number[]).includes(season);
}

export function assertHistoricalServingSeason(season: number): asserts season is HistoricalServingSeason {
  if ((HISTORICAL_ARCHIVE_ONLY_SEASONS as readonly number[]).includes(season)) {
    throw new Error(
      `Season ${season} is S3-archive-only. Do not materialize 2022 into Postgres by default.`
    );
  }
  if (!isHistoricalServingSeason(season)) {
    throw new Error(
      `Historical serving materialization supports --season=2024 and --season=2023 only. Got ${season}.`
    );
  }
}

/** Seasons that must not land in raw.player_game_stats via seed-raw --stats. */
export const HISTORICAL_RAW_STATS_FORBIDDEN_SEASONS = [2024, 2023, 2022] as const;

export function isForbiddenHistoricalRawStatsSeason(season: number): boolean {
  return (HISTORICAL_RAW_STATS_FORBIDDEN_SEASONS as readonly number[]).includes(season);
}
