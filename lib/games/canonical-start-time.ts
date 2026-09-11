/**
 * Provider datetime → UTC Date for analytics.games.start_time.
 * Do not persist Eastern as a canonical column; UI converts later.
 */

export function canonicalStartTimeUtc(
  datetime: string | null | undefined,
  date: string | null | undefined
): Date | null {
  const rawDt = datetime != null ? String(datetime).trim() : '';
  if (rawDt) {
    const parsed = new Date(rawDt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const rawDate = date != null ? String(date).trim() : '';
  const ymd = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
  if (ymd) {
    const noon = new Date(`${ymd[1]}T12:00:00.000Z`);
    if (!Number.isNaN(noon.getTime())) return noon;
  }
  return null;
}

export function startTimeIsoUtc(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
