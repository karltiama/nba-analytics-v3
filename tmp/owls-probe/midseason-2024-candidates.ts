import 'dotenv/config';
import db, { query } from '../../lib/db';

async function main() {
  const rows = await query<{
    game_id: string;
    season: string;
    start_time: string;
    home: string;
    away: string;
    status: string;
  }>(
    `SELECT g.game_id::text AS game_id, g.season, g.start_time::text AS start_time,
            ht.abbreviation AS home, at.abbreviation AS away, g.status
     FROM analytics.games g
     JOIN analytics.teams ht ON ht.team_id = g.home_team_id
     JOIN analytics.teams at ON at.team_id = g.away_team_id
     WHERE lower(btrim(g.status)) = 'final'
       AND g.season = '2024'
       AND g.start_time >= '2025-01-10'
       AND g.start_time < '2025-02-16'
     ORDER BY g.start_time, g.game_id`
  );
  console.log(JSON.stringify({ count: rows.length, sample: rows.slice(0, 40) }, null, 2));
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
