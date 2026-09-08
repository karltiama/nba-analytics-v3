/**
 * Season-scoped historical serving writes (Option B).
 * Never writes raw.player_game_stats. Never calls unscoped
 * transform-raw-to-analytics / compute-team-stats / compute-player-season-averages.
 */

import type { PoolClient } from 'pg';
import type { PlannedHistoricalStint } from '@/lib/roster/historical-stint-reconstruct';
import { assertGameSeasonIsolation, type TransformReport } from './bdl-to-serving';
import { PLAYER_SEASON_AVERAGES_SQL, TEAM_GAME_STATS_SEASON_PREDICATE } from './plan';
import { planCompletedSeasonStintsFromLogs } from './stints-from-logs';
import { assertHistoricalServingSeason } from './supported-seasons';

export const INFERRED_PGL_SOURCE = 'inferred_pgl';

export const UPSERT_SERVING_PLAYER_SQL = `
  insert into analytics.players (player_id, full_name, first_name, last_name, position, height, weight)
  values ($1, $2, $3, $4, $5, $6, $7)
  on conflict (player_id) do update set
    full_name = excluded.full_name,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    position = excluded.position,
    height = excluded.height,
    weight = excluded.weight,
    updated_at = now()
`;

/** Conflict update is a no-op unless the stored season matches the incoming season. */
export const UPSERT_SERVING_GAME_SQL = `
  insert into analytics.games (game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score)
  values ($1, $2, $3, $4, $5, $6, $7, $8)
  on conflict (game_id) do update set
    season = excluded.season,
    start_time = excluded.start_time,
    status = excluded.status,
    home_team_id = excluded.home_team_id,
    away_team_id = excluded.away_team_id,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    updated_at = now()
  where analytics.games.season = excluded.season
`;

export const UPSERT_SERVING_LOG_SQL = `
  insert into analytics.player_game_logs (
    game_id, player_id, team_id,
    minutes, points, rebounds, offensive_rebounds, defensive_rebounds,
    assists, steals, blocks, turnovers, personal_fouls,
    field_goals_made, field_goals_attempted,
    three_pointers_made, three_pointers_attempted,
    free_throws_made, free_throws_attempted,
    plus_minus,
    opponent_team_id, is_home, game_date, season, pra
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
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
    game_date = excluded.game_date,
    season = excluded.season,
    pra = excluded.pra,
    updated_at = now()
  where analytics.player_game_logs.season = excluded.season
`;

export const DELETE_TEAM_GAME_STATS_FOR_SEASON_SQL =
  `delete from analytics.team_game_stats where season = $1`;

export const DELETE_PLAYER_AVERAGES_FOR_SEASON_SQL =
  `delete from analytics.player_season_averages where season = $1`;

export const DELETE_TEAM_AVERAGES_FOR_SEASON_SQL =
  `delete from analytics.team_season_averages where season = $1`;

export const DELETE_INFERRED_STINTS_FOR_SEASON_SQL =
  `delete from analytics.player_team_stints where season = $1 and source = '${INFERRED_PGL_SOURCE}'`;

