import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Migrate from bbref_schedule + games table dependency to standalone bbref_games table
 * 
 * This script:
 * 1. Creates bbref_games table (if not exists)
 * 2. Migrates data from bbref_schedule to bbref_games
 * 3. Updates foreign key references in bbref_player_game_stats and bbref_team_game_stats
 * 4. Drops old bbref_schedule table (optional, commented out for safety)
 * 
 * Usage:
 *   tsx scripts/migrate-to-bbref-games-table.ts --dry-run  # Preview changes
 *   tsx scripts/migrate-to-bbref-games-table.ts           # Actually migrate
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function migrateToBBRefGames(dryRun: boolean = false) {
  console.log('\n🔄 Migrating to Standalone BBRef Games Table');
  console.log('='.repeat(60));
  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }
  
  const client = await pool.connect();
  
  try {
    if (!dryRun) {
      await client.query('BEGIN');
    }
    
    // Step 1: Create bbref_games table
    console.log('\n📋 Step 1: Creating bbref_games table...');
    if (!dryRun) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS bbref_games (
          bbref_game_id     text primary key,
          game_date         date not null,
          season            text,
          start_time        timestamptz,
          status            text,
          home_team_id      text not null references teams(team_id),
          away_team_id      text not null references teams(team_id),
          home_team_abbr    text not null,
          away_team_abbr    text not null,
          home_score        int,
          away_score        int,
          venue             text,
          created_at        timestamptz not null default now(),
          updated_at        timestamptz not null default now(),
          constraint bbref_games_home_away_check check (home_team_id <> away_team_id)
        );
      `);
      
      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS bbref_games_date_idx ON bbref_games (game_date);
        CREATE INDEX IF NOT EXISTS bbref_games_season_idx ON bbref_games (season);
        CREATE INDEX IF NOT EXISTS bbref_games_teams_idx ON bbref_games (home_team_id, away_team_id);
        CREATE INDEX IF NOT EXISTS bbref_games_status_idx ON bbref_games (status);
        CREATE INDEX IF NOT EXISTS bbref_games_start_time_idx ON bbref_games (start_time);
      `);
    }
    console.log('✅ bbref_games table created');
    
    // Step 2: Migrate data from bbref_schedule to bbref_games
    console.log('\n📋 Step 2: Migrating data from bbref_schedule...');
    
    const scheduleEntries = await pool.query(`
      SELECT 
        bs.bbref_game_id,
        bs.game_date,
        bs.season,
        bs.home_team_id,
        bs.away_team_id,
        bs.home_team_abbr,
        bs.away_team_abbr,
        g.start_time,
        g.status,
        g.home_score,
        g.away_score,
        g.venue
      FROM bbref_schedule bs
      LEFT JOIN games g ON bs.canonical_game_id = g.game_id
      WHERE bs.home_team_id IS NOT NULL AND bs.away_team_id IS NOT NULL
    `);
    
    console.log(`Found ${scheduleEntries.rows.length} schedule entries to migrate`);
    
    let inserted = 0;
    let updated = 0;
    
    for (const entry of scheduleEntries.rows) {
      if (!dryRun) {
        const result = await client.query(`
          INSERT INTO bbref_games (
            bbref_game_id,
            game_date,
            season,
            start_time,
            status,
            home_team_id,
            away_team_id,
            home_team_abbr,
            away_team_abbr,
            home_score,
            away_score,
            venue
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (bbref_game_id) DO UPDATE SET
            game_date = EXCLUDED.game_date,
            season = EXCLUDED.season,
            start_time = COALESCE(EXCLUDED.start_time, bbref_games.start_time),
            status = COALESCE(EXCLUDED.status, bbref_games.status),
            home_score = COALESCE(EXCLUDED.home_score, bbref_games.home_score),
            away_score = COALESCE(EXCLUDED.away_score, bbref_games.away_score),
            venue = COALESCE(EXCLUDED.venue, bbref_games.venue),
            updated_at = now()
          RETURNING (xmax = 0) as is_new
        `, [
          entry.bbref_game_id,
          entry.game_date,
          entry.season,
          entry.start_time,
          entry.status || 'Scheduled',
          entry.home_team_id,
          entry.away_team_id,
          entry.home_team_abbr,
          entry.away_team_abbr,
          entry.home_score,
          entry.away_score,
          entry.venue
        ]);
        
        if (result.rows[0].is_new) {
          inserted++;
        } else {
          updated++;
        }
      } else {
        console.log(`  Would migrate: ${entry.bbref_game_id} - ${entry.away_team_abbr} @ ${entry.home_team_abbr}`);
      }
    }
    
    console.log(`✅ Migrated: ${inserted} inserted, ${updated} updated`);
    
    // Step 3: Drop old foreign key constraints BEFORE updating game_ids
    console.log('\n📋 Step 3: Dropping old foreign key constraints...');
    
    if (!dryRun) {
      // Drop old foreign keys pointing to games table
      await client.query(`
        ALTER TABLE bbref_player_game_stats
        DROP CONSTRAINT IF EXISTS bbref_player_game_stats_game_id_fkey
      `);
      
      await client.query(`
        ALTER TABLE bbref_team_game_stats
        DROP CONSTRAINT IF EXISTS bbref_team_game_stats_game_id_fkey
      `);
    }
    
    console.log('✅ Old foreign key constraints dropped');
    
    // Step 4: Update foreign keys in bbref_player_game_stats
    console.log('\n📋 Step 4: Updating bbref_player_game_stats foreign keys...');
    
    // First, check how many rows need updating
    const playerStatsCheck = await client.query(`
      SELECT COUNT(*) as total
      FROM bbref_player_game_stats bpgs
      WHERE NOT EXISTS (
        SELECT 1 FROM bbref_games bg WHERE bg.bbref_game_id = bpgs.game_id
      )
    `);
    
    console.log(`Found ${playerStatsCheck.rows[0].total} player stats rows that need game_id mapping`);
    
    // Map old game_ids to new bbref_game_ids
    // If game_id is already a bbref_game_id format, use it directly
    // Otherwise, try to find it via canonical_game_id in bbref_schedule
    const playerStatsToUpdate = await client.query(`
      SELECT DISTINCT bpgs.game_id as old_game_id
      FROM bbref_player_game_stats bpgs
      WHERE NOT EXISTS (
        SELECT 1 FROM bbref_games bg WHERE bg.bbref_game_id = bpgs.game_id
      )
    `);
    
    let playerStatsUpdated = 0;
    for (const row of playerStatsToUpdate.rows) {
      // Try to find matching bbref_game_id
      const match = await client.query(`
        SELECT bs.bbref_game_id
        FROM bbref_schedule bs
        WHERE bs.canonical_game_id = $1
        LIMIT 1
      `, [row.old_game_id]);
      
      if (match.rows.length > 0) {
        const newGameId = match.rows[0].bbref_game_id;
        if (!dryRun) {
          await client.query(`
            UPDATE bbref_player_game_stats
            SET game_id = $1
            WHERE game_id = $2
          `, [newGameId, row.old_game_id]);
          playerStatsUpdated++;
        } else {
          console.log(`  Would update: ${row.old_game_id} -> ${newGameId}`);
        }
      } else {
        console.warn(`  ⚠️  No match found for game_id: ${row.old_game_id}`);
      }
    }
    
    console.log(`✅ Updated ${playerStatsUpdated} player stats rows`);
    
    // Step 5: Update foreign keys in bbref_team_game_stats
    console.log('\n📋 Step 5: Updating bbref_team_game_stats foreign keys...');
    
    const teamStatsToUpdate = await client.query(`
      SELECT DISTINCT btgs.game_id as old_game_id
      FROM bbref_team_game_stats btgs
      WHERE NOT EXISTS (
        SELECT 1 FROM bbref_games bg WHERE bg.bbref_game_id = btgs.game_id
      )
    `);
    
    let teamStatsUpdated = 0;
    for (const row of teamStatsToUpdate.rows) {
      // Try to find matching bbref_game_id
      const match = await client.query(`
        SELECT bs.bbref_game_id
        FROM bbref_schedule bs
        WHERE bs.canonical_game_id = $1
        LIMIT 1
      `, [row.old_game_id]);
      
      if (match.rows.length > 0) {
        const newGameId = match.rows[0].bbref_game_id;
        if (!dryRun) {
          await client.query(`
            UPDATE bbref_team_game_stats
            SET game_id = $1
            WHERE game_id = $2
          `, [newGameId, row.old_game_id]);
          teamStatsUpdated++;
        } else {
          console.log(`  Would update: ${row.old_game_id} -> ${newGameId}`);
        }
      } else {
        console.warn(`  ⚠️  No match found for game_id: ${row.old_game_id}`);
      }
    }
    
    console.log(`✅ Updated ${teamStatsUpdated} team stats rows`);
    
    // Step 6: Add new foreign key constraints pointing to bbref_games
    console.log('\n📋 Step 6: Adding new foreign key constraints...');
    
    if (!dryRun) {
      // Add new foreign keys pointing to bbref_games
      await client.query(`
        ALTER TABLE bbref_player_game_stats
        ADD CONSTRAINT bbref_player_game_stats_game_id_fkey
        FOREIGN KEY (game_id) REFERENCES bbref_games(bbref_game_id) ON DELETE CASCADE
      `);
      
      await client.query(`
        ALTER TABLE bbref_team_game_stats
        ADD CONSTRAINT bbref_team_game_stats_game_id_fkey
        FOREIGN KEY (game_id) REFERENCES bbref_games(bbref_game_id) ON DELETE CASCADE
      `);
    }
    
    console.log('✅ New foreign key constraints added');
    
    if (!dryRun) {
      await client.query('COMMIT');
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Migration Complete!');
    console.log('='.repeat(60));
    console.log(`Games migrated: ${inserted} inserted, ${updated} updated`);
    console.log(`Player stats updated: ${playerStatsUpdated}`);
    console.log(`Team stats updated: ${teamStatsUpdated}`);
    
    if (dryRun) {
      console.log('\n⚠️  This was a dry run. Run without --dry-run to actually migrate.');
    } else {
      console.log('\n📝 Next steps:');
      console.log('   1. Update queries in lib/teams/bbref-queries.ts to use bbref_games');
      console.log('   2. Update population scripts to use bbref_games');
      console.log('   3. (Optional) Drop bbref_schedule table if no longer needed');
    }
    
  } catch (error: any) {
    if (!dryRun) {
      await client.query('ROLLBACK');
    }
    console.error('\n❌ Error during migration:', error.message);
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
    await migrateToBBRefGames(dryRun);
  } catch (error: any) {
    console.error('\nFatal error:', error.message);
    process.exit(1);
  }
}

main();

