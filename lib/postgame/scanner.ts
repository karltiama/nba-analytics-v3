/**
 * Deterministic Final-game scanner. Plans stage upserts and SQS messages.
 * Does not call BDL, write S3, or SendMessage.
 */

import { hasProvenFinalScores, isFinalStatus } from '@/lib/betting/normalize-game-status';
import { isImplementedPostgameStage } from './capability';
import { waitingBeforeRetry } from './retry';
import { boxServingReady, startersServingReady } from './readiness';
import {
  POSTGAME_RETRYABLE_REASONS,
  POSTGAME_STAGES,
  buildPostgameQueueMessage,
  isPostgameGoatStage,
  type PlannedEnqueue,
  type PlannedStageUpsert,
  type PostgameReasonCode,
  type PostgameScanConfig,
  type PostgameScanGame,
  type PostgameServingEvidence,
  type PostgameStage,
  type PostgameStageRow,
  type PostgameStageStatus,
} from './types';

const DEFAULT_CONFIG: Omit<PostgameScanConfig, 'now'> = {
  lookbackHours: 36,
  liveIngestionEnabled: false,
  freezeSkipsMutations: true,
  goatSubscriptionActive: false,
  identityCatchUp: false,
  maxAttempts: 8,
  stuckQueuedMinutes: 30,
};

export type PostgameScanInput = {
  games: PostgameScanGame[];
  stages: PostgameStageRow[];
  evidence: PostgameServingEvidence[];
  config: Partial<PostgameScanConfig> & { now: Date };
};

export type PostgameScanResult = {
  scannedGames: number;
  eligibleFinals: number;
  skippedNonFinal: number;
  skippedOutsideLookback: number;
  skippedWrongSeason: number;
  upserts: PlannedStageUpsert[];
  enqueue: PlannedEnqueue[];
};

function enqueueAllowed(config: PostgameScanConfig): boolean {
  return config.liveIngestionEnabled && !config.freezeSkipsMutations;
}

function inLookback(game: PostgameScanGame, config: PostgameScanConfig): boolean {
  if (!game.startTime) return true;
  const start = Date.parse(game.startTime);
  if (!Number.isFinite(start)) return true;
  const ageMs = config.now.getTime() - start;
  return ageMs <= config.lookbackHours * 60 * 60 * 1000;
}

function isStuck(row: PostgameStageRow | undefined, config: PostgameScanConfig): boolean {
  if (!row) return false;
  if (row.status !== 'QUEUED' && row.status !== 'RUNNING') return false;
  const updated = Date.parse(row.updatedAt);
  if (!Number.isFinite(updated)) return true;
  return config.now.getTime() - updated >= config.stuckQueuedMinutes * 60 * 1000;
}

function servingStatus(
  stage: PostgameStage,
  evidence: PostgameServingEvidence | undefined
): { status: PostgameStageStatus; reasonCode: PostgameReasonCode | null } | null {
  if (!evidence) return null;
  if (stage === 'box' && boxServingReady(evidence)) {
    return { status: 'READY', reasonCode: null };
  }
  if (stage === 'starters' && startersServingReady(evidence)) {
    return { status: 'READY', reasonCode: null };
  }
  if (stage === 'advanced' && evidence.advancedCount > 0) {
    return { status: 'READY', reasonCode: null };
  }
  if (stage === 'game_flow' && evidence.gameFlowTimelineAvailable === true) {
    return { status: 'READY', reasonCode: null };
  }
  if (
    (stage === 'plays' || stage === 'game_flow') &&
    evidence.gameFlowStreamClass === 'truncated'
  ) {
    return { status: 'EXPECTED_ABSENCE', reasonCode: 'SOURCE_TRUNCATED' };
  }
  if (stage === 'plays' && evidence.gameFlowTimelineAvailable === true) {
    return { status: 'READY', reasonCode: null };
  }
  return null;
}

function identityCatchUpEligible(row: PostgameStageRow | undefined, config: PostgameScanConfig): boolean {
  return (
    config.identityCatchUp &&
    row?.reasonCode === 'IDENTITY_NOT_SERVING' &&
    (row.status === 'FAILED' || row.status === 'EXPECTED_ABSENCE')
  );
}

function shouldEnqueue(input: {
  stage: PostgameStage;
  row: PostgameStageRow | undefined;
  nextStatus: PostgameStageStatus;
  playsStatus: PostgameStageStatus;
  config: PostgameScanConfig;
}): boolean {
  const { stage, row, nextStatus, playsStatus, config } = input;
  if (!isImplementedPostgameStage(stage)) return false;
  if (nextStatus === 'WAITING' && waitingBeforeRetry(config.now, row?.nextAttemptAt)) return false;
  if (nextStatus === 'READY') return false;
  if (identityCatchUpEligible(row, config)) return true;
  if (
    nextStatus === 'BLOCKED' &&
    row?.reasonCode === 'SUBSCRIPTION_BLOCKED' &&
    config.goatSubscriptionActive &&
    isPostgameGoatStage(stage)
  ) {
    return true;
  }
  if (nextStatus === 'READY' || nextStatus === 'EXPECTED_ABSENCE' || nextStatus === 'BLOCKED') {
    return false;
  }
  if (stage === 'game_flow' && playsStatus !== 'READY') return false;
  if (nextStatus === 'QUEUED' || nextStatus === 'RUNNING') {
    return isStuck(row, config);
  }
  if (nextStatus === 'FAILED') {
    const reason = row?.reasonCode;
    const attempts = row?.attempts ?? 0;
    if (attempts >= config.maxAttempts) return false;
    if (reason && POSTGAME_RETRYABLE_REASONS.has(reason)) return true;
    return false;
  }
  return nextStatus === 'WAITING';
}

