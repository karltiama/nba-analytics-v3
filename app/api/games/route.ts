import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50');
    const date = searchParams.get('date');
    const status = searchParams.get('status'); // 'Final', 'Scheduled', etc.

    let sql = `
      select 
        g.game_id,
        g.season,
        g.start_time,
        g.status,
        g.home_score,
        g.away_score,
        g.venue,
        ht.abbreviation as home_team_abbr,
        ht.full_name as home_team_name,
        at.abbreviation as away_team_abbr,
        at.full_name as away_team_name
      from games g
      join teams ht on g.home_team_id = ht.team_id
      join teams at on g.away_team_id = at.team_id
      where 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (date) {
      sql += ` and g.start_time::date = $${paramCount}::date`;
      params.push(date);
      paramCount++;
    }

    if (status) {
      sql += ` and g.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    sql += ` order by g.start_time desc limit $${paramCount}`;
    params.push(limit);

    const games = await query(sql, params);

    return NextResponse.json({ games });
  } catch (error: any) {
    console.error('Error fetching games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games', message: error.message },
      { status: 500 }
    );
  }
}

