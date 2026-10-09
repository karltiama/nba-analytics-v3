import type { Pool } from 'pg';
import type { GameTarget } from './types';
import { etDateOfInstant, SERVING_SEASON_PHASES, servingDateDecision } from './season-eligibility';

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

/** season_phase is read via to_jsonb so the query works before that column exists (null = unknown). */
const TARGET_COLUMNS = `g.game_id, g.season::text AS season, g.start_time, to_jsonb(g)->>'season_phase' AS season_phase`;

export const BROAD_TARGET_SQL = `
SELECT ${TARGET_COLUMNS}
FROM analytics.games g
WHERE g.start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
  AND g.start_time <  (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
  AND g.start_time > $2::timestamptz
  AND g.status IS DISTINCT FROM 'Final'
`;

export const NEAR_TIP_TARGET_SQL = `
SELECT ${TARGET_COLUMNS}
FROM analytics.games g
WHERE g.start_time >= $1::timestamptz + interval '60 minutes'
  AND g.start_time <  $1::timestamptz + interval '75 minutes'
  AND g.status IS DISTINCT FROM 'Final'
`;

export type TargetRow = {
  game_id: string;
  season?: string | number | null;
  start_time?: string | Date | null;
  season_phase?: string | null;
};

/**
 * Props only for regular-season/postseason games of a known season on or after opening night (ET).
 * A labelled season_phase must be a serving phase; an absent label falls back to the date fence.
 */
export function isPropsTargetEligible(row: TargetRow): boolean {
  if (!servingDateDecision(row.season, etDateOfInstant(row.start_time)).eligible) return false;
  const phase = row.season_phase == null ? '' : String(row.season_phase).trim();
  return phase === '' || SERVING_SEASON_PHASES.has(phase);
}

function toTargets(rows: TargetRow[]): GameTarget[] {
  return rows
    .filter((r) => {
      if (isPropsTargetEligible(r)) return true;
      console.warn(
        JSON.stringify({ evt: 'props_target_fenced', gameId: r.game_id, season: r.season ?? null, seasonPhase: r.season_phase ?? null })
      );
      return false;
    })
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
