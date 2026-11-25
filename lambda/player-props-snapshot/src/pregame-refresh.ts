import { PLAYER_PROPS_MAX_HTTP_ATTEMPTS, PROPS_DAILY_HTTP_ATTEMPT_CAP } from './attempt-budget';
import { PROPS_PAGES_ALLOWANCE_PER_COLLECTION } from './acquisition-budget';
import { ENQUEUE_FAILED } from './bulk-writers';
import {
  isClosingEligible,
  isNearTipEligible,
  isPregameCollectionStatus,
  isPregameRefreshWindow,
  PREGAME_REFRESH_INTERVAL_MS,
  type PropUniverse,
} from './game-discovery';
import { BASE_SCHEDULE_FRESHNESS_MS } from '../../../lib/props/s3-current-board/pointer';
import { CLUSTER_HALT_BYTES } from '../../../lib/ops/storage-budget';

export const PREGAME_PLANNING_PAGES_DEFAULT = 3;
export const LIMITER_INTERVAL_MS = 13_000;
export const WORKER_CONCURRENCY = 2;

/** Planning estimates, not measured heap or a live table size. */
export const GAME_RUN_ROW_ESTIMATE_BYTES = 512;
export const PULL_RUN_ROW_ESTIMATE_BYTES = 256;
export const OBSERVED_ARCHIVE_GZIP_BYTES = 106_000;
export const OBSERVED_MANIFEST_BYTES = 900;

export type PlanningPages = 1 | 2 | 3;

export type PregameSkipReason =
  | 'outside_window'
  | 'ineligible_status'
  | 'active_or_queued'
  | 'same_interval'
  | 'cross_universe'
  | 'budget'
  | 'closing_reserve'
  | 'near_tip_reserve'
  | 'storage_admission';

export type PregameRunSnapshot = {
  gameId: string;
  universe: PropUniverse;
  status: 'started' | 'success' | 'error';
  errorMessage: string | null;
  startedAtMs: number;
  providerAttempts: number;
};

export type PregameCandidate = {
  gameId: string;
  tipMs: number;
  status: string | null;
  lastSuccessAtMs: number | null;
};

export type InFlightExposure = {
  gameId: string;
  attemptsReserved: number;
};

export type PregamePlan = {
  admit: string[];
  skipped: Array<{ gameId: string; reason: PregameSkipReason }>;
  /** Pages used for the hold and for refresh admission. Not a completed request. */
  chargePages: number;
  /** True when the planning assumption was below the allowance or the observed ledger peak. */
  protectionRaised: boolean;
  observedPeak: number;
};

export function resolvePlanningPages(raw: string | undefined): PlanningPages {
  if (raw == null || raw.trim() === '') return PREGAME_PLANNING_PAGES_DEFAULT;
  if (raw.trim() === '1' || raw.trim() === '2' || raw.trim() === '3') return Number(raw.trim()) as PlanningPages;
  throw new Error('PLAYER_PROPS_PLANNING_PAGES must be 1, 2, or 3');
}

/** Unknown means the worker gate remains the authority. A measured cluster at the halt refuses. */
export function storageAdmissionDecision(clusterBytes: number | null): 'unknown' | 'admit' | 'refuse' {
  if (clusterBytes == null) return 'unknown';
  if (!Number.isFinite(clusterBytes) || clusterBytes >= CLUSTER_HALT_BYTES) return 'refuse';
  return 'admit';
}

function blocksRefresh(run: PregameRunSnapshot): boolean {
  return !(run.status === 'error' && run.errorMessage === ENQUEUE_FAILED);
}

/** Finished fetches only. A started row is not evidence of how many pages the provider will use. */
export function observedProviderAttemptPeak(runs: readonly PregameRunSnapshot[]): number {
  let peak = 0;
  for (const run of runs) {
    if (run.status === 'started' || run.errorMessage === ENQUEUE_FAILED) continue;
    if (run.providerAttempts > peak) peak = run.providerAttempts;
  }
  return peak;
}

