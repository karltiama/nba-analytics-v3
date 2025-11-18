import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/teams/[teamId]/schedule
 * 
 * Returns the full schedule for a team, including:
 * - All games (past and future)
 * - Home/away indicator
 * - Opponent info
 * - Game status and scores
 * - Date/time
 * 
 * Query params:
 *   - season: Filter by season (e.g., '2025-26')
 *   - status: Filter by status (e.g., 'Scheduled', 'Final', 'InProgress')
 *   - limit: Limit results (default: all)
 *   - upcoming: If 'true', only return future games
 *   - past: If 'true', only return past games
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

    let sql = `
      select 
        g.game_id,
        g.season,
        g.start_time,
        g.status,
        g.home_score,
        g.away_score,
        g.venue,
        -- Home team info
        ht.team_id as home_team_id,
        ht.abbreviation as home_team_abbr,
        ht.full_name as home_team_name,
        -- Away team info
        at.team_id as away_team_id,
        at.abbreviation as away_team_abbr,
        at.full_name as away_team_name,
        -- Determine if this team is home or away
        case 
          when g.home_team_id = $1 then 'home'
          else 'away'
        end as is_home,
        -- Opponent info
        case 
          when g.home_team_id = $1 then at.team_id
          else ht.team_id
        end as opponent_id,
        case 
          when g.home_team_id = $1 then at.abbreviation
          else ht.abbreviation
        end as opponent_abbr,
        case 
          when g.home_team_id = $1 then at.full_name
          else ht.full_name
        end as opponent_name,
        -- Team's score
        case 
          when g.home_team_id = $1 then g.home_score
          else g.away_score
        end as team_score,
        -- Opponent's score
        case 
          when g.home_team_id = $1 then g.away_score
          else g.home_score
        end as opponent_score,
        -- Win/Loss indicator (null if game not finished)
        case 
          when g.status = 'Final' and g.home_team_id = $1 and g.home_score > g.away_score then 'W'
          when g.status = 'Final' and g.home_team_id = $1 and g.home_score < g.away_score then 'L'
          when g.status = 'Final' and g.away_team_id = $1 and g.away_score > g.home_score then 'W'
          when g.status = 'Final' and g.away_team_id = $1 and g.away_score < g.home_score then 'L'
          else null
        end as result
      from games g
      join teams ht on g.home_team_id = ht.team_id
      join teams at on g.away_team_id = at.team_id
      where (g.home_team_id = $1 or g.away_team_id = $1)
    `;

    const params_array: any[] = [teamId];
    let paramCount = 2;

    if (season) {
      sql += ` and g.season = $${paramCount}`;
      params_array.push(season);
      paramCount++;
    }

    if (status) {
      sql += ` and g.status = $${paramCount}`;
      params_array.push(status);
      paramCount++;
    }

    if (upcoming) {
      sql += ` and g.start_time > now()`;
    } else if (past) {
      sql += ` and g.start_time <= now()`;
    }

    sql += ` order by g.start_time asc`;

    if (limit) {
      sql += ` limit $${paramCount}`;
      params_array.push(limit);
    }

    const schedule = await query(sql, params_array);

    // Get team info for context
    const teamInfo = await query(
      `select team_id, abbreviation, full_name, city from teams where team_id = $1`,
      [teamId]
    );

    if (teamInfo.length === 0) {
      return NextResponse.json(
        { error: 'Team not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      team: teamInfo[0],
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

