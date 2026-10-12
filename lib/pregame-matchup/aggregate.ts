/**
 * Possession-weighted 2025–26 team rates and possession-weighted player usage.
 * Ratings are total points per 100 estimated possessions, not the mean of per-game ratings.
 * Estimated possessions are the stored box-score estimate. They are not official NBA pace
 * and are not adjusted for overtime.
 */

import {
  EXPECTED_LEAGUE_GAMES,
  EXPECTED_TEAM_COUNT,
  EXPECTED_TEAM_GAMES,
} from './window';

export type TeamSumRow = {
  teamId: string;
  rows: number;
  games: number;
  points: number;
  pointsAllowed: number;
  possessions: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  fta: number;
  turnovers: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  opponentOffensiveRebounds: number;
  opponentDefensiveRebounds: number;
  badPossessions: number;
  badShot: number;
  badRebounds: number;
  badTurnovers: number;
};

export type TeamProfile = {
  teamId: string;
  games: number;
  offensiveRating: number;
  defensiveRating: number;
  netRating: number;
  estimatedPossessionsPerGame: number;
  pointsPerGame: number;
  pointsAllowedPerGame: number;
  effectiveFieldGoalPct: number;
  threePointAttemptRate: number;
  offensiveReboundRate: number;
  opponentOffensiveReboundRate: number;
  turnoverRate: number;
};

export type PlayerSumRow = {
  teamId: string;
  playerId: string;
  name: string | null;
  games: number;
  minutes: number;
  points: number;
  fga: number;
  usageMass: number;
  usagePossessions: number;
};

export type HistoricalContributor = {
  playerId: string;
  name: string;
  games: number;
  minutesPerGame: number;
  pointsPerGame: number;
  fgaPerGame: number;
  /** 0–1 share. Null when no valid possession-weighted observations exist. */
  usage: number | null;
  totalMinutes: number;
};

export const CONTRIBUTOR_LIMIT = 5;

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export function teamProfile(row: TeamSumRow): TeamProfile | null {
  if (row.rows !== EXPECTED_TEAM_GAMES || row.games !== EXPECTED_TEAM_GAMES) return null;
  if (row.badPossessions > 0 || row.badShot > 0 || row.badRebounds > 0 || row.badTurnovers > 0) return null;
  const offensiveRating = ratio(row.points * 100, row.possessions);
  const defensiveRating = ratio(row.pointsAllowed * 100, row.possessions);
  const estimatedPossessionsPerGame = ratio(row.possessions, row.games);
  const pointsPerGame = ratio(row.points, row.games);
  const pointsAllowedPerGame = ratio(row.pointsAllowed, row.games);
  const effectiveFieldGoalPct = ratio(row.fgm + 0.5 * row.fg3m, row.fga);
  const threePointAttemptRate = ratio(row.fg3a, row.fga);
  const offensiveReboundRate = ratio(row.offensiveRebounds, row.offensiveRebounds + row.opponentDefensiveRebounds);
  const opponentOffensiveReboundRate = ratio(
    row.opponentOffensiveRebounds,
    row.opponentOffensiveRebounds + row.defensiveRebounds
  );
  const turnoverRate = ratio(row.turnovers, row.fga + 0.44 * row.fta + row.turnovers);
  if (
    offensiveRating == null ||
    defensiveRating == null ||
    estimatedPossessionsPerGame == null ||
    pointsPerGame == null ||
    pointsAllowedPerGame == null ||
    effectiveFieldGoalPct == null ||
    threePointAttemptRate == null ||
    offensiveReboundRate == null ||
    opponentOffensiveReboundRate == null ||
    turnoverRate == null
  ) {
    return null;
  }
  return {
    teamId: row.teamId,
    games: row.games,
    offensiveRating,
    defensiveRating,
    netRating: offensiveRating - defensiveRating,
    estimatedPossessionsPerGame,
    pointsPerGame,
    pointsAllowedPerGame,
    effectiveFieldGoalPct,
    threePointAttemptRate,
    offensiveReboundRate,
    opponentOffensiveReboundRate,
    turnoverRate,
  };
}

/**
 * The full 30-team, 1,230-game regular-season sample.
 * One team outside 82 games, a duplicate game, or a short league rejects the sample.
 */
export function regularSeasonSample(rows: TeamSumRow[]): Map<string, TeamProfile> | null {
  if (rows.length !== EXPECTED_TEAM_COUNT) return null;
  const profiles = new Map<string, TeamProfile>();
  let sides = 0;
  for (const row of rows) {
    const profile = teamProfile(row);
    if (!profile || profiles.has(row.teamId)) return null;
    profiles.set(row.teamId, profile);
    sides += profile.games;
  }
  if (sides !== EXPECTED_TEAM_COUNT * EXPECTED_TEAM_GAMES) return null;
  if (sides / 2 !== EXPECTED_LEAGUE_GAMES) return null;
  return profiles;
}

export function historicalContributors(rows: PlayerSumRow[], teamId: string): HistoricalContributor[] {
  const contributors: HistoricalContributor[] = [];
  for (const row of rows) {
    if (row.teamId !== teamId || row.games <= 0 || row.minutes <= 0 || !row.name?.trim()) continue;
    const minutesPerGame = ratio(row.minutes, row.games);
    const pointsPerGame = ratio(row.points, row.games);
    const fgaPerGame = ratio(row.fga, row.games);
    if (minutesPerGame == null || pointsPerGame == null || fgaPerGame == null) continue;
    let usage: number | null = null;
    if (row.usagePossessions > 0 && Number.isFinite(row.usageMass)) {
      const weighted = row.usageMass / row.usagePossessions;
      if (Number.isFinite(weighted) && weighted >= 0 && weighted <= 1) usage = weighted;
    }
    contributors.push({
      playerId: row.playerId,
      name: row.name.trim(),
      games: row.games,
      minutesPerGame,
      pointsPerGame,
      fgaPerGame,
      usage,
      totalMinutes: row.minutes,
    });
  }
  contributors.sort(
    (a, b) => b.totalMinutes - a.totalMinutes || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId)
  );
  return contributors.slice(0, CONTRIBUTOR_LIMIT);
}
