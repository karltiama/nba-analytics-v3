import type { PlayerIdentityIndex } from '@/lib/identity/player-identity-resolve';
import { lineupsRawArchiveKey } from './writes';
import { isImplementedPostgameStage } from './capability';
import { claimQueuedStage, completeStage, type StageStore } from './claim';
import { evaluateBoxStage } from './box-stage';
import type { PlayerGameLogWrite } from './box-transform';
import { nextAttemptAt } from './retry';
import { evaluateStartersStage } from './starters-stage';
import type { GameStarterCandidate } from '@/lib/archive/game-starters-from-lineups';
import {
  parsePostgameQueueMessage,
  type PostgameQueueMessage,
  type PostgameReasonCode,
  type PostgameStage,
} from './types';

export const POSTGAME_TARGET_SEASON = '2026';
export const POSTGAME_PROTECTED_SEASONS = ['2023', '2024', '2025'] as const;

export type PostgameWorkerEvent =
  | 'postgame_stage_claimed'
  | 'postgame_stage_ready'
  | 'postgame_stage_waiting'
  | 'postgame_stage_blocked'
  | 'postgame_stage_failed'
  | 'postgame_stage_skipped';

export type PostgameWorkerLog = {
  event: PostgameWorkerEvent;
  game_id: string;
  season: string;
  stage: string;
  attempt: number;
  duration_ms: number;
  input_count?: number;
  output_count?: number;
  identity_skipped?: number;
  reason_code?: PostgameReasonCode | null;
};

export type ProviderFetchResult = {
  httpStatus: number | null;
  payload: unknown;
  pages: number;
};

export type PostgameWorkerPorts = {
  store: StageStore;
  now: Date;
  identityIndex: PlayerIdentityIndex;
  fetchBoxStats: (gameId: string) => Promise<ProviderFetchResult>;
  fetchLineups: (gameId: string) => Promise<ProviderFetchResult>;
  loadGame: (gameId: string) => Promise<{
    gameId: string;
    season: string;
    status: string;
    homeTeamId: string;
    awayTeamId: string;
    homeScore: number | null;
    awayScore: number | null;
  } | null>;
  writePlayerGameLogs: (rows: PlayerGameLogWrite[]) => Promise<void>;
  writeGameStarters: (gameId: string, season: string, rows: GameStarterCandidate[]) => Promise<void>;
  archiveLineups?: (key: string, payload: unknown) => Promise<void>;
  logs?: PostgameWorkerLog[];
};

export type PostgameWorkerConfig = {
  liveIngestionEnabled: boolean;
  freezeSkipsMutations: boolean;
  goatSubscriptionActive: boolean;
  boxRequiresGoat: boolean;
  targetSeason: string;
  maxAttempts: number;
};

export type WorkerHandleResult = {
  ack: boolean;
  skipped: boolean;
  claimed: boolean;
  providerCalled: boolean;
  s3Called: boolean;
  writes: number;
  status?: string;
  reasonCode?: PostgameReasonCode | null;
  event: PostgameWorkerEvent;
};

function emit(ports: PostgameWorkerPorts, log: PostgameWorkerLog) {
  ports.logs?.push(log);
}

function executionAllowed(config: PostgameWorkerConfig): boolean {
  return config.liveIngestionEnabled && !config.freezeSkipsMutations;
}

