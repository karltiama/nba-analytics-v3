import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50');
    const season = searchParams.get('season');
    const minGames = parseInt(searchParams.get('minGames') || '1');

    let sql = `
      select 
        p.player_id,
        p.full_name,
        p.first_name,
        p.last_name,
        count(distinct pgs.game_id) as games_played,
        sum(pgs.points) as total_points,
        avg(pgs.points) as avg_points,
        sum(pgs.rebounds) as total_rebounds,
        avg(pgs.rebounds) as avg_rebounds,
        sum(pgs.assists) as total_assists,
        avg(pgs.assists) as avg_assists,
        sum(pgs.steals) as total_steals,
        avg(pgs.steals) as avg_steals,
        sum(pgs.blocks) as total_blocks,
        avg(pgs.blocks) as avg_blocks,
        sum(pgs.turnovers) as total_turnovers,
        avg(pgs.turnovers) as avg_turnovers,
        sum(pgs.field_goals_made) as total_fgm,
        sum(pgs.field_goals_attempted) as total_fga,
        sum(pgs.three_pointers_made) as total_3pm,
        sum(pgs.three_pointers_attempted) as total_3pa,
        sum(pgs.free_throws_made) as total_ftm,
        sum(pgs.free_throws_attempted) as total_fta,
        avg(pgs.minutes) as avg_minutes
      from players p
      join player_game_stats pgs on p.player_id = pgs.player_id
      join games g on pgs.game_id = g.game_id
      where 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (season) {
      sql += ` and g.season = $${paramCount}`;
      params.push(season);
      paramCount++;
    }

    sql += ` 
      group by p.player_id, p.full_name, p.first_name, p.last_name
      having count(distinct pgs.game_id) >= $${paramCount}
      order by avg_points desc nulls last
      limit $${paramCount + 1}
    `;
    params.push(minGames, limit);

    const stats = await query(sql, params);

    return NextResponse.json({ stats });
  } catch (error: any) {
    console.error('Error fetching player stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch player stats', message: error.message },
      { status: 500 }
    );
  }
}

