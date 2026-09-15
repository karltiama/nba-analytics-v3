/**
 * America/New_York basketball date + play-in-inclusive postseason floor.
 * Values match POSTSEASON_START_ET / etCalendarDate in minutes-projection-eval.ts.
 */

export const WOWY_POSTSEASON_START_ET: Record<string, string> = {
  '2023': '2024-04-16',
  '2024': '2025-04-15',
  '2025': '2026-04-14',
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
