/**
 * `analytics.player_game_logs.minutes` is text. Seasons up to 2025-26 store decimal minutes ("32",
 * "32.5"); the 2026-27 BallDontLie nightly stores clock time ("22:51"). Never cast the column to
 * numeric directly: "22:51"::numeric throws and fails the whole query.
 */

/** Postgres regex for decimal minutes. Written for a JS template literal, so `\\.` reaches SQL as `\.`. */
export const DECIMAL_MINUTES_RE = '^[0-9]+(\\.[0-9]+)?$';
/** Postgres regex for clock minutes, "MM:SS". */
export const CLOCK_MINUTES_RE = '^[0-9]+:[0-5]?[0-9]$';

/**
 * JS twin of minutesDecimalSql: 32 / "32" / "32.5" as-is, "22:51" -> 22.85, anything else null.
 * Use it wherever a game log's minutes are parsed; Number.parseFloat("22:51") silently gives 22.
 */
export function parseMinutesText(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = value.trim();
  if (new RegExp(DECIMAL_MINUTES_RE).test(s)) return Number(s);
  if (new RegExp(CLOCK_MINUTES_RE).test(s)) {
    const [m, sec] = s.split(':');
    return Number(m) + Number(sec) / 60;
  }
  return null;
}

/** SQL expression: the column as decimal minutes ("22:51" → 22.85), or NULL when unparseable. */
export function minutesDecimalSql(column: string): string {
  return `(CASE
    WHEN ${column} ~ '${DECIMAL_MINUTES_RE}' THEN ${column}::numeric
    WHEN ${column} ~ '${CLOCK_MINUTES_RE}'
      THEN split_part(${column}, ':', 1)::numeric + split_part(${column}, ':', 2)::numeric / 60
    ELSE NULL
  END)`;
}
