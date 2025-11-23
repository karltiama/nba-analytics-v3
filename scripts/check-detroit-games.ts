import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    // Get Detroit team_id
    const detId = await pool.query(
      `SELECT team_id FROM teams WHERE abbreviation = 'DET' LIMIT 1`
    );
    
    if (detId.rows.length === 0) {
      console.log('❌ Detroit Pistons not found');
      return;
    }
    
    const teamId = detId.rows[0].team_id;
    console.log(`\n🏀 Detroit Pistons (team_id: ${teamId})\n`);
    
    // Check total games
    const totalGames = await pool.query(
      `SELECT COUNT(*) as count FROM bbref_team_game_stats WHERE team_id = $1`,
      [teamId]
    );
    console.log(`Total games in bbref_team_game_stats: ${totalGames.rows[0].count}`);
    
    // Check final games
    const finalGames = await pool.query(
      `SELECT COUNT(*) as count 
       FROM bbref_team_game_stats btgs 
       JOIN games g ON btgs.game_id = g.game_id 
       WHERE btgs.team_id = $1 AND g.status = 'Final'`,
      [teamId]
    );
    console.log(`Games with status='Final': ${finalGames.rows[0].count}`);
    
    // List all games
    const allGames = await pool.query(
      `SELECT btgs.game_id, g.start_time::date as game_date, g.status,
              ht.abbreviation as home_team, at.abbreviation as away_team
       FROM bbref_team_game_stats btgs
       JOIN games g ON btgs.game_id = g.game_id
       JOIN teams ht ON g.home_team_id = ht.team_id
       JOIN teams at ON g.away_team_id = at.team_id
       WHERE btgs.team_id = $1
       ORDER BY g.start_time DESC`,
      [teamId]
    );
    console.log(`\nAll Detroit games:`);
    allGames.rows.forEach((game: any, i: number) => {
      console.log(`  ${i + 1}. ${game.game_date} - ${game.game_id} - ${game.status} - ${game.away_team} @ ${game.home_team}`);
    });
    
    // Refresh materialized view
    console.log(`\n🔄 Refreshing materialized view...`);
    await pool.query('REFRESH MATERIALIZED VIEW bbref_team_season_stats');
    
    // Get stats from materialized view
    const stats = await pool.query(
      `SELECT games_played, avg_points, total_points, wins, losses
       FROM bbref_team_season_stats 
       WHERE team_id = $1`,
      [teamId]
    );
    
    if (stats.rows.length > 0) {
      console.log(`\n✅ Stats from materialized view:`);
      console.log(`   Games Played: ${stats.rows[0].games_played}`);
      console.log(`   Avg Points: ${Number(stats.rows[0].avg_points).toFixed(1)}`);
      console.log(`   Total Points: ${stats.rows[0].total_points}`);
      console.log(`   Record: ${stats.rows[0].wins}-${stats.rows[0].losses}`);
    } else {
      console.log(`\n⚠️  No stats found in materialized view for Detroit`);
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();


