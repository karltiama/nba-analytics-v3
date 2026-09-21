/**
 * Prior-season role + recent competitive minutes + usage queries (V1.1).
 */

import { query } from '@/lib/db';
import { PRIOR_SEASON_ROLE_STATS_SQL } from '@/lib/teams/roster-change-story';
import { WOWY_POSTSEASON_START_ET } from '@/lib/wowy/calendar';
import {
  MIN_USAGE_MINUTES_PER_GAME,
  RECENT_COMPETITIVE_WINDOW_GAMES,
  USAGE_AGGREGATION_METHOD,
} from './policy';
import type {
  FactProvenance,
  PacketPlayerRoleStats,
  RecentCompetitiveWindow,
} from './types';

/**
 * Canonical usage aggregation (USAGE_AGGREGATION_METHOD).
 * Unweighted mean of usage_percentage on advanced rows with PGL minutes >
 * MIN_USAGE_MINUTES_PER_GAME. All teams, prior season.
 */
export const PRIOR_SEASON_USAGE_SQL = `
  SELECT
    a.player_id,
    count(*)::int AS usage_games,
    avg(a.usage_percentage)::float8 AS usage_avg,
    sum(NULLIF(trim(pgl.minutes), '')::numeric)::float8 AS usage_total_minutes
  FROM analytics.player_game_advanced a
  JOIN analytics.player_game_logs pgl
    ON pgl.game_id = a.game_id
   AND pgl.player_id = a.player_id
  WHERE a.season = $1
    AND a.player_id = ANY($2::text[])
    AND a.usage_percentage IS NOT NULL
    AND NULLIF(trim(pgl.minutes), '') IS NOT NULL
    AND NULLIF(trim(pgl.minutes), '')::numeric > $3
  GROUP BY a.player_id
`;

/**
 * Last N played games by tipoff DESC. Includes postseason by policy.
 * Also returns RS vs PS counts using postseason floor date ($4).
 */
export const RECENT_COMPETITIVE_MPG_SQL = `
  WITH played AS (
    SELECT
      pgl.player_id,
      NULLIF(trim(pgl.minutes), '')::numeric AS minutes_num,
      g.start_time,
      pgl.game_id,
      (timezone('America/New_York', g.start_time))::date AS tip_et
    FROM analytics.player_game_logs pgl
    JOIN analytics.games g ON g.game_id = pgl.game_id
    WHERE pgl.season = $1
      AND pgl.player_id = ANY($2::text[])
      AND NULLIF(trim(pgl.minutes), '') IS NOT NULL
      AND NULLIF(trim(pgl.minutes), '')::numeric > 0
      AND g.start_time IS NOT NULL
  ),
  ranked AS (
    SELECT
      player_id,
      minutes_num,
      tip_et,
      start_time,
      row_number() OVER (
        PARTITION BY player_id
        ORDER BY start_time DESC NULLS LAST, game_id DESC
      ) AS rn
    FROM played
  ),
  windowed AS (
    SELECT *
    FROM ranked
    WHERE rn <= $3
  )
  SELECT
    player_id,
    count(*)::int AS games_included,
    avg(minutes_num)::float8 AS recent_mpg,
    min(tip_et)::text AS date_range_start,
    max(tip_et)::text AS date_range_end,
    count(*) FILTER (
      WHERE $4::date IS NULL OR tip_et < $4::date
    )::int AS regular_season_game_count,
    count(*) FILTER (
      WHERE $4::date IS NOT NULL AND tip_et >= $4::date
    )::int AS postseason_game_count
  FROM windowed
  GROUP BY player_id
`;

export type ContinuityPlayerLite = {
  playerEntityId: string;
  displayName: string;
  playerId: string | null;
};

