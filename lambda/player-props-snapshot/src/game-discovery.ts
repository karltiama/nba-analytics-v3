import type { Pool } from 'pg';
import type { GameTarget } from './types';

export function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export async function getGameTargetsForDate(pool: Pool, dateStr: string): Promise<GameTarget[]> {
  const result = await pool.query(
    `SELECT game_id
     FROM analytics.games
     WHERE start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
       AND start_time <  (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
       AND status != 'Final'`,
    [dateStr]
  );

  const rows = result.rows.length > 0
    ? result.rows
    : (
      await pool.query(
        `SELECT game_id
         FROM analytics.games
         WHERE start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
           AND start_time <  (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')`,
        [dateStr]
      )
    ).rows;

  return rows
    .map((r: { game_id: string }) => ({
      gameId: r.game_id,
      bdlGameId: Number.parseInt(r.game_id, 10),
    }))
    .filter((g) => Number.isFinite(g.bdlGameId));
}
