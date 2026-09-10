/**
 * Historical Final payload from existing analytics Postgres only.
 * Scores come from analytics.games. Box rows come from analytics.player_game_logs.
 * Starters come from analytics.game_starters. Advanced comes from
 * analytics.player_game_advanced. Role Profile comes from
 * analytics.player_role_profile (season grain). Timeline/rotation flags come
 * from analytics.game_flow (2025 certified Plays). Never BDL.
 */

import { getGameById } from '@/lib/analytics/games-queries';
import {
  advancedByPlayerId,
  mapServingAdvancedRow,
} from '@/lib/betting/historical-advanced';
import {
  mapServingRoleProfileRow,
  roleProfileByPlayerId,
} from '@/lib/betting/historical-role-profile';
import { loadCertifiedGameFlowFlags } from '@/lib/betting/historical-timeline-server';
import {
  emptyHistoricalStarters,
  groupCertifiedStarters,
  type HistoricalStarters,
} from '@/lib/betting/historical-starters';
import { query } from '@/lib/db';
import {
  attachAdvancedToBox,
  attachRoleProfileToBox,
  groupBoxScoreByTeam,
  historicalModuleAvailability,
  type HistoricalBoxLogRow,
  type HistoricalBoxScore,
  type HistoricalModuleAvailability,
} from '@/lib/betting/historical-final';

export type HistoricalFinalOverview = {
  gameId: string;
  season: string;
  gameDate: string | null;
  startTime: string | null;
  status: string | null;
  venue: string | null;
  homeTeamId: string;
  homeTeamAbbr: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamAbbr: string;
  awayTeamName: string;
  homeScore: number | null;
  awayScore: number | null;
};

export type HistoricalFinalPayload = {
  overview: HistoricalFinalOverview;
  boxScore: HistoricalBoxScore;
  starters: HistoricalStarters;
  availability: HistoricalModuleAvailability;
};

async function loadCertifiedStarters(
  gameId: string,
  homeTeamId: string,
  awayTeamId: string
): Promise<HistoricalStarters> {
  const rows = await query(
    `SELECT
       gs.player_id,
       p.full_name AS player_name,
       gs.team_id,
       gs.position
     FROM analytics.game_starters gs
     JOIN analytics.players p ON p.player_id = gs.player_id
     WHERE gs.game_id = $1
     ORDER BY gs.team_id, gs.position NULLS LAST, p.full_name`,
    [gameId]
  );
  return groupCertifiedStarters(rows, homeTeamId, awayTeamId);
}

async function loadCertifiedAdvanced(gameId: string) {
  const rows = await query(
    `SELECT
       game_id,
       player_id,
       season,
       usage_percentage,
       true_shooting_percentage,
       effective_field_goal_percentage,
       offensive_rating,
       defensive_rating,
       net_rating,
       pace,
       possessions,
       assist_percentage,
       rebound_percentage,
       turnover_ratio,
       pie
     FROM analytics.player_game_advanced
     WHERE game_id = $1`,
    [gameId]
  );
  return rows.map(mapServingAdvancedRow);
}

async function loadCertifiedRoleProfiles(season: string, playerIds: string[]) {
  if (!season || playerIds.length === 0) return [];
  const rows = await query(
    `SELECT
       player_id,
       season,
       isolation_poss_pct,
       isolation_ppp,
       pnr_ball_handler_poss_pct,
       pnr_ball_handler_ppp,
       pnr_roll_man_poss_pct,
       pnr_roll_man_ppp,
       drives_per_game,
       drive_points_per_game,
       passes_per_game,
       potential_assists_per_game,
       restricted_area_fga,
       restricted_area_fg_pct,
       paint_non_ra_fga,
       paint_non_ra_fg_pct,
       midrange_fga,
       midrange_fg_pct,
       corner_three_fga,
       corner_three_fg_pct,
       above_break_three_fga,
       above_break_three_fg_pct
     FROM analytics.player_role_profile
     WHERE season = $1
       AND player_id = ANY($2::text[])`,
    [season, playerIds]
  );
  return rows.map(mapServingRoleProfileRow);
}

export async function loadHistoricalFinalBox(
  gameId: string,
  homeTeamId: string,
  awayTeamId: string,
  season: string
): Promise<{
  boxScore: HistoricalBoxScore;
  starters: HistoricalStarters;
  availability: HistoricalModuleAvailability;
}> {
  const [logs, starters, advancedRows, flowFlags] = await Promise.all([
    query(
      `SELECT
         pgl.player_id,
         p.full_name AS player_name,
         pgl.team_id,
         pgl.minutes,
         pgl.points,
         pgl.rebounds,
         pgl.assists,
         pgl.steals,
         pgl.blocks
       FROM analytics.player_game_logs pgl
       JOIN analytics.players p ON p.player_id = pgl.player_id
       WHERE pgl.game_id = $1
       ORDER BY pgl.team_id, pgl.points DESC NULLS LAST`,
      [gameId]
    ),
    loadCertifiedStarters(gameId, homeTeamId, awayTeamId),
    loadCertifiedAdvanced(gameId),
    loadCertifiedGameFlowFlags(gameId),
  ]);

  const box = groupBoxScoreByTeam(logs as HistoricalBoxLogRow[], homeTeamId, awayTeamId);
  const playerIds = [...new Set([...box.home, ...box.away].map((p) => p.playerId).filter(Boolean))];
  const roleRows = await loadCertifiedRoleProfiles(season, playerIds);
  const withAdvanced = attachAdvancedToBox(box, advancedByPlayerId(advancedRows));
  return {
    boxScore: attachRoleProfileToBox(withAdvanced, roleProfileByPlayerId(roleRows)),
    starters,
    availability: historicalModuleAvailability(
      starters.available,
      advancedRows.length > 0,
      roleRows.length > 0,
      flowFlags.timeline,
      flowFlags.rotationContext
    ),
  };
}

export async function loadHistoricalFinalPayload(
  gameId: string
): Promise<HistoricalFinalPayload | null> {
  const game = await getGameById(gameId);
  if (!game) return null;
  const { boxScore, starters, availability } = await loadHistoricalFinalBox(
    gameId,
    game.home_team_id,
    game.away_team_id,
    String(game.season ?? '')
  );

  return {
    overview: {
      gameId: game.game_id,
      season: game.season,
      gameDate: game.start_time
        ? new Date(game.start_time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
        : null,
      startTime: game.start_time,
      status: game.status,
      venue: game.venue,
      homeTeamId: game.home_team_id,
      homeTeamAbbr: game.home_team_abbr,
      homeTeamName: game.home_team_name,
      awayTeamId: game.away_team_id,
      awayTeamAbbr: game.away_team_abbr,
      awayTeamName: game.away_team_name,
      homeScore: game.home_score,
      awayScore: game.away_score,
    },
    boxScore,
    starters,
    availability,
  };
}

export { emptyHistoricalStarters };
