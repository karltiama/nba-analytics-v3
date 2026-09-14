import { SEASON_PHASE_WINDOWS } from './contract';
import type { CourtContextGame } from './types';

export const LOAD_COURT_CONTEXT_GAMES_SQL = `
SELECT
  g.game_id AS court_context_game_id,
  g.season,
  g.start_time,
  ht.abbreviation AS home_team,
  at.abbreviation AS away_team,
  ht.full_name AS home_team_name,
  at.full_name AS away_team_name,
  g.status,
  g.venue
FROM analytics.games g
JOIN analytics.teams ht ON ht.team_id = g.home_team_id
JOIN analytics.teams at ON at.team_id = g.away_team_id
WHERE g.season = ANY($1::text[])
  AND lower(btrim(g.status)) = 'final'
ORDER BY g.season, g.start_time, g.game_id
`;

export type GameQueryFn = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<T[]>;

export function classifyGamePhase(
  season: string,
  startTimeIso: string
): 'regular' | 'play_in' | 'playoff' {
  const window = SEASON_PHASE_WINDOWS[season];
  if (!window) return 'regular';
  const t = Date.parse(startTimeIso);
  const playIn = Date.parse(`${window.playInStartEt}T00:00:00-04:00`);
  const playoff = Date.parse(`${window.playoffStartEt}T00:00:00-04:00`);
  if (!Number.isFinite(t) || !Number.isFinite(playIn) || !Number.isFinite(playoff)) return 'regular';
  if (t < playIn) return 'regular';
  if (t < playoff) return 'play_in';
  return 'playoff';
}

export function summarizeUniverse(games: CourtContextGame[]) {
  const bySeason: Record<
    string,
    {
      regularFinal: number;
      playInFinal: number;
      playoffFinal: number;
      totalFinal: number;
      earliestStartTime: string | null;
      latestStartTime: string | null;
    }
  > = {};
  for (const g of games) {
    const phase = g.phase ?? classifyGamePhase(g.season, g.startTime);
    const row = (bySeason[g.season] ??= {
      regularFinal: 0,
      playInFinal: 0,
      playoffFinal: 0,
      totalFinal: 0,
      earliestStartTime: null,
      latestStartTime: null,
    });
    row.totalFinal += 1;
    if (phase === 'regular') row.regularFinal += 1;
    else if (phase === 'play_in') row.playInFinal += 1;
    else row.playoffFinal += 1;
    if (!row.earliestStartTime || g.startTime < row.earliestStartTime) row.earliestStartTime = g.startTime;
    if (!row.latestStartTime || g.startTime > row.latestStartTime) row.latestStartTime = g.startTime;
  }
  return bySeason;
}

export function toManifestRow(game: CourtContextGame) {
  return {
    court_context_game_id: game.courtContextGameId,
    season: game.season,
    start_time: game.startTime,
    home_team: game.homeTeam,
    away_team: game.awayTeam,
    phase: game.phase ?? classifyGamePhase(game.season, game.startTime),
  };
}

export async function loadCourtContextGames(
  query: GameQueryFn,
  seasons: string[]
): Promise<CourtContextGame[]> {
  const rows = await query<{
    court_context_game_id: string;
    season: string;
    start_time: Date | string;
    home_team: string;
    away_team: string;
    home_team_name: string;
    away_team_name: string;
    status: string;
    venue: string | null;
  }>(LOAD_COURT_CONTEXT_GAMES_SQL, [seasons]);
  return rows.map((r) => {
    const startTime = typeof r.start_time === 'string' ? r.start_time : r.start_time.toISOString();
    return {
      courtContextGameId: String(r.court_context_game_id),
      season: String(r.season),
      startTime,
      homeTeam: r.home_team,
      awayTeam: r.away_team,
      homeTeamName: r.home_team_name,
      awayTeamName: r.away_team_name,
      status: r.status,
      venue: r.venue,
      phase: classifyGamePhase(String(r.season), startTime),
    };
  });
}

export function filterGames(
  games: CourtContextGame[],
  args: { season?: string; from?: string; to?: string; gameId?: string }
): CourtContextGame[] {
  return games.filter((g) => {
    if (args.gameId && g.courtContextGameId !== args.gameId) return false;
    if (args.season && g.season !== args.season) return false;
    if (args.from && g.startTime.slice(0, 10) < args.from) return false;
    if (args.to && g.startTime.slice(0, 10) > args.to) return false;
    return true;
  });
}
