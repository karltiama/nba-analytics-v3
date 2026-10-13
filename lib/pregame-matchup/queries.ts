/**
 * Read-only SQL for the 2025–26 regular-season window.
 * Parameters: season, start inclusive, end exclusive, Cup Final date, and for players the two team ids.
 */

import { ROSTER_SEASON, ROSTER_SEASON_LABEL } from './roster';
import type { HistoricalWindow } from './window';

export function historicalTeamQuery(window: HistoricalWindow): { text: string; params: string[] } {
  return {
    text: `SELECT team_id,
            count(*)::int AS rows,
            count(DISTINCT game_id)::int AS games,
            coalesce(sum(team_points), 0)::float8 AS points,
            coalesce(sum(points_allowed), 0)::float8 AS points_allowed,
            coalesce(sum(estimated_possessions), 0)::float8 AS possessions,
            coalesce(sum(team_fgm), 0)::float8 AS fgm,
            coalesce(sum(team_fga), 0)::float8 AS fga,
            coalesce(sum(team_3pm), 0)::float8 AS fg3m,
            coalesce(sum(team_3pa), 0)::float8 AS fg3a,
            coalesce(sum(team_fta), 0)::float8 AS fta,
            coalesce(sum(team_turnovers), 0)::float8 AS turnovers,
            coalesce(sum(offensive_rebounds), 0)::float8 AS offensive_rebounds,
            coalesce(sum(defensive_rebounds), 0)::float8 AS defensive_rebounds,
            coalesce(sum(opponent_offensive_rebounds), 0)::float8 AS opponent_offensive_rebounds,
            coalesce(sum(opponent_defensive_rebounds), 0)::float8 AS opponent_defensive_rebounds,
            count(*) FILTER (WHERE estimated_possessions IS NULL OR estimated_possessions <= 0)::int AS bad_possessions,
            count(*) FILTER (WHERE team_fga IS NULL OR team_fga <= 0 OR team_fgm IS NULL OR team_3pm IS NULL OR team_3pa IS NULL)::int AS bad_shot,
            count(*) FILTER (WHERE offensive_rebounds IS NULL OR defensive_rebounds IS NULL OR opponent_offensive_rebounds IS NULL OR opponent_defensive_rebounds IS NULL)::int AS bad_rebounds,
            count(*) FILTER (WHERE team_turnovers IS NULL OR team_fta IS NULL)::int AS bad_turnovers
     FROM analytics.team_game_stats
     WHERE season = $1
       AND game_date >= $2::date
       AND game_date < $3::date
       AND game_date <> $4::date
     GROUP BY team_id`,
    params: [window.season, window.startInclusive, window.endExclusive, window.excludeDate],
  };
}

export function historicalPlayerQuery(window: HistoricalWindow, teamIds: [string, string]): { text: string; params: unknown[] } {
  return {
    text: `SELECT l.team_id,
            l.player_id,
            pl.full_name,
            count(*) FILTER (WHERE played.minutes IS NOT NULL)::int AS games,
            coalesce(sum(played.minutes) FILTER (WHERE played.minutes IS NOT NULL), 0)::float8 AS minutes,
            coalesce(sum(l.points) FILTER (WHERE played.minutes IS NOT NULL), 0)::float8 AS points,
            coalesce(sum(l.field_goals_attempted) FILTER (WHERE played.minutes IS NOT NULL), 0)::float8 AS fga,
            coalesce(sum(a.usage_percentage * a.possessions) FILTER (
              WHERE played.minutes IS NOT NULL
                AND a.usage_percentage IS NOT NULL
                AND a.possessions IS NOT NULL
                AND a.possessions > 0
                AND a.usage_percentage >= 0
                AND a.usage_percentage <= 1
            ), 0)::float8 AS usage_mass,
            coalesce(sum(a.possessions) FILTER (
              WHERE played.minutes IS NOT NULL
                AND a.usage_percentage IS NOT NULL
                AND a.possessions IS NOT NULL
                AND a.possessions > 0
                AND a.usage_percentage >= 0
                AND a.usage_percentage <= 1
            ), 0)::float8 AS usage_possessions
     FROM analytics.player_game_logs l
     LEFT JOIN analytics.players pl ON pl.player_id = l.player_id
     LEFT JOIN analytics.player_game_advanced a
       ON a.game_id = l.game_id AND a.player_id = l.player_id AND a.season = l.season
     LEFT JOIN LATERAL (
       SELECT CASE
         WHEN l.minutes ~ '^[0-9]+(\\.[0-9]+)?$' AND l.minutes::numeric > 0 THEN l.minutes::numeric
         ELSE NULL
       END AS minutes
     ) played ON true
     WHERE l.season = $1
       AND l.team_id = ANY($2::text[])
       AND l.game_date >= $3::date
       AND l.game_date < $4::date
       AND l.game_date <> $5::date
     GROUP BY l.team_id, l.player_id, pl.full_name`,
    params: [window.season, teamIds, window.startInclusive, window.endExclusive, window.excludeDate],
  };
}

const PLAYED_MINUTES = `CASE
         WHEN l.minutes ~ '^[0-9]+(\\.[0-9]+)?$' AND l.minutes::numeric > 0 THEN l.minutes::numeric
         ELSE NULL
       END`;

