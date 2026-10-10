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
  SCOREBOARD_WORKER,
  type ScoreboardCycleResult,
  type ScoreboardFetchers,
} from './collector';
import { parseScoreboardTargetSeason, resolveScoreboardCollection } from './flags';
import type { ScoreboardStore } from './store';

export type ScoreboardLambdaDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  store?: ScoreboardStore;
  fetch?: ScoreboardFetchers;
  archiveStore?: AcqArchiveStore;
  ledger?: AcqLedgerWriter;
};

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
      };
    }
    return log(await runScoreboardCycle({ env, now: deps.now, store, fetch }));
  } finally {
    if (pool) await pool.end();
  }
}

const NO_STORE: ScoreboardStore = {
  loadGames: async () => [],
  loadGamesForDate: async () => [],
  loadLastGamesRequestAt: async () => null,
  recordGamesRequest: async () => undefined,
  upsertGames: async () => 0,
  applyObservation: async () => false,
  replacePlayerLines: async () => undefined,
  loadPlayerLines: async () => [],
};

export async function handler(): Promise<ScoreboardCycleResult> {
  return runLambdaScoreboard();
}
