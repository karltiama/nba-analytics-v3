/**
 * Probe roster churn to pick challenging 10-team sample (read-only).
 */
import 'dotenv/config';
import pool, { query } from '@/lib/db';

async function main() {
  const rows = await query<{
    abbreviation: string;
    prev_n: number;
    curr_n: number;
    missing_from_curr: number;
    new_on_curr: number;
  }>(
    `
    WITH prev AS (
      SELECT team_id, player_entity_id
      FROM analytics.team_roster_current
      WHERE season = '2025'
    ),
    curr AS (
      SELECT team_id, player_entity_id
      FROM analytics.team_roster_current
      WHERE season = '2026'
    )
    SELECT
      t.abbreviation,
      (SELECT count(*) FROM prev p WHERE p.team_id = t.team_id)::int AS prev_n,
      (SELECT count(*) FROM curr c WHERE c.team_id = t.team_id)::int AS curr_n,
      (SELECT count(*) FROM prev p
        WHERE p.team_id = t.team_id
          AND NOT EXISTS (
            SELECT 1 FROM curr c
            WHERE c.team_id = t.team_id AND c.player_entity_id = p.player_entity_id
          ))::int AS missing_from_curr,
      (SELECT count(*) FROM curr c
        WHERE c.team_id = t.team_id
          AND NOT EXISTS (
            SELECT 1 FROM prev p
            WHERE p.team_id = t.team_id AND p.player_entity_id = c.player_entity_id
          ))::int AS new_on_curr
    FROM analytics.teams t
    `
  );
  rows.sort(
    (a, b) =>
      b.missing_from_curr +
      b.new_on_curr -
      (a.missing_from_curr + a.new_on_curr)
  );
  for (const r of rows) {
    console.log(
      `${r.abbreviation}\tmiss=${r.missing_from_curr}\tnew=${r.new_on_curr}\tprev=${r.prev_n}\tcurr=${r.curr_n}`
    );
  }
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
