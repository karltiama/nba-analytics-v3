/**
 * Authoritative finalization clock for the future 72-hour post-final hold.
 * The clock is the time an ingestion path observed Final. It is not tip time,
 * created_at, or updated_at. This module does not archive or delete anything.
 */

import { looksLikeTipoffOrDatetimeStatus, normalizeGameStatus } from '@/lib/betting/normalize-game-status';

export const POST_FINAL_HOLD_MS = 72 * 60 * 60 * 1000;

export const AUTHORITATIVE_GAME_STATES = [
  'scheduled',
  'live',
  'halftime',
  'final',
  'postponed',
  'delayed',
  'canceled',
  'unknown',
] as const;

export type AuthoritativeGameState = (typeof AUTHORITATIVE_GAME_STATES)[number];

export type FinalizationClockRow = {
  status: string | null;
  finalizedAt: string | null;
  statusObservedAt: string | null;
  finalizationState: AuthoritativeGameState | null;
};

export type FinalizationObservation = {
  status: string | null;
  /** Receipt time of this provider evidence. Null refuses to move the clock. */
  observedAt: string | null;
};

export type FinalizationDecision = {
  apply: boolean;
  reason: string;
  status: string | null;
  finalizedAt: string | null;
  statusObservedAt: string | null;
  finalizationState: AuthoritativeGameState | null;
  invalidated: boolean;
};

const LEGITIMATE_LEAVE: ReadonlySet<AuthoritativeGameState> = new Set([
  'scheduled',
  'live',
  'halftime',
  'postponed',
  'delayed',
  'canceled',
]);

