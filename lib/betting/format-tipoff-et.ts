/**
 * Betting slate tipoff formatting in America/New_York (matches slate ET date windows).
 */

const ET = 'America/New_York';

/** Format an ISO/timestamptz tipoff for betting UI in ET (e.g. "7:00 PM EDT"). */
export function formatTipoffEt(
  startTime: string | Date | null | undefined
): string {
  if (startTime == null || startTime === '') return '';
  const d = typeof startTime === 'string' ? new Date(startTime) : startTime;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ET,
    timeZoneName: 'short',
  });
}
