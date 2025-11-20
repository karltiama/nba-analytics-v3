import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Fix games with bbref_ prefixed IDs by:
 * 1. Finding corresponding NBA Stats or BallDontLie games
 * 2. Migrating box scores and data to the canonical game ID
 * 3. Deleting the bbref game
 * 
 * Usage:
 *   tsx scripts/fix-bbref-game-ids.ts --dry-run  # Preview changes
 *   tsx scripts/fix-bbref-game-ids.ts             # Actually fix
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

interface GameToFix {
  bbref_game_id: string;
  bbref_date: string;
  bbref_home: string;
  bbref_away: string;
  bbref_status: string;
  bbref_home_score: number | null;
  bbref_away_score: number | null;
  has_boxscore: boolean;
  canonical_game_id: string | null;
  canonical_source: string | null;
}

async function findBbrefGames(): Promise<GameToFix[]> {
  const result = await pool.query(`
    SELECT 
      g.game_id as bbref_game_id,
      DATE(g.start_time AT TIME ZONE 'America/New_York') as bbref_date,
      ht.abbreviation as bbref_home,
      at.abbreviation as bbref_away,
      g.status as bbref_status,
      g.home_score as bbref_home_score,
      g.away_score as bbref_away_score,
      EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id) as has_boxscore
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.game_id LIKE 'bbref_%'
    ORDER BY g.start_time DESC
  `);
  
  const gamesToFix: GameToFix[] = [];
  
  for (const row of result.rows) {
    // Try to find corresponding canonical game (NBA Stats or BDL)
    const canonical = await pool.query(`
      SELECT 
        g.game_id,
        CASE 
          WHEN g.game_id LIKE '002%' THEN 'NBA Stats'
          WHEN g.game_id LIKE '184%' THEN 'BallDontLie'
          ELSE 'Other'
        END as source
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE DATE(g.start_time AT TIME ZONE 'America/New_York') = $1::date
        AND ht.abbreviation = $2
        AND at.abbreviation = $3
        AND g.game_id != $4
        AND (g.game_id LIKE '002%' OR g.game_id LIKE '184%')
      ORDER BY 
        CASE WHEN g.game_id LIKE '002%' THEN 1 ELSE 2 END,  -- Prefer NBA Stats
        g.game_id
      LIMIT 1
    `, [
      row.bbref_date,
      row.bbref_home,
      row.bbref_away,
      row.bbref_game_id
    ]);
    
    gamesToFix.push({
      bbref_game_id: row.bbref_game_id,
      bbref_date: row.bbref_date,
      bbref_home: row.bbref_home,
      bbref_away: row.bbref_away,
      bbref_status: row.bbref_status,
      bbref_home_score: row.bbref_home_score,
      bbref_away_score: row.bbref_away_score,
      has_boxscore: row.has_boxscore,
      canonical_game_id: canonical.rows.length > 0 ? canonical.rows[0].game_id : null,
      canonical_source: canonical.rows.length > 0 ? canonical.rows[0].source : null,
    });
  }
  
  return gamesToFix;
}

async function migrateBoxScores(fromGameId: string, toGameId: string, client: any): Promise<number> {
  // Update player_game_stats
  const result = await client.query(`
    UPDATE player_game_stats
    SET game_id = $1, updated_at = now()
    WHERE game_id = $2
    RETURNING player_id
  `, [toGameId, fromGameId]);
  
  return result.rowcount;
}

async function migrateTeamStats(fromGameId: string, toGameId: string, client: any): Promise<number> {
  // Update team_game_stats
  const result = await client.query(`
    UPDATE team_game_stats
    SET game_id = $1, updated_at = now()
    WHERE game_id = $2
    RETURNING team_id
  `, [toGameId, fromGameId]);
  
  return result.rowcount;
}

