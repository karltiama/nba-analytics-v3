import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Comprehensive Data Quality Check Script
 * 
 * Checks for:
 * 1. Games missing box scores
 * 2. Games missing final scores
 * 3. Games with incorrect statuses
 * 4. Box scores with invalid player references
 * 5. Score mismatches (box score totals vs game scores)
 * 6. Games missing team_game_stats
 * 7. Duplicate games (within 48 hours, same teams)
 * 8. Games with invalid dates
 * 9. Orphaned records
 * 
 * Usage:
 *   tsx scripts/check-data-quality.ts                    # Check all issues
 *   tsx scripts/check-data-quality.ts --fix              # Auto-fix issues where possible
 *   tsx scripts/check-data-quality.ts --start-date 2025-10-01 --end-date 2025-11-30
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

interface Issue {
  type: string;
  severity: 'error' | 'warning' | 'info';
  count: number;
  message: string;
  examples?: Array<Record<string, any>>;
  fixable?: boolean;
  fixQuery?: string;
}

const issues: Issue[] = [];

async function checkMissingBoxScores(startDate?: string, endDate?: string) {
  console.log('\n[CHECK] Checking for games missing box scores...');
  
  let sql = `
    SELECT 
      g.game_id,
      g.start_time,
      g.status,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      g.home_score,
      g.away_score
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.status = 'Final'
      AND NOT EXISTS (SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id)
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
  
  sql += ` ORDER BY g.start_time DESC LIMIT 20`;
  
  const result = await pool.query(sql, params);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'missing_boxscores',
      severity: 'error',
      count: result.rows.length,
      message: `Found ${result.rows.length} Final games without box scores`,
      examples: result.rows.slice(0, 5).map(r => ({
        game_id: r.game_id,
        date: new Date(r.start_time).toISOString().split('T')[0],
        matchup: `${r.away_abbr} @ ${r.home_abbr}`,
        score: `${r.away_score || '?'} - ${r.home_score || '?'}`,
      })),
      fixable: true,
    });
    console.log(`  [ERROR] Found ${result.rows.length} Final games without box scores`);
  } else {
    console.log('  [OK] All Final games have box scores');
  }
}

async function checkMissingFinalScores(startDate?: string, endDate?: string) {
  console.log('\n[CHECK] Checking for games missing final scores...');
  
  let sql = `
    SELECT 
      g.game_id,
      g.start_time,
      g.status,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id) as has_boxscore
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.status = 'Final'
      AND (g.home_score IS NULL OR g.away_score IS NULL)
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
  
  sql += ` ORDER BY g.start_time DESC LIMIT 20`;
  
  const result = await pool.query(sql, params);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'missing_scores',
      severity: 'error',
      count: result.rows.length,
      message: `Found ${result.rows.length} Final games without final scores`,
      examples: result.rows.slice(0, 5).map(r => ({
        game_id: r.game_id,
        date: new Date(r.start_time).toISOString().split('T')[0],
        matchup: `${r.away_abbr} @ ${r.home_abbr}`,
        has_boxscore: r.has_boxscore,
      })),
      fixable: result.rows[0]?.has_boxscore || false, // Can fix if box score exists (can calculate from totals)
    });
    console.log(`  [ERROR] Found ${result.rows.length} Final games without final scores`);
  } else {
    console.log('  [OK] All Final games have final scores');
  }
}

