/**
 * Fetch a sample of player props for a given player (by name or player_id) for today's games.
 * Reads from analytics.player_props_current (populated by player-props-snapshot Lambda).
 * Note: player_name is often null in DB; use player_id for reliable lookup.
 *
 *   npx tsx scripts/fetch-sample-player-props.ts
 *   npx tsx scripts/fetch-sample-player-props.ts "Cade Cunningham"
 *   npx tsx scripts/fetch-sample-player-props.ts --id 3547239
 *   npx tsx scripts/fetch-sample-player-props.ts "Cade Cunningham" 2026-03-17
 */
import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: SUPABASE_DB_URL,
  ssl: SUPABASE_DB_URL.includes('supabase') ? { rejectUnauthorized: false } : undefined,
});

function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function main() {
  const args = process.argv.slice(2);
  const idArg = args.find((a) => a === '--id');
  const playerIdArg = idArg ? args[args.indexOf('--id') + 1] : null;
  const playerIdNum = playerIdArg ? parseInt(playerIdArg, 10) : null;
  const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const dateStr = dateArg ?? getTodayET();
  const playerName = !idArg && args[0] && !/^\d{4}-\d{2}-\d{2}$/.test(args[0]) ? args[0] : 'Cade Cunningham';

  const label = playerIdNum != null ? `player_id=${playerIdNum}` : playerName;
  console.log(`=== Sample player props: ${label} (${dateStr} ET) ===\n`);

  const todayGames = await pool.query(
    `SELECT game_id
     FROM analytics.games
     WHERE start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
       AND start_time <  (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')`,
    [dateStr]
  );
  const gameIdsRaw = (todayGames.rows as { game_id: string | number }[]).map((r) => r.game_id);
  const gameIds = gameIdsRaw.map((id) => (typeof id === 'string' ? parseInt(id, 10) : id));
  if (gameIds.length === 0) {
    console.log('No games found for this date.');
    await pool.end();
    return;
  }

  const byId = playerIdNum != null && !Number.isNaN(playerIdNum);
  let props: { rows: any[] };
  let source = 'analytics.player_props_current';

  if (byId) {
    props = await pool.query(
      `SELECT game_id, player_id, player_name, sportsbook, prop_type, market_type, side, line_value,
              odds_american, odds_decimal, implied_probability, snapshot_at
       FROM analytics.player_props_current
       WHERE player_id = $1 AND game_id = ANY($2)
       ORDER BY prop_type, side, line_value NULLS LAST, sportsbook
       LIMIT 40`,
      [playerIdNum, gameIds]
    );
    if (props.rows.length === 0) {
      const rawProps = await pool.query(
        `SELECT game_id, player_id, player_name, sportsbook, prop_type, market_type, side, line_value,
                odds_american, odds_decimal, implied_probability, fetched_at as snapshot_at
         FROM raw.player_prop_snapshots_v2
         WHERE player_id = $1 AND game_id = ANY($2)
         ORDER BY fetched_at DESC, prop_type, side, line_value NULLS LAST, sportsbook
         LIMIT 40`,
        [playerIdNum, gameIds]
      );
      if (rawProps.rows.length > 0) {
        props = rawProps;
        source = 'raw.player_prop_snapshots_v2';
      }
    }
  } else {
    props = await pool.query(
      `SELECT game_id, player_id, player_name, sportsbook, prop_type, market_type, side, line_value,
              odds_american, odds_decimal, implied_probability, snapshot_at
       FROM analytics.player_props_current
       WHERE player_name ILIKE $1 AND game_id = ANY($2)
       ORDER BY prop_type, side, line_value NULLS LAST, sportsbook
       LIMIT 40`,
      [`%${playerName}%`, gameIds]
    );
    if (props.rows.length === 0) {
      const rawProps = await pool.query(
        `SELECT game_id, player_id, player_name, sportsbook, prop_type, market_type, side, line_value,
                odds_american, odds_decimal, implied_probability, fetched_at as snapshot_at
         FROM raw.player_prop_snapshots_v2
         WHERE player_name ILIKE $1 AND game_id = ANY($2)
         ORDER BY fetched_at DESC, prop_type, side, line_value NULLS LAST, sportsbook
         LIMIT 40`,
        [`%${playerName}%`, gameIds]
      );
      if (rawProps.rows.length > 0) {
        props = rawProps;
        source = 'raw.player_prop_snapshots_v2';
      }
    }
  }

  if (props.rows.length === 0) {
    console.log(`No props found for ${byId ? `player_id=${playerIdNum}` : `"${playerName}"`} on ${dateStr}.`);
    console.log(`Today game_ids: ${gameIds.join(', ')}`);
    if (!byId) {
      console.log('Tip: player_name is often null in DB. Use --id <BDL_player_id> to fetch by ID (e.g. npx tsx scripts/fetch-sample-player-props.ts --id 3547239).');
    }
    await pool.end();
    return;
  }

  console.log(`Found ${props.rows.length} rows (sample) from ${source}. Game IDs today: ${gameIds.join(', ')}\n`);
  (props.rows as any[]).forEach((r, i) => {
    const line = r.line_value != null ? ` line=${r.line_value}` : '';
    const odds = r.odds_american != null ? ` ${r.odds_american > 0 ? '+' : ''}${r.odds_american}` : '';
    console.log(
      `${i + 1}. ${r.prop_type} ${r.side ?? ''}${line} @ ${r.sportsbook ?? '—'}${odds} (${r.snapshot_at})`
    );
  });

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
