/**
 * Read-only queries for the Last 5 video. SELECT only; no writes anywhere.
 */

import { query } from '@/lib/db';
import { parseMinutesText } from '@/lib/players/minutes-sql';
import {
  buildLast5Snapshot,
  consensusMainLine,
  type BookLineQuote,
  type PlayerGameLogInput,
} from './snapshot';
import type { Last5Market, Last5VideoSnapshot } from './types';

const ET_DATE = `(g.start_time AT TIME ZONE 'America/New_York')::date`;

/** Box-score column per market in analytics.player_game_logs. */
const MARKET_COLUMN: Record<Last5Market, string> = {
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  threes: 'three_pointers_made',
};

export interface TonightPropPlayer {
  playerId: string;
  playerName: string;
  gameId: string;
  teamAbbr: string;
  opponentAbbr: string;
  isHome: boolean;
  startTime: string;
  quotes: BookLineQuote[];
  linesAsOf: string;
}

interface PropRow {
  player_id: string;
  full_name: string;
  game_id: string;
  start_time: string;
  team_abbr: string | null;
  home_abbr: string;
  away_abbr: string;
  is_home: boolean | null;
  sportsbook: string;
  side: 'over' | 'under';
  line_value: number;
  implied_probability: number | null;
  snapshot_at: string;
}

/**
 * Players with an over/under prop in this market on the ET date. Uses each
 * book's newest snapshot. Players listed Out or Doubtful are excluded.
 */
export async function countGamesOnEtDate(date: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM analytics.games g
      WHERE (g.start_time AT TIME ZONE 'America/New_York')::date = $1::date`,
    [date]
  );
  return rows[0]?.n ?? 0;
}

export async function getTonightPropPlayers(
  date: string,
  market: Last5Market
): Promise<TonightPropPlayer[]> {
  const rows = await query<PropRow>(
    `WITH latest AS (
       SELECT p.*, max(p.snapshot_at) OVER (PARTITION BY p.game_id, p.player_id, p.sportsbook) AS book_latest
       FROM analytics.player_props_current p
       JOIN analytics.games g ON g.game_id = p.game_id::text
       WHERE ${ET_DATE} = $1::date AND p.prop_type = $2 AND p.market_type = 'over_under'
         AND p.side IN ('over', 'under')
     ),
     team_of AS (
       SELECT DISTINCT ON (pgl.player_id) pgl.player_id, pgl.team_id
       FROM analytics.player_game_logs pgl
       WHERE pgl.player_id IN (SELECT player_id::text FROM latest)
       ORDER BY pgl.player_id, pgl.game_date DESC
     )
     SELECT l.player_id::text, pl.full_name, l.game_id::text, g.start_time::text,
            pt.abbreviation AS team_abbr, ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr,
            CASE WHEN tof.team_id IS NULL THEN NULL ELSE tof.team_id = g.home_team_id END AS is_home,
            l.sportsbook, l.side, l.line_value::float AS line_value,
            l.implied_probability::float AS implied_probability, l.snapshot_at::text
     FROM latest l
     JOIN analytics.games g ON g.game_id = l.game_id::text
     JOIN analytics.players pl ON pl.player_id = l.player_id::text
     JOIN analytics.teams ht ON ht.team_id = g.home_team_id
     JOIN analytics.teams at ON at.team_id = g.away_team_id
     LEFT JOIN team_of tof ON tof.player_id = l.player_id::text
     LEFT JOIN analytics.teams pt ON pt.team_id = tof.team_id
     WHERE l.snapshot_at = l.book_latest
       AND NOT EXISTS (
         SELECT 1 FROM analytics.player_injury_status_current i
         WHERE i.player_id = l.player_id::text
           AND (LOWER(COALESCE(i.status, '')) LIKE 'out%' OR LOWER(COALESCE(i.status, '')) LIKE 'doubtful%')
       )`,
    [date, market]
  );

  const byPlayer = new Map<string, TonightPropPlayer>();
  for (const r of rows) {
    if (r.is_home == null || !r.team_abbr) continue;
    let p = byPlayer.get(r.player_id);
    if (!p) {
      p = {
        playerId: r.player_id,
        playerName: r.full_name,
        gameId: r.game_id,
        teamAbbr: r.team_abbr,
        opponentAbbr: r.is_home ? r.away_abbr : r.home_abbr,
        isHome: r.is_home,
        startTime: r.start_time,
        quotes: [],
        linesAsOf: r.snapshot_at,
      };
      byPlayer.set(r.player_id, p);
    }
    p.quotes.push({
      sportsbook: r.sportsbook,
      side: r.side,
      line: r.line_value,
      impliedProbability: r.implied_probability,
    });
    if (new Date(r.snapshot_at) > new Date(p.linesAsOf)) p.linesAsOf = r.snapshot_at;
  }
  return [...byPlayer.values()];
}

interface LogRow {
  game_date: string;
  opponent_abbr: string | null;
  is_home: boolean | null;
  value: number | null;
  minutes: string | null;
}

export async function getSeasonGameLogs(
  playerId: string,
  season: string,
  market: Last5Market
): Promise<PlayerGameLogInput[]> {
  const column = MARKET_COLUMN[market];
  const rows = await query<LogRow>(
    `SELECT pgl.game_date::text AS game_date, ot.abbreviation AS opponent_abbr, pgl.is_home,
            pgl.${column}::float AS value, pgl.minutes::text AS minutes
     FROM analytics.player_game_logs pgl
     LEFT JOIN analytics.teams ot ON ot.team_id = pgl.opponent_team_id
     WHERE pgl.player_id = $1 AND pgl.season = $2
     ORDER BY pgl.game_date DESC`,
    [playerId, season]
  );
  return rows
    .map((r) => ({
      date: r.game_date.slice(0, 10),
      opponentAbbr: r.opponent_abbr ?? '—',
      isHome: Boolean(r.is_home),
      value: r.value ?? 0,
      minutes: parseMinutesText(r.minutes),
    }))
    .filter((g) => (g.minutes ?? 0) > 0);
}

export function tipoffLabel(startTime: string): string {
  return (
    new Date(startTime).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    }) + ' ET'
  );
}

export async function loadLast5Snapshot(args: {
  player: TonightPropPlayer;
  date: string;
  season: string;
  market: Last5Market;
}): Promise<Last5VideoSnapshot | { error: string }> {
  const consensus = consensusMainLine(args.player.quotes);
  if (!consensus) return { error: `No over line for ${args.player.playerName}.` };
  const seasonGames = await getSeasonGameLogs(args.player.playerId, args.season, args.market);
  return buildLast5Snapshot({
    player: { id: args.player.playerId, name: args.player.playerName, teamAbbr: args.player.teamAbbr },
    tonight: {
      gameId: args.player.gameId,
      opponentAbbr: args.player.opponentAbbr,
      isHome: args.player.isHome,
      date: args.date,
      tipoffLabel: tipoffLabel(args.player.startTime),
    },
    market: args.market,
    line: consensus.line,
    bookCount: consensus.bookCount,
    linesAsOf: new Date(args.player.linesAsOf).toISOString(),
    seasonGames,
  });
}