export function resolveProtectionPages(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return PROPS_PAGES_ALLOWANCE_PER_COLLECTION;
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new Error('PLAYER_PROPS_PROTECTION_PAGES must be an integer from 1 to 10');
  }
  const value = Number(raw.trim());
  if (value < 1 || value > PLAYER_PROPS_MAX_HTTP_ATTEMPTS) {
    throw new Error('PLAYER_PROPS_PROTECTION_PAGES must be an integer from 1 to 10');
  }
  return value;
}

/**
 * Advisory admission. The charge is the larger of the planning assumption,
 * the configured allowance, and pages already recorded on the ledger.
 * It is not added to the attempt counter. The ledger still counts only
 * requests that were actually reserved.
 */
export function planPregameRefresh(args: {
  nowMs: number;
  candidates: readonly PregameCandidate[];
  runs: readonly PregameRunSnapshot[];
  consumedAttempts: number;
  planningPages: PlanningPages;
  protectionPages?: number;
  inFlight: readonly InFlightExposure[];
  closingGames: number;
  nearTipGames: number;
  storage: 'unknown' | 'admit' | 'refuse';
  dailyCap?: number;
}): PregamePlan {
  const cap = args.dailyCap ?? PROPS_DAILY_HTTP_ATTEMPT_CAP;
  const observedPeak = observedProviderAttemptPeak(args.runs);
  const configured = args.protectionPages ?? PROPS_PAGES_ALLOWANCE_PER_COLLECTION;
  const chargePages = Math.max(args.planningPages, configured, observedPeak);
  const skipped: PregamePlan['skipped'] = [];
  const due: PregameCandidate[] = [];
  for (const candidate of args.candidates) {
    const reason = refreshBlock(candidate, args.runs, args.nowMs);
    if (reason) skipped.push({ gameId: candidate.gameId, reason });
    else due.push(candidate);
  }
  const empty = { chargePages, protectionRaised: chargePages > args.planningPages, observedPeak };
  if (args.storage === 'refuse') {
    for (const candidate of due) skipped.push({ gameId: candidate.gameId, reason: 'storage_admission' });
    return { admit: [], skipped, ...empty };
  }
  const remaining = cap - args.consumedAttempts;
  const inFlightExtra = args.inFlight.reduce(
    (sum, row) => sum + Math.max(0, chargePages - Math.max(0, row.attemptsReserved)),
    0
  );
  const closingHold = Math.max(0, args.closingGames) * chargePages;
  const nearHold = Math.max(0, args.nearTipGames) * chargePages;
  let available = remaining - inFlightExtra - closingHold - nearHold;
  const admit: string[] = [];
  const ordered = [...due].sort((a, b) => compareCandidates(a, b, args.nowMs));
  for (const candidate of ordered) {
    if (available >= chargePages) {
      admit.push(candidate.gameId);
      available -= chargePages;
      continue;
    }
    skipped.push({ gameId: candidate.gameId, reason: budgetReason(remaining, inFlightExtra, closingHold, nearHold, chargePages) });
  }
  return { admit, skipped, ...empty };
}

function budgetReason(
  remaining: number,
  inFlightExtra: number,
  closingHold: number,
  nearHold: number,
  planningPages: number
): PregameSkipReason {
  const afterInFlight = remaining - inFlightExtra;
  if (afterInFlight < planningPages) return 'budget';
  if (afterInFlight - closingHold < planningPages) return 'closing_reserve';
  return 'near_tip_reserve';
}

function refreshBlock(
  candidate: PregameCandidate,
  runs: readonly PregameRunSnapshot[],
  nowMs: number
): PregameSkipReason | null {
  if (!isPregameCollectionStatus(candidate.status)) return 'ineligible_status';
  if (!isPregameRefreshWindow(new Date(candidate.tipMs), new Date(nowMs))) return 'outside_window';
  const related = runs.filter((run) => run.gameId === candidate.gameId && blocksRefresh(run));
  if (related.some((run) => run.status === 'started')) return 'active_or_queued';
  const recent = related.filter((run) => nowMs - run.startedAtMs < PREGAME_REFRESH_INTERVAL_MS && nowMs >= run.startedAtMs);
  if (recent.length === 0) return null;
  return recent.some((run) => run.universe !== 'pregame_refresh') ? 'cross_universe' : 'same_interval';
}

