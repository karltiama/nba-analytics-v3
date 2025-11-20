import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Migrate existing bbref games to the new bbref_schedule table
 * This preserves the Basketball Reference schedule data while cleaning up the games table
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function migrateToScheduleTable() {
  console.log('Migrating bbref games to bbref_schedule table...\n');
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // First, create the table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS bbref_schedule (
        bbref_game_id     text primary key,
        game_date         date not null,
        home_team_abbr    text not null,
        away_team_abbr    text not null,
        home_team_id      text references teams(team_id),
        away_team_id      text references teams(team_id),
        canonical_game_id text references games(game_id),
        season            text,
        created_at        timestamptz not null default now(),
        updated_at        timestamptz not null default now(),
        constraint bbref_schedule_home_away_check check (home_team_id <> away_team_id)
      )
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS bbref_schedule_date_idx ON bbref_schedule (game_date)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS bbref_schedule_canonical_idx ON bbref_schedule (canonical_game_id) 
      WHERE canonical_game_id IS NOT NULL
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS bbref_schedule_teams_idx ON bbref_schedule (home_team_id, away_team_id) 
      WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL
    `);
    
    // Migrate all bbref games to the schedule table
    const migrateResult = await client.query(`
      INSERT INTO bbref_schedule (
        bbref_game_id,
        game_date,
        home_team_abbr,
        away_team_abbr,
        home_team_id,
        away_team_id,
        season
      )
      SELECT 
        g.game_id,
        DATE(g.start_time AT TIME ZONE 'America/New_York') as game_date,
        ht.abbreviation as home_team_abbr,
        at.abbreviation as away_team_abbr,
        g.home_team_id,
        g.away_team_id,
        g.season
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE g.game_id LIKE 'bbref_%'
      ON CONFLICT (bbref_game_id) DO UPDATE SET
        game_date = excluded.game_date,
        home_team_abbr = excluded.home_team_abbr,
        away_team_abbr = excluded.away_team_abbr,
        home_team_id = excluded.home_team_id,
        away_team_id = excluded.away_team_id,
        season = excluded.season,
        updated_at = now()
      RETURNING bbref_game_id
    `);
    
    console.log(`Migrated ${migrateResult.rowCount} games to bbref_schedule table`);
    
    // Try to match bbref schedule entries to canonical games
    console.log('\nMatching bbref schedule entries to canonical games...\n');
    
    const matchResult = await client.query(`
      UPDATE bbref_schedule bs
      SET canonical_game_id = (
        SELECT g.game_id
        FROM games g
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        WHERE DATE(g.start_time AT TIME ZONE 'America/New_York') = bs.game_date
          AND ht.abbreviation = bs.home_team_abbr
          AND at.abbreviation = bs.away_team_abbr
          AND (g.game_id LIKE '002%' OR g.game_id LIKE '184%')
        ORDER BY CASE WHEN g.game_id LIKE '002%' THEN 1 ELSE 2 END
        LIMIT 1
      )
      WHERE canonical_game_id IS NULL
      RETURNING bbref_game_id, canonical_game_id
    `);
    
    console.log(`Matched ${matchResult.rowCount} bbref schedule entries to canonical games`);
    
    await client.query('COMMIT');
    
    // Show summary
    const summary = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(canonical_game_id) as matched,
        COUNT(*) - COUNT(canonical_game_id) as unmatched
      FROM bbref_schedule
    `);
    
    console.log('\nSummary:');
    console.log(`  Total bbref schedule entries: ${summary.rows[0].total}`);
    console.log(`  Matched to canonical games: ${summary.rows[0].matched}`);
    console.log(`  Unmatched: ${summary.rows[0].unmatched}`);
    
    console.log('\nMigration complete!');
    console.log('\nNext steps:');
    console.log('  - bbref_schedule table now contains the Basketball Reference schedule');
    console.log('  - You can use this table to validate/enrich the main games table');
    console.log('  - Games with box scores are still in the games table and linked via canonical_game_id');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error during migration:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateToScheduleTable().catch(console.error);

