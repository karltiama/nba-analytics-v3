import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Analyze game ID formats in the database to identify inconsistencies
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function analyzeGameIds() {
  console.log('\nAnalyzing Game ID Formats\n');
  console.log('='.repeat(60));
  
  // Get all game IDs grouped by format
  const result = await pool.query(`
    SELECT 
      game_id,
      CASE 
        WHEN game_id LIKE '002%' THEN 'NBA Stats (002...)'
        WHEN game_id LIKE '184%' THEN 'BallDontLie (184...)'
        WHEN game_id LIKE 'bbref_%' THEN 'Basketball Reference (bbref_...)'
        WHEN game_id ~ '^[0-9]+$' THEN 'Numeric Only'
        ELSE 'Other Format'
      END as format_type,
      season,
      start_time,
      status,
      home_score,
      away_score,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = games.game_id) as has_boxscore
    FROM games
    JOIN teams ht ON games.home_team_id = ht.team_id
    JOIN teams at ON games.away_team_id = at.team_id
    ORDER BY start_time DESC
  `);
  
  const formatGroups: Record<string, typeof result.rows> = {};
  
  for (const row of result.rows) {
    const format = row.format_type;
    if (!formatGroups[format]) {
      formatGroups[format] = [];
    }
    formatGroups[format].push(row);
  }
  
  console.log('\nSummary by Format:\n');
  Object.entries(formatGroups).forEach(([format, games]) => {
    console.log(`${format}: ${games.length} games`);
  });
  
  console.log('\n\nDetailed Breakdown:\n');
  
  // Show examples of each format
  Object.entries(formatGroups).forEach(([format, games]) => {
    console.log(`\n${format} (${games.length} games):`);
    console.log('-'.repeat(60));
    
    const examples = games.slice(0, 5);
    examples.forEach((game, idx) => {
      const dateStr = new Date(game.start_time).toISOString().split('T')[0];
      const scoreStr = game.home_score !== null && game.away_score !== null
        ? `${game.away_score}-${game.home_score}`
        : 'No score';
      const boxscoreStr = game.has_boxscore ? 'Yes' : 'No';
      
      console.log(`  ${idx + 1}. ${game.game_id}`);
      console.log(`     ${dateStr} | ${game.away_abbr} @ ${game.home_abbr} | ${game.status} | ${scoreStr} | Box: ${boxscoreStr}`);
    });
    
    if (games.length > 5) {
      console.log(`  ... and ${games.length - 5} more`);
    }
  });
  
  // Check for potential duplicates (same date/teams, different IDs)
  console.log('\n\nChecking for Potential Duplicates:\n');
  console.log('-'.repeat(60));
  
  const duplicates = await pool.query(`
    SELECT 
      DATE(start_time AT TIME ZONE 'America/New_York') as game_date,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      COUNT(*) as game_count,
      array_agg(game_id ORDER BY game_id) as game_ids,
      array_agg(status ORDER BY game_id) as statuses,
      array_agg(CASE WHEN EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = games.game_id) THEN 'has_boxscore' ELSE 'no_boxscore' END ORDER BY game_id) as boxscore_status
    FROM games
    JOIN teams ht ON games.home_team_id = ht.team_id
    JOIN teams at ON games.away_team_id = at.team_id
    GROUP BY DATE(start_time AT TIME ZONE 'America/New_York'), ht.abbreviation, at.abbreviation
    HAVING COUNT(*) > 1
    ORDER BY game_date DESC, home_abbr, away_abbr
    LIMIT 20
  `);
  
  if (duplicates.rows.length === 0) {
    console.log('No obvious duplicates found (same date + teams)');
  } else {
    console.log(`Found ${duplicates.rows.length} sets of potential duplicates:\n`);
    duplicates.rows.forEach((dup, idx) => {
      console.log(`${idx + 1}. ${dup.game_date} | ${dup.away_abbr} @ ${dup.home_abbr}`);
      console.log(`   IDs: ${dup.game_ids.join(', ')}`);
      console.log(`   Statuses: ${dup.statuses.join(', ')}`);
      console.log(`   Boxscores: ${dup.boxscore_status.join(', ')}`);
      console.log('');
    });
  }
  
  // Check bbref IDs specifically
  const bbrefGames = formatGroups['Basketball Reference (bbref_...)'] || [];
  if (bbrefGames.length > 0) {
    console.log('\n\nBasketball Reference Game IDs Found:\n');
    console.log('-'.repeat(60));
    console.log(`Total: ${bbrefGames.length} games with bbref_ prefix\n`);
    
    // Check if they have box scores
    const withBoxscores = bbrefGames.filter(g => g.has_boxscore).length;
    const withoutBoxscores = bbrefGames.length - withBoxscores;
    
    console.log(`Games with box scores: ${withBoxscores}`);
    console.log(`Games without box scores: ${withoutBoxscores}`);
    
    // Check if there are corresponding NBA Stats or BDL games
    console.log('\nChecking for corresponding NBA Stats or BDL games...\n');
    
    for (const bbrefGame of bbrefGames.slice(0, 10)) {
      const gameDate = new Date(bbrefGame.start_time);
      const dateStr = gameDate.toISOString().split('T')[0];
      
      const corresponding = await pool.query(`
        SELECT 
          game_id,
          CASE 
            WHEN game_id LIKE '002%' THEN 'NBA Stats'
            WHEN game_id LIKE '184%' THEN 'BallDontLie'
            ELSE 'Other'
          END as source
        FROM games
        JOIN teams ht ON games.home_team_id = ht.team_id
        JOIN teams at ON games.away_team_id = at.team_id
        WHERE DATE(start_time AT TIME ZONE 'America/New_York') = $1::date
          AND ht.abbreviation = $2
          AND at.abbreviation = $3
          AND game_id != $4
        ORDER BY game_id
      `, [
        dateStr,
        bbrefGame.home_abbr,
        bbrefGame.away_abbr,
        bbrefGame.game_id
      ]);
      
      if (corresponding.rows.length > 0) {
        console.log(`  ${bbrefGame.game_id} (${dateStr} ${bbrefGame.away_abbr} @ ${bbrefGame.home_abbr})`);
        console.log(`    → Has ${corresponding.rows.length} corresponding game(s): ${corresponding.rows.map(r => `${r.source}:${r.game_id}`).join(', ')}`);
      }
    }
  }
  
  await pool.end();
}

analyzeGameIds().catch(console.error);

