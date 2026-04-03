/**
 * Matchup injury context: teammate stat splits in games where an injured player
 * did not play vs games they played (same season, team Final games).
 *
 * "Did not play" = box score shows no minutes (no row or parsed minutes ≤ 0).
 * Injury API names who is Out/Doubtful; splits use game logs, not injury history.
 */

import { query, queryOne } from '@/lib/db';

/** SQL: parse minutes text to numeric (matches lib/betting/queries patterns). */
export const MINUTES_NUM_SQL = `NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric`;

const MIN_BASELINE_MINUTES = 10;
const MAX_INJURED_TO_ANALYZE = 6;
const MAX_TEAMMATES_PER_INJURY = 4;

export interface TeammateSplitRow {
  player_id: string;
  full_name: string;
  n_games_played_with: number;
  n_games_missed: number;
  avg_pts_with: number | null;
  avg_pts_without: number | null;
  avg_min_with: number | null;
  avg_min_without: number | null;
  pts_delta: number | null;
}

export interface InjuredPlayerContext {
  player_id: string;
  full_name: string;
  team_id: string;
  status: string | null;
  baseline_minutes: number;
  games_played_sample: number;
  games_missed_sample: number;
  missed_definition: 'box_score_no_minutes';
  teammates: TeammateSplitRow[];
  low_sample: boolean;
}

export interface InjuryMatchupContext {
  season: string;
  entries: InjuredPlayerContext[];
}

async function getGameMeta(gameId: string): Promise<{
  home_team_id: string;
  away_team_id: string;
  season: string;
} | null> {
  const row = await queryOne<{
    home_team_id: string;
    away_team_id: string;
    season: string;
  }>(
    `SELECT home_team_id, away_team_id, season
     FROM analytics.games
     WHERE game_id = $1`,
    [gameId]
  );
  return row ?? null;
}

async function getInjuredWithBaseline(
  teamIds: [string, string],
  season: string
): Promise<
  Array<{
    player_id: string;
    team_id: string;
    full_name: string;
    status: string | null;
    baseline_minutes: number;
  }>
> {
  return query(
    `WITH l10 AS (
       SELECT pgl.player_id, pgl.team_id,
              AVG(NULLIF(TRIM(REGEXP_REPLACE(COALESCE(pgl.minutes, '0'), '[^0-9.]', '', 'g')), '')::numeric) AS avg_minutes
       FROM analytics.player_game_logs pgl
       JOIN analytics.games g ON g.game_id = pgl.game_id
       WHERE g.status = 'Final'
         AND g.season = $3
         AND pgl.team_id = ANY($1::text[])
       GROUP BY pgl.player_id, pgl.team_id
     )
     SELECT i.player_id, i.team_id, p.full_name, i.status,
            COALESCE(l10.avg_minutes, 0)::float AS baseline_minutes
     FROM analytics.player_injury_status_current i
     JOIN analytics.players p ON p.player_id = i.player_id
     LEFT JOIN l10 ON l10.player_id = i.player_id AND l10.team_id = i.team_id
     WHERE i.team_id = ANY($1::text[])
       AND (LOWER(COALESCE(i.status, '')) LIKE 'out%' OR LOWER(COALESCE(i.status, '')) LIKE 'doubtful%')
       AND COALESCE(l10.avg_minutes, 0) >= $2`,
    [teamIds, MIN_BASELINE_MINUTES, season]
  );
}

/**
 * Teammate averages when injured player played (minutes > 0) vs did not play
 * for the same team's Final games in `season`.
 */