function parseInstant(value: string | null | undefined): number | null {
  if (value == null || !String(value).trim()) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Status column → clock state. A tip timestamp or ISO string is scheduled,
 * never Final. Display inference from scores is not used.
 */
export function classifyAuthoritativeGameState(status: string | null | undefined): AuthoritativeGameState {
  if (status == null || !String(status).trim()) return 'unknown';
  const raw = String(status).trim();
  if (looksLikeTipoffOrDatetimeStatus(raw)) return 'scheduled';
  const lower = raw.toLowerCase().replace(/\s+/g, ' ');
  if (/^final\b/.test(lower)) return 'final';
  if (lower === 'halftime' || lower.startsWith('half time') || lower.startsWith('halftime')) return 'halftime';
  if (lower === 'delayed' || lower.startsWith('delay')) return 'delayed';
  if (lower === 'postponed') return 'postponed';
  if (lower === 'cancelled' || lower === 'canceled') return 'canceled';
  if (lower === 'scheduled') return 'scheduled';
  const mapped = normalizeGameStatus(raw);
  if (mapped === 'In Progress') return 'live';
  if (mapped === 'Final') return 'final';
  if (mapped === 'Scheduled') return 'scheduled';
  if (mapped === 'Postponed') return 'postponed';
  if (mapped === 'Canceled') return 'canceled';
  return 'unknown';
}

function unchanged(existing: FinalizationClockRow | null, reason: string): FinalizationDecision {
  return {
    apply: false,
    reason,
    status: existing?.status ?? null,
    finalizedAt: existing?.finalizedAt ?? null,
    statusObservedAt: existing?.statusObservedAt ?? null,
    finalizationState: existing?.finalizationState ?? null,
    invalidated: false,
  };
}

/**
 * Apply one observation. An older or equal observation does not move state.
 * Repeating Final keeps the original clock. A newer explicit non-final state
 * clears it so a later Final starts a new hold.
 */
export function applyFinalizationObservation(
  existing: FinalizationClockRow | null,
  observation: FinalizationObservation
): FinalizationDecision {
  const observedMs = parseInstant(observation.observedAt);
  if (observedMs == null || observation.observedAt == null) {
    return unchanged(existing, 'observation time is missing');
  }
  const incomingState = classifyAuthoritativeGameState(observation.status);
  if (incomingState === 'unknown') {
    return unchanged(existing, 'unknown status is refused');
  }
  const previousMs = parseInstant(existing?.statusObservedAt);
  if (previousMs != null && observedMs <= previousMs) {
    return unchanged(existing, 'older observation');
  }
  const wasFinal =
    existing?.finalizationState === 'final' ||
    (existing?.finalizedAt != null && existing.finalizedAt !== '') ||
    classifyAuthoritativeGameState(existing?.status) === 'final';
  const canLeave = previousMs != null && observedMs > previousMs && LEGITIMATE_LEAVE.has(incomingState);
  if (wasFinal && incomingState !== 'final' && !canLeave) {
    return unchanged(existing, 'final clock stays until a newer explicit leave');
  }

  const observedAt = new Date(observedMs).toISOString();
  if (incomingState === 'final') {
    const keepClock = wasFinal && existing?.finalizedAt;
    return {
      apply: true,
      reason: keepClock ? 'final clock unchanged' : 'final clock recorded',
      status: observation.status,
      finalizedAt: keepClock ? existing.finalizedAt : observedAt,
      statusObservedAt: observedAt,
      finalizationState: 'final',
      invalidated: false,
    };
  }

  return {
    apply: true,
    reason: wasFinal ? 'final clock invalidated' : 'non-final state',
    status: observation.status,
    finalizedAt: null,
    statusObservedAt: observedAt,
    finalizationState: incomingState,
    invalidated: wasFinal,
  };
}

export type PostFinalHoldDecision = {
  eligible: boolean;
  reason: string;
  deletionAuthorized: false;
};

/** Shared by odds and props. Eligibility is not deletion authority. */
export function evaluatePostFinalHold(input: {
  finalizationState: string | null;
  finalizedAt: string | null;
  now: string;
}): PostFinalHoldDecision {
  if (input.finalizationState !== 'final') {
    return { eligible: false, reason: 'game is not an authoritative final', deletionAuthorized: false };
  }
  const finalizedMs = parseInstant(input.finalizedAt);
  const nowMs = parseInstant(input.now);
  if (finalizedMs == null) {
    return { eligible: false, reason: 'finalization clock is missing', deletionAuthorized: false };
  }
  if (nowMs == null) {
    return { eligible: false, reason: 'eligibility time is missing', deletionAuthorized: false };
  }
  if (nowMs - finalizedMs < POST_FINAL_HOLD_MS) {
    return { eligible: false, reason: '72-hour hold has not elapsed', deletionAuthorized: false };
  }
  return { eligible: true, reason: '72-hour hold has elapsed', deletionAuthorized: false };
}

/**
 * Upsert used only when finalized_at, status_observed_at, and finalization_state exist.
 * $10 is the observation time. $11 is the authoritative state. The statement refuses
 * an older observation and does not invent a clock from tip time or updated_at.
 */
export const FINALIZATION_CLOCK_UPSERT_SQL = `
  insert into analytics.games (
    game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score, venue,
    status_observed_at, finalization_state, finalized_at
  )
  values (
    $1, $2, $3, $4, $5, $6, $7, $8, $9,
    $10,
    case when $11 in ('scheduled','live','halftime','final','postponed','delayed','canceled') then $11 else 'unknown' end,
    case when $11 = 'final' and $10::timestamptz is not null then $10::timestamptz else null end
  )
  on conflict (game_id) do update set
    season = case
      when analytics.apply_finalization_guard(analytics.games.status_observed_at, analytics.games.finalization_state, analytics.games.finalized_at, analytics.games.status, $10::timestamptz, $11)
      then analytics.games.season
      else excluded.season
    end,
    start_time = case
      when analytics.apply_finalization_guard(analytics.games.status_observed_at, analytics.games.finalization_state, analytics.games.finalized_at, analytics.games.status, $10::timestamptz, $11)
      then analytics.games.start_time
      else excluded.start_time
    end,
    status = case
      when analytics.apply_finalization_guard(analytics.games.status_observed_at, analytics.games.finalization_state, analytics.games.finalized_at, analytics.games.status, $10::timestamptz, $11)
      then analytics.games.status
      else excluded.status
    end,
    home_team_id = excluded.home_team_id,
    away_team_id = excluded.away_team_id,
    home_score = case
      when analytics.apply_finalization_guard(analytics.games.status_observed_at, analytics.games.finalization_state, analytics.games.finalized_at, analytics.games.status, $10::timestamptz, $11)
      then analytics.games.home_score
      else excluded.home_score
    end,
    away_score = case
      when analytics.apply_finalization_guard(analytics.games.status_observed_at, analytics.games.finalization_state, analytics.games.finalized_at, analytics.games.status, $10::timestamptz, $11)
      then analytics.games.away_score
      else excluded.away_score
    end,
    venue = excluded.venue,
    status_observed_at = case
      when analytics.apply_finalization_guard(analytics.games.status_observed_at, analytics.games.finalization_state, analytics.games.finalized_at, analytics.games.status, $10::timestamptz, $11)
      then analytics.games.status_observed_at
      else $10::timestamptz
    end,
    finalization_state = case
      when analytics.apply_finalization_guard(analytics.games.status_observed_at, analytics.games.finalization_state, analytics.games.finalized_at, analytics.games.status, $10::timestamptz, $11)
      then analytics.games.finalization_state
      else $11
    end,
    finalized_at = case
      when analytics.apply_finalization_guard(analytics.games.status_observed_at, analytics.games.finalization_state, analytics.games.finalized_at, analytics.games.status, $10::timestamptz, $11)
      then analytics.games.finalized_at
      when $11 is distinct from 'final' then null
      when analytics.games.finalization_state = 'final' and analytics.games.finalized_at is not null then analytics.games.finalized_at
      else $10::timestamptz
    end,
    updated_at = now();
`;
