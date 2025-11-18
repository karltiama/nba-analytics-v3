import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Cleanup script to remove duplicate games from the database.
 * 
 * This script:
 * 1. Identifies duplicate games (same date + teams)
 * 2. Keeps the "best" game (prefers NBA Stats IDs, Final games with scores)
 * 3. Moves box scores and provider mappings to the canonical game
 * 4. Deletes duplicate games
 * 
 * Usage:
 *   tsx scripts/cleanup-duplicate-games.ts --dry-run  # Preview changes
 *   tsx scripts/cleanup-duplicate-games.ts            # Actually delete duplicates
 *   tsx scripts/cleanup-duplicate-games.ts --season 2025-26
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

interface DuplicateGroup {
  game_date_et: string;
  home_team_id: string;
  away_team_id: string;
  home_abbr: string;
  away_abbr: string;
  games: Array<{
    game_id: string;
    status: string;
    has_scores: boolean;
    has_boxscore: boolean;
    source: string;
    score: number;
  }>;
  canonical_game_id: string;
}

async function findDuplicateGroups(season?: string): Promise<DuplicateGroup[]> {
  const query = `
    with game_details as (
      select 
        g.game_id,
        g.season,
        (g.start_time at time zone 'America/New_York')::date as game_date_et,
        g.home_team_id,
        g.away_team_id,
        g.status,
        g.home_score,
        g.away_score,
        g.start_time,
        case when g.game_id like '002%' then 'NBA Stats'
             when g.game_id like '184%' then 'BallDontLie'
             else 'Other' end as source,
        case when g.home_score is not null and g.away_score is not null then 1 else 0 end as has_scores,
        case when exists (select 1 from player_game_stats pgs where pgs.game_id = g.game_id) then 1 else 0 end as has_boxscore,
        -- Scoring: prefer NBA Stats (10), Final with scores (5), Final (3), has boxscore (2)
        (case when g.game_id like '002%' then 10 else 0 end +
         case when g.status = 'Final' and g.home_score is not null and g.away_score is not null then 5 else 0 end +
         case when g.status = 'Final' then 3 else 0 end +
         case when exists (select 1 from player_game_stats pgs where pgs.game_id = g.game_id) then 2 else 0 end) as score
      from games g
      ${season ? 'where g.season = $1' : ''}
    ),
    duplicate_pairs as (
      -- Find games that are duplicates (same teams, within 48 hours)
      select 
        g1.game_id as game1_id,
        g2.game_id as game2_id,
        g1.score as score1,
        g2.score as score2,
        case when g1.score >= g2.score then g1.game_id else g2.game_id end as canonical_id,
        case when g1.score >= g2.score then g2.game_id else g1.game_id end as duplicate_id
      from game_details g1
      join game_details g2 on (
        g1.home_team_id = g2.home_team_id
        and g1.away_team_id = g2.away_team_id
        and g1.game_id < g2.game_id
        and abs(extract(epoch from (g1.start_time - g2.start_time))) < 172800  -- Within 48 hours
      )
      ${season ? 'where g1.season = $1' : ''}
    ),
    canonical_games as (
      select distinct canonical_id
      from duplicate_pairs
    )
    select 
      cg.canonical_id as canonical_game_id,
      gd.game_date_et,
      gd.home_team_id,
      gd.away_team_id,
      array_agg(gd_all.game_id order by gd_all.score desc, gd_all.game_id) filter (where gd_all.game_id is not null) as game_ids,
      array_agg(gd_all.status order by gd_all.score desc, gd_all.game_id) filter (where gd_all.status is not null) as statuses,
      array_agg(gd_all.source order by gd_all.score desc, gd_all.game_id) filter (where gd_all.source is not null) as sources,
      array_agg(gd_all.has_scores order by gd_all.score desc, gd_all.game_id) filter (where gd_all.has_scores is not null) as has_scores_array,
      array_agg(gd_all.has_boxscore order by gd_all.score desc, gd_all.game_id) filter (where gd_all.has_boxscore is not null) as has_boxscore_array,
      array_agg(gd_all.score order by gd_all.score desc, gd_all.game_id) filter (where gd_all.score is not null) as scores,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    from canonical_games cg
    join game_details gd on cg.canonical_id = gd.game_id
    join duplicate_pairs dp on (dp.canonical_id = cg.canonical_id or dp.duplicate_id = cg.canonical_id)
    join game_details gd_all on (gd_all.game_id = dp.game1_id or gd_all.game_id = dp.game2_id)
    join teams ht on gd.home_team_id = ht.team_id
    join teams at on gd.away_team_id = at.team_id
    group by cg.canonical_id, gd.game_date_et, gd.home_team_id, gd.away_team_id, ht.abbreviation, at.abbreviation
    order by gd.game_date_et desc
  `;

  const result = await pool.query(query, season ? [season] : []);
  
  return result.rows.map(row => ({
    game_date_et: row.game_date_et,
    home_team_id: row.home_team_id,
    away_team_id: row.away_team_id,
    home_abbr: row.home_abbr,
    away_abbr: row.away_abbr,
    canonical_game_id: row.canonical_game_id,
    games: row.game_ids.map((gameId: string, idx: number) => ({
      game_id: gameId,
      status: row.statuses[idx],
      has_scores: row.has_scores_array[idx] === 1,
      has_boxscore: row.has_boxscore_array[idx] === 1,
      source: row.sources[idx],
      score: row.scores[idx],
    })),
  }));
}

