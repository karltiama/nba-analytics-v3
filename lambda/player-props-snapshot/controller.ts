import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { getLambdaEnv } from './src/env';
import { getDbPool } from './src/db';
import { getGameTargetsForDate, getTodayET } from './src/game-discovery';
import { createPullRun, completePullRun, createGameRun } from './src/bulk-writers';
import { emitCoverageMetric } from './src/metrics';
import type { WorkerMessage } from './src/types';

interface ControllerEvent {
  date?: string;
}

const sqs = new SQSClient({});
const queueUrl = process.env.PLAYER_PROPS_QUEUE_URL;
if (!queueUrl) throw new Error('Missing PLAYER_PROPS_QUEUE_URL');

function toBatches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const handler = async (event: ControllerEvent) => {
  const env = getLambdaEnv();
  const pool = getDbPool(env.dbUrl);
  const date = event.date || getTodayET();
  const targets = await getGameTargetsForDate(pool, date);
  const pullRunId = await createPullRun(pool, targets.map((g) => g.gameId));

  try {
    for (const t of targets) {
      await createGameRun(pool, pullRunId, t.gameId);
    }

    const messages: WorkerMessage[] = targets.map((t) => ({
      runId: pullRunId,
      gameId: t.gameId,
      bdlGameId: t.bdlGameId,
      date,
    }));

    for (const batch of toBatches(messages, 10)) {
      await sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: batch.map((msg, idx) => ({
            Id: `${msg.gameId}-${idx}`,
            MessageBody: JSON.stringify(msg),
          })),
        })
      );
    }

    emitCoverageMetric(
      'NBA/PlayerProps',
      { Component: 'Controller' },
      { GamesTargeted: targets.length, GamesQueued: targets.length }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, pullRunId, queuedGames: targets.length, date }),
    };
  } catch (error: unknown) {
    await completePullRun(pool, pullRunId, 'error', 0, 0, { date, games: targets.length }, error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};
