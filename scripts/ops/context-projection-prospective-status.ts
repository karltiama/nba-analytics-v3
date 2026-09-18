/**
 * Ops-only: dual prospective progress (no MAE / ΔMAE / CI).
 *   npx tsx scripts/ops/context-projection-prospective-status.ts
 */

import { config } from 'dotenv';
import { Pool } from 'pg';
import {
  formatProspectiveStatusText,
  loadDualProspectiveStatus,
} from '@/lib/context-projection/status';
import {
  FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA,
  AUX_MIN_PROSPECTIVE_WINDOW,
  PROSPECTIVE_MIN_REQUIRED_N,
} from '@/lib/context-projection/min/protocol';
import {
  PROSPECTIVE_WINDOW_ID,
  PROSPECTIVE_REQUIRED_N,
} from '@/lib/context-projection/protocol';
import { readFileSync } from 'fs';
import { join } from 'path';

config();

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL required');

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const scheduleConfigured =
      process.env.CONTEXT_PROSPECTIVE_SCHEDULE_CONFIGURED === '1' ||
      process.env.CONTEXT_PROSPECTIVE_SCHEDULE_CONFIGURED === 'true';

    const status = await loadDualProspectiveStatus(pool, {
      env: process.env,
      scheduleConfigured,
    });

    const ptsArt = JSON.parse(
      readFileSync(
        join(process.cwd(), 'lib/context-projection/artifacts/pts-production-context-prospective-window-v1.json'),
        'utf8'
      )
    );
    const minArt = JSON.parse(
      readFileSync(
        join(process.cwd(), 'lib/context-projection/artifacts/aux-min-model_artifact.json'),
        'utf8'
      )
    );

    console.log(formatProspectiveStatusText(status));
    console.log('');
    console.log(
      JSON.stringify(
        {
          PTS_COLLECTION_RUNTIME_STATUS: status.pts.state,
          PTS_CURRENT_N: status.pts.eligibleN,
          PTS_REQUIRED_N: PROSPECTIVE_REQUIRED_N,
          PTS_MODEL_SHA: ptsArt.model_artifact_sha,
          PTS_WINDOW: PROSPECTIVE_WINDOW_ID,
          MIN_COLLECTION_RUNTIME_STATUS: status.min.state,
          MIN_PREGAME_N: status.min.pregameJointN,
          MIN_RESOLVED_PLAYED_N: status.min.resolvedPlayedN,
          MIN_RESOLVED_DNP_N: status.min.resolvedDnpN,
          MIN_UNRESOLVED_N: status.min.unresolvedN,
          MIN_FINALIZED_PRIMARY_N: status.min.finalizedPrimaryN,
          MIN_REQUIRED_N: PROSPECTIVE_MIN_REQUIRED_N,
          MIN_MODEL_SHA: minArt.model_artifact_sha,
          MIN_WINDOW: AUX_MIN_PROSPECTIVE_WINDOW,
          FROZEN_MIN_SHA_MATCH: minArt.model_artifact_sha === FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA,
          note: 'NO_PERFORMANCE_METRICS',
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
