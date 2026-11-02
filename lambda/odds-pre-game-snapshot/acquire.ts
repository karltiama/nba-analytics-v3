/**
 * One odds acquisition.
 * A page loop is not a retry loop. A failed page is returned once.
 */

import {
  OPENING_NIGHT_ODDS_MAX_PAGES,
  OddsPageCapError,
  assertCanaryEvent,
  assertCanaryGames,
  assertCanaryLimiter,
  isOddsCanaryOnly,
  isOpeningNightCanaryEvent,
  oddsPageDecision,
  type OddsInvocation,
} from './canary-limits';
import { compareDueDates, planDate, type PlannedGame } from './collection-planner';
import type { ClaimDecision } from './overlap-claim';
import { dailyAttemptCeiling, type BudgetDecision } from './request-budget';
import { oddsAcquisitionEvent } from './safety-policy';
import {
  NORMAL_MAX_PAGES_PER_DATE,
  SCHEDULED_INVOCATION_MAX_PAGES,
  assertNormalLiveLimiter,
  assessOddsGames,
  etCalendarDate,
  httpFailure,
  isProviderTimeout,
  pageBudgetForDate,
  selectNormalDates,
  summarizeClassifications,
  type DateClassification,
  type StoredOddsGame,
} from './normal-path';

export type OddsProviderRow = {
  id: number;
  game_id: number;
  vendor: string;
  spread_home_value?: string | null;
  spread_home_odds?: number | null;
  spread_away_value?: string | null;
  spread_away_odds?: number | null;
  moneyline_home_odds?: number | null;
  moneyline_away_odds?: number | null;
  total_value?: string | null;
  total_over_odds?: number | null;
  total_under_odds?: number | null;
  updated_at?: string | null;
};

export type OddsPageResult =
  | { ok: true; rows: OddsProviderRow[]; nextCursor: number | null }
  | { ok: false; status: number };

export type AcquireDeps = {
  env: Record<string, string | undefined>;
  now: () => Date;
  preferredVendor: string;
  fetchPage: (date: string, cursor: number | null) => Promise<OddsPageResult>;
  createPullRun: (date: string) => Promise<number>;
  completePullRun: (
    pullRunId: number,
    rowsReturned: number,
    rowsStored: number,
    status: 'success' | 'error',
    metadata?: Record<string, unknown>,
    errorMessage?: string
  ) => Promise<void>;
  insertRaw: (pullRunId: number, row: OddsProviderRow) => Promise<void>;
  loadGames: (gameIds: string[]) => Promise<StoredOddsGame[]>;
  transformComplete: (pullRunId: number) => Promise<{
    current: number;
    history: number;
    movement: number;
    acquiredRows?: number;
    pregameEligibleRows?: number;
    postTipRowsSkipped?: number;
    currentRowsUpdated?: number;
    historyRowsInserted?: number;
    movementRowsInserted?: number;
  }>;
  maxPagesPerDate?: number;
  maxPagesPerInvocation?: number;
  requireSafety?: boolean;
  slateForDate?: (date: string) => Promise<readonly PlannedGame[]>;
  reserveAttempt?: (input: { day: string; date: string; dateCeiling: number }) => Promise<BudgetDecision>;
  recordAttempt?: (input: { reservationId: string; outcome: 'success' | 'failure' }) => Promise<void>;
  claimDate?: (input: { day: string; date: string; windowId: string; nowMs: number; owner: string }) => Promise<ClaimDecision>;
  completeClaim?: (input: { day: string; date: string; windowId: string; nowMs: number; owner: string }) => Promise<void>;
  claimOwner?: string;
  budgetRemaining?: number | null;
};

export type DateAcquisition = {
  date: string;
  classification: DateClassification;
  pullRunId?: number;
  rowsFetched: number;
  rowsStored: number;
  providerRequests: number;
  reason?: string;
  transform?: {
    current: number;
    history: number;
    movement: number;
    acquiredRows?: number;
    pregameEligibleRows?: number;
    postTipRowsSkipped?: number;
    currentRowsUpdated?: number;
    historyRowsInserted?: number;
    movementRowsInserted?: number;
  };
};

export type AcquireResult = {
  success: boolean;
  status: string;
  httpStatus: number;
  providerRequests: number;
  dates: string[];
  results: DateAcquisition[];
  totalFetched: number;
  totalStored: number;
  reason?: string;
  budgetRemaining?: number | null;
};