function compareCandidates(a: PregameCandidate, b: PregameCandidate, nowMs: number): number {
  const delta = a.tipMs - nowMs - (b.tipMs - nowMs);
  if (delta !== 0) return delta;
  const aMissing = a.lastSuccessAtMs == null ? 0 : 1;
  const bMissing = b.lastSuccessAtMs == null ? 0 : 1;
  if (aMissing !== bMissing) return aMissing - bMissing;
  const age = (a.lastSuccessAtMs ?? 0) - (b.lastSuccessAtMs ?? 0);
  if (age !== 0) return age;
  if (a.gameId === b.gameId) return 0;
  return a.gameId < b.gameId ? -1 : 1;
}

export type SlateGame = {
  gameId: string;
  tipMs: number;
  status?: string | null;
};

export type SimulatedCollection = {
  gameId: string;
  universe: PropUniverse;
  tickMs: number;
  responseMs: number;
  attempts: number;
  success: boolean;
};

export type FreshnessGap = {
  gameId: string;
  fromMs: number;
  toMs: number;
};

export type SlateSimulation = {
  attempts: number;
  collections: SimulatedCollection[];
  skipped: Array<{ gameId: string; tickMs: number; reason: PregameSkipReason }>;
  gaps: FreshnessGap[];
  quickBuildOverlapMs: number;
  pullRuns: number;
  closingCollections: number;
  nearTipCollections: number;
  refreshCollections: number;
  closingShortfall: number;
  protectionRaised: boolean;
};

export type ScheduleUniverse = 'near_tip' | 'closing' | 'pregame_refresh';

export type ScheduleFire = { atMs: number; universe: ScheduleUniverse };

const FIRE_ORDER: Record<ScheduleUniverse, number> = { near_tip: 0, closing: 1, pregame_refresh: 2 };

/**
 * Quarter-hour fires match the near-tip cron. Closing uses the five-minute cron.
 * Refresh has no schedule of its own; the simulation places it on the same
 * quarter-hour grid, which is the cadence an operator can actually select.
 */
export function scheduledFires(etDate: string): ScheduleFire[] {
  const fires: ScheduleFire[] = [];
  for (let hour = 8; hour <= 23; hour += 1) {
    for (let minute = 0; minute < 60; minute += 5) {
      const atMs = easternWallTimeToUtc(etDate, hour, minute);
      if (minute % 15 === 0) {
        fires.push({ atMs, universe: 'near_tip' });
        fires.push({ atMs, universe: 'pregame_refresh' });
      }
      fires.push({ atMs, universe: 'closing' });
    }
  }
  fires.sort((a, b) => a.atMs - b.atMs || FIRE_ORDER[a.universe] - FIRE_ORDER[b.universe]);
  return fires;
}

export function easternWallTimeToUtc(etDate: string, hour: number, minute: number): number {
  const [year, month, day] = etDate.split('-').map(Number);
  let utc = Date.UTC(year, month - 1, day, hour + 5, minute);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(utc));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    if (read('year') === year && read('month') === month && read('day') === day && read('hour') === hour && read('minute') === minute) {
      return utc;
    }
    const dayDelta = day - read('day');
    const hourDelta = hour - read('hour');
    const minuteDelta = minute - read('minute');
    utc += ((dayDelta * 24 + hourDelta) * 60 + minuteDelta) * 60_000;
  }
  return utc;
}

export function pregameRefreshMigrated(definition: string | null | undefined): boolean {
  return typeof definition === 'string' && /\bpregame_refresh\b/.test(definition);
}

/**
 * Walk the real cron grid. `planningPages` is the operator assumption.
 * The protection allowance and any higher page count already on the ledger
 * raise the hold. `actualPages` is what the ledger consumes when a fetch runs.
 * A hold is not a completed request.
 */
