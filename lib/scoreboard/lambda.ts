/**
 * Scoreboard collector Lambda runtime: gates first, then wires the display store and the shared
 * acquiring BDL fetch. Packaged by lambda/scoreboard; Terraform in infra/scoreboard.tf.
 */

import type { AcqArchiveStore } from '@/lib/acquisition/archive';
import type { AcqLedgerWriter } from '@/lib/acquisition/ledger-pg';
import { bdlApiKey } from '@/lib/games/status-sync-fetch';
import {
  runScoreboardCycle,
  SCOREBOARD_COLLECTOR,
  SCOREBOARD_GAMES_FAMILY,
  SCOREBOARD_LIVE_BOX_FAMILY,
  SCOREBOARD_ODDS_FAMILY,
  SCOREBOARD_WORKER,
  type ScoreboardCycleResult,
  type ScoreboardFetchers,
} from './collector';
import { parseScoreboardTargetSeason, resolveScoreboardCollection } from './flags';
import { parseBdlMaxRetries } from '@/lib/balldontlie/live-rate-limit';
import {
  admitPersistentWrite,
  type AdmissionMeasurement,
  type StorageAdmissionConfig,
  type StorageReservationStore,
} from '@/lib/ops/storage-admission';
import { CLUSTER_HALT_BYTES } from '@/lib/ops/storage-budget';
import {
  MAX_ACCEPTED_RATE_LIMIT_RETRIES,
  SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES,
  guardAcqLedger,
  observedGrowthVerdict,
} from '@/lib/ops/storage-growth-bounds';
import type { ScoreboardStore } from './store';
import { wireProductionScoreboard } from './production-storage';

/** Log-only operator signal. Admission still uses the 450,000,000 byte halt. */
export const SCOREBOARD_OPERATOR_REVIEW_BYTES = 425_000_000;
const SCOREBOARD_WRITER_ID = 'scoreboard-collector';

export type ScoreboardLambdaDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  store?: ScoreboardStore;
  fetch?: ScoreboardFetchers;
  archiveStore?: AcqArchiveStore;
  ledger?: AcqLedgerWriter;
  /**
   * Injected admission. Tests use this. Production leaves it empty and supplies
   * `measureCluster` plus `reservations` so the measurement is taken here.
   */
  storage?: StorageAdmissionConfig;
  /** Fresh full-cluster measurement. Called before admission and again before settlement. */
  measureCluster?: () => Promise<AdmissionMeasurement>;
  reservations?: StorageReservationStore;
  invocationId?: string;
  /** Set by production wiring when the reservation table or invocation id is unusable. */
  reservationRefusal?: string;
};

const SCOREBOARD_ADMISSION_TABLES = [
  'raw.acquisition_requests',
  'display.scoreboard_games',
  'display.scoreboard_player_lines',
  'display.scoreboard_collector_state',
  'display.scoreboard_game_odds',
  'display.scoreboard_odds_state',
] as const;

function log(result: ScoreboardCycleResult): ScoreboardCycleResult {
  console.log(JSON.stringify({ event: 'scoreboard_cycle', ...result }));
  return result;
}

function failed(reason: string): ScoreboardCycleResult {
  return log({
    job: 'scoreboard_collector',
    status: 'failed',
    reason,
    bdlRequests: 0,
    refused: [],
    seasonTypes: [],
    durationMs: 0,
  });
}

