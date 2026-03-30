import { NextResponse } from 'next/server';
import { runPaperSettlement } from '@/lib/betting/paper-settle-runner';

/**
 * POST /api/betting/paper-bets/settle
 * Settles open bets whose games are Final and player has box score in research.v_player_game_outcomes.
 */
export async function POST() {
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
    console.error('[paper-bets/settle]', error);
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