export class OddsPersistError extends Error {
  constructor(
    message: string,
    readonly oddsStep: DateClassification
  ) {
    super(message);
    this.name = 'OddsPersistError';
  }
}

type Collected =
  | {
      kind: 'pages';
      rows: OddsProviderRow[];
      requests: number;
      complete: boolean;
      reason?: 'per_date_cap' | 'invocation_budget';
    }
  | { kind: 'http'; status: number; rows: OddsProviderRow[]; requests: number }
  | { kind: 'thrown'; timeout: boolean; message: string; rows: OddsProviderRow[]; requests: number }
  | { kind: 'budget'; rows: OddsProviderRow[]; requests: number; reason: 'exhausted' | 'unavailable' | 'ambiguous' };

export async function collectDatePages(input: {
  date: string;
  budget: number;
  perDateLimit: number;
  fetchPage: AcquireDeps['fetchPage'];
  onCap: 'throw' | 'incomplete';
  reserve?: () => Promise<BudgetDecision>;
  record?: (input: { reservationId: string; outcome: 'success' | 'failure' }) => Promise<void>;
}): Promise<Collected> {
  if (input.budget <= 0) {
    return { kind: 'pages', rows: [], requests: 0, complete: false, reason: 'invocation_budget' };
  }

  const rows: OddsProviderRow[] = [];
  let pages = 0;
  let requests = 0;
  let cursor: number | null = null;

  while (true) {
    const decision = oddsPageDecision(pages, cursor, input.budget);
    if (decision === 'stop') return { kind: 'pages', rows, requests, complete: true };
    if (decision === 'cap') {
      const reason = input.budget < input.perDateLimit ? 'invocation_budget' : 'per_date_cap';
      if (input.onCap === 'throw') {
        throw new OddsPageCapError(`odds page cap ${input.budget} reached for ${input.date}`);
      }
      return { kind: 'pages', rows, requests, complete: false, reason };
    }

    let reservationId = '';
    if (input.reserve) {
      const decision = await input.reserve();
      if (!decision.ok) return { kind: 'budget', rows, requests, reason: decision.reason };
      reservationId = decision.reservationId;
    }
    requests += 1;
    let page: OddsPageResult;
    try {
      page = await input.fetchPage(input.date, cursor);
      await input.record?.({ reservationId, outcome: page.ok ? 'success' : 'failure' });
    } catch (err) {
      await input.record?.({ reservationId, outcome: 'failure' }).catch(() => undefined);
      return {
        kind: 'thrown',
        timeout: isProviderTimeout(err),
        message: err instanceof Error ? err.message : 'odds provider failed',
        rows,
        requests,
      };
    }
    if (!page.ok) return { kind: 'http', status: page.status, rows, requests };
    pages += 1;
    rows.push(...page.rows);
    cursor = page.nextCursor;
  }
}

async function storeRaw(
  deps: AcquireDeps,
  pullRunId: number,
  rows: readonly OddsProviderRow[]
): Promise<number> {
  let stored = 0;
  for (const row of rows) {
    await deps.insertRaw(pullRunId, row);
    stored += 1;
  }
  return stored;
}

function emptyDate(date: string, classification: DateClassification, reason?: string): DateAcquisition {
  return { date, classification, rowsFetched: 0, rowsStored: 0, providerRequests: 0, reason };
}

async function finishError(
  deps: AcquireDeps,
  date: string,
  pullRunId: number | undefined,
  classification: DateClassification,
  rowsFetched: number,
  rowsStored: number,
  requests: number,
  reason: string
): Promise<DateAcquisition> {
  if (pullRunId != null) {
    await deps.completePullRun(
      pullRunId,
      rowsFetched,
      rowsStored,
      'error',
      { classification, providerRequests: requests },
      reason
    );
  }
  return { date, classification, pullRunId, rowsFetched, rowsStored, providerRequests: requests, reason };
}

