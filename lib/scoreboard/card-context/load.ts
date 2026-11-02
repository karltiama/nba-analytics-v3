/**
 * Read-only card context. Scoreboard game ids are not joined to analytics.games.game_id:
 * both writers use the BallDontLie id, but that equality is not proven for every display row.
 * A game counts only when exactly one analytics row matches (ET date, home team, away team, season).
 */

import { parseMinutes } from '@/lib/scoreboard/box-verify';
import type { StoredScoreboardGame } from '@/lib/scoreboard/contract';
import {
  buildInjuryLine,
  injuryLastName,
  PRIOR_BASELINE_SEASON,
  type InjuryLine,
  type InjuryTeamEntry,
  type PlayerInjuryInput,
} from './injuries';
import { buildScheduleLine, SCHEDULE_UNAVAILABLE_TEXT, type ScheduleGameRow, type ScheduleLine } from './schedule';

export const CARD_CONTEXT_SCHEMA_VERSION = 'card-context.v1' as const;

export type CardContextEntry = {
  schedule: ScheduleLine;
  injuries: {
    status: InjuryLine['status'];
    text: string;
    as_of: string | null;
    as_of_label: string | null;
    teams: InjuryTeamEntry[] | null;
  };
};

export type Sql = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
type Env = Record<string, string | undefined>;

export const MATCH_GAMES_SQL = `
SELECT s.game_id AS scoreboard_game_id,
       g.game_id AS analytics_game_id,
       g.season AS season,
       g.home_team_id,
       g.away_team_id
FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS s(game_id, home_team_id, away_team_id, season)
JOIN analytics.games g
  ON g.home_team_id = s.home_team_id
 AND g.away_team_id = s.away_team_id
 AND g.season = s.season
 AND (g.start_time AT TIME ZONE 'America/New_York')::date = $5::date
`.trim();

export const PRIOR_GAMES_SQL = `
SELECT g.season AS season,
       g.home_team_id,
       g.away_team_id,
       g.status,
       g.season_phase,
       to_char((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS et_date
FROM analytics.games g
WHERE g.season = ANY($1::text[])
  AND (g.home_team_id = ANY($2::text[]) OR g.away_team_id = ANY($2::text[]))
  AND g.start_time IS NOT NULL
  AND (g.start_time AT TIME ZONE 'America/New_York')::date < $3::date
`.trim();

export const INJURY_ROWS_SQL = `
SELECT i.player_id, i.team_id, i.status, i.snapshot_at, p.last_name, p.full_name
FROM analytics.player_injury_status_current i
LEFT JOIN analytics.players p ON p.player_id = i.player_id
WHERE i.team_id = ANY($1::text[])
`.trim();

export const INJURY_FEED_SQL = `
SELECT max(snapshot_at) AS snapshot_at
FROM analytics.player_injury_status_current
`.trim();

export const BASELINE_LOGS_SQL = `
SELECT pgl.player_id, pgl.team_id, g.season AS season, g.season_phase, pgl.minutes
FROM analytics.player_game_logs pgl
JOIN analytics.games g ON g.game_id = pgl.game_id
WHERE pgl.player_id = ANY($1::text[])
  AND g.status = 'Final'
  AND g.season_phase IN ('REGULAR', 'IST')
  AND (
    g.season = ANY($2::text[])
    OR (g.season = $3 AND g.season_phase = 'REGULAR')
  )
`.trim();

const UNAVAILABLE_SCHEDULE: ScheduleLine = { status: 'unavailable', text: SCHEDULE_UNAVAILABLE_TEXT };

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function instantIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value.trim());
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

async function read(query: Sql, sql: string, params: unknown[]): Promise<Record<string, unknown>[] | null> {
  try {
    return await query(sql, params);
  } catch {
    return null;
  }
}

function injuryEntry(line: InjuryLine): CardContextEntry['injuries'] {
  return {
    status: line.status,
    text: line.text,
    as_of: line.asOf,
    as_of_label: line.asOfLabel,
    teams: line.teams,
  };
}

