import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { getMatchupAnalysis } from '@/lib/betting/queries';

/**
 * GET /api/betting/games/[gameId]/matchup-analysis
 * 
 * Returns matchup analysis for a game (analytics pace, projected starters).
 * BBRef-based rankings and key-player vs-opponent stats are not included.
 * Auth required (private betting API).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    const { gameId } = await params;

    const matchupAnalysis = await getMatchupAnalysis(gameId);

    if (!matchupAnalysis) {
      return NextResponse.json(
        { error: 'Game not found or no matchup data available' },
        { status: 404 }
      );
    }

    return NextResponse.json(matchupAnalysis);
  } catch (error: any) {
    console.error('Error fetching matchup analysis:', error);
    return NextResponse.json(
      { error: 'Failed to fetch matchup analysis', message: error.message },
      { status: 500 }
    );
  }
}















