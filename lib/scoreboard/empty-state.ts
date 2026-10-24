/**
 * Today's Games empty state. Pure view model plus a retry session.
 * Copy states only what the scoreboard evidence supports.
 */

import { todaysGamesUnavailableCopy } from './slate-merge';
import type { ScoreboardCoverage, ScoreboardCoverageState } from './coverage';

export type { ScoreboardCoverage, ScoreboardCoverageState };

export type TodaysGamesEmptyKind =
  | 'covered_empty'
  | 'not_collected_today'
  | 'not_collected_future'
  | 'unknown_empty'
  | 'filtered_out'
  | 'disabled'
  | 'error';

export type TodaysGamesEmptyView = {
  kind: TodaysGamesEmptyKind;
  message: string;
  showGameCount: boolean;
  showResearchLinks: boolean;
  showClearFilters: boolean;
};

const HIDDEN: Pick<TodaysGamesEmptyView, 'showGameCount' | 'showResearchLinks' | 'showClearFilters'> = {
  showGameCount: false,
  showResearchLinks: false,
  showClearFilters: false,
};

const ET = 'America/New_York';

/** Today / Yesterday / Tomorrow sit mid-sentence. Calendar labels stay as given. */
function datePhrase(dateLabel: string): string {
  if (dateLabel === 'Today') return 'today';
  if (dateLabel === 'Yesterday') return 'yesterday';
  if (dateLabel === 'Tomorrow') return 'tomorrow';
  return dateLabel;
}

/** Clock time only. Missing or invalid timestamps omit the clause. */
function checkedAtClause(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ET,
    timeZoneName: 'short',
  });
  return ` Last checked ${time}.`;
}

export function todaysGamesEmptyView(input: {
  availability: 'ready' | 'disabled' | 'error';
  unfilteredCount: number;
  filteredCount: number;
  coverage: ScoreboardCoverage | null;
  selectedDate: string;
  todayEt: string;
  dateLabel: string;
}): TodaysGamesEmptyView | null {
  if (input.filteredCount > 0) return null;
  if (input.availability === 'disabled') {
    return { kind: 'disabled', message: todaysGamesUnavailableCopy('disabled'), ...HIDDEN };
  }
  if (input.availability === 'error') {
    return {
      kind: 'error',
      message: `${todaysGamesUnavailableCopy('error')} Retrying automatically.`,
      ...HIDDEN,
    };
  }
  if (input.unfilteredCount > 0) {
    return {
      kind: 'filtered_out',
      message: 'No games match your filters.',
      showGameCount: true,
      showResearchLinks: false,
      showClearFilters: true,
    };
  }

  const state = input.coverage?.state ?? 'unknown';
  if (state === 'covered') {
    const phrase = datePhrase(input.dateLabel);
    return {
      kind: 'covered_empty',
      message: `No games on the scoreboard for ${phrase}.${checkedAtClause(input.coverage?.last_games_request_at)}`,
      showGameCount: true,
      showResearchLinks: true,
      showClearFilters: false,
    };
  }
  if (state === 'not_collected' && input.selectedDate === input.todayEt) {
    return {
      kind: 'not_collected_today',
      message: "Today's schedule hasn't loaded yet. We'll keep checking.",
      ...HIDDEN,
    };
  }
  if (state === 'not_collected' && input.selectedDate > input.todayEt) {
    return {
      kind: 'not_collected_future',
      message: `The schedule for ${datePhrase(input.dateLabel)} isn't on the scoreboard yet.`,
      ...HIDDEN,
    };
  }
  return {
    kind: 'unknown_empty',
    message: `No scoreboard games are stored for ${datePhrase(input.dateLabel)}.`,
    ...HIDDEN,
  };
}

/** Header count. A fully filtered slate says how many games the filters hid. */
export function todaysGamesCountLabel(input: {
  shown: number;
  total: number;
  view: TodaysGamesEmptyView | null;
}): string {
  if (input.view?.kind === 'filtered_out') return `0 of ${input.total} games`;
  if (input.view && !input.view.showGameCount) return '';
  return `${input.shown} games`;
}

const RETRY_BASE_MS = 60_000;
const RETRY_CAP_MS = 300_000;

export function scoreboardRetryDelayMs(input: {
  availability: 'ready' | 'disabled' | 'error';
  unfilteredCount: number;
  coverageState: ScoreboardCoverageState | null;
  selectedDate: string;
  todayEt: string;
  consecutiveFailures: number;
}): number | null {
  if (input.availability === 'error') {
    const failures = input.consecutiveFailures < 1 ? 1 : input.consecutiveFailures;
    const exponent = Math.min(failures - 1, 16);
    return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_CAP_MS);
  }
  if (input.availability === 'disabled') return RETRY_CAP_MS;
  if (input.unfilteredCount > 0) return null;
  if (input.selectedDate >= input.todayEt) return RETRY_CAP_MS;
  return null;
}

export type ScoreboardRetryOutcome = 'ready_with_games' | 'ready_empty' | 'disabled' | 'error';

export function createScoreboardRetrySession(deps: {
  load: (signal: AbortSignal) => Promise<ScoreboardRetryOutcome>;
  delayFor: (outcome: ScoreboardRetryOutcome, consecutiveFailures: number) => number | null;
  isVisible: () => boolean;
  armTimer: (ms: number, fire: () => void) => void;
  clearTimer: () => void;
}): { start: (initialOutcome: ScoreboardRetryOutcome) => void; stop: () => void } {
  let stopped = false;
  let failures = 0;
  let controller: AbortController | null = null;
  let inFlight = false;
  let lastDelay: number | null = null;

  const arm = (ms: number) => {
    if (stopped) return;
    deps.clearTimer();
    deps.armTimer(ms, () => {
      if (stopped) return;
      onFire();
    });
  };

  const schedule = (outcome: ScoreboardRetryOutcome) => {
    if (stopped) return;
    if (outcome === 'ready_with_games' || outcome === 'ready_empty') failures = 0;
    else if (outcome === 'error') failures += 1;
    const delay = deps.delayFor(outcome, failures);
    lastDelay = delay;
    if (delay == null) {
      deps.clearTimer();
      return;
    }
    arm(delay);
  };

  const onFire = () => {
    if (stopped) return;
    if (!deps.isVisible()) {
      if (lastDelay == null) return;
      arm(lastDelay);
      return;
    }
    if (inFlight) return;
    const ac = new AbortController();
    controller = ac;
    inFlight = true;
    deps.clearTimer();
    deps.load(ac.signal).then(
      (outcome) => {
        if (controller === ac) {
          controller = null;
          inFlight = false;
        }
        if (stopped || ac.signal.aborted) return;
        schedule(outcome);
      },
      () => {
        if (controller === ac) {
          controller = null;
          inFlight = false;
        }
        if (stopped || ac.signal.aborted) return;
        schedule('error');
      }
    );
  };

  return {
    start(initialOutcome) {
      if (stopped) return;
      schedule(initialOutcome);
    },
    stop() {
      stopped = true;
      deps.clearTimer();
      controller?.abort();
      controller = null;
      inFlight = false;
    },
  };
}