function unavailableInjury(env: Env, now: Date, gameEtDate: string): CardContextEntry['injuries'] {
  return injuryEntry(
    buildInjuryLine({
      gameEtDate,
      away: null,
      home: null,
      players: null,
      feedSnapshotAt: null,
      now,
      env,
    })
  );
}

type LogTotals = { games: number; minutes: number };

function addMinutes(bucket: LogTotals, raw: unknown) {
  const minutes = parseMinutes(raw == null ? null : String(raw));
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  bucket.games += 1;
  bucket.minutes += minutes;
}

function average(bucket: LogTotals | undefined): { games: number; avg: number | null } {
  if (!bucket || bucket.games === 0) return { games: 0, avg: null };
  return { games: bucket.games, avg: bucket.minutes / bucket.games };
}

export async function loadCardContext(input: {
  games: StoredScoreboardGame[];
  query: Sql;
  now: Date;
  env: Env;
}): Promise<Record<string, CardContextEntry>> {
  const dated = input.games.filter((game) => game.gameId && game.etDate);
  const date = dated[0]?.etDate ?? '';
  const games = dated.filter((game) => game.etDate === date);
  const out: Record<string, CardContextEntry> = {};
  if (games.length === 0) return out;
  const teamIds = [...new Set(games.flatMap((game) => [game.homeTeamId, game.visitorTeamId].filter(Boolean)))];
  const seasons = [...new Set(games.map((game) => String(game.season)))];

  const matchRows = await read(input.query, MATCH_GAMES_SQL, [
    games.map((game) => game.gameId),
    games.map((game) => game.homeTeamId),
    games.map((game) => game.visitorTeamId),
    games.map((game) => String(game.season)),
    date,
  ]);

  const matches = new Map<string, number>();
  if (matchRows) {
    for (const row of matchRows) {
      const id = text(row.scoreboard_game_id);
      if (!id) continue;
      matches.set(id, (matches.get(id) ?? 0) + 1);
    }
  }
  const matchedIds = matchRows
    ? games.filter((game) => matches.get(game.gameId) === 1).map((game) => game.gameId)
    : [];
  const matchedSeasons = [
    ...new Set(games.filter((game) => matchedIds.includes(game.gameId)).map((game) => String(game.season))),
  ];
  const matchedTeams = [
    ...new Set(
      games
        .filter((game) => matchedIds.includes(game.gameId))
        .flatMap((game) => [game.homeTeamId, game.visitorTeamId])
    ),
  ];

  const priorRows =
    matchRows && matchedSeasons.length > 0 && matchedTeams.length > 0
      ? await read(input.query, PRIOR_GAMES_SQL, [matchedSeasons, matchedTeams, date])
      : matchRows
        ? []
        : null;

  const injuryRows = teamIds.length > 0 ? await read(input.query, INJURY_ROWS_SQL, [teamIds]) : [];
  const feedRows = await read(input.query, INJURY_FEED_SQL, []);
  const feedSnapshotAt = feedRows && feedRows.length > 0 ? instantIso(feedRows[0]?.snapshot_at) : feedRows ? null : null;

  const playerIds = injuryRows
    ? [...new Set(injuryRows.map((row) => text(row.player_id)).filter(Boolean))]
    : [];
  const logRows =
    injuryRows && playerIds.length > 0
      ? await read(input.query, BASELINE_LOGS_SQL, [playerIds, seasons, PRIOR_BASELINE_SEASON])
      : injuryRows
        ? []
        : null;

  const current = new Map<string, LogTotals>();
  const prior = new Map<string, LogTotals>();
  if (logRows) {
    for (const row of logRows) {
      const playerId = text(row.player_id);
      const teamId = text(row.team_id);
      const season = text(row.season);
      const phase = text(row.season_phase).toUpperCase();
      if (!playerId || !season) continue;
      if (phase !== 'REGULAR' && phase !== 'IST') continue;
      if (seasons.includes(season) && teamId) {
        const key = `${playerId}|${teamId}|${season}`;
        const bucket = current.get(key) ?? { games: 0, minutes: 0 };
        addMinutes(bucket, row.minutes);
        current.set(key, bucket);
      }
      if (season === PRIOR_BASELINE_SEASON && phase === 'REGULAR') {
        const bucket = prior.get(playerId) ?? { games: 0, minutes: 0 };
        addMinutes(bucket, row.minutes);
        prior.set(playerId, bucket);
      }
    }
  }

  const players: PlayerInjuryInput[] | null =
    injuryRows && logRows
      ? injuryRows.map((row) => {
          const playerId = text(row.player_id);
          const teamId = text(row.team_id);
          const season = seasons.length === 1 ? seasons[0] : '';
          const currentBucket = season ? average(current.get(`${playerId}|${teamId}|${season}`)) : { games: 0, avg: null };
          const priorBucket = average(prior.get(playerId));
          return {
            playerId,
            teamId,
            lastName: injuryLastName(text(row.last_name), text(row.full_name)),
            status: row.status == null ? null : String(row.status),
            snapshotAt: instantIso(row.snapshot_at),
            currentSeasonGames: currentBucket.games,
            currentSeasonAvgMinutes: currentBucket.avg,
            priorSeasonAvgMinutes: priorBucket.avg,
          };
        })
      : null;

  const priorBySeason = new Map<string, ScheduleGameRow[]>();
  if (priorRows) {
    for (const row of priorRows) {
      const season = text(row.season);
      const list = priorBySeason.get(season) ?? [];
      list.push({
        etDate: text(row.et_date).slice(0, 10),
        seasonPhase: row.season_phase == null ? null : String(row.season_phase),
        status: row.status == null ? null : String(row.status),
        homeTeamId: text(row.home_team_id),
        awayTeamId: text(row.away_team_id),
      });
      priorBySeason.set(season, list);
    }
  }

  for (const game of games) {
    const season = String(game.season);
    const unique = matchRows != null && matches.get(game.gameId) === 1;
    const schedule =
      unique && priorRows
        ? buildScheduleLine({
            gameEtDate: game.etDate,
            awayTeamId: game.visitorTeamId,
            homeTeamId: game.homeTeamId,
            awayAbbr: text(game.visitorAbbr) || 'Away',
            homeAbbr: text(game.homeAbbr) || 'Home',
            season,
            games: (priorBySeason.get(season) ?? []).filter(
              (row) =>
                row.homeTeamId === game.homeTeamId ||
                row.awayTeamId === game.homeTeamId ||
                row.homeTeamId === game.visitorTeamId ||
                row.awayTeamId === game.visitorTeamId
            ),
          })
        : UNAVAILABLE_SCHEDULE;

    const awayId = text(game.visitorTeamId);
    const homeId = text(game.homeTeamId);
    const injuries =
      players == null
        ? unavailableInjury(input.env, input.now, game.etDate)
        : injuryEntry(
            buildInjuryLine({
              gameEtDate: game.etDate,
              away: awayId ? { teamId: awayId, abbr: text(game.visitorAbbr) || 'Away' } : null,
              home: homeId ? { teamId: homeId, abbr: text(game.homeAbbr) || 'Home' } : null,
              players: players.filter((player) => player.teamId === awayId || player.teamId === homeId).map((player) => {
                if (seasons.length === 1) return player;
                const bucket = average(current.get(`${player.playerId}|${player.teamId}|${season}`));
                return {
                  ...player,
                  currentSeasonGames: bucket.games,
                  currentSeasonAvgMinutes: bucket.avg,
                };
              }),
              feedSnapshotAt,
              now: input.now,
              env: input.env,
            })
          );

    out[game.gameId] = { schedule, injuries };
  }
  return out;
}
