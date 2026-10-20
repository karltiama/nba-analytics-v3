/**
 * Local policy for later gates. Nothing here changes AWS.
 * The existing 12-key freeze plus disabled rules is the emergency stop.
 * A budget miss already refuses provider calls. It must not disable the scoreboard.
 */

export const PROPOSED_LAMBDA_MAX_RETRY_ATTEMPTS = 0;
export const PROPOSED_LAMBDA_MAX_EVENT_AGE_SECONDS = 900;
export const PROPOSED_EVENTBRIDGE_TARGET_MAX_RETRY_ATTEMPTS = 0;
export const PROPOSED_EVENTBRIDGE_MAX_EVENT_AGE_SECONDS = 900;

export const ODDS_EMERGENCY_STOP_STEPS = [
  'Disable the active odds EventBridge rules. Leave the scoreboard schedule enabled.',
  'Put DATA_MODE=replay, OFFSEASON_MODE=1, and CRON_DRY_RUN=1 back on the verified 12-key map.',
  'Confirm the odds function has no in-flight invocation and no new provider request.',
  'Confirm the environment hash matches the saved freeze and ODDS_CANARY_ONLY is absent.',
  'Confirm the scoreboard schedule is still ENABLED and SCOREBOARD_COLLECT_ODDS=0.',
  'Leave raw, current, and history rows in place.',
  'Leave pull-run error rows and CloudWatch evidence in place.',
  'Do not enable, disable, or refreeze props.',
  'Do not apply Terraform and do not edit Terraform state.',
] as const;

export function oddsAcquisitionEvent(input: {
  success: boolean;
  status: string;
  providerRequests: number;
  classifications: readonly string[];
  budgetRemaining?: number;
}): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const classification of input.classifications) {
    counts[classification] = (counts[classification] ?? 0) + 1;
  }
  return {
    evt: 'odds_acquisition',
    success: input.success,
    status: input.status,
    providerRequests: input.providerRequests,
    classifications: counts,
    budgetRemaining: input.budgetRemaining ?? null,
    duplicateSkipped: counts.SKIPPED ?? 0,
    budgetExhausted: counts.BUDGET_EXHAUSTED ?? 0,
    provider401: counts.UNAUTHORIZED ?? 0,
    provider403: counts.FORBIDDEN ?? 0,
    provider429: counts.RATE_LIMITED ?? 0,
    providerTimeout: counts.TIMEOUT ?? 0,
    incomplete: counts.INCOMPLETE ?? 0,
    movementFailed: counts.MOVEMENT_PERSISTENCE ?? 0,
  };
}
