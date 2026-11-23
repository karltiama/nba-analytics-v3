import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import { getLambdaEnv, getRuntimeMode } from './src/env';
import { getDbPool } from './src/db';
import { fetchPlayerPropsForGame } from './src/fetch';
import { normalizePlayerPropRows } from './src/normalize';
import { assertObservationClockSchema, describeObservation } from './src/observation-clock';
import { reserveProviderAttempt, AttemptBudgetError } from './src/attempt-budget';
import { assertPropsLiveLimiter, PropsLimiterError } from './src/limiter-guard';
import {
  buildPreferredVendorLines,
  completeGameRun,
  finalizePullRunIfComplete,
  getGameRunEvidence,
  getGameRunStartedAt,
  lookupGameArchiveContext,
  promoteCurrentOnlyProps,
  readPregameGate,
} from './src/bulk-writers';
import { emitCoverageMetric } from './src/metrics';
import type { NormalizedPropRow, WorkerMessage } from './src/types';
import {
  classifyBdlPropPlayerIds,
  filterRowsByServingProviderId,
} from './src/prop-identity-boundary';
import {
  archiveGameSnapshot,
  currentOnlyArchiveKey,
  currentOnlySeason,
  normalizedRowsFromArchive,
  openCurrentOnlyArchiveStore,
  PropsArchiveRefusal,
  type ArchiveObjectStore,
} from './src/archive-game';
import { verifyStoredArchive } from './src/player-prop-snapshot-archive';
import { logMarketOutcome, outcomeForProviderResult } from './src/market-outcome';
import {
  admitPropsInvocation,
  assertCurrentOnlyRowCount,
  measurePropsCluster,
  PropsStorageRefusal,
  type PropsStorageDecision,
} from './storage-gate';

function invocationId(record: SQSRecord): string {
  const messageId = typeof record.messageId === 'string' ? record.messageId : '';
  const receiveCount = record.attributes?.ApproximateReceiveCount ?? '1';
  return messageId === '' ? '' : `${messageId}#${receiveCount}`;
}

function parseMessage(body: string): WorkerMessage {
  const payload = JSON.parse(body) as WorkerMessage;
  if (!payload.runId || !payload.gameId || !payload.bdlGameId) {
    throw new Error('Invalid SQS message payload');
  }
  return payload;
}

/** Left for the DB writes, archive and run bookkeeping after the last provider page. */
const PROVIDER_DEADLINE_MARGIN_MS = 60_000;

