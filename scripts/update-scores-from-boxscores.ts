import 'dotenv/config';
import { Pool } from 'pg';
import { fetchBBRefBoxScore, TEAM_CODE_MAP } from './scrape-basketball-reference';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

/**
 * Update game scores from Basketball Reference box scores
 * For games that have box scores but missing final scores
 */
async function main() {
  const args = process.argv.slice(2);
  const startDateIndex = args.indexOf('--start-date');
  const endDateIndex = args.indexOf('--end-date');
  const dryRunIndex = args.indexOf('--dry-run');
  
  const startDate = startDateIndex !== -1 && args[startDateIndex + 1] 
    ? args[startDateIndex + 1] 
    : undefined;
  const endDate = endDateIndex !== -1 && args[endDateIndex + 1] 
    ? args[endDateIndex + 1] 
    : undefined;
  const dryRun = dryRunIndex !== -1;
  
  // Find games with box scores but missing scores
  let sql = `
    SELECT DISTINCT
      g.game_id,
      g.start_time,
      g.home_score,
      g.away_score,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE EXISTS (SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id)
      AND (g.home_score IS NULL OR g.away_score IS NULL)
      AND g.status = 'Final'
  `;
  
  const params: any[] = [];
  let paramCount = 1;
  
  if (startDate) {
    sql += ` AND g.start_time::date >= $${paramCount}::date`;
    params.push(startDate);
    paramCount++;
  }
  
  if (endDate) {
    sql += ` AND g.start_time::date <= $${paramCount}::date`;
    params.push(endDate);
    paramCount++;
  }
  
  sql += ` ORDER BY g.start_time ASC LIMIT 50`;
  
  const result = await pool.query(sql, params);
  
  if (result.rows.length === 0) {
    console.log('✅ No games found with missing scores!');
    return;
  }
  
  console.log(`\n📊 Found ${result.rows.length} games with box scores but missing final scores\n`);
  
  let updated = 0;
  let failed = 0;
  
  for (const game of result.rows) {
    const dateStr = new Date(game.start_time).toISOString().split('T')[0];
    console.log(`\n[${updated + failed + 1}/${result.rows.length}] ${game.away_abbr} @ ${game.home_abbr} (${dateStr})`);
    
    try {
      const homeTeamCode = TEAM_CODE_MAP[game.home_abbr];
      if (!homeTeamCode) {
        console.log(`   ⚠️  Unknown team code for ${game.home_abbr}`);
        failed++;
        continue;
      }
      
      const boxScoreData = await fetchBBRefBoxScore(game.start_time, homeTeamCode);
      
      if (boxScoreData.homeScore !== null && boxScoreData.awayScore !== null) {
        console.log(`   📊 Scores from Basketball Reference: ${boxScoreData.awayScore} - ${boxScoreData.homeScore}`);
        
        if (!dryRun) {
          await pool.query(
            `UPDATE games SET home_score = $1, away_score = $2, updated_at = now() WHERE game_id = $3`,
            [boxScoreData.homeScore, boxScoreData.awayScore, game.game_id]
          );
          console.log(`   ✅ Updated scores in database`);
        } else {
          console.log(`   [DRY RUN] Would update scores`);
        }
        updated++;
      } else {
        console.log(`   ⚠️  Could not extract scores from Basketball Reference`);
        failed++;
      }
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\n✅ Complete!`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Failed: ${failed}`);
  
  await pool.end();
}

main();

