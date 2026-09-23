/**
 * Injury entitlement canary. Default is dry-run / no network.
 *
 *   npx tsx scripts/ops/bdl-injuries-entitlement-probe.ts
 *   npx tsx scripts/ops/bdl-injuries-entitlement-probe.ts --execute
 *
 * One GET, per_page=1, no pagination, no database, no Lambda key lookup.
 * Local .env only. Does not print the key or the response body.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import {
  assertNoSecret,
  localKeyFromEnv,
  runInjuryEntitlementCanary,
  wantsExecute,
} from '../../lib/balldontlie/entitlement-canaries';

loadEnv({ path: path.join(process.cwd(), '.env') });

async function main(): Promise<void> {
  const execute = wantsExecute(process.argv);
  const key = execute ? localKeyFromEnv(process.env) : null;
  const result = await runInjuryEntitlementCanary({ execute, key });
  const serialized = JSON.stringify(result, null, 2);
  assertNoSecret(serialized, key);
  console.log(serialized);
  if (result.STOP_REASON === 'missing_key') process.exitCode = 1;
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : 'injury canary failed';
  console.error(message);
  process.exit(1);
});
