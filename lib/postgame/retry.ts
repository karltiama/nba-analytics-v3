/**
 * Bounded postgame retry schedule. Do not sleep in the worker.
 * Scanner honors next_attempt_at.
 */

export const POSTGAME_RETRY_DELAYS_MS = [
  15 * 60 * 1000,
  60 * 60 * 1000,
  12 * 60 * 60 * 1000,
] as const;

export const POSTGAME_RECOVERY_WINDOW_MS = 36 * 60 * 60 * 1000;

export function nextAttemptAt(input: {
  attempt: number;
  now: Date;
  firstStartedAt?: Date | null;
}): Date {
  const idx = Math.max(0, Math.min(POSTGAME_RETRY_DELAYS_MS.length - 1, input.attempt - 1));
  const delay = POSTGAME_RETRY_DELAYS_MS[idx] ?? POSTGAME_RETRY_DELAYS_MS[POSTGAME_RETRY_DELAYS_MS.length - 1];
  const candidate = new Date(input.now.getTime() + delay);
  if (!input.firstStartedAt) return candidate;
  const cap = new Date(input.firstStartedAt.getTime() + POSTGAME_RECOVERY_WINDOW_MS);
  return candidate.getTime() > cap.getTime() ? cap : candidate;
}

export function waitingBeforeRetry(now: Date, nextAttempt: string | null | undefined): boolean {
  if (!nextAttempt) return false;
  const t = Date.parse(nextAttempt);
  if (!Number.isFinite(t)) return false;
  return t > now.getTime();
}