export const REBUILD_TEAM_GAME_STATS_FOR_SEASON_SQL = `
  insert into analytics.team_game_stats (
    team_id, game_id, season, game_date, opponent_team_id, is_home,
    team_points, team_rebounds, team_assists, team_steals, team_blocks, team_turnovers,
    team_fgm, team_fga, team_3pm, team_3pa, team_ftm, team_fta,
    points_allowed, result
  )
  select
    pgl.team_id,
    pgl.game_id,
    g.season,
    (g.start_time AT TIME ZONE 'America/New_York')::date as game_date,
    case when pgl.team_id = g.home_team_id then g.away_team_id else g.home_team_id end as opponent_team_id,
    (pgl.team_id = g.home_team_id) as is_home,
    coalesce(sum(pgl.points), 0)::int as team_points,
    coalesce(sum(pgl.rebounds), 0)::int as team_rebounds,
    coalesce(sum(pgl.assists), 0)::int as team_assists,
    coalesce(sum(pgl.steals), 0)::int as team_steals,
    coalesce(sum(pgl.blocks), 0)::int as team_blocks,
    coalesce(sum(pgl.turnovers), 0)::int as team_turnovers,
    coalesce(sum(pgl.field_goals_made), 0)::int as team_fgm,
    coalesce(sum(pgl.field_goals_attempted), 0)::int as team_fga,
    coalesce(sum(pgl.three_pointers_made), 0)::int as team_3pm,
    coalesce(sum(pgl.three_pointers_attempted), 0)::int as team_3pa,
    coalesce(sum(pgl.free_throws_made), 0)::int as team_ftm,
    coalesce(sum(pgl.free_throws_attempted), 0)::int as team_fta,
    case when pgl.team_id = g.home_team_id then g.away_score else g.home_score end as points_allowed,
    case
      when g.home_score is null or g.away_score is null then null
      when pgl.team_id = g.home_team_id and g.home_score > g.away_score then 'W'
      when pgl.team_id = g.away_team_id and g.away_score > g.home_score then 'W'
      when g.home_score = g.away_score then null
      else 'L'
    end as result
  from analytics.player_game_logs pgl
  join analytics.games g on g.game_id = pgl.game_id
  where ${TEAM_GAME_STATS_SEASON_PREDICATE}
  group by pgl.team_id, pgl.game_id, g.season, g.start_time,
           g.home_team_id, g.away_team_id, g.home_score, g.away_score
`;

export const REBUILD_PLAYER_AVERAGES_FOR_SEASON_SQL = `
  insert into analytics.player_season_averages (
    player_id, season, games_played,
    pts_avg, reb_avg, ast_avg, stl_avg, blk_avg, turnover_avg, pra_avg,
    fg_pct, fg3_pct, ft_pct
  )
  select
    src.player_id, src.season, src.games_played,
    src.pts_avg, src.reb_avg, src.ast_avg, src.stl_avg, src.blk_avg, src.turnover_avg, src.pra_avg,
    src.fg_pct, src.fg3_pct, src.ft_pct
  from (${PLAYER_SEASON_AVERAGES_SQL}) src
`;

export const REBUILD_TEAM_AVERAGES_FOR_SEASON_SQL = `
  insert into analytics.team_season_averages (
    team_id, season, games_played,
    avg_points, avg_rebounds, avg_assists, avg_steals, avg_blocks, avg_turnovers,
    avg_points_allowed, wins, losses, win_pct
  )
  select
    team_id,
    season,
    count(*)::int as games_played,
    avg(team_points) as avg_points,
    avg(team_rebounds) as avg_rebounds,
    avg(team_assists) as avg_assists,
    avg(team_steals) as avg_steals,
    avg(team_blocks) as avg_blocks,
    avg(team_turnovers) as avg_turnovers,
    avg(points_allowed) as avg_points_allowed,
    count(*) filter (where result = 'W')::int as wins,
    count(*) filter (where result = 'L')::int as losses,
    case
      when count(*) filter (where result in ('W','L')) > 0
      then count(*) filter (where result = 'W')::numeric / count(*) filter (where result in ('W','L'))
      else null
    end as win_pct
  from analytics.team_game_stats
  where season = $1
  group by team_id, season
`;

export const INSERT_INFERRED_STINT_SQL = `
  insert into analytics.player_team_stints (
    season, player_id, player_entity_id, team_id, observed_from, observed_to,
    source, source_player_id, jersey, position, membership_type
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;

export const LOAD_BDL_PLAYER_ENTITY_SQL = `
  select provider_player_id, player_entity_id::text as player_entity_id
  from analytics.player_provider_ids
  where provider = 'balldontlie' and provider_player_id = any($1::text[])
`;

export const LOAD_TEAM_CATALOG_SQL = `
  select team_id, abbreviation from analytics.teams
`;

export const LOAD_EXISTING_GAMES_SQL = `
  select game_id, season from analytics.games where game_id = any($1::text[])
`;

export const LOAD_SEASON_LOG_APPEARANCES_SQL = `
  select player_id, team_id, game_date::text as game_date, game_id
  from analytics.player_game_logs
  where season = $1
