import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { getLambdaEnv, getRuntimeMode } from './src/env';
import { getDbPool } from './src/db';
import {
  getGameTargets,
  getTodayET,
  parsePropUniverse,
  PREGAME_REFRESH_INTERVAL_SECONDS,
  type PropUniverse,
} from './src/game-discovery';
import { propsRequestBudget } from './src/acquisition-budget';
import { loadBroadBaselineEvidence, planBroadWave } from './src/early-baseline';
import { clusterBytesFromEnv, loadPregamePlanningInputs, pregameRefreshSchemaReady } from './src/pregame-refresh-load';
import {
  planPregameRefresh,
  resolvePlanningPages,
  resolveProtectionPages,
  storageAdmissionDecision,
  type PlanningPages,
} from './src/pregame-refresh';
import { resolveWaveMaxGames, selectGameWave } from './src/wave-cap';
import {
  CONTROLLER_DEDUPE_WINDOW_SECONDS,
  claimGameRunsForWave,
  completePullRun,
  markGameRunsEnqueueFailed,
} from './src/bulk-writers';
import { emitCoverageMetric } from './src/metrics';
import { controllerCoverageMetric, logMarketOutcome } from './src/market-outcome';
import type { WorkerMessage } from './src/types';

interface ControllerEvent {
  date?: string;
  universe?: string;
  gameId?: unknown;
}

const sqs = new SQSClient({});
const queueUrl = process.env.PLAYER_PROPS_QUEUE_URL;
if (!queueUrl) throw new Error('Missing PLAYER_PROPS_QUEUE_URL');

function emitControllerCoverage(eligibleGames: number, queuedGames: number, dedupedGames: number): void {
  const metric = controllerCoverageMetric({ eligibleGames, queuedGames, dedupedGames });
  if (!metric) return;
  emitCoverageMetric('NBA/PlayerProps', { Component: 'Controller' }, metric);
}

