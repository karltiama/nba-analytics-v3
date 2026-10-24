import { describe, expect, it } from 'vitest';
import {
  interpretScoreboardPayload,
  readScoreboardCoverage,
} from '@/lib/scoreboard/client';
import {
  createScoreboardRetrySession,
  scoreboardRetryDelayMs,
  todaysGamesCountLabel,
  todaysGamesEmptyView,
  type ScoreboardRetryOutcome,
} from '@/lib/scoreboard/empty-state';
import { todaysGamesUnavailableCopy } from '@/lib/scoreboard/slate-merge';
import type { ScoreboardCoverage } from '@/lib/scoreboard/coverage';

const TODAY = '2026-10-23';
const CHECKED = '2026-10-23T23:13:00-04:00';

function coverage(state: ScoreboardCoverage['state'], at: string | null = CHECKED): ScoreboardCoverage {
  return { state, last_games_request_at: at };
}

function view(over: Partial<Parameters<typeof todaysGamesEmptyView>[0]> = {}) {
  return todaysGamesEmptyView({
    availability: 'ready',
    unfilteredCount: 0,
    filteredCount: 0,
    coverage: coverage('covered'),
    selectedDate: TODAY,
    todayEt: TODAY,
    dateLabel: 'Today',
    ...over,
  });
}

function delay(over: Partial<Parameters<typeof scoreboardRetryDelayMs>[0]> = {}) {
  return scoreboardRetryDelayMs({
    availability: 'ready',
    unfilteredCount: 0,
    coverageState: 'covered',
    selectedDate: TODAY,
    todayEt: TODAY,
    consecutiveFailures: 0,
    ...over,
  });
}

function norm(message: string): string {
  return message.replace(/[\u202F\u00A0]/g, ' ');
}

