/**
 * Product/display game status derived from BDL (or other) raw status strings.
 * Raw provider values stay in raw.games; this is for analytics/API/UI labels only.
 */

export const NORMALIZED_GAME_STATUSES = [
  'Scheduled',
  'In Progress',
  'Final',
  'Postponed',
  'Canceled',
  'Unknown',
] as const;

export type NormalizedGameStatus = (typeof NORMALIZED_GAME_STATUSES)[number];

/** Tipoff clock / ISO-like strings BDL often puts in `status` for future games. */
export function looksLikeTipoffOrDatetimeStatus(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  // ISO / date-prefixed
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  // "7:00 pm ET", "7:00 PM", etc.
  if (/\d{1,2}:\d{2}\s*(am|pm)/i.test(s)) return true;
  // Bare "19:00" / "7:00"
  if (/^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.test(s)) return true;
  return false;
}

/**
 * Map provider status → product status.
 * Ambiguous values that are not tipoff-like become `Unknown` (do not guess).
 */
export function normalizeGameStatus(raw: string | null | undefined): NormalizedGameStatus {
  if (raw == null || !String(raw).trim()) return 'Scheduled';
  const s = String(raw).trim();
  const lower = s.toLowerCase().replace(/\s+/g, ' ');

  if (lower === 'final') return 'Final';
  if (lower === 'scheduled') return 'Scheduled';
  if (
    lower === 'inprogress' ||
    lower === 'in progress' ||
    lower === 'live' ||
    lower === 'halftime' ||
    lower === 'in_progress'
  ) {
    return 'In Progress';
  }
  if (lower === 'postponed') return 'Postponed';
  if (lower === 'cancelled' || lower === 'canceled') return 'Canceled';

  if (looksLikeTipoffOrDatetimeStatus(s)) return 'Scheduled';

  return 'Unknown';
}

/** True when the game should be treated as completed for scores / settle filters. */
export function isFinalStatus(raw: string | null | undefined): boolean {
  return normalizeGameStatus(raw) === 'Final';
}
