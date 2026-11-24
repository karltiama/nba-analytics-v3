/**
 * One player-props game in S3 current-board mode.
 * The market tables stay untouched. Archive, manifest, and pointer go through the existing publisher.
 */
import type { SQSRecord } from 'aws-lambda';
import { createAwsCurrentBoardStore } from '@/lib/props/s3-current-board/aws-store';
import type { LambdaEnv } from './env';
import { fetchPlayerPropsForGame } from './fetch';
import { normalizePlayerPropRows } from './normalize';
import { describeObservation } from './observation-clock';
import { reserveProviderAttempt, AttemptBudgetError } from './attempt-budget';
import { assertPropsLiveLimiter, PropsLimiterError } from './limiter-guard';
import {
  completeGameRun,
  finalizePullRunIfComplete,
  getGameRunEvidence,
  getGameRunStartedAt,
  lookupGameArchiveContext,
  readPregameGate,
  type GameRunEvidence,
} from './bulk-writers';
import { emitCoverageMetric } from './metrics';
import type { WorkerMessage } from './types';
import { PropsArchiveRefusal } from './archive-game';
import {
  buildPlayerPropSnapshotArchiveKey,
  nbaSeasonStartYearFromGameDate,
  verifyStoredArchive,
} from './player-prop-snapshot-archive';
import { logMarketOutcome, outcomeForProviderResult } from './market-outcome';
import {
  admitPropsInvocation,
  assertCurrentOnlyRowCount,
  measurePropsCluster,
  PropsStorageRefusal,
  type PropsStorageDecision,
} from '../storage-gate';
import {
  advancePointerFromStoredManifest,
  observationPrecedes,
  publishCurrentSnapshot,
  readCurrentPointer,
  type PublishResult,
} from './f39b/publish';
import type { CurrentPropsObjectStore } from './f39b/store';
import type { Pool } from 'pg';

const DURABLE_AFTER_ARCHIVE = new Set([
  'pointer_write_failed',
  'pointer_conflict',
  'pointer_unreadable',
  'manifest_write_failed',
  'manifest_rejected',
  'manifest_read_failed',
]);

export type S3PublicationDeps = {
  admit?: typeof admitPropsInvocation;
  currentBoardStore?: CurrentPropsObjectStore;
};

export type S3PublicationOutcome = { kind: 'success' | 'post_tip' | 'missing' };

function isIntentionalPregameSkip(evidence: GameRunEvidence): boolean {
  return evidence.rowsStored === 0
    && evidence.rowsFetched === 0
    && evidence.providerAttempts === 0
    && evidence.archiveStatus === 'pending'
    && !evidence.archiveKey;
}

function invocationId(record: SQSRecord): string {
  const messageId = typeof record.messageId === 'string' ? record.messageId : '';
  const receiveCount = record.attributes?.ApproximateReceiveCount ?? '1';
  return messageId === '' ? '' : `${messageId}#${receiveCount}`;
}

function resolveStore(env: LambdaEnv, injected: CurrentPropsObjectStore | undefined): CurrentPropsObjectStore {
  if (injected) return injected;
  if (env.nbaRawPrefix !== 'raw' || !env.nbaDataBucket) {
    throw new PropsArchiveRefusal('s3 current board bucket is not configured');
  }
  return createAwsCurrentBoardStore({
    bucket: env.nbaDataBucket,
    region: env.awsRegion,
    rawPrefix: 'raw',
  });
}

function accepted(result: PublishResult): boolean {
  return result.reason === 'published' || result.reason === 'already_current' || result.reason === 'older_snapshot';
}

