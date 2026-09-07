import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { listPaperAnalyticsForUser } from '@/lib/betting/paper-bets-queries';

/**
 * GET /api/betting/paper-bets/analytics
 * Settled-bet aggregates for the authenticated user only.
 */
export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;
  try {
    const analytics = await listPaperAnalyticsForUser(gate.auth.userId);
    return gate.withAuthCookies(NextResponse.json(analytics));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const missing = message.includes('paper.bets') && message.includes('does not exist');
    console.error('[paper-bets/analytics]', error);
    return gate.withAuthCookies(
      NextResponse.json(
        {
          error: missing
            ? 'Paper bets table missing. Apply db/schemas/paper_schema.sql in Supabase.'
            : 'Failed to load analytics',
          message,
          byPropType: [],
          byConfidence: [],
          byCalibration: [],
          byEvBucket: [],
        },
        { status: missing ? 503 : 500 }
      )
    );
  }
}
