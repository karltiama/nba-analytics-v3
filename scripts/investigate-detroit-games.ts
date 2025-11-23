import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    const detId = await pool.query(
      `SELECT team_id FROM teams WHERE abbreviation = 'DET' LIMIT 1`
    );
    
    if (detId.rows.length === 0) {
      console.log('❌ Detroit Pistons not found');
      return;
    }
    
    const teamId = detId.rows[0].team_id;
    console.log(`\n🏀 Detroit Pistons Investigation (team_id: ${teamId})\n`);
    console.log('='.repeat(80));
    
    // 1. Check scraped_boxscores
    console.log('\n1️⃣ SCRAPED_BOXSCORES');
    console.log('-'.repeat(80));
    const scraped = await pool.query(`
      SELECT 
        COUNT(DISTINCT game_id) as unique_games,
        COUNT(*) as total_rows,
        MIN(game_date) as first_game,
        MAX(game_date) as last_game
      FROM scraped_boxscores
      WHERE team_code = 'DET' AND source = 'bbref_csv'
    `);
    console.log(`Unique games: ${scraped.rows[0].unique_games}`);
    console.log(`Total rows: ${scraped.rows[0].total_rows}`);
    console.log(`Date range: ${scraped.rows[0].first_game} to ${scraped.rows[0].last_game}`);
    
    // List games in scraped_boxscores
    const scrapedGames = await pool.query(`
      SELECT DISTINCT game_id, game_date, COUNT(*) as player_rows
      FROM scraped_boxscores
      WHERE team_code = 'DET' AND source = 'bbref_csv'
      GROUP BY game_id, game_date
      ORDER BY game_date DESC
    `);
    console.log(`\nGames in scraped_boxscores:`);
    scrapedGames.rows.forEach((g: any, i: number) => {
      console.log(`  ${i + 1}. ${g.game_date} - ${g.game_id} (${g.player_rows} player rows)`);
    });
    
    // 2. Check bbref_player_game_stats
    console.log('\n2️⃣ BBREF_PLAYER_GAME_STATS');
    console.log('-'.repeat(80));
    const playerStats = await pool.query(`
      SELECT 
        COUNT(DISTINCT game_id) as unique_games,
        COUNT(*) as total_rows
      FROM bbref_player_game_stats
      WHERE team_id = $1
    `, [teamId]);
    console.log(`Unique games: ${playerStats.rows[0].unique_games}`);
    console.log(`Total rows: ${playerStats.rows[0].total_rows}`);
    
    const playerGames = await pool.query(`
      SELECT DISTINCT bpgs.game_id, g.start_time::date as game_date, COUNT(*) as player_rows
      FROM bbref_player_game_stats bpgs
      JOIN games g ON bpgs.game_id = g.game_id
      WHERE bpgs.team_id = $1
      GROUP BY bpgs.game_id, g.start_time::date
      ORDER BY g.start_time::date DESC
    `, [teamId]);
    console.log(`\nGames in bbref_player_game_stats:`);
    playerGames.rows.forEach((g: any, i: number) => {
      console.log(`  ${i + 1}. ${g.game_date} - ${g.game_id} (${g.player_rows} player rows)`);
    });
    
    // 3. Check bbref_team_game_stats
    console.log('\n3️⃣ BBREF_TEAM_GAME_STATS');
    console.log('-'.repeat(80));
    const teamStats = await pool.query(`
      SELECT 
        COUNT(*) as total_games,
        COUNT(CASE WHEN g.status = 'Final' THEN 1 END) as final_games
      FROM bbref_team_game_stats btgs
      JOIN games g ON btgs.game_id = g.game_id
      WHERE btgs.team_id = $1
    `, [teamId]);
    console.log(`Total games: ${teamStats.rows[0].total_games}`);
    console.log(`Final games: ${teamStats.rows[0].final_games}`);
    
    const teamGames = await pool.query(`
      SELECT btgs.game_id, g.start_time::date as game_date, g.status,
             ht.abbreviation as home_team, at.abbreviation as away_team
      FROM bbref_team_game_stats btgs
      JOIN games g ON btgs.game_id = g.game_id
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE btgs.team_id = $1
      ORDER BY g.start_time::date DESC
    `, [teamId]);
    console.log(`\nGames in bbref_team_game_stats:`);
    teamGames.rows.forEach((g: any, i: number) => {
      console.log(`  ${i + 1}. ${g.game_date} - ${g.game_id} - ${g.status} - ${g.away_team} @ ${g.home_team}`);
    });
    
    // 4. Find missing games
    console.log('\n4️⃣ MISSING GAMES ANALYSIS');
    console.log('-'.repeat(80));
    const missing = await pool.query(`
      SELECT DISTINCT sb.game_id, sb.game_date
      FROM scraped_boxscores sb
      WHERE sb.team_code = 'DET' 
        AND sb.source = 'bbref_csv'
        AND NOT EXISTS (
          SELECT 1 FROM bbref_team_game_stats btgs 
          WHERE btgs.game_id = sb.game_id AND btgs.team_id = $1
        )
      ORDER BY sb.game_date DESC
    `, [teamId]);
    
    if (missing.rows.length > 0) {
      console.log(`\n⚠️  Found ${missing.rows.length} games in scraped_boxscores but NOT in bbref_team_game_stats:`);
      missing.rows.forEach((g: any, i: number) => {
        console.log(`  ${i + 1}. ${g.game_date} - ${g.game_id}`);
      });
      console.log(`\n💡 These games need to be populated. Run: npx tsx scripts/populate-bbref-stats.ts`);
    } else {
      console.log(`\n✅ All games from scraped_boxscores are in bbref_team_game_stats`);
    }
    
    // 5. Check game statuses
    console.log('\n5️⃣ GAME STATUSES');
    console.log('-'.repeat(80));
    const statuses = await pool.query(`
      SELECT g.status, COUNT(*) as count
      FROM bbref_team_game_stats btgs
      JOIN games g ON btgs.game_id = g.game_id
      WHERE btgs.team_id = $1
      GROUP BY g.status
      ORDER BY count DESC
    `, [teamId]);
    console.log(`Status breakdown:`);
    statuses.rows.forEach((s: any) => {
      console.log(`  ${s.status}: ${s.count} games`);
    });
    
    console.log('\n' + '='.repeat(80));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();