async function migrateBoxScores(fromGameId: string, toGameId: string, client: any) {
  // Move player_game_stats
  await client.query(`
    update player_game_stats
    set game_id = $1
    where game_id = $2
  `, [toGameId, fromGameId]);
  
  // Move provider mappings (update internal_id references)
  await client.query(`
    update provider_id_map
    set internal_id = $1
    where entity_type = 'game'
      and internal_id = $2
      and not exists (
        select 1 from provider_id_map pm2
        where pm2.entity_type = 'game'
          and pm2.provider = provider_id_map.provider
          and pm2.provider_id = provider_id_map.provider_id
          and pm2.internal_id = $1
      )
  `, [toGameId, fromGameId]);
  
  // Delete remaining mappings for the old game
  await client.query(`
    delete from provider_id_map
    where entity_type = 'game'
      and internal_id = $1
  `, [fromGameId]);
}

async function copyScores(fromGameId: string, toGameId: string, client: any) {
  // Copy scores from duplicate game to canonical game if canonical doesn't have scores
  await client.query(`
    UPDATE games g1
    SET 
      home_score = g2.home_score,
      away_score = g2.away_score,
      updated_at = now()
    FROM games g2
    WHERE g1.game_id = $1
      AND g2.game_id = $2
      AND (g1.home_score IS NULL OR g1.away_score IS NULL)
      AND (g2.home_score IS NOT NULL AND g2.away_score IS NOT NULL)
  `, [toGameId, fromGameId]);
}

async function cleanupDuplicates(dryRun: boolean, season?: string) {
  console.log('\n🔍 Finding duplicate games...');
  const duplicates = await findDuplicateGroups(season);
  
  if (duplicates.length === 0) {
    console.log('✅ No duplicate games found!');
    return;
  }
  
  console.log(`\nFound ${duplicates.length} sets of duplicate games`);
  console.log(`Total duplicate games to remove: ${duplicates.reduce((sum, d) => sum + d.games.length - 1, 0)}`);
  
  // Show summary
  console.log('\nSummary:');
  duplicates.slice(0, 10).forEach(dup => {
    console.log(`\n  ${dup.game_date_et}: ${dup.away_abbr} @ ${dup.home_abbr}`);
    console.log(`    Keeping: ${dup.canonical_game_id} (${dup.games[0].source}, ${dup.games[0].status})`);
    dup.games.slice(1).forEach(game => {
      console.log(`    Removing: ${game.game_id} (${game.source}, ${game.status})`);
    });
  });
  
  if (dryRun) {
    console.log('\n🔍 DRY RUN - No changes made');
    console.log('Run without --dry-run to actually delete duplicates');
    return;
  }
  
  console.log('\n⚠️  Starting cleanup...');
  const client = await pool.connect();
  
  try {
    await client.query('begin');
    
    let migratedBoxScores = 0;
    let deletedGames = 0;
    
    for (const dup of duplicates) {
      const canonicalId = dup.canonical_game_id;
      const duplicatesToRemove = dup.games.slice(1);
      
      for (const dupGame of duplicatesToRemove) {
        // Copy scores from duplicate to canonical if canonical doesn't have scores
        const canonicalHasScores = dup.games[0].has_scores;
        if (!canonicalHasScores && dupGame.has_scores) {
          console.log(`  Copying scores from ${dupGame.game_id} to ${canonicalId}`);
          await copyScores(dupGame.game_id, canonicalId, client);
        }
        
        // Migrate box scores if the duplicate has them but canonical doesn't
        const canonicalHasBoxscore = dup.games[0].has_boxscore;
        if (dupGame.has_boxscore && !canonicalHasBoxscore) {
          console.log(`  Migrating box scores from ${dupGame.game_id} to ${canonicalId}`);
          await migrateBoxScores(dupGame.game_id, canonicalId, client);
          migratedBoxScores++;
        }
        
        // Delete the duplicate game (cascade will handle player_game_stats and provider mappings)
        console.log(`  Deleting duplicate game ${dupGame.game_id}`);
        await client.query('delete from games where game_id = $1', [dupGame.game_id]);
        deletedGames++;
      }
    }
    
    await client.query('commit');
    
    console.log('\n✅ Cleanup complete!');
    console.log(`  Deleted ${deletedGames} duplicate games`);
    console.log(`  Migrated ${migratedBoxScores} box scores to canonical games`);
  } catch (error) {
    await client.query('rollback');
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const seasonIndex = args.indexOf('--season');
  const season = seasonIndex !== -1 && args[seasonIndex + 1] 
    ? args[seasonIndex + 1] 
    : undefined;

  console.log('🧹 NBA Analytics Database Cleanup');
  console.log('='.repeat(60));
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
  }
  if (season) {
    console.log(`Season filter: ${season}`);
  }

  try {
    await cleanupDuplicates(dryRun, season);
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

