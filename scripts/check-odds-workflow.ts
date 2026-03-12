/**
 * Diagnose why odds may not be updating on the betting page.
 * Checks: pull runs, today's games in analytics, game_odds_current, and ID alignment.
 *
 *   npx tsx scripts/check-odds-workflow.ts
 *   npx tsx scripts/check-odds-workflow.ts 2026-03-12   # specific date
 */
import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: SUPABASE_DB_URL,
  ssl: SUPABASE_DB_URL.includes('supabase') ? { rejectUnauthorized: false } : undefined,
});

function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function main(): Promise<void> {
  const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const dateStr = dateArg ?? getTodayET();

  console.log('=== Odds workflow check ===\n');
  console.log(`Date (ET): ${dateStr}\n`);

  // 1. Recent pull runs
  const runs = await pool.query(
    `SELECT pull_run_id, pulled_at, date_queried, rows_returned, rows_stored, status, error_message
     FROM raw.odds_pull_runs
     ORDER BY pulled_at DESC
     LIMIT 10`
  );

  console.log('--- 1. Recent odds pull runs (last 10) ---');
  if (runs.rows.length === 0) {
    console.log('No pull runs found. Lambda may never have run or raw.odds_pull_runs is empty.');
  } else {
    const runsToday = runs.rows.filter(
      (r: any) => r.pulled_at && new Date(r.pulled_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === dateStr
    );
    console.log(`Runs today (${dateStr}): ${runsToday.length}`);
    runs.rows.slice(0, 5).forEach((r: any) => {
      const t = r.pulled_at instanceof Date ? r.pulled_at : new Date(r.pulled_at);
      console.log(
        `  ${t.toISOString()} | run_id=${r.pull_run_id} date_queried=${r.date_queried ?? '—'} ` +
          `returned=${r.rows_returned ?? '—'} stored=${r.rows_stored ?? '—'} status=${r.status}`
      );
      if (r.error_message) console.log(`    error: ${r.error_message}`);
    });
  }
  console.log('');

  // 2. Today's games in analytics.games (same logic as getGamesForDate)
  const todayGames = await pool.query(
    `SELECT g.game_id, g.start_time,
        ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr
     FROM analytics.games g
     JOIN analytics.teams ht ON g.home_team_id = ht.team_id
     JOIN analytics.teams at ON g.away_team_id = at.team_id
     WHERE g.start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
       AND g.start_time <  (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
     ORDER BY g.start_time ASC`,
    [dateStr]
  );

  console.log('--- 2. Today\'s games in analytics.games ---');
  const todayGameIds = (todayGames.rows as any[]).map((r) => r.game_id);
  console.log(`Count: ${todayGameIds.length}`);
  if (todayGameIds.length === 0) {
    console.log('No games for this date. nightly-bdl-updater (03:00 ET) must run first to populate analytics.games.');
  } else {
    todayGames.rows.slice(0, 8).forEach((r: any) => {
      console.log(`  game_id=${r.game_id}  ${r.away_abbr} @ ${r.home_abbr}  ${r.start_time}`);
    });
    if (todayGameIds.length > 8) console.log(`  ... and ${todayGameIds.length - 8} more`);
  }
  console.log('');

  // 3. game_odds_current for today's game_ids
  console.log('--- 3. Odds in analytics.game_odds_current (for today\'s games) ---');
  if (todayGameIds.length === 0) {
    console.log('Skipped (no today games).');
  } else {
    const currentOdds = await pool.query(
      `SELECT game_id, vendor, snapshot_at, home_moneyline, away_moneyline, total
       FROM analytics.game_odds_current
       WHERE game_id = ANY($1)`,
      [todayGameIds]
    );
    const withOdds = (currentOdds.rows as any[]).map((r) => r.game_id);
    const missing = todayGameIds.filter((id) => !withOdds.includes(id));
    console.log(`Games with odds: ${withOdds.length} / ${todayGameIds.length}`);
    if (missing.length > 0) {
      console.log(`Missing game_ids: ${missing.join(', ')}`);
    }
    currentOdds.rows.slice(0, 5).forEach((r: any) => {
      console.log(`  game_id=${r.game_id} vendor=${r.vendor} snapshot_at=${r.snapshot_at} total=${r.total ?? '—'}`);
    });
  }
  console.log('');

  // 4. Raw snapshots: do we have rows for today's game_ids from latest run?
  console.log('--- 4. Raw snapshots (latest run) vs analytics.games ---');
  const lastSuccessRun = await pool.query(
    `SELECT pull_run_id, pulled_at, rows_stored, date_queried
     FROM raw.odds_pull_runs
     WHERE status = 'success'
     ORDER BY pulled_at DESC
     LIMIT 1`
  );
  if (lastSuccessRun.rows.length === 0) {
    console.log('No successful pull run found.');
  } else if (todayGameIds.length === 0) {
    console.log('No today games to compare.');
  } else {
    const runId = (lastSuccessRun.rows[0] as any).pull_run_id;
    const rawForRun = await pool.query(
      `SELECT game_id FROM raw.odds_snapshots WHERE pull_run_id = $1`,
      [runId]
    );
    const rawGameIds = [...new Set((rawForRun.rows as any[]).map((r) => r.game_id))];
    const inRawOnly = rawGameIds.filter((id) => !todayGameIds.includes(id));
    const inTodayOnly = todayGameIds.filter((id) => !rawGameIds.includes(id));
    const inBoth = todayGameIds.filter((id) => rawGameIds.includes(id));
    console.log(`Latest success run: pull_run_id=${runId}`);
    console.log(`Raw snapshots from that run: ${rawGameIds.length} unique game_ids`);
    console.log(`Today's games in analytics: ${todayGameIds.length}`);
    console.log(`Today game_ids present in raw: ${inBoth.length}`);
    if (inTodayOnly.length > 0) {
      console.log(`Today games NOT in raw (Lambda may have queried different date or BDL had no odds): ${inTodayOnly.join(', ')}`);
    }
    if (inRawOnly.length > 0 && inRawOnly.length <= 20) {
      console.log(`Raw game_ids not in today's list (other date): ${inRawOnly.join(', ')}`);
    } else if (inRawOnly.length > 20) {
      console.log(`Raw has ${inRawOnly.length} other game_ids (likely other dates).`);
    }
  }
  console.log('');

  // 5. Summary and next steps
  console.log('--- Next steps ---');
  const hasRunsToday = runs.rows.length > 0 && (runs.rows as any[]).some(
    (r) => r.pulled_at && new Date(r.pulled_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === dateStr
  );
  const anyFailed = (runs.rows as any[]).some((r) => r.status === 'error');
  const hasOdds = todayGameIds.length > 0 && (await pool.query(
    `SELECT 1 FROM analytics.game_odds_current WHERE game_id = ANY($1) LIMIT 1`,
    [todayGameIds]
  )).rowCount > 0;

  if (todayGameIds.length === 0) {
    console.log('1. Ensure nightly-bdl-updater has run (03:00 ET) so analytics.games has today.');
  }
  if (!hasRunsToday) {
    console.log('2. Lambda may not have run today. Check EventBridge rule (e.g. odds-snapshot-schedule) and cron: */30 15-17 * * ? * (10am–12pm ET).');
    console.log('3. Run odds Lambda manually: in AWS Lambda console invoke odds-pre-game-snapshot, or locally: cd lambda/odds-pre-game-snapshot && npx tsx index.ts');
  }
  if (hasRunsToday && anyFailed) {
    console.log('4. Check failed run error_message above; fix env (SUPABASE_DB_URL, BALLDONTLIE_API_KEY) or BDL rate limit.');
  }
  if (todayGameIds.length > 0 && !hasOdds) {
    console.log('5. Check BDL has odds for today: npx tsx scripts/check-bdl-odds-today.ts');
    console.log('6. If BDL has odds but DB does not, game_id in BDL may not match analytics.games (both should be BDL game_id).');
  }
  if (hasOdds) {
    console.log('Odds are present for today. If the page still shows old/missing odds, hard refresh or check API cache.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
