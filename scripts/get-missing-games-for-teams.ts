import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function getMissingGames() {
  const targetTeams = ['GSW', 'OKC', 'SAC', 'ATL'];
  
  console.log('\n🔍 Finding Missing Games for Teams Below 100%\n');
  
  for (const abbr of targetTeams) {
    const team = await pool.query(`SELECT team_id FROM teams WHERE abbreviation = $1`, [abbr]);
    if (team.rows.length === 0) continue;
    
    const teamId = team.rows[0].team_id;
    
    const missing = await pool.query(`
      SELECT 
        bg.bbref_game_id,
        bg.game_date::text as game_date,
        CASE 
          WHEN bg.home_team_id = $1 THEN ht.abbreviation
          ELSE at.abbreviation
        END as opponent,
        bg.home_team_id = $1 as is_home,
        bg.status
      FROM bbref_games bg
      LEFT JOIN teams ht ON bg.home_team_id = ht.team_id
      LEFT JOIN teams at ON bg.away_team_id = at.team_id
      WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
        AND bg.game_date <= CURRENT_DATE
        AND bg.status = 'Final'
        AND NOT EXISTS (
          SELECT 1 FROM bbref_team_game_stats btgs
          WHERE btgs.game_id = bg.bbref_game_id
            AND btgs.team_id = $1
        )
      ORDER BY bg.game_date ASC
    `, [teamId]);
    
    if (missing.rows.length > 0) {
      console.log(`${abbr} - Missing ${missing.rows.length} game(s):`);
      missing.rows.forEach((game: any) => {
        const vs = game.is_home ? 'vs' : '@';
        console.log(`   - ${game.game_date} ${vs} ${game.opponent} (${game.bbref_game_id})`);
      });
      console.log('');
    }
  }
  
  // Get all unique missing game IDs
  const allMissing = await pool.query(`
    SELECT DISTINCT bg.bbref_game_id
    FROM bbref_games bg
    WHERE bg.game_date <= CURRENT_DATE
      AND bg.status = 'Final'
      AND NOT EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs
        WHERE btgs.game_id = bg.bbref_game_id
      )
    ORDER BY bg.bbref_game_id
  `);
  
  if (allMissing.rows.length > 0) {
    const gameIds = allMissing.rows.map((r: any) => r.bbref_game_id);
    console.log(`\n💡 Total unique games missing stats: ${gameIds.length}`);
    console.log(`\nTo scrape these games, run:`);
    console.log(`   npx tsx scripts/batch-scrape-missing-bbref-games.ts --game-ids ${gameIds.join(',')}`);
  } else {
    console.log(`\n✅ All completed games have stats!`);
  }
  
  await pool.end();
}

getMissingGames();


