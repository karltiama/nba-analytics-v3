import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    const detId = await pool.query(
      `SELECT team_id FROM teams WHERE abbreviation = 'DET' LIMIT 1`
    );
    const teamId = detId.rows[0].team_id;
    
    console.log('\n📊 BBREF TABLES EXPLANATION\n');
    console.log('='.repeat(80));
    
    console.log('\n1️⃣ BBREF_PLAYER_GAME_STATS');
    console.log('   Purpose: Individual player stats per game');
    console.log('   Structure: One row per player per game');
    console.log('   Example: Cade Cunningham\'s stats for Game 1, Jalen Duren\'s stats for Game 1, etc.');
    
    const playerStats = await pool.query(`
      SELECT COUNT(DISTINCT game_id) as games, COUNT(*) as total_rows
      FROM bbref_player_game_stats
      WHERE team_id = $1
    `, [teamId]);
    console.log(`\n   Detroit: ${playerStats.rows[0].games} games, ${playerStats.rows[0].total_rows} player-game rows`);
    
    console.log('\n2️⃣ BBREF_TEAM_GAME_STATS');
    console.log('   Purpose: Aggregated team stats per game');
    console.log('   Structure: One row per team per game (sum of all players)');
    console.log('   Example: Detroit Pistons total stats for Game 1 (sum of all Detroit players)');
    console.log('   Source: Aggregated FROM bbref_player_game_stats');
    
    const teamStats = await pool.query(`
      SELECT COUNT(DISTINCT game_id) as games, COUNT(*) as total_rows
      FROM bbref_team_game_stats
      WHERE team_id = $1
    `, [teamId]);
    console.log(`\n   Detroit: ${teamStats.rows[0].games} games, ${teamStats.rows[0].total_rows} team-game rows`);
    
    console.log('\n3️⃣ RELATIONSHIP');
    console.log('   bbref_player_game_stats → (aggregate) → bbref_team_game_stats');
    console.log('   Multiple player rows → One team row per game');
    
    // Show an example
    console.log('\n4️⃣ EXAMPLE - One Game');
    console.log('-'.repeat(80));
    const exampleGame = await pool.query(`
      SELECT btgs.game_id, g.start_time::date as game_date
      FROM bbref_team_game_stats btgs
      JOIN games g ON btgs.game_id = g.game_id
      WHERE btgs.team_id = $1
      ORDER BY g.start_time DESC
      LIMIT 1
    `, [teamId]);
    
    if (exampleGame.rows.length > 0) {
      const gameId = exampleGame.rows[0].game_id;
      const gameDate = exampleGame.rows[0].game_date;
      
      const players = await pool.query(`
        SELECT p.full_name, bpgs.points, bpgs.rebounds, bpgs.assists
        FROM bbref_player_game_stats bpgs
        JOIN players p ON bpgs.player_id = p.player_id
        WHERE bpgs.game_id = $1 AND bpgs.team_id = $2
        ORDER BY bpgs.points DESC
        LIMIT 5
      `, [gameId, teamId]);
      
      const team = await pool.query(`
        SELECT points, rebounds, assists
        FROM bbref_team_game_stats
        WHERE game_id = $1 AND team_id = $2
      `, [gameId, teamId]);
      
      console.log(`\n   Game: ${gameId} (${gameDate})`);
      console.log(`\n   Player Stats (sample):`);
      players.rows.forEach((p: any) => {
        console.log(`     ${p.full_name}: ${p.points} PTS, ${p.rebounds} REB, ${p.assists} AST`);
      });
      
      if (team.rows.length > 0) {
        const t = team.rows[0];
        console.log(`\n   Team Stats (aggregated):`);
        console.log(`     Total: ${t.points} PTS, ${t.rebounds} REB, ${t.assists} AST`);
        console.log(`     (Sum of all players above)`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();

