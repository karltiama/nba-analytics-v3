import type { Pool } from 'pg';
import type { GameTarget } from './types';
import { etDateOfInstant, SERVING_SEASON_PHASES, servingDateDecision } from './season-eligibility';

export type PropUniverse = 'broad' | 'near_tip' | 'closing' | 'pregame_refresh';

export const NEAR_TIP_START_MINUTES = 60;
export const NEAR_TIP_END_MINUTES = 75;

/**
 * Closing pull: games tipping in [now+10m, now+15m). Polled every 5 minutes, so a game
 * scheduled on the hour or half hour is collected once, at T-10. Ten minutes leaves room for
 * the rate limiter and SQS before the write-time pregame gate (start_time > clock_timestamp()).
 */
export const CLOSING_START_MINUTES = 10;
export const CLOSING_END_MINUTES = 15;

/** Final two hours, excluding the last 15 minutes. Closing collects once inside [T-10, T-15). */
export const PREGAME_REFRESH_HORIZON_MINUTES = 120;
export const PREGAME_REFRESH_FLOOR_MINUTES = 15;
export const PREGAME_REFRESH_INTERVAL_MS = 15 * 60_000;
export const PREGAME_REFRESH_INTERVAL_SECONDS = 15 * 60;

export function getTodayET(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function parsePropUniverse(raw: unknown): PropUniverse | null {
  if (raw === 'broad' || raw === 'near_tip' || raw === 'closing' || raw === 'pregame_refresh') return raw;
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

/** Games whose tip is in [now+10m, now+15m). T-10 is included; T-15 and T-9 are not. */
export function isClosingEligible(start: Date, now: Date, status: string | null): boolean {
  if (status === 'Final') return false;
  const deltaMs = start.getTime() - now.getTime();
  return deltaMs >= CLOSING_START_MINUTES * 60_000 && deltaMs < CLOSING_END_MINUTES * 60_000;
}

/**
 * Statuses the write-time pregame gate will accept.
 * Final, live, postponed, and cancelled games are not refresh candidates.
 */
export function isPregameCollectionStatus(status: string | null): boolean {
  const trimmed = (status ?? '').trim();
  const normalized = trimmed.replace(/\s+/g, ' ').toLowerCase();
  if (normalized === 'final') return false;
  if (
    normalized === 'inprogress' ||
    normalized === 'in progress' ||
    normalized === 'live' ||
    normalized === 'halftime' ||
    normalized === 'in_progress' ||
    normalized === 'overtime' ||
    normalized === 'postponed' ||
    normalized === 'cancelled' ||
    normalized === 'canceled'
  ) {
    return false;
  }
  if (/^(end of )?(1st|2nd|3rd|4th) qtr($|[^a-z0-9])/.test(normalized)) return false;
  if (/^q[1-4]($|[^a-z0-9])/.test(normalized)) return false;
  if (/^(end of )?[0-9]?ot[0-9]?($|[^a-z0-9])/.test(normalized)) return false;
  if (normalized === 'scheduled') return true;
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(trimmed)) return true;
  if (/[0-9]{1,2}:[0-9]{2}\s*(am|pm)/i.test(trimmed)) return true;
  if (/^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?([.][0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})?$/i.test(trimmed)) return true;
  return false;
}

/**
 * More than 15 minutes before tip, and at most 120. T-120 is included.
 * Exactly T-15 is not: the closing schedule collects that game once at T-10,
 * so a T-15 refresh would be a second pull five minutes later.
 * Tips do not have to fall on a quarter hour.
 */
export function isPregameRefreshWindow(start: Date, now: Date): boolean {
  const deltaMs = start.getTime() - now.getTime();
  return deltaMs > PREGAME_REFRESH_FLOOR_MINUTES * 60_000 && deltaMs <= PREGAME_REFRESH_HORIZON_MINUTES * 60_000;
}

export function isPregameRefreshSelectable(start: Date, now: Date, status: string | null): boolean {
  return isPregameCollectionStatus(status) && isPregameRefreshWindow(start, now);
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

export const CLOSING_TARGET_SQL = `
SELECT ${TARGET_COLUMNS}
FROM analytics.games g
WHERE g.start_time >= $1::timestamptz + interval '10 minutes'
  AND g.start_time <  $1::timestamptz + interval '15 minutes'
  AND g.status IS DISTINCT FROM 'Final'
`;

export type TargetRow = {
  game_id: string;
  season?: string | number | null;
  start_time?: string | Date | null;
  season_phase?: string | null;
  status?: string | null;
};

export const PREGAME_REFRESH_TARGET_SQL = `
SELECT ${TARGET_COLUMNS}, g.status
FROM analytics.games g
WHERE g.start_time > $1::timestamptz + interval '15 minutes'
  AND g.start_time <= $1::timestamptz + interval '120 minutes'
  AND g.status IS DISTINCT FROM 'Final'
`;

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
      startTime: r.start_time == null ? null : new Date(r.start_time).toISOString(),
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
  if (args.universe === 'pregame_refresh') {
    const result = await args.pool.query<TargetRow>(PREGAME_REFRESH_TARGET_SQL, [now.toISOString()]);
    const rows = result.rows.filter((row) => {
      if (row.start_time == null) return false;
      return isPregameRefreshSelectable(new Date(row.start_time), now, row.status ?? null);
    });
    return toTargets(rows);
  }
  const sql = args.universe === 'closing' ? CLOSING_TARGET_SQL : NEAR_TIP_TARGET_SQL;
  const result = await args.pool.query(sql, [now.toISOString()]);
  return toTargets(result.rows);
}
