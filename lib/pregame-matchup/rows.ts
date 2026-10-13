/**
 * Shared parsers for the 2025–26 historical SQL rows.
 * Pure functions. They do not query a database.
 */

import type { PlayerSumRow, TeamSumRow } from './aggregate';

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function teamRow(row: Record<string, unknown>): TeamSumRow | null {
  const teamId = row.team_id == null ? '' : String(row.team_id);
  const fields = [
    'rows',
    'games',
    'points',
    'points_allowed',
    'possessions',
    'fgm',
    'fga',
    'fg3m',
    'fg3a',
    'fta',
    'turnovers',
    'offensive_rebounds',
    'defensive_rebounds',
    'opponent_offensive_rebounds',
    'opponent_defensive_rebounds',
    'bad_possessions',
    'bad_shot',
    'bad_rebounds',
    'bad_turnovers',
  ] as const;
  const values = fields.map((field) => num(row[field]));
  if (!teamId || values.some((value) => value == null)) return null;
  const [
    rows,
    games,
    points,
    pointsAllowed,
    possessions,
    fgm,
    fga,
    fg3m,
    fg3a,
    fta,
    turnovers,
    offensiveRebounds,
    defensiveRebounds,
    opponentOffensiveRebounds,
    opponentDefensiveRebounds,
    badPossessions,
    badShot,
    badRebounds,
    badTurnovers,
  ] = values as number[];
  return {
    teamId,
    rows,
    games,
    points,
    pointsAllowed,
    possessions,
    fgm,
    fga,
    fg3m,
    fg3a,
    fta,
    turnovers,
    offensiveRebounds,
    defensiveRebounds,
    opponentOffensiveRebounds,
    opponentDefensiveRebounds,
    badPossessions,
    badShot,
    badRebounds,
    badTurnovers,
  };
}

export function playerRow(row: Record<string, unknown>): PlayerSumRow | null {
  const teamId = row.team_id == null ? '' : String(row.team_id);
  const playerId = row.player_id == null ? '' : String(row.player_id);
  const games = num(row.games);
  const minutes = num(row.minutes);
  const points = num(row.points);
  const fga = num(row.fga);
  const usageMass = num(row.usage_mass);
  const usagePossessions = num(row.usage_possessions);
  if (!teamId || !playerId || games == null || minutes == null || points == null || fga == null) return null;
  return {
    teamId,
    playerId,
    name: row.full_name == null ? null : String(row.full_name),
    games,
    minutes,
    points,
    fga,
    usageMass: usageMass ?? 0,
    usagePossessions: usagePossessions ?? 0,
  };
}
