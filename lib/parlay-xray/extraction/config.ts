import { XRAY_MAX_UPLOAD_BYTES } from '@/lib/parlay-xray/types';

const SAFE_MODELS = new Set(['gpt-4o-mini']);

export type XrayVisionDetail = 'low' | 'high';
export type XrayStoreKind = 'memory' | 'postgres';

export type XrayExtractionConfig = {
  enabled: boolean;
  freeDailyLimit: number;
  proDailyLimit: number;
  globalDailyLimit: number;
  maxConcurrentPerUser: number;
  dedupeTtlMs: number;
  cooldownMs: number;
  inflightTtlMs: number;
  extractionVersion: string;
  schemaVersion: string;
  visionModel: string;
  visionDetail: XrayVisionDetail;
  maxUploadBytes: number;
  maxLongEdge: number;
  maxOutputTokens: number;
  store: XrayStoreKind;
  openaiApiKey: string | null;
};

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw == null || raw.trim() === '') return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return defaultValue;
}

function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function parseStore(raw: string | undefined, nodeEnv: string | undefined): XrayStoreKind {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'memory') return 'memory';
  if (v === 'postgres') return 'postgres';
  if ((nodeEnv ?? '').toLowerCase() === 'test') return 'memory';
  return 'postgres';
}

/**
 * Kill switch default is SAFE (false). Missing env is false.
 * Vision model default is gpt-4o-mini. Unknown/expensive models are not
 * silently substituted — they must be set explicitly on PARLAY_XRAY_VISION_MODEL.
 */
export function loadXrayExtractionConfig(
  env: NodeJS.ProcessEnv = process.env
): XrayExtractionConfig {
  const requestedModel = (env.PARLAY_XRAY_VISION_MODEL ?? '').trim();
  const visionModel = requestedModel || 'gpt-4o-mini';
  const detailRaw = (env.PARLAY_XRAY_VISION_DETAIL ?? 'low').trim().toLowerCase();
  const visionDetail: XrayVisionDetail = detailRaw === 'high' ? 'high' : 'low';

  const dedicatedKey = env.PARLAY_XRAY_OPENAI_API_KEY?.trim() || null;
  const sharedKey = env.OPENAI_API_KEY?.trim() || null;

  return {
    enabled: parseBool(env.PARLAY_XRAY_EXTRACTION_ENABLED, false),
    freeDailyLimit: parseIntEnv(env.PARLAY_XRAY_FREE_DAILY_LIMIT, 3, 0, 10_000),
    proDailyLimit: parseIntEnv(env.PARLAY_XRAY_PRO_DAILY_LIMIT, 10, 0, 10_000),
    globalDailyLimit: parseIntEnv(env.PARLAY_XRAY_GLOBAL_DAILY_LIMIT, 100, 0, 1_000_000),
    maxConcurrentPerUser: parseIntEnv(env.PARLAY_XRAY_MAX_CONCURRENT_PER_USER, 1, 1, 1),
    dedupeTtlMs: parseIntEnv(env.PARLAY_XRAY_DEDUPE_TTL_HOURS, 24, 1, 168) * 60 * 60 * 1000,
    cooldownMs: parseIntEnv(env.PARLAY_XRAY_COOLDOWN_SECONDS, 45, 0, 600) * 1000,
    inflightTtlMs: parseIntEnv(env.PARLAY_XRAY_INFLIGHT_TTL_SECONDS, 120, 15, 600) * 1000,
    extractionVersion: (env.PARLAY_XRAY_EXTRACTION_VERSION ?? '').trim() || 'xray-extract-v2.1',
    schemaVersion: 'xray-legs-v2',
    visionModel,
    visionDetail,
    maxUploadBytes: parseIntEnv(env.PARLAY_XRAY_MAX_UPLOAD_BYTES, XRAY_MAX_UPLOAD_BYTES, 1, XRAY_MAX_UPLOAD_BYTES),
    maxLongEdge: parseIntEnv(env.PARLAY_XRAY_MAX_LONG_EDGE, 4096, 256, 8192),
    maxOutputTokens: parseIntEnv(env.PARLAY_XRAY_MAX_OUTPUT_TOKENS, 1400, 128, 2048),
    store: parseStore(env.PARLAY_XRAY_STORE, env.NODE_ENV),
    openaiApiKey: dedicatedKey ?? sharedKey,
  };
}

export function dailyLimitForPlan(config: XrayExtractionConfig, isPro: boolean): number {
  return isPro ? config.proDailyLimit : config.freeDailyLimit;
}

export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function dedupeIdentity(input: {
  userId: string;
  imageHash: string;
  extractionVersion: string;
  schemaVersion: string;
  model: string;
}): string {
  return `${input.userId}:${input.imageHash}:${input.extractionVersion}:${input.schemaVersion}:${input.model}`;
}

export function isKnownSafeDefaultModel(model: string): boolean {
  return SAFE_MODELS.has(model);
}
