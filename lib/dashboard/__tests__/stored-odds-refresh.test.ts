import { describe, expect, it } from 'vitest';
import {
  collectStoredOdds,
  storedOddsResponseBody,
  type StoredOddsPatch,
  type StoredOddsSourceRow,
} from '@/lib/dashboard/stored-odds';
import {
  createStoredOddsRefreshSession,
  createStoredOddsRequestGate,
  planStoredOddsRefresh,
  STORED_ODDS_MIN_REFRESH_MS,
  type StoredOddsFetchResult,
} from '@/lib/dashboard/stored-odds-refresh';

const T0 = Date.parse('2026-10-20T18:30:00.000Z');

describe('stored odds refresh', () => {
  it('fetches on load and refuses a background tick before 120 seconds', () => {
    expect(STORED_ODDS_MIN_REFRESH_MS).toBe(120_000);
    expect(
      planStoredOddsRefresh({
        hasApplicablePregame: true,
        reason: 'load',
        nowMs: T0,
        lastStartedAtMs: null,
        inFlight: false,
        visible: true,
      })
    ).toBe('fetch');
    const started = T0;
    expect(
      planStoredOddsRefresh({
        hasApplicablePregame: true,
        reason: 'interval',
        nowMs: started + 60_000,
        lastStartedAtMs: started,
        inFlight: false,
        visible: true,
      })
    ).toBe('skip');
    expect(
      planStoredOddsRefresh({
        hasApplicablePregame: true,
        reason: 'visibility',
        nowMs: started + STORED_ODDS_MIN_REFRESH_MS - 1,
        lastStartedAtMs: started,
        inFlight: false,
        visible: true,
      })
    ).toBe('skip');
    expect(
      planStoredOddsRefresh({
        hasApplicablePregame: true,
        reason: 'interval',
        nowMs: started + STORED_ODDS_MIN_REFRESH_MS,
        lastStartedAtMs: started,
        inFlight: false,
        visible: true,
      })
    ).toBe('fetch');
    expect(
      planStoredOddsRefresh({
        hasApplicablePregame: true,
        reason: 'visibility',
        nowMs: started + STORED_ODDS_MIN_REFRESH_MS,
        lastStartedAtMs: started,
        inFlight: false,
        visible: true,
      })
    ).toBe('fetch');
  });

  it('does not poll without a pregame card, while hidden, or while a request is in flight', () => {
    expect(
      planStoredOddsRefresh({
        hasApplicablePregame: false,
        reason: 'interval',
        nowMs: T0 + STORED_ODDS_MIN_REFRESH_MS,
        lastStartedAtMs: T0,
        inFlight: false,
        visible: true,
      })
    ).toBe('clear');
    expect(
      planStoredOddsRefresh({
        hasApplicablePregame: true,
        reason: 'interval',
        nowMs: T0 + STORED_ODDS_MIN_REFRESH_MS,
        lastStartedAtMs: T0,
        inFlight: false,
        visible: false,
      })
    ).toBe('skip');
    expect(
      planStoredOddsRefresh({
        hasApplicablePregame: true,
        reason: 'interval',
        nowMs: T0 + STORED_ODDS_MIN_REFRESH_MS,
        lastStartedAtMs: T0,
        inFlight: true,
        visible: true,
      })
    ).toBe('skip');
  });

  it('drops a response from an older date or slate', () => {
    const gate = createStoredOddsRequestGate();
    const first = gate.begin('2026-10-20|a');
    const second = gate.begin('2026-10-21|b');
    expect(gate.applies(first)).toBe(false);
    expect(gate.applies(second)).toBe(true);
    gate.begin('cancelled');
    expect(gate.applies(second)).toBe(false);
  });
});

const SOURCE_NOW = new Date('2026-10-20T18:30:00.000Z');

function sourceRow(): StoredOddsSourceRow {
  return {
    game_id: '21717856',
    vendor: 'draftkings',
    snapshot_at: '2026-10-20T17:41:01.317Z',
    updated_at: '2026-10-20T18:20:00.000Z',
    home_moneyline: -180,
    away_moneyline: 150,
    home_spread: -4.5,
    home_spread_odds: -110,
    away_spread: 4.5,
    away_spread_odds: -110,
    total: 231.5,
    over_odds: -112,
    under_odds: -108,
  };
}