function payload(games: unknown[] = [], extra: Record<string, unknown> = {}) {
  return {
    schema_version: 'scoreboard.v1',
    date: TODAY,
    generated_at: '2026-10-23T23:18:00.000Z',
    source: { provider: 'balldontlie', coverage: 'display_only' },
    stale: false,
    games,
    ...extra,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function sessionHarness(options: {
  load: (signal: AbortSignal) => Promise<ScoreboardRetryOutcome>;
  visible?: boolean;
  selectedDate?: string;
  todayEt?: string;
}) {
  let visible = options.visible ?? true;
  let timer: { delay: number; fire: () => void } | null = null;
  const armed: number[] = [];
  const session = createScoreboardRetrySession({
    load: options.load,
    delayFor: (outcome, consecutiveFailures) =>
      scoreboardRetryDelayMs({
        availability: outcome === 'disabled' ? 'disabled' : outcome === 'error' ? 'error' : 'ready',
        unfilteredCount: outcome === 'ready_with_games' ? 1 : 0,
        coverageState: null,
        selectedDate: options.selectedDate ?? TODAY,
        todayEt: options.todayEt ?? TODAY,
        consecutiveFailures,
      }),
    isVisible: () => visible,
    armTimer: (ms, fire) => {
      armed.push(ms);
      timer = { delay: ms, fire };
    },
    clearTimer: () => {
      timer = null;
    },
  });
  return {
    session,
    armed,
    timer: () => timer,
    setVisible: (next: boolean) => {
      visible = next;
    },
    async fire() {
      const current = timer;
      if (!current) throw new Error('no timer');
      current.fire();
      await flush();
    },
  };
}

describe('todaysGamesEmptyView', () => {
  it('states the check time without the word Updated', () => {
    const covered = view({
      dateLabel: 'Today',
      coverage: coverage('covered', '2026-10-24T04:21:00.000Z'),
    });
    expect(norm(covered?.message ?? '')).toBe('No games on the scoreboard for today. Last checked 12:21 AM EDT.');
    expect(covered?.message).not.toContain('Updated');
    expect(covered).toMatchObject({ showGameCount: true, showResearchLinks: true, showClearFilters: false });

    const missingClock = view({ dateLabel: 'Today', coverage: coverage('covered', null) });
    expect(norm(missingClock?.message ?? '')).toBe('No games on the scoreboard for today.');

    const invalidClock = view({ dateLabel: 'Today', coverage: coverage('covered', 'not-a-time') });
    expect(norm(invalidClock?.message ?? '')).toBe('No games on the scoreboard for today.');

    const yesterday = view({
      dateLabel: 'Yesterday',
      selectedDate: '2026-10-23',
      todayEt: '2026-10-24',
      coverage: coverage('covered', '2026-10-24T04:21:00.000Z'),
    });
    expect(norm(yesterday?.message ?? '')).toMatch(/^No games on the scoreboard for yesterday\./);
    expect(yesterday?.message).not.toContain('Updated');
  });

  it('does not claim a schedule while collection is missing', () => {
    expect(view({ coverage: coverage('not_collected', null) })).toMatchObject({
      kind: 'not_collected_today',
      message: "Today's schedule hasn't loaded yet. We'll keep checking.",
      showGameCount: false,
      showResearchLinks: false,
    });
    expect(
      view({
        coverage: coverage('not_collected', null),
        selectedDate: '2026-10-24',
        dateLabel: 'Tomorrow',
      })
    ).toMatchObject({
      kind: 'not_collected_future',
      message: "The schedule for tomorrow isn't on the scoreboard yet.",
      showGameCount: false,
    });
    expect(
      view({
        coverage: coverage('not_collected', null),
        selectedDate: '2026-10-26',
        todayEt: '2026-10-24',
        dateLabel: 'Mon, Oct 26, 2026',
      })?.message
    ).toBe("The schedule for Mon, Oct 26, 2026 isn't on the scoreboard yet.");
    expect(
      view({
        coverage: coverage('unknown', null),
        selectedDate: '2026-10-23',
        todayEt: '2026-10-24',
        dateLabel: 'Yesterday',
      })?.message
    ).toBe('No scoreboard games are stored for yesterday.');
    const samples = [
      view({ dateLabel: 'Today', coverage: coverage('covered', '2026-10-24T04:21:00.000Z') }),
      view({ dateLabel: 'Tomorrow', selectedDate: '2026-10-24', coverage: coverage('not_collected', null) }),
      view({ dateLabel: 'Yesterday', selectedDate: '2026-10-22', coverage: coverage('unknown', null) }),
    ];
    for (const sample of samples) expect(sample?.message ?? '').not.toContain('Updated');
  });

  it('treats a missing coverage field as unknown', () => {
    expect(view({ coverage: null, dateLabel: 'Today' })).toMatchObject({
      kind: 'unknown_empty',
      message: 'No scoreboard games are stored for today.',
      showGameCount: false,
    });
  });

  it('says filters hid the games and offers to clear them', () => {
    const filtered = view({ unfilteredCount: 5, filteredCount: 0, coverage: coverage('covered') });
    expect(filtered).toMatchObject({
      kind: 'filtered_out',
      message: 'No games match your filters.',
      showGameCount: true,
      showClearFilters: true,
      showResearchLinks: false,
    });
    expect(filtered?.message).not.toMatch(/no games scheduled/i);
  });

  it('keeps the existing unavailable copy and adds automatic retry on errors', () => {
    expect(view({ availability: 'disabled', unfilteredCount: 0 })).toEqual({
      kind: 'disabled',
      message: todaysGamesUnavailableCopy('disabled'),
      showGameCount: false,
      showResearchLinks: false,
      showClearFilters: false,
    });
    expect(view({ availability: 'error' })).toEqual({
      kind: 'error',
      message: `${todaysGamesUnavailableCopy('error')} Retrying automatically.`,
      showGameCount: false,
      showResearchLinks: false,
      showClearFilters: false,
    });
  });

  it('returns null when cards are on screen', () => {
    expect(view({ unfilteredCount: 5, filteredCount: 2 })).toBeNull();
  });
});

describe('scoreboardRetryDelayMs', () => {
  it('retries a covered empty today and stops for a past empty', () => {
    expect(delay()).toBe(300_000);
    expect(delay({ selectedDate: '2026-10-22', coverageState: 'covered' })).toBeNull();
  });

  it('retries missing coverage for today and the future, and not a past unknown date', () => {
    expect(delay({ coverageState: 'not_collected' })).toBe(300_000);
    expect(delay({ coverageState: 'not_collected', selectedDate: '2026-10-24' })).toBe(300_000);
    expect(delay({ coverageState: 'unknown', selectedDate: '2026-10-21' })).toBeNull();
  });

  it('does not retry when games exist and were filtered out', () => {
    expect(delay({ unfilteredCount: 5, coverageState: 'covered' })).toBeNull();
  });

  it('retries disabled serving on a fixed interval', () => {
    expect(delay({ availability: 'disabled', coverageState: null })).toBe(300_000);
  });

  it('backs off temporary failures and caps at five minutes', () => {
    expect(delay({ availability: 'error', consecutiveFailures: 1 })).toBe(60_000);
    expect(delay({ availability: 'error', consecutiveFailures: 2 })).toBe(120_000);
    expect(delay({ availability: 'error', consecutiveFailures: 3 })).toBe(240_000);
    expect(delay({ availability: 'error', consecutiveFailures: 10 })).toBe(300_000);
  });
});

describe('createScoreboardRetrySession', () => {
  it('arms 60s then 120s from error to error, then stops when games arrive', async () => {
    const outcomes: ScoreboardRetryOutcome[] = ['error', 'ready_with_games'];
    let calls = 0;
    const h = sessionHarness({
      load: async () => outcomes[calls++] ?? 'error',
    });
    h.session.start('error');
    expect(h.timer()?.delay).toBe(60_000);
    expect(calls).toBe(0);
    await h.fire();
    expect(calls).toBe(1);
    expect(h.timer()?.delay).toBe(120_000);
    await h.fire();
    expect(calls).toBe(2);
    expect(h.timer()).toBeNull();
    expect(h.armed).toEqual([60_000, 120_000]);
  });

  it('arms 300s for disabled and for an empty today, then stops when games arrive', async () => {
    const outcomes: ScoreboardRetryOutcome[] = ['ready_empty', 'ready_with_games'];
    let calls = 0;
    const h = sessionHarness({
      load: async () => outcomes[calls++] ?? 'error',
    });
    h.session.start('disabled');
    expect(h.timer()?.delay).toBe(300_000);
    await h.fire();
    expect(h.timer()?.delay).toBe(300_000);
    await h.fire();
    expect(h.timer()).toBeNull();
    expect(h.armed).toEqual([300_000, 300_000]);
  });

  it('re-arms a hidden tab without fetching', async () => {
    let calls = 0;
    const h = sessionHarness({
      visible: false,
      load: async () => {
        calls += 1;
        return 'error';
      },
    });
    h.session.start('error');
    await h.fire();
    await h.fire();
    expect(calls).toBe(0);
    expect(h.timer()?.delay).toBe(60_000);
    expect(h.armed).toEqual([60_000, 60_000, 60_000]);
  });

  it('ignores an in-flight result after stop and leaves no timer', async () => {
    const pending = deferred<ScoreboardRetryOutcome>();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const h = sessionHarness({
      load: (signal) => {
        calls += 1;
        signals.push(signal);
        return pending.promise;
      },
    });
    h.session.start('error');
    const fire = h.timer()?.fire;
    fire?.();
    await flush();
    expect(calls).toBe(1);
    h.session.stop();
    expect(h.timer()).toBeNull();
    expect(signals[0]?.aborted).toBe(true);
    pending.resolve('error');
    await flush();
    fire?.();
    await flush();
    expect(calls).toBe(1);
    expect(h.timer()).toBeNull();
    expect(h.armed).toEqual([60_000]);
  });
});

describe('scoreboard coverage on the client', () => {
  it('treats a body without coverage as ready and unknown', () => {
    const outcome = interpretScoreboardPayload(200, payload());
    expect(outcome.status).toBe('ready');
    if (outcome.status !== 'ready') return;
    expect(outcome.coverage).toEqual({ state: 'unknown', last_games_request_at: null });
    expect(readScoreboardCoverage({ coverage: { state: 'later', last_games_request_at: CHECKED } }).state).toBe('unknown');
  });

  it('keeps a valid coverage field and names error reasons', () => {
    const ready = interpretScoreboardPayload(200, payload([], { coverage: coverage('not_collected', null) }));
    expect(ready).toMatchObject({ status: 'ready', coverage: { state: 'not_collected', last_games_request_at: null } });
    expect(interpretScoreboardPayload(503, { error: 'scoreboard_unavailable' })).toEqual({ status: 'disabled' });
    expect(interpretScoreboardPayload(503, { error: 'scoreboard_store_unavailable' })).toMatchObject({
      status: 'error',
      reason: 'store_unavailable',
      message: 'Scoreboard is temporarily unavailable.',
    });
    expect(interpretScoreboardPayload(503, { error: 'other' })).toMatchObject({ status: 'error', reason: 'http' });
    expect(interpretScoreboardPayload(200, { schema_version: 'nope' })).toMatchObject({
      status: 'error',
      reason: 'invalid_payload',
    });
    expect(interpretScoreboardPayload(500, {})).toMatchObject({ status: 'error', reason: 'http' });
  });
});

describe('todaysGamesCountLabel', () => {
  it('says how many games the filters hid, and otherwise keeps the visible count', () => {
    const filtered = view({ unfilteredCount: 8, filteredCount: 0 });
    expect(filtered?.kind).toBe('filtered_out');
    expect(todaysGamesCountLabel({ shown: 0, total: 8, view: filtered })).toBe('0 of 8 games');

    const coveredEmpty = view({
      unfilteredCount: 0,
      coverage: coverage('covered', '2026-10-24T04:21:00.000Z'),
    });
    expect(todaysGamesCountLabel({ shown: 0, total: 0, view: coveredEmpty })).toBe('0 games');

    const notCollected = view({ coverage: coverage('not_collected', null) });
    expect(todaysGamesCountLabel({ shown: 0, total: 0, view: notCollected })).toBe('');

    expect(todaysGamesCountLabel({ shown: 5, total: 5, view: null })).toBe('5 games');
    expect(todaysGamesCountLabel({ shown: 3, total: 8, view: null })).toBe('3 games');
  });
});
