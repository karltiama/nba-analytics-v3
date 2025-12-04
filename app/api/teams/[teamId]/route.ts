import { NextRequest, NextResponse } from 'next/server';
import { getTeamInfo } from '@/lib/teams/queries';

/**
 * GET /api/teams/[teamId]
 * 
 * Fetches basic team information
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const team = await getTeamInfo(teamId);

    if (!team) {
      return NextResponse.json(
        { error: 'Team not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(team);
  } catch (error: any) {
    console.error('Error fetching team:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team', message: error.message },
      { status: 500 }
    );
  }
}











