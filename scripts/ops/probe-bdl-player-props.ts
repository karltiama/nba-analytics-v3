/**
 * Retired. This probe bypassed the shared limiter and could read a Lambda env key.
 * Do not use it.
 *
 * Use scripts/ops/2026-player-props-canary.ts
 */
console.log(
  JSON.stringify(
    {
      CANARY: 'player-props-legacy-probe',
      EXECUTED: false,
      REQUEST_COUNT: 0,
      HTTP_STATUS: null,
      ACCESS: 'NOT_EXECUTED',
      SCHEMA_VALID: false,
      WRITE_COUNT: 0,
      RATE_LIMITER: 'none',
      STOP_REASON: 'RETIRED_USE_scripts/ops/2026-player-props-canary.ts',
    },
    null,
    2
  )
);
