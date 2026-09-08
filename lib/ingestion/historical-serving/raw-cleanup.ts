/**
 * Safety planner for optional 2024 raw.player_game_stats staging cleanup.
 * Default WP7.2 path (Option B) never writes that table. If staging is used,
 * DELETE must be scoped to explicit 2024 game ids and must not touch 2025.
 */

export type RawCleanupPlan =
  | { ok: true; gameIds: string[]; candidateCount: number }
  | { ok: false; reason: string };

export function planRawPlayerGameStatsCleanup(args: {
  season: string;
  stagingGameIds: string[];
  protectedSeasonGameIds: string[];
}): RawCleanupPlan {
  if (args.season !== '2024') {
    return { ok: false, reason: `refusing cleanup for season=${args.season}; WP7.2 allows 2024 only` };
  }
  const protectedSet = new Set(args.protectedSeasonGameIds);
  const overlap = args.stagingGameIds.filter((id) => protectedSet.has(id));
  if (overlap.length > 0) {
    return {
      ok: false,
      reason: `staging game ids overlap protected 2025 corpus (${overlap.slice(0, 5).join(',')})`,
    };
  }
  if (args.stagingGameIds.length === 0) {
    return { ok: false, reason: 'no explicit 2024 staging game ids; refusing unscoped DELETE' };
  }
  return { ok: true, gameIds: [...new Set(args.stagingGameIds)], candidateCount: new Set(args.stagingGameIds).size };
}

export const RAW_PGS_CLEANUP_SQL = `
DELETE FROM raw.player_game_stats s
USING raw.games g
WHERE s.game_id = g.id
  AND g.season = $1
  AND s.game_id = ANY($2::int[])
`;
