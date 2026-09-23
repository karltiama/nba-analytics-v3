/**
 * Game-odds entitlement canary. Default is dry-run / no network.
 *
 *   npx tsx scripts/ops/2026-odds-canary.ts --date 2026-10-22
 *   npx tsx scripts/ops/2026-odds-canary.ts --execute --date 2026-10-22
 *
 * One date, at most 2 requests, fetchBdlLive, in-memory shape check only.
 * No analytics upsert and no schedule change. Local .env key only.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import {
  assertNoSecret,
  canaryLimiterEnv,
  localKeyFromEnv,
  runOddsEntitlementCanary,
  singleFlag,
  wantsExecute,
} from '../../lib/balldontlie/entitlement-canaries';

loadEnv({ path: path.join(process.cwd(), '.env') });

async function main(): Promise<void> {
  const execute = wantsExecute(process.argv);
  const dateFlag = singleFlag(process.argv, '--date');
  const date = dateFlag.ok ? dateFlag.value : null;
  const key = execute ? localKeyFromEnv(process.env) : null;
  const result = await runOddsEntitlementCanary({
    execute: execute && dateFlag.ok,
    date,
    key,
    env: {
      ...canaryLimiterEnv('odds-entitlement-canary'),
      BDL_RATE_LIMIT_TABLE: process.env.BDL_RATE_LIMIT_TABLE || 'nba-bdl-rate-limit',
    },
  });
  const printed =
    !dateFlag.ok && execute
      ? { ...result, EXECUTED: false, STOP_REASON: dateFlag.reason, ACCESS: 'NOT_EXECUTED' as const }
      : result;
  const serialized = JSON.stringify(printed, null, 2);
  assertNoSecret(serialized, key);
  console.log(serialized);
  if (printed.STOP_REASON === 'missing_key' || printed.upserts !== 0) process.exitCode = 1;
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : 'odds canary failed';
  console.error(message);
  process.exit(1);
});
