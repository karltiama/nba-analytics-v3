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

/** BDL live-period strings: "1st Qtr", "End of 3rd Qtr", "Q4", "OT", "2OT", "End of OT". */
const LIVE_PERIOD_STATUS = /^(?:(?:end of )?(?:1st|2nd|3rd|4th) qtr|q[1-4]|end of (?:1st|2nd|3rd|4th|q[1-4])|(?:end of )?\d?ot\d?|overtime)\b/;
const OVERTIME_STATUS = /(?:^|\s)\d?ot\d?\b|overtime/;

function lowerStatus(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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
    lower === 'in_progress' ||
    LIVE_PERIOD_STATUS.test(lower)
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

export const GAME_LIFECYCLE_STATES = [
  'scheduled',
  'live',
  'halftime',
  'overtime',
  'final',
  'postponed',
  'canceled',
  'unknown',
] as const;

export type GameLifecycleState = (typeof GAME_LIFECYCLE_STATES)[number];

/** BDL `status_state` values. Only these are trusted; anything else falls back to `status`. */
export const PROVIDER_STATUS_STATES = [
  'scheduled',
  'in_progress',
  'final',
  'postponed',
  'canceled',
  'delayed',
  'suspended',
  'abandoned',
  'unknown',
] as const;

/**
 * Legacy rows (status still the tip timestamp) are shown as Final from proven scores only
 * once no game can still be running. A live status string or a recent tip never qualifies.
 */
export const LEGACY_FINAL_MIN_ELAPSED_MS = 6 * 60 * 60 * 1000;

export type ResolveDisplayGameStatusInput = {
  statusRaw: string | null | undefined;
  /** Provider lifecycle (BDL `status_state`) when the source carries it. */
  statusState?: string | null;
  period?: number | null;
  postponed?: boolean | null;
  startTime?: string | Date | null;
  homeScore?: number | null;
  awayScore?: number | null;
  now?: Date;
};

function liveDetail(statusRaw: string | null | undefined, period: number | null | undefined): GameLifecycleState {
  const lower = lowerStatus(statusRaw);
  if (lower.startsWith('half')) return 'halftime';
  if (OVERTIME_STATUS.test(lower)) return 'overtime';
  if (period != null && Number.isFinite(period) && period > 4) return 'overtime';
  return 'live';
}

function lifecycleFromStatusState(input: ResolveDisplayGameStatusInput): GameLifecycleState | null {
  const state = lowerStatus(input.statusState);
  if (!(PROVIDER_STATUS_STATES as readonly string[]).includes(state) || state === 'unknown') return null;
  switch (state) {
    case 'scheduled':
      return 'scheduled';
    case 'in_progress':
      return liveDetail(input.statusRaw, input.period);
    case 'final':
      return 'final';
    case 'postponed':
      return 'postponed';
    case 'canceled':
      return 'canceled';
    default:
      return 'unknown';
  }
}

/**
 * Presentation lifecycle with explicit precedence:
 * 1. Provider postponed flag, then a recognised `status_state`
 * 2. Explicit status: Final / live period / halftime / overtime / Postponed / Canceled
 * 3. Tipoff-like or "Scheduled": future start → scheduled
 * 4. Legacy leftover-tipoff rows: proven scores ≥ 6h after tip → final
 * 5. Everything else → unknown (never a calendar-only or score-only Final)
 * Independent of season-phase eligibility: it only describes the game's state.
 */
export function resolveGameLifecycle(input: ResolveDisplayGameStatusInput): GameLifecycleState {
  if (input.postponed === true) return 'postponed';
  const fromState = lifecycleFromStatusState(input);
  if (fromState) return fromState;

  const lower = lowerStatus(input.statusRaw);
  if (/^final\b/.test(lower)) return 'final';
  const mapped = normalizeGameStatus(input.statusRaw);
  if (mapped === 'In Progress') return liveDetail(input.statusRaw, input.period);
  if (mapped === 'Postponed') return 'postponed';
  if (mapped === 'Canceled') return 'canceled';

  const now = input.now ?? new Date();
  let start = parseInstant(input.startTime);
  if (!start && looksLikeTipoffOrDatetimeStatus(String(input.statusRaw ?? ''))) {
    start = parseInstant(input.statusRaw);
  }
  const started = start != null && start.getTime() <= now.getTime();
  if (!started && start != null && (mapped === 'Scheduled' || !lower)) return 'scheduled';
  if (!start && lower === 'scheduled') return 'scheduled';

  if (
    (mapped === 'Scheduled' || mapped === 'Unknown') &&
    start != null &&
    now.getTime() - start.getTime() >= LEGACY_FINAL_MIN_ELAPSED_MS &&
    hasProvenFinalScores(input.homeScore, input.awayScore)
  ) {
    return 'final';
  }
  return 'unknown';
}

const DISPLAY_STATUS_BY_LIFECYCLE: Record<GameLifecycleState, NormalizedGameStatus> = {
  scheduled: 'Scheduled',
  live: 'In Progress',
  halftime: 'In Progress',
  overtime: 'In Progress',
  final: 'Final',
  postponed: 'Postponed',
  canceled: 'Canceled',
  unknown: 'Unknown',
};

/** Product status for existing UI badges; live, halftime and overtime all display as In Progress. */
export function resolveDisplayGameStatus(
  input: ResolveDisplayGameStatusInput
): NormalizedGameStatus {
  return DISPLAY_STATUS_BY_LIFECYCLE[resolveGameLifecycle(input)];
}

export function displayGameStatusLabel(status: NormalizedGameStatus | string | null | undefined): string {
  if (!status) return 'Status unavailable';
  if (status === 'Unknown') return 'Status unavailable';
  return status;
}