export async function handlePostgameMessage(
  raw: unknown,
  ports: PostgameWorkerPorts,
  config: PostgameWorkerConfig
): Promise<WorkerHandleResult> {
  const started = ports.now.getTime();
  const parsed = parsePostgameQueueMessage(raw);
  if (!parsed) {
    return {
      ack: false,
      skipped: true,
      claimed: false,
      providerCalled: false,
      s3Called: false,
      writes: 0,
      event: 'postgame_stage_failed',
    };
  }

  const duration = () => Math.max(0, ports.now.getTime() - started);
  const baseLog = {
    game_id: parsed.gameId,
    season: parsed.season,
    stage: parsed.stage,
    attempt: parsed.attempt,
    duration_ms: duration(),
  };

  if (!executionAllowed(config)) {
    emit(ports, { event: 'postgame_stage_skipped', ...baseLog, reason_code: null });
    return {
      ack: true,
      skipped: true,
      claimed: false,
      providerCalled: false,
      s3Called: false,
      writes: 0,
      event: 'postgame_stage_skipped',
    };
  }

  if (
    parsed.season !== config.targetSeason ||
    (POSTGAME_PROTECTED_SEASONS as readonly string[]).includes(parsed.season)
  ) {
    emit(ports, { event: 'postgame_stage_failed', ...baseLog, reason_code: 'QUALITY_FAILED' });
    return {
      ack: true,
      skipped: true,
      claimed: false,
      providerCalled: false,
      s3Called: false,
      writes: 0,
      event: 'postgame_stage_failed',
    };
  }

  if (!isImplementedPostgameStage(parsed.stage)) {
    emit(ports, { event: 'postgame_stage_skipped', ...baseLog, reason_code: null });
    return {
      ack: true,
      skipped: true,
      claimed: false,
      providerCalled: false,
      s3Called: false,
      writes: 0,
      event: 'postgame_stage_skipped',
    };
  }

  const goatBlocked =
    (parsed.stage === 'starters' && !config.goatSubscriptionActive) ||
    (parsed.stage === 'box' && config.boxRequiresGoat && !config.goatSubscriptionActive);
  if (goatBlocked) {
    const existing = ports.store.get(parsed.gameId, parsed.stage);
    if (existing) {
      completeStage(ports.store, existing, {
        status: 'BLOCKED',
        reasonCode: 'SUBSCRIPTION_BLOCKED',
        now: ports.now,
      });
    }
    emit(ports, {
      event: 'postgame_stage_blocked',
      ...baseLog,
      reason_code: 'SUBSCRIPTION_BLOCKED',
    });
    return {
      ack: true,
      skipped: true,
      claimed: false,
      providerCalled: false,
      s3Called: false,
      writes: 0,
      status: 'BLOCKED',
      reasonCode: 'SUBSCRIPTION_BLOCKED',
      event: 'postgame_stage_blocked',
    };
  }

  const claim = claimQueuedStage(ports.store, {
    gameId: parsed.gameId,
    stage: parsed.stage,
    now: ports.now,
  });
  if (!claim.ok) {
    emit(ports, { event: 'postgame_stage_skipped', ...baseLog, reason_code: null });
    return {
      ack: true,
      skipped: true,
      claimed: false,
      providerCalled: false,
      s3Called: false,
      writes: 0,
      event: 'postgame_stage_skipped',
    };
  }

  emit(ports, { event: 'postgame_stage_claimed', ...baseLog, attempt: claim.record.attempts });

  const game = await ports.loadGame(parsed.gameId);
  if (!game || game.season !== config.targetSeason) {
    completeStage(ports.store, claim.record, {
      status: 'FAILED',
      reasonCode: 'QUALITY_FAILED',
      now: ports.now,
    });
    emit(ports, { event: 'postgame_stage_failed', ...baseLog, reason_code: 'QUALITY_FAILED' });
    return {
      ack: true,
      skipped: false,
      claimed: true,
      providerCalled: false,
      s3Called: false,
      writes: 0,
      status: 'FAILED',
      reasonCode: 'QUALITY_FAILED',
      event: 'postgame_stage_failed',
    };
  }

  if (parsed.stage === 'box') {
    return runBox(parsed, claim.record, game, ports, config);
  }
  return runStarters(parsed, claim.record, game, ports, config);
}

