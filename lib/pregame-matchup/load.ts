/**
 * Server-only loader. Reads one scoreboard game and the 2025–26 regular-season window.
 * Does not write, and does not call a provider.
 */

import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';
import type { StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { loadCardContext } from '@/lib/scoreboard/card-context/load';
import { isScoreboardCardContextEnabled, isScoreboardMarketServingEnabled } from '@/lib/scoreboard/flags';
import { formatObservedAt, lifecycleLabel, seasonLabel } from '@/lib/scoreboard/present';
import { createPgScoreboardStore, type ScoreboardStore } from '@/lib/scoreboard/store';
import type { PlayerSumRow, TeamSumRow } from './aggregate';
import { buildPregameMatchup, type CurrentSeasonInput, type MatchupGameContext, type PregameMatchupModel } from './compose';
import { playerRow, teamRow } from './rows';
import { dashboardReturnHref, parseSlateDate } from './href';
import { currentSeasonTeamQuery, historicalPlayerQuery, historicalTeamQuery, teamIdentityQuery } from './queries';
import { resolveMatchupQuote } from './quote';
import { presentRoster } from './roster';
import { loadRosterContinuity } from './roster-load';
import { currentSeasonWindow, historicalWindow } from './window';
import { buildInjuryReport, type InjuryReport } from './injury-report';
import { minutesDecimalSql } from '@/lib/players/minutes-sql';
import { seasonSpan } from './compose';
import { buildStarters, type StarterRow, type StartersModel } from './starters';

type Sql = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

async function defaultPool() {
  const { default: pool } = await import('@/lib/db');
  return pool;
}

async function loadCurrentSeason(run: Sql, game: StoredScoreboardGame): Promise<CurrentSeasonInput | null> {
  const window = currentSeasonWindow(String(game.season), game.etDate);
  if (!window) return null;
  try {
    const query = currentSeasonTeamQuery(window);
    const rows = await run(query.text, query.params);
    return { season: window.season, teamRows: rows.map(teamRow).filter((row): row is TeamSumRow => row != null) };
  } catch {
    return null;
  }
}

/** Same read as the scoreboard card context, for this one game. Off unless the card flag is on. */
async function loadGameContext(
  run: Sql,
  game: StoredScoreboardGame,
  now: Date,
  env: Record<string, string | undefined>
): Promise<MatchupGameContext | null> {
  if (!isScoreboardCardContextEnabled(env)) return null;
  try {
    const byId = await loadCardContext({ games: [game], query: run, now, env });
    const entry = byId[game.gameId];
    if (!entry) return null;
    return {
      schedule: entry.schedule.status === 'ready' ? entry.schedule.text : null,
      injuries: {
        status: entry.injuries.status,
        text: entry.injuries.text,
        asOfLabel: entry.injuries.as_of_label,
        teams: entry.injuries.teams,
      },
    };
  } catch {
    return null;
  }
}

const INJURY_REPORT_ROWS_SQL = `
  SELECT i.player_id::text AS player_id, i.team_id::text AS team_id, i.status, i.description, i.return_date_raw,
         i.snapshot_at, COALESCE(NULLIF(TRIM(p.full_name), ''), i.player_id::text) AS name
  FROM analytics.player_injury_status_current i
  LEFT JOIN analytics.players p ON p.player_id = i.player_id::text
  WHERE i.team_id::text = ANY($1)`;

const INJURY_REPORT_FEED_SQL = `SELECT max(snapshot_at) AS snapshot_at FROM analytics.player_injury_status_current`;

/** This season's finished regular-season and NBA Cup games for both teams, by ET date. */
const INJURY_REPORT_TEAM_GAMES_SQL = `
  SELECT t.team_id, (g.start_time AT TIME ZONE 'America/New_York')::date::text AS game_date
  FROM analytics.games g
  CROSS JOIN LATERAL (VALUES (g.home_team_id::text), (g.away_team_id::text)) AS t(team_id)
  WHERE g.season = $1
    AND g.status = 'Final'
    AND upper(coalesce(g.season_phase, '')) IN ('REGULAR', 'IST')
    AND t.team_id = ANY($2)
    AND (g.start_time AT TIME ZONE 'America/New_York')::date < $3::date`;

const INJURY_REPORT_LOGS_SQL = `
  SELECT player_id, team_id, season, game_date::text AS game_date, minutes
  FROM analytics.player_game_logs
  WHERE player_id = ANY($1) AND season = ANY($2) AND game_date < $3::date`;

/** Who plays for these teams, and how much, this season and last. Feeds the WOWY teammate links. */
const INJURY_REPORT_ROTATION_SQL = `
  SELECT l.player_id, l.team_id, l.season,
         COALESCE(NULLIF(TRIM(MAX(p.full_name)), ''), l.player_id) AS name,
         count(*)::int AS games,
         avg(${minutesDecimalSql('l.minutes')})::float8 AS avg_minutes
  FROM analytics.player_game_logs l
  LEFT JOIN analytics.players p ON p.player_id = l.player_id
  WHERE l.team_id = ANY($1) AND l.season = ANY($2) AND l.game_date < $3::date
    AND ${minutesDecimalSql('l.minutes')} > 0
  GROUP BY l.player_id, l.team_id, l.season`;

/** This season's certified starters for both teams, before this game (post-tip confirmed, from BDL lineups). */
const STARTERS_SQL = `
  SELECT s.team_id, s.game_id, (g.start_time AT TIME ZONE 'America/New_York')::date::text AS game_date,
         s.player_id, COALESCE(NULLIF(TRIM(p.full_name), ''), s.player_id) AS name, s.position
  FROM analytics.game_starters s
  JOIN analytics.games g ON g.game_id = s.game_id
  LEFT JOIN analytics.players p ON p.player_id = s.player_id
  WHERE s.season = $1 AND s.team_id = ANY($2)
    AND (g.start_time AT TIME ZONE 'America/New_York')::date < $3::date`;

async function loadStarterRows(run: Sql, game: StoredScoreboardGame): Promise<StarterRow[] | null> {
  try {
    const rows = await run(STARTERS_SQL, [String(game.season), [game.visitorTeamId, game.homeTeamId], game.etDate]);
    return rows.map((r) => ({
      teamId: String(r.team_id),
      gameId: String(r.game_id),
      date: String(r.game_date),
      playerId: String(r.player_id),
      name: String(r.name),
      position: r.position == null || String(r.position).trim() === '' ? null : String(r.position),
    }));
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

/** Every listed player on both teams with how long he has been out. Null when the read fails. */
async function loadInjuryReport(
  run: Sql,
  game: StoredScoreboardGame,
  awayAbbr: string,
  homeAbbr: string,
  now: Date,
  env: Record<string, string | undefined>
): Promise<InjuryReport | null> {
  try {
    const season = String(game.season);
    const priorSeason = String(game.season - 1);
    const teamIds = [game.visitorTeamId, game.homeTeamId];
    const [injuryRows, feedRows, gameRows, rotationRows] = await Promise.all([
      run(INJURY_REPORT_ROWS_SQL, [teamIds]),
      run(INJURY_REPORT_FEED_SQL, []),
      run(INJURY_REPORT_TEAM_GAMES_SQL, [season, teamIds, game.etDate]),
      run(INJURY_REPORT_ROTATION_SQL, [teamIds, [season, priorSeason], game.etDate]).catch(() => []),
    ]);
    const playerIds = [...new Set(injuryRows.map((r) => str(r.player_id)).filter(Boolean))];
    const logRows =
      playerIds.length > 0 ? await run(INJURY_REPORT_LOGS_SQL, [playerIds, [season, priorSeason], game.etDate]) : [];
    return buildInjuryReport({
      gameEtDate: game.etDate,
      season,
      priorSeason,
      seasonLabel: seasonSpan(season),
      priorSeasonLabel: seasonSpan(priorSeason),
      teams: [
        { teamId: game.visitorTeamId, abbr: awayAbbr },
        { teamId: game.homeTeamId, abbr: homeAbbr },
      ],
      injuries: injuryRows.map((r) => ({
        playerId: str(r.player_id),
        teamId: str(r.team_id),
        name: str(r.name),
        status: r.status == null ? null : String(r.status),
        description: r.description == null ? null : String(r.description),
        returnDateRaw: r.return_date_raw == null ? null : String(r.return_date_raw),
        snapshotAt: iso(r.snapshot_at),
      })),
      feedSnapshotAt: iso(feedRows[0]?.snapshot_at),
      teamGames: gameRows.map((r) => ({ teamId: str(r.team_id), date: str(r.game_date) })),
      logs: logRows.map((r) => ({
        playerId: str(r.player_id),
        teamId: str(r.team_id),
        season: str(r.season),
        date: str(r.game_date),
        minutes: r.minutes == null ? null : String(r.minutes),
      })),
      rotation: rotationRows.map((r) => ({
        playerId: str(r.player_id),
        teamId: str(r.team_id),
        season: str(r.season),
        name: str(r.name),
        games: Number(r.games) || 0,
        avgMinutes: Number(r.avg_minutes) || 0,
      })),
      now,
      env,
    });
  } catch {
    return null;
  }
}

function sameAbbr(scoreboard: string | null, analytics: string | null | undefined): boolean {
  if (!scoreboard || !analytics) return false;
  return scoreboard.trim().toUpperCase() === analytics.trim().toUpperCase();
}

export async function loadPregameMatchup(input: {
  gameId: string;
  slateDate?: string | null;
  now?: Date;
  env?: Record<string, string | undefined>;
  store?: ScoreboardStore;
  query?: Sql;
}): Promise<PregameMatchupModel | null> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const store = input.store ?? createPgScoreboardStore(await defaultPool());
  const run = input.query ?? (async (text, params) => {
    const result = await (await defaultPool()).query(text, params);
    return result.rows as Record<string, unknown>[];
  });
  const game: StoredScoreboardGame | null = await store.loadGameById(input.gameId);
  if (!game) return null;

  const awayAbbr = game.visitorAbbr?.trim() || 'Away';
  const homeAbbr = game.homeAbbr?.trim() || 'Home';
  let quotes: Awaited<ReturnType<ScoreboardStore['loadCurrentOdds']>> = [];
  if (isScoreboardMarketServingEnabled(env)) {
    try {
      quotes = await store.loadCurrentOdds([game.gameId]);
    } catch {
      quotes = [];
    }
  }
  const quote = resolveMatchupQuote({ game, quotes, now, env, awayAbbr, homeAbbr });

  const window = historicalWindow();
  const teamQuery = historicalTeamQuery(window);
  const teamIds: [string, string] = [game.visitorTeamId, game.homeTeamId];
  const playerQuery = historicalPlayerQuery(window, teamIds);
  const identity = teamIdentityQuery(teamIds);
  const [teamResult, playerResult, identityResult, current, context, injuryReport, starterRows] = await Promise.all([
    run(teamQuery.text, teamQuery.params),
    run(playerQuery.text, playerQuery.params),
    run(identity.text, identity.params),
    loadCurrentSeason(run, game),
    loadGameContext(run, game, now, env),
    loadInjuryReport(run, game, awayAbbr, homeAbbr, now, env),
    loadStarterRows(run, game),
  ]);
  const identities = new Map(
    identityResult.map((row) => [String(row.team_id), { abbreviation: row.abbreviation == null ? null : String(row.abbreviation), fullName: row.full_name == null ? null : String(row.full_name) }])
  );
  const awayIdentity = identities.get(game.visitorTeamId);
  const homeIdentity = identities.get(game.homeTeamId);
  const identityConfirmed = sameAbbr(game.visitorAbbr, awayIdentity?.abbreviation) && sameAbbr(game.homeAbbr, homeIdentity?.abbreviation);
  let roster = presentRoster({ gameDate: game.etDate, day: null, teams: [] });
  try {
    roster = await loadRosterContinuity(run, {
      gameDate: game.etDate,
      tipoffAt: game.scheduledTip,
      teamIds,
      awayAbbr,
      homeAbbr,
      window,
    });
  } catch {
    roster = presentRoster({ gameDate: game.etDate, day: null, teams: [] });
  }

  const model = buildPregameMatchup({
    gameId: game.gameId,
    awayTeamId: game.visitorTeamId,
    homeTeamId: game.homeTeamId,
    awayAbbr,
    homeAbbr,
    awayName: game.visitorName?.trim() || awayIdentity?.fullName || awayAbbr,
    homeName: game.homeName?.trim() || homeIdentity?.fullName || homeAbbr,
    tipLabel: formatTipoffEt(game.scheduledTip) || 'Tip time unavailable',
    seasonLabel: seasonLabel(game.seasonType),
    statusLabel: lifecycleLabel(game.lifecycle),
    updatedLabel: `Scoreboard ${formatObservedAt(game.lastObservedAt)}`,
    returnHref: dashboardReturnHref(parseSlateDate(input.slateDate) ?? game.etDate),
    identityConfirmed,
    teamRows: teamResult.map(teamRow).filter((row): row is TeamSumRow => row != null),
    playerRows: playerResult.map(playerRow).filter((row): row is PlayerSumRow => row != null),
    roster,
    quote,
    current,
    context,
  });
  const starters: StartersModel | null = starterRows
    ? buildStarters({
        seasonLabel: seasonSpan(String(game.season)),
        teams: [
          { teamId: game.visitorTeamId, abbr: awayAbbr },
          { teamId: game.homeTeamId, abbr: homeAbbr },
        ],
        rows: starterRows,
        injuries: injuryReport,
      })
    : null;
  return { ...model, injuryReport, starters };
}
