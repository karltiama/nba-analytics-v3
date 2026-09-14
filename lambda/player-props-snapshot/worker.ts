import type { SQSEvent } from 'aws-lambda';
import { getLambdaEnv, getRuntimeMode } from './src/env';
import { getDbPool } from './src/db';
import { fetchPlayerPropsForGame } from './src/fetch';
import { normalizePlayerPropRows } from './src/normalize';
import {
  bulkInsertRawV2,
  bulkUpsertCurrent,
  buildPreferredVendorLines,
  completeGameRun,
  finalizePullRunIfComplete,
  getGameRunStartedAt,
  lookupGameArchiveContext,
  refreshPreferredVendorCurrent,
} from './src/bulk-writers';
import { emitCoverageMetric } from './src/metrics';
import type { WorkerMessage } from './src/types';
import {
  classifyBdlPropPlayerIds,
  filterRowsByServingProviderId,
} from './src/prop-identity-boundary';
import { archiveGameSnapshot } from './src/archive-game';

function parseMessage(body: string): WorkerMessage {
  const payload = JSON.parse(body) as WorkerMessage;
  if (!payload.runId || !payload.gameId || !payload.bdlGameId) {
    throw new Error('Invalid SQS message payload');
  }
  return payload;
}

export const handler = async (event: SQSEvent) => {
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
  let archiveGapCount = 0;
  let archiveFailedCount = 0;

  for (const record of event.Records) {
    const msg = parseMessage(record.body);
    let gameRunFinalized = false;
    try {
      const props = await fetchPlayerPropsForGame(env.apiKey, msg.bdlGameId);
      const normalized = normalizePlayerPropRows(props);
      const startedAt = await getGameRunStartedAt(pool, msg.runId, msg.gameId);
      const snapshotAt = startedAt ?? new Date();
      const gameCtx = await lookupGameArchiveContext(pool, msg.gameId);
      const rawV2 = await bulkInsertRawV2(
        pool,
        normalized,
        snapshotAt,
        {
          enabled: env.storePropRawJson,
          sampleRate: env.propRawJsonSampleRate,
        },
        msg.runId
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
      const current = await bulkUpsertCurrent(pool, servingNormalized, snapshotAt);
      const preferred = buildPreferredVendorLines(
        servingNormalized,
        env.preferredVendor,
        snapshotAt
      );
      const legacyCurrent = await refreshPreferredVendorCurrent(pool, msg.runId, msg.gameId, preferred);

      const archive = await archiveGameSnapshot({
        env,
        pullRunId: msg.runId,
        gameId: msg.gameId,
        bdlGameId: msg.bdlGameId,
        gameDate: msg.date,
        snapshotAt,
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
      throw error;
    }
  }

  emitCoverageMetric(
    'NBA/PlayerProps',
    { Component: 'WorkerBatch' },
    {
      GamesSucceeded: successCount,
      GamesFailed: failCount,
      ArchiveGap: archiveGapCount,
      ArchiveFailed: archiveFailedCount,
    }
  );
  return { statusCode: 200, body: JSON.stringify({ success: true, successCount, failCount }) };
};