async function copyScores(fromGameId: string, toGameId: string, client: any): Promise<boolean> {
  // Get scores from bbref game
  const bbrefGame = await client.query(
    'SELECT home_score, away_score FROM games WHERE game_id = $1',
    [fromGameId]
  );
  
  if (bbrefGame.rows.length === 0) {
    return false;
  }
  
  const { home_score, away_score } = bbrefGame.rows[0];
  
  // Update canonical game scores if they're missing
  if (home_score !== null || away_score !== null) {
    const canonicalGame = await client.query(
      'SELECT home_score, away_score FROM games WHERE game_id = $1',
      [toGameId]
    );
    
    if (canonicalGame.rows.length > 0) {
      const canonical = canonicalGame.rows[0];
      
      // Only update if canonical is missing scores
      if ((canonical.home_score === null && home_score !== null) ||
          (canonical.away_score === null && away_score !== null)) {
        await client.query(
          `UPDATE games 
           SET home_score = COALESCE($1, home_score),
               away_score = COALESCE($2, away_score),
               updated_at = now()
           WHERE game_id = $3`,
          [home_score, away_score, toGameId]
        );
        return true;
      }
    }
  }
  
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  console.log('\nFix Basketball Reference Game IDs');
  console.log('='.repeat(60));
  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }
  
  const gamesToFix = await findBbrefGames();
  
  if (gamesToFix.length === 0) {
    console.log('No games with bbref_ prefix found!');
    await pool.end();
    return;
  }
  
  console.log(`\nFound ${gamesToFix.length} games with bbref_ prefix\n`);
  
  // Group by whether they have a canonical game
  const withCanonical = gamesToFix.filter(g => g.canonical_game_id !== null);
  const withoutCanonical = gamesToFix.filter(g => g.canonical_game_id === null);
  
  console.log(`Games with canonical match: ${withCanonical.length}`);
  console.log(`Games without canonical match: ${withoutCanonical.length}\n`);
  
  if (withoutCanonical.length > 0) {
    const withoutBoxscores = withoutCanonical.filter(g => !g.has_boxscore);
    const withBoxscores = withoutCanonical.filter(g => g.has_boxscore);
    
    console.log('Games without canonical match:');
    console.log(`  Without box scores: ${withoutBoxscores.length} (can be safely deleted)`);
    console.log(`  With box scores: ${withBoxscores.length} (need manual review)\n`);
    
    if (withoutBoxscores.length > 0) {
      console.log('Games without box scores (safe to delete):\n');
      withoutBoxscores.slice(0, 10).forEach((game, idx) => {
        console.log(`  ${idx + 1}. ${game.bbref_game_id}`);
        console.log(`     ${game.bbref_date} | ${game.bbref_away} @ ${game.bbref_home}`);
      });
      if (withoutBoxscores.length > 10) {
        console.log(`  ... and ${withoutBoxscores.length - 10} more`);
      }
      console.log('');
    }
    
    if (withBoxscores.length > 0) {
      console.log('Games with box scores (need review):\n');
      withBoxscores.slice(0, 10).forEach((game, idx) => {
        console.log(`  ${idx + 1}. ${game.bbref_game_id}`);
        console.log(`     ${game.bbref_date} | ${game.bbref_away} @ ${game.bbref_home}`);
      });
      if (withBoxscores.length > 10) {
        console.log(`  ... and ${withBoxscores.length - 10} more`);
      }
      console.log('');
    }
  }
  
  if (dryRun) {
    const withoutBoxscores = withoutCanonical.filter(g => !g.has_boxscore);
    const withBoxscores = withoutCanonical.filter(g => g.has_boxscore);
    if (withCanonical.length > 0) {
      console.log('\nDRY RUN - Would migrate the following:\n');
      withCanonical.slice(0, 20).forEach((game, idx) => {
        console.log(`${idx + 1}. ${game.bbref_game_id} -> ${game.canonical_game_id} (${game.canonical_source})`);
        console.log(`   ${game.bbref_date} | ${game.bbref_away} @ ${game.bbref_home}`);
        console.log(`   Box: ${game.has_boxscore ? 'Yes' : 'No'}`);
      });
      if (withCanonical.length > 20) {
        console.log(`\n... and ${withCanonical.length - 20} more`);
      }
    }
    
    if (withoutBoxscores.length > 0) {
      console.log(`\nDRY RUN - Would delete ${withoutBoxscores.length} games without box scores`);
      console.log('(These are empty schedule entries with no data)');
    }
    
    if (withBoxscores.length > 0) {
      console.log(`\nDRY RUN - ${withBoxscores.length} games with box scores would be left for manual review`);
      console.log('(These have player stats but no matching canonical game)');
    }
    
    console.log('\nRun without --dry-run to actually migrate and delete.');
    await pool.end();
    return;
  }
  
  const withoutBoxscores = withoutCanonical.filter(g => !g.has_boxscore);
  const withBoxscores = withoutCanonical.filter(g => g.has_boxscore);
  
  // Actually migrate
  if (withCanonical.length > 0) {
    console.log('\nMigrating games with canonical matches...\n');
  }
  
  const client = await pool.connect();
  let migrated = 0;
  let deleted = 0;
  let errors = 0;
  
  try {
    for (const game of withCanonical) {
      try {
        await client.query('BEGIN');
        
        let migratedBoxScores = 0;
        let migratedTeamStats = 0;
        let copiedScores = false;
        
        // Migrate box scores
        if (game.has_boxscore) {
          migratedBoxScores = await migrateBoxScores(
            game.bbref_game_id,
            game.canonical_game_id!,
            client
          );
          
          // Also migrate team stats if they exist
          migratedTeamStats = await migrateTeamStats(
            game.bbref_game_id,
            game.canonical_game_id!,
            client
          );
        }
        
        // Copy scores if canonical game is missing them
        copiedScores = await copyScores(
          game.bbref_game_id,
          game.canonical_game_id!,
          client
        );
        
        // Delete the bbref game
        await client.query('DELETE FROM games WHERE game_id = $1', [game.bbref_game_id]);
        
        await client.query('COMMIT');
        
        console.log(`Migrated ${game.bbref_game_id} -> ${game.canonical_game_id}`);
        if (migratedBoxScores > 0) {
          console.log(`   Migrated ${migratedBoxScores} player stats`);
        }
        if (migratedTeamStats > 0) {
          console.log(`   Migrated ${migratedTeamStats} team stats`);
        }
        if (copiedScores) {
          console.log(`   Copied scores`);
        }
        
        migrated++;
        deleted++;
      } catch (error: any) {
        await client.query('ROLLBACK');
        console.error(`Error migrating ${game.bbref_game_id}: ${error.message}`);
        errors++;
      }
    }
    
    // Delete games without box scores that don't have canonical matches
    if (withoutBoxscores.length > 0) {
      console.log(`\nDeleting ${withoutBoxscores.length} bbref games without box scores...\n`);
      for (const game of withoutBoxscores) {
        try {
          await client.query('BEGIN');
          await client.query('DELETE FROM games WHERE game_id = $1', [game.bbref_game_id]);
          await client.query('COMMIT');
          console.log(`Deleted ${game.bbref_game_id} (no box score, no canonical match)`);
          deleted++;
        } catch (error: any) {
          await client.query('ROLLBACK');
          console.error(`Error deleting ${game.bbref_game_id}: ${error.message}`);
          errors++;
        }
      }
    }
    
    console.log(`\nMigration complete!`);
    console.log(`   Migrated: ${migrated}`);
    console.log(`   Deleted: ${deleted}`);
    console.log(`   Errors: ${errors}`);
    
    const withBoxscores = withoutCanonical.filter(g => g.has_boxscore);
    if (withBoxscores.length > 0) {
      console.log(`\n${withBoxscores.length} games with box scores but no canonical match need manual review`);
      console.log('These games have player stats but no corresponding BallDontLie or NBA Stats game.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);

