/**
 * Stat-row write selector.
 * PGS_NORMALIZED_STORAGE=1 calls raw.upsert_player_game_stat, which requires
 * db/schemas/MIGRATION_player_game_stats_documents.sql. The default stays the
 * legacy insert so a deploy before Stage B still matches the live table.
 * This flag does not bypass DATA_MODE, OFFSEASON_MODE, CRON_DRY_RUN, or the
 * current-season boundary.
 */

export const LEGACY_UPSERT_PLAYER_GAME_STAT_SQL = `
  insert into raw.player_game_stats (
    id, min, fgm, fga, fg_pct, fg3m, fg3a, fg3_pct, ftm, fta, ft_pct,
    oreb, dreb, reb, ast, stl, blk, turnover, pf, pts, plus_minus,
    player_id, team_id, game_id, player, team, game
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25::jsonb, $26::jsonb, $27::jsonb)
  on conflict (id) do update set
    min = excluded.min, fgm = excluded.fgm, fga = excluded.fga, fg_pct = excluded.fg_pct,
    fg3m = excluded.fg3m, fg3a = excluded.fg3a, fg3_pct = excluded.fg3_pct,
    ftm = excluded.ftm, fta = excluded.fta, ft_pct = excluded.ft_pct,
    oreb = excluded.oreb, dreb = excluded.dreb, reb = excluded.reb,
    ast = excluded.ast, stl = excluded.stl, blk = excluded.blk,
    turnover = excluded.turnover, pf = excluded.pf, pts = excluded.pts, plus_minus = excluded.plus_minus,
    player_id = excluded.player_id, team_id = excluded.team_id, game_id = excluded.game_id,
    player = excluded.player, team = excluded.team, game = excluded.game;
`;

export const NORMALIZED_UPSERT_PLAYER_GAME_STAT_SQL = `
  select raw.upsert_player_game_stat(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
    $25::jsonb, $26::jsonb, $27::jsonb
  );
`;

export function normalizedPlayerGameStatsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PGS_NORMALIZED_STORAGE === '1';
}

export function playerGameStatWriteSql(env: NodeJS.ProcessEnv = process.env): string {
  return normalizedPlayerGameStatsEnabled(env)
    ? NORMALIZED_UPSERT_PLAYER_GAME_STAT_SQL
    : LEGACY_UPSERT_PLAYER_GAME_STAT_SQL;
}

export const LEGACY_DELETE_PLAYER_GAME_STATS_BY_GAME_SQL =
  'delete from raw.player_game_stats where game_id = $1';

export const NORMALIZED_DELETE_PLAYER_GAME_STATS_BY_GAME_SQL =
  'delete from raw.player_game_stats_row where game_id = $1';

export function playerGameStatDeleteSql(env: NodeJS.ProcessEnv = process.env): string {
  return normalizedPlayerGameStatsEnabled(env)
    ? NORMALIZED_DELETE_PLAYER_GAME_STATS_BY_GAME_SQL
    : LEGACY_DELETE_PLAYER_GAME_STATS_BY_GAME_SQL;
}
