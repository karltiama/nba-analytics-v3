import { NextRequest, NextResponse } from 'next/server';
import { getScheduleForTeam } from '@/lib/analytics/games-queries';
import { resolveAnalyticsTeamId, getTeamById } from '@/lib/teams/analytics-queries';

/**
 * GET /api/teams/[teamId]/schedule
 *
 * Returns the full schedule for a team from analytics.games (BDL source).
 * teamId can be analytics team_id or team abbreviation (e.g. NYK).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const season = searchParams.get('season') || null;
    const status = searchParams.get('status') || null;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : null;
    const upcoming = searchParams.get('upcoming') === 'true';
    const past = searchParams.get('past') === 'true';

    const analyticsTeamId = await resolveAnalyticsTeamId(teamId);
    if (!analyticsTeamId) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    let schedule = await getScheduleForTeam(analyticsTeamId, season ?? undefined);

    if (status) {
      schedule = schedule.filter((g) => g.status === status);
    }
    if (upcoming) {
      const now = new Date();
      schedule = schedule.filter((g) => !g.start_time || new Date(g.start_time) > now);
    } else if (past) {
      const now = new Date();
      schedule = schedule.filter((g) => g.start_time && new Date(g.start_time) <= now);
    }
    if (limit != null) {
      schedule = schedule.slice(0, limit);
    }

    const team = await getTeamById(analyticsTeamId);
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    const teamForApi = {
      team_id: team.team_id,
      abbreviation: team.abbreviation,
      full_name: team.full_name,
      city: team.city ?? undefined,
    };

    return NextResponse.json({
      team: teamForApi,
      season: season || 'all',
      total_games: schedule.length,
      schedule,
    });
  } catch (error: any) {
    console.error('Error fetching team schedule:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team schedule', message: error.message },
      { status: 500 }
    );
  }
}
