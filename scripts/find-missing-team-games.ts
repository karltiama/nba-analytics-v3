import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Find Missing Games for a Team
 * 
 * Identifies exactly which games are missing box scores for a given team
 * 
 * Usage:
 *   tsx scripts/find-missing-team-games.ts ORL
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

async function findMissingGames(teamAbbr: string) {
  console.log(`\n🔍 Finding Missing ${teamAbbr} Games...\n`);
  
  // Get team_id
  const teamResult = await pool.query(`
    SELECT team_id, abbreviation FROM teams WHERE abbreviation = $1
  `, [teamAbbr.toUpperCase()]);
  
  if (teamResult.rows.length === 0) {
    console.log(`❌ Team ${teamAbbr} not found`);
    await pool.end();
    return;
  }
  
  const teamId = teamResult.rows[0].team_id;
  
  // Find Final games without team stats
  const missingGames = await pool.query(`
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.status,
      bg.home_team_abbr,
      bg.away_team_abbr,
      bg.home_score,
      bg.away_score,
      CASE WHEN EXISTS (
        SELECT 1 FROM bbref_player_game_stats bpgs 
        WHERE bpgs.game_id = bg.bbref_game_id
      ) THEN 'Yes' ELSE 'No' END as has_player_stats,
      CASE WHEN EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs 
        WHERE btgs.game_id = bg.bbref_game_id AND btgs.team_id = $1
      ) THEN 'Yes' ELSE 'No' END as has_team_stats
    FROM bbref_games bg
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND bg.status = 'Final'
      AND bg.game_date <= CURRENT_DATE - INTERVAL '1 day'
      AND NOT EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs 
        WHERE btgs.game_id = bg.bbref_game_id AND btgs.team_id = $1
      )
    ORDER BY bg.game_date DESC
  `, [teamId]);
  
  console.log('='.repeat(100));
  console.log(`📊 ${teamAbbr} Missing Box Scores\n`);
  console.log(`Found ${missingGames.rows.length} Final games missing team stats (up to yesterday)\n`);
  
  if (missingGames.rows.length === 0) {
    console.log('✅ No missing games found!');
  } else {
    console.log('Missing Games:\n');
    missingGames.rows.forEach((game, idx) => {
      const score = game.home_score && game.away_score 
        ? `${game.away_score} - ${game.home_score}`
        : 'No score';
      const playerStats = game.has_player_stats === 'Yes' ? '✅' : '❌';
      console.log(`  ${idx + 1}. ${game.game_date} - ${game.away_team_abbr} @ ${game.home_team_abbr}`);
      console.log(`     Score: ${score}`);
      console.log(`     Player Stats: ${playerStats} | Team Stats: ❌`);
      console.log(`     Game ID: ${game.bbref_game_id}`);
      console.log();
    });
    
    // Check if they have player stats but not team stats
    const withPlayerStats = missingGames.rows.filter(g => g.has_player_stats === 'Yes');
    const withoutPlayerStats = missingGames.rows.filter(g => g.has_player_stats === 'No');
    
    console.log('\n' + '='.repeat(100));
    console.log('\n📋 Breakdown:');
    console.log(`   Games with player stats but missing team stats: ${withPlayerStats.length}`);
    console.log(`   Games missing both player and team stats: ${withoutPlayerStats.length}`);
    
    if (withPlayerStats.length > 0) {
      console.log(`\n💡 ${withPlayerStats.length} games have player stats but need team stats aggregation.`);
      console.log(`   Run: tsx scripts/populate-bbref-stats.ts --teams-only`);
    }
    
    if (withoutPlayerStats.length > 0) {
      console.log(`\n💡 ${withoutPlayerStats.length} games need to be scraped from Basketball Reference.`);
      console.log(`   Run: tsx scripts/batch-scrape-missing-bbref-games.ts --team ${teamAbbr}`);
    }
  }
  
  // Also show summary stats
  const summary = await pool.query(`
    SELECT 
      COUNT(DISTINCT bg.bbref_game_id) as final_games,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs 
        WHERE btgs.game_id = bg.bbref_game_id AND btgs.team_id = $1
      ) THEN bg.bbref_game_id END) as games_with_team_stats,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM bbref_player_game_stats bpgs 
        WHERE bpgs.game_id = bg.bbref_game_id
      ) THEN bg.bbref_game_id END) as games_with_player_stats
    FROM bbref_games bg
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND bg.status = 'Final'
      AND bg.game_date <= CURRENT_DATE - INTERVAL '1 day'
  `, [teamId]);
  
  const stats = summary.rows[0];
  const coverage = stats.final_games > 0 
    ? Math.round((stats.games_with_team_stats / stats.final_games) * 100)
    : 0;
  
  console.log('\n' + '='.repeat(100));
  console.log('\n📊 Summary (up to yesterday):');
  console.log(`   Final games: ${stats.final_games}`);
  console.log(`   Games with player stats: ${stats.games_with_player_stats}`);
  console.log(`   Games with team stats: ${stats.games_with_team_stats}`);
  console.log(`   Missing team stats: ${stats.final_games - stats.games_with_team_stats}`);
  console.log(`   Coverage: ${coverage}%`);
  console.log();
  
  await pool.end();
}

const teamAbbr = process.argv[2] || 'CLE';
findMissingGames(teamAbbr).catch(console.error);








