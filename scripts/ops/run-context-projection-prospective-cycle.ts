/**
 * Ops-only: run one context-projection prospective score+settle cycle.
 * Does not backfill history. Does not compute MAE.
 *
 * Requires env:
 *   SUPABASE_DB_URL
 *   DATA_MODE=live_api (or whatever enables shouldSkipLiveMutations=false)
 *   CONTEXT_PTS_SHADOW_WRITES=1 and/or CONTEXT_MIN_SHADOW_WRITES=1
 *   CONTEXT_PROSPECTIVE_WINDOW_OPENED_AT (optional; default MIN arm time)
 *
 *   npx tsx scripts/ops/run-context-projection-prospective-cycle.ts
 */

import { config } from 'dotenv';
import { Pool } from 'pg';
import { runContextProspectiveCycle } from '@/lib/context-projection/collection-worker';
import { loadDualProspectiveStatus, formatProspectiveStatusText } from '@/lib/context-projection/status';

config();

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL required');

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const result = await runContextProspectiveCycle({
      now: () => new Date(),
      db: pool,
      env: process.env,
      log: (msg) => console.log(msg),
    });
    console.log(JSON.stringify(result, null, 2));

    const status = await loadDualProspectiveStatus(pool, {
      env: process.env,
      scheduleConfigured: process.env.CONTEXT_PROSPECTIVE_SCHEDULE_CONFIGURED === '1',
    });
    console.log(formatProspectiveStatusText(status));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
