/**
 * Shared dry-run/execute plan for GOAT trial S3 archive jobs.
 * Default is dry-run. --execute requires BDL_TRIAL_MODE=1 and the acquisition lock.
 */

export const TRIAL_ARCHIVE_SUPPORTED_SEASONS = [2024, 2023, 2025] as const;

export type TrialArchiveJobKind =
  | 'advanced_stats_v2'
  | 'opening_player_props'
  | 'opening_game_odds'
  | 'lineups_2025';

export type TrialArchivePlan = {
  kind: TrialArchiveJobKind;
  dryRun: boolean;
  season: number | null;
  endpoint: string;
  s3Prefix: string;
  pagination: string;
  skipExisting: true;
  postgresMaterialize: false;
  estimatedRequests: number | null;
  notes: string[];
};

export function parseExecuteFlag(argv: string[]): { dryRun: boolean; execute: boolean } {
  const execute = argv.includes('--execute');
  const dryRun = argv.includes('--dry-run') || !execute;
  return { dryRun, execute: execute && !dryRun };
}

export function parseSeasonFlag(argv: string[], fallback?: number): number {
  const eq = argv.find((a) => a.startsWith('--season='));
  if (eq) return Number(eq.slice('--season='.length));
  const i = argv.indexOf('--season');
  if (i >= 0 && argv[i + 1]) return Number(argv[i + 1]);
  if (fallback != null) return fallback;
  throw new Error('Missing --season=<YYYY>');
}

export function assertTrialArchiveSeason(season: number, kind: TrialArchiveJobKind): void {
  if (kind === 'lineups_2025' && season !== 2025) {
    throw new Error('Lineups archive is prepared for season 2025 game IDs only.');
  }
  if (!(TRIAL_ARCHIVE_SUPPORTED_SEASONS as readonly number[]).includes(season)) {
    throw new Error(`${kind} supports seasons 2024, 2023, 2025. Got ${season}.`);
  }
}

export function rawEntityPrefix(rawPrefix: string, season: number, entity: string): string {
  const raw = rawPrefix.replace(/^\/+|\/+$/g, '') || 'raw';
  return `${raw}/source=balldontlie/league=nba/season=${season}/entity=${entity}`;
}
