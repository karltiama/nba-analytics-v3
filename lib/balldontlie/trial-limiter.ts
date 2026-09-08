/**
 * BDL 48-hour GOAT trial rate limit (5 requests/minute).
 *
 * Enable with BDL_TRIAL_MODE=1. This is not for post-trial GOAT production
 * (which can use the default ~200ms spacing). Trial mode is fail-closed:
 * concurrency 1, minimum ~12s between requests, default ~13s.
 */

export const BDL_TRIAL_MODE_ENV = 'BDL_TRIAL_MODE';
export const BDL_TRIAL_MIN_DELAY_MS = 12_000;
export const BDL_TRIAL_DEFAULT_DELAY_MS = 13_000;
export const BDL_PRODUCTION_DEFAULT_DELAY_MS = 200;

export type BdlDelayResolution = {
  trialMode: boolean;
  delayMs: number;
  concurrency: 1 | 'unbounded';
  source: 'trial-default' | 'trial-env' | 'trial-opt' | 'default' | 'env' | 'opt';
};

export function isBdlTrialMode(env: Record<string, string | undefined> = process.env): boolean {
  return (env[BDL_TRIAL_MODE_ENV] ?? '').trim() === '1';
}

function envInt(env: Record<string, string | undefined>, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Resolve the inter-request delay. Trial mode rejects anything below 12s,
 * including the historical 200ms default.
 */
export function resolveBdlRequestDelayMs(args?: {
  env?: Record<string, string | undefined>;
  requestedDelayMs?: number;
}): BdlDelayResolution {
  const env = args?.env ?? process.env;
  const trialMode = isBdlTrialMode(env);
  const envDelay = envInt(env, 'BALLDONTLIE_REQUEST_DELAY_MS');
  const requested = args?.requestedDelayMs;

  if (trialMode) {
    const candidate =
      requested !== undefined ? requested : envDelay !== undefined ? envDelay : BDL_TRIAL_DEFAULT_DELAY_MS;
    if (!Number.isFinite(candidate) || candidate < BDL_TRIAL_MIN_DELAY_MS) {
      throw new Error(
        `BDL_TRIAL_MODE=1 forbids delay ${candidate}ms (minimum ${BDL_TRIAL_MIN_DELAY_MS}ms, ` +
          `prefer ${BDL_TRIAL_DEFAULT_DELAY_MS}ms). 5 requests/minute. Do not use the 200ms default.`
      );
    }
    const source =
      requested !== undefined ? 'trial-opt' : envDelay !== undefined ? 'trial-env' : 'trial-default';
    return { trialMode: true, delayMs: candidate, concurrency: 1, source };
  }

  if (requested !== undefined) {
    return {
      trialMode: false,
      delayMs: requested,
      concurrency: 'unbounded',
      source: 'opt',
    };
  }
  if (envDelay !== undefined) {
    return {
      trialMode: false,
      delayMs: envDelay,
      concurrency: 'unbounded',
      source: 'env',
    };
  }
  return {
    trialMode: false,
    delayMs: BDL_PRODUCTION_DEFAULT_DELAY_MS,
    concurrency: 'unbounded',
    source: 'default',
  };
}

export function assertTrialExecuteAllowed(env: Record<string, string | undefined> = process.env): void {
  if (!isBdlTrialMode(env)) {
    throw new Error(
      'Refusing paid/trial BDL acquisition without BDL_TRIAL_MODE=1. ' +
        'This keeps 5 req/min spacing and is not for post-trial GOAT production.'
    );
  }
  resolveBdlRequestDelayMs({ env });
}

let exclusiveChain: Promise<void> = Promise.resolve();

/** Serialize BDL HTTP when trial mode is on (in-process concurrency = 1). */
export async function withBdlTrialExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = exclusiveChain.then(fn, fn);
  exclusiveChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
