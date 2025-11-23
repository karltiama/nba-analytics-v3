import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Checking Missing Games from BBRef Schedule\n');
    console.log('='.repeat(100));
    
    // Find games in bbref_schedule that don't exist in games table
    const missingGames = await pool.query(`
      SELECT 
        bs.bbref_game_id,
        bs.game_date,
        bs.home_team_abbr,
        bs.away_team_abbr,
        bs.canonical_game_id,
        bs.home_team_id,
        bs.away_team_id,
        CASE WHEN g.game_id IS NULL THEN 'MISSING' ELSE 'EXISTS' END as status
      FROM bbref_schedule bs
      LEFT JOIN games g ON bs.canonical_game_id = g.game_id
      WHERE bs.canonical_game_id IS NOT NULL
        AND g.game_id IS NULL
        AND bs.game_date BETWEEN '2025-10-21' AND '2025-11-21'
      ORDER BY bs.game_date, bs.home_team_abbr
    `);
    
    console.log(`\nFound ${missingGames.rows.length} games in schedule but NOT in games table:\n`);
    
    // Group by date
    const byDate = new Map<string, any[]>();
    missingGames.rows.forEach((row: any) => {
      const dateKey = row.game_date.toISOString().split('T')[0];
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, []);
      }
      byDate.get(dateKey)!.push(row);
    });
    
    // Show first 20 dates
    let count = 0;
    for (const [date, games] of Array.from(byDate.entries()).sort().slice(0, 20)) {
      console.log(`\n📅 ${date} (${games.length} games):`);
      games.forEach((g: any) => {
        count++;
        if (count <= 50) {
          console.log(`  - ${g.away_team_abbr} @ ${g.home_team_abbr} (${g.canonical_game_id})`);
        }
      });
      if (count > 50) {
        console.log(`  ... and ${missingGames.rows.length - 50} more`);
        break;
      }
    }
    
    // Check specifically for Nov 1 DAL @ DET
    console.log('\n\n🎯 SPECIFIC CHECK: Nov 1 DAL @ DET');
    console.log('-'.repeat(100));
    
    const specificCheck = await pool.query(`
      SELECT 
        bs.*,
        CASE WHEN g.game_id IS NULL THEN 'MISSING' ELSE 'EXISTS' END as in_games_table,
        CASE WHEN bpgs.game_id IS NULL THEN 'MISSING' ELSE 'EXISTS' END as in_player_stats,
        CASE WHEN btgs.game_id IS NULL THEN 'MISSING' ELSE 'EXISTS' END as in_team_stats
      FROM bbref_schedule bs
      LEFT JOIN games g ON bs.canonical_game_id = g.game_id
      LEFT JOIN bbref_player_game_stats bpgs ON bs.canonical_game_id = bpgs.game_id
      LEFT JOIN bbref_team_game_stats btgs ON bs.canonical_game_id = btgs.game_id
      WHERE bs.game_date = '2025-11-01'
        AND bs.home_team_abbr = 'DET'
        AND bs.away_team_abbr = 'DAL'
    `);
    
    if (specificCheck.rows.length > 0) {
      const game = specificCheck.rows[0];
      console.log(`BBRef ID: ${game.bbref_game_id}`);
      console.log(`Canonical ID: ${game.canonical_game_id}`);
      console.log(`In games table: ${game.in_games_table}`);
      console.log(`In player stats: ${game.in_player_stats}`);
      console.log(`In team stats: ${game.in_team_stats}`);
      
      if (game.in_games_table === 'MISSING') {
        console.log('\n❌ PROBLEM: Game exists in schedule but NOT in games table!');
        console.log('   This means the game needs to be created in the games table first.');
        console.log('   Then player stats can be populated, then team stats.');
      }
    } else {
      console.log('Game not found in bbref_schedule');
    }
    
    console.log('\n' + '='.repeat(100));
    console.log(`\n💡 SUMMARY: ${missingGames.rows.length} games need to be created in games table`);
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();




