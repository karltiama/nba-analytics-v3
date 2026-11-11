/**
 * Eastern display time shared by Quick Builds cards and the My Parlay ticket.
 * America/New_York supplies EST or EDT. This is a start time, not a team matchup.
 */

export function formatEtTimestamp(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const dayPeriod = get('dayPeriod');
  const zone = get('timeZoneName');
  if (!month || !day || !hour || !minute || !dayPeriod || !zone) return null;
  return `${month} ${day}, ${hour}:${minute} ${dayPeriod} ${zone}`;
}

/** Prefix used on the Quick Builds card: "Game start Nov 9, 7:30 PM EST". */
export function withGameStartPrefix(formattedTimestamp: string): string {
  return `Game start ${formattedTimestamp}`;
}

/**
 * Readable start line for a trusted Quick Build snapshot time.
 * Returns null when the timestamp cannot be formatted. Callers must not invent a label.
 */
export function quickBuildGameStartLine(iso: string | null | undefined): string | null {
  const trimmed = typeof iso === 'string' ? iso.trim() : '';
  if (!trimmed) return null;
  const formatted = formatEtTimestamp(trimmed);
  if (!formatted) return null;
  return withGameStartPrefix(formatted);
}
