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
  pa: number;
  pr: number;
  ra: number;
}

export interface ModelInputStatsExt {
  last5: ModelInputStats;
  std10: ModelInputStats;
}

export interface PlayerPropModelInputs {
  last10: ModelInputStats;
  season: ModelInputStats;
  ext: ModelInputStatsExt;
}

function avg(values: (number | null)[]): number {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function stddev(values: (number | null)[]): number {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length < 2) return 0;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance = valid.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (valid.length - 1);
  return Math.sqrt(Math.max(variance, 0));
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
  const seasonPa = seasonPts + seasonAst;
  const seasonPr = seasonPts + seasonReb;
  const seasonRa = seasonReb + seasonAst;

  const season: ModelInputStats = {
    pts: seasonPts,
    reb: seasonReb,
    ast: seasonAst,
    threes: seasonThrees,
    pra: seasonPra,
    pa: seasonPa,
    pr: seasonPr,
    ra: seasonRa,
  };

  if (games.length === 0) {
    return {
      last10: season,
      season,
      ext: {
        last5: season,
        std10: { pts: 0, reb: 0, ast: 0, threes: 0, pra: 0, pa: 0, pr: 0, ra: 0 },
      },
    };
  }

  const last10Pts = avg(games.map((g) => g.points));
  const last10Reb = avg(games.map((g) => g.rebounds));
  const last10Ast = avg(games.map((g) => g.assists));
  const last10Threes = avg(games.map((g) => g.three_pointers_made));
  const last10Pra = avg(
    games.map((g) => (g.points ?? 0) + (g.rebounds ?? 0) + (g.assists ?? 0))
  );
  const last10Pa = avg(games.map((g) => (g.points ?? 0) + (g.assists ?? 0)));
  const last10Pr = avg(games.map((g) => (g.points ?? 0) + (g.rebounds ?? 0)));
  const last10Ra = avg(games.map((g) => (g.rebounds ?? 0) + (g.assists ?? 0)));

  const last10: ModelInputStats = {
    pts: last10Pts,
    reb: last10Reb,
    ast: last10Ast,
    threes: last10Threes,
    pra: last10Pra,
    pa: last10Pa,
    pr: last10Pr,
    ra: last10Ra,
  };

  const last5: ModelInputStats = {
    pts: avg(games.slice(0, 5).map((g) => g.points)),
    reb: avg(games.slice(0, 5).map((g) => g.rebounds)),
    ast: avg(games.slice(0, 5).map((g) => g.assists)),
    threes: avg(games.slice(0, 5).map((g) => g.three_pointers_made)),
    pra: avg(games.slice(0, 5).map((g) => (g.points ?? 0) + (g.rebounds ?? 0) + (g.assists ?? 0))),
    pa: avg(games.slice(0, 5).map((g) => (g.points ?? 0) + (g.assists ?? 0))),
    pr: avg(games.slice(0, 5).map((g) => (g.points ?? 0) + (g.rebounds ?? 0))),
    ra: avg(games.slice(0, 5).map((g) => (g.rebounds ?? 0) + (g.assists ?? 0))),
  };

  const std10: ModelInputStats = {
    pts: stddev(games.slice(0, 10).map((g) => g.points)),
    reb: stddev(games.slice(0, 10).map((g) => g.rebounds)),
    ast: stddev(games.slice(0, 10).map((g) => g.assists)),
    threes: stddev(games.slice(0, 10).map((g) => g.three_pointers_made)),
    pra: stddev(games.slice(0, 10).map((g) => (g.points ?? 0) + (g.rebounds ?? 0) + (g.assists ?? 0))),
    pa: stddev(games.slice(0, 10).map((g) => (g.points ?? 0) + (g.assists ?? 0))),
    pr: stddev(games.slice(0, 10).map((g) => (g.points ?? 0) + (g.rebounds ?? 0))),
    ra: stddev(games.slice(0, 10).map((g) => (g.rebounds ?? 0) + (g.assists ?? 0))),
  };

  return { last10, season, ext: { last5, std10 } };
}

/** Map prop_type (and common aliases) to stat key. Handles "points", "pts", "PRA", "pra", etc. */
const PROP_TO_STAT: Record<string, 'pts' | 'reb' | 'ast' | 'threes' | 'pra' | 'pa' | 'pr' | 'ra'> = {
  points: 'pts',
  pts: 'pts',
  rebounds: 'reb',
  reb: 'reb',
  assists: 'ast',
  ast: 'ast',
  threes: 'threes',
  points_assists: 'pa',
  points_rebounds: 'pr',
  rebounds_assists: 'ra',
  points_rebounds_assists: 'pra',
  pra: 'pra',
};

export type PropStatKey = keyof typeof PROP_TO_STAT;

/**
 * Infer stat from prop_type when no exact key match (e.g. "Player Points", "point").
 */
function inferStatFromPropType(key: string): 'pts' | 'reb' | 'ast' | 'threes' | 'pra' | 'pa' | 'pr' | 'ra' | null {
  if (!key) return null;
  if (key.includes('points_assists') || key.includes('assists_points')) return 'pa';
  if (key.includes('points_rebounds') || key.includes('rebounds_points')) return 'pr';
  if (key.includes('rebounds_assists') || key.includes('assists_rebounds')) return 'ra';
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
): { last10Avg: number; seasonAvg: number; last5Avg: number; observedStdDev: number } | null {
  const key = (propType ?? '').toLowerCase().trim();
  const stat = PROP_TO_STAT[key] ?? inferStatFromPropType(key);
  if (!stat) return null;
  return {
    last10Avg: inputs.last10[stat],
    seasonAvg: inputs.season[stat],
    last5Avg: inputs.ext.last5[stat],
    observedStdDev: inputs.ext.std10[stat],
  };
}
