/**
 * Backfill provider_id_map with balldontlie player mappings.
 * Matches public.players -> analytics.players by full_name, then inserts
 * (entity_type='player', provider='balldontlie', internal_id=public_id, provider_id=analytics_id).
 *
 * Idempotent (ON CONFLICT DO NOTHING).
 *
 * Usage: npx tsx scripts/backfill-provider-id-map-players.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  const c = await pool.connect();
  try {
    const res = await c.query(`
      INSERT INTO provider_id_map (entity_type, provider, internal_id, provider_id)
      SELECT 'player', 'balldontlie', pp.player_id, ap.player_id
      FROM public.players pp
      JOIN analytics.players ap ON pp.full_name = ap.full_name
      ON CONFLICT (entity_type, provider, provider_id) DO NOTHING
    `);
    console.log(`Inserted ${res.rowCount} balldontlie player mappings into provider_id_map.`);

    const total = await c.query(
      "SELECT count(1) as cnt FROM provider_id_map WHERE entity_type='player' AND provider='balldontlie'"
    );
    console.log(`Total balldontlie player mappings: ${total.rows[0].cnt}`);
  } finally {
    c.release();
    pool.end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
