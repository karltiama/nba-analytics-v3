/**
 * This season's players for each team, from game logs: who has played for the team this season and
 * is still with it (his latest game was for this team). Last season's line sits beside each one.
 */

import { CONTRIBUTOR_LIMIT, historicalContributors, type HistoricalContributor, type PlayerSumRow } from './aggregate';
import type { InjuryReport, InjurySeverity } from './injury-report';

/** Rotation shown per team: everyone with minutes this season, up to this many. */
export const CURRENT_PLAYER_LIMIT = 12;

/** Under this many games this season, the line is marked small and last season's line leads. */
export const CURRENT_PLAYER_MIN_GAMES = 3;

export type CurrentPlayer = HistoricalContributor & {
  /** His 2025–26 line for this team. Null when he did not play for this team then. */
  prior: HistoricalContributor | null;
  /** Played elsewhere last season (has 2025–26 games, none for this team). */
  newToTeam: boolean;
  status: string | null;
  severity: InjurySeverity | null;
};

export type CurrentPlayersTeam = {
  teamId: string;
  abbr: string;
  teamGames: number;
  players: CurrentPlayer[];
  /** Listed injured players who have not played for this team this season. */
  notYetPlayed: { playerId: string; name: string; status: string }[];
};

export type CurrentPlayers = {
  seasonLabel: string;
  priorLabel: string;
  teams: CurrentPlayersTeam[];
  /** Last season's minute leaders who now play for another team, per team id. */
  departed: Record<string, string[]>;
};

export function buildCurrentPlayers(input: {
  seasonLabel: string;
  priorLabel: string;
  teams: { teamId: string; abbr: string }[];
  /** This season, both teams, players with games for each team. */
  currentRows: PlayerSumRow[];
  /** Last season, both teams. */
  priorRows: PlayerSumRow[];
  /** Team of each player's latest game this season. */
  latestTeam: Map<string, string>;
  /** Team games played this season. */
  teamGames: Map<string, number>;
  /** Players with any 2025–26 games (any team). */
  playedLastSeason: Set<string>;
  injuries: InjuryReport | null;
}): CurrentPlayers | null {
  if (input.currentRows.length === 0) return null;
  const status = new Map<string, { status: string; severity: InjurySeverity; name: string }>();
  for (const team of input.injuries?.status === 'listed' ? input.injuries.teams : []) {
    for (const p of team.players) status.set(`${team.teamId}|${p.playerId}`, { status: p.status, severity: p.severity, name: p.name });
  }

  const departed: Record<string, string[]> = {};
  const teams = input.teams.map((team): CurrentPlayersTeam => {
    const stillHere = input.currentRows.filter(
      (r) => r.teamId === team.teamId && (input.latestTeam.get(r.playerId) ?? team.teamId) === team.teamId
    );
    const prior = new Map(historicalContributors(input.priorRows, team.teamId, Infinity).map((p) => [p.playerId, p]));
    const players = historicalContributors(stillHere, team.teamId, CURRENT_PLAYER_LIMIT).map((p): CurrentPlayer => {
      const s = status.get(`${team.teamId}|${p.playerId}`);
      const before = prior.get(p.playerId) ?? null;
      return {
        ...p,
        prior: before,
        newToTeam: !before && input.playedLastSeason.has(p.playerId),
        status: s?.status ?? null,
        severity: s?.severity ?? null,
      };
    });
    const ids = new Set(input.currentRows.filter((r) => r.teamId === team.teamId).map((r) => r.playerId));
    const notYetPlayed = [...status.entries()]
      .filter(([key]) => key.startsWith(`${team.teamId}|`))
      .map(([key, s]) => ({ playerId: key.slice(team.teamId.length + 1), name: s.name, status: s.status }))
      .filter((p) => !ids.has(p.playerId));
    departed[team.teamId] = [...prior.values()]
      .slice(0, CONTRIBUTOR_LIMIT * 2)
      .filter((p) => {
        const now = input.latestTeam.get(p.playerId);
        return now != null && now !== team.teamId;
      })
      .map((p) => p.name);
    return { teamId: team.teamId, abbr: team.abbr, teamGames: input.teamGames.get(team.teamId) ?? 0, players, notYetPlayed };
  });
  return { seasonLabel: input.seasonLabel, priorLabel: input.priorLabel, teams, departed };
}