async function persistNormalPages(
  deps: AcquireDeps,
  date: string,
  collected: Extract<Collected, { kind: 'pages' }>,
  checkIdentity: boolean
): Promise<DateAcquisition> {
  if (!collected.complete && collected.rows.length === 0) {
    return {
      ...emptyDate(date, 'INCOMPLETE', collected.reason),
      providerRequests: collected.requests,
    };
  }

  const pullRunId = await deps.createPullRun(date);
  let stored = 0;
  try {
    stored = await storeRaw(deps, pullRunId, collected.rows);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'raw persistence failed';
    return finishError(deps, date, pullRunId, 'RAW_PERSISTENCE', collected.rows.length, stored, collected.requests, reason);
  }

  if (!collected.complete) {
    return finishError(
      deps,
      date,
      pullRunId,
      'INCOMPLETE',
      collected.rows.length,
      stored,
      collected.requests,
      collected.reason ?? 'per_date_cap'
    );
  }

  if (collected.rows.length === 0) {
    await deps.completePullRun(pullRunId, 0, 0, 'success', { classification: 'PROVIDER_EMPTY', providerRequests: collected.requests });
    return {
      date,
      classification: 'PROVIDER_EMPTY',
      pullRunId,
      rowsFetched: 0,
      rowsStored: 0,
      providerRequests: collected.requests,
    };
  }

  if (checkIdentity) {
    const gameIds = [...new Set(collected.rows.map((row) => String(row.game_id)))];
    const games = await deps.loadGames(gameIds);
    const assessment = assessOddsGames({ queriedDate: date, rows: collected.rows, games });
    if (!assessment.ok) {
      return finishError(deps, date, pullRunId, 'IDENTITY', collected.rows.length, stored, collected.requests, assessment.reason);
    }
  }

  try {
    const transform = await deps.transformComplete(pullRunId);
    await deps.completePullRun(pullRunId, collected.rows.length, stored, 'success', {
      classification: 'COMPLETE',
      providerRequests: collected.requests,
      transform,
    });
    return {
      date,
      classification: 'COMPLETE',
      pullRunId,
      rowsFetched: collected.rows.length,
      rowsStored: stored,
      providerRequests: collected.requests,
      transform,
    };
  } catch (err) {
    const tagged = err instanceof OddsPersistError ? err : (err as Error & { oddsStep?: DateClassification });
    const classification = tagged.oddsStep ?? 'CURRENT_PERSISTENCE';
    const reason = tagged.message || 'analytics persistence failed';
    return finishError(deps, date, pullRunId, classification, collected.rows.length, stored, collected.requests, reason);
  }
}

function refused(status: string, reason: string): AcquireResult {
  return {
    success: false,
    status,
    httpStatus: 500,
    providerRequests: 0,
    dates: [],
    results: [],
    totalFetched: 0,
    totalStored: 0,
    reason,
  };
}

function quiet(status: 'NO_DUE_WORK' | 'STALE', reason: string): AcquireResult {
  const result: AcquireResult = {
    success: status === 'NO_DUE_WORK',
    status,
    httpStatus: 200,
    providerRequests: 0,
    dates: [],
    results: [],
    totalFetched: 0,
    totalStored: 0,
    reason,
  };
  console.log(JSON.stringify(oddsAcquisitionEvent({
    success: result.success,
    status,
    providerRequests: 0,
    classifications: [status],
  })));
  return result;
}

