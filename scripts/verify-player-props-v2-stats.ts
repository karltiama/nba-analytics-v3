import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const p = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const q = await p.query(
    `select pg_size_pretty(pg_total_relation_size('raw.player_prop_snapshots_v2')) as total,
            (select count(*)::text from raw.player_prop_snapshots_v2) as rows,
            (select count(*)::text from raw.player_prop_snapshots_v2 where raw_json is null) as null_json,
            (select count(*)::text from raw.player_prop_snapshots_v2 where raw_json is not null) as with_json`
  );
  console.log(q.rows[0]);
  await p.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
