/**
 * Frequent game-status Lambda runtime. Freeze-gates before BDL/DB.
 * Domain lives in status-sync.ts — this file only wires env, fetch, and store.
 */

import { PINNED_ANALYTICS_SEASON } from '@/lib/season';
import { parseRequiredStatusSyncTargetSeason } from './status-sync-query';
import {
  PROTECTED_HISTORY_SEASONS,
  STATUS_SYNC_JOB,
  runGameStatusSync,
  shouldSkipGameStatusSync,
  type GameStatusStore,
  type GameStatusSyncEvent,
  type GameStatusSyncResult,
  type StatusSyncFetchPage,
} from './status-sync';
import { bdlApiKey } from './status-sync-fetch';
import type { AcqArchiveStore } from '@/lib/acquisition/archive';
import type { AcqLedgerWriter } from '@/lib/acquisition/ledger-pg';
import { SEASON_PHASES, type SeasonPhase } from './season-phase';
import { regularSeasonOpenEt } from './season-eligibility';

export const STATUS_SYNC_MANUAL_CANARY_CONFIRM = 'STATUS_SYNC_MANUAL_CANARY';

/** Inclusive ET days. Any 31-day regular-season window stays under the 3 x 100 frequent page cap. */
export const STATUS_SYNC_MANUAL_CANARY_MAX_DAYS = 31;

const CANARY_YMD = /^\d{4}-\d{2}-\d{2}$/;

export type ManualStatusSyncCanary = {
  startDate: string;
  endDate: string;
};

export type ManualStatusSyncCanaryEvent =
  | { kind: 'none' }
  | { kind: 'invalid'; reason: string }
  | ({ kind: 'canary' } & ManualStatusSyncCanary);

