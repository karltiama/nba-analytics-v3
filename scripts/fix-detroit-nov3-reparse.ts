import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

// Helper functions from scrape-bbref-csv-boxscores.ts
function parseIntSafe(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (str === '' || str === 'Did Not Play' || str === 'DNP' || str.toLowerCase() === 'null') return null;
  const parsed = parseInt(str, 10);
  return isNaN(parsed) ? null : parsed;
}

function parseFloatSafe(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (str === '' || str === 'Did Not Play' || str === 'DNP' || str.toLowerCase() === 'null') return null;
  const parsed = parseFloat(str);
  return isNaN(parsed) ? null : parsed;
}

function parseMinutes(mp: string | null | undefined): number | null {
  if (!mp || mp === '') return null;
  
  if (mp.includes('Did Not') || mp === 'DNP') return null;
  
  const parts = String(mp).split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    if (!isNaN(minutes) && !isNaN(seconds)) {
      return minutes + seconds / 60;
    }
  }
  
  const num = parseFloat(String(mp));
  return isNaN(num) ? null : num;
}

async function reparseDetroitNov3() {
  console.log('\n🔧 Re-parsing Detroit Nov 3 Game Raw Data\n');
  
  const gameId = 'bbref_202511030000_DET_MEM';
  
  // Get all scraped rows with raw_data
  const scraped = await pool.query(`
    SELECT 
      sb.id,
      sb.player_name,
      sb.team_code,
      sb.raw_data
    FROM scraped_boxscores sb
    WHERE sb.game_id = $1
      AND sb.source = 'bbref_csv'
    ORDER BY sb.team_code, sb.player_name
  `, [gameId]);
  
  console.log(`📥 Found ${scraped.rows.length} rows to re-parse\n`);
  
  let updated = 0;
  let totalPtsDet = 0;
  let totalPtsMem = 0;
  
  for (const row of scraped.rows) {
    if (!row.raw_data) {
      console.log(`   ⚠️  Skipping ${row.player_name} (${row.team_code}) - no raw_data`);
      continue;
    }
    
    try {
      const record = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
      
      // Parse all fields from raw_data
      const minutes = parseMinutes(record['MP'] || record['mp']);
      const points = parseIntSafe(record['PTS'] || record['pts']);
      const rebounds = parseIntSafe(record['TRB'] || record['trb'] || record['REB'] || record['reb']);
      const assists = parseIntSafe(record['AST'] || record['ast']);
      const steals = parseIntSafe(record['STL'] || record['stl']);
      const blocks = parseIntSafe(record['BLK'] || record['blk']);
      const turnovers = parseIntSafe(record['TOV'] || record['tov']);
      const field_goals_made = parseIntSafe(record['FG'] || record['fg']);
      const field_goals_attempted = parseIntSafe(record['FGA'] || record['fga']);
      const field_goal_pct = parseFloatSafe(record['FG%'] || record['fg%'] || record['FG_PCT'] || record['FG.']);
      const three_pointers_made = parseIntSafe(record['3P'] || record['3p'] || record['three_p']);
      const three_pointers_attempted = parseIntSafe(record['3PA'] || record['3pa'] || record['three_pa']);
      const three_point_pct = parseFloatSafe(record['3P%'] || record['3p%'] || record['3P_PCT'] || record['3P.']);
      const free_throws_made = parseIntSafe(record['FT'] || record['ft']);
      const free_throws_attempted = parseIntSafe(record['FTA'] || record['fta']);
      const free_throw_pct = parseFloatSafe(record['FT%'] || record['ft%'] || record['FT_PCT'] || record['FT.']);
      const offensive_rebounds = parseIntSafe(record['ORB'] || record['orb']);
      const defensive_rebounds = parseIntSafe(record['DRB'] || record['drb']);
      const personal_fouls = parseIntSafe(record['PF'] || record['pf']);
      const plus_minus = parseIntSafe(record['+/-'] || record['PLUS_MINUS']);
      
      // Determine if started (usually first 5 players in the CSV)
      const started = record['Starters'] === row.player_name || false;
      
      // Determine DNP reason
      const mp = record['MP'] || record['mp'] || '';
      const dnp_reason = (String(mp).includes('Did Not') || String(row.player_name).toLowerCase().includes('did not')) ? mp : null;
      
      // Update the row
      await pool.query(`
        UPDATE scraped_boxscores
        SET
          minutes = $1,
          points = $2,
          rebounds = $3,
          assists = $4,
          steals = $5,
          blocks = $6,
          turnovers = $7,
          field_goals_made = $8,
          field_goals_attempted = $9,
          field_goal_pct = $10,
          three_pointers_made = $11,
          three_pointers_attempted = $12,
          three_point_pct = $13,
          free_throws_made = $14,
          free_throws_attempted = $15,
          free_throw_pct = $16,
          offensive_rebounds = $17,
          defensive_rebounds = $18,
          personal_fouls = $19,
          plus_minus = $20,
          started = $21,
          dnp_reason = $22,
          updated_at = now()
        WHERE id = $23
      `, [
        minutes,
        points,
        rebounds,
        assists,
        steals,
        blocks,
        turnovers,
        field_goals_made,
        field_goals_attempted,
        field_goal_pct,
        three_pointers_made,
        three_pointers_attempted,
        three_point_pct,
        free_throws_made,
        free_throws_attempted,
        free_throw_pct,
        offensive_rebounds,
        defensive_rebounds,
        personal_fouls,
        plus_minus,
        started,
        dnp_reason,
        row.id
      ]);
      
      updated++;
      
      // Track totals
      if (points && !dnp_reason) {
        if (row.team_code === 'DET') {
          totalPtsDet += points;
        } else if (row.team_code === 'MEM') {
          totalPtsMem += points;
        }
      }
      
    } catch (error: any) {
      console.log(`   ❌ Error parsing ${row.player_name} (${row.team_code}): ${error.message}`);
    }
  }
  
  console.log(`\n✅ Updated ${updated} rows`);
  console.log(`\n📊 Calculated Totals:`);
  console.log(`   Detroit: ${totalPtsDet} points`);
  console.log(`   Memphis: ${totalPtsMem} points`);
  
  // Check game record
  const game = await pool.query(`
    SELECT 
      bg.home_score,
      bg.away_score,
      bg.home_team_abbr,
      bg.away_team_abbr
    FROM bbref_games bg
    WHERE bg.bbref_game_id = $1
  `, [gameId]);
  
  if (game.rows.length > 0) {
    const gameInfo = game.rows[0];
    const expectedDetScore = gameInfo.away_team_abbr === 'DET' ? gameInfo.away_score : gameInfo.home_score;
    const expectedMemScore = gameInfo.home_team_abbr === 'MEM' ? gameInfo.home_score : gameInfo.away_score;
    
    console.log(`\n📊 Game Record:`);
    console.log(`   Expected Detroit: ${expectedDetScore}`);
    console.log(`   Expected Memphis: ${expectedMemScore}`);
    
    if (totalPtsDet === expectedDetScore && totalPtsMem === expectedMemScore) {
      console.log(`\n✅ Totals match game record!`);
    } else {
      console.log(`\n⚠️  Totals don't match game record:`);
      console.log(`   Detroit: Expected ${expectedDetScore}, Got ${totalPtsDet} (difference: ${expectedDetScore - totalPtsDet})`);
      console.log(`   Memphis: Expected ${expectedMemScore}, Got ${totalPtsMem} (difference: ${expectedMemScore - totalPtsMem})`);
      console.log(`\n💡 This suggests some players may be missing from the scraped data.`);
    }
  }
  
  console.log(`\n💡 Next step: Run populate-bbref-stats.ts to update player and team stats`);
  
  await pool.end();
}

reparseDetroitNov3();

