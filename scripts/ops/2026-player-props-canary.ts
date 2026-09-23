/**
 * Player-props entitlement canary. Default is dry-run / no network.
 *
 *   npx tsx scripts/ops/2026-player-props-canary.ts --game-id 18447937
 *   npx tsx scripts/ops/2026-player-props-canary.ts --execute --game-id 18447937
 *
 * Exactly one game id, exactly one fetchBdlLive request, no pagination.
 * Local process env only. Does not read Lambda, call the AWS CLI, write a database,
 * enqueue SQS, or print the response body.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import {
  assertNoSecret,
  canaryLimiterEnv,
  localKeyFromEnv,
  runPropsEntitlementCanary,
  singleFlag,
  wantsExecute,
} from '../../lib/balldontlie/entitlement-canaries';

loadEnv({ path: path.join(process.cwd(), '.env') });

async function main(): Promise<void> {
  const execute = wantsExecute(process.argv);
  const gameFlag = singleFlag(process.argv, '--game-id');
  const gameId = gameFlag.ok ? gameFlag.value : null;
  const key = execute ? localKeyFromEnv(process.env) : null;
  const result = await runPropsEntitlementCanary({
    execute: execute && gameFlag.ok,
    gameId,
    key,
    env: {
      ...canaryLimiterEnv('props-entitlement-canary'),
      BDL_RATE_LIMIT_TABLE: process.env.BDL_RATE_LIMIT_TABLE || 'nba-bdl-rate-limit',
    },
  });
  const printed =
    !gameFlag.ok && execute
      ? {
          ...result,
          EXECUTED: false,
          STOP_REASON: gameFlag.reason,
          ACCESS: 'NOT_EXECUTED' as const,
          gameId: null,
        }
      : result;
  const serialized = JSON.stringify(printed, null, 2);
  assertNoSecret(serialized, key);
  console.log(serialized);
  if (printed.STOP_REASON === 'missing_key') process.exitCode = 1;
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : 'props canary failed';
  console.error(message);
  process.exit(1);
});
