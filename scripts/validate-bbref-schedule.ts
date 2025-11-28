import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

interface ValidationResult {
  check: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  count?: number;
  examples?: any[];
}

async function validateSchedule(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  console.log('=== Validating bbref_schedule ===\n');

  // 1. Check for missing team mappings
  const missingTeams = await pool.query(`
    SELECT 
      bbref_game_id,
      game_date,
      home_team_abbr,
      away_team_abbr,
      home_team_id,
      away_team_id
    FROM bbref_schedule
    WHERE home_team_id IS NULL OR away_team_id IS NULL
    ORDER BY game_date DESC
    LIMIT 10
  `);

  if (missingTeams.rows.length > 0) {
    results.push({
      check: 'Missing Team Mappings',
      status: 'fail',
      message: `${missingTeams.rows.length} games have unmapped teams`,
      count: missingTeams.rows.length,
      examples: missingTeams.rows,
    });
  } else {
    results.push({
      check: 'Missing Team Mappings',
      status: 'pass',
      message: 'All games have team mappings',
    });
  }

  // 2. Check for duplicate bbref_game_ids
  const duplicates = await pool.query(`
    SELECT bbref_game_id, COUNT(*) as count
    FROM bbref_schedule
    GROUP BY bbref_game_id
    HAVING COUNT(*) > 1
  `);

  if (duplicates.rows.length > 0) {
    results.push({
      check: 'Duplicate bbref_game_ids',
      status: 'fail',
      message: `${duplicates.rows.length} duplicate game IDs found`,
      count: duplicates.rows.length,
      examples: duplicates.rows,
    });
  } else {
    results.push({
      check: 'Duplicate bbref_game_ids',
      status: 'pass',
      message: 'No duplicate game IDs',
    });
  }

  // 3. Check for games with same teams on same date (potential duplicates)
  const sameTeamGames = await pool.query(`
    SELECT 
      game_date,
      home_team_abbr,
      away_team_abbr,
      COUNT(*) as count,
      array_agg(bbref_game_id) as game_ids
    FROM bbref_schedule
    GROUP BY game_date, home_team_abbr, away_team_abbr
    HAVING COUNT(*) > 1
    ORDER BY game_date DESC
    LIMIT 10
  `);

  if (sameTeamGames.rows.length > 0) {
    results.push({
      check: 'Duplicate Matchups (Same Teams, Same Date)',
      status: 'warning',
      message: `${sameTeamGames.rows.length} duplicate matchups found`,
      count: sameTeamGames.rows.length,
      examples: sameTeamGames.rows,
    });
  } else {
    results.push({
      check: 'Duplicate Matchups',
      status: 'pass',
      message: 'No duplicate matchups',
    });
  }

  // 4. Check for missing start times (especially for upcoming games)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const missingStartTimes = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(start_time) as with_time,
      COUNT(*) - COUNT(start_time) as without_time
    FROM bbref_schedule
    WHERE game_date >= $1::date
  `, [today]);

  const missingCount = missingStartTimes.rows[0].without_time;
  if (missingCount > 0) {
    results.push({
      check: 'Missing Start Times (Upcoming Games)',
      status: 'warning',
      message: `${missingCount} upcoming games missing start_time`,
      count: missingCount,
    });
  } else {
    results.push({
      check: 'Missing Start Times',
      status: 'pass',
      message: 'All upcoming games have start times',
    });
  }

  // 5. Check for unmapped team_ids (more important than abbreviation match)
  // Note: bbref_schedule uses different abbreviations (BRK, CHO, PHO) than teams table (BKN, CHA, PHX)
  // This is fine as long as team_id is mapped correctly
  const unmappedTeams = await pool.query(`
    SELECT 
      bbref_game_id,
      home_team_abbr,
      away_team_abbr,
      home_team_id,
      away_team_id
    FROM bbref_schedule
    WHERE home_team_id IS NULL OR away_team_id IS NULL
    LIMIT 10
  `);

  if (unmappedTeams.rows.length > 0) {
    results.push({
      check: 'Unmapped Team IDs',
      status: 'fail',
      message: `${unmappedTeams.rows.length} games have unmapped team_ids (check #1 should catch this)`,
      count: unmappedTeams.rows.length,
      examples: unmappedTeams.rows,
    });
  } else {
    results.push({
      check: 'Team ID Mappings',
      status: 'pass',
      message: 'All games have valid team_id mappings (abbreviation differences are OK)',
    });
  }

  // 6. Check for games today/tomorrow (for odds fetching)
  const upcomingGames = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE game_date = $1::date) as today,
      COUNT(*) FILTER (WHERE game_date = $1::date + INTERVAL '1 day') as tomorrow
    FROM bbref_schedule
    WHERE game_date BETWEEN $1::date AND $1::date + INTERVAL '1 day'
  `, [today]);

  const todayCount = upcomingGames.rows[0].today;
  const tomorrowCount = upcomingGames.rows[0].tomorrow;

  results.push({
    check: 'Upcoming Games for Odds Fetching',
    status: todayCount > 0 || tomorrowCount > 0 ? 'pass' : 'warning',
    message: `Today: ${todayCount} games, Tomorrow: ${tomorrowCount} games`,
    count: todayCount + tomorrowCount,
  });

  // 7. Check for games with canonical_game_id (needed for odds matching)
  const gamesWithCanonical = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(canonical_game_id) as with_canonical,
      COUNT(*) - COUNT(canonical_game_id) as without_canonical
    FROM bbref_schedule
    WHERE game_date >= $1::date
  `, [today]);

  const withoutCanonical = gamesWithCanonical.rows[0].without_canonical;
  if (withoutCanonical > 0) {
    results.push({
      check: 'Games Without canonical_game_id',
      status: 'warning',
      message: `${withoutCanonical} upcoming games missing canonical_game_id (odds will use bbref_game_id)`,
      count: withoutCanonical,
    });
  } else {
    results.push({
      check: 'Games Without canonical_game_id',
      status: 'pass',
      message: 'All upcoming games have canonical_game_id',
    });
  }

  // 8. Check for games that should have odds but don't
  const gamesWithoutOdds = await pool.query(`
    SELECT 
      bs.bbref_game_id,
      bs.game_date,
      bs.home_team_abbr,
      bs.away_team_abbr,
      COUNT(m.id) as odds_count
    FROM bbref_schedule bs
    LEFT JOIN markets m ON (m.game_id = bs.canonical_game_id OR m.game_id = bs.bbref_game_id)
      AND m.snapshot_type = 'pre_game'
    WHERE bs.game_date = $1::date
    GROUP BY bs.bbref_game_id, bs.game_date, bs.home_team_abbr, bs.away_team_abbr
    HAVING COUNT(m.id) = 0
  `, [today]);

  if (gamesWithoutOdds.rows.length > 0) {
    results.push({
      check: 'Today\'s Games Without Odds',
      status: 'warning',
      message: `${gamesWithoutOdds.rows.length} games today don't have pre-game odds yet`,
      count: gamesWithoutOdds.rows.length,
      examples: gamesWithoutOdds.rows,
    });
  } else {
    results.push({
      check: 'Today\'s Games Without Odds',
      status: 'pass',
      message: 'All today\'s games have odds',
    });
  }

  return results;
}

