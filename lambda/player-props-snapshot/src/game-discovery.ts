import type { Pool } from 'pg';
import type { GameTarget } from './types';

export type PropUniverse = 'broad' | 'near_tip';

export const NEAR_TIP_START_MINUTES = 60;
export const NEAR_TIP_END_MINUTES = 75;

export function getTodayET(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function parsePropUniverse(raw: unknown): PropUniverse | null {
  if (raw === 'broad' || raw === 'near_tip') return raw;
  return null;
}

export function etDateKey(instant: Date): string {
  return instant.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** Later same-day games that have not tipped and are not Final. */
export function isBroadEligible(
  start: Date,
  now: Date,
  status: string | null,
  date: string
): boolean {
  if (status === 'Final') return false;
  if (!(start.getTime() > now.getTime())) return false;
  return etDateKey(start) === date;
}

/**
 * Games whose tip is in [now+60m, now+75m).
 * T−60 is included. T−75, T−59, and T−76 are not.
 */
export function isNearTipEligible(start: Date, now: Date, status: string | null): boolean {
  if (status === 'Final') return false;
  const deltaMs = start.getTime() - now.getTime();
  return deltaMs >= NEAR_TIP_START_MINUTES * 60_000 && deltaMs < NEAR_TIP_END_MINUTES * 60_000;
}

export const BROAD_TARGET_SQL = `
SELECT game_id
FROM analytics.games
WHERE start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
  AND start_time <  (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
  AND start_time > $2::timestamptz
  AND status IS DISTINCT FROM 'Final'
`;

export const NEAR_TIP_TARGET_SQL = `
SELECT game_id
FROM analytics.games
WHERE start_time >= $1::timestamptz + interval '60 minutes'
  AND start_time <  $1::timestamptz + interval '75 minutes'
  AND status IS DISTINCT FROM 'Final'
`;

function toTargets(rows: Array<{ game_id: string }>): GameTarget[] {
  return rows
    .map((r) => ({
      gameId: r.game_id,
      bdlGameId: Number.parseInt(r.game_id, 10),
    }))
    .filter((g) => Number.isFinite(g.bdlGameId));
}

export async function getGameTargets(args: {
  pool: Pool;
  universe: PropUniverse;
  date: string;
  now?: Date;
}): Promise<GameTarget[]> {
  const now = args.now ?? new Date();
  if (args.universe === 'broad') {
    const result = await args.pool.query(BROAD_TARGET_SQL, [args.date, now.toISOString()]);
    return toTargets(result.rows);
  }
  const result = await args.pool.query(NEAR_TIP_TARGET_SQL, [now.toISOString()]);
  return toTargets(result.rows);
}
