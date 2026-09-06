/**
 * Extra CLI confirmation for props prune.
 *
 * `--execute` is not a substitute for PRUNE_ENABLED / live flags / archive
 * / closing-line / max-delete gates. Without --execute, freeze the job so
 * runPrunePropsJob cannot delete or materialize even if the shell env is live.
 */

export function overlayPruneCliEnv(
  env: Record<string, string | undefined>,
  execute: boolean
): Record<string, string | undefined> {
  if (execute) {
    return { ...env };
  }
  return {
    ...env,
    PRUNE_ENABLED: '0',
    CRON_DRY_RUN: '1',
  };
}
