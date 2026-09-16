/**
 * Read-only catalog loader for XRay canonical resolution.
 * Does not select scores, box stats, or outcomes.
 */
import type { XrayGameRecord, XrayPlayerRecord, XrayResolutionCatalog, XrayTeamRecord } from './types';

export type ResolutionQuery = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export const LOAD_PLAYERS_SQL = `
  SELECT p.player_id::text AS player_id,
         p.player_entity_id::text AS entity_id,
         p.full_name,
         p.first_name,
         p.last_name,
         nba.provider_player_id AS nba_player_id
  FROM analytics.players p
  LEFT JOIN analytics.player_provider_ids nba
    ON nba.player_entity_id = p.player_entity_id
   AND nba.provider = 'nba'
`;

export const LOAD_TEAMS_SQL = `
  SELECT team_id::text AS team_id,
         abbreviation,
         full_name
  FROM analytics.teams
`;

export const LOAD_GAMES_SQL = `
  SELECT g.game_id::text AS game_id,
         g.start_time::text AS start_time,
         ht.abbreviation AS home_team_abbr,
         at.abbreviation AS away_team_abbr
  FROM analytics.games g
  JOIN analytics.teams ht ON ht.team_id = g.home_team_id
  JOIN analytics.teams at ON at.team_id = g.away_team_id
`;

export function assertResolutionSqlIsOutcomeFree(sql: string): void {
  const lowered = sql.toLowerCase();
  if (lowered.includes('home_score') || lowered.includes('away_score')) {
    throw new Error('Resolution SQL must not select game scores');
  }
  if (lowered.includes('player_game_logs') || lowered.includes('box')) {
    throw new Error('Resolution SQL must not read box scores');
  }
}

export async function loadXrayResolutionCatalog(query: ResolutionQuery): Promise<XrayResolutionCatalog> {
  assertResolutionSqlIsOutcomeFree(LOAD_PLAYERS_SQL);
  assertResolutionSqlIsOutcomeFree(LOAD_TEAMS_SQL);
  assertResolutionSqlIsOutcomeFree(LOAD_GAMES_SQL);

  const [playerRows, teamRows, gameRows] = await Promise.all([
    query<{
      player_id: string;
      entity_id: string | null;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      nba_player_id: string | null;
    }>(LOAD_PLAYERS_SQL),
    query<{ team_id: string; abbreviation: string; full_name: string }>(LOAD_TEAMS_SQL),
    query<{
      game_id: string;
      start_time: string;
      home_team_abbr: string;
      away_team_abbr: string;
    }>(LOAD_GAMES_SQL),
  ]);

  const players: XrayPlayerRecord[] = playerRows.map((row) => ({
    playerId: row.player_id,
    entityId: row.entity_id,
    displayName: row.full_name ?? `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    nbaPlayerId: row.nba_player_id,
  }));
  const teams: XrayTeamRecord[] = teamRows.map((row) => ({
    teamId: row.team_id,
    abbreviation: row.abbreviation,
    fullName: row.full_name,
  }));
  const games: XrayGameRecord[] = gameRows.map((row) => ({
    gameId: row.game_id,
    startTime: row.start_time,
    homeTeamAbbr: row.home_team_abbr,
    awayTeamAbbr: row.away_team_abbr,
  }));
  return { players, teams, games };
}
