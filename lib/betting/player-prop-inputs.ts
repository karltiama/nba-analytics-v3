/**
 * Fetches last-10 and season stats for a player for use by the prop probability model.
 */

import { getAnalyticsPlayerSeasonStats, getAnalyticsPlayerGames } from '@/lib/players/analytics-queries';

export interface ModelInputStats {
  pts: number;
  reb: number;
  ast: number;
  threes: number;
  pra: number;
}

export interface PlayerPropModelInputs {
  last10: ModelInputStats;
  season: ModelInputStats;
}

function avg(values: (number | null)[]): number {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * Returns last10 and season averages for pts, reb, ast, threes, pra.
 * Season threes = total_3pm / games_played; season PRA = avg_points + avg_rebounds + avg_assists.
 */
export async function getPlayerPropModelInputs(playerId: string): Promise<PlayerPropModelInputs | null> {
  const [seasonStats, gamesData] = await Promise.all([
    getAnalyticsPlayerSeasonStats(playerId, null),
    getAnalyticsPlayerGames(playerId, null, 10),
  ]);

  const games = gamesData.games ?? [];
  const gp = Math.max(1, seasonStats.games_played ?? seasonStats.games_active ?? 0);

  const seasonPts = seasonStats.avg_points ?? 0;
  const seasonReb = seasonStats.avg_rebounds ?? 0;
  const seasonAst = seasonStats.avg_assists ?? 0;
  const seasonThrees = (seasonStats.total_3pm ?? 0) / gp;
  const seasonPra = seasonPts + seasonReb + seasonAst;

  const season: ModelInputStats = {
    pts: seasonPts,
    reb: seasonReb,
    ast: seasonAst,
    threes: seasonThrees,
    pra: seasonPra,
  };

  if (games.length === 0) {
    return { last10: season, season };
  }

  const last10Pts = avg(games.map((g) => g.points));
  const last10Reb = avg(games.map((g) => g.rebounds));
  const last10Ast = avg(games.map((g) => g.assists));
  const last10Threes = avg(games.map((g) => g.three_pointers_made));
  const last10Pra = avg(
    games.map((g) => (g.points ?? 0) + (g.rebounds ?? 0) + (g.assists ?? 0))
  );

  const last10: ModelInputStats = {
    pts: last10Pts,
    reb: last10Reb,
    ast: last10Ast,
    threes: last10Threes,
    pra: last10Pra,
  };

  return { last10, season };
}

/** Map prop_type (and common aliases) to stat key. Handles "points", "pts", "PRA", "pra", etc. */
const PROP_TO_STAT: Record<string, 'pts' | 'reb' | 'ast' | 'threes' | 'pra'> = {
  points: 'pts',
  pts: 'pts',
  rebounds: 'reb',
  reb: 'reb',
  assists: 'ast',
  ast: 'ast',
  threes: 'threes',
  points_rebounds_assists: 'pra',
  pra: 'pra',
};

export type PropStatKey = keyof typeof PROP_TO_STAT;

/**
 * Infer stat from prop_type when no exact key match (e.g. "Player Points", "point").
 */
function inferStatFromPropType(key: string): 'pts' | 'reb' | 'ast' | 'threes' | 'pra' | null {
  if (!key) return null;
  if (key.includes('points_rebounds_assists') || key.includes('pra')) return 'pra';
  if (key.includes('rebound')) return 'reb';
  if (key.includes('assist')) return 'ast';
  if (key.includes('three') && !key.includes('assist')) return 'threes';
  if (key.includes('point')) return 'pts'; // "point", "points", "Player Points", etc.
  return null;
}

/**
 * Get last10 and season average for a given prop_type (e.g. "points", "pts", "Player Points", "threes").
 */
export function getStatsForPropType(
  inputs: PlayerPropModelInputs,
  propType: string
): { last10Avg: number; seasonAvg: number } | null {
  const key = (propType ?? '').toLowerCase().trim();
  const stat = PROP_TO_STAT[key] ?? inferStatFromPropType(key);
  if (!stat) return null;
  return {
    last10Avg: inputs.last10[stat],
    seasonAvg: inputs.season[stat],
  };
}
