import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';
import type { XrayExtractResult } from './result-codes';

export type XrayQuotaSnapshot = {
  userUsed: number;
  globalUsed: number;
  lastAttemptAt: number | null;
};

export type XrayCachedExtraction = {
  result: XrayExtractResult;
  legs: ExtractedParlayLeg[];
  message?: string;
};

export type XrayReservation = {
  reservationId: string;
  dayKey: string;
  userId: string;
};

export type XrayReserveFailure =
  | 'user_quota'
  | 'global_quota'
  | 'inflight'
  | 'cooldown'
  | 'store_unavailable';

export type XrayUsageRecord = {
  userId: string;
  timestamp: string;
  extractionVersion: string;
  schemaVersion: string | null;
  model: string;
  imageHash: string;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  normalizedWidth: number;
  normalizedHeight: number;
  normalizedBytes: number;
  cacheHit: boolean;
  providerAttempted: boolean;
  success: boolean;
  latencyMs: number | null;
  providerRequestId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  errorCategory: string | null;
};

export type XrayReserveInput = {
  userId: string;
  dayKey: string;
  userLimit: number;
  globalLimit: number;
  cooldownMs: number;
  inflightTtlMs: number;
  now: number;
};

export interface XrayExtractionStore {
  getQuota(userId: string, dayKey: string): Promise<XrayQuotaSnapshot>;
  getCached(identity: string, now: number): Promise<XrayCachedExtraction | null>;
  putCached(identity: string, value: XrayCachedExtraction, now: number, ttlMs: number): Promise<void>;
  reserve(
    input: XrayReserveInput
  ): Promise<{ ok: true; reservation: XrayReservation } | { ok: false; reason: XrayReserveFailure }>;
  /**
   * Provider was attempted (may have cost money). Keep quota. Clear inflight. Persist usage.
   */
  finalizeAttempt(reservation: XrayReservation, usage: XrayUsageRecord): Promise<void>;
  /**
   * Failure before the provider request. Release inflight AND decrement reserved quota.
   */
  releaseBeforeProvider(reservation: XrayReservation): Promise<void>;
  recordCacheHitUsage(usage: XrayUsageRecord): Promise<void>;
}

export function emptyQuota(): XrayQuotaSnapshot {
  return { userUsed: 0, globalUsed: 0, lastAttemptAt: null };
}

export class XrayStoreUnavailableError extends Error {
  constructor() {
    super('xray_store_unavailable');
    this.name = 'XrayStoreUnavailableError';
  }
}
