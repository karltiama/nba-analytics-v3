export const CONTEXT_TARGET_GAME_SQL = `
  SELECT g.game_id::text AS game_id,
         g.start_time,
         g.season::text AS season,
         g.home_team_id::text AS home_team_id,
         g.away_team_id::text AS away_team_id,
         ht.abbreviation AS home_abbr,
         at.abbreviation AS away_abbr
    FROM analytics.games g
    JOIN analytics.teams ht ON ht.team_id = g.home_team_id
    JOIN analytics.teams at ON at.team_id = g.away_team_id
   WHERE g.game_id = $1
`;

export const CONTEXT_PLAYER_LOGS_SQL = `
  SELECT l.player_id::text AS player_id,
         l.game_id::text AS game_id,
         l.team_id::text AS team_id,
         COALESCE(g.start_time, l.game_date::timestamptz) AS start_time,
         COALESCE(g.season, l.season)::text AS season,
         l.minutes,
         l.points,
         l.rebounds,
         l.assists,
         l.three_pointers_made
    FROM analytics.player_game_logs l
    JOIN analytics.games g ON g.game_id = l.game_id
   WHERE l.player_id = $1
     AND COALESCE(g.start_time, l.game_date::timestamptz) < $2::timestamptz
     AND l.game_id <> $3
     AND COALESCE(g.season, l.season) = ANY($4::text[])
   ORDER BY COALESCE(g.start_time, l.game_date::timestamptz) DESC
`;

export const CONTEXT_TEAM_STATS_SQL = `
  SELECT t.team_id::text AS team_id,
         t.game_id::text AS game_id,
         t.opponent_team_id::text AS opponent_team_id,
         g.start_time,
         t.season::text AS season,
         t.pace,
         t.points_allowed,
         t.team_points
    FROM analytics.team_game_stats t
    JOIN analytics.games g ON g.game_id = t.game_id
   WHERE t.team_id = ANY($1::text[])
     AND g.start_time < $2::timestamptz
     AND t.game_id <> $3
     AND t.season = ANY($4::text[])
   ORDER BY g.start_time DESC
`;

export const CONTEXT_PROJECTION_SQL = `
  SELECT player_id::text AS player_id,
         game_id::text AS game_id,
         model_version,
         generated_at,
         intended_cutoff_at,
         predictions
    FROM analytics.prediction_snapshots
   WHERE player_id = $1
     AND game_id = $2
     AND generated_at < $3::timestamptz
     AND intended_cutoff_at < $3::timestamptz
   ORDER BY generated_at DESC
   LIMIT 5
`;

const FORBIDDEN = [
  'home_score',
  'away_score',
  'prediction_settlements',
  'actual_pts',
  'actual_reb',
  'player_season_averages',
  'team_season_averages',
  'game_starters',
  'date.now',
  'now()',
  'v_player_outcomes',
  'hit_miss',
  'final_points',
];

export function assertContextSqlIsOutcomeFree(sql: string): void {
  const lowered = sql.toLowerCase();
  for (const token of FORBIDDEN) {
    if (lowered.includes(token)) {
      throw new Error(`Context SQL must not read ${token}`);
    }
  }
}

export function assertContextSqlIsAsOfSafe(sql: string): void {
  assertContextSqlIsOutcomeFree(sql);
  const lowered = sql.toLowerCase();
  if (!lowered.includes('< $') && !lowered.includes('<$')) {
    throw new Error('Context history SQL must use a strict start_time < cutoff predicate');
  }
}

export function relatedSeasons(season: string | null): string[] {
  if (!season) return [];
  const year = Number(season);
  if (!Number.isFinite(year)) return [season];
  return [season, String(year - 1)];
}