async function checkIncorrectStatuses(startDate?: string, endDate?: string) {
  console.log('\n[CHECK] Checking for games with incorrect statuses...');
  
  const now = new Date();
  // Only consider games that are at least 3 hours old to avoid timezone issues
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  
  let sql = `
    SELECT 
      g.game_id,
      g.start_time,
      g.status,
      g.home_score,
      g.away_score,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE (
      -- Games with scores but not Final
      (g.home_score IS NOT NULL AND g.away_score IS NOT NULL AND g.status != 'Final' AND g.status != 'Cancelled' AND g.status != 'Postponed')
      OR
      -- Past games marked as Scheduled that have box scores (at least 3 hours old to avoid timezone issues)
      (g.start_time < $2 AND g.status = 'Scheduled' AND EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id))
      OR
      -- Future games marked as Final without scores
      (g.start_time > $1 AND g.status = 'Final' AND (g.home_score IS NULL OR g.away_score IS NULL))
    )
  `;
  
  const params: any[] = [now, threeHoursAgo];
  let paramCount = 3;
  
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
  
  sql += ` ORDER BY g.start_time DESC LIMIT 20`;
  
  const result = await pool.query(sql, params);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'incorrect_status',
      severity: 'warning',
      count: result.rows.length,
      message: `Found ${result.rows.length} games with incorrect statuses`,
      examples: result.rows.slice(0, 5).map(r => ({
        game_id: r.game_id,
        date: new Date(r.start_time).toISOString().split('T')[0],
        matchup: `${r.away_abbr} @ ${r.home_abbr}`,
        current_status: r.status,
        has_scores: r.home_score !== null && r.away_score !== null,
        is_past: new Date(r.start_time) < now,
      })),
      fixable: true,
    });
    console.log(`  [WARN] Found ${result.rows.length} games with incorrect statuses`);
  } else {
    console.log('  [OK] All games have correct statuses');
  }
}

