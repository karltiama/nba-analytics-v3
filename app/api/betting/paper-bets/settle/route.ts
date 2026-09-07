import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { runPaperSettlement } from '@/lib/betting/paper-settle-runner';

/**
 * POST /api/betting/paper-bets/settle
 * Settles the authenticated user's open bets whose games are Final.
 * Cross-user settlement is cron-only (`/api/cron/paper-settle`).
 */
export async function POST(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    const out = await runPaperSettlement({ userId: gate.auth.userId });
    return gate.withAuthCookies(
      NextResponse.json({
        ok: true,
        examined: out.examined,
        settled: out.settled,
        skippedNoBoxScore: out.skippedNoBoxScore,
        errors: out.errors,
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const missing =
      message.includes('does not exist') &&
      (message.includes('paper.bets') || message.includes('research.v_player_game_outcomes'));
    console.error('[paper-bets/settle]', error);
    return gate.withAuthCookies(
      NextResponse.json(
        {
          ok: false,
          error: missing
            ? 'Required relation missing. Apply paper_schema.sql and research views in Supabase.'
            : 'Settlement failed',
          message,
        },
        { status: missing ? 503 : 500 }
      )
    );
  }
}
