import 'dotenv/config';
import db, { query } from '../../lib/db';

async function main() {
  const rows = await query<{
    game_id: string;
    season: string;
    start_time: string;
    home: string;
    away: string;
  }>(
    `SELECT g.game_id::text AS game_id, g.season, g.start_time::text AS start_time,
            ht.abbreviation AS home, at.abbreviation AS away
     FROM analytics.games g
     JOIN analytics.teams ht ON ht.team_id = g.home_team_id
     JOIN analytics.teams at ON at.team_id = g.away_team_id
     WHERE lower(btrim(g.status)) = 'final'
       AND (
         (g.season = '2023' AND g.start_time >= '2024-01-15' AND g.start_time < '2024-01-16')
         OR (g.season = '2024' AND g.start_time >= '2024-12-25' AND g.start_time < '2024-12-26')
         OR (g.season = '2024' AND g.start_time >= '2025-01-15' AND g.start_time < '2025-01-16')
       )
     ORDER BY g.season, g.start_time
     LIMIT 20`
  );
  console.log(JSON.stringify(rows, null, 2));
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