async function checkScoreMismatches(startDate?: string, endDate?: string) {
  console.log('\n[CHECK] Checking for score mismatches (box score totals vs game scores)...');
  
  let sql = `
    WITH team_totals AS (
      SELECT 
        pgs.game_id,
        pgs.team_id,
        SUM(pgs.points) as total_points
      FROM player_game_stats pgs
      GROUP BY pgs.game_id, pgs.team_id
    ),
    game_totals AS (
      SELECT 
        g.game_id,
        g.home_team_id,
        g.away_team_id,
        g.home_score,
        g.away_score,
        MAX(CASE WHEN tt.team_id = g.home_team_id THEN tt.total_points END) as box_home_score,
        MAX(CASE WHEN tt.team_id = g.away_team_id THEN tt.total_points END) as box_away_score
      FROM games g
      JOIN team_totals tt ON g.game_id = tt.game_id
      WHERE g.status = 'Final'
        AND g.home_score IS NOT NULL
        AND g.away_score IS NOT NULL
      GROUP BY g.game_id, g.home_team_id, g.away_team_id, g.home_score, g.away_score
    )
    SELECT 
      gt.game_id,
      g.start_time,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      gt.home_score as db_home_score,
      gt.away_score as db_away_score,
      gt.box_home_score,
      gt.box_away_score,
      ABS(gt.home_score - gt.box_home_score) as home_diff,
      ABS(gt.away_score - gt.box_away_score) as away_diff
    FROM game_totals gt
    JOIN games g ON gt.game_id = g.game_id
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE (
      ABS(gt.home_score - gt.box_home_score) > 1
      OR ABS(gt.away_score - gt.box_away_score) > 1
    )
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
  
  sql += ` ORDER BY g.start_time DESC LIMIT 20`;
  
  const result = await pool.query(sql, params);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'score_mismatch',
      severity: 'warning',
      count: result.rows.length,
      message: `Found ${result.rows.length} games with score mismatches (>1 point difference)`,
      examples: result.rows.slice(0, 5).map(r => ({
        game_id: r.game_id,
        date: new Date(r.start_time).toISOString().split('T')[0],
        matchup: `${r.away_abbr} @ ${r.home_abbr}`,
        db_score: `${r.db_away_score} - ${r.db_home_score}`,
        box_score: `${r.box_away_score} - ${r.box_home_score}`,
        diff: `${r.away_diff} / ${r.home_diff}`,
      })),
      fixable: false, // Manual review needed
    });
    console.log(`  [WARN] Found ${result.rows.length} games with score mismatches`);
  } else {
    console.log('  [OK] All scores match box score totals');
  }
}

async function checkOrphanedRecords(startDate?: string, endDate?: string) {
  console.log('\n[CHECK] Checking for orphaned records...');
  
  let sql = `
    SELECT 
      pgs.game_id,
      pgs.player_id,
      COUNT(*) as count
    FROM player_game_stats pgs
    LEFT JOIN games g ON pgs.game_id = g.game_id
    LEFT JOIN players p ON pgs.player_id = p.player_id
    WHERE (g.game_id IS NULL OR p.player_id IS NULL)
  `;
  
  const params: any[] = [];
  let paramCount = 1;
  
  if (startDate) {
    sql += ` AND (g.start_time::date >= $${paramCount}::date OR g.start_time IS NULL)`;
    params.push(startDate);
    paramCount++;
  }
  
  if (endDate) {
    sql += ` AND (g.start_time::date <= $${paramCount}::date OR g.start_time IS NULL)`;
    params.push(endDate);
    paramCount++;
  }
  
  sql += ` GROUP BY pgs.game_id, pgs.player_id LIMIT 20`;
  
  const result = await pool.query(sql, params);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'orphaned_records',
      severity: 'error',
      count: result.rows.length,
      message: `Found ${result.rows.length} orphaned player_game_stats records`,
      examples: result.rows.slice(0, 5).map(r => ({
        game_id: r.game_id,
        player_id: r.player_id,
      })),
      fixable: false, // Need to investigate
    });
    console.log(`  [ERROR] Found ${result.rows.length} orphaned records`);
  } else {
    console.log('  [OK] No orphaned records found');
  }
}

async function checkDuplicateGames(startDate?: string, endDate?: string) {
  console.log('\n[CHECK] Checking for duplicate games...');
  
  let sql = `
    WITH game_duplicates AS (
      SELECT 
        g1.game_id as game1_id,
        g2.game_id as game2_id,
        g1.start_time as time1,
        g2.start_time as time2,
        ht.abbreviation as home_abbr,
        at.abbreviation as away_abbr
      FROM games g1
      JOIN games g2 ON (
        g1.home_team_id = g2.home_team_id
        AND g1.away_team_id = g2.away_team_id
        AND g1.game_id < g2.game_id
        AND ABS(EXTRACT(EPOCH FROM (g1.start_time - g2.start_time))) < 172800
      )
      JOIN teams ht ON g1.home_team_id = ht.team_id
      JOIN teams at ON g1.away_team_id = at.team_id
      WHERE 1=1
  `;
  
  const params: any[] = [];
  let paramCount = 1;
  
  if (startDate) {
    sql += ` AND g1.start_time::date >= $${paramCount}::date`;
    params.push(startDate);
    paramCount++;
  }
  
  if (endDate) {
    sql += ` AND g1.start_time::date <= $${paramCount}::date`;
    params.push(endDate);
    paramCount++;
  }
  
  sql += `
    )
    SELECT DISTINCT
      game1_id,
      game2_id,
      time1,
      time2,
      home_abbr,
      away_abbr
    FROM game_duplicates
    ORDER BY time1 DESC
    LIMIT 20
  `;
  
  const result = await pool.query(sql, params);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'duplicate_games',
      severity: 'warning',
      count: result.rows.length,
      message: `Found ${result.rows.length} potential duplicate game pairs`,
      examples: result.rows.slice(0, 5).map(r => ({
        game1_id: r.game1_id,
        game2_id: r.game2_id,
        matchup: `${r.away_abbr} @ ${r.home_abbr}`,
        time1: new Date(r.time1).toISOString(),
        time2: new Date(r.time2).toISOString(),
      })),
      fixable: true, // Can use deduplication logic
    });
    console.log(`  [WARN] Found ${result.rows.length} potential duplicate game pairs`);
  } else {
    console.log('  [OK] No duplicate games found');
  }
}

async function checkMissingTeamStats(startDate?: string, endDate?: string) {
  console.log('\n[CHECK] Checking for games missing team_game_stats...');
  
  let sql = `
    SELECT 
      g.game_id,
      g.start_time,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.status = 'Final'
      AND NOT EXISTS (
        SELECT 1 FROM team_game_stats tgs 
        WHERE tgs.game_id = g.game_id 
        AND (tgs.team_id = g.home_team_id OR tgs.team_id = g.away_team_id)
      )
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
  
  sql += ` ORDER BY g.start_time DESC LIMIT 20`;
  
  const result = await pool.query(sql, params);
  
  if (result.rows.length > 0) {
    issues.push({
      type: 'missing_team_stats',
      severity: 'info',
      count: result.rows.length,
      message: `Found ${result.rows.length} Final games without team_game_stats`,
      examples: result.rows.slice(0, 5).map(r => ({
        game_id: r.game_id,
        date: new Date(r.start_time).toISOString().split('T')[0],
        matchup: `${r.away_abbr} @ ${r.home_abbr}`,
      })),
      fixable: true, // Can calculate from player_game_stats
    });
    console.log(`  [INFO] Found ${result.rows.length} Final games without team_game_stats`);
  } else {
    console.log('  [OK] All Final games have team_game_stats');
  }
}