function successBody(): StoredOddsFetchResult {
  return { ok: true, body: storedOddsResponseBody(SOURCE_NOW, collectStoredOdds([sourceRow()], SOURCE_NOW)) };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(options: {
  requestKey: string;
  fetchOdds: (signal: AbortSignal) => Promise<StoredOddsFetchResult>;
  overlays: Record<string, StoredOddsPatch>[];
}) {
  let closed = false;
  let now = T0;
  const visible = true;
  let timer: { delay: number; fire: () => void } | null = null;
  const session = createStoredOddsRefreshSession({
    requestKey: options.requestKey,
    isClosed: () => closed,
    nowMs: () => now,
    isVisible: () => visible,
    fetchOdds: options.fetchOdds,
    setOverlay: (patches) => {
      options.overlays.push(patches);
    },
    armTimer: (delayMs, onFire) => {
      timer = { delay: delayMs, fire: onFire };
    },
    clearTimer: () => {
      timer = null;
    },
  });
  return {
    session,
    close: () => {
      closed = true;
    },
    advance: (ms: number) => {
      now += ms;
    },
    timer: () => timer,
  };
}

describe('stored odds refresh failures', () => {
  it('clears the overlay on a non-OK HTTP response', async () => {
    const overlays: Record<string, StoredOddsPatch>[] = [];
    const h = harness({
      requestKey: '2026-10-20|a|a',
      overlays,
      fetchOdds: async () => ({ ok: false, body: { error: 'stored_odds_unavailable' } }),
    });
    h.session.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(overlays).toEqual([{}]);
    expect(h.timer()?.delay).toBe(STORED_ODDS_MIN_REFRESH_MS);
  });

  it('clears the overlay on a genuine network failure and arms the next refresh', async () => {
    const overlays: Record<string, StoredOddsPatch>[] = [];
    const h = harness({
      requestKey: '2026-10-20|a|a',
      overlays,
      fetchOdds: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    h.session.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(overlays).toEqual([{}]);
    expect(h.timer()?.delay).toBe(STORED_ODDS_MIN_REFRESH_MS);
  });

  it('does not let an aborted obsolete request clear a newer slate', async () => {
    const overlays: Record<string, StoredOddsPatch>[] = [];
    const older = deferred<StoredOddsFetchResult>();
    const previous = harness({
      requestKey: '2026-10-20|old|old',
      overlays,
      fetchOdds: () => older.promise,
    });
    previous.session.start();
    await Promise.resolve();
    previous.close();
    previous.session.stop();
    const next = harness({
      requestKey: '2026-10-21|new|new',
      overlays,
      fetchOdds: async () => successBody(),
    });
    next.session.start();
    await Promise.resolve();
    await Promise.resolve();
    older.reject(new TypeError('Failed to fetch'));
    await older.promise.catch(() => undefined);
    await Promise.resolve();
    expect(overlays).toHaveLength(1);
    expect(overlays[0]['21717856']?.marketCaption).toBe('DraftKings · stored 2:20 PM ET · Recently saved');
    expect(previous.timer()).toBeNull();
  });

  it('keeps a newer success after an older network failure', async () => {
    const overlays: Record<string, StoredOddsPatch>[] = [];
    const failed = harness({
      requestKey: '2026-10-20|old|old',
      overlays,
      fetchOdds: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    failed.session.start();
    await Promise.resolve();
    await Promise.resolve();
    const staleTick = failed.timer();
    expect(staleTick?.delay).toBe(STORED_ODDS_MIN_REFRESH_MS);
    failed.close();
    failed.session.stop();
    expect(failed.timer()).toBeNull();
    const next = harness({
      requestKey: '2026-10-21|new|new',
      overlays,
      fetchOdds: async () => successBody(),
    });
    next.session.start();
    await Promise.resolve();
    await Promise.resolve();
    staleTick?.fire();
    await Promise.resolve();
    expect(overlays).toHaveLength(2);
    expect(overlays[0]).toEqual({});
    expect(overlays[1]['21717856']?.oddsFreshness).toBe('fresh');
  });

  it('recovers on the next scheduled refresh after a network failure', async () => {
    const overlays: Record<string, StoredOddsPatch>[] = [];
    let calls = 0;
    const h = harness({
      requestKey: '2026-10-20|a|a',
      overlays,
      fetchOdds: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return successBody();
      },
    });
    h.session.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(overlays).toEqual([{}]);
    const firstTimer = h.timer();
    expect(firstTimer?.delay).toBe(STORED_ODDS_MIN_REFRESH_MS);
    h.advance(STORED_ODDS_MIN_REFRESH_MS);
    firstTimer?.fire();
    await Promise.resolve();
    await Promise.resolve();
    expect(overlays[1]['21717856']?.marketCaption).toBe('DraftKings · stored 2:20 PM ET · Recently saved');
    expect(h.timer()?.delay).toBe(STORED_ODDS_MIN_REFRESH_MS);
    expect(h.timer()?.fire).not.toBe(firstTimer?.fire);
  });
});
