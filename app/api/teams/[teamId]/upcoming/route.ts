import { NextRequest, NextResponse } from 'next/server';
import { getBBRefUpcomingGames } from '@/lib/teams/bbref-queries';

/**
 * GET /api/teams/[teamId]/upcoming
 * 
 * Fetches upcoming games for a team
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '5');

    const upcomingGames = await getBBRefUpcomingGames(teamId, limit);

    return NextResponse.json({
      games: upcomingGames,
    });
  } catch (error: any) {
    console.error('Error fetching upcoming games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch upcoming games', message: error.message },
      { status: 500 }
    );
  }
}











