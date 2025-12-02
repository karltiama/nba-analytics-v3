import { NextRequest, NextResponse } from 'next/server';
import {
  getBBRefSeasonStats,
  getBBRefTeamRankings,
  getBBRefSplits,
  getBBRefRecentForm,
  getBBRefQuarterStrengths,
  getBBRefSeasonRecord,
} from '@/lib/teams/bbref-queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const season = searchParams.get('season') || null;

    // Get all stats from BBRef tables
    const [seasonStats, rankings, splits, recentForm, quarterStrengths, seasonRecord] = await Promise.all([
      getBBRefSeasonStats(teamId, season),
      getBBRefTeamRankings(teamId, season),
      getBBRefSplits(teamId, season),
      getBBRefRecentForm(teamId, season),
      getBBRefQuarterStrengths(teamId, season),
      getBBRefSeasonRecord(teamId, season),
    ]);

    return NextResponse.json({
      team_id: teamId,
      season: season || 'all',
      season_stats: seasonStats,
      season_record: seasonRecord,
      rankings,
      splits,
      recent_form: recentForm,
      quarter_strengths: quarterStrengths,
    });
  } catch (error: any) {
    console.error('Error fetching team stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team stats', message: error.message },
      { status: 500 }
    );
  }
}