function utcDayNumber(ymd: string): number | null {
  if (!CANARY_YMD.test(ymd)) return null;
  const ms = Date.parse(`${ymd}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== ymd) return null;
  return ms / 86_400_000;
}

/**
 * Legal canary dates for an NBA season start-year: regular-season opening night through 30 June of
 * the following calendar year. A season without a known opening night has no legal window.
 */
export function manualCanarySeasonBounds(targetSeason: number): { first: string; last: string } | null {
  const open = regularSeasonOpenEt(targetSeason);
  if (!open) return null;
  return { first: open, last: `${targetSeason + 1}-06-30` };
}

/**
 * Direct-invoke only. Scheduler/EventBridge payloads are never a canary.
 * An event that sets manualCanary=true but fails any check is `invalid` and must not fall through
 * to the scheduled path.
 */
export function classifyManualStatusSyncCanaryEvent(
  event: unknown,
  targetSeason: number | null
): ManualStatusSyncCanaryEvent {
  if (event == null || typeof event !== 'object') return { kind: 'none' };
  const e = event as Record<string, unknown>;
  if (e.source === 'aws.events' || e.source === 'aws.scheduler') return { kind: 'none' };
  if (typeof e['detail-type'] === 'string') return { kind: 'none' };
  if (e.manualCanary !== true) return { kind: 'none' };
  if (e.confirm !== STATUS_SYNC_MANUAL_CANARY_CONFIRM) {
    return { kind: 'invalid', reason: 'manual canary confirm token mismatch' };
  }
  const startDate = typeof e.startDate === 'string' ? e.startDate : '';
  const endDate = typeof e.endDate === 'string' ? e.endDate : '';
  const window = manualCanaryWindowDecision(targetSeason, startDate, endDate);
  if (!window.ok) return { kind: 'invalid', reason: window.reason };
  return { kind: 'canary', startDate, endDate };
}

export function manualCanaryWindowDecision(
  targetSeason: number | null,
  startDate: string,
  endDate: string
): { ok: true } | { ok: false; reason: string } {
  const start = utcDayNumber(startDate);
  const end = utcDayNumber(endDate);
  if (start == null || end == null) return { ok: false, reason: 'manual canary dates must be valid YYYY-MM-DD' };
  if (start > end) return { ok: false, reason: 'manual canary startDate is after endDate' };
  if (end - start + 1 > STATUS_SYNC_MANUAL_CANARY_MAX_DAYS) {
    return { ok: false, reason: `manual canary window exceeds ${STATUS_SYNC_MANUAL_CANARY_MAX_DAYS} days` };
  }
  if (targetSeason == null) return { ok: false, reason: 'manual canary requires a valid target season' };
  const bounds = manualCanarySeasonBounds(targetSeason);
  if (!bounds) return { ok: false, reason: `manual canary season ${targetSeason} has no known opening night` };
  if (startDate < bounds.first || endDate > bounds.last) {
    return {
      ok: false,
      reason: `manual canary window must stay within season ${targetSeason} (${bounds.first}..${bounds.last})`,
    };
  }
  return { ok: true };
}

export function parseManualStatusSyncCanaryEvent(
  event: unknown,
  targetSeason: number | null
): ManualStatusSyncCanary | null {
  const parsed = classifyManualStatusSyncCanaryEvent(event, targetSeason);
  return parsed.kind === 'canary' ? { startDate: parsed.startDate, endDate: parsed.endDate } : null;
}

export type LambdaGameStatusSyncResult = GameStatusSyncResult & {
  skipped: boolean;
};

export type LambdaGameStatusSyncDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  /** Injected fetch = fixture/test path; production builds the archiving adapter. */
  fetchPage?: StatusSyncFetchPage;
  store?: GameStatusStore;
  archiveStore?: AcqArchiveStore;
  ledger?: AcqLedgerWriter;
  dryRun?: boolean;
  allowFrozenSimulation?: boolean;
  manualCanary?: boolean;
  startDate?: string;
  endDate?: string;
  emit?: (event: GameStatusSyncEvent) => void;
};

function logEvent(event: GameStatusSyncEvent): void {
  console.log(JSON.stringify({ job: STATUS_SYNC_JOB, ...event }));
}

function failed(
  env: Record<string, string | undefined>,
  reason: string,
  extra?: Partial<GameStatusSyncResult>
): LambdaGameStatusSyncResult {
  const target = (env.STATUS_SYNC_TARGET_SEASON ?? '').trim() || 'invalid';
  logEvent({ event: 'game_status_sync_failed', reason });
  return {
    job: STATUS_SYNC_JOB,
    status: 'failed',
    skipped: false,
    targetSeason: target,
    productPin: extra?.productPin ?? PINNED_ANALYTICS_SEASON,
    queryMode: extra?.queryMode ?? 'frequent',
    startDate: extra?.startDate ?? null,
    endDate: extra?.endDate ?? null,
    gamesFetched: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    statusChanges: 0,
    becameFinal: 0,
    finalPreserved: 0,
    providerErrors: extra?.providerErrors ?? 0,
    providerStatus: extra?.providerStatus ?? null,
    durationMs: extra?.durationMs ?? 0,
    dryRun: extra?.dryRun ?? false,
    wroteDb: false,
    bdlHttp: extra?.bdlHttp ?? 0,
    events: extra?.events ?? [{ event: 'game_status_sync_failed', reason }],
    transitions: [],
    queries: [],
    acquisition: { required: false, archivedRequests: 0, blockedReason: null },
    seasonPhases: Object.fromEntries(SEASON_PHASES.map((p) => [p, 0])) as Record<SeasonPhase, number>,
    preseasonFenced: 0,
    seasonPhaseWrites: 0,
    reason,
    ...extra,
  };
}

export async function runLambdaGameStatusSync(
  deps: LambdaGameStatusSyncDeps = {}
): Promise<LambdaGameStatusSyncResult> {
  const env = deps.env ?? process.env;
  const emit = (event: GameStatusSyncEvent) => {
    logEvent(event);
    deps.emit?.(event);
  };

  if (shouldSkipGameStatusSync(env) && !deps.allowFrozenSimulation && !deps.manualCanary) {
    const result = await runGameStatusSync({
      env,
      now: deps.now,
      store: deps.store ?? { getById: async () => null, upsert: async () => undefined },
      fetchPage: deps.fetchPage,
      dryRun: true,
      emit,
    });
    return { ...result, skipped: true };
  }

  const parsed = parseRequiredStatusSyncTargetSeason(env, PROTECTED_HISTORY_SEASONS);
  if (!parsed.ok) {
    return failed(env, parsed.reason);
  }

  if (deps.manualCanary) {
    const window = manualCanaryWindowDecision(parsed.season, deps.startDate ?? '', deps.endDate ?? '');
    if (!window.ok) return failed(env, window.reason);
  }

  if (!deps.fetchPage && !bdlApiKey(env)) {
    return failed(env, 'missing BALLDONTLIE_API_KEY');
  }
  const acquiring = !deps.fetchPage;
  const needsPool = !deps.store || (acquiring && !deps.ledger);
  if (needsPool && !(env.SUPABASE_DB_URL ?? '').trim()) {
    return failed(env, 'missing SUPABASE_DB_URL');
  }
  const bucket = (env.NBA_DATA_BUCKET ?? '').trim();
  if (acquiring && !deps.archiveStore && !bucket) {
    return failed(env, 'missing NBA_DATA_BUCKET: immutable archive is required before any provider call');
  }

  let pool: import('pg').Pool | undefined;
  if (needsPool) {
    const { createStatusSyncPool } = await import('./status-sync-db');
    pool = createStatusSyncPool(env);
  }

  try {
    let store = deps.store;
    if (!store) {
      const { createPostgresGameStatusStore } = await import('./status-sync-db');
      store = createPostgresGameStatusStore(env, pool);
    }

    let fetchPage = deps.fetchPage;
    if (!fetchPage) {
      const { createAcquiringStatusSyncFetchPage } = await import('./status-sync-acquisition');
      let ledger = deps.ledger;
      if (!ledger) {
        const { createPgAcqLedgerWriter } = await import('@/lib/acquisition/ledger-pg');
        ledger = createPgAcqLedgerWriter(pool!);
      }
      let archiveStore = deps.archiveStore;
      if (!archiveStore) {
        const { S3AcqArchiveStore } = await import('@/lib/acquisition/s3-store');
        archiveStore = new S3AcqArchiveStore({ bucket });
      }
      const fetchEnv = deps.manualCanary
        ? {
            ...env,
            DATA_MODE: 'live_api',
            OFFSEASON_MODE: '0',
            CRON_DRY_RUN: '0',
          }
        : env;
      fetchPage = createAcquiringStatusSyncFetchPage({
        env: fetchEnv,
        apiKey: bdlApiKey(env),
        archiveStore,
        ledger,
        rawPrefix: (env.NBA_RAW_PREFIX ?? '').trim() || undefined,
      });
    }

    const result = await runGameStatusSync({
      env,
      now: deps.now,
      targetSeason: parsed.season,
      store,
      fetchPage,
      requireAcquisition: acquiring,
      dryRun: deps.dryRun ?? false,
      allowFrozenSimulation: deps.allowFrozenSimulation,
      manualCanary: deps.manualCanary,
      startDate: deps.startDate,
      endDate: deps.endDate,
      emit,
    });
    return { ...result, skipped: result.status === 'skipped' };
  } finally {
    if (pool) await pool.end();
  }
}

export async function handler(event?: unknown): Promise<LambdaGameStatusSyncResult> {
  const target = parseRequiredStatusSyncTargetSeason(process.env, PROTECTED_HISTORY_SEASONS);
  const canary = classifyManualStatusSyncCanaryEvent(event, target.ok ? target.season : null);
  if (canary.kind === 'invalid') {
    return failed(process.env, canary.reason);
  }
  if (canary.kind === 'none') {
    return runLambdaGameStatusSync();
  }
  return runLambdaGameStatusSync({
    manualCanary: true,
    dryRun: false,
    startDate: canary.startDate,
    endDate: canary.endDate,
  });
}