export async function acquireOdds(event: OddsInvocation, deps: AcquireDeps): Promise<AcquireResult> {
  const canaryOnly = isOddsCanaryOnly(deps.env);
  const canaryEvent = isOpeningNightCanaryEvent(event);
  if (canaryOnly && !canaryEvent) assertCanaryEvent(event);
  if (canaryEvent) {
    assertCanaryLimiter(deps.env);
    const dates = assertCanaryEvent(event);
    const results: DateAcquisition[] = [];
    let providerRequests = 0;
    for (const date of dates) {
      const collected = await collectDatePages({
        date,
        budget: OPENING_NIGHT_ODDS_MAX_PAGES,
        perDateLimit: OPENING_NIGHT_ODDS_MAX_PAGES,
        fetchPage: deps.fetchPage,
        onCap: 'throw',
      });
      providerRequests += collected.requests;
      if (collected.kind === 'budget') {
        throw Object.assign(new Error(`odds budget ${collected.reason}`), { classification: 'BUDGET_UNAVAILABLE', providerRequests });
      }
      if (collected.kind !== 'pages') {
        const classification = collected.kind === 'http'
          ? httpFailure(collected.status)
          : collected.timeout ? 'TIMEOUT' : 'PROVIDER_ERROR';
        const reason = collected.kind === 'http' ? `BDL API error: ${collected.status}` : collected.message;
        throw Object.assign(new Error(reason), { classification, providerRequests });
      }
      assertCanaryGames(collected.rows.map((row) => row.game_id));
      results.push(await persistNormalPages(deps, date, collected, false));
    }
    const failed = results.find((result) => result.classification !== 'COMPLETE' && result.classification !== 'PROVIDER_EMPTY');
    if (failed) throw new Error(failed.reason ?? failed.classification);
    return summarize(dates, results, providerRequests);
  }

  try {
    assertNormalLiveLimiter(deps.env);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'odds normal limiter refused';
    console.error(reason);
    return refused('LIMITER_REFUSED', reason);
  }

  const selected = selectNormalDates(event, deps.now());
  if (!selected.ok) {
    console.error(selected.reason);
    return refused('REJECTED', selected.reason);
  }

  if (deps.requireSafety && (!deps.reserveAttempt || !deps.claimDate || !deps.slateForDate)) {
    return refused('SAFETY_UNAVAILABLE', 'odds safety controls are not configured');
  }

  const now = deps.now();
  const day = etCalendarDate(now);
  let planned = selected.dates.map((date) => ({ date, windowId: 'discovery' }));
  if (deps.slateForDate) {
    const due: { date: string; windowId: string }[] = [];
    for (const date of selected.dates) {
      const plan = planDate({
        etDate: date,
        now,
        games: await deps.slateForDate(date),
        eventTime: event.time,
      });
      if (plan.reason === 'stale_event') return quiet('STALE', 'stale odds event');
      if (plan.due && plan.windowId) due.push({ date, windowId: plan.windowId });
    }
    if (due.length === 0) return quiet('NO_DUE_WORK', 'no odds date is due');
    due.sort(compareDueDates);
    planned = due;
  }

  const perDate = deps.maxPagesPerDate ?? NORMAL_MAX_PAGES_PER_DATE;
  let remaining = deps.maxPagesPerInvocation ?? (planned.length === 2
    ? SCHEDULED_INVOCATION_MAX_PAGES
    : perDate * planned.length);
  const results: DateAcquisition[] = [];
  let providerRequests = 0;
  let budgetRemaining: number | null | undefined = deps.budgetRemaining;
  const claimOwner = deps.claimOwner ?? 'odds-pre-game-snapshot';

  async function keep(date: string, windowId: string, result: DateAcquisition): Promise<void> {
    results.push(result);
    const finished = result.classification === 'COMPLETE'
      || result.classification === 'PROVIDER_EMPTY'
      || result.classification === 'INCOMPLETE';
    if (!finished) return;
    try {
      await deps.completeClaim?.({
        day,
        date,
        windowId,
        nowMs: now.getTime(),
        owner: claimOwner,
      });
    } catch (err) {
      console.error('odds completed window was not recorded');
    }
  }

  for (const item of planned) {
    const date = item.date;
    const dateCeiling = dailyAttemptCeiling();
    if (deps.claimDate) {
      const claim = await deps.claimDate({
        day,
        date,
        windowId: item.windowId,
        nowMs: now.getTime(),
        owner: claimOwner,
      });
      if (!claim.ok && claim.reason === 'skipped') {
        await keep(date, item.windowId, emptyDate(date, 'SKIPPED', 'duplicate odds window'));
        continue;
      }
      if (!claim.ok) {
        await keep(date, item.windowId, emptyDate(date, 'CLAIM_UNAVAILABLE', claim.reason));
        continue;
      }
    }
    const budget = pageBudgetForDate(perDate, remaining);
    let collected: Collected;
    try {
      collected = await collectDatePages({
        date,
        budget,
        perDateLimit: perDate,
        fetchPage: deps.fetchPage,
        onCap: 'incomplete',
        reserve: deps.reserveAttempt
          ? async () => {
            const decision = await deps.reserveAttempt!({ day, date, dateCeiling });
            if (decision.ok) budgetRemaining = decision.remaining;
            return decision;
          }
          : undefined,
        record: deps.recordAttempt,
      });
    } catch (err) {
      providerRequests += 0;
      await keep(date, item.windowId, emptyDate(date, 'PROVIDER_ERROR', err instanceof Error ? err.message : 'odds page collection failed'));
      continue;
    }
    providerRequests += collected.requests;
    remaining -= collected.requests;
    if (collected.kind === 'budget') {
      const classification = collected.reason === 'exhausted' ? 'BUDGET_EXHAUSTED' : 'BUDGET_UNAVAILABLE';
      if (collected.rows.length === 0) {
        await keep(date, item.windowId, emptyDate(date, classification, collected.reason));
        continue;
      }
      const pullRunId = await deps.createPullRun(date);
      let stored = 0;
      try {
        stored = await storeRaw(deps, pullRunId, collected.rows);
      } catch (err) {
        results.push(await finishError(
          deps,
          date,
          pullRunId,
          'RAW_PERSISTENCE',
          collected.rows.length,
          stored,
          collected.requests,
          err instanceof Error ? err.message : 'raw persistence failed'
        ));
        continue;
      }
      results.push(await finishError(
        deps,
        date,
        pullRunId,
        classification,
        collected.rows.length,
        stored,
        collected.requests,
        collected.reason
      ));
      continue;
    }
    if (collected.kind === 'http') {
      const classification = httpFailure(collected.status);
      const pullRunId = await deps.createPullRun(date);
      let stored = 0;
      try {
        stored = await storeRaw(deps, pullRunId, collected.rows);
      } catch (err) {
        results.push(await finishError(
          deps,
          date,
          pullRunId,
          'RAW_PERSISTENCE',
          collected.rows.length,
          stored,
          collected.requests,
          err instanceof Error ? err.message : 'raw persistence failed'
        ));
        continue;
      }
      results.push(await finishError(
        deps,
        date,
        pullRunId,
        classification,
        collected.rows.length,
        stored,
        collected.requests,
        `BDL API error: ${collected.status}`
      ));
      continue;
    }
    if (collected.kind === 'thrown') {
      const classification = collected.timeout ? 'TIMEOUT' : 'PROVIDER_ERROR';
      const pullRunId = await deps.createPullRun(date);
      let stored = 0;
      try {
        stored = await storeRaw(deps, pullRunId, collected.rows);
      } catch (err) {
        results.push(await finishError(
          deps,
          date,
          pullRunId,
          'RAW_PERSISTENCE',
          collected.rows.length,
          stored,
          collected.requests,
          err instanceof Error ? err.message : 'raw persistence failed'
        ));
        continue;
      }
      results.push(await finishError(
        deps,
        date,
        pullRunId,
        classification,
        collected.rows.length,
        stored,
        collected.requests,
        collected.message
      ));
      continue;
    }
    await keep(date, item.windowId, await persistNormalPages(deps, date, collected, true));
  }

  return summarize(planned.map((item) => item.date), results, providerRequests, budgetRemaining);
}

