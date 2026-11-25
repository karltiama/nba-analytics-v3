import type { Pool } from 'pg';
import { PROPS_PAGES_ALLOWANCE_PER_COLLECTION } from './acquisition-budget';
import { PROPS_DAILY_HTTP_ATTEMPT_CAP } from './attempt-budget';
import { isPregameRefreshWindow, type PropUniverse } from './game-discovery';
import {
  easternWallTimeToUtc,
  LIMITER_INTERVAL_MS,
  observedProviderAttemptPeak,
  simulatePregameSlate,
  type InFlightExposure,
  type PlanningPages,
  type PregameRunSnapshot,
  type SlateSimulation,
} from './pregame-refresh';

/**
 * Early-day broad policy for the existing 08:00, 12:00, and 14:00 ET schedules.
 * A planning hold is not a reserved provider attempt. The worker still reserves
 * each HTTP request before it calls the provider.
 */
export type BroadWave = 'morning' | 'midday' | 'afternoon';

export type BaselineQuality =
  | 'no_observation'
  | 'failed'
  | 'incomplete'
  | 'empty_board'
  | 'no_draftkings'
  | 'draftkings_without_two_sided'
  | 'usable'
  | 'coverage_unknown';

export type BaselineStamp = {
  books: number;
  dkMarkets: number;
  dkTwoSided: number;
};

export type BaselineObservation = {
  gameId: string;
  status: 'success' | 'error' | 'started';
  archiveStatus: string | null;
  rowsFetched: number;
  rowsArchived: number;
  rowsStored: number;
  stamp: BaselineStamp | null;
};

export type BroadSkipReason =
  | 'usable_baseline'
  | 'pregame_window'
  | 'budget'
  | 'closing_reserve'
  | 'near_tip_reserve'
  | 'started_run'
  | 'storage_admission';

const OBSERVATION_UNIVERSES: readonly PropUniverse[] = ['broad', 'near_tip', 'pregame_refresh', 'closing'];

/** Measured complete board from game 21718181. Planning estimate, not a new table. */
export const OBSERVED_ARCHIVE_GZIP_BYTES = 105_775;
export const OBSERVED_MANIFEST_BYTES = 900;
export const GAME_RUN_ROW_ESTIMATE_BYTES = 512;
export const PULL_RUN_ROW_ESTIMATE_BYTES = 256;

export const BROAD_BASELINE_EVIDENCE_SQL = `
-- broad_baseline_evidence
SELECT gr.game_id, gr.status, gr.archive_status, gr.rows_fetched, gr.rows_archived, gr.rows_stored,
       pr.metadata -> 'baselines' -> gr.game_id AS stamp
  FROM raw.player_prop_game_runs gr
  LEFT JOIN raw.player_prop_pull_runs pr ON pr.pull_run_id = gr.pull_run_id
 WHERE gr.game_id = ANY($1::text[])
   AND gr.started_at > now() - interval '18 hours'
   AND gr.status IN ('success', 'error')`;

export function easternHour(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
}

/** 08:00 is morning, 12:00 is midday, and 14:00 is afternoon. A late fire stays in that wave. */
export function broadWaveAt(now: Date): BroadWave {
  const hour = easternHour(now);
  if (hour < 12) return 'morning';
  if (hour < 14) return 'midday';
  return 'afternoon';
}

export function stampFromRows(
  rows: readonly {
    sportsbook: string;
    market_type: string;
    side: string;
    player_id: number;
    prop_type: string;
    line_value: number | null;
  }[]
): BaselineStamp {
  const books = new Set<string>();
  let dkMarkets = 0;
  const sides = new Map<string, Set<string>>();
  for (const row of rows) {
    books.add(row.sportsbook);
    if (row.sportsbook !== 'draftkings') continue;
    dkMarkets += 1;
    if (row.market_type !== 'over_under') continue;
    const key = `${row.player_id}|${row.prop_type}|${row.line_value}`;
    const seen = sides.get(key) ?? new Set<string>();
    seen.add(row.side);
    sides.set(key, seen);
  }
  let dkTwoSided = 0;
  for (const seen of sides.values()) {
    if (seen.has('over') && seen.has('under')) dkTwoSided += 1;
  }
  return { books: books.size, dkMarkets, dkTwoSided };
}