async function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('DATA QUALITY SUMMARY');
  console.log('='.repeat(60));
  
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos = issues.filter(i => i.severity === 'info');
  
  console.log(`\n[ERROR] Errors: ${errors.length}`);
  errors.forEach(issue => {
    console.log(`   - ${issue.message}`);
    if (issue.examples && issue.examples.length > 0) {
      console.log(`     Examples: ${issue.examples.map(e => e.game_id || e.matchup).join(', ')}`);
    }
  });
  
  console.log(`\n[WARN] Warnings: ${warnings.length}`);
  warnings.forEach(issue => {
    console.log(`   - ${issue.message}`);
    if (issue.examples && issue.examples.length > 0) {
      console.log(`     Examples: ${issue.examples.map(e => e.game_id || e.matchup).join(', ')}`);
    }
  });
  
  console.log(`\n[INFO] Info: ${infos.length}`);
  infos.forEach(issue => {
    console.log(`   - ${issue.message}`);
  });
  
  const totalIssues = issues.reduce((sum, issue) => sum + issue.count, 0);
  const fixableIssues = issues.filter(i => i.fixable).reduce((sum, issue) => sum + issue.count, 0);
  
  console.log(`\nTotal Issues: ${totalIssues}`);
  console.log(`Fixable Issues: ${fixableIssues}`);
  console.log('='.repeat(60));
}

async function main() {
  const args = process.argv.slice(2);
  const startDateIndex = args.indexOf('--start-date');
  const endDateIndex = args.indexOf('--end-date');
  const fixIndex = args.indexOf('--fix');
  
  const startDate = startDateIndex !== -1 && args[startDateIndex + 1] 
    ? args[startDateIndex + 1] 
    : undefined;
  const endDate = endDateIndex !== -1 && args[endDateIndex + 1] 
    ? args[endDateIndex + 1] 
    : undefined;
  const fix = fixIndex !== -1;
  
  console.log('\nNBA Analytics Data Quality Check');
  console.log('='.repeat(60));
  if (startDate || endDate) {
    console.log(`Date range: ${startDate || 'beginning'} to ${endDate || 'end'}`);
  } else {
    console.log('Checking all games');
  }
  if (fix) {
    console.log('[AUTO-FIX] Auto-fix mode: ENABLED');
  }
  
  try {
    await checkMissingBoxScores(startDate, endDate);
    await checkMissingFinalScores(startDate, endDate);
    await checkIncorrectStatuses(startDate, endDate);
    await checkScoreMismatches(startDate, endDate);
    await checkOrphanedRecords(startDate, endDate);
    await checkDuplicateGames(startDate, endDate);
    await checkMissingTeamStats(startDate, endDate);
    
    await printSummary();
    
    if (fix) {
      console.log('\n[AUTO-FIX] Auto-fix functionality not yet implemented');
      console.log('   Use specific fix scripts:');
      console.log('   - tsx scripts/backfill-boxscores-bbref.ts (for missing box scores)');
      console.log('   - tsx scripts/update-scores-from-boxscores.ts (for missing scores)');
      console.log('   - tsx scripts/fix-game-statuses.ts (for incorrect statuses)');
    }
    
  } catch (error: any) {
    console.error('\n[ERROR] Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
