/**
 * Fail-closed guard: historical trial seasons must not land in raw.player_game_stats
 * via seed-raw-balldontlie --stats. Direct operators to Option B serving backfill.
 */

import { isForbiddenHistoricalRawStatsSeason } from '@/lib/ingestion/historical-serving/supported-seasons';

export const HISTORICAL_RAW_STATS_REDIRECT =
  'Use backfill-historical-season-serving (Option B S3 → analytics). Do not write historical stats into raw.player_game_stats.';

export const ALLOW_HISTORICAL_RAW_STATS_FLAG = 'allow-historical-raw-stats';
export const ALLOW_HISTORICAL_RAW_STATS_ENV = 'ALLOW_HISTORICAL_RAW_STATS';

export type SeedRawCliArgs = {
  season: number;
  startDate: string;
  endDate: string;
  withStats: boolean;
  withSeasonAverages: boolean;
  allowHistoricalRawStats: boolean;
};

export function parseSeedRawArgs(argv: string[], now: Date = new Date()): SeedRawCliArgs {
  let season = now.getFullYear();
  const month = now.getMonth();
  if (month < 6) season -= 1;
  let startDate = `${season}-10-01`;
  let endDate = `${season + 1}-04-15`;
  let withStats = false;
  let withSeasonAverages = false;
  let allowHistoricalRawStats = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--season' && argv[i + 1]) {
      season = Number(argv[++i]);
      startDate = `${season}-10-01`;
      endDate = `${season + 1}-04-15`;
    } else if (a.startsWith('--season=')) {
      season = Number(a.slice('--season='.length));
      startDate = `${season}-10-01`;
      endDate = `${season + 1}-04-15`;
    } else if (a === '--start' && argv[i + 1]) startDate = argv[++i]!;
    else if (a === '--end' && argv[i + 1]) endDate = argv[++i]!;
    else if (a === '--stats') withStats = true;
    else if (a === '--season-averages') withSeasonAverages = true;
    else if (a === `--${ALLOW_HISTORICAL_RAW_STATS_FLAG}`) allowHistoricalRawStats = true;
  }
  return { season, startDate, endDate, withStats, withSeasonAverages, allowHistoricalRawStats };
}

export function assertLegacyRawStatsPathAllowed(
  args: Pick<SeedRawCliArgs, 'season' | 'withStats' | 'allowHistoricalRawStats'>,
  env: Record<string, string | undefined> = process.env
): void {
  if (!args.withStats) return;
  if (!isForbiddenHistoricalRawStatsSeason(args.season)) return;
  const envOverride = (env[ALLOW_HISTORICAL_RAW_STATS_ENV] ?? '').trim() === '1';
  if (args.allowHistoricalRawStats || envOverride) return;
  throw new Error(
    `Refusing seed-raw-balldontlie --stats for historical season ${args.season}. ${HISTORICAL_RAW_STATS_REDIRECT}`
  );
}