export function simulatePregameSlate(args: {
  games: readonly SlateGame[];
  etDate: string;
  planningPages: PlanningPages;
  actualPages: number;
  protectionPages?: number;
  consumed?: number;
  /** Earlier broad runs. Their attempts are already included in `consumed`. */
  initialRuns?: readonly PregameRunSnapshot[];
  workerDelayMs?: number;
  failures?: readonly { gameId: string; tickMs: number; attempts?: number }[];
  extraReceives?: number;
  storageClusterBytes?: number | null;
  dailyCap?: number;
}): SlateSimulation {
  const planningPages = args.planningPages;
  const actualPages = args.actualPages;
  const cap = args.dailyCap ?? PROPS_DAILY_HTTP_ATTEMPT_CAP;
  let consumed = args.consumed ?? 0;
  const delay = args.workerDelayMs ?? 0;
  const runs: PregameRunSnapshot[] = [...(args.initialRuns ?? [])];
  const completions = new Map<string, number>();
  const collections: SimulatedCollection[] = [];
  const skipped: SlateSimulation['skipped'] = [];
  let pullRuns = 0;
  let protectionRaised = false;

  const failureAt = new Map((args.failures ?? []).map((failure) => [`${failure.gameId}:${failure.tickMs}`, failure.attempts ?? 1]));
  const fires = scheduledFires(args.etDate);

  for (const fire of fires) {
    const now = fire.atMs;
    for (const [key, done] of completions) {
      if (done <= now) {
        const run = runs.find((item) => `${item.gameId}:${item.startedAtMs}` === key && item.status === 'started');
        if (run) run.status = 'success';
        completions.delete(key);
      }
    }
    const storage = storageAdmissionDecision(args.storageClusterBytes ?? null);
    if (fire.universe !== 'pregame_refresh') {
      const existing = collectExistingUniverse({
        universe: fire.universe,
        games: args.games,
        now,
        runs,
        consumed,
        cap,
        actualPages,
        storage,
        delay,
        failureAt,
        extraReceives: args.extraReceives ?? 0,
      });
      if (existing.collections.length > 0) pullRuns += 1;
      collections.push(...existing.collections);
      skipped.push(...existing.skipped);
      consumed = existing.consumed;
      for (const run of existing.runs) {
        if (run.status === 'started') {
          const match = existing.collections.find((item) => item.gameId === run.gameId && item.tickMs === run.startedAtMs);
          if (match) completions.set(`${run.gameId}:${run.startedAtMs}`, match.responseMs);
        }
      }
      runs.push(...existing.runs);
      continue;
    }

    const candidates = args.games.map((game) => ({
      gameId: game.gameId,
      tipMs: game.tipMs,
      status: game.status ?? 'scheduled',
      lastSuccessAtMs: lastSuccess(runs, game.gameId),
    }));
    const plan = planPregameRefresh({
      nowMs: now,
      candidates,
      runs,
      consumedAttempts: consumed,
      planningPages,
      protectionPages: args.protectionPages,
      inFlight: inFlight(runs),
      closingGames: countNeed(args.games, runs, now, 'closing'),
      nearTipGames: countNeed(args.games, runs, now, 'near_tip'),
      storage,
      dailyCap: cap,
    });
    if (plan.protectionRaised) protectionRaised = true;
    const admitted = plan.admit;
    if (admitted.length > 0) pullRuns += 1;
    let waveAttempts = 0;
    for (const gameId of admitted) {
      const failedAttempts = failureAt.get(`${gameId}:${now}`);
      const attempts = failedAttempts ?? actualPages;
      if (consumed + attempts > cap) {
        skipped.push({ gameId, tickMs: now, reason: 'budget' });
        continue;
      }
      const retryAttempts = Math.min(args.extraReceives ?? 0, Math.max(0, 10 - attempts), cap - consumed - attempts);
      consumed += attempts + retryAttempts;
      waveAttempts += attempts;
      const responseMs = now + delay + waveAttempts * LIMITER_INTERVAL_MS;
      const game = args.games.find((item) => item.gameId === gameId);
      const success = failedAttempts == null && game != null && responseMs < game.tipMs;
      const run: PregameRunSnapshot = {
        gameId,
        universe: 'pregame_refresh',
        status: 'error',
        errorMessage: failedAttempts != null ? 'provider_429' : success ? null : 'post_tip',
        startedAtMs: now,
        providerAttempts: attempts + retryAttempts,
      };
      if (success) {
        completions.set(`${gameId}:${now}`, responseMs);
        run.status = 'started';
      }
      runs.push(run);
      collections.push({
        gameId,
        universe: 'pregame_refresh',
        tickMs: now,
        responseMs,
        attempts: attempts + retryAttempts,
        success,
      });
    }
    for (const skip of plan.skipped) skipped.push({ ...skip, tickMs: now });
  }

  const successful = collections.filter((item) => item.success);
  const closingEligible = args.games.filter((game) =>
    fires.some(
      (fire) =>
        fire.universe === 'closing' &&
        isClosingEligible(new Date(game.tipMs), new Date(fire.atMs), game.status ?? 'scheduled')
    )
  ).length;
  return {
    attempts: consumed - (args.consumed ?? 0),
    collections,
    skipped,
    gaps: freshnessGaps(args.games, successful),
    quickBuildOverlapMs: quickBuildOverlap(args.games, successful),
    pullRuns,
    closingCollections: successful.filter((item) => item.universe === 'closing').length,
    nearTipCollections: successful.filter((item) => item.universe === 'near_tip').length,
    refreshCollections: successful.filter((item) => item.universe === 'pregame_refresh').length,
    closingShortfall: closingEligible - successful.filter((item) => item.universe === 'closing').length,
    protectionRaised,
  };
}

