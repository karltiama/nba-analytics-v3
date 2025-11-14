import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

(async () => {
  // Check what game provider mappings exist
  const mappings = await pool.query(
    `
    select entity_type, provider, provider_id, internal_id, metadata
    from provider_id_map
    where entity_type = 'game'
    order by provider, provider_id
    limit 20
    `,
  );

  console.log('Game provider mappings:');
  console.log(JSON.stringify(mappings.rows, null, 2));

  // Check games and their provider mappings
  const gamesWithMappings = await pool.query(
    `
    select g.game_id, g.status, g.home_score, g.away_score,
           pm.provider, pm.provider_id as provider_game_id
    from games g
    left join provider_id_map pm on g.game_id = pm.internal_id and pm.entity_type = 'game'
    where g.start_time::date >= '2025-10-21'
      and g.start_time::date <= '2025-10-22'
    order by g.start_time
    limit 10
    `,
  );

  console.log('\nGames with provider mappings:');
  console.log(JSON.stringify(gamesWithMappings.rows, null, 2));

  await pool.end();
})();

