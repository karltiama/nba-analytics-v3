import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Sync games from bbref_schedule (authoritative source) to games table
 * 
 * This script:
 * 1. Reads schedule from bbref_schedule table
 * 2. Creates/updates games in the games table
 * 3. Matches bbref games to existing canonical games (002... or 184...)
 * 4. Creates new games with BallDontLie-style IDs (184...) if no match exists
 * 5. Updates canonical_game_id in bbref_schedule when matched
 * 
 * Usage:
 *   tsx scripts/sync-games-from-bbref-schedule.ts --dry-run  # Preview changes
 *   tsx scripts/sync-games-from-bbref-schedule.ts             # Actually sync
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

function generateBallDontLieId(date: Date, homeTeamId: string, awayTeamId: string): string {
  // Generate a BallDontLie-style ID (184...)
  // Use date + teams to create a deterministic but unique ID
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  const teamHash = (homeTeamId.charCodeAt(0) + awayTeamId.charCodeAt(0)) % 100;
  return `184${dateStr}${String(teamHash).padStart(2, '0')}`;
}

async function syncSchedule(dryRun: boolean = false) {
  console.log('\nSyncing games from bbref_schedule to games table');
  console.log('='.repeat(60));
  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }
  
  // Get all bbref schedule entries
  const scheduleEntries = await pool.query(`
    SELECT 
      bs.bbref_game_id,
      bs.game_date,
      bs.home_team_abbr,
      bs.away_team_abbr,
      bs.home_team_id,
      bs.away_team_id,
      bs.canonical_game_id,
      bs.season,
      g.game_id as existing_game_id,
      g.start_time as existing_start_time,
      g.status as existing_status,
      g.home_score as existing_home_score,
      g.away_score as existing_away_score
    FROM bbref_schedule bs
    LEFT JOIN games g ON bs.canonical_game_id = g.game_id
    WHERE bs.home_team_id IS NOT NULL 
      AND bs.away_team_id IS NOT NULL
    ORDER BY bs.game_date ASC, bs.home_team_abbr, bs.away_team_abbr
  `);
  
  console.log(`Found ${scheduleEntries.rows.length} schedule entries\n`);
  
  const client = await pool.connect();
  let created = 0;
  let updated = 0;
  let matched = 0;
  let errors = 0;
  
  try {
    if (!dryRun) {
      await client.query('BEGIN');
    }
    
    for (const entry of scheduleEntries.rows) {
      try {
        // Try to find existing game by date and teams
        const existingGame = await client.query(`
          SELECT game_id, start_time, status, home_score, away_score
          FROM games
          WHERE DATE(start_time AT TIME ZONE 'America/New_York') = $1::date
            AND home_team_id = $2
            AND away_team_id = $3
            AND (game_id LIKE '002%' OR game_id LIKE '184%')
          ORDER BY CASE WHEN game_id LIKE '002%' THEN 1 ELSE 2 END
          LIMIT 1
        `, [entry.game_date, entry.home_team_id, entry.away_team_id]);
        
        let gameId: string;
        let isNew = false;
        
        if (existingGame.rows.length > 0) {
          // Match found - use existing game ID
          gameId = existingGame.rows[0].game_id;
          
          // Update bbref_schedule to link to this canonical game
          if (!entry.canonical_game_id || entry.canonical_game_id !== gameId) {
            if (!dryRun) {
              await client.query(`
                UPDATE bbref_schedule 
                SET canonical_game_id = $1, updated_at = now()
                WHERE bbref_game_id = $2
              `, [gameId, entry.bbref_game_id]);
            }
            matched++;
          }
          
          // Update game if needed (preserve scores/status if they exist)
          const existing = existingGame.rows[0];
          const needsUpdate = 
            !existing.start_time || 
            (existing.status !== 'Final' && existing.status !== 'Cancelled' && existing.status !== 'Postponed');
          
          if (needsUpdate && !dryRun) {
            // Set start_time to game_date at a reasonable time (7:00 PM ET)
            const startTime = new Date(entry.game_date);
            startTime.setHours(19, 0, 0, 0); // 7:00 PM ET
            
            await client.query(`
              UPDATE games
              SET start_time = COALESCE(start_time, $1::timestamptz),
                  season = COALESCE(season, $2),
                  status = CASE 
                    WHEN status IS NULL OR status NOT IN ('Final', 'Scheduled', 'InProgress', 'Postponed', 'Cancelled')
                      THEN 'Scheduled'
                    ELSE status
                  END,
                  updated_at = now()
              WHERE game_id = $3
            `, [startTime.toISOString(), entry.season, gameId]);
            updated++;
          }
        } else {
          // No match found - create new game
          const gameDate = new Date(entry.game_date);
          gameId = generateBallDontLieId(gameDate, entry.home_team_id, entry.away_team_id);
          isNew = true;
          
          // Set start_time to game_date at 7:00 PM ET
          const startTime = new Date(entry.game_date);
          startTime.setHours(19, 0, 0, 0); // 7:00 PM ET
          
          if (!dryRun) {
            await client.query(`
              INSERT INTO games (
                game_id,
                season,
                start_time,
                status,
                home_team_id,
                away_team_id,
                home_score,
                away_score,
                venue,
                created_at,
                updated_at
              ) VALUES ($1, $2, $3, 'Scheduled', $4, $5, NULL, NULL, NULL, now(), now())
              ON CONFLICT (game_id) DO UPDATE SET
                season = excluded.season,
                start_time = COALESCE(games.start_time, excluded.start_time),
                updated_at = now()
            `, [
              gameId,
              entry.season,
              startTime.toISOString(),
              entry.home_team_id,
              entry.away_team_id,
            ]);
            
            // Update bbref_schedule to link to this new game
            await client.query(`
              UPDATE bbref_schedule 
              SET canonical_game_id = $1, updated_at = now()
              WHERE bbref_game_id = $2
            `, [gameId, entry.bbref_game_id]);
          }
          
          created++;
        }
        
        if (dryRun && (isNew || (existingGame.rows.length > 0 && !entry.canonical_game_id))) {
          const action = isNew ? 'CREATE' : 'MATCH';
          console.log(`${action}: ${entry.away_team_abbr} @ ${entry.home_team_abbr} (${entry.game_date}) -> ${gameId}`);
        }
      } catch (error: any) {
        console.error(`Error processing ${entry.bbref_game_id}: ${error.message}`);
        errors++;
      }
    }
    
    if (!dryRun) {
      await client.query('COMMIT');
    }
    
    console.log(`\nSync complete!`);
    console.log(`  Created: ${created}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Matched: ${matched}`);
    console.log(`  Errors: ${errors}`);
    
    if (dryRun) {
      console.log('\nRun without --dry-run to actually sync games.');
    }
  } catch (error: any) {
    if (!dryRun) {
      await client.query('ROLLBACK');
    }
    console.error('\nError during sync:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  try {
    await syncSchedule(dryRun);
  } catch (error: any) {
    console.error('\nFatal error:', error.message);
    process.exit(1);
  }
}

main();

