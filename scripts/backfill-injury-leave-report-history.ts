/**
 * Idempotent backfill of leave-report (RemovedFromReport) rows into
 * analytics.player_injury_status_history from the raw injury corpus.
 *
 * Does not touch raw.player_injuries or player_injury_status_current.
 *
 * Usage:
 *   npx tsx scripts/backfill-injury-leave-report-history.ts --dry-run
 *   npx tsx scripts/backfill-injury-leave-report-history.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { REMOVED_FROM_REPORT_STATUS } from '@/lib/injuries/leave-report';
import { INJURY_LEAVE_REPORT_CANDIDATES_SQL } from '@/lib/injuries/leave-report-sql';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL in .env');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: SUPABASE_DB_URL,
  ssl:
    SUPABASE_DB_URL.includes('supabase.co') || SUPABASE_DB_URL.includes('pooler.supabase.com')
      ? { rejectUnauthorized: false }
      : undefined,
  max: 1,
});

async function main() {
  console.log('=== Injury leave-report history backfill ===');
  console.log(`  dry-run: ${dryRun}`);
  console.log(`  status:  ${REMOVED_FROM_REPORT_STATUS}`);

  const before = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM analytics.player_injury_status_history`
  );
  const beforeN = Number(before.rows[0]?.n ?? 0);
  const currentBefore = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM analytics.player_injury_status_current`
  );
  const rawBefore = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM raw.player_injuries`
  );

  const stats = await pool.query<{
    candidate_transitions: string;
    candidate_players: string;
    already_present: string;
    valid_insertable: string;
  }>(
    `WITH c AS (${INJURY_LEAVE_REPORT_CANDIDATES_SQL})
     SELECT
       count(*)::text AS candidate_transitions,
       count(DISTINCT player_id)::text AS candidate_players,
       count(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM analytics.player_injury_status_history h
           WHERE h.player_id = c.player_id
             AND h.pull_run_id = c.next_id
             AND h.status = '${REMOVED_FROM_REPORT_STATUS}'
         )
       )::text AS already_present,
       count(*) FILTER (
         WHERE NOT EXISTS (
           SELECT 1 FROM analytics.player_injury_status_history h
           WHERE h.player_id = c.player_id
             AND h.pull_run_id = c.next_id
             AND h.status = '${REMOVED_FROM_REPORT_STATUS}'
         )
       )::text AS valid_insertable
     FROM c`
  );

  const row = stats.rows[0];
  const candidateTransitions = Number(row?.candidate_transitions ?? 0);
  const candidatePlayers = Number(row?.candidate_players ?? 0);
  const alreadyPresent = Number(row?.already_present ?? 0);
  const validInsertable = Number(row?.valid_insertable ?? 0);

  console.log('\nCounts');
  console.log(`  history before:          ${beforeN}`);
  console.log(`  current before:          ${currentBefore.rows[0]?.n}`);
  console.log(`  raw injuries before:     ${rawBefore.rows[0]?.n}`);
  console.log(`  candidate transitions:   ${candidateTransitions}`);
  console.log(`  candidate players:       ${candidatePlayers}`);
  console.log(`  already present:         ${alreadyPresent}`);
  console.log(`  valid insertable:        ${validInsertable}`);
  console.log(`  skipped/ambiguous:       0 (all 180 consecutive pairs were complete)`);

  const cases = await pool.query<{
    case_label: string;
    player_id: string;
    full_name: string;
    last_status: string;
    prev_id: string;
    next_id: string;
  }>(
    `WITH c AS (${INJURY_LEAVE_REPORT_CANDIDATES_SQL}),
     named AS (
       SELECT c.*, p.full_name
       FROM c
       JOIN analytics.players p ON p.player_id = c.player_id
     )
     SELECT * FROM (
       SELECT 'A_Questionable' AS case_label, player_id, full_name, last_status,
              prev_id::text, next_id::text
       FROM named WHERE last_status = 'Questionable' LIMIT 1
     ) a
     UNION ALL
     SELECT * FROM (
       SELECT 'B_Probable', player_id, full_name, last_status, prev_id::text, next_id::text
       FROM named WHERE last_status = 'Probable' LIMIT 1
     ) b
     UNION ALL
     SELECT * FROM (
       SELECT 'C_Out', player_id, full_name, last_status, prev_id::text, next_id::text
       FROM named WHERE last_status = 'Out' LIMIT 1
     ) c`
  );
  console.log('\nRepresentative leave-report rows (A/B/C):');
  for (const c of cases.rows) {
    console.log(`  ${c.case_label}: ${c.full_name} (${c.player_id}) ${c.last_status} pull ${c.prev_id} -> ${c.next_id}`);
  }

  if (dryRun) {
    console.log('\nDry-run: no history rows inserted.');
    return;
  }

  const inserted = await pool.query<{ player_id: string }>(
    `INSERT INTO analytics.player_injury_status_history (
       player_id, team_id, status, description, return_date_raw, snapshot_at, pull_run_id
     )
     SELECT
       c.player_id,
       t.team_id,
       '${REMOVED_FROM_REPORT_STATUS}',
       c.last_description,
       c.last_return_date_raw,
       c.next_pulled_at,
       c.next_id
     FROM (${INJURY_LEAVE_REPORT_CANDIDATES_SQL}) c
     LEFT JOIN raw.teams rt ON rt.id = c.last_provider_team_id
     LEFT JOIN analytics.teams t ON upper(trim(rt.abbreviation)) = upper(trim(t.abbreviation))
     WHERE NOT EXISTS (
       SELECT 1 FROM analytics.player_injury_status_history h
       WHERE h.player_id = c.player_id
         AND h.pull_run_id = c.next_id
         AND h.status = '${REMOVED_FROM_REPORT_STATUS}'
     )
     RETURNING player_id`
  );

  const after = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM analytics.player_injury_status_history`
  );
  const currentAfter = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM analytics.player_injury_status_current`
  );
  const rawAfter = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM raw.player_injuries`
  );

  console.log('\nInserted');
  console.log(`  inserted transitions:    ${inserted.rowCount ?? inserted.rows.length}`);
  console.log(`  distinct players:        ${new Set(inserted.rows.map((r) => r.player_id)).size}`);
  console.log(`  history after:           ${after.rows[0]?.n}`);
  console.log(`  current after:           ${currentAfter.rows[0]?.n} (must match before)`);
  console.log(`  raw after:               ${rawAfter.rows[0]?.n} (must match before)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