async function computeSplitsForInjured(params: {
  teamId: string;
  injuredPlayerId: string;
  season: string;
  teammateIds: string[];
}): Promise<{
  games_played: number;
  games_missed: number;
  rows: Map<
    string,
    {
      n_with: number;
      n_without: number;
      sum_pts_with: number;
      sum_pts_without: number;
      sum_min_with: number;
      sum_min_without: number;
    }
  >;
}> {
  const { teamId, injuredPlayerId, season, teammateIds } = params;
  if (teammateIds.length === 0) {
    return { games_played: 0, games_missed: 0, rows: new Map() };
  }

  type Row = {
    player_id: string;
    games_with: string;
    games_without: string;
    pts_with: string | null;
    pts_without: string | null;
    min_with: string | null;
    min_without: string | null;
  };

  const rows = await query<Row>(
    `WITH team_games AS (
       SELECT g.game_id
       FROM analytics.games g
       WHERE g.status = 'Final'
         AND g.season = $3
         AND (g.home_team_id = $1 OR g.away_team_id = $1)
     ),
     inj_min AS (
       SELECT pgl.game_id,
         ${MINUTES_NUM_SQL} AS m
       FROM analytics.player_game_logs pgl
       WHERE pgl.team_id = $1
         AND pgl.player_id = $2
     ),
     classified AS (
       SELECT tg.game_id,
         CASE
           WHEN COALESCE(im.m, 0) > 0 THEN 'with'
           ELSE 'without'
         END AS bucket
       FROM team_games tg
       LEFT JOIN inj_min im ON im.game_id = tg.game_id
     ),
     agg AS (
       SELECT
         pgl.player_id,
         SUM(CASE WHEN c.bucket = 'with' AND ${MINUTES_NUM_SQL} > 0 THEN 1 ELSE 0 END)::int AS games_with,
         SUM(CASE WHEN c.bucket = 'without' AND ${MINUTES_NUM_SQL} > 0 THEN 1 ELSE 0 END)::int AS games_without,
         SUM(CASE WHEN c.bucket = 'with' AND ${MINUTES_NUM_SQL} > 0 THEN COALESCE(pgl.points, 0) ELSE 0 END) AS pts_with,
         SUM(CASE WHEN c.bucket = 'without' AND ${MINUTES_NUM_SQL} > 0 THEN COALESCE(pgl.points, 0) ELSE 0 END) AS pts_without,
         SUM(CASE WHEN c.bucket = 'with' AND ${MINUTES_NUM_SQL} > 0 THEN ${MINUTES_NUM_SQL} ELSE 0 END) AS min_with,
         SUM(CASE WHEN c.bucket = 'without' AND ${MINUTES_NUM_SQL} > 0 THEN ${MINUTES_NUM_SQL} ELSE 0 END) AS min_without
       FROM classified c
       JOIN analytics.player_game_logs pgl ON pgl.game_id = c.game_id AND pgl.team_id = $1
       WHERE pgl.player_id = ANY($4::text[])
         AND pgl.player_id <> $2
       GROUP BY pgl.player_id
     )
     SELECT player_id,
       games_with::text,
       games_without::text,
       pts_with::text,
       pts_without::text,
       min_with::text,
       min_without::text
     FROM agg`,
    [teamId, injuredPlayerId, season, teammateIds]
  );

  const meta = await queryOne<{ gw: string; gm: string }>(
    `WITH team_games AS (
       SELECT g.game_id
       FROM analytics.games g
       WHERE g.status = 'Final'
         AND g.season = $3
         AND (g.home_team_id = $1 OR g.away_team_id = $1)
     ),
     inj_min AS (
       SELECT pgl.game_id, ${MINUTES_NUM_SQL} AS m
       FROM analytics.player_game_logs pgl
       WHERE pgl.team_id = $1 AND pgl.player_id = $2
     )
     SELECT
       SUM(CASE WHEN COALESCE(im.m, 0) > 0 THEN 1 ELSE 0 END)::text AS gw,
       SUM(CASE WHEN COALESCE(im.m, 0) <= 0 OR im.m IS NULL THEN 1 ELSE 0 END)::text AS gm
     FROM team_games tg
     LEFT JOIN inj_min im ON im.game_id = tg.game_id`,
    [teamId, injuredPlayerId, season]
  );

  const games_played = parseInt(meta?.gw ?? '0', 10) || 0;
  const games_missed = parseInt(meta?.gm ?? '0', 10) || 0;

  const map = new Map<
    string,
    {
      n_with: number;
      n_without: number;
      sum_pts_with: number;
      sum_pts_without: number;
      sum_min_with: number;
      sum_min_without: number;
    }
  >();

  for (const r of rows) {
    const nWith = parseInt(r.games_with, 10) || 0;
    const nWithout = parseInt(r.games_without, 10) || 0;
    map.set(r.player_id, {
      n_with: nWith,
      n_without: nWithout,
      sum_pts_with: parseFloat(r.pts_with ?? '0') || 0,
      sum_pts_without: parseFloat(r.pts_without ?? '0') || 0,
      sum_min_with: parseFloat(r.min_with ?? '0') || 0,
      sum_min_without: parseFloat(r.min_without ?? '0') || 0,
    });
  }

  return { games_played, games_missed, rows: map };
}

