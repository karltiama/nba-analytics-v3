/**
 * Advanced Stats V2 archive plan. Endpoint is documented; this job must not
 * be executed until GOAT is authorized.
 *
 * GET /nba/v2/stats/advanced?seasons[]=<S>&period=0
 */

import {
  assertTrialArchiveSeason,
  parseExecuteFlag,
  parseSeasonFlag,
  rawEntityPrefix,
  type TrialArchivePlan,
} from './trial-archive-plan';

export const ADVANCED_STATS_V2_PATH = '/nba/v2/stats/advanced';
export const ADVANCED_STATS_V2_ENTITY = 'advanced_stats_v2';

export function planAdvancedStatsV2Archive(argv: string[]): TrialArchivePlan {
  const { dryRun } = parseExecuteFlag(argv);
  const season = parseSeasonFlag(argv);
  assertTrialArchiveSeason(season, 'advanced_stats_v2');
  const prefix = rawEntityPrefix(process.env.NBA_RAW_PREFIX ?? 'raw', season, ADVANCED_STATS_V2_ENTITY);
  return {
    kind: 'advanced_stats_v2',
    dryRun,
    season,
    endpoint: `${ADVANCED_STATS_V2_PATH}?seasons[]=${season}&period=0`,
    s3Prefix: prefix,
    pagination: 'cursor (per_page=100)',
    skipExisting: true,
    postgresMaterialize: false,
    estimatedRequests: null,
    notes: [
      'Full-game rows only (period=0).',
      'Resumable skip-existing S3 pages + _manifest.json.',
      'No analytics/Postgres advanced-stats table in this job.',
      'Requires BDL_TRIAL_MODE=1 and acquisition lock on --execute.',
    ],
  };
}
