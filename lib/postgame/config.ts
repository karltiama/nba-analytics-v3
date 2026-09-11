import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { POSTGAME_TARGET_SEASON, type PostgameWorkerConfig } from './worker';

export function postgameWorkerConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): PostgameWorkerConfig {
  const mode = readIngestionMode(env);
  const liveFlag = (env.LIVE_INGESTION_ENABLED ?? '').trim().toLowerCase();
  const maxRaw = Number(env.POSTGAME_MAX_ATTEMPTS ?? 8);
  return {
    liveIngestionEnabled: liveFlag === '1' || liveFlag === 'true',
    freezeSkipsMutations: mode.shouldSkipMutations,
    goatSubscriptionActive: env.BDL_GOAT_SUBSCRIPTION === '1',
    boxRequiresGoat: env.POSTGAME_BOX_REQUIRES_GOAT === '1',
    targetSeason: (env.POSTGAME_TARGET_SEASON ?? POSTGAME_TARGET_SEASON).trim() || POSTGAME_TARGET_SEASON,
    maxAttempts: Number.isInteger(maxRaw) && maxRaw > 0 ? maxRaw : 8,
  };
}