export function scanPostgameFinals(input: PostgameScanInput): PostgameScanResult {
  const config: PostgameScanConfig = { ...DEFAULT_CONFIG, ...input.config };
  const stagesByGame = new Map<string, Partial<Record<PostgameStage, PostgameStageRow>>>();
  for (const row of input.stages) {
    const bucket = stagesByGame.get(row.gameId) ?? {};
    bucket[row.stage] = row;
    stagesByGame.set(row.gameId, bucket);
  }
  const evidenceByGame = new Map(input.evidence.map((row) => [row.gameId, row]));

  let skippedNonFinal = 0;
  let skippedOutsideLookback = 0;
  let skippedWrongSeason = 0;
  const eligible: PostgameScanGame[] = [];
  for (const game of input.games) {
    if (config.season && game.season !== config.season) {
      skippedWrongSeason += 1;
      continue;
    }
    if (!isFinalStatus(game.status) || !hasProvenFinalScores(game.homeScore, game.awayScore)) {
      skippedNonFinal += 1;
      continue;
    }
    if (!inLookback(game, config)) {
      skippedOutsideLookback += 1;
      continue;
    }
    eligible.push(game);
  }

  const upserts: PlannedStageUpsert[] = [];
  const enqueue: PlannedEnqueue[] = [];
  const canSend = enqueueAllowed(config);

  for (const game of eligible) {
    const existing = stagesByGame.get(game.gameId) ?? {};
    const evidence = evidenceByGame.get(game.gameId);
    const nextByStage: Partial<Record<PostgameStage, PlannedStageUpsert>> = {};

    for (const stage of POSTGAME_STAGES) {
      const row = existing[stage];
      const fromServing = servingStatus(stage, evidence);
      let status: PostgameStageStatus = row?.status ?? 'WAITING';
      let reasonCode: PostgameReasonCode | null = row?.reasonCode ?? null;
      let derivedFromServing = false;

      if (fromServing) {
        status = fromServing.status;
        reasonCode = fromServing.reasonCode;
        derivedFromServing = true;
      } else if (
        isPostgameGoatStage(stage) &&
        config.liveIngestionEnabled &&
        !config.freezeSkipsMutations &&
        !config.goatSubscriptionActive &&
        (status === 'WAITING' || status === 'FAILED' || !row)
      ) {
        status = 'BLOCKED';
        reasonCode = 'SUBSCRIPTION_BLOCKED';
      } else if (!row) {
        status = 'WAITING';
        reasonCode = null;
      }

      nextByStage[stage] = {
        gameId: game.gameId,
        season: game.season,
        stage,
        status,
        reasonCode,
        derivedFromServing,
      };
    }

    const playsStatus = nextByStage.plays?.status ?? 'WAITING';
    if (
      playsStatus === 'EXPECTED_ABSENCE' &&
      nextByStage.plays?.reasonCode === 'SOURCE_TRUNCATED' &&
      nextByStage.game_flow &&
      nextByStage.game_flow.status !== 'READY'
    ) {
      nextByStage.game_flow = {
        ...nextByStage.game_flow,
        status: 'EXPECTED_ABSENCE',
        reasonCode: 'SOURCE_TRUNCATED',
        derivedFromServing: nextByStage.game_flow.derivedFromServing,
      };
    }

    for (const stage of POSTGAME_STAGES) {
      const planned = nextByStage[stage]!;
      upserts.push(planned);
      const row = existing[stage];
      const want = shouldEnqueue({
        stage,
        row,
        nextStatus: planned.status,
        playsStatus: nextByStage.plays?.status ?? 'WAITING',
        config,
      });
      if (!want) continue;
      if (canSend) {
        planned.status = 'QUEUED';
      }
      const attempt = (row?.attempts ?? 0) + 1;
      const message = buildPostgameQueueMessage({
        gameId: game.gameId,
        season: game.season,
        stage,
        attempt,
        enqueuedAt: config.now.toISOString(),
      });
      if (!canSend) {
        enqueue.push({
          message,
          action: 'hold',
          holdReason: config.freezeSkipsMutations
            ? 'freeze holds enqueue'
            : 'live_ingestion_enabled=false',
        });
        continue;
      }
      enqueue.push({ message, action: 'enqueue' });
    }
  }

  return {
    scannedGames: input.games.length,
    eligibleFinals: eligible.length,
    skippedNonFinal,
    skippedOutsideLookback,
    skippedWrongSeason,
    upserts,
    enqueue,
  };
}

export function classifyPostgameOpsHealth(input: {
  tablePresent: boolean;
  frozen: boolean;
  failedCount: number;
}): { health: 'UNKNOWN' | 'FROZEN_EXPECTED' | 'DEGRADED' | 'HEALTHY'; reason: string } {
  if (!input.tablePresent) {
    return { health: 'UNKNOWN', reason: 'analytics.postgame_game_stages not queried' };
  }
  if (input.frozen) {
    return {
      health: 'FROZEN_EXPECTED',
      reason: 'postgame scanner/queue foundation idle while freeze holds',
    };
  }
  if (input.failedCount > 0) {
    return { health: 'DEGRADED', reason: `${input.failedCount} FAILED postgame stage(s)` };
  }
  return { health: 'HEALTHY', reason: 'no FAILED postgame stages' };
}
