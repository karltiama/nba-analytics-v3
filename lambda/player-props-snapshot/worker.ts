import type { Context, SQSEvent } from 'aws-lambda';
import { getLambdaEnv, getRuntimeMode } from './src/env';
import { getDbPool } from './src/db';
import { fetchPlayerPropsForGame } from './src/fetch';
import { normalizePlayerPropRows } from './src/normalize';
import { assertObservationClockSchema, describeObservation } from './src/observation-clock';
import { reserveProviderAttempt, AttemptBudgetError } from './src/attempt-budget';
import { assertPropsLiveLimiter, PropsLimiterError } from './src/limiter-guard';
import {
  bulkInsertRawV2,
  buildPreferredVendorLines,
  completeGameRun,
  finalizePullRunIfComplete,
  getGameRunStartedAt,
  getGameRunStatus,
  lookupGameArchiveContext,
  promoteServingProps,
  readPregameGate,
} from './src/bulk-writers';
import { emitCoverageMetric } from './src/metrics';
import type { WorkerMessage } from './src/types';
import {
  classifyBdlPropPlayerIds,
  filterRowsByServingProviderId,
} from './src/prop-identity-boundary';
import { archiveGameSnapshot } from './src/archive-game';
import { logMarketOutcome, outcomeForProviderResult } from './src/market-outcome';

function parseMessage(body: string): WorkerMessage {
  const payload = JSON.parse(body) as WorkerMessage;
  if (!payload.runId || !payload.gameId || !payload.bdlGameId) {
    throw new Error('Invalid SQS message payload');
  }
  return payload;
}

/** Left for the DB writes, archive and run bookkeeping after the last provider page. */
const PROVIDER_DEADLINE_MARGIN_MS = 60_000;

export const handler = async (event: SQSEvent, context?: Pick<Context, 'getRemainingTimeInMillis'>) => {
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
    if ((await getGameRunStatus(pool, msg.runId, msg.gameId)) === 'success') {
      console.log(
        JSON.stringify({ event: 'player_prop_duplicate_delivery_skipped', pullRunId: msg.runId, gameId: msg.gameId })
      );
      successCount++;
      continue;
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
      const fetched = await fetchPlayerPropsForGame(env.apiKey, msg.bdlGameId, {
        limiter: { deadlineMs },
        onBeforeRequest: async () => {
          await reserveProviderAttempt(pool, msg.runId, msg.gameId);
        },
      });
      const props = fetched.rows;
      providerSettled = true;
      logMarketOutcome({
        outcome: outcomeForProviderResult({ threw: false, rowCount: props.length }),
        universe: msg.universe ?? null,
        gameId: msg.gameId,
        pullRunId: msg.runId,
        rowsFetched: props.length,
      });
      const normalized = normalizePlayerPropRows(props);
      const controllerEnqueuedAt = await getGameRunStartedAt(pool, msg.runId, msg.gameId);
      const clocks = {
        controllerEnqueuedAt,
        observedAt: fetched.observation.responseReceivedAt,
      };
      // Legacy controller-time column value; unchanged so archive keys and retention stay stable.
      const snapshotAt = controllerEnqueuedAt ?? clocks.observedAt;
      const gameCtx = await lookupGameArchiveContext(pool, msg.gameId);
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
      const rawV2 = await bulkInsertRawV2(
        pool,
        normalized,
        snapshotAt,
        {
          enabled: env.storePropRawJson,
          sampleRate: env.propRawJsonSampleRate,
        },
        msg.runId,
        clocks
      );
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
      const preferred = buildPreferredVendorLines(
        servingNormalized,
        env.preferredVendor,
        snapshotAt
      );
      const promotion = await promoteServingProps(pool, {
        gameId: msg.gameId,
        pullRunId: msg.runId,
        rows: servingNormalized,
        preferred,
        snapshotAt,
        clocks,
      });
      if (promotion.outcome === 'missing_game') {
        await completeGameRun(pool, msg.runId, msg.gameId, 'error', props.length, rawV2, 'game_metadata_missing');
        await finalizePullRunIfComplete(pool, msg.runId);
        failCount++;
        continue;
      }
      const current = promotion.current;
      const legacyCurrent = promotion.legacyCurrent;
      if (promotion.outcome === 'post_tip') postTipSkipped++;
      if (promotion.outcome === 'promoted') promotedCount++;

      const archive = await archiveGameSnapshot({
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
        rowsStored: rawV2,
      });

      await completeGameRun(pool, msg.runId, msg.gameId, 'success', props.length, rawV2, undefined, {
        rowsArchived: archive.rowsArchived,
        archiveObjectCount: archive.archiveObjectCount,
        archiveStatus: archive.archiveStatus,
        archiveError: archive.archiveError,
        archiveKey: archive.archiveKey,
      });
      await finalizePullRunIfComplete(pool, msg.runId);
      gameRunFinalized = true;

      const archiveGap = rawV2 > 0 && archive.rowsArchived === 0 && env.s3ArchiveEnabled;
      if (archiveGap) {
        archiveGapCount += 1;
        console.error(
          JSON.stringify({
            event: 'player_prop_archive_gap',
            pullRunId: msg.runId,
            gameId: msg.gameId,
            rowsStored: rawV2,
            rowsArchived: archive.rowsArchived,
            archiveStatus: archive.archiveStatus,
            archiveError: archive.archiveError,
          })
        );
      }
      if (archive.archiveStatus === 'failed') archiveFailedCount += 1;
      emitCoverageMetric(
        'NBA/PlayerProps',
        { Component: 'Worker', GameId: msg.gameId },
        {
          RowsFetched: props.length,
          RowsRawV2: rawV2,
          RowsCurrent: current,
          RowsLegacyCurrent: legacyCurrent,
          IdentitySkipped: identity.quarantined,
          RowsArchived: archive.rowsArchived,
          ArchiveObjectsWritten: archive.archiveObjectCount,
          ArchiveFailed: archive.archiveStatus === 'failed' ? 1 : 0,
          ArchiveGap: archiveGap ? 1 : 0,
        }
      );

      if (archive.archiveStatus === 'failed') {
        throw new Error(
          `player-prop archive failed for game ${msg.gameId} pull ${msg.runId}: ${archive.archiveError}`
        );
      }
      successCount++;
    } catch (error: unknown) {
      if (!providerSettled) {
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
      if (!gameRunFinalized) {
        await completeGameRun(
          pool,
          msg.runId,
          msg.gameId,
          'error',
          0,
          0,
          error instanceof Error ? error.message : 'Unknown error',
          {
            rowsArchived: 0,
            archiveObjectCount: 0,
            archiveStatus: 'failed',
            archiveError: error instanceof Error ? error.message : 'Unknown error',
            archiveKey: null,
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
