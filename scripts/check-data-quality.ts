import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Comprehensive data quality check script for NBA analytics database.
 * 
 * Checks for:
 * - Duplicate games (same date + teams)
 * - Games missing provider mappings
 * - Games with inconsistent scores/status
 * - Orphaned records
 * - Missing box scores for Final games
 * - Date/timezone issues
 * 
 * Usage:
 *   tsx scripts/check-data-quality.ts
 *   tsx scripts/check-data-quality.ts --season 2025-26
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

interface QualityIssue {
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  count?: number;
  examples?: any[];
}

const issues: QualityIssue[] = [];

async function checkDuplicateGames(season?: string) {
  console.log('\n🔍 Checking for duplicate games...');
  
  const query = `
    with game_groups as (
      select 
        (g.start_time at time zone 'America/New_York')::date as game_date_et,
        g.home_team_id,
        g.away_team_id,
        count(*) as game_count,
        array_agg(g.game_id order by g.game_id) as game_ids,
        array_agg(g.status order by g.game_id) as statuses,
        array_agg(case when g.game_id like '002%' then 'NBA' when g.game_id like '184%' then 'BDL' else 'OTHER' end order by g.game_id) as sources
      from games g
      ${season ? 'where g.season = $1' : ''}
      group by 
        (g.start_time at time zone 'America/New_York')::date,
        g.home_team_id,
        g.away_team_id
      having count(*) > 1
    )
    select 
      gg.*,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    from game_groups gg
    join teams ht on gg.home_team_id = ht.team_id
    join teams at on gg.away_team_id = at.team_id
    order by gg.game_date_et desc, gg.game_count desc
    limit 20
  `;

  const result = await pool.query(query, season ? [season] : []);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'duplicate_games',
      severity: 'error',
      message: `Found ${result.rows.length} sets of duplicate games (same date + teams)`,
      count: result.rows.reduce((sum, row) => sum + row.game_count - 1, 0),
      examples: result.rows.slice(0, 5).map(row => ({
        date: row.game_date_et,
        teams: `${row.away_abbr} @ ${row.home_abbr}`,
        count: row.game_count,
        game_ids: row.game_ids,
        sources: row.sources,
        statuses: row.statuses,
      })),
    });
    console.log(`  ❌ Found ${result.rows.length} duplicate game groups`);
  } else {
    console.log('  ✅ No duplicate games found');
  }
}

async function checkMissingProviderMappings(season?: string) {
  console.log('\n🔍 Checking for games missing provider mappings...');
  
  const query = `
    select 
      g.game_id,
      g.season,
      g.start_time,
      g.status,
      case 
        when g.game_id like '002%' then 'NBA Stats'
        when g.game_id like '184%' then 'BallDontLie'
        else 'Unknown'
      end as source,
      (select count(*) from provider_id_map pm 
       where pm.entity_type = 'game' and pm.internal_id = g.game_id) as mapping_count
    from games g
    where ${season ? 'g.season = $1 and' : ''} not exists (
      select 1 from provider_id_map pm
      where pm.entity_type = 'game' 
        and (pm.internal_id = g.game_id or pm.provider_id = g.game_id)
    )
    order by g.start_time desc
    limit 20
  `;

  const result = await pool.query(query, season ? [season] : []);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'missing_mappings',
      severity: 'warning',
      message: `Found ${result.rows.length} games without provider mappings`,
      count: result.rows.length,
      examples: result.rows.slice(0, 5).map(row => ({
        game_id: row.game_id,
        source: row.source,
        season: row.season,
        status: row.status,
      })),
    });
    console.log(`  ⚠️  Found ${result.rows.length} games without provider mappings`);
  } else {
    console.log('  ✅ All games have provider mappings');
  }
}

async function checkInconsistentScores(season?: string) {
  console.log('\n🔍 Checking for games with inconsistent scores/status...');
  
  const query = `
    select 
      g.game_id,
      g.status,
      g.home_score,
      g.away_score,
      case when g.status = 'Final' and (g.home_score is null or g.away_score is null) then 'Final without scores'
           when g.status != 'Final' and (g.home_score is not null or g.away_score is not null) then 'Scheduled with scores'
           else null end as issue_type
    from games g
    where ${season ? 'g.season = $1 and' : ''} (
      (g.status = 'Final' and (g.home_score is null or g.away_score is null))
      or (g.status != 'Final' and (g.home_score is not null or g.away_score is not null))
    )
    order by g.start_time desc
    limit 20
  `;

  const result = await pool.query(query, season ? [season] : []);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'inconsistent_scores',
      severity: 'warning',
      message: `Found ${result.rows.length} games with inconsistent scores/status`,
      count: result.rows.length,
      examples: result.rows.slice(0, 5).map(row => ({
        game_id: row.game_id,
        status: row.status,
        home_score: row.home_score,
        away_score: row.away_score,
        issue: row.issue_type,
      })),
    });
    console.log(`  ⚠️  Found ${result.rows.length} games with inconsistent scores/status`);
  } else {
    console.log('  ✅ All games have consistent scores/status');
  }
}

async function checkMissingBoxScores(season?: string) {
  console.log('\n🔍 Checking for Final games missing box scores...');
  
  const query = `
    select 
      g.game_id,
      g.start_time,
      g.status,
      g.home_score,
      g.away_score,
      (select count(*) from player_game_stats pgs where pgs.game_id = g.game_id) as player_count
    from games g
    where g.status = 'Final'
      ${season ? 'and g.season = $1' : ''}
      and not exists (
        select 1 from player_game_stats pgs where pgs.game_id = g.game_id
      )
    order by g.start_time desc
    limit 20
  `;

  const result = await pool.query(query, season ? [season] : []);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'missing_boxscores',
      severity: 'warning',
      message: `Found ${result.rows.length} Final games without box scores`,
      count: result.rows.length,
      examples: result.rows.slice(0, 5).map(row => ({
        game_id: row.game_id,
        date: row.start_time,
        score: `${row.away_score || '?'} - ${row.home_score || '?'}`,
      })),
    });
    console.log(`  ⚠️  Found ${result.rows.length} Final games without box scores`);
  } else {
    console.log('  ✅ All Final games have box scores');
  }
}

