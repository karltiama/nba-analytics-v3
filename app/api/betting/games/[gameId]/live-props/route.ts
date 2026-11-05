import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { query } from '@/lib/db';
import { minutesDecimalSql } from '@/lib/players/minutes-sql';
import { gamePhase } from '@/lib/scoreboard/game-pulse';
import { formatPeriodClock } from '@/lib/scoreboard/present';
import type { GameLifecycleState } from '@/lib/betting/normalize-game-status';
import {
  buildLivePropRows,
  consensusLines,
  LIVE_PROP_TYPES,
  type LiveBoxLine,
  type PropQuoteRow,
} from '@/lib/betting/live-props';
import type { LivePropsResponse } from '@/lib/betting/live-props-response';

/** Recent played games used for a player's usual minutes. */
const TYPICAL_MINUTES_GAMES = 10;

type GameRow = {
  game_id: string;
  lifecycle: GameLifecycleState;
  period: number | null;
  clock: string | null;
  overtime_periods: number;
  home_team_id: string;
  home_abbr: string | null;
  home_score: number | null;
  visitor_team_id: string;
  visitor_abbr: string | null;
  visitor_score: number | null;
  et_date: string;
  box_observed_at: Date | null;
  last_observed_at: Date | null;
};

/**
 * GET /api/betting/games/[gameId]/live-props
 *
 * Follow-live board: each player prop's pregame consensus line (analytics.player_props_current) against
 * his live box line (display.scoreboard_player_lines). No in-game odds exist; props stop at tip.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ gameId: string }> }) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    const { gameId } = await params;
    const games = await query<GameRow>(
      `SELECT game_id, lifecycle, period, clock, overtime_periods,
              home_team_id, home_abbr, home_score, visitor_team_id, visitor_abbr, visitor_score,
              et_date::text AS et_date, box_observed_at, last_observed_at
       FROM display.scoreboard_games
       WHERE game_id = $1`,
      [gameId]
    );
    const game = games[0];
    if (!game) {
      const empty: LivePropsResponse = { game: null, rows: [] };
      return NextResponse.json(empty);
    }

    const phase = gamePhase(game.lifecycle);
    const header: NonNullable<LivePropsResponse['game']> = {
      gameId: game.game_id,
      phase,
      clockLabel: formatPeriodClock({
        lifecycle: game.lifecycle,
        period: game.period,
        clock: game.clock,
        overtime_periods: game.overtime_periods,
      }),
      period: game.period,
      home: { teamId: game.home_team_id, abbr: game.home_abbr, score: game.home_score },
      visitor: { teamId: game.visitor_team_id, abbr: game.visitor_abbr, score: game.visitor_score },
      boxObservedAt: game.box_observed_at?.toISOString() ?? null,
      observedAt: game.last_observed_at?.toISOString() ?? null,
    };
    if (phase !== 'live' && phase !== 'final') {
      const body: LivePropsResponse = { game: header, rows: [] };
      return NextResponse.json(body);
    }

    const [quotes, box] = await Promise.all([
      query<{
        player_id: string;
        player_name: string | null;
        sportsbook: string;
        prop_type: string;
        line_value: string;
        side: string;
        odds_american: number | null;
        odds_decimal: string | null;
      }>(
        `SELECT p.player_id::text AS player_id, p.player_name, p.sportsbook, p.prop_type,
                p.line_value::text AS line_value, p.side, p.odds_american, p.odds_decimal::text AS odds_decimal
         FROM analytics.player_props_current p
         WHERE p.game_id::text = $1
           AND lower(coalesce(p.market_type, '')) = 'over_under'
           AND p.prop_type = ANY($2)`,
        [gameId, LIVE_PROP_TYPES]
      ),
      query<{
        player_id: string;
        team_id: string;
        name: string | null;
        min: string | null;
        pts: number | null;
        reb: number | null;
        ast: number | null;
        fg3m: number | null;
      }>(
        `SELECT player_id, team_id, name, min, pts, reb, ast, fg3m
         FROM display.scoreboard_player_lines
         WHERE game_id = $1`,
        [gameId]
      ),
    ]);

    const quoteRows: PropQuoteRow[] = quotes.map((r) => ({
      playerId: r.player_id,
      playerName: r.player_name,
      sportsbook: r.sportsbook,
      propType: r.prop_type,
      lineValue: Number(r.line_value),
      side: r.side,
      oddsAmerican: r.odds_american,
      oddsDecimal: r.odds_decimal == null ? null : Number(r.odds_decimal),
    }));
    const lines = consensusLines(quoteRows);
    const playerIds = [...new Set(lines.map((l) => l.playerId))];

    const typicalMinutes = new Map<string, number>();
    if (playerIds.length > 0) {
      const minutesExpr = minutesDecimalSql('l.minutes');
      const typical = await query<{ player_id: string; avg_minutes: string | null }>(
        `SELECT player_id, avg(mins)::text AS avg_minutes
         FROM (
           SELECT l.player_id, ${minutesExpr} AS mins,
                  row_number() OVER (PARTITION BY l.player_id ORDER BY l.game_date DESC) AS rn
           FROM analytics.player_game_logs l
           WHERE l.player_id = ANY($1)
             AND l.game_date < $2::date
             AND l.game_id <> $3
             AND ${minutesExpr} > 0
         ) x
         WHERE rn <= $4
         GROUP BY player_id`,
        [playerIds, game.et_date, gameId, TYPICAL_MINUTES_GAMES]
      );
      for (const t of typical) {
        const v = t.avg_minutes == null ? NaN : Number(t.avg_minutes);
        if (Number.isFinite(v) && v > 0) typicalMinutes.set(t.player_id, v);
      }
    }

    const boxLines: LiveBoxLine[] = box.map((b) => ({
      playerId: b.player_id,
      teamId: b.team_id,
      name: b.name,
      min: b.min,
      pts: b.pts,
      reb: b.reb,
      ast: b.ast,
      fg3m: b.fg3m,
    }));

    const rows = buildLivePropRows({
      lines,
      box: boxLines,
      typicalMinutes,
      period: game.period,
      clock: game.clock,
      final: phase === 'final',
    });

    const body: LivePropsResponse = { game: header, rows };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error: unknown) {
    console.error('[live-props] failed', { error: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: 'Failed to load live props' }, { status: 500 });
  }
}