function summarize(
  dates: string[],
  results: DateAcquisition[],
  providerRequests: number,
  budgetRemaining?: number | null
): AcquireResult {
  const summary = summarizeClassifications(results.map((result) => result.classification));
  const totalFetched = results.reduce((sum, result) => sum + result.rowsFetched, 0);
  const totalStored = results.reduce((sum, result) => sum + result.rowsStored, 0);
  const quietStatus = summary.status === 'SKIPPED' || summary.status === 'STALE' || summary.status === 'NO_DUE_WORK';
  const result: AcquireResult = {
    success: summary.success,
    status: summary.status,
    httpStatus: summary.success || quietStatus ? 200 : 500,
    providerRequests,
    dates,
    results,
    totalFetched,
    totalStored,
    budgetRemaining,
  };
  const pregameEligibleRows = results.reduce((sum, result) => sum + (result.transform?.pregameEligibleRows ?? 0), 0);
  const postTipRowsSkipped = results.reduce((sum, result) => sum + (result.transform?.postTipRowsSkipped ?? 0), 0);
  const currentRowsUpdated = results.reduce((sum, result) => sum + (result.transform?.currentRowsUpdated ?? result.transform?.current ?? 0), 0);
  const historyRowsInserted = results.reduce((sum, result) => sum + (result.transform?.historyRowsInserted ?? result.transform?.history ?? 0), 0);
  const movementRowsInserted = results.reduce((sum, result) => sum + (result.transform?.movementRowsInserted ?? result.transform?.movement ?? 0), 0);
  console.log(JSON.stringify(oddsAcquisitionEvent({
    success: result.success,
    status: result.status,
    providerRequests,
    classifications: results.map((item) => item.classification),
    budgetRemaining,
    acquiredRows: totalFetched,
    rawRowsPersisted: totalStored,
    pregameEligibleRows,
    postTipRowsSkipped,
    currentRowsUpdated,
    historyRowsInserted,
    movementRowsInserted,
  })));
  return result;
}