export function parseBaselineStamp(value: unknown): BaselineStamp | null {
  const raw = typeof value === 'string' ? safeJson(value) : value;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const books = Number(row.books);
  const dkMarkets = Number(row.dkMarkets);
  const dkTwoSided = Number(row.dkTwoSided);
  if (![books, dkMarkets, dkTwoSided].every((item) => Number.isFinite(item) && item >= 0)) return null;
  return { books, dkMarkets, dkTwoSided };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Minimal validity, not a coverage score. A usable baseline is one completed
 * archive with at least one two-sided DraftKings over/under market. The stored
 * first pulls that still have vendor rows had 43 to 67 of those markets. That
 * range is not a floor: a smaller real board stays usable, and one market is
 * not a complete board. `rows_stored` is ignored. An empty board is a completed
 * archive with no rows, not a failed request.
 */
export function classifyBaseline(observation: BaselineObservation | null): BaselineQuality {
  if (observation == null) return 'no_observation';
  if (observation.status === 'error' || observation.archiveStatus === 'failed') return 'failed';
  if (observation.status !== 'success' || observation.archiveStatus !== 'archived') return 'incomplete';
  if (observation.rowsFetched === 0 && observation.rowsArchived === 0) return 'empty_board';
  if (observation.stamp == null) return 'coverage_unknown';
  if (observation.stamp.dkTwoSided > 0) return 'usable';
  if (observation.stamp.dkMarkets > 0) return 'draftkings_without_two_sided';
  return 'no_draftkings';
}

export function bestBaseline(observations: readonly BaselineObservation[]): BaselineQuality {
  if (observations.length === 0) return 'no_observation';
  const qualities = observations.map((observation) => classifyBaseline(observation));
  if (qualities.includes('usable')) return 'usable';
  const order: BaselineQuality[] = [
    'draftkings_without_two_sided',
    'no_draftkings',
    'empty_board',
    'coverage_unknown',
    'incomplete',
    'failed',
  ];
  for (const quality of order) {
    if (qualities.includes(quality)) return quality;
  }
  return 'no_observation';
}

export function planBroadWave(args: {
  nowMs: number;
  games: readonly { gameId: string; tipMs: number }[];
  evidence: readonly BaselineObservation[];
  runs: readonly PregameRunSnapshot[];
  consumedAttempts: number;
  planningPages: PlanningPages;
  protectionPages?: number;
  inFlight: readonly InFlightExposure[];
  closingGames: number;
  nearTipGames: number;
  storage: 'unknown' | 'admit' | 'refuse';
  dailyCap?: number;
}): { admit: string[]; skipped: { gameId: string; reason: BroadSkipReason }[]; chargePages: number; protectionRaised: boolean } {
  const cap = args.dailyCap ?? PROPS_DAILY_HTTP_ATTEMPT_CAP;
  const observedPeak = observedProviderAttemptPeak(args.runs);
  const configured = args.protectionPages ?? PROPS_PAGES_ALLOWANCE_PER_COLLECTION;
  const chargePages = Math.max(args.planningPages, configured, observedPeak);
  const protectionRaised = chargePages > args.planningPages;
  const skipped: { gameId: string; reason: BroadSkipReason }[] = [];
  const due: { gameId: string; tipMs: number }[] = [];
  const now = new Date(args.nowMs);
  for (const game of [...args.games].sort((a, b) => a.tipMs - b.tipMs || a.gameId.localeCompare(b.gameId))) {
    if (args.storage === 'refuse') {
      skipped.push({ gameId: game.gameId, reason: 'storage_admission' });
      continue;
    }
    if (hasStartedObservation(args.runs, game.gameId)) {
      skipped.push({ gameId: game.gameId, reason: 'started_run' });
      continue;
    }
    if (isPregameRefreshWindow(new Date(game.tipMs), now)) {
      skipped.push({ gameId: game.gameId, reason: 'pregame_window' });
      continue;
    }
    const quality = bestBaseline(args.evidence.filter((item) => item.gameId === game.gameId));
    if (quality === 'usable') {
      skipped.push({ gameId: game.gameId, reason: 'usable_baseline' });
      continue;
    }
    due.push(game);
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
  for (const game of due) {
    if (available >= chargePages) {
      admit.push(game.gameId);
      available -= chargePages;
      continue;
    }
    skipped.push({ gameId: game.gameId, reason: broadBudgetReason(remaining, inFlightExtra, closingHold, nearHold, chargePages) });
  }
  return { admit, skipped, chargePages, protectionRaised };
}

function hasStartedObservation(runs: readonly PregameRunSnapshot[], gameId: string): boolean {
  return runs.some(
    (run) => run.gameId === gameId && run.status === 'started' && OBSERVATION_UNIVERSES.includes(run.universe)
  );
}

function broadBudgetReason(
  remaining: number,
  inFlightExtra: number,
  closingHold: number,
  nearHold: number,
  chargePages: number
): BroadSkipReason {
  const afterInFlight = remaining - inFlightExtra;
  if (afterInFlight < chargePages) return 'budget';
  if (afterInFlight - closingHold < chargePages) return 'closing_reserve';
  return 'near_tip_reserve';
}

/**
 * How many serial games can receive a response before tip when the wave starts
 * `msUntilTip` before tipoff. Spacing only. Response time and queue delay are
 * extra. A response at or after tip is not a verified pregame closing quote.
 */
export function closingGamesBeforeTip(args: { msUntilTip: number; pages: number; limiterMs?: number }): number {
  const perGame = args.pages * (args.limiterMs ?? LIMITER_INTERVAL_MS);
  if (perGame <= 0 || args.msUntilTip <= 0) return 0;
  return Math.floor(args.msUntilTip / perGame);
}

/**
 * When the last closing response arrives. The provider token bucket allows one
 * request every 13 seconds for every worker. Concurrency 2 overlaps two
 * responses; it does not take a second token. The next request still waits
 * for the next token.
 */
export function closingLastResponseMs(args: {
  games: number;
  pages: number;
  responseMs?: number;
  queueDelayMs?: number;
  limiterMs?: number;
}): number {
  const requests = Math.max(0, args.games) * Math.max(0, args.pages);
  const queue = args.queueDelayMs ?? 0;
  const response = args.responseMs ?? 0;
  if (requests === 0) return queue;
  return queue + (requests - 1) * (args.limiterMs ?? LIMITER_INTERVAL_MS) + response;
}

export async function loadBroadBaselineEvidence(pool: Pool, gameIds: readonly string[]): Promise<BaselineObservation[]> {
  if (gameIds.length === 0) return [];
  const result = await pool.query<{
    game_id: string;
    status: string;
    archive_status: string | null;
    rows_fetched: number | null;
    rows_archived: number | null;
    rows_stored: number | null;
    stamp: unknown;
  }>(BROAD_BASELINE_EVIDENCE_SQL, [gameIds]);
  const observations: BaselineObservation[] = [];
  for (const row of result.rows) {
    if (row.status !== 'success' && row.status !== 'error' && row.status !== 'started') continue;
    observations.push({
      gameId: String(row.game_id),
      status: row.status,
      archiveStatus: row.archive_status,
      rowsFetched: Number(row.rows_fetched ?? 0),
      rowsArchived: Number(row.rows_archived ?? 0),
      rowsStored: Number(row.rows_stored ?? 0),
      stamp: parseBaselineStamp(row.stamp),
    });
  }
  return observations;
}

export type WaveBoard = 'empty' | 'no_dk' | 'one_sided' | 'usable' | 'incomplete';

export type EarlyDayGame = {
  gameId: string;
  tipMs: number;
  morning: WaveBoard;
  midday: WaveBoard;
  afternoon: WaveBoard;
};

export type EarlyDaySimulation = {
  broad: { wave: BroadWave; gameId: string; admitted: boolean; reason?: BroadSkipReason; quality: BaselineQuality }[];
  attempts: number;
  broadAttempts: number;
  pregame: SlateSimulation;
  archives: number;
  estimatedS3Bytes: number;
  estimatedPostgresBytes: number;
};

export function simulateEarlyDay(args: {
  etDate: string;
  games: readonly EarlyDayGame[];
  planningPages: PlanningPages;
  actualPages: number;
  protectionPages?: number;
  consumed?: number;
  workerDelayMs?: number;
  dailyCap?: number;
}): EarlyDaySimulation {
  const waves: { wave: BroadWave; hour: number }[] = [
    { wave: 'morning', hour: 8 },
    { wave: 'midday', hour: 12 },
    { wave: 'afternoon', hour: 14 },
  ];
  let consumed = args.consumed ?? 0;
  const evidence: BaselineObservation[] = [];
  const runs: PregameRunSnapshot[] = [];
  const broad: EarlyDaySimulation['broad'] = [];
  let broadPulls = 0;
  let broadArchives = 0;
  let broadRuns = 0;
  for (const slot of waves) {
    const nowMs = easternWallTimeToUtc(args.etDate, slot.hour, 0);
    const slate = args.games.filter((game) => game.tipMs > nowMs);
    const plan = planBroadWave({
      nowMs,
      games: slate.map((game) => ({ gameId: game.gameId, tipMs: game.tipMs })),
      evidence,
      runs,
      consumedAttempts: consumed,
      planningPages: args.planningPages,
      protectionPages: args.protectionPages,
      inFlight: runs
        .filter((run) => run.status === 'started')
        .map((run) => ({ gameId: run.gameId, attemptsReserved: run.providerAttempts })),
      closingGames: countLater(slate, runs, nowMs, 'closing'),
      nearTipGames: countLater(slate, runs, nowMs, 'near_tip'),
      storage: 'admit',
      dailyCap: args.dailyCap,
    });
    if (plan.admit.length > 0) broadPulls += 1;
    for (const game of slate) {
      const reason = plan.skipped.find((skip) => skip.gameId === game.gameId)?.reason;
      const admitted = plan.admit.includes(game.gameId);
      broad.push({
        wave: slot.wave,
        gameId: game.gameId,
        admitted,
        reason,
        quality: bestBaseline(evidence.filter((item) => item.gameId === game.gameId)),
      });
      if (!admitted) continue;
      const board = game[slot.wave];
      const recorded = recordWave(game.gameId, board, nowMs, args.actualPages);
      evidence.push(recorded.evidence);
      runs.push(recorded.run);
      consumed += args.actualPages;
      broadRuns += 1;
      if (board !== 'incomplete') broadArchives += 1;
    }
  }
  const pregame = simulatePregameSlate({
    games: args.games.map((game) => ({ gameId: game.gameId, tipMs: game.tipMs, status: 'scheduled' })),
    etDate: args.etDate,
    planningPages: args.planningPages,
    actualPages: args.actualPages,
    protectionPages: args.protectionPages,
    consumed,
    initialRuns: runs,
    workerDelayMs: args.workerDelayMs,
    dailyCap: args.dailyCap,
  });
  const archives = broadArchives + pregame.collections.filter((item) => item.success).length;
  const pulls = broadPulls + pregame.pullRuns;
  const gameRuns = broadRuns + pregame.collections.length;
  return {
    broad,
    attempts: consumed + pregame.attempts,
    broadAttempts: consumed - (args.consumed ?? 0),
    pregame,
    archives,
    estimatedS3Bytes: archives * (OBSERVED_ARCHIVE_GZIP_BYTES + OBSERVED_MANIFEST_BYTES),
    estimatedPostgresBytes: pulls * PULL_RUN_ROW_ESTIMATE_BYTES + gameRuns * GAME_RUN_ROW_ESTIMATE_BYTES,
  };
}

function countLater(
  games: readonly { gameId: string; tipMs: number }[],
  runs: readonly PregameRunSnapshot[],
  nowMs: number,
  universe: 'near_tip' | 'closing'
): number {
  return games.filter((game) => {
    const delta = game.tipMs - nowMs;
    if (delta <= 0) return false;
    if (universe === 'near_tip' && delta < 60 * 60_000) return false;
    return !runs.some((run) => run.gameId === game.gameId && run.universe === universe && run.status === 'success');
  }).length;
}

function recordWave(
  gameId: string,
  board: WaveBoard,
  nowMs: number,
  actualPages: number
): { evidence: BaselineObservation; run: PregameRunSnapshot } {
  if (board === 'incomplete') {
    return {
      evidence: {
        gameId,
        status: 'error',
        archiveStatus: 'failed',
        rowsFetched: 0,
        rowsArchived: 0,
        rowsStored: 0,
        stamp: null,
      },
      run: {
        gameId,
        universe: 'broad',
        status: 'error',
        errorMessage: 'archive_incomplete',
        startedAtMs: nowMs,
        providerAttempts: actualPages,
      },
    };
  }
  const stamp = stampFor(board);
  const rows = board === 'empty' ? 0 : 100;
  return {
    evidence: {
      gameId,
      status: 'success',
      archiveStatus: 'archived',
      rowsFetched: rows,
      rowsArchived: rows,
      rowsStored: 0,
      stamp,
    },
    run: {
      gameId,
      universe: 'broad',
      status: 'success',
      errorMessage: null,
      startedAtMs: nowMs,
      providerAttempts: actualPages,
    },
  };
}

function stampFor(board: Exclude<WaveBoard, 'incomplete'>): BaselineStamp {
  if (board === 'empty') return { books: 0, dkMarkets: 0, dkTwoSided: 0 };
  if (board === 'no_dk') return { books: 2, dkMarkets: 0, dkTwoSided: 0 };
  if (board === 'one_sided') return { books: 2, dkMarkets: 3, dkTwoSided: 0 };
  return { books: 4, dkMarkets: 8, dkTwoSided: 5 };
}
