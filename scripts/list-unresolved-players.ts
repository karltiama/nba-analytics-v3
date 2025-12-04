import 'dotenv/config';
import { Pool } from 'pg';

/**
 * List Unresolved Players
 * 
 * Shows all players in scraped_boxscores that don't have a player_id
 * 
 * Usage:
 *   tsx scripts/list-unresolved-players.ts
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

async function main() {
  console.log('\n🔍 Finding unresolved players...\n');
  
  const result = await pool.query(`
    SELECT 
      player_name,
      team_code,
      COUNT(DISTINCT game_id) as game_count,
      MIN(game_date) as first_game,
      MAX(game_date) as last_game
    FROM scraped_boxscores
    WHERE player_id IS NULL
    GROUP BY player_name, team_code
    ORDER BY game_count DESC, player_name
  `);
  
  if (result.rows.length === 0) {
    console.log('✅ No unresolved players found!');
    await pool.end();
    return;
  }
  
  console.log('='.repeat(100));
  console.log(`📋 Unresolved Players (${result.rows.length} total)\n`);
  console.log('='.repeat(100));
  console.log();
  
  result.rows.forEach((p, i) => {
    const firstGame = p.first_game ? new Date(p.first_game).toISOString().split('T')[0] : 'N/A';
    const lastGame = p.last_game ? new Date(p.last_game).toISOString().split('T')[0] : 'N/A';
    console.log(`${String(i + 1).padStart(3)}. ${p.player_name.padEnd(40)} | Team: ${p.team_code.padEnd(3)} | Games: ${String(p.game_count).padStart(3)} | ${firstGame} to ${lastGame}`);
  });
  
  console.log();
  console.log('='.repeat(100));
  console.log(`\nTotal: ${result.rows.length} unresolved players`);
  console.log(`\n💡 To resolve these players, run:`);
  console.log(`   tsx scripts/resolve-missing-player-ids.ts --auto`);
  console.log(`   or`);
  console.log(`   tsx scripts/resolve-missing-player-ids.ts (interactive mode)\n`);
  
  await pool.end();
}

main().catch(console.error);








