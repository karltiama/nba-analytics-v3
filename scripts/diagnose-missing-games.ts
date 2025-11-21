import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Diagnostic script to identify missing games
 * 
 * Compares bbref_schedule (source of truth) with games table
 * to find which games are missing
 * 
 * Usage:
 *   tsx scripts/diagnose-missing-games.ts
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function diagnoseMissingGames() {
  console.log('\n🔍 Diagnosing Missing Games\n');
  console.log('='.repeat(60));
  
  // 1. Count total games in bbref_schedule
  const totalBBRef = await pool.query(`
    SELECT COUNT(*) as count
    FROM bbref_schedule
  `);
  console.log(`\n📊 Total games in bbref_schedule: ${totalBBRef.rows[0].count}`);
  
  // 2. Count games with team IDs resolved
  const withTeamIds = await pool.query(`
    SELECT COUNT(*) as count
    FROM bbref_schedule
    WHERE home_team_id IS NOT NULL 
      AND away_team_id IS NOT NULL
  `);
  console.log(`📊 Games with team IDs resolved: ${withTeamIds.rows[0].count}`);
  
  // 3. Count games missing team IDs
  const missingTeamIds = await pool.query(`
    SELECT COUNT(*) as count
    FROM bbref_schedule
    WHERE home_team_id IS NULL 
       OR away_team_id IS NULL
  `);
  console.log(`⚠️  Games missing team IDs: ${missingTeamIds.rows[0].count}`);
  
  // 4. Show games missing team IDs
  if (parseInt(missingTeamIds.rows[0].count) > 0) {
    console.log('\n📋 Games missing team IDs:');
    const missingTeamIdGames = await pool.query(`
      SELECT 
        bbref_game_id,
        game_date,
        home_team_abbr,
        away_team_abbr,
        home_team_id,
        away_team_id,
        season
      FROM bbref_schedule
      WHERE home_team_id IS NULL 
         OR away_team_id IS NULL
      ORDER BY game_date, home_team_abbr, away_team_abbr
      LIMIT 50
    `);
    
    missingTeamIdGames.rows.forEach((game, idx) => {
      console.log(`  ${idx + 1}. ${game.away_team_abbr} @ ${game.home_team_abbr} (${game.game_date})`);
      console.log(`     Missing: ${!game.home_team_id ? 'home_team_id' : ''} ${!game.away_team_id ? 'away_team_id' : ''}`);
    });
    
    if (parseInt(missingTeamIds.rows[0].count) > 50) {
      console.log(`  ... and ${parseInt(missingTeamIds.rows[0].count) - 50} more`);
    }
  }
  
  // 5. Count games in games table (from bbref_schedule)
  const gamesFromBBRef = await pool.query(`
    SELECT COUNT(DISTINCT g.game_id) as count
    FROM games g
    JOIN bbref_schedule bs ON (
      DATE(g.start_time AT TIME ZONE 'America/New_York') = bs.game_date
      AND g.home_team_id = bs.home_team_id
      AND g.away_team_id = bs.away_team_id
    )
    WHERE bs.home_team_id IS NOT NULL 
      AND bs.away_team_id IS NOT NULL
  `);
  console.log(`\n📊 Games in games table (matched from bbref_schedule): ${gamesFromBBRef.rows[0].count}`);
  
  // 6. Find games in bbref_schedule that don't have a match in games table
  const missingGames = await pool.query(`
    SELECT 
      bs.bbref_game_id,
      bs.game_date,
      bs.home_team_abbr,
      bs.away_team_abbr,
      bs.home_team_id,
      bs.away_team_id,
      bs.season,
      bs.canonical_game_id,
      g.game_id as matched_game_id
    FROM bbref_schedule bs
    LEFT JOIN games g ON (
      DATE(g.start_time AT TIME ZONE 'America/New_York') = bs.game_date
      AND g.home_team_id = bs.home_team_id
      AND g.away_team_id = bs.away_team_id
      AND (g.game_id LIKE '002%' OR g.game_id LIKE '184%')
    )
    WHERE bs.home_team_id IS NOT NULL 
      AND bs.away_team_id IS NOT NULL
      AND g.game_id IS NULL
    ORDER BY bs.game_date, bs.home_team_abbr, bs.away_team_abbr
  `);
  
  console.log(`\n❌ Games in bbref_schedule but NOT in games table: ${missingGames.rows.length}`);
  
  if (missingGames.rows.length > 0) {
    console.log('\n📋 Missing games:');
    missingGames.rows.forEach((game, idx) => {
      console.log(`  ${idx + 1}. ${game.away_team_abbr} @ ${game.home_team_abbr} (${game.game_date})`);
      console.log(`     Season: ${game.season || 'N/A'}`);
      console.log(`     BBRef ID: ${game.bbref_game_id}`);
      console.log(`     Canonical ID: ${game.canonical_game_id || 'None'}`);
    });
    
    // Group by date to see patterns
    const byDate = await pool.query(`
      SELECT 
        bs.game_date,
        COUNT(*) as missing_count
      FROM bbref_schedule bs
      LEFT JOIN games g ON (
        DATE(g.start_time AT TIME ZONE 'America/New_York') = bs.game_date
        AND g.home_team_id = bs.home_team_id
        AND g.away_team_id = bs.away_team_id
        AND (g.game_id LIKE '002%' OR g.game_id LIKE '184%')
      )
      WHERE bs.home_team_id IS NOT NULL 
        AND bs.away_team_id IS NOT NULL
        AND g.game_id IS NULL
      GROUP BY bs.game_date
      ORDER BY bs.game_date
    `);
    
    console.log('\n📅 Missing games by date:');
    byDate.rows.forEach((row) => {
      console.log(`  ${row.game_date}: ${row.missing_count} game(s)`);
    });
  }
  
  // 7. Count total games in games table
  const totalGames = await pool.query(`
    SELECT COUNT(*) as count
    FROM games
    WHERE season LIKE '2025-26' OR season LIKE '2026-27' OR season LIKE '2024-25'
  `);
  console.log(`\n📊 Total games in games table (all seasons): ${totalGames.rows[0].count}`);
  
  // 8. Check for potential duplicates (same date + teams but different game_ids)
  const potentialDuplicates = await pool.query(`
    SELECT 
      DATE(g.start_time AT TIME ZONE 'America/New_York') as game_date,
      g.home_team_id,
      g.away_team_id,
      COUNT(*) as count,
      array_agg(g.game_id) as game_ids
    FROM games g
    WHERE g.season LIKE '2025-26' OR g.season LIKE '2026-27' OR g.season LIKE '2024-25'
    GROUP BY 
      DATE(g.start_time AT TIME ZONE 'America/New_York'),
      g.home_team_id,
      g.away_team_id
    HAVING COUNT(*) > 1
    ORDER BY game_date
  `);
  
  if (potentialDuplicates.rows.length > 0) {
    console.log(`\n⚠️  Potential duplicate games found: ${potentialDuplicates.rows.length}`);
    potentialDuplicates.rows.slice(0, 10).forEach((dup) => {
      console.log(`  Date: ${dup.game_date}, Teams: ${dup.home_team_id} vs ${dup.away_team_id}`);
      console.log(`    Game IDs: ${dup.game_ids.join(', ')}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n💡 Next steps:');
  console.log('  1. If games are missing team IDs, check team abbreviation mappings');
  console.log('  2. Run: tsx scripts/sync-games-from-bbref-schedule.ts --dry-run');
  console.log('  3. Then run: tsx scripts/sync-games-from-bbref-schedule.ts');
  
  await pool.end();
}

diagnoseMissingGames().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});