export async function loadPlayerSeasonRoleStats(args: {
  priorSeason: string;
  players: ContinuityPlayerLite[];
}): Promise<{ stats: PacketPlayerRoleStats[]; warnings: string[] }> {
  const warnings: string[] = [];
  const withId = args.players.filter((p) => p.playerId != null) as Array<
    ContinuityPlayerLite & { playerId: string }
  >;
  for (const p of args.players) {
    if (p.playerId == null) {
      warnings.push(
        `Skipping role stats for ${p.displayName} (${p.playerEntityId}): missing player_id`
      );
    }
  }

  if (withId.length === 0) {
    return { stats: [], warnings };
  }

  const bdlIds = [...new Set(withId.map((p) => p.playerId))];
  const postseasonStart = WOWY_POSTSEASON_START_ET[args.priorSeason] ?? null;
  const provenance: FactProvenance = {
    method: 'prior_season_role_stats_v1.1',
    tables: [
      'analytics.player_game_logs',
      'analytics.player_season_averages',
      'analytics.player_game_advanced',
      'analytics.games',
    ],
    season: args.priorSeason,
    note: `MPG/PPG all-teams competitive; usage=${USAGE_AGGREGATION_METHOD}; recent window last ${RECENT_COMPETITIVE_WINDOW_GAMES} played games (may include postseason)`,
  };

  const [roleRows, usageRows, recentRows] = await Promise.all([
    query(PRIOR_SEASON_ROLE_STATS_SQL, [args.priorSeason, bdlIds]),
    query(PRIOR_SEASON_USAGE_SQL, [
      args.priorSeason,
      bdlIds,
      MIN_USAGE_MINUTES_PER_GAME,
    ]),
    query(RECENT_COMPETITIVE_MPG_SQL, [
      args.priorSeason,
      bdlIds,
      RECENT_COMPETITIVE_WINDOW_GAMES,
      postseasonStart,
    ]),
  ]);

  const roleById = new Map<
    string,
    { gp: number | null; mpg: number | null; ppg: number | null }
  >();
  for (const raw of roleRows) {
    const r = raw as Record<string, unknown>;
    roleById.set(String(r.player_id), {
      gp: r.games_played != null ? Number(r.games_played) : null,
      mpg: r.mpg != null ? Number(r.mpg) : null,
      ppg: r.pts_avg != null ? Number(r.pts_avg) : null,
    });
  }

  const usageById = new Map<
    string,
    { usageAvg: number; usageGames: number; usageTotalMinutes: number }
  >();
  for (const raw of usageRows) {
    const r = raw as Record<string, unknown>;
    usageById.set(String(r.player_id), {
      usageAvg: Number(r.usage_avg),
      usageGames: Number(r.usage_games),
      usageTotalMinutes: Number(r.usage_total_minutes),
    });
  }

  const recentById = new Map<
    string,
    {
      gamesIncluded: number;
      recentMpg: number;
      dateRangeStart: string | null;
      dateRangeEnd: string | null;
      regularSeasonGameCount: number;
      postseasonGameCount: number;
    }
  >();
  for (const raw of recentRows) {
    const r = raw as Record<string, unknown>;
    recentById.set(String(r.player_id), {
      gamesIncluded: Number(r.games_included),
      recentMpg: Number(r.recent_mpg),
      dateRangeStart: r.date_range_start != null ? String(r.date_range_start) : null,
      dateRangeEnd: r.date_range_end != null ? String(r.date_range_end) : null,
      regularSeasonGameCount: Number(r.regular_season_game_count),
      postseasonGameCount: Number(r.postseason_game_count),
    });
  }

  const stats: PacketPlayerRoleStats[] = [];
  for (const p of withId) {
    const role = roleById.get(p.playerId);
    const usage = usageById.get(p.playerId);
    const recent = recentById.get(p.playerId);
    let recentCompetitive: RecentCompetitiveWindow | null = null;
    if (recent) {
      recentCompetitive = {
        gamesIncluded: recent.gamesIncluded,
        dateRangeStart: recent.dateRangeStart,
        dateRangeEnd: recent.dateRangeEnd,
        regularSeasonGameCount: recent.regularSeasonGameCount,
        postseasonGameCount: recent.postseasonGameCount,
        baselineMpg: role?.mpg ?? null,
        recentMpg: recent.recentMpg,
        includesPostseasonByPolicy: true,
      };
    }
    stats.push({
      playerEntityId: p.playerEntityId,
      playerId: p.playerId,
      displayName: p.displayName,
      gamesPlayed: role?.gp ?? null,
      mpg: role?.mpg ?? null,
      ppg: role?.ppg ?? null,
      usageAvg: usage?.usageAvg ?? null,
      usageGames: usage?.usageGames ?? null,
      usageTotalMinutes: usage?.usageTotalMinutes ?? null,
      recentCompetitive,
      provenance,
    });
  }

  return { stats, warnings };
}
