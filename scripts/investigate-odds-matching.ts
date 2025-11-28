import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

// Games that didn't match
const unmatchedGames = [
  { home: 'BKN', away: 'PHI', commenceTime: '2025-11-29T00:40:00Z' },
  { home: 'CHA', away: 'CHI', commenceTime: '2025-11-29T00:40:00Z' },
  { home: 'OKC', away: 'PHX', commenceTime: '2025-11-29T02:40:00Z' },
];

async function investigate() {
  console.log('=== Investigating Odds API Game Matching ===\n');

  for (const game of unmatchedGames) {
    console.log(`\n🔍 Investigating: ${game.away} @ ${game.home}`);
    console.log(`   Odds API Commence Time: ${game.commenceTime}`);

    // Parse the date
    const dateObj = new Date(game.commenceTime);
    const utcDateStr = dateObj.toISOString().split('T')[0];
    const etDateStr = new Date(
      dateObj.toLocaleString('en-US', { timeZone: 'America/New_York' })
    )
      .toISOString()
      .split('T')[0];

    console.log(`   UTC Date: ${utcDateStr}`);
    console.log(`   ET Date: ${etDateStr}`);

    // Check what's in bbref_schedule for these dates
    console.log(`\n   Checking bbref_schedule for date range...`);
    const scheduleCheck = await pool.query(
      `SELECT 
        bbref_game_id,
        game_date,
        start_time,
        home_team_abbr,
        away_team_abbr,
        home_team_id,
        away_team_id
      FROM bbref_schedule
      WHERE game_date BETWEEN $1::date - INTERVAL '2 days' AND $1::date + INTERVAL '2 days'
      ORDER BY game_date, start_time`,
      [utcDateStr]
    );

    if (scheduleCheck.rows.length > 0) {
      console.log(`   Found ${scheduleCheck.rows.length} games in date range:`);
      scheduleCheck.rows.forEach((row: any) => {
        const matchHome = row.home_team_abbr === game.home;
        const matchAway = row.away_team_abbr === game.away;
        const match = matchHome && matchAway;
        const marker = match ? '✅' : '  ';

        console.log(
          `   ${marker} ${row.away_team_abbr} @ ${row.home_team_abbr} on ${row.game_date} ${row.start_time ? `(${row.start_time})` : '(no time)'}`
        );
      });
    } else {
      console.log(`   ⚠️  No games found in bbref_schedule for date range`);
    }

    // Check for exact team match on any date
    console.log(`\n   Checking for exact team match (any date)...`);
    const exactMatch = await pool.query(
      `SELECT 
        bbref_game_id,
        game_date,
        start_time,
        home_team_abbr,
        away_team_abbr
      FROM bbref_schedule
      WHERE home_team_abbr = $1 AND away_team_abbr = $2
      ORDER BY game_date DESC
      LIMIT 5`,
      [game.home, game.away]
    );

    if (exactMatch.rows.length > 0) {
      console.log(`   Found ${exactMatch.rows.length} game(s) with exact team match:`);
      exactMatch.rows.forEach((row: any) => {
        console.log(
          `     ${row.away_team_abbr} @ ${row.home_team_abbr} on ${row.game_date} ${row.start_time ? `(${row.start_time})` : '(no time)'}`
        );
      });
    } else {
      console.log(`   ⚠️  No games found with exact team match`);
    }

    // Check for partial matches (one team matches)
    console.log(`\n   Checking for partial team matches...`);
    const partialMatch = await pool.query(
      `SELECT 
        bbref_game_id,
        game_date,
        start_time,
        home_team_abbr,
        away_team_abbr
      FROM bbref_schedule
      WHERE (home_team_abbr = $1 OR away_team_abbr = $1 OR home_team_abbr = $2 OR away_team_abbr = $2)
        AND game_date BETWEEN $3::date - INTERVAL '2 days' AND $3::date + INTERVAL '2 days'
      ORDER BY game_date DESC`,
      [game.home, game.away, utcDateStr]
    );

    if (partialMatch.rows.length > 0) {
      console.log(`   Found ${partialMatch.rows.length} game(s) with partial team match:`);
      partialMatch.rows.forEach((row: any) => {
        const hasHome = row.home_team_abbr === game.home || row.away_team_abbr === game.home;
        const hasAway = row.home_team_abbr === game.away || row.away_team_abbr === game.away;
        console.log(
          `     ${row.away_team_abbr} @ ${row.home_team_abbr} on ${row.game_date} ${row.start_time ? `(${row.start_time})` : '(no time)'} - ${hasHome ? 'has home' : ''} ${hasAway ? 'has away' : ''}`
        );
      });
    }

    // Check team abbreviation mapping
    console.log(`\n   Checking team abbreviation in teams table...`);
    const homeTeam = await pool.query(
      `SELECT team_id, abbreviation, full_name FROM teams WHERE abbreviation = $1::text`,
      [game.home]
    );
    const awayTeam = await pool.query(
      `SELECT team_id, abbreviation, full_name FROM teams WHERE abbreviation = $1::text`,
      [game.away]
    );

    if (homeTeam.rows.length > 0) {
      console.log(`   Home team (${game.home}): ${homeTeam.rows[0].full_name} (${homeTeam.rows[0].team_id})`);
    } else {
      console.log(`   ⚠️  Home team (${game.home}) not found in teams table`);
    }

    if (awayTeam.rows.length > 0) {
      console.log(`   Away team (${game.away}): ${awayTeam.rows[0].full_name} (${awayTeam.rows[0].team_id})`);
    } else {
      console.log(`   ⚠️  Away team (${game.away}) not found in teams table`);
    }

    // Check staging events for this game
    console.log(`\n   Checking staging_events for this game...`);
    const stagingCheck = await pool.query(
      `SELECT id, cursor, fetched_at, processed, error_message
       FROM staging_events
       WHERE source = 'oddsapi'
         AND payload::text LIKE $1
       ORDER BY fetched_at DESC
       LIMIT 1`,
      [`%${game.home}%${game.away}%`]
    );

    if (stagingCheck.rows.length > 0) {
      const staging = stagingCheck.rows[0];
      console.log(`   Found staging event ID: ${staging.id}`);
      console.log(`   Cursor: ${staging.cursor}`);
      console.log(`   Processed: ${staging.processed}`);
      if (staging.error_message) {
        console.log(`   Error: ${staging.error_message}`);
      }
    }
  }

  // Summary: Check all games in bbref_schedule for the date range
  console.log(`\n\n=== Summary: All Games in bbref_schedule for Nov 28-30 ===`);
  const allGames = await pool.query(
    `SELECT 
      bbref_game_id,
      game_date,
      start_time,
      home_team_abbr,
      away_team_abbr
    FROM bbref_schedule
    WHERE game_date BETWEEN '2025-11-28'::date AND '2025-11-30'::date
    ORDER BY game_date, start_time`
  );

  console.log(`\nTotal games in bbref_schedule: ${allGames.rows.length}`);
  allGames.rows.forEach((row: any) => {
    console.log(
      `  ${row.away_team_abbr} @ ${row.home_team_abbr} on ${row.game_date} ${row.start_time ? `(${row.start_time})` : '(no time)'}`
    );
  });

  await pool.end();
}

investigate().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

