import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  const gameId = '0022500256';
  
  console.log('=== Verifying BBRef Data ===\n');
  
  // Check bbref_games
  const bbrefGame = await pool.query(`
    SELECT bbref_game_id, game_date, home_team_abbr, away_team_abbr, home_score, away_score, status
    FROM bbref_games
    WHERE bbref_game_id LIKE '%20251119%CHO%IND%' OR bbref_game_id LIKE '%20251119%IND%CHO%'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  
  if (bbrefGame.rows.length > 0) {
    console.log('✅ Found bbref_games entry:');
    console.log(`   Game ID: ${bbrefGame.rows[0].bbref_game_id}`);
    console.log(`   Date: ${bbrefGame.rows[0].game_date}`);
    console.log(`   Teams: ${bbrefGame.rows[0].away_team_abbr} @ ${bbrefGame.rows[0].home_team_abbr}`);
    console.log(`   Score: ${bbrefGame.rows[0].away_score} - ${bbrefGame.rows[0].home_score}`);
    console.log(`   Status: ${bbrefGame.rows[0].status}`);
    
    const bbrefGameId = bbrefGame.rows[0].bbref_game_id;
    
    // Check bbref_player_game_stats
    const playerStats = await pool.query(`
      SELECT COUNT(*) as count, 
             COUNT(DISTINCT player_id) as unique_players,
             SUM(points) as total_points
      FROM bbref_player_game_stats
      WHERE game_id = $1
    `, [bbrefGameId]);
    
    if (playerStats.rows.length > 0) {
      console.log(`\n✅ Found bbref_player_game_stats:`);
      console.log(`   Total rows: ${playerStats.rows[0].count}`);
      console.log(`   Unique players: ${playerStats.rows[0].unique_players}`);
      console.log(`   Total points: ${playerStats.rows[0].total_points}`);
      
      // Show sample players
      const samplePlayers = await pool.query(`
        SELECT p.full_name, bpgs.points, bpgs.rebounds, bpgs.assists, 
               bpgs.offensive_rebounds, bpgs.defensive_rebounds, bpgs.personal_fouls
        FROM bbref_player_game_stats bpgs
        JOIN players p ON bpgs.player_id = p.player_id
        WHERE bpgs.game_id = $1
        ORDER BY bpgs.points DESC
        LIMIT 5
      `, [bbrefGameId]);
      
      if (samplePlayers.rows.length > 0) {
        console.log(`\n   Sample players:`);
        samplePlayers.rows.forEach(p => {
          console.log(`     ${p.full_name}: ${p.points} pts, ${p.rebounds} reb, ${p.assists} ast (ORB: ${p.offensive_rebounds}, DRB: ${p.defensive_rebounds}, PF: ${p.personal_fouls})`);
        });
      }
    }
  } else {
    console.log('❌ No bbref_games entry found');
  }
  
  await pool.end();
}

main();

