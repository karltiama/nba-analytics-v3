/**
 * Deployable context-projection dual prospective shadow Lambda (PTS + MIN).
 * Fail-closed: writes require CONTEXT_*_SHADOW_WRITES=1 and live ingestion mode.
 * Does NOT touch Props Explorer. Does NOT compute MAE.
 *
 * Event: { action?: 'score' | 'settle' | 'cycle' | 'status' }
 */

import { Pool } from 'pg';
import {
  runContextProspectiveCycle,
  runContextProspectiveScoreCycle,
  runContextProspectiveSettleCycle,
} from '@/lib/context-projection/collection-worker';
import {
  formatProspectiveStatusText,
  loadDualProspectiveStatus,
} from '@/lib/context-projection/status';

const pool = new Pool({
  connectionString: (process.env.SUPABASE_DB_URL || '').trim(),
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

export async function handler(event: { action?: string } = {}): Promise<{
  statusCode: number;
  body: string;
}> {
  if (!process.env.SUPABASE_DB_URL) {
    return { statusCode: 500, body: JSON.stringify({ error: 'missing SUPABASE_DB_URL' }) };
  }

  const action =
    event.action === 'settle'
      ? 'settle'
      : event.action === 'score'
        ? 'score'
        : event.action === 'status'
          ? 'status'
          : 'cycle';

  const ports = {
    now: () => new Date(),
    db: pool,
    env: process.env,
    log: (msg: string, extra?: Record<string, unknown>) => {
      console.log(JSON.stringify({ msg, ...extra }));
    },
  };

  try {
    if (action === 'status') {
      const status = await loadDualProspectiveStatus(pool, {
        env: process.env,
        scheduleConfigured: process.env.CONTEXT_PROSPECTIVE_SCHEDULE_CONFIGURED === '1',
      });
      return {
        statusCode: 200,
        body: JSON.stringify({
          text: formatProspectiveStatusText(status),
          status,
        }),
      };
    }

    if (action === 'score') {
      const score = await runContextProspectiveScoreCycle(ports);
      return { statusCode: 200, body: JSON.stringify({ action, score }) };
    }
    if (action === 'settle') {
      const settle = await runContextProspectiveSettleCycle(ports);
      return { statusCode: 200, body: JSON.stringify({ action, settle }) };
    }

    const cycle = await runContextProspectiveCycle(ports);
    return { statusCode: 200, body: JSON.stringify({ action: 'cycle', ...cycle }) };
  } catch (err) {
    // Fail closed for research — never escalate to production serving.
    console.error('context-prospective-shadow failure', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        SHADOW_RUNTIME_FAILURE_ISOLATION: 'contained',
      }),
    };
  }
}
