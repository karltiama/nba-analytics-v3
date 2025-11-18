import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { gameId: string } }
) {
  try {
    const { gameId } = params;

    // Get game info
    const game = await query(`
      select 
        g.game_id,
        g.season,
        g.start_time,
        g.status,
        g.home_score,
        g.away_score,
        g.venue,
        ht.team_id as home_team_id,
        ht.abbreviation as home_team_abbr,
        ht.full_name as home_team_name,
        at.team_id as away_team_id,
        at.abbreviation as away_team_abbr,
        at.full_name as away_team_name
      from games g
      join teams ht on g.home_team_id = ht.team_id
      join teams at on g.away_team_id = at.team_id
      where g.game_id = $1
    `, [gameId]);

    if (game.length === 0) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    // Get box score - check both the game_id directly and any related game IDs from provider mappings
    // This handles cases where games are stored with BDL IDs but box scores use NBA Stats IDs
    const boxscore = await query(`
      with related_game_ids as (
        -- If game_id matches an internal_id, get all provider_ids for that internal_id
        select distinct provider_id as game_id
        from provider_id_map
        where entity_type = 'game' and internal_id = $1
        union
        -- If game_id matches a provider_id, get the internal_id
        select distinct internal_id as game_id
        from provider_id_map
        where entity_type = 'game' and provider_id = $1
        union
        -- Also include the original game_id itself
        select $1::text as game_id
      )
      select 
        pgs.*,
        p.full_name as player_name,
        p.first_name,
        p.last_name,
        t.abbreviation as team_abbr,
        t.full_name as team_name
      from player_game_stats pgs
      join players p on pgs.player_id = p.player_id
      join teams t on pgs.team_id = t.team_id
      join related_game_ids rgi on pgs.game_id = rgi.game_id
      order by t.team_id, pgs.points desc nulls last
    `, [gameId]);

    return NextResponse.json({
      game: game[0],
      boxscore,
    });
  } catch (error: any) {
    console.error('Error fetching box score:', error);
    return NextResponse.json(
      { error: 'Failed to fetch box score', message: error.message },
      { status: 500 }
    );
  }
}

