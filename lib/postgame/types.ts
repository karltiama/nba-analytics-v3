/**
 * 13F.2 postgame orchestration vocabulary.
 * Pure types — no AWS, no BDL, no DB.
 */

export const POSTGAME_STAGES = ['box', 'starters', 'advanced', 'plays', 'game_flow'] as const;
export type PostgameStage = (typeof POSTGAME_STAGES)[number];

/** Stages that require GOAT-tier BDL endpoints. game_flow is S3/Postgres only. */
export const POSTGAME_GOAT_STAGES = ['starters', 'advanced', 'plays'] as const;
export type PostgameGoatStage = (typeof POSTGAME_GOAT_STAGES)[number];

export const POSTGAME_STAGE_STATUSES = [
  'WAITING',
  'QUEUED',
  'RUNNING',
  'READY',
  'BLOCKED',
  'EXPECTED_ABSENCE',
  'FAILED',
] as const;
export type PostgameStageStatus = (typeof POSTGAME_STAGE_STATUSES)[number];

export const POSTGAME_REASON_CODES = [
  'PROVIDER_NOT_READY',
  'SUBSCRIPTION_BLOCKED',
  'IDENTITY_NOT_SERVING',
  'IDENTITY_CONFLICT',
  'SOURCE_TRUNCATED',
  'QUALITY_FAILED',
  'PROVIDER_401',
  'PROVIDER_429',
  'PROVIDER_5XX',
  'NETWORK_TIMEOUT',
  'MALFORMED_SOURCE',
  'DB_WRITE_FAILED',
  'S3_WRITE_FAILED',
  'VOLUME_UNEXPECTED_ZERO',
] as const;
export type PostgameReasonCode = (typeof POSTGAME_REASON_CODES)[number];

export const POSTGAME_RETRYABLE_REASONS: ReadonlySet<PostgameReasonCode> = new Set([
  'PROVIDER_NOT_READY',
  'PROVIDER_429',
  'PROVIDER_5XX',
  'NETWORK_TIMEOUT',
  'DB_WRITE_FAILED',
  'S3_WRITE_FAILED',
]);

export const POSTGAME_QUEUE_MESSAGE_VERSION = 1 as const;

export type PostgameQueueMessage = {
  v: typeof POSTGAME_QUEUE_MESSAGE_VERSION;
  gameId: string;
  season: string;
  stage: PostgameStage;
  attempt: number;
  enqueuedAt: string;
};

export type PostgameStageRow = {
  gameId: string;
  season: string;
  stage: PostgameStage;
  status: PostgameStageStatus;
  attempts: number;
  reasonCode: PostgameReasonCode | null;
  updatedAt: string;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
};

export type PostgameScanGame = {
  gameId: string;
  season: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  startTime: string | null;
};

export type PostgameServingEvidence = {
  gameId: string;
  boxHomeCount: number;
  boxAwayCount: number;
  startersHomeCount: number;
  startersAwayCount: number;
  advancedCount: number;
  playsObjectPresent: boolean;
  gameFlowTimelineAvailable: boolean | null;
  gameFlowStreamClass: string | null;
};

export type PostgameScanConfig = {
  now: Date;
  lookbackHours: number;
  liveIngestionEnabled: boolean;
  freezeSkipsMutations: boolean;
  goatSubscriptionActive: boolean;
  identityCatchUp: boolean;
  maxAttempts: number;
  stuckQueuedMinutes: number;
  /** When set, other seasons are ignored (protects 2023–2025 certified rows). */
  season?: string;
};

export type PostgameEnqueueAction = 'enqueue' | 'hold' | 'skip';

export type PlannedEnqueue = {
  message: PostgameQueueMessage;
  action: PostgameEnqueueAction;
  holdReason?: string;
};

export type PlannedStageUpsert = {
  gameId: string;
  season: string;
  stage: PostgameStage;
  status: PostgameStageStatus;
  reasonCode: PostgameReasonCode | null;
  derivedFromServing: boolean;
};

export type GameReadinessGrade = 'NOT_ELIGIBLE' | 'MINIMUM_READY' | 'ENRICHED' | 'COMPLETE';

export function isPostgameStage(value: string): value is PostgameStage {
  return (POSTGAME_STAGES as readonly string[]).includes(value);
}

export function isPostgameGoatStage(stage: PostgameStage): boolean {
  return (POSTGAME_GOAT_STAGES as readonly string[]).includes(stage);
}

export function parsePostgameQueueMessage(raw: unknown): PostgameQueueMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.v !== POSTGAME_QUEUE_MESSAGE_VERSION) return null;
  if (typeof row.gameId !== 'string' || !row.gameId.trim()) return null;
  if (typeof row.season !== 'string' || !row.season.trim()) return null;
  if (typeof row.stage !== 'string' || !isPostgameStage(row.stage)) return null;
  if (typeof row.attempt !== 'number' || !Number.isInteger(row.attempt) || row.attempt < 1) {
    return null;
  }
  if (typeof row.enqueuedAt !== 'string' || !row.enqueuedAt.trim()) return null;
  return {
    v: POSTGAME_QUEUE_MESSAGE_VERSION,
    gameId: row.gameId,
    season: row.season,
    stage: row.stage,
    attempt: row.attempt,
    enqueuedAt: row.enqueuedAt,
  };
}

export function buildPostgameQueueMessage(input: {
  gameId: string;
  season: string;
  stage: PostgameStage;
  attempt: number;
  enqueuedAt: string;
}): PostgameQueueMessage {
  return {
    v: POSTGAME_QUEUE_MESSAGE_VERSION,
    gameId: input.gameId,
    season: input.season,
    stage: input.stage,
    attempt: input.attempt,
    enqueuedAt: input.enqueuedAt,
  };
}
