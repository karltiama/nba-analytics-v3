import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

// Team code mapping: NBA abbreviation -> BBRef code
// This is the same mapping used in other scripts
const TEAM_CODE_MAP: Record<string, string> = {
  'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BRK', 'CHA': 'CHO', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GSW': 'GSW',
  'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM',
  'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NOP': 'NOP', 'NYK': 'NYK',
  'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI', 'PHX': 'PHO', 'POR': 'POR',
  'SAC': 'SAC', 'SAS': 'SAS', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS'
};

/**
 * Resolve team_id from Basketball Reference team code
 */
async function resolveTeamId(teamCode: string): Promise<string | null> {
  // Map BBRef code back to NBA abbreviation
  // TEAM_CODE_MAP maps NBA -> BBRef, so we reverse lookup
  const nbaAbbr = Object.entries(TEAM_CODE_MAP).find(([_, code]) => code === teamCode)?.[0] || teamCode;
  
  const result = await pool.query(`
    SELECT team_id
    FROM teams
    WHERE abbreviation = $1
    LIMIT 1
  `, [nbaAbbr]);
  
  return result.rows.length > 0 ? result.rows[0].team_id : null;
}

/**
 * Populate bbref_player_game_stats from scraped_boxscores
 */
async function populatePlayerStats(dryRun: boolean = false): Promise<{ inserted: number; updated: number; skipped: number }> {
  console.log('\n📊 Populating bbref_player_game_stats from scraped_boxscores...\n');
  
  // Get all scraped boxscores with resolved player_ids
  const scrapedStats = await pool.query(`
    SELECT 
      sb.game_id,
      sb.player_id,
      sb.team_code,
      sb.minutes,
      sb.points,
      sb.rebounds,
      sb.assists,
      sb.steals,
      sb.blocks,
      sb.turnovers,
      sb.field_goals_made,
      sb.field_goals_attempted,
      sb.three_pointers_made,
      sb.three_pointers_attempted,
      sb.free_throws_made,
      sb.free_throws_attempted,
      sb.offensive_rebounds,
      sb.defensive_rebounds,
      sb.personal_fouls,
      sb.plus_minus,
      sb.started,
      sb.dnp_reason
    FROM scraped_boxscores sb
    WHERE sb.source = 'bbref_csv'
      AND sb.player_id IS NOT NULL
      AND sb.dnp_reason IS NULL
    ORDER BY sb.game_id, sb.team_code, sb.player_name
  `);
  
  if (scrapedStats.rows.length === 0) {
    console.log('⚠️  No scraped boxscores found with resolved player_ids');
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  
  console.log(`Found ${scrapedStats.rows.length} player stat rows to process\n`);
  
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  
  // Process in batches
  const batchSize = 100;
  console.log(`Processing ${scrapedStats.rows.length} records in batches of ${batchSize}...\n`);
  
  for (let i = 0; i < scrapedStats.rows.length; i += batchSize) {
    const batch = scrapedStats.rows.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(scrapedStats.rows.length / batchSize);
    
    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} records)...`);
    
    for (const row of batch) {
      // Resolve team_id from team_code
      const teamId = await resolveTeamId(row.team_code);
      
      if (!teamId) {
        console.warn(`   ⚠️  Could not resolve team_id for team_code: ${row.team_code}`);
        skipped++;
        continue;
      }
      
      // Check if game exists in bbref_games table
      // First try direct match (for bbref_game_id format)
      let gameCheck = await pool.query(
        `SELECT bbref_game_id FROM bbref_games WHERE bbref_game_id = $1`,
        [row.game_id]
      );
      
      // If not found and game_id looks like NBA Stats format (starts with numbers), try to map it
      if (gameCheck.rows.length === 0 && /^\d+$/.test(row.game_id)) {
        // Try to find bbref_game_id by looking up the game in games table and matching by date/teams
        // We'll use scraped_boxscores data to get game_date and team_code, then find matching bbref_game
        const gameInfo = await pool.query(`
          SELECT DISTINCT sb.game_date, sb.team_code
          FROM scraped_boxscores sb
          WHERE sb.game_id = $1
          LIMIT 1
        `, [row.game_id]);
        
        if (gameInfo.rows.length > 0) {
          const { game_date, team_code } = gameInfo.rows[0];
          // Try to find bbref_game_id by matching date and team
          const teamId = await resolveTeamId(team_code);
          if (teamId) {
            gameCheck = await pool.query(`
              SELECT bg.bbref_game_id
              FROM bbref_games bg
              WHERE bg.game_date = $1
                AND (bg.home_team_id = $2 OR bg.away_team_id = $2)
              LIMIT 1
            `, [game_date, teamId]);
            
            if (gameCheck.rows.length > 0) {
              // Update scraped_boxscores to use the correct bbref_game_id for future runs
              await pool.query(`
                UPDATE scraped_boxscores
                SET game_id = $1
                WHERE game_id = $2 AND source = 'bbref_csv'
              `, [gameCheck.rows[0].bbref_game_id, row.game_id]);
              row.game_id = gameCheck.rows[0].bbref_game_id;
            }
          }
        }
      }
      
      if (gameCheck.rows.length === 0) {
        // Skip warning for now - too verbose
        skipped++;
        continue;
      }
      
      // Check if player exists
      const playerCheck = await pool.query(
        `SELECT player_id FROM players WHERE player_id = $1`,
        [row.player_id]
      );
      
      if (playerCheck.rows.length === 0) {
        // Skip warning for now - too verbose
        skipped++;
        continue;
      }
      
      // Upsert player stats
      if (!dryRun) {
        const result = await pool.query(`
          INSERT INTO bbref_player_game_stats (
            game_id, player_id, team_id,
            minutes, points, rebounds, assists, steals, blocks, turnovers,
            field_goals_made, field_goals_attempted,
            three_pointers_made, three_pointers_attempted,
            free_throws_made, free_throws_attempted,
            offensive_rebounds, defensive_rebounds,
            personal_fouls, plus_minus,
            started, dnp_reason,
            source
          ) VALUES (
            $1, $2, $3,
            $4, $5, $6, $7, $8, $9, $10,
            $11, $12,
            $13, $14,
            $15, $16,
            $17, $18,
            $19, $20,
            $21, $22,
            'bbref'
          )
          ON CONFLICT (game_id, player_id) DO UPDATE SET
            team_id = EXCLUDED.team_id,
            minutes = EXCLUDED.minutes,
            points = EXCLUDED.points,
            rebounds = EXCLUDED.rebounds,
            assists = EXCLUDED.assists,
            steals = EXCLUDED.steals,
            blocks = EXCLUDED.blocks,
            turnovers = EXCLUDED.turnovers,
            field_goals_made = EXCLUDED.field_goals_made,
            field_goals_attempted = EXCLUDED.field_goals_attempted,
            three_pointers_made = EXCLUDED.three_pointers_made,
            three_pointers_attempted = EXCLUDED.three_pointers_attempted,
            free_throws_made = EXCLUDED.free_throws_made,
            free_throws_attempted = EXCLUDED.free_throws_attempted,
            offensive_rebounds = EXCLUDED.offensive_rebounds,
            defensive_rebounds = EXCLUDED.defensive_rebounds,
            personal_fouls = EXCLUDED.personal_fouls,
            plus_minus = EXCLUDED.plus_minus,
            started = EXCLUDED.started,
            dnp_reason = EXCLUDED.dnp_reason,
            updated_at = now()
          RETURNING (xmax = 0) AS inserted
        `, [
          row.game_id,
          row.player_id,
          teamId,
          row.minutes,
          row.points,
          row.rebounds,
          row.assists,
          row.steals,
          row.blocks,
          row.turnovers,
          row.field_goals_made,
          row.field_goals_attempted,
          row.three_pointers_made,
          row.three_pointers_attempted,
          row.free_throws_made,
          row.free_throws_attempted,
          row.offensive_rebounds,
          row.defensive_rebounds,
          row.personal_fouls,
          row.plus_minus,
          row.started,
          row.dnp_reason
        ]);
        
        if (result.rows[0].inserted) {
          inserted++;
        } else {
          updated++;
        }
      } else {
        // Dry run - just count
        const existing = await pool.query(
          `SELECT game_id FROM bbref_player_game_stats WHERE game_id = $1 AND player_id = $2`,
          [row.game_id, row.player_id]
        );
        
        if (existing.rows.length === 0) {
          inserted++;
        } else {
          updated++;
        }
      }
    }
    
    if ((i + batchSize) % 500 === 0 || i + batchSize >= scrapedStats.rows.length) {
      console.log(`   Processed ${Math.min(i + batchSize, scrapedStats.rows.length)}/${scrapedStats.rows.length} rows...`);
    }
  }
  
  console.log(`\n✅ Player stats: ${inserted} inserted, ${updated} updated, ${skipped} skipped\n`);
  return { inserted, updated, skipped };
}

/**
 * Populate bbref_team_game_stats by aggregating from bbref_player_game_stats
 */
async function populateTeamStats(dryRun: boolean = false): Promise<{ inserted: number; updated: number }> {
  console.log('📊 Populating bbref_team_game_stats from bbref_player_game_stats...\n');
  
  // Get all unique game_id + team_id combinations
  const teamGames = await pool.query(`
    SELECT DISTINCT
      pgs.game_id,
      pgs.team_id,
      bg.home_team_id,
      bg.away_team_id
    FROM bbref_player_game_stats pgs
    JOIN bbref_games bg ON pgs.game_id = bg.bbref_game_id
    ORDER BY pgs.game_id, pgs.team_id
  `);
  
  if (teamGames.rows.length === 0) {
    console.log('⚠️  No team games found in bbref_player_game_stats');
    return { inserted: 0, updated: 0 };
  }
  
  console.log(`Found ${teamGames.rows.length} team-game combinations to process\n`);
  
  let inserted = 0;
  let updated = 0;
  
  for (const teamGame of teamGames.rows) {
    const isHome = teamGame.team_id === teamGame.home_team_id;
    
    // Aggregate stats from player_game_stats
    const aggregated = await pool.query(`
      SELECT 
        SUM(points) as points,
        SUM(field_goals_made) as field_goals_made,
        SUM(field_goals_attempted) as field_goals_attempted,
        SUM(three_pointers_made) as three_pointers_made,
        SUM(three_pointers_attempted) as three_pointers_attempted,
        SUM(free_throws_made) as free_throws_made,
        SUM(free_throws_attempted) as free_throws_attempted,
        SUM(rebounds) as rebounds,
        SUM(offensive_rebounds) as offensive_rebounds,
        SUM(defensive_rebounds) as defensive_rebounds,
        SUM(assists) as assists,
        SUM(steals) as steals,
        SUM(blocks) as blocks,
        SUM(turnovers) as turnovers,
        SUM(personal_fouls) as personal_fouls,
        SUM(plus_minus) as plus_minus,
        SUM(minutes) as minutes,
        -- Calculate possessions: FGA + 0.44 * FTA - ORB + TOV
        SUM(field_goals_attempted) + 
        0.44 * SUM(free_throws_attempted) - 
        COALESCE(SUM(offensive_rebounds), 0) + 
        SUM(turnovers) as possessions
      FROM bbref_player_game_stats
      WHERE game_id = $1 AND team_id = $2
        AND dnp_reason IS NULL
    `, [teamGame.game_id, teamGame.team_id]);
    
    const stats = aggregated.rows[0];
    
    if (!dryRun) {
      const result = await pool.query(`
        INSERT INTO bbref_team_game_stats (
          game_id, team_id,
          points, field_goals_made, field_goals_attempted,
          three_pointers_made, three_pointers_attempted,
          free_throws_made, free_throws_attempted,
          rebounds, offensive_rebounds, defensive_rebounds,
          assists, steals, blocks, turnovers, personal_fouls, plus_minus,
          possessions, minutes,
          is_home, source
        ) VALUES (
          $1, $2,
          $3, $4, $5,
          $6, $7,
          $8, $9,
          $10, $11, $12,
          $13, $14, $15, $16, $17, $18,
          $19, $20,
          $21, 'bbref'
        )
        ON CONFLICT (game_id, team_id) DO UPDATE SET
          points = EXCLUDED.points,
          field_goals_made = EXCLUDED.field_goals_made,
          field_goals_attempted = EXCLUDED.field_goals_attempted,
          three_pointers_made = EXCLUDED.three_pointers_made,
          three_pointers_attempted = EXCLUDED.three_pointers_attempted,
          free_throws_made = EXCLUDED.free_throws_made,
          free_throws_attempted = EXCLUDED.free_throws_attempted,
          rebounds = EXCLUDED.rebounds,
          offensive_rebounds = EXCLUDED.offensive_rebounds,
          defensive_rebounds = EXCLUDED.defensive_rebounds,
          assists = EXCLUDED.assists,
          steals = EXCLUDED.steals,
          blocks = EXCLUDED.blocks,
          turnovers = EXCLUDED.turnovers,
          personal_fouls = EXCLUDED.personal_fouls,
          plus_minus = EXCLUDED.plus_minus,
          possessions = EXCLUDED.possessions,
          minutes = EXCLUDED.minutes,
          is_home = EXCLUDED.is_home,
          updated_at = now()
        RETURNING (xmax = 0) AS inserted
      `, [
        teamGame.game_id,
        teamGame.team_id,
        stats.points,
        stats.field_goals_made,
        stats.field_goals_attempted,
        stats.three_pointers_made,
        stats.three_pointers_attempted,
        stats.free_throws_made,
        stats.free_throws_attempted,
        stats.rebounds,
        stats.offensive_rebounds,
        stats.defensive_rebounds,
        stats.assists,
        stats.steals,
        stats.blocks,
        stats.turnovers,
        stats.personal_fouls,
        stats.plus_minus,
        stats.possessions,
        stats.minutes,
        isHome
      ]);
      
      if (result.rows[0].inserted) {
        inserted++;
      } else {
        updated++;
      }
    } else {
      // Dry run - just count
      const existing = await pool.query(
        `SELECT game_id FROM bbref_team_game_stats WHERE game_id = $1 AND team_id = $2`,
        [teamGame.game_id, teamGame.team_id]
      );
      
      if (existing.rows.length === 0) {
        inserted++;
      } else {
        updated++;
      }
    }
  }
  
  console.log(`✅ Team stats: ${inserted} inserted, ${updated} updated\n`);
  return { inserted, updated };
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const playersOnly = args.includes('--players-only');
  const teamsOnly = args.includes('--teams-only');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  try {
    let playerResults = { inserted: 0, updated: 0, skipped: 0 };
    let teamResults = { inserted: 0, updated: 0 };
    
    if (!teamsOnly) {
      playerResults = await populatePlayerStats(dryRun);
    }
    
    if (!playersOnly) {
      teamResults = await populateTeamStats(dryRun);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    if (!teamsOnly) {
      console.log(`Player Stats: ${playerResults.inserted} inserted, ${playerResults.updated} updated, ${playerResults.skipped} skipped`);
    }
    if (!playersOnly) {
      console.log(`Team Stats: ${teamResults.inserted} inserted, ${teamResults.updated} updated`);
    }
    console.log('='.repeat(60) + '\n');
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

