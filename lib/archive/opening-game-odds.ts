/**
 * Historical opening game odds archive plan.
 * GET /nba/v2/odds/opening
 * No serving-table replacement in this job.
 */

import {
  assertTrialArchiveSeason,
  parseExecuteFlag,
  parseSeasonFlag,
  rawEntityPrefix,
  type TrialArchivePlan,
} from './trial-archive-plan';

export const OPENING_GAME_ODDS_PATH = '/nba/v2/odds/opening';
export const OPENING_GAME_ODDS_ENTITY = 'opening_game_odds';

export function planOpeningGameOddsArchive(argv: string[]): TrialArchivePlan {
  const { dryRun } = parseExecuteFlag(argv);
  const season = parseSeasonFlag(argv, 2024);
  assertTrialArchiveSeason(season, 'opening_game_odds');
  const prefix = rawEntityPrefix(process.env.NBA_RAW_PREFIX ?? 'raw', season, OPENING_GAME_ODDS_ENTITY);
  return {
    kind: 'opening_game_odds',
    dryRun,
    season,
    endpoint: `${OPENING_GAME_ODDS_PATH}?game_ids[]=<queued>`,
    s3Prefix: prefix,
    pagination: 'cursor; game-scoped resume keys',
    skipExisting: true,
    postgresMaterialize: false,
    estimatedRequests: null,
    notes: [
      'Coverage report after fetch: game_id × vendor presence. No analytics.game_odds_* replacement yet.',
      'Requires BDL_TRIAL_MODE=1 and acquisition lock on --execute.',
    ],
  };
}
