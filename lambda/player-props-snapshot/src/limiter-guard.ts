/**
 * Props-owned live limiter profile. The shared Terraform default is 500ms / burst 5.
 * The live odds collector refuses to run unless its own env is 13000 / 1 / 1 / 0 retries.
 * A props worker on the faster profile would refill the same DynamoDB token bucket.
 * These checks read the process env only. They do not apply the in-code 13000 default.
 */

export const PROPS_LIVE_LIMITER_PROFILE = {
  BDL_RATE_LIMIT_INTERVAL_MS: '13000',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1',
  BDL_RATE_LIMIT_BURST: '1',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
} as const;

export class PropsLimiterError extends Error {
  readonly settings: string[];

  constructor(settings: string[]) {
    super(`props limiter refused: ${settings.join(', ')}`);
    this.name = 'PropsLimiterError';
    this.settings = settings;
  }
}

export function assertPropsLiveLimiter(env: Record<string, string | undefined>): void {
  const refused: string[] = [];
  for (const [key, expected] of Object.entries(PROPS_LIVE_LIMITER_PROFILE)) {
    const actual = env[key];
    if (actual == null || actual.trim() === '' || actual !== expected) refused.push(key);
  }
  if (refused.length > 0) throw new PropsLimiterError(refused);
}
