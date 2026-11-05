/**
 * `analytics.player_game_logs.minutes` is text. Seasons up to 2025-26 store decimal minutes ("32",
 * "32.5"); the 2026-27 BallDontLie nightly stores clock time ("22:51"). Never cast the column to
 * numeric directly: "22:51"::numeric throws and fails the whole query.
 */

/** Postgres regex for decimal minutes. Written for a JS template literal, so `\\.` reaches SQL as `\.`. */
export const DECIMAL_MINUTES_RE = '^[0-9]+(\\.[0-9]+)?$';
/** Postgres regex for clock minutes, "MM:SS". */
export const CLOCK_MINUTES_RE = '^[0-9]+:[0-5]?[0-9]$';

/** SQL expression: the column as decimal minutes ("22:51" → 22.85), or NULL when unparseable. */
export function minutesDecimalSql(column: string): string {
  return `(CASE
    WHEN ${column} ~ '${DECIMAL_MINUTES_RE}' THEN ${column}::numeric
    WHEN ${column} ~ '${CLOCK_MINUTES_RE}'
      THEN split_part(${column}, ':', 1)::numeric + split_part(${column}, ':', 2)::numeric / 60
    ELSE NULL
  END)`;
}
