import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/auth/cron-auth';
import pool from '@/lib/db';
import { runPrunePropsJob } from '@/lib/prune/run-prune-props';

/**
 * GET /api/cron/prune-props
 *
 * Daily cron: optionally materialize closing lines, then prune retention-eligible
 * props rows. Destructive deletes require explicit opt-in env (PRUNE_ENABLED=1
 * plus live/in-season/non-dry-run). Auth: Bearer or ?secret= matching CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request, { secretEnvKeys: ['CRON_SECRET'] });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const result = await runPrunePropsJob({
    pool,
    authenticated: true,
  });

  if (result.httpStatus >= 500) {
    console.error('[cron/prune-props]', result.body);
  }

  return NextResponse.json(result.body, { status: result.httpStatus });
}
