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
 * Empty/null is Unknown at this layer; `resolveDisplayGameStatus` may still
 * treat a future start_time as Scheduled.
 */
export function normalizeGameStatus(raw: string | null | undefined): NormalizedGameStatus {
  if (raw == null || !String(raw).trim()) return 'Unknown';
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

function parseInstant(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 0-0 is the unplayed default in analytics.games for this corpus, not proof of a completed game.
 * A trusted Final requires explicit Final status or two finite non-(0-0) scores.
 */
export function hasProvenFinalScores(
  homeScore: number | null | undefined,
  awayScore: number | null | undefined
): boolean {
  if (homeScore == null || awayScore == null) return false;
  const h = Number(homeScore);
  const a = Number(awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return false;
  if (h === 0 && a === 0) return false;
  return true;
}

export type ResolveDisplayGameStatusInput = {
  statusRaw: string | null | undefined;
  startTime?: string | Date | null;
  homeScore?: number | null;
  awayScore?: number | null;
  now?: Date;
};

/**
 * Display status with explicit precedence:
 * 1. Explicit Final / In Progress / Postponed / Canceled
 * 2. Proven scores → Final
 * 3. Scheduled / tipoff-like: future start → Scheduled; past start without scores → Unknown
 * 4. Empty/ambiguous → Unknown (never a false Scheduled, never a calendar-only Final)
 */
export function resolveDisplayGameStatus(
  input: ResolveDisplayGameStatusInput
): NormalizedGameStatus {
  const mapped = normalizeGameStatus(input.statusRaw);
  if (
    mapped === 'Final' ||
    mapped === 'In Progress' ||
    mapped === 'Postponed' ||
    mapped === 'Canceled'
  ) {
    return mapped;
  }

  if (hasProvenFinalScores(input.homeScore, input.awayScore)) {
    return 'Final';
  }

  const now = input.now ?? new Date();
  let start = parseInstant(input.startTime);
  if (!start && looksLikeTipoffOrDatetimeStatus(String(input.statusRaw ?? ''))) {
    start = parseInstant(input.statusRaw);
  }

  if (mapped === 'Scheduled') {
    if (start && start.getTime() > now.getTime()) return 'Scheduled';
    if (start && start.getTime() <= now.getTime()) return 'Unknown';
    const rawLower = String(input.statusRaw ?? '').trim().toLowerCase();
    if (rawLower === 'scheduled') return 'Scheduled';
    return 'Unknown';
  }

  if (!String(input.statusRaw ?? '').trim() && start && start.getTime() > now.getTime()) {
    return 'Scheduled';
  }

  return 'Unknown';
}

export function displayGameStatusLabel(status: NormalizedGameStatus | string | null | undefined): string {
  if (!status) return 'Status unavailable';
  if (status === 'Unknown') return 'Status unavailable';
  return status;
}
