/**
 * Matchup-related queries using analytics schema only.
 * Data sources: analytics.team_season_averages, analytics.team_game_stats (via getTeamSeasonAverages + rebounds allowed).
 */

import { queryOne } from '@/lib/db';
import { getTeamSeasonAverages } from '@/lib/teams/analytics-queries';
import { getAnalyticsSeason } from '@/lib/season';

export interface OpponentContext {
  avg_defensive_rating: number | null;
  avg_pace: number | null;
  avg_points_allowed: number | null;
  avg_rebounds_allowed: number | null;
}

/**
 * Opponent defensive context for a game (defensive rating, pace, points allowed, rebounds allowed).
 * Defaults to active analytics season when `season` omitted (fail-closed vs latest DESC).
 */
export async function getOpponentContextForGame(
  opponentTeamId: string,
  season?: string
): Promise<OpponentContext | null> {
  const activeSeason = season || getAnalyticsSeason();
  const teamSeason = await getTeamSeasonAverages(opponentTeamId, activeSeason);
  if (!teamSeason) return null;

  let avgReboundsAllowed: number | null = null;
  const rebRow = await queryOne(
    `SELECT AVG(opponent_offensive_rebounds + opponent_defensive_rebounds)::numeric as avg_reb_allowed
     FROM analytics.team_game_stats
     WHERE team_id = $1 AND season = $2`,
    [opponentTeamId, activeSeason]
  );
  if (rebRow?.avg_reb_allowed != null) {
    avgReboundsAllowed = Number(rebRow.avg_reb_allowed);
  }

  return {
    avg_defensive_rating: teamSeason.avg_defensive_rating,
    avg_pace: teamSeason.avg_pace,
    avg_points_allowed: teamSeason.avg_points_allowed,
    avg_rebounds_allowed: avgReboundsAllowed,
  };
}
