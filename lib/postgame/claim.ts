/**
 * Conditional postgame stage transitions. Claim is QUEUED → RUNNING only.
 */

import type { PostgameReasonCode, PostgameStage, PostgameStageStatus } from './types';

export type StageRecord = {
  gameId: string;
  season: string;
  stage: PostgameStage;
  status: PostgameStageStatus;
  attempts: number;
  reasonCode: PostgameReasonCode | null;
  inputCount: number | null;
  outputCount: number | null;
  identitySkipped: number | null;
  providerHttp: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  updatedAt: string;
};

export type ClaimResult =
  | { ok: true; record: StageRecord }
  | { ok: false; reason: 'not_queued' | 'missing' };

export type StageStore = {
  get(gameId: string, stage: PostgameStage): StageRecord | undefined;
  save(record: StageRecord): void;
};

export function claimQueuedStage(
  store: StageStore,
  input: { gameId: string; stage: PostgameStage; now: Date }
): ClaimResult {
  const current = store.get(input.gameId, input.stage);
  if (!current) return { ok: false, reason: 'missing' };
  if (current.status !== 'QUEUED') return { ok: false, reason: 'not_queued' };
  const iso = input.now.toISOString();
  const next: StageRecord = {
    ...current,
    status: 'RUNNING',
    attempts: current.attempts + 1,
    startedAt: iso,
    lastAttemptAt: iso,
    finishedAt: null,
    updatedAt: iso,
  };
  store.save(next);
  return { ok: true, record: next };
}

export function completeStage(
  store: StageStore,
  current: StageRecord,
  patch: Partial<Pick<
    StageRecord,
    | 'status'
    | 'reasonCode'
    | 'inputCount'
    | 'outputCount'
    | 'identitySkipped'
    | 'providerHttp'
    | 'nextAttemptAt'
  >> & { now: Date }
): StageRecord {
  const next: StageRecord = {
    ...current,
    ...patch,
    finishedAt: patch.now.toISOString(),
    updatedAt: patch.now.toISOString(),
  };
  store.save(next);
  return next;
}
