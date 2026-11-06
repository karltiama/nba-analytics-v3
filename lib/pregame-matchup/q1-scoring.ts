import { minutesDecimalSql } from '@/lib/players/minutes-sql';

/**
 * First-quarter scoring for the players listed under Likely starters.
 * Source: analytics.player_period_scoring (BDL play-by-play), only games whose play-by-play
 * matches the box score (game_reconciled). A game the player played with no Q1 row is 0 points.
 */

export const Q1_LAST_N = 5;

/** One game a player played (minutes > 0), with his Q1 points. */
export type Q1GameRow = {
  playerId: string;
  season: string;
  /** ET date, YYYY-MM-DD. */
  date: string;
  gameId: string;
  q1Points: number;
};

export type Q1SeasonLine = {
  games: number;
  avg: number;
};

export type PlayerQ1 = {
  /** This season, games before this one. Null with no games. */
  current: (Q1SeasonLine & { lastN: number[] }) | null;
  /** Last season. Null with no games. */
  previous: Q1SeasonLine | null;
};

export type StarterQ1Model = {
  seasonLabel: string;
  previousSeasonLabel: string;
  players: Record<string, PlayerQ1>;
};

export const STARTER_Q1_SQL = `
  SELECT l.player_id, l.season, l.game_date::text AS game_date, l.game_id,
         COALESCE(s.points, 0)::int AS q1_points
  FROM analytics.player_game_logs l
  LEFT JOIN analytics.player_period_scoring s
    ON s.game_id = l.game_id AND s.player_id = l.player_id AND s.period = 1
  WHERE l.player_id = ANY($1::text[])
    AND l.season = ANY($2::text[])
    AND l.game_date < $3::date
    AND ${minutesDecimalSql('l.minutes')} > 0
    AND EXISTS (
      SELECT 1 FROM analytics.player_period_scoring r
      WHERE r.game_id = l.game_id AND r.game_reconciled
    )`;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildStarterQ1(input: {
  season: string;
  seasonLabel: string;
  previousSeasonLabel: string;
  playerIds: string[];
  rows: Q1GameRow[];
}): StarterQ1Model | null {
  const previousSeason = String(Number(input.season) - 1);
  const players: Record<string, PlayerQ1> = {};
  let any = false;
  for (const playerId of input.playerIds) {
    const mine = input.rows.filter((r) => r.playerId === playerId);
    const cur = mine
      .filter((r) => r.season === input.season)
      .sort((a, b) => (a.date === b.date ? b.gameId.localeCompare(a.gameId) : b.date.localeCompare(a.date)));
    const prev = mine.filter((r) => r.season === previousSeason);
    const line = (rows: Q1GameRow[]): Q1SeasonLine | null =>
      rows.length === 0 ? null : { games: rows.length, avg: round1(rows.reduce((n, r) => n + r.q1Points, 0) / rows.length) };
    const current = line(cur);
    players[playerId] = {
      current: current ? { ...current, lastN: cur.slice(0, Q1_LAST_N).map((r) => r.q1Points) } : null,
      previous: line(prev),
    };
    if (current || players[playerId].previous) any = true;
  }
  if (!any) return null;
  return { seasonLabel: input.seasonLabel, previousSeasonLabel: input.previousSeasonLabel, players };
}

/** Every player the starters section names: likely five, swapped-out starters, regulars back. */
export function starterPlayerIds(starters: {
  teams: {
    likely: { playerId: string; replaces: { playerId: string } | null }[] | null;
    regularsBack: { playerId: string }[];
  }[];
}): string[] {
  const ids = new Set<string>();
  for (const team of starters.teams) {
    for (const p of team.likely ?? []) ids.add(p.playerId);
    for (const p of team.regularsBack) ids.add(p.playerId);
  }
  return [...ids];
}