async function runBox(
  parsed: PostgameQueueMessage,
  claimed: ReturnType<typeof claimQueuedStage> extends { ok: true; record: infer R } ? R : never,
  game: NonNullable<Awaited<PostgameWorkerPorts['loadGame']>>,
  ports: PostgameWorkerPorts,
  config: PostgameWorkerConfig
): Promise<WorkerHandleResult> {
  const fetched = await ports.fetchBoxStats(parsed.gameId);
  const result = evaluateBoxStage({
    game,
    payload: fetched.payload,
    httpStatus: fetched.httpStatus,
    pages: fetched.pages,
    identityIndex: ports.identityIndex,
    observedAt: ports.now.toISOString(),
    attempt: claimed.attempts,
  });
  if (result.writes.length > 0) {
    await ports.writePlayerGameLogs(result.writes);
  }
  const retrying = result.status === 'WAITING';
  completeStage(ports.store, claimed, {
    status: result.status,
    reasonCode: result.reasonCode,
    inputCount: result.inputCount,
    outputCount: result.outputCount,
    identitySkipped: result.identitySkipped,
    providerHttp: result.httpStatus,
    nextAttemptAt: retrying
      ? nextAttemptAt({ attempt: claimed.attempts, now: ports.now }).toISOString()
      : null,
    now: ports.now,
  });
  const event = eventForStatus(result.status);
  emit(ports, {
    event,
    game_id: parsed.gameId,
    season: parsed.season,
    stage: parsed.stage,
    attempt: claimed.attempts,
    duration_ms: 0,
    input_count: result.inputCount,
    output_count: result.outputCount,
    identity_skipped: result.identitySkipped,
    reason_code: result.reasonCode,
  });
  return {
    ack: true,
    skipped: false,
    claimed: true,
    providerCalled: true,
    s3Called: false,
    writes: result.writes.length,
    status: result.status,
    reasonCode: result.reasonCode,
    event,
  };
}

async function runStarters(
  parsed: PostgameQueueMessage,
  claimed: Parameters<typeof completeStage>[1],
  game: NonNullable<Awaited<PostgameWorkerPorts['loadGame']>>,
  ports: PostgameWorkerPorts,
  config: PostgameWorkerConfig
): Promise<WorkerHandleResult> {
  const fetched = await ports.fetchLineups(parsed.gameId);
  let s3Called = false;
  if (fetched.payload && ports.archiveLineups && fetched.httpStatus === 200) {
    const key = lineupsRawArchiveKey({
      rawPrefix: process.env.NBA_RAW_PREFIX,
      season: game.season,
      gameId: game.gameId,
    });
    await ports.archiveLineups(key, fetched.payload);
    s3Called = true;
  }
  const result = evaluateStartersStage({
    game,
    payload: fetched.payload,
    httpStatus: fetched.httpStatus,
    identityIndex: ports.identityIndex,
    observedAt: ports.now.toISOString(),
    attempt: claimed.attempts,
    maxAttempts: config.maxAttempts,
  });
  if (result.writes.length > 0) {
    await ports.writeGameStarters(game.gameId, game.season, result.writes);
  }
  const retrying = result.status === 'WAITING';
  completeStage(ports.store, claimed, {
    status: result.status,
    reasonCode: result.reasonCode,
    inputCount: result.inputCount,
    outputCount: result.outputCount,
    identitySkipped: result.identitySkipped,
    providerHttp: result.httpStatus,
    nextAttemptAt: retrying
      ? nextAttemptAt({ attempt: claimed.attempts, now: ports.now }).toISOString()
      : null,
    now: ports.now,
  });
  const event = eventForStatus(result.status);
  emit(ports, {
    event,
    game_id: parsed.gameId,
    season: parsed.season,
    stage: parsed.stage,
    attempt: claimed.attempts,
    duration_ms: 0,
    input_count: result.inputCount,
    output_count: result.outputCount,
    identity_skipped: result.identitySkipped,
    reason_code: result.reasonCode,
  });
  return {
    ack: true,
    skipped: false,
    claimed: true,
    providerCalled: true,
    s3Called,
    writes: result.writes.length,
    status: result.status,
    reasonCode: result.reasonCode,
    event,
  };
}

function eventForStatus(status: string): PostgameWorkerEvent {
  if (status === 'READY') return 'postgame_stage_ready';
  if (status === 'WAITING' || status === 'EXPECTED_ABSENCE') return 'postgame_stage_waiting';
  if (status === 'BLOCKED') return 'postgame_stage_blocked';
  return 'postgame_stage_failed';
}