async function checkOrphanedRecords(season?: string) {
  console.log('\n🔍 Checking for orphaned records...');
  
  // Check player_game_stats without games
  const orphanedStats = await pool.query(`
    select count(*) as count
    from player_game_stats pgs
    where not exists (
      select 1 from games g where g.game_id = pgs.game_id
    )
  `);
  
  // Check provider mappings without games
  const orphanedMappings = await pool.query(`
    select count(*) as count
    from provider_id_map pm
    where pm.entity_type = 'game'
      and not exists (
        select 1 from games g where g.game_id = pm.internal_id
      )
  `);
  
  const statsCount = parseInt(orphanedStats.rows[0].count);
  const mappingsCount = parseInt(orphanedMappings.rows[0].count);
  
  if (statsCount > 0 || mappingsCount > 0) {
    issues.push({
      type: 'orphaned_records',
      severity: 'error',
      message: `Found orphaned records: ${statsCount} player_game_stats, ${mappingsCount} provider mappings`,
      count: statsCount + mappingsCount,
    });
    console.log(`  ❌ Found ${statsCount} orphaned player_game_stats`);
    console.log(`  ❌ Found ${mappingsCount} orphaned provider mappings`);
  } else {
    console.log('  ✅ No orphaned records found');
  }
}

async function checkDateIssues(season?: string) {
  console.log('\n🔍 Checking for date/timezone issues...');
  
  const query = `
    select 
      g.game_id,
      g.start_time,
      (g.start_time at time zone 'America/New_York')::date as date_et,
      g.start_time::date as date_utc,
      case when (g.start_time at time zone 'America/New_York')::date != g.start_time::date then 'timezone_mismatch' else null end as issue
    from games g
    where ${season ? 'g.season = $1 and' : ''} (g.start_time at time zone 'America/New_York')::date != g.start_time::date
    order by g.start_time desc
    limit 10
  `;

  const result = await pool.query(query, season ? [season] : []);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'date_issues',
      severity: 'info',
      message: `Found ${result.rows.length} games where ET date differs from UTC date (this is normal for late games)`,
      count: result.rows.length,
      examples: result.rows.slice(0, 5).map(row => ({
        game_id: row.game_id,
        start_time: row.start_time,
        date_et: row.date_et,
        date_utc: row.date_utc,
      })),
    });
    console.log(`  ℹ️  Found ${result.rows.length} games with date differences (normal for late games)`);
  } else {
    console.log('  ✅ No date issues found');
  }
}

async function generateSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('DATA QUALITY SUMMARY');
  console.log('='.repeat(60));
  
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos = issues.filter(i => i.severity === 'info');
  
  console.log(`\nTotal Issues: ${issues.length}`);
  console.log(`  ❌ Errors: ${errors.length}`);
  console.log(`  ⚠️  Warnings: ${warnings.length}`);
  console.log(`  ℹ️  Info: ${infos.length}`);
  
  if (errors.length > 0) {
    console.log('\n❌ ERRORS (should be fixed):');
    errors.forEach(issue => {
      console.log(`\n  ${issue.type}:`);
      console.log(`    ${issue.message}`);
      if (issue.count) {
        console.log(`    Affected records: ${issue.count}`);
      }
      if (issue.examples && issue.examples.length > 0) {
        console.log(`    Examples:`);
        issue.examples.forEach(ex => {
          console.log(`      - ${JSON.stringify(ex)}`);
        });
      }
    });
  }
  
  if (warnings.length > 0) {
    console.log('\n⚠️  WARNINGS (should be reviewed):');
    warnings.forEach(issue => {
      console.log(`\n  ${issue.type}:`);
      console.log(`    ${issue.message}`);
      if (issue.count) {
        console.log(`    Affected records: ${issue.count}`);
      }
      if (issue.examples && issue.examples.length > 0) {
        console.log(`    Examples:`);
        issue.examples.slice(0, 3).forEach(ex => {
          console.log(`      - ${JSON.stringify(ex)}`);
        });
      }
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\nRecommendations:');
  
  if (errors.length > 0) {
    console.log('1. Run cleanup script to fix duplicate games and orphaned records');
    console.log('2. Reseed games from a clean source');
  }
  
  if (warnings.length > 0) {
    console.log('3. Sync provider mappings for games');
    console.log('4. Fetch box scores for Final games missing them');
  }
  
  console.log('\nNext steps:');
  console.log('  - Run: tsx scripts/cleanup-duplicate-games.ts');
  console.log('  - Run: tsx scripts/sync-game-provider-mappings.py');
  console.log('  - Run: tsx scripts/seed-full-season-schedule.ts --season 2025');
}

async function main() {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf('--season');
  const season = seasonIndex !== -1 && args[seasonIndex + 1] 
    ? args[seasonIndex + 1] 
    : undefined;

  console.log('🔍 NBA Analytics Database Quality Check');
  console.log('='.repeat(60));
  if (season) {
    console.log(`Season filter: ${season}`);
  }

  try {
    await checkDuplicateGames(season);
    await checkMissingProviderMappings(season);
    await checkInconsistentScores(season);
    await checkMissingBoxScores(season);
    await checkOrphanedRecords(season);
    await checkDateIssues(season);
    
    await generateSummary();
  } catch (error) {
    console.error('Error during quality check:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

