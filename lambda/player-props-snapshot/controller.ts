import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { getLambdaEnv, getRuntimeMode } from './src/env';
import { getDbPool } from './src/db';
import { getGameTargets, getTodayET, parsePropUniverse, type PropUniverse } from './src/game-discovery';
import { completePullRun, createPullRun, createGameRun } from './src/bulk-writers';
import { emitCoverageMetric } from './src/metrics';
import { logMarketOutcome, noRequestCoverage } from './src/market-outcome';
import type { WorkerMessage } from './src/types';

interface ControllerEvent {
  date?: string;
  universe?: string;
}

const sqs = new SQSClient({});
const queueUrl = process.env.PLAYER_PROPS_QUEUE_URL;
if (!queueUrl) throw new Error('Missing PLAYER_PROPS_QUEUE_URL');

function toBatches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function skip(reason: string, extra: Record<string, unknown> = {}) {
  logMarketOutcome({ outcome: 'NO_REQUEST', reason, universe: (extra.universe as string) ?? null });
  const coverage = noRequestCoverage();
  emitCoverageMetric('NBA/PlayerProps', { Component: 'Controller' }, coverage);
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      skipped: true,
      outcome: 'NO_REQUEST',
      reason,
      queuedGames: 0,
      ...extra,
    }),
  };
}

export const handler = async (event: ControllerEvent) => {
  const mode = getRuntimeMode();
  if (mode.shouldSkipMutations) {
    console.log(
      `[offseason] Skipping player-props controller (DATA_MODE=${mode.dataMode}, OFFSEASON_MODE=${mode.offseason ? '1' : '0'}, CRON_DRY_RUN=${mode.cronDryRun ? '1' : '0'}).`
    );
    return skip('runtime_skip', {
      dataMode: mode.dataMode,
      offseasonMode: mode.offseason,
      cronDryRun: mode.cronDryRun,
    });
  }

  const universe: PropUniverse | null = parsePropUniverse(event.universe);
  if (!universe) {
    return skip('invalid_universe', { universe: event.universe ?? null });
  }

  const env = getLambdaEnv();
  const pool = getDbPool(env.dbUrl);
  const date = event.date || getTodayET();
  const targets = await getGameTargets({ pool, universe, date });
  if (targets.length === 0) {
    return skip('no_eligible_games', { universe, date });
  }

  const pullRunId = await createPullRun(pool, targets.map((g) => g.gameId));

  try {
    for (const t of targets) {
      await createGameRun(pool, pullRunId, t.gameId, universe);
    }

    const messages: WorkerMessage[] = targets.map((t) => ({
      runId: pullRunId,
      gameId: t.gameId,
      bdlGameId: t.bdlGameId,
      date,
      universe,
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
      body: JSON.stringify({ success: true, pullRunId, queuedGames: targets.length, date, universe }),
    };
  } catch (error: unknown) {
    await completePullRun(
      pool,
      pullRunId,
      'error',
      0,
      0,
      { date, games: targets.length, universe },
      error instanceof Error ? error.message : 'Unknown error'
    );
    throw error;
  }
};