export async function runLambdaScoreboard(deps: ScoreboardLambdaDeps = {}): Promise<ScoreboardCycleResult> {
  const env = deps.env ?? process.env;
  const decision = resolveScoreboardCollection(env);
  if (decision.seasonTypes.length === 0) {
    return log(await runScoreboardCycle({ env, now: deps.now, store: deps.store ?? NO_STORE }));
  }
  const target = parseScoreboardTargetSeason(env);
  if (!target.ok) return failed(target.reason);
  if (!deps.fetch && !bdlApiKey(env)) return failed('missing BALLDONTLIE_API_KEY');
  const acquiring = !deps.fetch;
  const needsPool = !deps.store || (acquiring && !deps.ledger);
  if (needsPool && !(env.SUPABASE_DB_URL ?? '').trim()) return failed('missing SUPABASE_DB_URL');
  const bucket = (env.NBA_DATA_BUCKET ?? '').trim();
  if (acquiring && !deps.archiveStore && !bucket) {
    return failed('missing NBA_DATA_BUCKET: immutable archive is required before any provider call');
  }
  const retries = parseBdlMaxRetries(env.BDL_RATE_LIMIT_MAX_RETRIES);
  if (retries.error || retries.value > MAX_ACCEPTED_RATE_LIMIT_RETRIES) {
    return failed(
      retries.error ??
        `BDL_RATE_LIMIT_MAX_RETRIES exceeds the physical envelope of ${MAX_ACCEPTED_RATE_LIMIT_RETRIES}`
    );
  }
  const admissionInput = await loadAdmission(deps, deps.now ?? new Date());
  if (!admissionInput.ok) return failed(admissionInput.reason);
  const storage = admissionInput.storage;
  noteOperatorReview(storage.measurement.clusterBytes);
  const admission = await admitPersistentWrite({
    writerId: SCOREBOARD_WRITER_ID,
    kind: 'scoreboard',
    invocationId: storage.invocationId,
    now: storage.now,
    measurement: storage.measurement,
    physicalGrowthBoundBytes: SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES,
    tables: SCOREBOARD_ADMISSION_TABLES,
    reservations: storage.reservations,
  });
  if (!admission.allowed) return failed(admission.reason);
  if (admission.alreadySettled) {
    return log({
      job: 'scoreboard_collector',
      status: 'success',
      reason: 'invocation already settled this reservation',
      bdlRequests: 0,
      refused: [],
      seasonTypes: [],
      durationMs: 0,
    });
  }
  let noted: { ok: true; version: number } | { ok: false; reason: string };
  try {
    noted = await storage.reservations.noteWriteIntent({
      invocationId: storage.invocationId,
      writerId: SCOREBOARD_WRITER_ID,
      boundBytes: SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES,
      intentAt: storage.now,
      inWrite: true,
    });
  } catch {
    return failed('reservation service failed; refusing the write');
  }
  if (!noted.ok) return failed(noted.reason);

  let pool: import('pg').Pool | undefined;
  if (needsPool) {
    const { createLambdaPgPool } = await import('@/lib/runtime/lambda-pg-pool');
    pool = createLambdaPgPool(env);
  }
  try {
    let store = deps.store;
    if (!store) {
      const { createPgScoreboardStore } = await import('./store');
      store = createPgScoreboardStore(pool!);
    }
    let fetch = deps.fetch;
    if (!fetch) {
      const { createAcquiringBdlFetch } = await import('@/lib/games/status-sync-acquisition');
      let ledger = deps.ledger;
      if (!ledger) {
        const { createPgAcqLedgerWriter } = await import('@/lib/acquisition/ledger-pg');
        ledger = createPgAcqLedgerWriter(pool!);
      }
      ledger = guardAcqLedger(ledger);
      let archiveStore = deps.archiveStore;
      if (!archiveStore) {
        const { S3AcqArchiveStore } = await import('@/lib/acquisition/s3-store');
        archiveStore = new S3AcqArchiveStore({ bucket });
      }
      const acqDeps = {
        env,
        apiKey: bdlApiKey(env),
        archiveStore,
        ledger,
        rawPrefix: (env.NBA_RAW_PREFIX ?? '').trim() || undefined,
      };
      const identity = (endpointFamily: string) => ({
        collector: SCOREBOARD_COLLECTOR,
        endpointFamily,
        defaultWorker: SCOREBOARD_WORKER,
      });
      fetch = {
        games: createAcquiringBdlFetch(acqDeps, identity(SCOREBOARD_GAMES_FAMILY)),
        liveBox: createAcquiringBdlFetch(acqDeps, identity(SCOREBOARD_LIVE_BOX_FAMILY)),
        odds: createAcquiringBdlFetch(acqDeps, identity(SCOREBOARD_ODDS_FAMILY)),
      };
    }
    const result = await runScoreboardCycle({ env, now: deps.now, store, fetch });
    if (result.status !== 'success') {
      await retainReservation(storage);
      return log(result);
    }
    const writeFinishedAt = new Date().toISOString();
    const growth = await postWriteGrowth(deps, storage, writeFinishedAt);
    if (!growth.ok) {
      await retainReservation(storage);
      return log({ ...result, status: 'failed', reason: growth.reason });
    }
    const verdict = observedGrowthVerdict(
      growth.beforeBytes,
      growth.afterBytes,
      SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES
    );
    if (!verdict.ok) {
      await retainReservation(storage);
      return log({ ...result, status: 'failed', reason: verdict.reason });
    }
    if (growth.databaseObservedAt) {
      await admission.settle({ databaseObservedAt: growth.databaseObservedAt });
    } else {
      await admission.settle();
    }
    return log(result);
  } finally {
    if (pool) await pool.end();
  }
}

const NO_STORE: ScoreboardStore = {
  loadGames: async () => [],
  loadGamesForDate: async () => [],
  loadGameById: async () => null,
  loadLastGamesRequestAt: async () => null,
  recordGamesRequest: async () => undefined,
  upsertGames: async () => 0,
  applyObservation: async () => false,
  replacePlayerLines: async () => undefined,
  loadPlayerLines: async () => [],
  loadTeamRecords: async () => [],
  claimOddsAttempt: async () => false,
  recordOddsOutcome: async () => undefined,
  applyOddsAcquisition: async () => ({ written: 0, withdrawn: 0 }),
  loadCurrentOdds: async () => [],
};

/**
 * AWS calls handler(event, context, callback). The callback is not
 * ScoreboardLambdaDeps. Tests inject dependencies through runLambdaScoreboard.
 */
export async function handler(
  _event?: unknown,
  context?: { awsRequestId?: string },
  _callback?: unknown
): Promise<ScoreboardCycleResult> {
  return runLambdaScoreboard(wireProductionScoreboard(process.env, context));
}