export async function runS3CurrentPublication(input: {
  pool: Pool;
  env: LambdaEnv;
  record: SQSRecord;
  msg: WorkerMessage;
  deadlineMs: number | undefined;
  deps?: S3PublicationDeps;
}): Promise<S3PublicationOutcome> {
  const { pool, env, record, msg } = input;
  const evidence = await getGameRunEvidence(pool, msg.runId, msg.gameId);
  if (evidence?.status === 'success') {
    if (isIntentionalPregameSkip(evidence)) return { kind: 'success' };
    const recordedKey = evidence.archiveKey;
    if (evidence.archiveStatus !== 'archived' || !recordedKey) {
      throw new PropsArchiveRefusal('successful game run is missing durable archive evidence');
    }
    const recordedStart = await getGameRunStartedAt(pool, msg.runId, msg.gameId);
    const recordedStore = resolveStore(env, input.deps?.currentBoardStore);
    if (!recordedStart) throw new PropsArchiveRefusal('successful game run archive could not be read');
    const recorded = await verifyStoredArchive({
      store: recordedStore,
      key: recordedKey,
      expected: {
        gameId: msg.gameId,
        pullRunId: msg.runId,
        gameDate: msg.date,
        controllerEnqueuedAt: recordedStart,
      },
    });
    if (!recorded.ok) throw new PropsArchiveRefusal(recorded.message);
    const pointer = await readCurrentPointer(recordedStore, msg.gameId);
    if (!pointer.ok) throw new PropsArchiveRefusal('successful game run pointer could not be read');
    const same = pointer.pointer.archiveKey === recordedKey
      && pointer.pointer.envelopeChecksum === recorded.envelope.checksum;
    const observedAt = recorded.envelope.observed_at;
    const newer = typeof observedAt === 'string' && observationPrecedes(
      { observedAt, pullRunId: recorded.envelope.pull_run_id },
      { observedAt: pointer.pointer.observedAt, pullRunId: pointer.pointer.pullRunId }
    );
    if (!same && !newer) throw new PropsArchiveRefusal('successful game run pointer is not this archive');
    return { kind: 'success' };
  }

  let gameRunFinalized = false;
  let providerSettled = false;
  let admitted: PropsStorageDecision | null = null;
  let durableArchive: { key: string; rowsArchived: number } | null = null;
  try {
    assertPropsLiveLimiter(process.env);
    const gate = await readPregameGate(pool, msg.gameId);
    if (gate === 'missing') {
      await completeGameRun(pool, msg.runId, msg.gameId, 'error', 0, 0, 'game_metadata_missing');
      await finalizePullRunIfComplete(pool, msg.runId);
      return { kind: 'missing' };
    }
    if (gate === 'ineligible') {
      await completeGameRun(pool, msg.runId, msg.gameId, 'success', 0, 0);
      await finalizePullRunIfComplete(pool, msg.runId);
      return { kind: 'post_tip' };
    }

    const store = resolveStore(env, input.deps?.currentBoardStore);
    const admit = input.deps?.admit ?? admitPropsInvocation;
    admitted = await admit({
      env: process.env,
      now: new Date().toISOString(),
      invocationId: invocationId(record),
      measureCluster: () => measurePropsCluster(pool),
    });
    if (admitted.mode !== 'current_only') throw new PropsStorageRefusal(admitted.reason);

    const controllerEnqueuedAt = await getGameRunStartedAt(pool, msg.runId, msg.gameId);
    if (!controllerEnqueuedAt) throw new PropsArchiveRefusal('s3 current board is missing the first-seen timestamp');
    const gameCtx = await lookupGameArchiveContext(pool, msg.gameId);
    if (!gameCtx.startTime) throw new PropsArchiveRefusal('s3 current board is missing the game start');
    const gameStartTime = gameCtx.startTime.toISOString();
    const archiveKey = buildPlayerPropSnapshotArchiveKey({
      rawPrefix: 'raw',
      season: nbaSeasonStartYearFromGameDate(msg.date),
      gameDate: msg.date,
      gameId: msg.gameId,
      pullRunId: msg.runId,
      snapshotAt: controllerEnqueuedAt,
    });
    const existing = await verifyStoredArchive({
      store,
      key: archiveKey,
      expected: {
        gameId: msg.gameId,
        pullRunId: msg.runId,
        gameDate: msg.date,
        controllerEnqueuedAt,
      },
    });
    if (!existing.ok && existing.reason !== 'missing') throw new PropsArchiveRefusal(existing.message);

    let published: PublishResult;
    let rowsFetched: number;
    let rowsArchived: number;
    if (existing.ok) {
      const advanced = await advancePointerFromStoredManifest({
        store,
        archiveKey,
        envelope: existing.envelope,
        gameStartTime,
      });
      if (advanced.reason !== 'manifest_missing') {
        published = advanced;
        rowsFetched = existing.envelope.row_count;
        rowsArchived = existing.envelope.row_count;
        providerSettled = true;
      } else {
        const fetched = await fetchAndPublish();
        published = fetched.published;
        rowsFetched = fetched.rowsFetched;
        rowsArchived = fetched.rowsArchived;
      }
    } else {
      const fetched = await fetchAndPublish();
      published = fetched.published;
      rowsFetched = fetched.rowsFetched;
      rowsArchived = fetched.rowsArchived;
    }

    if (!accepted(published)) {
      if (published.archiveKey && DURABLE_AFTER_ARCHIVE.has(published.reason)) {
        durableArchive = { key: published.archiveKey, rowsArchived };
      }
      throw new PropsArchiveRefusal(published.reason);
    }
    durableArchive = { key: published.archiveKey ?? archiveKey, rowsArchived };
    await completeGameRun(pool, msg.runId, msg.gameId, 'success', rowsFetched, 0, undefined, {
      rowsArchived,
      archiveObjectCount: 1,
      archiveStatus: 'archived',
      archiveError: null,
      archiveKey: durableArchive.key,
    });
    await finalizePullRunIfComplete(pool, msg.runId);
    gameRunFinalized = true;
    emitCoverageMetric(
      'NBA/PlayerProps',
      { Component: 'Worker', GameId: msg.gameId },
      {
        RowsFetched: rowsFetched,
        RowsRawV2: 0,
        RowsCurrent: 0,
        RowsLegacyCurrent: 0,
        RowsArchived: rowsArchived,
        ArchiveObjectsWritten: 1,
        ArchiveFailed: 0,
        ArchiveGap: 0,
      }
    );
    return { kind: 'success' };

    async function fetchAndPublish(): Promise<{ published: PublishResult; rowsFetched: number; rowsArchived: number }> {
      const fetched = await fetchPlayerPropsForGame(env.apiKey, msg.bdlGameId, {
        limiter: { deadlineMs: input.deadlineMs },
        onBeforeRequest: async () => {
          await reserveProviderAttempt(pool, msg.runId, msg.gameId);
        },
      });
      providerSettled = true;
      logMarketOutcome({
        outcome: outcomeForProviderResult({ threw: false, rowCount: fetched.rows.length }),
        universe: msg.universe ?? null,
        gameId: msg.gameId,
        pullRunId: msg.runId,
        rowsFetched: fetched.rows.length,
      });
      if (fetched.rows.length === 0 || fetched.pages.length === 0) {
        throw new PropsArchiveRefusal('empty_snapshot');
      }
      const normalized = normalizePlayerPropRows(fetched.rows);
      assertCurrentOnlyRowCount(normalized.length);
      console.log(
        JSON.stringify({
          event: 'player_prop_observation',
          pullRunId: msg.runId,
          gameId: msg.gameId,
          ...describeObservation({
            controllerEnqueuedAt,
            observedAt: fetched.observation.responseReceivedAt,
            tip: gameCtx.startTime,
            attempts: fetched.observation.attempts.length,
          }),
        })
      );
      const result = await publishCurrentSnapshot({
        store,
        gameId: msg.gameId,
        bdlGameId: msg.bdlGameId,
        gameDate: msg.date,
        gameStartTime,
        pullRunId: msg.runId,
        pages: fetched.pages,
        observedAt: fetched.observation.responseReceivedAt.toISOString(),
        controllerEnqueuedAt: controllerEnqueuedAt.toISOString(),
      });
      return { published: result, rowsFetched: fetched.rows.length, rowsArchived: normalized.length };
    }
  } catch (error: unknown) {
    if (!providerSettled && !(error instanceof PropsArchiveRefusal) && !(error instanceof PropsStorageRefusal)) {
      const message = error instanceof Error ? error.message : '';
      const http = message.match(/player_props (\d+)/);
      const reason = error instanceof PropsLimiterError
        ? 'limiter_refused'
        : error instanceof AttemptBudgetError
          ? 'attempt_budget_exhausted'
          : /429/.test(message)
            ? 'provider_429'
            : http
              ? `provider_http_${http[1]}`
              : 'provider_request_failed';
      logMarketOutcome({
        outcome: outcomeForProviderResult({ threw: true, rowCount: 0 }),
        reason,
        universe: msg.universe ?? null,
        gameId: msg.gameId,
        pullRunId: msg.runId,
      });
    }
    if (!(error instanceof PropsStorageRefusal) && !gameRunFinalized) {
      await completeGameRun(
        pool,
        msg.runId,
        msg.gameId,
        'error',
        0,
        0,
        error instanceof Error ? error.message : 'Unknown error',
        {
          rowsArchived: durableArchive?.rowsArchived ?? 0,
          archiveObjectCount: durableArchive ? 1 : 0,
          archiveStatus: durableArchive ? 'archived' : 'failed',
          archiveError: error instanceof Error ? error.message : 'Unknown error',
          archiveKey: durableArchive?.key ?? null,
        }
      );
      await finalizePullRunIfComplete(pool, msg.runId);
    }
    throw error;
  } finally {
    if (admitted?.mode === 'current_only') await admitted.settle().catch(() => undefined);
  }
}