async function main() {
  try {
    const results = await validateSchedule();

    console.log('\n=== Validation Results ===\n');

    let passCount = 0;
    let failCount = 0;
    let warningCount = 0;

    results.forEach((result) => {
      const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
      const color = result.status === 'pass' ? '\x1b[32m' : result.status === 'fail' ? '\x1b[31m' : '\x1b[33m';
      const reset = '\x1b[0m';

      console.log(`${color}${icon} ${result.check}${reset}`);
      console.log(`   ${result.message}`);
      
      if (result.count !== undefined) {
        console.log(`   Count: ${result.count}`);
      }

      if (result.examples && result.examples.length > 0) {
        console.log(`   Examples:`);
        result.examples.slice(0, 3).forEach((ex: any) => {
          console.log(`     - ${JSON.stringify(ex)}`);
        });
      }

      console.log('');

      if (result.status === 'pass') passCount++;
      else if (result.status === 'fail') failCount++;
      else warningCount++;
    });

    console.log('=== Summary ===');
    console.log(`✅ Passed: ${passCount}`);
    console.log(`⚠️  Warnings: ${warningCount}`);
    console.log(`❌ Failed: ${failCount}`);

    if (failCount > 0) {
      console.log('\n⚠️  Please fix failures before setting up odds fetching.');
      process.exitCode = 1;
    } else if (warningCount > 0) {
      console.log('\n⚠️  Warnings found, but can proceed with odds fetching.');
    } else {
      console.log('\n✅ All checks passed! Ready for odds fetching.');
    }
  } catch (error) {
    console.error('Error during validation:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

