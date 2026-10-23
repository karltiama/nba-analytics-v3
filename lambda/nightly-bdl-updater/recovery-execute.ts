/**
 * One recovery invoke: plan, bounded fetch, validate, then one transaction.
 * Schedule sync is not called. A rejected box writes nothing.
 * Idempotent upserts update the same keys; they are not a rollback.
 */

import { validateGameBox, type StatLine, type ValidatedBox } from './box-completeness';
import {
  cappedRecoveryRetries,
  chargeAttempt,
  fetchRecoveryGames,
  fetchRecoveryStats,
  recoveryInvocationHttpCeiling,
  recoveryRateLimitRetries,
  type AttemptBudget,
} from './recovery-fetch';
import { planRecovery, recoveryAttemptBudget, type RecoveryPlan } from './recovery-plan';
import { expectedFinalMismatch, selectRecoveryGames, type GameRejection, type ProviderGame } from './recovery-select';
import { etDateOfProviderGame, regularSeasonOpenEt } from './season-eligibility';

export class RecoveryWriteError extends Error {
  constructor(
    message: string,
    readonly reason: string
  ) {
    super(message);
    this.name = 'RecoveryWriteError';
  }
}

export type QueryClient = {
  query: (sql: string, values?: readonly unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  release: (err?: Error) => void;
};

export type RecoveryUpserts = {
  rawGame: string;
  rawStat: string;
  analyticsGame: string;
  analyticsLog: string;
  teamGame: string;
  teamSeason: string;
  playerSeason: string;
};

const UPSERT_RAW_PLAYER = `
  insert into raw.players (
    id, first_name, last_name, position, height, weight, jersey_number, college, country,
    draft_year, draft_round, draft_number, team_id
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  on conflict (id) do nothing`;

const UPSERT_ANALYTICS_PLAYER = `
  insert into analytics.players (player_id, full_name, first_name, last_name, position, height, weight)
  values ($1, $2, $3, $4, $5, $6, $7)
  on conflict (player_id) do nothing`;

export type RecoveryExecution = {
  recovery: true;
  recoveryStatus: 'committed' | 'rejected';
  skippedProviderCalls: false;
  scheduleGamesSynced: 0;
  scheduleSyncSkipped: true;
  seasonStartYear: 2026;
  startDate: string;
  endDate: string;
  allowlist: number[];
  ignoredGameIds: number[];
  rejected: GameRejection[];
  committedGameIds: number[];
  requestsAttempted: number;
  logicalAttempts: number;
  /** Observed HTTP sends. Not the count of logical page requests. */
  httpAttempts: number;
  /** Abort ceiling for this invoke. Strict canary mode lowers it to at most 48. */
  httpAttemptUpperBound: number;
  gamesPages: number;
  statsPages: number;
  seasonTypes: string[];
  statsUpserted: number;
  analyticsLogs: number;
  teamGameStats: number;
  teamSeasonAvgs: number;
  playerSeasonAvgs: number;
  writesCommitted: boolean;
};

const TEAM_SEASON_SQL = `
  select
    team_id, season, count(*)::int as games_played,
    avg(team_points) as avg_points, avg(team_rebounds) as avg_rebounds,
    avg(team_assists) as avg_assists, avg(team_steals) as avg_steals,
    avg(team_blocks) as avg_blocks, avg(team_turnovers) as avg_turnovers,
    avg(team_fgm) as avg_fgm, avg(team_fga) as avg_fga,
    avg(team_3pm) as avg_3pm, avg(team_3pa) as avg_3pa,
    avg(team_ftm) as avg_ftm, avg(team_fta) as avg_fta,
    avg(points_allowed) as avg_points_allowed,
    count(*) filter (where result = 'W')::int as wins,
    count(*) filter (where result = 'L')::int as losses,
    count(*) filter (where is_home and result = 'W')::int as home_wins,
    count(*) filter (where is_home and result = 'L')::int as home_losses,
    count(*) filter (where not is_home and result = 'W')::int as away_wins,
    count(*) filter (where not is_home and result = 'L')::int as away_losses,
    case
      when count(*) filter (where result in ('W','L')) > 0
      then count(*) filter (where result = 'W')::numeric / count(*) filter (where result in ('W','L'))
      else null
    end as win_pct,
    avg(offensive_rating) as avg_offensive_rating,
    avg(defensive_rating) as avg_defensive_rating,
    avg(pace) as avg_pace,
    avg(efg_pct) as avg_efg_pct,
    avg(tov_pct) as avg_tov_pct,
    avg(orb_pct) as avg_orb_pct
  from analytics.team_game_stats t
  where t.season = $1
    and t.team_id = any($2::text[])
    and t.game_date >= $3::date
  group by team_id, season`;

const PLAYER_SEASON_SQL = `
  select
    player_id, season,
    count(*)::int as games_played,
    avg(points) as pts_avg,
    avg(rebounds) as reb_avg,
    avg(assists) as ast_avg,
    avg(steals) as stl_avg,
    avg(blocks) as blk_avg,
    avg(turnovers) as turnover_avg,
    avg(pra) as pra_avg,
    case when sum(field_goals_attempted) > 0 then sum(field_goals_made)::numeric / sum(field_goals_attempted) else null end as fg_pct,
    case when sum(three_pointers_attempted) > 0 then sum(three_pointers_made)::numeric / sum(three_pointers_attempted) else null end as fg3_pct,
    case when sum(free_throws_attempted) > 0 then sum(free_throws_made)::numeric / sum(free_throws_attempted) else null end as ft_pct
  from analytics.player_game_logs l
  where l.season = $1
    and l.player_id = any($2::text[])
    and l.game_date >= $3::date
  group by player_id, season`;

function mapTeamId(rawId: number, mapping: Map<number, number>): string {
  return String(mapping.get(rawId) ?? rawId);
}

function baseResult(plan: RecoveryPlan): RecoveryExecution {
  return {
    recovery: true,
    recoveryStatus: 'rejected',
    skippedProviderCalls: false,
    scheduleGamesSynced: 0,
    scheduleSyncSkipped: true,
    seasonStartYear: plan.seasonStartYear,
    startDate: plan.startDate,
    endDate: plan.endDate,
    allowlist: plan.gameIds,
    ignoredGameIds: [],
    rejected: [],
    committedGameIds: [],
    requestsAttempted: 0,
    logicalAttempts: 0,
    httpAttempts: 0,
    httpAttemptUpperBound: 0,
    gamesPages: 0,
    statsPages: 0,
    seasonTypes: [],
    statsUpserted: 0,
    analyticsLogs: 0,
    teamGameStats: 0,
    teamSeasonAvgs: 0,
    playerSeasonAvgs: 0,
    writesCommitted: false,
  };
}

export const RECOVERY_GAME_LOCK_SQL = 'select pg_advisory_xact_lock($1::bigint)';

async function writeBoxes(
  client: QueryClient,
  boxes: ValidatedBox[],
  upserts: RecoveryUpserts,
  openDate: string
): Promise<{ stats: number; logs: number; teamRows: number; teamSeason: number; playerSeason: number }> {
  const teamRes = await client.query('select id, abbreviation from raw.teams');
  const byAbbrev = new Map<string, number>();
  for (const row of teamRes.rows) {
    const abbreviation = String(row.abbreviation ?? '').trim().toUpperCase();
    const id = Number(row.id);
    if (!abbreviation || !Number.isSafeInteger(id)) continue;
    const existing = byAbbrev.get(abbreviation);
    if (existing == null || id < existing) byAbbrev.set(abbreviation, id);
  }
  const teamIdMap = new Map<number, number>();
  for (const row of teamRes.rows) {
    const abbreviation = String(row.abbreviation ?? '').trim().toUpperCase();
    const id = Number(row.id);
    const chosen = byAbbrev.get(abbreviation);
    if (chosen != null && Number.isSafeInteger(id)) teamIdMap.set(id, chosen);
  }

  for (const box of [...boxes].sort((left, right) => left.gameId - right.gameId)) {
    await client.query(RECOVERY_GAME_LOCK_SQL, [box.gameId]);
  }

  let stats = 0;
  let logs = 0;
  const teamIds = new Set<string>();
  const playerIds = new Set<string>();

  for (const box of boxes) {
    const game = box.game;
    const gameKey = String(box.gameId);
    const existingRaw = await client.query(
      'select id, player_id from raw.player_game_stats where game_id = $1',
      [box.gameId]
    );
    const incomingIds = new Map(box.lines.map((line) => [line.playerId, line.id]));
    for (const row of existingRaw.rows) {
      const playerId = Number(row.player_id);
      const statId = Number(row.id);
      const incoming = incomingIds.get(playerId);
      if (incoming == null || incoming !== statId) {
        throw new RecoveryWriteError(
          `Existing raw box for game ${box.gameId} does not match this payload`,
          'raw_stat_id_conflict'
        );
      }
    }
    const existingLogs = await client.query(
      `select player_id from analytics.player_game_logs where game_id = $1 and season = $2`,
      [gameKey, '2026']
    );
    const incomingPlayers = new Set(box.lines.map((line) => String(line.playerId)));
    for (const row of existingLogs.rows) {
      if (!incomingPlayers.has(String(row.player_id))) {
        throw new RecoveryWriteError(
          `Game ${box.gameId} already has a 2026 player log that this box does not include`,
          'stale_player_log'
        );
      }
    }

    const etDate = etDateOfProviderGame(game);
    const startTime = game.datetime
      ? new Date(String(game.datetime))
      : new Date(`${etDate}T12:00:00.000Z`);
    await client.query(upserts.rawGame, [
      box.gameId,
      game.date ?? null,
      2026,
      'Final',
      game.period ?? null,
      game.time ?? null,
      game.period_detail ?? null,
      game.datetime ?? null,
      false,
      box.home.points,
      box.away.points,
      JSON.stringify(game.home_team ?? null),
      JSON.stringify(game.visitor_team ?? null),
    ]);

    for (const line of box.lines) {
      await client.query(upserts.rawStat, [
        line.id,
        line.min,
        line.fgm,
        line.fga,
        null,
        line.fg3m,
        line.fg3a,
        null,
        line.ftm,
        line.fta,
        null,
        line.oreb,
        line.dreb,
        line.reb,
        line.ast,
        line.stl,
        line.blk,
        line.turnover,
        line.pf,
        line.pts,
        line.plusMinus,
        line.playerId,
        line.teamId,
        box.gameId,
        JSON.stringify(line.player ?? null),
        JSON.stringify({ id: line.teamId }),
        JSON.stringify({ id: box.gameId }),
      ]);
      stats += 1;
      const player = line.player ?? {};
      const firstName = String(player.first_name ?? '').trim();
      const lastName = String(player.last_name ?? '').trim();
      await client.query(UPSERT_RAW_PLAYER, [
        line.playerId,
        player.first_name ?? null,
        player.last_name ?? null,
        player.position ?? null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        line.teamId,
      ]);
      const playerKey = String(line.playerId);
      playerIds.add(playerKey);
      await client.query(UPSERT_ANALYTICS_PLAYER, [
        playerKey,
        `${firstName} ${lastName}`.trim() || playerKey,
        player.first_name ?? null,
        player.last_name ?? null,
        player.position ?? null,
        null,
        null,
      ]);
    }

    const homeId = mapTeamId(box.home.teamId, teamIdMap);
    const awayId = mapTeamId(box.away.teamId, teamIdMap);
    teamIds.add(homeId);
    teamIds.add(awayId);
    await client.query(upserts.analyticsGame, [
      gameKey,
      '2026',
      startTime,
      'Final',
      homeId,
      awayId,
      box.home.points,
      box.away.points,
      null,
    ]);

    for (const line of box.lines) {
      const teamId = mapTeamId(line.teamId, teamIdMap);
      const isHome = teamId === homeId;
      const pra = line.ast == null ? null : line.pts + line.reb + line.ast;
      await client.query(upserts.analyticsLog, [
        gameKey,
        String(line.playerId),
        teamId,
        line.min,
        line.pts,
        line.reb,
        line.oreb,
        line.dreb,
        line.ast,
        line.stl,
        line.blk,
        line.turnover,
        line.pf,
        line.fgm,
        line.fga,
        line.fg3m,
        line.fg3a,
        line.ftm,
        line.fta,
        line.plusMinus,
        isHome ? awayId : homeId,
        isHome,
        etDate,
        '2026',
        pra,
      ]);
      logs += 1;
    }

    const sides = [
      { team: box.home, opponent: box.away, rating: box.homeRating, isHome: true, teamKey: homeId, opponentKey: awayId },
      { team: box.away, opponent: box.home, rating: box.awayRating, isHome: false, teamKey: awayId, opponentKey: homeId },
    ];
    for (const side of sides) {
      await client.query(upserts.teamGame, [
        side.teamKey,
        gameKey,
        '2026',
        etDate,
        side.opponentKey,
        side.isHome,
        side.team.points,
        side.team.rebounds,
        side.team.assists,
        side.team.steals,
        side.team.blocks,
        side.team.turnovers,
        side.team.fgm,
        side.team.fga,
        side.team.fg3m,
        side.team.fg3a,
        side.team.ftm,
        side.team.fta,
        side.team.oreb,
        side.team.dreb,
        side.opponent.fgm,
        side.opponent.fga,
        side.opponent.fg3m,
        side.opponent.fg3a,
        side.opponent.ftm,
        side.opponent.fta,
        side.opponent.turnovers,
        side.opponent.oreb,
        side.opponent.dreb,
        side.rating.pointsAllowed,
        side.rating.result,
        side.rating.possessions,
        side.rating.offensiveRating,
        side.rating.defensiveRating,
        side.rating.pace,
        side.rating.efgPct,
        side.rating.tovPct,
        side.rating.orbPct,
      ]);
    }
  }

  const teamSeason = await client.query(TEAM_SEASON_SQL, ['2026', [...teamIds], openDate]);
  for (const row of teamSeason.rows) {
    if (String(row.season) !== '2026') {
      throw new RecoveryWriteError('Team season query returned a season other than 2026', 'season_scope');
    }
    await client.query(upserts.teamSeason, [
      row.team_id, row.season, row.games_played,
      row.avg_points, row.avg_rebounds, row.avg_assists, row.avg_steals, row.avg_blocks, row.avg_turnovers,
      row.avg_fgm, row.avg_fga, row.avg_3pm, row.avg_3pa, row.avg_ftm, row.avg_fta,
      row.avg_points_allowed, row.wins, row.losses, row.home_wins, row.home_losses, row.away_wins, row.away_losses, row.win_pct,
      row.avg_offensive_rating, row.avg_defensive_rating, row.avg_pace, row.avg_efg_pct, row.avg_tov_pct, row.avg_orb_pct,
    ]);
  }

  const playerSeason = await client.query(PLAYER_SEASON_SQL, ['2026', [...playerIds], openDate]);
  for (const row of playerSeason.rows) {
    if (String(row.season) !== '2026') {
      throw new RecoveryWriteError('Player season query returned a season other than 2026', 'season_scope');
    }
    await client.query(upserts.playerSeason, [
      row.player_id, row.season, row.games_played,
      row.pts_avg, row.reb_avg, row.ast_avg, row.stl_avg, row.blk_avg, row.turnover_avg, row.pra_avg,
      row.fg_pct, row.fg3_pct, row.ft_pct,
    ]);
  }

  return {
    stats,
    logs,
    teamRows: boxes.length * 2,
    teamSeason: teamSeason.rows.length,
    playerSeason: playerSeason.rows.length,
  };
}

export async function executeRecovery(deps: {
  event: unknown;
  env: NodeJS.ProcessEnv;
  maxRetries: number;
  requestDelayMs: number;
  baseUrl: string;
  fetchPage: (
    url: string,
    retries: number,
    onAttempt: () => void,
    onHttpAttempt: (event: { status: number | 'error' }) => void,
    beforeHttpAttempt: () => void
  ) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  connect: () => Promise<QueryClient>;
  upserts: RecoveryUpserts;
}): Promise<RecoveryExecution> {
  const plan = planRecovery(deps.event, deps.env);
  const openDate = regularSeasonOpenEt(plan.seasonStartYear);
  if (!openDate) {
    throw new RecoveryWriteError('2026 regular-season open date is unknown', 'season_open_unknown');
  }
  const retries = cappedRecoveryRetries(deps.maxRetries);
  const rateRetries = recoveryRateLimitRetries(deps.env);
  const logicalMax = recoveryAttemptBudget(deps.maxRetries);
  const logicalBudget: AttemptBudget = { attempts: 0, maxAttempts: logicalMax };
  const httpBudget: AttemptBudget = {
    attempts: 0,
    maxAttempts: recoveryInvocationHttpCeiling(logicalMax, rateRetries, plan.strictHttpBudget),
  };
  const onAttempt = () => chargeAttempt(logicalBudget);
  const beforeHttpAttempt = () => chargeAttempt(httpBudget);
  const onHttpAttempt = () => {};
  const applyAccounting = (result: RecoveryExecution) => {
    result.logicalAttempts = logicalBudget.attempts;
    result.httpAttempts = httpBudget.attempts;
    result.requestsAttempted = httpBudget.attempts;
    result.httpAttemptUpperBound = httpBudget.maxAttempts;
  };
  const fetchedGames = await fetchRecoveryGames({
    baseUrl: deps.baseUrl,
    plan,
    fetchPage: deps.fetchPage,
    retries,
    onAttempt,
    onHttpAttempt,
    beforeHttpAttempt,
  });
  const selection = selectRecoveryGames(plan, fetchedGames.games as ProviderGame[]);
  const result = baseResult(plan);
  applyAccounting(result);
  result.gamesPages = fetchedGames.pages;
  result.seasonTypes = fetchedGames.seasonTypes;
  result.ignoredGameIds = selection.ignoredGameIds;
  result.rejected = selection.rejected;
  if (selection.rejected.length > 0 || selection.ready.length !== plan.gameIds.length) return result;

  const expectedRejected: GameRejection[] = [];
  for (const game of selection.ready) {
    const expected = plan.expected.find((item) => item.gameId === game.id);
    if (!expected) continue;
    const reason = expectedFinalMismatch(game, expected);
    if (reason) expectedRejected.push({ gameId: expected.gameId, reason });
  }
  if (expectedRejected.length > 0) {
    result.rejected = expectedRejected;
    applyAccounting(result);
    return result;
  }

  const fetchedStats = await fetchRecoveryStats({
    baseUrl: deps.baseUrl,
    gameIds: plan.gameIds,
    fetchPage: deps.fetchPage,
    retries,
    onAttempt,
    onHttpAttempt,
    beforeHttpAttempt,
    sleep: deps.sleep,
    requestDelayMs: deps.requestDelayMs,
  });
  result.statsPages = fetchedStats.pages;
  applyAccounting(result);
  const boxes: ValidatedBox[] = [];
  const rejected: GameRejection[] = [];
  for (const game of selection.ready) {
    const lines = (fetchedStats.lines as StatLine[]).filter((line) => line.game?.id === game.id);
    const validated = validateGameBox(game, lines);
    if (!validated.ok) rejected.push(validated.rejection);
    else boxes.push(validated.box);
  }
  if (rejected.length > 0 || boxes.length !== plan.gameIds.length) {
    result.rejected = rejected;
    applyAccounting(result);
    return result;
  }

  const client = await deps.connect();
  let released = false;
  const release = (err?: Error) => {
    if (released) return;
    released = true;
    client.release(err);
  };
  try {
    await client.query('begin');
    const wrote = await writeBoxes(client, boxes, deps.upserts, openDate);
    await client.query('commit');
    result.recoveryStatus = 'committed';
    result.writesCommitted = true;
    result.committedGameIds = boxes.map((box) => box.gameId);
    result.statsUpserted = wrote.stats;
    result.analyticsLogs = wrote.logs;
    result.teamGameStats = wrote.teamRows;
    result.teamSeasonAvgs = wrote.teamSeason;
    result.playerSeasonAvgs = wrote.playerSeason;
    applyAccounting(result);
    release();
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
      release();
    } catch (rollbackError) {
      release(rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
    }
    throw error;
  }
}

export { TEAM_SEASON_SQL, PLAYER_SEASON_SQL };
