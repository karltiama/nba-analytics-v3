import { NextRequest, NextResponse } from 'next/server';
import { getMatchupAnalysis } from '@/lib/betting/queries';

/**
 * GET /api/betting/games/[gameId]/matchup-analysis
 * 
 * Returns comprehensive matchup analysis for a game:
 * - Opponent defensive rankings
 * - Pace analysis
 * - Key player vs opponent stats
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
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