export const handler = async (
  event: SQSEvent,
  context?: Pick<Context, 'getRemainingTimeInMillis'>,
  deps?: { admit?: typeof admitPropsInvocation; archiveStore?: ArchiveObjectStore }
) => {
  const remainingMs = context?.getRemainingTimeInMillis?.();
  const deadlineMs = remainingMs != null ? Date.now() + remainingMs - PROVIDER_DEADLINE_MARGIN_MS : undefined;
  const mode = getRuntimeMode();
  if (mode.shouldSkipMutations) {
    console.log(
      `[offseason] Skipping player-props worker (DATA_MODE=${mode.dataMode}, OFFSEASON_MODE=${mode.offseason ? '1' : '0'}, CRON_DRY_RUN=${mode.cronDryRun ? '1' : '0'}). Draining ${event.Records.length} message(s) without writes.`
    );
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        skipped: true,
        reason: 'Player-props worker skipped by runtime mode flags',
        ingested: false,
        dataMode: mode.dataMode,
        offseasonMode: mode.offseason,
        cronDryRun: mode.cronDryRun,
        drained: event.Records.length,
      }),
    };
  }

  const env = getLambdaEnv();
  const pool = getDbPool(env.dbUrl);
  let successCount = 0;
  let failCount = 0;
  let promotedCount = 0;
  let postTipSkipped = 0;
  let archiveGapCount = 0;
  let archiveFailedCount = 0;

  await assertObservationClockSchema(pool);

  for (const record of event.Records) {
    const msg = parseMessage(record.body);
    let gameRunFinalized = false;
    let providerSettled = false;
    let admitted: PropsStorageDecision | null = null;
    let durableArchive: { key: string; rowsArchived: number } | null = null;
    const evidence = await getGameRunEvidence(pool, msg.runId, msg.gameId);
    if (evidence?.status === 'success') {
      const archived = evidence.archiveStatus === 'archived' && Boolean(evidence.archiveKey);
      const noObservation = (evidence.rowsStored ?? 0) === 0 && evidence.archiveStatus !== 'failed';
      if (archived || noObservation) {
        console.log(
          JSON.stringify({ event: 'player_prop_duplicate_delivery_skipped', pullRunId: msg.runId, gameId: msg.gameId })
        );
        successCount++;
        continue;
      }
      // Partial batch responses are not enabled on the queue mapping. Returning
      // normally would acknowledge this record, so a stored run with no archive throws.
      throw new PropsArchiveRefusal('successful game run is missing durable archive evidence');
    }
    try {
      assertPropsLiveLimiter(process.env);
      const gate = await readPregameGate(pool, msg.gameId);
      if (gate === 'missing') {
        await completeGameRun(pool, msg.runId, msg.gameId, 'error', 0, 0, 'game_metadata_missing');
        await finalizePullRunIfComplete(pool, msg.runId);
        failCount++;
        continue;
      }
      if (gate === 'ineligible') {
        console.log(
          JSON.stringify({
            event: 'player_prop_post_tip_skip',
            pullRunId: msg.runId,
            gameId: msg.gameId,
            providerCalled: false,
            servingPromoted: false,
          })
        );
        await completeGameRun(pool, msg.runId, msg.gameId, 'success', 0, 0);
        await finalizePullRunIfComplete(pool, msg.runId);
        postTipSkipped++;
        successCount++;
        continue;
      }
      const admit = deps?.admit ?? admitPropsInvocation;
      admitted = await admit({
        env: process.env,
        now: new Date().toISOString(),
        invocationId: invocationId(record),
        measureCluster: () => measurePropsCluster(pool),
      });
      if (admitted.mode !== 'current_only') {
        throw new PropsStorageRefusal(admitted.reason);
      }
      const controllerEnqueuedAt = await getGameRunStartedAt(pool, msg.runId, msg.gameId);
      if (!controllerEnqueuedAt) {
        throw new PropsArchiveRefusal('current-only archive is missing the first-seen timestamp');
      }
      const gameCtx = await lookupGameArchiveContext(pool, msg.gameId);
      const archiveKey = currentOnlyArchiveKey({
        rawPrefix: env.nbaRawPrefix,
        season: currentOnlySeason(gameCtx.season, msg.date),
        seasonText: gameCtx.season,
        gameDate: msg.date,
        gameId: msg.gameId,
        pullRunId: msg.runId,
        snapshotAt: controllerEnqueuedAt,
      });
      const store = openCurrentOnlyArchiveStore(env, deps?.archiveStore);
      const existing = store ? await verifyStoredArchive({ store, key: archiveKey }) : null;
      if (existing && !existing.ok && existing.reason !== 'missing') {
        throw new PropsArchiveRefusal(existing.message);
      }
      let normalized: NormalizedPropRow[];
      let propsLength: number;
      let clocks: { controllerEnqueuedAt: Date; observedAt: Date };
      if (existing?.ok) {
        normalized = normalizedRowsFromArchive(existing.envelope.rows);
        propsLength = normalized.length;
        clocks = {
          controllerEnqueuedAt,
          observedAt: new Date(existing.envelope.observed_at as string),
        };
        providerSettled = true;
      } else {
        const fetched = await fetchPlayerPropsForGame(env.apiKey, msg.bdlGameId, {
          limiter: { deadlineMs },
          onBeforeRequest: async () => {
            await reserveProviderAttempt(pool, msg.runId, msg.gameId);
          },
        });
        propsLength = fetched.rows.length;
        providerSettled = true;
        logMarketOutcome({
          outcome: outcomeForProviderResult({ threw: false, rowCount: propsLength }),
          universe: msg.universe ?? null,
          gameId: msg.gameId,
          pullRunId: msg.runId,
          rowsFetched: propsLength,
        });
        normalized = normalizePlayerPropRows(fetched.rows);
        clocks = {
          controllerEnqueuedAt,
          observedAt: fetched.observation.responseReceivedAt,
        };
        console.log(
          JSON.stringify({
            event: 'player_prop_observation',
            pullRunId: msg.runId,
            gameId: msg.gameId,
            ...describeObservation({
              controllerEnqueuedAt,
              observedAt: clocks.observedAt,
              tip: gameCtx.startTime,
              attempts: fetched.observation.attempts.length,
            }),
          })
        );
      }
      const snapshotAt = controllerEnqueuedAt;
      assertCurrentOnlyRowCount(normalized.length);
      const archive = existing?.ok
        ? {
            rowsArchived: existing.envelope.row_count,
            archiveObjectCount: 1,
            archiveStatus: 'archived' as const,
            archiveError: null,
            archiveKey,
            verified: true,
          }
        : await archiveGameSnapshot({
            env,
            pullRunId: msg.runId,
            gameId: msg.gameId,
            bdlGameId: msg.bdlGameId,
            gameDate: msg.date,
            snapshotAt,
            observation: clocks,
            gameStartTime: gameCtx.startTime,
            season: gameCtx.season,
            opponentId: null,
            normalized,
            rowsStored: normalized.length,
            store: store ?? undefined,
            requireDurable: true,
          });
      if (!archive.verified || archive.archiveStatus !== 'archived' || !archive.archiveKey) {
        archiveFailedCount += 1;
        throw new PropsArchiveRefusal(archive.archiveError ?? 'current-only archive was not verified');
      }
      durableArchive = { key: archive.archiveKey, rowsArchived: archive.rowsArchived };
      const identity = await classifyBdlPropPlayerIds(
        pool,
        normalized.map((row) => String(row.player_id)),
        msg.gameId
      );
      const servingNormalized = filterRowsByServingProviderId(
        normalized,
        (row) => row.player_id,
        identity.servingIds
      ).keep;
      const preferred = buildPreferredVendorLines(servingNormalized, env.preferredVendor, snapshotAt);
      const promotion = await promoteCurrentOnlyProps(pool, {
        gameId: msg.gameId,
        rows: servingNormalized,
        preferred,
        snapshotAt,
        clocks,
      });
      if (promotion.outcome === 'missing_game') {
        await completeGameRun(pool, msg.runId, msg.gameId, 'error', propsLength, 0, 'game_metadata_missing', {
          rowsArchived: archive.rowsArchived,
          archiveObjectCount: archive.archiveObjectCount,
          archiveStatus: 'archived',
          archiveError: null,
          archiveKey: archive.archiveKey,
        });
        await finalizePullRunIfComplete(pool, msg.runId);
        gameRunFinalized = true;
        throw new PropsArchiveRefusal('game metadata missing after the archive was stored');
      }
      const current = promotion.current;
      const legacyCurrent = promotion.legacyCurrent;
      if (promotion.outcome === 'post_tip') postTipSkipped++;
      if (promotion.outcome === 'promoted') promotedCount++;
      await completeGameRun(pool, msg.runId, msg.gameId, 'success', propsLength, current, undefined, {
        rowsArchived: archive.rowsArchived,
        archiveObjectCount: archive.archiveObjectCount,
        archiveStatus: 'archived',
        archiveError: null,
        archiveKey: archive.archiveKey,
      });
      await finalizePullRunIfComplete(pool, msg.runId);
      gameRunFinalized = true;
      emitCoverageMetric(
        'NBA/PlayerProps',
        { Component: 'Worker', GameId: msg.gameId },
        {
          RowsFetched: propsLength,
          RowsRawV2: 0,
          RowsCurrent: current,
          RowsLegacyCurrent: legacyCurrent,
          IdentitySkipped: identity.quarantined,
          RowsArchived: archive.rowsArchived,
          ArchiveObjectsWritten: archive.archiveObjectCount,
          ArchiveFailed: 0,
          ArchiveGap: 0,
        }
      );
      successCount++;
    } catch (error: unknown) {
      if (!providerSettled && !(error instanceof PropsArchiveRefusal)) {
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
      failCount++;
      emitCoverageMetric(
        'NBA/PlayerProps',
        { Component: 'WorkerBatch' },
        {
          GamesSucceeded: successCount,
          GamesFailed: failCount,
          PostTipSkipped: postTipSkipped,
          ArchiveGap: archiveGapCount,
          ArchiveFailed: archiveFailedCount,
        }
      );
      throw error;
    } finally {
      if (admitted?.mode === 'current_only') {
        await admitted.settle().catch(() => undefined);
      }
    }
  }

  emitCoverageMetric(
    'NBA/PlayerProps',
    { Component: 'WorkerBatch' },
    {
      GamesSucceeded: successCount,
      GamesFailed: failCount,
      PostTipSkipped: postTipSkipped,
      ArchiveGap: archiveGapCount,
      ArchiveFailed: archiveFailedCount,
    }
  );
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: failCount === 0,
      ingested: promotedCount > 0 && failCount === 0,
      successCount,
      failCount,
      promotedCount,
      postTipSkipped,
    }),
  };
};