function lastSuccess(runs: readonly PregameRunSnapshot[], gameId: string): number | null {
  const times = runs
    .filter((run) => run.gameId === gameId && run.status === 'success')
    .map((run) => run.startedAtMs);
  if (times.length === 0) return null;
  return Math.max(...times);
}

function inFlight(runs: readonly PregameRunSnapshot[]): InFlightExposure[] {
  return runs
    .filter((run) => run.status === 'started')
    .map((run) => ({ gameId: run.gameId, attemptsReserved: run.providerAttempts }));
}

function countNeed(
  games: readonly SlateGame[],
  runs: readonly PregameRunSnapshot[],
  now: number,
  universe: 'closing' | 'near_tip'
): number {
  return games.filter((game) => {
    const status = game.status ?? 'scheduled';
    if (!isPregameCollectionStatus(status)) return false;
    const delta = game.tipMs - now;
    if (delta <= 0) return false;
    if (universe === 'near_tip' && delta < 60 * 60_000) return false;
    return !runs.some((run) => run.gameId === game.gameId && run.universe === universe && run.status === 'success');
  }).length;
}

function collectExistingUniverse(args: {
  universe: 'near_tip' | 'closing';
  games: readonly SlateGame[];
  now: number;
  runs: readonly PregameRunSnapshot[];
  consumed: number;
  cap: number;
  actualPages: number;
  storage: 'unknown' | 'admit' | 'refuse';
  delay: number;
  failureAt: ReadonlyMap<string, number>;
  extraReceives: number;
}): {
  collections: SimulatedCollection[];
  skipped: SlateSimulation['skipped'];
  runs: PregameRunSnapshot[];
  consumed: number;
} {
  const collections: SimulatedCollection[] = [];
  const skipped: SlateSimulation['skipped'] = [];
  const created: PregameRunSnapshot[] = [];
  let consumed = args.consumed;
  if (args.storage === 'refuse') return { collections, skipped, runs: created, consumed };
  let cursor = 0;
  for (const game of args.games) {
    const start = new Date(game.tipMs);
    const now = new Date(args.now);
    const status = game.status ?? 'scheduled';
    const inWindow = args.universe === 'closing' ? isClosingEligible(start, now, status) : isNearTipEligible(start, now, status);
    if (!inWindow || !isPregameCollectionStatus(status)) continue;
    const blocked = observationBlocked(args.universe, game.gameId, args.runs, args.now);
    if (blocked) {
      skipped.push({ gameId: game.gameId, tickMs: args.now, reason: blocked });
      continue;
    }
    const failedAttempts = args.failureAt.get(`${game.gameId}:${args.now}`);
    const attempts = failedAttempts ?? args.actualPages;
    if (consumed + attempts > args.cap) {
      skipped.push({ gameId: game.gameId, tickMs: args.now, reason: 'budget' });
      continue;
    }
    const retryAttempts = Math.min(args.extraReceives, Math.max(0, 10 - attempts), args.cap - consumed - attempts);
    consumed += attempts + retryAttempts;
    cursor += attempts;
    const responseMs = args.now + args.delay + cursor * LIMITER_INTERVAL_MS;
    const success = failedAttempts == null && responseMs < game.tipMs;
    created.push({
      gameId: game.gameId,
      universe: args.universe,
      status: success ? 'started' : 'error',
      errorMessage: failedAttempts != null ? 'provider_429' : success ? null : 'post_tip',
      startedAtMs: args.now,
      providerAttempts: attempts + retryAttempts,
    });
    collections.push({
      gameId: game.gameId,
      universe: args.universe,
      tickMs: args.now,
      responseMs,
      attempts: attempts + retryAttempts,
      success,
    });
  }
  return { collections, skipped, runs: created, consumed };
}

