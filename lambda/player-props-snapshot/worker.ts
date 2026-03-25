import type { SQSEvent } from 'aws-lambda';
import { getLambdaEnv } from './src/env';
import { getDbPool } from './src/db';
import { fetchPlayerPropsForGame } from './src/fetch';
import { normalizePlayerPropRows } from './src/normalize';
import {
  bulkInsertRawV2,
  bulkUpsertCurrent,
  buildPreferredVendorLines,
  completeGameRun,
  finalizePullRunIfComplete,
  refreshPreferredVendorCurrent,
} from './src/bulk-writers';
import { emitCoverageMetric } from './src/metrics';
import type { WorkerMessage } from './src/types';

function parseMessage(body: string): WorkerMessage {
  const payload = JSON.parse(body) as WorkerMessage;
  if (!payload.runId || !payload.gameId || !payload.bdlGameId) {
    throw new Error('Invalid SQS message payload');
  }
  return payload;
}

export const handler = async (event: SQSEvent) => {
  const env = getLambdaEnv();
  const pool = getDbPool(env.dbUrl);
  let successCount = 0;
  let failCount = 0;

  for (const record of event.Records) {
    const msg = parseMessage(record.body);
    try {
      const props = await fetchPlayerPropsForGame(env.apiKey, msg.bdlGameId);
      const normalized = normalizePlayerPropRows(props);
      const snapshotAt = new Date();
      const rawV2 = await bulkInsertRawV2(pool, normalized, snapshotAt);
      const current = await bulkUpsertCurrent(pool, normalized, snapshotAt);
      const preferred = buildPreferredVendorLines(normalized, env.preferredVendor, snapshotAt);
      const legacyCurrent = await refreshPreferredVendorCurrent(pool, msg.runId, msg.gameId, preferred);
      await completeGameRun(pool, msg.runId, msg.gameId, 'success', props.length, rawV2);
      await finalizePullRunIfComplete(pool, msg.runId);
      emitCoverageMetric(
        'NBA/PlayerProps',
        { Component: 'Worker', GameId: msg.gameId },
        { RowsFetched: props.length, RowsRawV2: rawV2, RowsCurrent: current, RowsLegacyCurrent: legacyCurrent }
      );
      successCount++;
    } catch (error: unknown) {
      await completeGameRun(
        pool,
        msg.runId,
        msg.gameId,
        'error',
        0,
        0,
        error instanceof Error ? error.message : 'Unknown error'
      );
      await finalizePullRunIfComplete(pool, msg.runId);
      failCount++;
      throw error;
    }
  }

  emitCoverageMetric('NBA/PlayerProps', { Component: 'WorkerBatch' }, { GamesSucceeded: successCount, GamesFailed: failCount });
  return { statusCode: 200, body: JSON.stringify({ success: true, successCount, failCount }) };
};