async function loadAdmission(
  deps: ScoreboardLambdaDeps,
  now: Date
): Promise<{ ok: true; storage: StorageAdmissionConfig } | { ok: false; reason: string }> {
  if (deps.reservationRefusal) return { ok: false, reason: deps.reservationRefusal };
  if (deps.storage) return { ok: true, storage: deps.storage };
  if (!deps.measureCluster || !deps.reservations) {
    return { ok: false, reason: 'storage admission is not configured' };
  }
  const invocationId = deps.invocationId?.trim() ?? '';
  if (invocationId === '') return { ok: false, reason: 'invocation id is missing' };
  let measurement: AdmissionMeasurement;
  try {
    measurement = await deps.measureCluster();
  } catch {
    return { ok: false, reason: 'cluster measurement failed; refusing the write' };
  }
  return {
    ok: true,
    storage: {
      now: admissionClock(now, measurement.measuredAt),
      invocationId,
      measurement,
      physicalGrowthBoundBytes: SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES,
      reservations: deps.reservations,
    },
  };
}

/** A measurement taken during this call is newer than the clock captured before it. That is fresh, not future-dated. */
function admissionClock(requested: Date, measuredAt: string | null): string {
  const requestedMs = requested.getTime();
  const measuredMs = typeof measuredAt === 'string' ? Date.parse(measuredAt) : Number.NaN;
  if (Number.isFinite(measuredMs) && measuredMs > requestedMs) return new Date(measuredMs).toISOString();
  return requested.toISOString();
}

function noteOperatorReview(clusterBytes: number | null): void {
  if (typeof clusterBytes !== 'number' || !Number.isSafeInteger(clusterBytes) || clusterBytes < 0) return;
  const projected = clusterBytes + SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES;
  if (clusterBytes < SCOREBOARD_OPERATOR_REVIEW_BYTES && projected < SCOREBOARD_OPERATOR_REVIEW_BYTES) return;
  console.log(
    JSON.stringify({
      event: 'scoreboard_storage_review',
      clusterBytes,
      projectedBytes: Number.isSafeInteger(projected) ? projected : null,
      reviewBytes: SCOREBOARD_OPERATOR_REVIEW_BYTES,
      haltBytes: CLUSTER_HALT_BYTES,
    })
  );
}

async function postWriteGrowth(
  deps: ScoreboardLambdaDeps,
  storage: StorageAdmissionConfig,
  writeFinishedAt: string
): Promise<
  | { ok: true; beforeBytes: number; afterBytes: number; databaseObservedAt?: string }
  | { ok: false; reason: string }
> {
  if (deps.measureCluster) {
    let after: AdmissionMeasurement;
    try {
      after = await deps.measureCluster();
    } catch {
      return { ok: false, reason: 'post-write cluster measurement failed' };
    }
    const afterAt = typeof after.measuredAt === 'string' ? Date.parse(after.measuredAt) : Number.NaN;
    const finishedAt = Date.parse(writeFinishedAt);
    if (
      after.valid !== true ||
      after.complete !== true ||
      (after.source ?? '').trim() === '' ||
      typeof after.clusterBytes !== 'number' ||
      !Number.isSafeInteger(after.clusterBytes) ||
      after.clusterBytes < 0 ||
      !Number.isFinite(afterAt) ||
      !Number.isFinite(finishedAt) ||
      afterAt < finishedAt
    ) {
      return { ok: false, reason: 'post-write cluster measurement is missing or not fresh' };
    }
    const beforeBytes = storage.measurement.clusterBytes;
    if (typeof beforeBytes !== 'number' || !Number.isSafeInteger(beforeBytes) || beforeBytes < 0) {
      return { ok: false, reason: 'admission cluster measurement is missing' };
    }
    const beforeDb = storage.measurement.databaseObservedAt;
    const afterDb = after.databaseObservedAt;
    if (typeof beforeDb === 'string' || typeof afterDb === 'string') {
      const beforeMs = typeof beforeDb === 'string' ? Date.parse(beforeDb) : Number.NaN;
      const afterMs = typeof afterDb === 'string' ? Date.parse(afterDb) : Number.NaN;
      if (!Number.isFinite(beforeMs) || !Number.isFinite(afterMs) || afterMs <= beforeMs) {
        return { ok: false, reason: 'post-write cluster measurement is missing or not fresh' };
      }
    }
    return {
      ok: true,
      beforeBytes,
      afterBytes: after.clusterBytes,
      ...(typeof afterDb === 'string' ? { databaseObservedAt: afterDb } : {}),
    };
  }
  const growth = storage.observedDatabaseGrowth;
  if (!growth) return { ok: false, reason: 'post-write cluster measurement is missing' };
  return { ok: true, beforeBytes: growth.beforeBytes, afterBytes: growth.afterBytes };
}

/** Keeps the active hold. This does not call releaseStranded. */
async function retainReservation(storage: StorageAdmissionConfig): Promise<void> {
  try {
    await storage.reservations.noteWriteIntent({
      invocationId: storage.invocationId,
      writerId: SCOREBOARD_WRITER_ID,
      boundBytes: SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES,
      intentAt: storage.now,
      inWrite: false,
    });
  } catch {
    /* the active hold stays; a failed clear must not start another write */
  }
}