function observationBlocked(
  universe: 'near_tip' | 'closing',
  gameId: string,
  runs: readonly PregameRunSnapshot[],
  nowMs: number
): PregameSkipReason | null {
  const related = runs.filter((run) => run.gameId === gameId && blocksRefresh(run));
  const observation = new Set<PropUniverse>(['near_tip', 'pregame_refresh', 'closing']);
  if (related.some((run) => run.status === 'started' && observation.has(run.universe))) return 'active_or_queued';
  if (universe === 'near_tip') {
    const recentRefresh = related.some(
      (run) => run.universe === 'pregame_refresh' && nowMs >= run.startedAtMs && nowMs - run.startedAtMs < PREGAME_REFRESH_INTERVAL_MS
    );
    if (recentRefresh) return 'cross_universe';
  }
  const sameWindow = 600_000;
  if (related.some((run) => run.universe === universe && nowMs >= run.startedAtMs && nowMs - run.startedAtMs < sameWindow)) {
    return 'same_interval';
  }
  return null;
}

export function freshnessGaps(games: readonly SlateGame[], collections: readonly SimulatedCollection[]): FreshnessGap[] {
  const gaps: FreshnessGap[] = [];
  for (const game of games) {
    const observed = collections
      .filter((item) => item.gameId === game.gameId && item.success)
      .map((item) => item.responseMs)
      .sort((a, b) => a - b);
    const horizonStart = game.tipMs - 120 * 60_000;
    let cursor = horizonStart;
    for (const response of observed) {
      const freshFrom = response;
      const freshUntil = Math.min(game.tipMs, response + BASE_SCHEDULE_FRESHNESS_MS);
      if (freshFrom > cursor && freshFrom < game.tipMs) gaps.push({ gameId: game.gameId, fromMs: cursor, toMs: Math.min(freshFrom, game.tipMs) });
      if (freshUntil > cursor) cursor = freshUntil;
    }
    if (cursor < game.tipMs) gaps.push({ gameId: game.gameId, fromMs: cursor, toMs: game.tipMs });
  }
  return gaps;
}

/** Milliseconds during which at least two games are inside the 30-minute window and still pre-tip. */
export function quickBuildOverlap(games: readonly SlateGame[], collections: readonly SimulatedCollection[]): number {
  const events: Array<{ at: number; delta: number }> = [];
  for (const game of games) {
    for (const item of collections) {
      if (item.gameId !== game.gameId || !item.success) continue;
      const end = Math.min(game.tipMs, item.responseMs + BASE_SCHEDULE_FRESHNESS_MS);
      if (end <= item.responseMs) continue;
      events.push({ at: item.responseMs, delta: 1 });
      events.push({ at: end, delta: -1 });
    }
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let open = 0;
  let last = events[0]?.at ?? 0;
  let overlap = 0;
  for (const event of events) {
    if (open >= 2 && event.at > last) overlap += event.at - last;
    open += event.delta;
    last = event.at;
  }
  return overlap;
}

export function estimateControlRowBytes(gameRuns: number, pullRuns: number): number {
  return gameRuns * GAME_RUN_ROW_ESTIMATE_BYTES + pullRuns * PULL_RUN_ROW_ESTIMATE_BYTES;
}

export function estimateArchiveBytes(successfulObservations: number): number {
  return successfulObservations * (OBSERVED_ARCHIVE_GZIP_BYTES + OBSERVED_MANIFEST_BYTES);
}
