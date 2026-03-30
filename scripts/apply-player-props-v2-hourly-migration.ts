/**
 * Applies hourly dedupe for raw.player_prop_snapshots_v2 in hour-sized chunks (avoids statement timeout),
 * then creates raw_player_prop_snapshots_v2_hourly_unique_idx if missing.
 *
 * Env: SUPABASE_DB_URL
 *
 * Usage: npx tsx scripts/apply-player-props-v2-hourly-migration.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('Set SUPABASE_DB_URL');
  process.exit(1);
}

const deleteForWindow = `
with ranked as (
  select id,
    row_number() over (
      partition by game_id, player_id, sportsbook, prop_type, side, line_value, date_trunc('hour', fetched_at at time zone 'UTC')
      order by fetched_at desc, id desc
    ) as rn
  from raw.player_prop_snapshots_v2
  where fetched_at >= $1::timestamptz
    and fetched_at < $2::timestamptz
)
delete from raw.player_prop_snapshots_v2 t
using (select id from ranked where rn > 1) d
where t.id = d.id
`;

function utcHourStart(dayStr: string, hour: number): Date {
  const [y, m, d] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, 0, 0, 0));
}

async function main() {
  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = '300s'`);

    const days = await client.query<{ d: string }>(
      `select distinct (date_trunc('day', fetched_at) at time zone 'UTC')::date::text as d
       from raw.player_prop_snapshots_v2
       order by 1`
    );
    console.log(`Days to process: ${days.rows.map((r) => r.d).join(', ')}`);

    for (const row of days.rows) {
      const d = row.d;
      let dayTotal = 0;
      for (let h = 0; h < 24; h++) {
        const start = utcHourStart(d, h);
        const end = utcHourStart(d, h + 1);
        const r = await client.query(deleteForWindow, [start.toISOString(), end.toISOString()]);
        const n = r.rowCount ?? 0;
        dayTotal += n;
        if (n > 0) console.log(`  ${d} ${String(h).padStart(2, '0')}:00Z: deleted ${n}`);
      }
      console.log(`Day ${d} total duplicates removed: ${dayTotal}`);
    }

    await client.query(`SET statement_timeout = '0'`);
    await client.query(`
      create unique index if not exists raw_player_prop_snapshots_v2_hourly_unique_idx
        on raw.player_prop_snapshots_v2 (
          game_id,
          player_id,
          sportsbook,
          prop_type,
          side,
          line_value,
          (date_trunc('hour', fetched_at at time zone 'UTC'))
        )
    `);
    console.log('Unique index raw_player_prop_snapshots_v2_hourly_unique_idx ensured.');

    const sum = await client.query<{ total: string; rows: string; null_json: string; with_json: string }>(
      `select
        pg_size_pretty(pg_total_relation_size('raw.player_prop_snapshots_v2')) as total,
        (select count(*)::text from raw.player_prop_snapshots_v2) as rows,
        (select count(*)::text from raw.player_prop_snapshots_v2 where raw_json is null) as null_json,
        (select count(*)::text from raw.player_prop_snapshots_v2 where raw_json is not null) as with_json`
    );
    console.log('Post-migration:', sum.rows[0]);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
