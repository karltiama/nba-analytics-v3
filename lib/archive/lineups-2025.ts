/**
 * Season 2025 lineups archive plan. Reuses lib/balldontlie/lineups.ts.
 * Raw S3 only. Do not fetch until GOAT is authorized.
 */

import { LINEUPS_PATH } from '@/lib/balldontlie/lineups';
import { parseExecuteFlag, rawEntityPrefix, type TrialArchivePlan } from './trial-archive-plan';

export const LINEUPS_2025_ENTITY = 'lineups';
export const LINEUPS_SEASON_GAMES_SQL = `
  select game_id
  from analytics.games
  where season = '2025'
  order by start_time, game_id
`;

export function planLineups2025Archive(gameIds: string[]): TrialArchivePlan {
  const prefix = rawEntityPrefix(process.env.NBA_RAW_PREFIX ?? 'raw', 2025, LINEUPS_2025_ENTITY);
  return {
    kind: 'lineups_2025',
    dryRun: true,
    season: 2025,
    endpoint: `${LINEUPS_PATH}?game_ids[]=<id>`,
    s3Prefix: prefix,
    pagination: 'one game_id per request via fetchLineupsFromBallDontLie',
    skipExisting: true,
    postgresMaterialize: false,
    estimatedRequests: gameIds.length,
    notes: [
      `Estimated request count from existing game inventory: ${gameIds.length}.`,
      'Raw archive only; no Postgres lineup table.',
      'Requires BDL_TRIAL_MODE=1 and acquisition lock on --execute.',
    ],
  };
}

export function planLineups2025ArchiveFromArgv(argv: string[], gameIds: string[]): TrialArchivePlan {
  const { dryRun } = parseExecuteFlag(argv);
  return { ...planLineups2025Archive(gameIds), dryRun };
}
