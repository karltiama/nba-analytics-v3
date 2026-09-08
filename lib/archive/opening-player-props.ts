/**
 * Historical opening player props archive plan.
 * GET /nba/v2/odds/player_props/opening?game_id=<id>
 * Do not use the live /odds/player_props endpoint for historical snapshots.
 */

import {
  parseExecuteFlag,
  rawEntityPrefix,
  type TrialArchivePlan,
} from './trial-archive-plan';

export const OPENING_PLAYER_PROPS_PATH = '/nba/v2/odds/player_props/opening';
export const OPENING_PLAYER_PROPS_ENTITY = 'opening_player_props';

export const DISTINCT_DECISION_LINE_GAMES_SQL = `
  select distinct game_id
  from research.prop_decision_lines
  where game_id is not null
  order by game_id
`;

export const MATCHABILITY_KEYS = ['game_id', 'player_id', 'vendor', 'prop_type'] as const;

export function planOpeningPlayerPropsArchive(args: {
  argv: string[];
  gameIds: string[];
}): TrialArchivePlan {
  const { dryRun } = parseExecuteFlag(args.argv);
  const season = 2025;
  const prefix = rawEntityPrefix(process.env.NBA_RAW_PREFIX ?? 'raw', season, OPENING_PLAYER_PROPS_ENTITY);
  return {
    kind: 'opening_player_props',
    dryRun,
    season,
    endpoint: `${OPENING_PLAYER_PROPS_PATH}?game_id=<queued>`,
    s3Prefix: prefix,
    pagination: 'game-scoped queue; honor meta.next_cursor when present',
    skipExisting: true,
    postgresMaterialize: false,
    estimatedRequests: args.gameIds.length,
    notes: [
      `Queue prioritized from research.prop_decision_lines (${args.gameIds.length} distinct game_id).`,
      'Later matchability report keys: game_id, player_id, vendor, prop_type.',
      'Do not call live /v2/odds/player_props for historical opening snapshots.',
      'Requires BDL_TRIAL_MODE=1 and acquisition lock on --execute.',
    ],
  };
}
