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

export const STATUS_SYNC_MANUAL_CANARY_CONFIRM = 'STATUS_SYNC_MANUAL_CANARY';

const CANARY_YMD = /^\d{4}-\d{2}-\d{2}$/;

export type ManualStatusSyncCanary = {
  startDate: string;
  endDate: string;
};

/**
 * Direct-invoke only. Scheduler/EventBridge payloads never match.
 * Requires manualCanary=true, confirm token, and 2026 YMD window.
 */
export function parseManualStatusSyncCanaryEvent(event: unknown): ManualStatusSyncCanary | null {
  if (event == null || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  if (e.source === 'aws.events' || e.source === 'aws.scheduler') return null;
  if (typeof e['detail-type'] === 'string') return null;
  if (e.manualCanary !== true) return null;
  if (e.confirm !== STATUS_SYNC_MANUAL_CANARY_CONFIRM) return null;
  const startDate = typeof e.startDate === 'string' ? e.startDate : '';
  const endDate = typeof e.endDate === 'string' ? e.endDate : '';
  if (!CANARY_YMD.test(startDate) || !CANARY_YMD.test(endDate)) return null;
  if (!startDate.startsWith('2026-') || !endDate.startsWith('2026-')) return null;
  if (startDate > endDate) return null;
  return { startDate, endDate };
}

export type LambdaGameStatusSyncResult = GameStatusSyncResult & {
  skipped: boolean;
};

export type LambdaGameStatusSyncDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetchPage?: StatusSyncFetchPage;
  store?: GameStatusStore;
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

  if (!deps.fetchPage && !bdlApiKey(env)) {
    return failed(env, 'missing BALLDONTLIE_API_KEY');
  }
  if (!deps.store && !(env.SUPABASE_DB_URL ?? '').trim()) {
    return failed(env, 'missing SUPABASE_DB_URL');
  }

  let store = deps.store;
  let closeStore: (() => Promise<void>) | undefined;
  if (!store) {
    const { createPostgresGameStatusStore } = await import('./status-sync-db');
    const created = createPostgresGameStatusStore(env);
    store = created;
    closeStore = () => created.close();
  }

  let fetchPage = deps.fetchPage;
  if (!fetchPage) {
    const { createStatusSyncFetchPage } = await import('./status-sync-fetch');
    const fetchEnv = deps.manualCanary
      ? {
          ...env,
          DATA_MODE: 'live_api',
          OFFSEASON_MODE: '0',
          CRON_DRY_RUN: '0',
        }
      : env;
    fetchPage = createStatusSyncFetchPage(fetchEnv);
  }

  try {
    const result = await runGameStatusSync({
      env,
      now: deps.now,
      targetSeason: parsed.season,
      store,
      fetchPage,
      dryRun: deps.dryRun ?? false,
      allowFrozenSimulation: deps.allowFrozenSimulation,
      manualCanary: deps.manualCanary,
      startDate: deps.startDate,
      endDate: deps.endDate,
      emit,
    });
    return { ...result, skipped: result.status === 'skipped' };
  } finally {
    if (closeStore) await closeStore();
  }
}

export async function handler(event?: unknown): Promise<LambdaGameStatusSyncResult> {
  const canary = parseManualStatusSyncCanaryEvent(event);
  if (!canary) {
    return runLambdaGameStatusSync();
  }
  return runLambdaGameStatusSync({
    manualCanary: true,
    dryRun: false,
    startDate: canary.startDate,
    endDate: canary.endDate,
  });
}