/** One row per stored observation day. The page reads these; it does not fetch a roster. */
export function rosterSnapshotDaysQuery(gameDate: string): { text: string; params: string[] } {
  return {
    text: `SELECT snapshot_date::text AS snapshot_date,
            count(*)::int AS observations,
            count(DISTINCT nba_team_id)::int AS teams,
            count(DISTINCT nba_player_id)::int AS players,
            min(team_n)::int AS min_team_size,
            (
              SELECT count(*)::int FROM (
                SELECT nba_player_id
                FROM raw.nba_roster_snapshots d
                WHERE d.analytics_season = $1
                  AND d.season_label = $2
                  AND d.snapshot_date = s.snapshot_date
                GROUP BY nba_player_id
                HAVING count(DISTINCT nba_team_id) > 1
              ) dup
            ) AS cross_team_duplicates,
            count(*) FILTER (WHERE analytics_team_id IS NULL)::int AS missing_analytics_team,
            min(snapshot_at)::text AS collected_at
     FROM (
       SELECT snapshot_date, snapshot_at, nba_team_id, nba_player_id, analytics_team_id,
              count(*) OVER (PARTITION BY snapshot_date, nba_team_id) AS team_n
       FROM raw.nba_roster_snapshots
       WHERE analytics_season = $1
         AND season_label = $2
         AND snapshot_date <= $3::date
     ) s
     GROUP BY snapshot_date`,
    params: [ROSTER_SEASON, ROSTER_SEASON_LABEL, gameDate],
  };
}

/** Membership for two teams on one observation day. Identity is the provider-id bridge, not a name. */
export function rosterMembershipQuery(snapshotDate: string, teamIds: [string, string]): { text: string; params: unknown[] } {
  return {
    text: `SELECT s.analytics_team_id AS team_id,
            s.nba_player_id,
            s.player_name,
            s.team_abbreviation,
            nba.player_entity_id,
            bdl.provider_player_id AS analytics_player_id,
            ap.player_id AS entity_player_id
     FROM raw.nba_roster_snapshots s
     LEFT JOIN analytics.player_provider_ids nba
       ON nba.provider = 'nba' AND nba.provider_player_id = s.nba_player_id
     LEFT JOIN analytics.player_provider_ids bdl
       ON bdl.provider = 'balldontlie' AND bdl.player_entity_id = nba.player_entity_id
     LEFT JOIN analytics.players ap
       ON ap.player_entity_id = nba.player_entity_id
     WHERE s.analytics_season = $1
       AND s.season_label = $2
       AND s.snapshot_date = $3::date
       AND s.analytics_team_id = ANY($4::text[])`,
    params: [ROSTER_SEASON, ROSTER_SEASON_LABEL, snapshotDate, teamIds],
  };
}

/** Positive-minute production for the two teams inside the regular-season fence. */
export function rosterTeamProductionQuery(window: HistoricalWindow, teamIds: [string, string]): { text: string; params: unknown[] } {
  return {
    text: `SELECT l.team_id,
            l.player_id,
            coalesce(sum(${PLAYED_MINUTES}), 0)::float8 AS minutes,
            coalesce(sum(l.field_goals_attempted) FILTER (WHERE (${PLAYED_MINUTES}) IS NOT NULL), 0)::float8 AS fga,
            coalesce(sum(l.free_throws_attempted) FILTER (WHERE (${PLAYED_MINUTES}) IS NOT NULL), 0)::float8 AS fta,
            coalesce(sum(a.usage_percentage * a.possessions) FILTER (
              WHERE (${PLAYED_MINUTES}) IS NOT NULL
                AND a.usage_percentage IS NOT NULL
                AND a.possessions IS NOT NULL
                AND a.possessions > 0
                AND a.usage_percentage >= 0
                AND a.usage_percentage <= 1
            ), 0)::float8 AS usage_mass,
            coalesce(sum(a.possessions) FILTER (
              WHERE (${PLAYED_MINUTES}) IS NOT NULL
                AND a.usage_percentage IS NOT NULL
                AND a.possessions IS NOT NULL
                AND a.possessions > 0
                AND a.usage_percentage >= 0
                AND a.usage_percentage <= 1
            ), 0)::float8 AS usage_possessions
     FROM analytics.player_game_logs l
     LEFT JOIN analytics.player_game_advanced a
       ON a.game_id = l.game_id AND a.player_id = l.player_id AND a.season = l.season
     WHERE l.season = $1
       AND l.team_id = ANY($2::text[])
       AND l.game_date >= $3::date
       AND l.game_date < $4::date
       AND l.game_date <> $5::date
     GROUP BY l.team_id, l.player_id`,
    params: [window.season, teamIds, window.startInclusive, window.endExclusive, window.excludeDate],
  };
}

/** Regular-season minutes on teams other than the matchup, for already-resolved roster player ids. */
export function rosterOtherTeamQuery(window: HistoricalWindow, teamIds: [string, string], playerIds: string[]): { text: string; params: unknown[] } {
  return {
    text: `SELECT l.team_id,
            l.player_id,
            coalesce(sum(${PLAYED_MINUTES}), 0)::float8 AS minutes,
            0::float8 AS fga,
            0::float8 AS fta,
            0::float8 AS usage_mass,
            0::float8 AS usage_possessions
     FROM analytics.player_game_logs l
     WHERE l.season = $1
       AND l.player_id = ANY($2::text[])
       AND NOT (l.team_id = ANY($3::text[]))
       AND l.game_date >= $4::date
       AND l.game_date < $5::date
       AND l.game_date <> $6::date
     GROUP BY l.team_id, l.player_id`,
    params: [window.season, playerIds, teamIds, window.startInclusive, window.endExclusive, window.excludeDate],
  };
}

export function teamIdentityQuery(teamIds: [string, string]): { text: string; params: [string[]] } {
  return {
    text: `SELECT team_id, abbreviation, full_name, conference
     FROM analytics.teams
     WHERE team_id = ANY($1::text[])`,
    params: [teamIds],
  };
}