`;

const FORBIDDEN_UNSCOPED = [
  'where season is not null and season <> \'\'',
  'scripts/transform-raw-to-analytics.ts',
  'scripts/compute-team-stats.ts',
  'scripts/compute-player-season-averages.ts',
];

export function assertSeasonScopedWriterSql(sql: string): void {
  const lower = sql.toLowerCase();
  for (const bad of FORBIDDEN_UNSCOPED) {
    if (lower.includes(bad.toLowerCase())) {
      throw new Error(`Historical writer SQL must not use unscoped path: ${bad}`);
    }
  }
  if (lower.includes('raw.player_game_stats')) {
    throw new Error('Historical Option B must not touch raw.player_game_stats');
  }
}

export type MemoryGame = { game_id: string; season: string; status?: string | null; home_score?: number | null; away_score?: number | null };
export type MemoryLog = { game_id: string; player_id: string; team_id: string; season: string; game_date: string };
export type MemoryAverage = { player_id: string; season: string };
export type MemoryTeamStat = { team_id: string; game_id: string; season: string };
export type MemoryTeamAverage = { team_id: string; season: string };
export type MemoryStint = { player_id: string; team_id: string; season: string; source: string };

export type MemoryServingStore = {
  currentAnalyticsSeason: string;
  games: MemoryGame[];
  logs: MemoryLog[];
  playerAverages: MemoryAverage[];
  teamStats: MemoryTeamStat[];
  teamAverages: MemoryTeamAverage[];
  stints: MemoryStint[];
  schedule2026: MemoryGame[];
};

export function snapshotServingStore(store: MemoryServingStore): string {
  return JSON.stringify({
    currentAnalyticsSeason: store.currentAnalyticsSeason,
    games: store.games,
    logs: store.logs,
    playerAverages: store.playerAverages,
    teamStats: store.teamStats,
    teamAverages: store.teamAverages,
    stints: store.stints,
    schedule2026: store.schedule2026,
  });
}

/**
 * In-memory historical apply used to prove 2024/2023 writes cannot mutate
 * synthetic 2025 logs/averages/team stats/stints, 2026 schedule, or the pin.
 */
export function applyHistoricalServingToMemoryStore(
  store: MemoryServingStore,
  report: TransformReport
): { inferredStints: PlannedHistoricalStint[] } {
  const seasonNum = Number(report.season);
  assertHistoricalServingSeason(seasonNum);
  const pin = store.currentAnalyticsSeason;

  for (const g of report.games) {
    if (g.season !== report.season) {
      throw new Error(`Refusing game ${g.game_id} season ${g.season} during ${report.season} backfill`);
    }
    const existing = store.games.find((x) => x.game_id === g.game_id);
    const isolation = assertGameSeasonIsolation(existing, report.season);
    if (isolation) throw new Error(isolation.detail);
    if (!existing) {
      store.games.push({
        game_id: g.game_id,
        season: g.season,
        status: g.status,
        home_score: g.home_score,
        away_score: g.away_score,
      });
    } else if (existing.season === report.season) {
      existing.status = g.status;
      existing.home_score = g.home_score;
      existing.away_score = g.away_score;
    }
  }

  for (const log of report.logs) {
    if (log.season !== report.season) {
      throw new Error(`Refusing log ${log.game_id}/${log.player_id} season ${log.season}`);
    }
    const existing = store.logs.find((x) => x.game_id === log.game_id && x.player_id === log.player_id);
    if (existing && existing.season !== report.season) continue;
    if (!existing) {
      store.logs.push({
        game_id: log.game_id,
        player_id: log.player_id,
        team_id: log.team_id,
        season: log.season,
        game_date: log.game_date,
      });
    }
  }

  store.teamStats = store.teamStats.filter((r) => r.season !== report.season);
  for (const log of store.logs.filter((l) => l.season === report.season)) {
    const game = store.games.find((g) => g.game_id === log.game_id);
    if (!game) continue;
    if (!store.teamStats.some((t) => t.game_id === log.game_id && t.team_id === log.team_id && t.season === report.season)) {
      store.teamStats.push({ team_id: log.team_id, game_id: log.game_id, season: report.season });
    }
  }

  store.playerAverages = store.playerAverages.filter((r) => r.season !== report.season);
  const players = new Set(store.logs.filter((l) => l.season === report.season).map((l) => l.player_id));
  for (const player_id of players) {
    store.playerAverages.push({ player_id, season: report.season });
  }

  store.teamAverages = store.teamAverages.filter((r) => r.season !== report.season);
  const teams = new Set(store.teamStats.filter((t) => t.season === report.season).map((t) => t.team_id));
  for (const team_id of teams) {
    store.teamAverages.push({ team_id, season: report.season });
  }

  store.stints = store.stints.filter(
    (s) => !(s.season === report.season && s.source === INFERRED_PGL_SOURCE)
  );
  const appearances = store.logs
    .filter((l) => l.season === report.season)
    .map((l) => ({
      playerId: l.player_id,
      teamId: l.team_id,
      gameDate: l.game_date,
      gameId: l.game_id,
    }));
  const planned = planCompletedSeasonStintsFromLogs({
    season: report.season,
    appearances,
  });
  for (const s of planned.inferredStints) {
    store.stints.push({
      player_id: s.playerId,
      team_id: s.teamId,
      season: s.season,
      source: INFERRED_PGL_SOURCE,
    });
  }

  if (store.currentAnalyticsSeason !== pin) {
    throw new Error('Historical apply mutated CURRENT_ANALYTICS_SEASON pin');
  }
  return { inferredStints: planned.inferredStints };
}

const GAME_UPSERT_COLS = 8;
const LOG_UPSERT_COLS = 25;
const GAME_UPSERT_CHUNK = 100;
const LOG_UPSERT_CHUNK = 80;

function placeholders(rows: number, cols: number): string {
  return Array.from({ length: rows }, (_, row) => {
    const base = row * cols;
    return `(${Array.from({ length: cols }, (__, c) => `$${base + c + 1}`).join(',')})`;
  }).join(',');
}

async function upsertServingGames(
  client: PoolClient,
  games: TransformReport['games']
): Promise<void> {
  const conflict = `
    on conflict (game_id) do update set
      season = excluded.season,
      start_time = excluded.start_time,
      status = excluded.status,
      home_team_id = excluded.home_team_id,
      away_team_id = excluded.away_team_id,
      home_score = excluded.home_score,
      away_score = excluded.away_score,
      updated_at = now()
    where analytics.games.season = excluded.season
  `;
  for (let i = 0; i < games.length; i += GAME_UPSERT_CHUNK) {
    const chunk = games.slice(i, i + GAME_UPSERT_CHUNK);
    const params: unknown[] = [];
    for (const g of chunk) {
      params.push(
        g.game_id,
        g.season,
        g.start_time,
        g.status,
        g.home_team_id,
        g.away_team_id,
        g.home_score,
        g.away_score
      );
    }
    await client.query(
      `insert into analytics.games (game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score)
       values ${placeholders(chunk.length, GAME_UPSERT_COLS)} ${conflict}`,
      params
    );
  }
}

async function upsertServingLogs(client: PoolClient, logs: TransformReport['logs']): Promise<void> {
  const conflict = `
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
      game_date = excluded.game_date,
      season = excluded.season,
      pra = excluded.pra,
      updated_at = now()
    where analytics.player_game_logs.season = excluded.season
  `;
  for (let i = 0; i < logs.length; i += LOG_UPSERT_CHUNK) {
    const chunk = logs.slice(i, i + LOG_UPSERT_CHUNK);
    const params: unknown[] = [];
    for (const log of chunk) {
      params.push(
        log.game_id,
        log.player_id,
        log.team_id,
        log.minutes,
        log.points,
        log.rebounds,
        log.offensive_rebounds,
        log.defensive_rebounds,
        log.assists,
        log.steals,
        log.blocks,
        log.turnovers,
        log.personal_fouls,
        log.field_goals_made,
        log.field_goals_attempted,
        log.three_pointers_made,
        log.three_pointers_attempted,
        log.free_throws_made,
        log.free_throws_attempted,
        log.plus_minus,
        log.opponent_team_id,
        log.is_home,
        log.game_date,
        log.season,
        log.pra
      );
    }
    await client.query(
      `insert into analytics.player_game_logs (
        game_id, player_id, team_id,
        minutes, points, rebounds, offensive_rebounds, defensive_rebounds,
        assists, steals, blocks, turnovers, personal_fouls,
        field_goals_made, field_goals_attempted,
        three_pointers_made, three_pointers_attempted,
        free_throws_made, free_throws_attempted,
        plus_minus,
        opponent_team_id, is_home, game_date, season, pra
      ) values ${placeholders(chunk.length, LOG_UPSERT_COLS)} ${conflict}`,
      params
    );
  }
}

export async function applyHistoricalServingToPostgres(
  client: PoolClient,
  report: TransformReport
): Promise<{ inferredStints: number }> {
  const seasonNum = Number(report.season);
  assertHistoricalServingSeason(seasonNum);
  const season = report.season;

  assertSeasonScopedWriterSql(UPSERT_SERVING_GAME_SQL);
  assertSeasonScopedWriterSql(UPSERT_SERVING_LOG_SQL);
  assertSeasonScopedWriterSql(DELETE_TEAM_GAME_STATS_FOR_SEASON_SQL);
  assertSeasonScopedWriterSql(REBUILD_TEAM_GAME_STATS_FOR_SEASON_SQL);
  assertSeasonScopedWriterSql(DELETE_PLAYER_AVERAGES_FOR_SEASON_SQL);
  assertSeasonScopedWriterSql(REBUILD_PLAYER_AVERAGES_FOR_SEASON_SQL);
  assertSeasonScopedWriterSql(DELETE_TEAM_AVERAGES_FOR_SEASON_SQL);
  assertSeasonScopedWriterSql(REBUILD_TEAM_AVERAGES_FOR_SEASON_SQL);
  assertSeasonScopedWriterSql(DELETE_INFERRED_STINTS_FOR_SEASON_SQL);

  await client.query(`set local statement_timeout = '900s'`);
  await client.query(`set local idle_in_transaction_session_timeout = '900s'`);

  for (const p of report.players) {
    await client.query(UPSERT_SERVING_PLAYER_SQL, [
      p.player_id,
      p.full_name,
      p.first_name,
      p.last_name,
      p.position,
      p.height,
      p.weight,
    ]);
  }
  await upsertServingGames(client, report.games);
  await upsertServingLogs(client, report.logs);

  await client.query(DELETE_TEAM_GAME_STATS_FOR_SEASON_SQL, [season]);
  await client.query(REBUILD_TEAM_GAME_STATS_FOR_SEASON_SQL, [season]);
  await client.query(DELETE_PLAYER_AVERAGES_FOR_SEASON_SQL, [season]);
  await client.query(REBUILD_PLAYER_AVERAGES_FOR_SEASON_SQL, [season]);
  await client.query(DELETE_TEAM_AVERAGES_FOR_SEASON_SQL, [season]);
  await client.query(REBUILD_TEAM_AVERAGES_FOR_SEASON_SQL, [season]);
  await client.query(DELETE_INFERRED_STINTS_FOR_SEASON_SQL, [season]);

  const appearances = await client.query<{
    player_id: string;
    team_id: string;
    game_date: string;
    game_id: string;
  }>(LOAD_SEASON_LOG_APPEARANCES_SQL, [season]);
  const planned = planCompletedSeasonStintsFromLogs({
    season,
    appearances: appearances.rows.map((r) => ({
      playerId: r.player_id,
      teamId: r.team_id,
      gameDate: r.game_date,
      gameId: r.game_id,
    })),
  });
  const playerIds = [...new Set(planned.inferredStints.map((s) => s.playerId))];
  const ents = playerIds.length
    ? await client.query<{ provider_player_id: string; player_entity_id: string }>(
        LOAD_BDL_PLAYER_ENTITY_SQL,
        [playerIds]
      )
    : { rows: [] as Array<{ provider_player_id: string; player_entity_id: string }> };
  const entityByPlayer = new Map(ents.rows.map((r) => [r.provider_player_id, r.player_entity_id]));
  const missingEntity = playerIds.filter((id) => !entityByPlayer.has(id));
  if (missingEntity.length) {
    throw new Error(
      `Refusing inferred_pgl stints without player_entity_id (${missingEntity.length}): ${missingEntity.slice(0, 20).join(',')}`
    );
  }
  for (const s of planned.inferredStints) {
    await client.query(INSERT_INFERRED_STINT_SQL, [
      s.season,
      s.playerId,
      entityByPlayer.get(s.playerId),
      s.teamId,
      s.observedFrom,
      s.observedTo,
      INFERRED_PGL_SOURCE,
      null,
      null,
      null,
      null,
    ]);
  }
  return { inferredStints: planned.inferredStints.length };
}