/** Top teammates by avg minutes in games injured player played (season). */
async function getTopTeammateIds(params: {
  teamId: string;
  injuredPlayerId: string;
  season: string;
  limit: number;
}): Promise<string[]> {
  const { teamId, injuredPlayerId, season, limit } = params;
  const rows = await query<{ player_id: string }>(
    `WITH team_games AS (
       SELECT g.game_id
       FROM analytics.games g
       WHERE g.status = 'Final'
         AND g.season = $3
         AND (g.home_team_id = $1 OR g.away_team_id = $1)
     ),
     inj_min AS (
       SELECT pgl.game_id, ${MINUTES_NUM_SQL} AS m
       FROM analytics.player_game_logs pgl
       WHERE pgl.team_id = $1 AND pgl.player_id = $2
     ),
     played_games AS (
       SELECT tg.game_id
       FROM team_games tg
       JOIN inj_min im ON im.game_id = tg.game_id AND COALESCE(im.m, 0) > 0
     )
     SELECT pgl.player_id,
       AVG(${MINUTES_NUM_SQL}) AS avg_m
     FROM played_games pg
     JOIN analytics.player_game_logs pgl ON pgl.game_id = pg.game_id AND pgl.team_id = $1
     WHERE pgl.player_id <> $2
       AND ${MINUTES_NUM_SQL} > 0
     GROUP BY pgl.player_id
     ORDER BY avg_m DESC NULLS LAST
     LIMIT $4`,
    [teamId, injuredPlayerId, season, limit]
  );
  return rows.map((r) => r.player_id);
}

export async function getInjuryMatchupContext(gameId: string): Promise<InjuryMatchupContext | null> {
  const meta = await getGameMeta(gameId);
  if (!meta?.season) return null;

  const injured = await getInjuredWithBaseline([meta.home_team_id, meta.away_team_id], meta.season);
  if (injured.length === 0) {
    return { season: meta.season, entries: [] };
  }

  const sorted = [...injured].sort((a, b) => b.baseline_minutes - a.baseline_minutes);
  const take = sorted.slice(0, MAX_INJURED_TO_ANALYZE);
  const entries: InjuredPlayerContext[] = [];

  for (const inj of take) {
    const teammateIds = await getTopTeammateIds({
      teamId: inj.team_id,
      injuredPlayerId: inj.player_id,
      season: meta.season,
      limit: 12,
    });
    if (teammateIds.length === 0) continue;

    const { games_played, games_missed, rows } = await computeSplitsForInjured({
      teamId: inj.team_id,
      injuredPlayerId: inj.player_id,
      season: meta.season,
      teammateIds,
    });

    const names = await query<{ player_id: string; full_name: string }>(
      `SELECT player_id, full_name FROM analytics.players WHERE player_id = ANY($1::text[])`,
      [teammateIds]
    );
    const nameBy = new Map(names.map((n) => [n.player_id, n.full_name]));

    const teammates: TeammateSplitRow[] = [];
    for (const tid of teammateIds) {
      const cell = rows.get(tid);
      if (!cell) continue;
      const nWith = cell.n_with;
      const nWithout = cell.n_without;
      const avgPtsWith = nWith > 0 ? cell.sum_pts_with / nWith : null;
      const avgPtsWithout = nWithout > 0 ? cell.sum_pts_without / nWithout : null;
      const avgMinWith = nWith > 0 ? cell.sum_min_with / nWith : null;
      const avgMinWithout = nWithout > 0 ? cell.sum_min_without / nWithout : null;
      const ptsDelta =
        avgPtsWith != null && avgPtsWithout != null ? avgPtsWithout - avgPtsWith : null;
      teammates.push({
        player_id: tid,
        full_name: nameBy.get(tid) ?? tid,
        n_games_played_with: nWith,
        n_games_missed: nWithout,
        avg_pts_with: avgPtsWith != null ? Number(avgPtsWith.toFixed(1)) : null,
        avg_pts_without: avgPtsWithout != null ? Number(avgPtsWithout.toFixed(1)) : null,
        avg_min_with: avgMinWith != null ? Number(avgMinWith.toFixed(1)) : null,
        avg_min_without: avgMinWithout != null ? Number(avgMinWithout.toFixed(1)) : null,
        pts_delta: ptsDelta != null ? Number(ptsDelta.toFixed(1)) : null,
      });
    }

    teammates.sort((a, b) => Math.abs(b.pts_delta ?? 0) - Math.abs(a.pts_delta ?? 0));
    const top = teammates.slice(0, MAX_TEAMMATES_PER_INJURY);
    const low_sample =
      games_missed < 2 ||
      games_played < 2 ||
      top.some((t) => (t.n_games_missed > 0 && t.n_games_missed < 2) || (t.n_games_played_with > 0 && t.n_games_played_with < 2));

    entries.push({
      player_id: inj.player_id,
      full_name: inj.full_name,
      team_id: inj.team_id,
      status: inj.status,
      baseline_minutes: Number(inj.baseline_minutes.toFixed(1)),
      games_played_sample: games_played,
      games_missed_sample: games_missed,
      missed_definition: 'box_score_no_minutes',
      teammates: top,
      low_sample,
    });
  }

  return { season: meta.season, entries };
}
