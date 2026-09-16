import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';
import { dailyLimitForPlan, dedupeIdentity, utcDayKey, type XrayExtractionConfig } from './config';
import { estimateCostUsd } from './cost';
import { XRAY_EXTRACT_MESSAGE } from './copy';
import { toDataUrl, validateAndNormalizeScreenshot } from './image';
import { applyXrayExtractionContract } from './document-contract';
import { recoverLineOnExtractedLeg } from './line-value';
import { XrayProviderError, type XrayVisionProvider } from './provider';
import type { XrayExtractResult } from './result-codes';
import type { XrayExtractionStore, XrayReservation, XrayUsageRecord } from './store';
import { XrayStoreUnavailableError } from './store';

export type XrayExtractRequest = {
  userId: string;
  isPro: boolean;
  bytes: Buffer;
  declaredMime: string;
};

export type XrayQuotaView = {
  used: number;
  limit: number;
  remaining: number;
};

export type XrayExtractResponse = {
  result: XrayExtractResult;
  message: string;
  legs: ExtractedParlayLeg[];
  cacheHit: boolean;
  providerAttempted: boolean;
  quota: XrayQuotaView;
  extractionVersion: string;
  validationCode?: 'unsupported_file' | 'file_too_large' | 'unreadable_screenshot';
};

export type XrayExtractDeps = {
  config: XrayExtractionConfig;
  store: XrayExtractionStore;
  provider: XrayVisionProvider;
  now?: () => Date;
  idFactory?: () => string;
  log?: (event: string, meta: Record<string, unknown>) => void;
  /** Test-only hook. Throws before the provider is invoked; reservation must be released. */
  beforeProvider?: () => Promise<void> | void;
};

function quotaView(used: number, limit: number): XrayQuotaView {
  return { used, limit, remaining: Math.max(0, limit - used) };
}

function respond(
  result: XrayExtractResult,
  extra: Partial<XrayExtractResponse> & Pick<XrayExtractResponse, 'quota' | 'extractionVersion'>
): XrayExtractResponse {
  return {
    result,
    message: XRAY_EXTRACT_MESSAGE[result],
    legs: [],
    cacheHit: false,
    providerAttempted: false,
    ...extra,
  };
}

function newLegId(factory: (() => string) | undefined, index: number): string {
  if (factory) return factory();
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `xray-leg-${index}-${Date.now()}`;
}

function usageBase(input: {
  userId: string;
  now: Date;
  config: XrayExtractionConfig;
  imageHash: string;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  normalizedWidth: number;
  normalizedHeight: number;
  normalizedBytes: number;
}): Omit<
  XrayUsageRecord,
  | 'cacheHit'
  | 'providerAttempted'
  | 'success'
  | 'latencyMs'
  | 'providerRequestId'
  | 'promptTokens'
  | 'completionTokens'
  | 'totalTokens'
  | 'estimatedCostUsd'
  | 'errorCategory'
> {
  return {
    userId: input.userId,
    timestamp: input.now.toISOString(),
    extractionVersion: input.config.extractionVersion,
    schemaVersion: input.config.schemaVersion,
    model: input.config.visionModel,
    imageHash: input.imageHash,
    originalWidth: input.originalWidth,
    originalHeight: input.originalHeight,
    originalBytes: input.originalBytes,
    normalizedWidth: input.normalizedWidth,
    normalizedHeight: input.normalizedHeight,
    normalizedBytes: input.normalizedBytes,
  };
}

function safeLog(log: XrayExtractDeps['log'], event: string, meta: Record<string, unknown>): void {
  try {
    log?.(event, meta);
  } catch {
    // logging must never affect extraction
  }
}

/**
 * Ordered paid path:
 * kill switch → validation → dedupe → reserve → provider (1 attempt) → map → usage → unlock
 *
 * Quota semantics:
 * - validation / kill switch / missing key / cache hit: no quota consumed
 * - reservation then internal failure before provider: reservation released
 * - provider request actually attempted: quota kept (may cost money)
 */