function toBatches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function skip(reason: string, extra: Record<string, unknown> = {}) {
  logMarketOutcome({ outcome: 'NO_REQUEST', reason, universe: (extra.universe as string) ?? null });
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

  let maxGames: number;
  try {
    maxGames = resolveWaveMaxGames(process.env.PLAYER_PROPS_WAVE_MAX_GAMES);
  } catch (error: unknown) {
    emitCoverageMetric('NBA/PlayerProps', { Component: 'Controller' }, { GamesQueued: 0 });
    return skip('wave_config', {
      universe,
      message: error instanceof Error ? error.message : 'invalid wave cap',
    });
  }

  const env = getLambdaEnv();
  const pool = getDbPool(env.dbUrl);
  const date = event.date || getTodayET();
  if (universe === 'pregame_refresh') {
    const migrated = await pregameRefreshSchemaReady(pool);
    if (!migrated) return skip('universe_not_migrated', { universe, date });
  }
  const now = new Date();
  const targets = await getGameTargets({ pool, universe, date, now });
  const picked = selectGameWave(targets, event.gameId, maxGames);
  if (!picked.ok) {
    return skip(picked.reason, { universe, date, eligibleGames: targets.length });
  }
  if (picked.games.length === 0) {
    return skip('no_eligible_games', { universe, date, eligibleGames: 0 });
  }
  let planningPages: PlanningPages = 3;
  if (universe === 'pregame_refresh') {
    try {
      planningPages = resolvePlanningPages(process.env.PLAYER_PROPS_PLANNING_PAGES);
    } catch (error: unknown) {
      return skip('planning_pages', {
        universe,
        message: error instanceof Error ? error.message : 'invalid planning pages',
      });
    }
    const inputs = await loadPregamePlanningInputs(
      pool,
      picked.games.map((game) => ({
        gameId: game.gameId,
        tipMs: game.startTime == null ? now.getTime() : Date.parse(game.startTime),
        status: 'scheduled',
        lastSuccessAtMs: null,
      })),
      now
    );
    const candidates = picked.games.map((game) => ({
      gameId: game.gameId,
      tipMs: game.startTime == null ? now.getTime() : Date.parse(game.startTime),
      status: 'scheduled' as string | null,
      lastSuccessAtMs: inputs.runs
        .filter((run) => run.gameId === game.gameId && run.status === 'success')
        .reduce<number | null>((latest, run) => (latest == null || run.startedAtMs > latest ? run.startedAtMs : latest), null),
    }));
    let protectionPages = 3;
    try {
      protectionPages = resolveProtectionPages(process.env.PLAYER_PROPS_PROTECTION_PAGES);
    } catch (error: unknown) {
      return skip('protection_pages', {
        universe,
        message: error instanceof Error ? error.message : 'invalid protection pages',
      });
    }
    const plan = planPregameRefresh({
      nowMs: now.getTime(),
      candidates,
      runs: inputs.runs,
      consumedAttempts: inputs.consumedAttempts,
      planningPages,
      protectionPages,
      inFlight: inputs.inFlight,
      closingGames: inputs.closingGames,
      nearTipGames: inputs.nearTipGames,
      storage: storageAdmissionDecision(clusterBytesFromEnv(process.env.PROPS_CLUSTER_BYTES)),
    });
    if (plan.protectionRaised) {
      console.log(
        JSON.stringify({
          event: 'player_props_pregame_protection_warning',
          universe,
          planningPages,
          chargePages: plan.chargePages,
          observedPeak: plan.observedPeak,
          message: 'planning assumption is below the page allowance or the ledger peak; refresh admission uses the higher charge and does not count it as a completed request',
        })
      );
    }
    if (plan.skipped.length > 0) {
      console.log(
        JSON.stringify({
          event: 'player_props_pregame_refresh_skip',
          universe,
          skipped: plan.skipped,
        })
      );
    }
    const admitted = new Set(plan.admit);
    picked.games = picked.games.filter((game) => admitted.has(game.gameId));
    if (picked.games.length === 0) {
      return skip(plan.skipped[0]?.reason ?? 'no_eligible_games', {
        universe,
        date,
        eligibleGames: targets.length,
        skipReasons: plan.skipped,
      });
    }
  }
  // All three broad schedules share this evidence rule. A delayed 8:00 AM
  // invocation does not become a second wave; the clock only moves the T-120 handoff.
  if (universe === 'broad') {
    let broadPlanning: PlanningPages;
    let protectionPages: number;
    try {
      broadPlanning = resolvePlanningPages(process.env.PLAYER_PROPS_PLANNING_PAGES);
      protectionPages = resolveProtectionPages(process.env.PLAYER_PROPS_PROTECTION_PAGES);
    } catch (error: unknown) {
      return skip('planning_pages', {
        universe,
        message: error instanceof Error ? error.message : 'invalid planning pages',
      });
    }
    const inputs = await loadPregamePlanningInputs(
      pool,
      picked.games.map((game) => ({
        gameId: game.gameId,
        tipMs: game.startTime == null ? now.getTime() : Date.parse(game.startTime),
        status: 'scheduled',
        lastSuccessAtMs: null,
      })),
      now
    );
    const evidence = await loadBroadBaselineEvidence(
      pool,
      picked.games.map((game) => game.gameId)
    );
    const plan = planBroadWave({
      nowMs: now.getTime(),
      games: picked.games.map((game) => ({
        gameId: game.gameId,
        tipMs: game.startTime == null ? now.getTime() : Date.parse(game.startTime),
      })),
      evidence,
      runs: inputs.runs,
      consumedAttempts: inputs.consumedAttempts,
      planningPages: broadPlanning,
      protectionPages,
      inFlight: inputs.inFlight,
      closingGames: inputs.closingGames,
      nearTipGames: inputs.nearTipGames,
      storage: storageAdmissionDecision(clusterBytesFromEnv(process.env.PROPS_CLUSTER_BYTES)),
    });
    if (plan.skipped.length > 0) {
      console.log(JSON.stringify({ event: 'player_props_broad_baseline_skip', universe, skipped: plan.skipped }));
    }
    const admitted = new Set(plan.admit);
    picked.games = picked.games.filter((game) => admitted.has(game.gameId));
    if (picked.games.length === 0) {
      return skip(plan.skipped[0]?.reason ?? 'no_eligible_games', {
        universe,
        date,
        eligibleGames: targets.length,
        skipReasons: plan.skipped,
      });
    }
  }
  if (picked.deferred.length > 0) {
    console.log(
      JSON.stringify({
        event: 'player_props_wave_deferred',
        universe,
        date,
        deferredGameIds: picked.deferred.map((game) => game.gameId),
        maxGames,
      })
    );
  }

  const claimWindow =
    universe === 'pregame_refresh' ? PREGAME_REFRESH_INTERVAL_SECONDS : CONTROLLER_DEDUPE_WINDOW_SECONDS;
  const claim = await claimGameRunsForWave(pool, universe, picked.games, claimWindow);
  if (claim.skipped.length > 0) {
    console.log(
      JSON.stringify({
        event: 'player_props_controller_dedupe',
        universe,
        skippedGameIds: claim.skipped.map((t) => t.gameId),
        windowSeconds: claimWindow,
      })
    );
  }
  if (claim.pullRunId == null) {
    return skip('already_claimed', { universe, date, skippedGames: claim.skipped.length });
  }
  const pullRunId = claim.pullRunId;

  try {
    const messages: WorkerMessage[] = claim.claimed.map((t) => ({
      runId: pullRunId,
      gameId: t.gameId,
      bdlGameId: t.bdlGameId,
      date,
      universe,
    }));

    const failedGameIds: string[] = [];
    for (const batch of toBatches(messages, 10)) {
      try {
        const res = await sqs.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: batch.map((msg, idx) => ({
              Id: `${msg.gameId}-${idx}`,
              MessageBody: JSON.stringify(msg),
            })),
          })
        );
        for (const failed of res.Failed ?? []) {
          const idx = Number(String(failed.Id ?? '').split('-').pop());
          const msg = batch[idx];
          if (msg) failedGameIds.push(msg.gameId);
        }
      } catch {
        failedGameIds.push(...batch.map((m) => m.gameId));
      }
    }
    if (failedGameIds.length > 0) {
      await markGameRunsEnqueueFailed(pool, pullRunId, failedGameIds);
      emitControllerCoverage(targets.length, messages.length - failedGameIds.length, claim.skipped.length);
      throw new Error(`SQS enqueue failed for ${failedGameIds.length} game(s): ${failedGameIds.join(',')}`);
    }

    emitControllerCoverage(targets.length, messages.length, claim.skipped.length);
    console.log(
      JSON.stringify({
        event: 'player_props_request_budget',
        universe,
        ...propsRequestBudget(messages.length),
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        pullRunId,
        queuedGames: messages.length,
        dedupedGames: claim.skipped.length,
        date,
        universe,
      }),
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
