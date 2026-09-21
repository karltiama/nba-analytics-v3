import 'dotenv/config';
import pool, { query } from '@/lib/db';

async function main() {
  const eid = '3c40d25e-4f50-5a31-8170-36f1d02bbb29';
  const stints = await query(
    `SELECT season, team_id, observed_from::text, observed_to::text,
            source, membership_type, player_id
     FROM analytics.player_team_stints
     WHERE player_entity_id = $1::uuid
     ORDER BY season, observed_from`,
    [eid]
  );
  console.log('Brown stints:', stints);

  const snaps = await query(
    `SELECT snapshot_date::text, analytics_season, team_abbreviation,
            analytics_team_id, roster_status
     FROM raw.nba_roster_snapshots
     WHERE nba_player_id = (
       SELECT provider_player_id FROM analytics.player_provider_ids
       WHERE player_entity_id = $1::uuid AND provider = 'nba' LIMIT 1
     )
     ORDER BY snapshot_date DESC
     LIMIT 20`,
    [eid]
  );
  console.log('Brown recent snapshots:', snaps);

  // Sample: players on BOS 2025 not on BOS 2026 — where are they now?
  const departedCandidates = await query(
    `SELECT prev.display_name, prev.player_entity_id::text AS eid,
            curr.abbreviation AS other_abbr
     FROM analytics.team_roster_current prev
     LEFT JOIN analytics.team_roster_current curr
       ON curr.player_entity_id = prev.player_entity_id
      AND curr.season = '2026'
      AND curr.team_id <> prev.team_id
     LEFT JOIN analytics.teams t ON t.team_id = curr.team_id
     WHERE prev.team_id = '2' AND prev.season = '2025'
       AND NOT EXISTS (
         SELECT 1 FROM analytics.team_roster_current c2
         WHERE c2.team_id = '2' AND c2.season = '2026'
           AND c2.player_entity_id = prev.player_entity_id
       )
     ORDER BY prev.display_name`
  );
  // fix join
  const departed = await query(
    `WITH prev AS (
       SELECT * FROM analytics.team_roster_current WHERE team_id='2' AND season='2025'
     ),
     curr_bos AS (
       SELECT player_entity_id FROM analytics.team_roster_current WHERE team_id='2' AND season='2026'
     )
     SELECT p.display_name, p.player_entity_id::text AS eid, p.player_id,
            o.abbreviation AS elsewhere_2026
     FROM prev p
     LEFT JOIN curr_bos cb ON cb.player_entity_id = p.player_entity_id
     LEFT JOIN analytics.team_roster_current oth
       ON oth.player_entity_id = p.player_entity_id AND oth.season = '2026'
     LEFT JOIN analytics.teams o ON o.team_id = oth.team_id
     WHERE cb.player_entity_id IS NULL
     ORDER BY p.display_name`
  );
  console.log('BOS 2025 not on BOS 2026:', departed);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
