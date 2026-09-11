import { describe, expect, it } from 'vitest';
import { nextAttemptAt, POSTGAME_RECOVERY_WINDOW_MS, waitingBeforeRetry } from '../retry';

describe('postgame retry schedule', () => {
  it('uses 15m then 1h then overnight delays and does not loop tightly', () => {
    const now = new Date('2026-10-22T03:00:00.000Z');
    expect(nextAttemptAt({ attempt: 1, now }).getTime() - now.getTime()).toBe(15 * 60 * 1000);
    expect(nextAttemptAt({ attempt: 2, now }).getTime() - now.getTime()).toBe(60 * 60 * 1000);
    expect(nextAttemptAt({ attempt: 3, now }).getTime() - now.getTime()).toBe(12 * 60 * 60 * 1000);
    expect(POSTGAME_RECOVERY_WINDOW_MS).toBe(36 * 60 * 60 * 1000);
    const first = new Date('2026-10-21T00:00:00.000Z');
    const capped = nextAttemptAt({ attempt: 8, now, firstStartedAt: first });
    expect(capped.getTime()).toBe(first.getTime() + POSTGAME_RECOVERY_WINDOW_MS);
  });

  it('holds WAITING until next_attempt_at', () => {
    const now = new Date('2026-10-22T03:00:00.000Z');
    expect(waitingBeforeRetry(now, '2026-10-22T03:15:00.000Z')).toBe(true);
    expect(waitingBeforeRetry(now, '2026-10-22T02:00:00.000Z')).toBe(false);
  });
});
