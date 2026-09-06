/**
 * Fail-closed live-ingestion gates.
 *
 * Mutations and provider calls run only when DATA_MODE is exactly `live_api`.
 * Missing, empty, or unknown DATA_MODE is not live (never default to live_api).
 * Explicit freeze flags still skip even when DATA_MODE=live_api.
 */

export const LIVE_DATA_MODE = 'live_api';

export type IngestionModeSnapshot = {
  dataMode: string;
  offseason: boolean;
  cronDryRun: boolean;
  shouldSkipMutations: boolean;
};

export function readDataMode(
  env: Record<string, string | undefined> = process.env
): string {
  return (env.DATA_MODE ?? '').trim().toLowerCase();
}

export function readIngestionMode(
  env: Record<string, string | undefined> = process.env
): IngestionModeSnapshot {
  const dataMode = readDataMode(env);
  const offseason = env.OFFSEASON_MODE === '1';
  const cronDryRun = env.CRON_DRY_RUN === '1';
  const shouldSkipMutations =
    cronDryRun || offseason || dataMode !== LIVE_DATA_MODE;
  return { dataMode, offseason, cronDryRun, shouldSkipMutations };
}

/** True when freeze/missing config forbids live provider calls and writes. */
export function shouldSkipLiveMutations(
  env: Record<string, string | undefined> = process.env
): boolean {
  return readIngestionMode(env).shouldSkipMutations;
}

/**
 * On-request BDL schedule refresh (betting slate).
 * Requires explicit live ingestion mode and must not be disabled.
 */
export function isLiveBdlScheduleRefreshEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.DISABLE_BDL_LIVE_SCHEDULE_REFRESH === '1') return false;
  return !shouldSkipLiveMutations(env);
}