export async function runXrayExtraction(
  request: XrayExtractRequest,
  deps: XrayExtractDeps
): Promise<XrayExtractResponse> {
  const nowFn = deps.now ?? (() => new Date());
  const now = nowFn();
  const { config, store } = deps;
  const userLimit = dailyLimitForPlan(config, request.isPro);
  const dayKey = utcDayKey(now);
  const version = config.extractionVersion;

  const currentQuota = async (): Promise<XrayQuotaView> => {
    try {
      const snap = await store.getQuota(request.userId, dayKey);
      return quotaView(snap.userUsed, userLimit);
    } catch (error) {
      if (error instanceof XrayStoreUnavailableError) {
        return quotaView(0, userLimit);
      }
      throw error;
    }
  };

  if (!config.enabled) {
    return respond('EXTRACTION_DISABLED', {
      quota: await currentQuota(),
      extractionVersion: version,
    });
  }

  const validated = validateAndNormalizeScreenshot(request.bytes, request.declaredMime, {
    maxBytes: config.maxUploadBytes,
    maxLongEdge: config.maxLongEdge,
  });
  if (!validated.ok) {
    return respond('UNREADABLE_IMAGE', {
      quota: await currentQuota(),
      extractionVersion: version,
      validationCode: validated.code,
      message:
        validated.code === 'file_too_large'
          ? 'That screenshot is too large. Please use a file under 10 MB.'
          : validated.code === 'unsupported_file'
            ? 'That file type isn’t supported. Use a PNG, JPG, or WebP screenshot.'
            : XRAY_EXTRACT_MESSAGE.UNREADABLE_IMAGE,
    });
  }

  if (!config.openaiApiKey) {
    return respond('PROVIDER_UNAVAILABLE', {
      quota: await currentQuota(),
      extractionVersion: version,
    });
  }

  const identity = dedupeIdentity({
    userId: request.userId,
    imageHash: validated.sha256,
    extractionVersion: config.extractionVersion,
    schemaVersion: config.schemaVersion,
    model: config.visionModel,
  });

  const cached = await store.getCached(identity, now.getTime());
  if (cached) {
    const quota = await currentQuota();
    await store.recordCacheHitUsage({
      ...usageBase({
        userId: request.userId,
        now,
        config,
        imageHash: validated.sha256,
        originalWidth: validated.originalWidth,
        originalHeight: validated.originalHeight,
        originalBytes: validated.originalBytes,
        normalizedWidth: validated.normalizedWidth,
        normalizedHeight: validated.normalizedHeight,
        normalizedBytes: validated.normalizedBytes,
      }),
      cacheHit: true,
      providerAttempted: false,
      success: true,
      latencyMs: 0,
      providerRequestId: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
      errorCategory: null,
    });
    safeLog(deps.log, 'xray_extract_cache_hit', {
      extractionVersion: version,
      model: config.visionModel,
      cacheHit: true,
      providerAttempted: false,
    });
    return {
      result: cached.result,
      message: cached.message ?? XRAY_EXTRACT_MESSAGE[cached.result],
      legs: cached.legs.map(recoverLineOnExtractedLeg),
      cacheHit: true,
      providerAttempted: false,
      quota,
      extractionVersion: version,
    };
  }

  const reserved = await store.reserve({
    userId: request.userId,
    dayKey,
    userLimit,
    globalLimit: config.globalDailyLimit,
    cooldownMs: config.cooldownMs,
    inflightTtlMs: config.inflightTtlMs,
    now: now.getTime(),
  });

  if (!reserved.ok) {
    const quota = await currentQuota();
    if (reserved.reason === 'user_quota') return respond('USER_QUOTA_EXCEEDED', { quota, extractionVersion: version });
    if (reserved.reason === 'global_quota') return respond('GLOBAL_QUOTA_EXCEEDED', { quota, extractionVersion: version });
    if (reserved.reason === 'inflight') return respond('IN_FLIGHT', { quota, extractionVersion: version });
    if (reserved.reason === 'cooldown') return respond('RATE_LIMITED', { quota, extractionVersion: version });
    return respond('INTERNAL_ERROR', { quota, extractionVersion: version });
  }

  const reservation: XrayReservation = reserved.reservation;
  const started = Date.now();

  let providerResult: Awaited<ReturnType<XrayVisionProvider>>;
  let providerAttempted = false;
  try {
    if (deps.beforeProvider) {
      await deps.beforeProvider();
    }
    providerAttempted = true;
    providerResult = await deps.provider({
      apiKey: config.openaiApiKey,
      model: config.visionModel,
      detail: config.visionDetail,
      dataUrl: toDataUrl(validated.mime, validated.bytes),
      maxOutputTokens: config.maxOutputTokens,
    });
  } catch (error) {
    if (!providerAttempted) {
      await store.releaseBeforeProvider(reservation);
      safeLog(deps.log, 'xray_extract_released_before_provider', {
        extractionVersion: version,
        cacheHit: false,
        providerAttempted: false,
      });
      return respond('INTERNAL_ERROR', {
        quota: await currentQuota(),
        extractionVersion: version,
      });
    }
    const category = error instanceof XrayProviderError ? error.category : 'network';
    const latencyMs = Date.now() - started;
    const quota = await currentQuota();
    await store.finalizeAttempt(reservation, {
      ...usageBase({
        userId: request.userId,
        now: nowFn(),
        config,
        imageHash: validated.sha256,
        originalWidth: validated.originalWidth,
        originalHeight: validated.originalHeight,
        originalBytes: validated.originalBytes,
        normalizedWidth: validated.normalizedWidth,
        normalizedHeight: validated.normalizedHeight,
        normalizedBytes: validated.normalizedBytes,
      }),
      cacheHit: false,
      providerAttempted: true,
      success: false,
      latencyMs,
      providerRequestId: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
      errorCategory: category,
    });
    safeLog(deps.log, 'xray_extract_provider_failed', {
      extractionVersion: version,
      model: config.visionModel,
      cacheHit: false,
      providerAttempted: true,
      errorCategory: category,
      latencyMs,
    });
    return respond('PROVIDER_UNAVAILABLE', {
      quota,
      extractionVersion: version,
      providerAttempted: true,
    });
  }

  let index = 0;
  const contracted = applyXrayExtractionContract(providerResult.output, () => {
    const id = newLegId(deps.idFactory, index);
    index += 1;
    return id;
  });
  if (!contracted.ok) {
    const latencyMs = Date.now() - started;
    const quota = await currentQuota();
    await store.finalizeAttempt(reservation, {
      ...usageBase({
        userId: request.userId,
        now: nowFn(),
        config,
        imageHash: validated.sha256,
        originalWidth: validated.originalWidth,
        originalHeight: validated.originalHeight,
        originalBytes: validated.originalBytes,
        normalizedWidth: validated.normalizedWidth,
        normalizedHeight: validated.normalizedHeight,
        normalizedBytes: validated.normalizedBytes,
      }),
      cacheHit: false,
      providerAttempted: true,
      success: false,
      latencyMs,
      providerRequestId: providerResult.requestId,
      promptTokens: providerResult.promptTokens,
      completionTokens: providerResult.completionTokens,
      totalTokens: providerResult.totalTokens,
      estimatedCostUsd: null,
      errorCategory: 'malformed_output',
    });
    safeLog(deps.log, 'xray_extract_provider_failed', {
      extractionVersion: version,
      model: config.visionModel,
      cacheHit: false,
      providerAttempted: true,
      errorCategory: 'malformed_output',
      latencyMs,
    });
    return respond('PROVIDER_UNAVAILABLE', {
      quota,
      extractionVersion: version,
      providerAttempted: true,
    });
  }

  const { legs, result, message } = contracted;
  const latencyMs = Date.now() - started;
  const estimatedCostUsd = estimateCostUsd({
    model: config.visionModel,
    promptTokens: providerResult.promptTokens,
    completionTokens: providerResult.completionTokens,
  });

  await store.putCached(identity, { result, legs, message }, now.getTime(), config.dedupeTtlMs);
  await store.finalizeAttempt(reservation, {
    ...usageBase({
      userId: request.userId,
      now: nowFn(),
      config,
      imageHash: validated.sha256,
      originalWidth: validated.originalWidth,
      originalHeight: validated.originalHeight,
      originalBytes: validated.originalBytes,
      normalizedWidth: validated.normalizedWidth,
      normalizedHeight: validated.normalizedHeight,
      normalizedBytes: validated.normalizedBytes,
    }),
    cacheHit: false,
    providerAttempted: true,
    success: result !== 'PROVIDER_UNAVAILABLE' && result !== 'INTERNAL_ERROR',
    latencyMs,
    providerRequestId: providerResult.requestId,
    promptTokens: providerResult.promptTokens,
    completionTokens: providerResult.completionTokens,
    totalTokens: providerResult.totalTokens,
    estimatedCostUsd,
    errorCategory: null,
  });

  const quota = await currentQuota();
  safeLog(deps.log, 'xray_extract_completed', {
    extractionVersion: version,
    model: config.visionModel,
    cacheHit: false,
    providerAttempted: true,
    success: true,
    latencyMs,
    originalWidth: validated.originalWidth,
    originalHeight: validated.originalHeight,
    originalBytes: validated.originalBytes,
    normalizedWidth: validated.normalizedWidth,
    normalizedHeight: validated.normalizedHeight,
    normalizedBytes: validated.normalizedBytes,
  });

  return {
    result,
    message,
    legs,
    cacheHit: false,
    providerAttempted: true,
    quota,
    extractionVersion: version,
  };
}

export async function readXrayQuota(
  store: XrayExtractionStore,
  config: XrayExtractionConfig,
  userId: string,
  isPro: boolean,
  now: Date = new Date()
): Promise<XrayQuotaView & { enabled: boolean }> {
  const snap = await store.getQuota(userId, utcDayKey(now));
  const limit = dailyLimitForPlan(config, isPro);
  return { ...quotaView(snap.userUsed, limit), enabled: config.enabled };
}
