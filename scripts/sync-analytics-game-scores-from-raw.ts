/**
 * Sync home_score and away_score from raw.games (BDL) into analytics.games.
 * Use when schedule shows wrong scores (e.g. DEN vs NYK). Raw is source of truth.
 *
 * Usage:
 *   npx tsx scripts/sync-analytics-game-scores-from-raw.ts
 *   npx tsx scripts/sync-analytics-game-scores-from-raw.ts --game-id 12345  # single game
 *   npx tsx scripts/sync-analytics-game-scores-from-raw.ts --dry-run
 *   npx tsx scripts/sync-analytics-game-scores-from-raw.ts --list  # list all games in both tables (for DEN/NYK check)
 */

import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
if (!process.env.SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL in .env');
  process.exit(1);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const list = process.argv.includes('--list');
  const gameIdIdx = process.argv.indexOf('--game-id');
  const singleGameId = gameIdIdx >= 0 && process.argv[gameIdIdx + 1]
    ? process.argv[gameIdIdx + 1]
    : null;

  const client = await pool.connect();
  try {
    if (list) {
      const listRows = await client.query(`
        SELECT g.game_id, ht.abbreviation as home_abbr, at.abbreviation as away_abbr,
               g.start_time, g.home_score, g.away_score, g.status
        FROM analytics.games g
        JOIN raw.games r ON g.game_id = r.id::text
        JOIN analytics.teams ht ON g.home_team_id = ht.team_id
        JOIN analytics.teams at ON g.away_team_id = at.team_id
        WHERE r.home_team_score IS NOT NULL AND r.visitor_team_score IS NOT NULL
        ORDER BY g.start_time DESC NULLS LAST
        LIMIT 30
      `);
      console.log('Recent games in BOTH analytics.games and raw.games (with scores):');
      listRows.rows.forEach((r: any) => {
        console.log(`  ${r.game_id}  ${r.away_abbr} @ ${r.home_abbr}  ${r.home_score}-${r.away_score}  ${r.start_time?.toISOString?.()?.slice(0, 10) ?? ''}`);
      });
      const denNyk = await client.query(`
        SELECT g.game_id, ht.abbreviation as home_abbr, at.abbreviation as away_abbr,
               g.home_score, g.away_score, g.start_time
        FROM analytics.games g
        JOIN analytics.teams ht ON g.home_team_id = ht.team_id
        JOIN analytics.teams at ON g.away_team_id = at.team_id
        WHERE (ht.abbreviation = 'DEN' AND at.abbreviation = 'NYK') OR (ht.abbreviation = 'NYK' AND at.abbreviation = 'DEN')
        ORDER BY g.start_time DESC NULLS LAST
      `);
      console.log('\nDEN vs NYK games in analytics.games:');
      if (denNyk.rows.length === 0) console.log('  (none)');
      denNyk.rows.forEach((r: any) => {
        const inRaw = listRows.rows.some((x: any) => x.game_id === r.game_id);
        console.log(`  ${r.game_id}  ${r.away_abbr} @ ${r.home_abbr}  ${r.home_score}-${r.away_score}  in_raw=${inRaw}  ${r.start_time?.toISOString?.()?.slice(0, 10) ?? ''}`);
      });
      return;
    }

    let sql = `
      SELECT g.game_id, g.home_team_id, g.away_team_id,
             ht.abbreviation as home_abbr, at.abbreviation as away_abbr,
             g.home_score as old_home, g.away_score as old_away,
             r.home_team_score as new_home, r.visitor_team_score as new_away
      FROM analytics.games g
      JOIN raw.games r ON g.game_id = r.id::text
      JOIN analytics.teams ht ON g.home_team_id = ht.team_id
      JOIN analytics.teams at ON g.away_team_id = at.team_id
      WHERE r.home_team_score IS NOT NULL AND r.visitor_team_score IS NOT NULL
    `;
    const params: string[] = [];
    if (singleGameId) {
      sql += ` AND g.game_id = $1`;
      params.push(singleGameId);
    }
    sql += ` ORDER BY g.start_time DESC NULLS LAST`;

    const rows = await client.query(sql, params);
    const toUpdate = rows.rows.filter(
      (r: any) => r.old_home !== r.new_home || r.old_away !== r.new_away
    );

    if (toUpdate.length === 0 && rows.rows.length > 0) {
      console.log('All analytics.games scores already match raw.games. Nothing to update.');
      return;
    }
    if (rows.rows.length === 0) {
      console.log('No games found in both analytics.games and raw.games with scores.');
      console.log('Backfill from BDL: npx tsx scripts/seed-games-bdl.ts --date YYYY-MM-DD');
      console.log('Then run: npx tsx scripts/transform-raw-to-analytics.ts');
      return;
    }

    console.log(`Found ${toUpdate.length} game(s) with score drift (of ${rows.rows.length} with raw scores).`);
    toUpdate.forEach((r: any) => {
      console.log(`  ${r.game_id} (${r.away_abbr} @ ${r.home_abbr}): analytics ${r.old_home}-${r.old_away} → raw ${r.new_home}-${r.new_away}`);
    });

    if (dryRun) {
      console.log('\nDry run. Run without --dry-run to apply updates.');
      return;
    }

    const updateResult = await client.query(
      `UPDATE analytics.games g
       SET home_score = r.home_team_score, away_score = r.visitor_team_score, updated_at = now()
       FROM raw.games r
       WHERE g.game_id = r.id::text
         AND r.home_team_score IS NOT NULL AND r.visitor_team_score IS NOT NULL
         AND (g.home_score IS DISTINCT FROM r.home_team_score OR g.away_score IS DISTINCT FROM r.visitor_team_score)`
      + (singleGameId ? ` AND g.game_id = $1` : ''),
      singleGameId ? [singleGameId] : []
    );
    console.log(`\nUpdated ${updateResult.rowCount} row(s) in analytics.games.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
