import { NextRequest, NextResponse } from 'next/server';
import { runPaperSettlement } from '@/lib/betting/paper-settle-runner';

function cronSecret(): string | undefined {
  return process.env.PAPER_SETTLE_CRON_SECRET || process.env.CRON_SECRET;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const q = request.nextUrl.searchParams.get('secret');
  return bearer === secret || q === secret;
}

function runtimeMode() {
  const dataMode = (process.env.DATA_MODE || 'live_api').trim().toLowerCase();
  const offseason = process.env.OFFSEASON_MODE === '1';
  const cronDryRun = process.env.CRON_DRY_RUN === '1';
  const shouldSkipMutations = cronDryRun || offseason || dataMode !== 'live_api';
  return { dataMode, offseason, cronDryRun, shouldSkipMutations };
}

/**
 * GET /api/cron/paper-settle
 * Scheduled settlement (Vercel Cron or external curl). Requires Bearer or ?secret= matching
 * PAPER_SETTLE_CRON_SECRET or CRON_SECRET. In production, secret must be configured.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !cronSecret()) {
    return NextResponse.json(
      { ok: false, error: 'PAPER_SETTLE_CRON_SECRET or CRON_SECRET must be set in production' },
      { status: 503 }
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const mode = runtimeMode();
  if (mode.shouldSkipMutations) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Paper settlement skipped by runtime mode flags',
      dataMode: mode.dataMode,
      offseasonMode: mode.offseason,
      cronDryRun: mode.cronDryRun,
    });
  }

  try {
    const out = await runPaperSettlement();
    return NextResponse.json({
      ok: true,
      examined: out.examined,
      settled: out.settled,
      skippedNoBoxScore: out.skippedNoBoxScore,
      errors: out.errors,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const missing =
      message.includes('does not exist') &&
      (message.includes('paper.bets') || message.includes('research.v_player_game_outcomes'));
    console.error('[cron/paper-settle]', error);
    return NextResponse.json(
      {
        ok: false,
        error: missing
          ? 'Required relation missing. Apply paper_schema.sql and research views in Supabase.'
          : 'Settlement failed',
        message,
      },
      { status: missing ? 503 : 500 }
    );
  }
}
