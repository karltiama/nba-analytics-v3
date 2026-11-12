import { normalizeGameStatus } from '@/lib/betting/normalize-game-status';

/**
 * A time of day with no calendar date and no am/pm marker.
 * "5:43" and "19:00" are ambiguous. An ISO timestamp and "7:00 pm" are not.
 */
export function isAmbiguousBareClockStatus(status: string | null | undefined): boolean {
  const text = String(status ?? '').trim();
  if (!text) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return false;
  if (/\d{1,2}:\d{2}\s*(am|pm)\b/i.test(text)) return false;
  return /^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(text);
}

/**
 * Quick Builds may treat a status as pregame only when the shared label is
 * Scheduled and the text is not an ambiguous bare clock.
 * ISO tip timestamps and explicit am/pm tip times still qualify here.
 * The caller also requires a future start on the current Eastern date.
 *
 * Live, halftime, overtime, final, postponed, canceled, delayed, and unknown
 * labels do not qualify. Final/OT is not Scheduled.
 * If an actual postponement is absent from every stored field, this function
 * cannot infer it.
 */
export function isQuickBuildPregameStatus(status: string | null | undefined): boolean {
  if (isAmbiguousBareClockStatus(status)) return false;
  return normalizeGameStatus(status) === 'Scheduled';
}

/** Quick Builds label. An overtime final stays Final. A blank status stays empty. */
export function quickBuildStatusLabel(status: string | null | undefined): string | null {
  if (typeof status !== 'string' || status.trim() === '') return null;
  if (/^final\b/i.test(status.trim())) return 'Final';
  return normalizeGameStatus(status);
}
