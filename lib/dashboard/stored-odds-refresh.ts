/**
 * Bounded refresh for the stored-odds dashboard read.
 * Background ticks wait at least two minutes. A date or slate change fetches immediately.
 * The scoreboard poll does not schedule this read.
 */

import { storedOddsMapFromResponse, type StoredOddsPatch } from '@/lib/dashboard/stored-odds';

export const STORED_ODDS_MIN_REFRESH_MS = 120_000;

export type StoredOddsRefreshReason = 'load' | 'interval' | 'visibility';

export function planStoredOddsRefresh(input: {
  hasApplicablePregame: boolean;
  reason: StoredOddsRefreshReason;
  nowMs: number;
  lastStartedAtMs: number | null;
  inFlight: boolean;
  visible: boolean;
}): 'clear' | 'fetch' | 'skip' {
  if (!input.hasApplicablePregame) return 'clear';
  if (input.reason === 'load') return 'fetch';
  if (!input.visible || input.inFlight) return 'skip';
  if (input.lastStartedAtMs == null) return 'fetch';
  if (input.nowMs - input.lastStartedAtMs < STORED_ODDS_MIN_REFRESH_MS) return 'skip';
  return 'fetch';
}

export type StoredOddsRequestTicket = { requestId: number; requestKey: string };

export type StoredOddsFetchResult = { ok: boolean; body: unknown };

export type StoredOddsRefreshSession = {
  start: () => void;
  onVisible: () => void;
  stop: () => void;
};

/** Later date/slate requests invalidate an older ticket. */
export function createStoredOddsRequestGate() {
  let requestId = 0;
  let requestKey = '';
  return {
    begin(nextKey: string): StoredOddsRequestTicket {
      requestId += 1;
      requestKey = nextKey;
      return { requestId, requestKey };
    },
    applies(ticket: StoredOddsRequestTicket): boolean {
      return ticket.requestId === requestId && ticket.requestKey === requestKey;
    },
  };
}

function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError';
}

/**
 * One stored-odds read loop. The next timeout is armed only after the load or interval
 * attempt settles. A hidden tab, an in-flight request, or a closed session does not fetch.
 * An aborted or superseded ticket leaves the current overlay alone. A genuine network
 * failure clears it so a "Recently saved" label cannot linger until the next success.
 */
export function createStoredOddsRefreshSession(deps: {
  requestKey: string;
  isClosed: () => boolean;
  nowMs: () => number;
  isVisible: () => boolean;
  fetchOdds: (signal: AbortSignal) => Promise<StoredOddsFetchResult>;
  setOverlay: (patches: Record<string, StoredOddsPatch>) => void;
  armTimer: (delayMs: number, onFire: () => void) => void;
  clearTimer: () => void;
}): StoredOddsRefreshSession {
  const gate = createStoredOddsRequestGate();
  let lastStartedAtMs: number | null = null;
  let inFlight = false;
  let controller: AbortController | null = null;

  const attempt = async (reason: StoredOddsRefreshReason): Promise<void> => {
    if (deps.isClosed()) return;
    const plan = planStoredOddsRefresh({
      hasApplicablePregame: true,
      reason,
      nowMs: deps.nowMs(),
      lastStartedAtMs,
      inFlight,
      visible: deps.isVisible(),
    });
    if (plan !== 'fetch') return;
    controller?.abort();
    const ac = new AbortController();
    controller = ac;
    const ticket = gate.begin(deps.requestKey);
    inFlight = true;
    lastStartedAtMs = deps.nowMs();
    try {
      const res = await deps.fetchOdds(ac.signal);
      if (deps.isClosed() || !gate.applies(ticket) || ac.signal.aborted) return;
      deps.setOverlay(storedOddsMapFromResponse(res.ok, res.body));
    } catch (err) {
      if (deps.isClosed() || !gate.applies(ticket) || ac.signal.aborted || isAbortError(err)) return;
      deps.setOverlay({});
    } finally {
      if (gate.applies(ticket)) inFlight = false;
    }
  };

  const armAfterSettle = () => {
    if (deps.isClosed()) return;
    deps.armTimer(STORED_ODDS_MIN_REFRESH_MS, () => {
      if (deps.isClosed()) return;
      void attempt('interval').finally(armAfterSettle);
    });
  };

  return {
    start() {
      void attempt('load').finally(armAfterSettle);
    },
    onVisible() {
      void attempt('visibility');
    },
    stop() {
      deps.clearTimer();
      controller?.abort();
      gate.begin('cancelled');
    },
  };
}
