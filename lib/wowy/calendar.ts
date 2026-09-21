/**
 * America/New_York basketball date + play-in-inclusive postseason floor.
 * Values match POSTSEASON_START_ET / etCalendarDate in minutes-projection-eval.ts.
 */

export const WOWY_POSTSEASON_START_ET: Record<string, string> = {
  '2023': '2024-04-16',
  '2024': '2025-04-15',
  '2025': '2026-04-14',
};

/**
 * NBA Cup Championship tip dates (America/New_York calendar).
 *
 * Group / knockout Cup games count toward the official 82-game RS slate.
 * The Championship is ingested into team_game_stats with postseason=false and
 * a tip before the play-in floor, but it is **not** one of the 82 official
 * regular-season games (BBR / public standings). Including it creates
 * impossible 83-game RS totals for finalists (SAS/NYK in 2025).
 *
 * Public REGULAR_SEASON snapshots must exclude these dates.
 * Internal all-games aggregates are unaffected (they do not use this list).
 */
export const NBA_CUP_CHAMPIONSHIP_ET: Record<string, readonly string[]> = {
  '2025': ['2025-12-16'],
};

const ET_CALENDAR_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function etCalendarDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return ET_CALENDAR_DATE.format(new Date(ms));
}

export function isPostseasonGame(season: string, startTime: string): boolean {
  const start = WOWY_POSTSEASON_START_ET[String(season)];
  if (!start) return false;
  const d = etCalendarDate(startTime);
  return d != null && d >= start;
}
