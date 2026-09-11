/**
 * Certified serving-write SQL for postgame box + starters.
 * Does not create analytics.players. Grain matches nightly / 12C materializers.
 */

export const PLAYER_GAME_LOG_UPSERT_SQL = `
  insert into analytics.player_game_logs (
    game_id, player_id, team_id,
    minutes, points, rebounds, offensive_rebounds, defensive_rebounds,
    assists, steals, blocks, turnovers, personal_fouls,
    field_goals_made, field_goals_attempted,
    three_pointers_made, three_pointers_attempted,
    free_throws_made, free_throws_attempted,
    plus_minus,
    opponent_team_id, is_home, season, pra
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
  on conflict (game_id, player_id) do update set
    team_id = excluded.team_id,
    minutes = excluded.minutes,
    points = excluded.points,
    rebounds = excluded.rebounds,
    offensive_rebounds = excluded.offensive_rebounds,
    defensive_rebounds = excluded.defensive_rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    turnovers = excluded.turnovers,
    personal_fouls = excluded.personal_fouls,
    field_goals_made = excluded.field_goals_made,
    field_goals_attempted = excluded.field_goals_attempted,
    three_pointers_made = excluded.three_pointers_made,
    three_pointers_attempted = excluded.three_pointers_attempted,
    free_throws_made = excluded.free_throws_made,
    free_throws_attempted = excluded.free_throws_attempted,
    plus_minus = excluded.plus_minus,
    opponent_team_id = excluded.opponent_team_id,
    is_home = excluded.is_home,
    season = excluded.season,
    pra = excluded.pra,
    updated_at = now()
`;

/** Targeted-game replace. Season predicate protects 2023–2025 rows. */
export const GAME_STARTERS_DELETE_FOR_GAME_SQL = `
  delete from analytics.game_starters
   where game_id = $1
     and season = $2
`;

export const GAME_STARTERS_UPSERT_SQL = `
  insert into analytics.game_starters (
    game_id, team_id, player_id, position, season, source
  )
  select * from unnest(
    $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]
  ) as t(game_id, team_id, player_id, position, season, source)
  on conflict on constraint game_starters_pk do update set
    position = excluded.position,
    season = excluded.season,
    source = excluded.source,
    updated_at = now()
  where analytics.game_starters.position is distinct from excluded.position
     or analytics.game_starters.season is distinct from excluded.season
     or analytics.game_starters.source is distinct from excluded.source
`;

export const LINEUPS_RAW_ARCHIVE_ENTITY = 'lineups';

export function lineupsRawArchiveKey(input: {
  rawPrefix?: string;
  season: string;
  gameId: string;
}): string {
  const raw = (input.rawPrefix ?? 'raw').replace(/^\/+|\/+$/g, '') || 'raw';
  return `${raw}/source=balldontlie/league=nba/season=${Number(input.season)}/entity=${LINEUPS_RAW_ARCHIVE_ENTITY}/game_id=${input.gameId}.json`;
}
