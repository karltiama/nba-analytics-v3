/**
 * Apply the reviewed 2026-27 roster subset.
 *
 * Official opening-night lists confirmed 10 moves and 16 additions.
 * Conflicting and provider-only rows are not in this statement.
 * One transaction. Raises and rolls back unless the affected counts match.
 *
 *   npx tsx scripts/roster/apply-approved-2026-roster.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

const APPLY_SQL = `
DO $$
DECLARE
  closed_count integer;
  inserted_count integer;
  open_2026 integer;
  open_2025 integer;
  rows_2025 integer;
  rows_2026 integer;
  bdl_open integer;
  dupes integer;
  avgs_2025 integer;
  avgs_2026 integer;
  players integer;
  excluded_still_open integer;
  trey_team text;
BEGIN
  IF (SELECT COUNT(*) FROM raw.roster_observation_batches
      WHERE batch_id = '65912e16-9343-51b0-8e29-9cbb99ada16b'
        AND snapshot_date = DATE '2026-10-12'
        AND season_label = '2026-27'
        AND provider = 'balldontlie'
        AND player_count = 624) <> 1 THEN
    RAISE EXCEPTION 'batch mismatch';
  END IF;

  IF (SELECT COUNT(*) FROM pg_indexes
      WHERE schemaname = 'analytics'
        AND indexname = 'analytics_player_team_stints_open_entity_uniq') <> 1 THEN
    RAISE EXCEPTION 'missing open unique index';
  END IF;

  IF (SELECT COUNT(*) FROM analytics.player_team_stints WHERE season = '2026' AND observed_to IS NULL) <> 578 THEN
    RAISE EXCEPTION 'open 2026 baseline drifted';
  END IF;
  IF (SELECT COUNT(*) FROM analytics.player_team_stints WHERE season = '2025' AND observed_to IS NULL) <> 514 THEN
    RAISE EXCEPTION 'open 2025 baseline drifted';
  END IF;
  IF (SELECT COUNT(*) FROM analytics.player_team_stints WHERE season = '2025') <> 698 THEN
    RAISE EXCEPTION '2025 row count drifted';
  END IF;
  IF (SELECT COUNT(*) FROM analytics.player_team_stints WHERE season = '2026' AND source = 'balldontlie') <> 0 THEN
    RAISE EXCEPTION 'unexpected balldontlie stints';
  END IF;
  IF (SELECT COUNT(*) FROM analytics.player_season_averages WHERE season = '2025') <> 603
     OR (SELECT COUNT(*) FROM analytics.player_season_averages WHERE season = '2026') <> 0 THEN
    RAISE EXCEPTION 'season averages drifted';
  END IF;
  IF (SELECT COUNT(*) FROM analytics.players) <> 5534 THEN
    RAISE EXCEPTION 'players table drifted';
  END IF;

  UPDATE analytics.player_team_stints s
  SET observed_to = DATE '2026-10-12',
      updated_at = now()
  FROM (VALUES
    (943::bigint, 'CHA'::text, '42972e0f-05f9-59ab-b1c9-45a8e53f7fa7'::uuid, '158'::text),
    (890::bigint, 'ATL'::text, 'f6c8088a-842d-5b8a-a2ab-ff9ff0865dfa'::uuid, '210'::text),
    (1403::bigint, 'TOR'::text, '708a2dd4-d053-5e79-8b4f-064738b1afe1'::uuid, '227'::text),
    (1117::bigint, 'LAC'::text, '8f03f1e2-fa7d-5775-9f19-597959f5dfbe'::uuid, '274'::text),
    (1123::bigint, 'LAC'::text, '5227c08d-998e-5844-868f-54bfab3404b0'::uuid, '38017686'::text),
    (1402::bigint, 'TOR'::text, '3c739fc1-d887-581a-b417-7922b7307ccb'::uuid, '56677828'::text),
    (1249::bigint, 'NOP'::text, '1e86b555-e158-5786-ac57-20decdc3759a'::uuid, '56677837'::text),
    (900::bigint, 'ATL'::text, 'eb866094-7b37-5c64-9fcf-171abe257dbe'::uuid, '1028025242'::text),
    (1162::bigint, 'MEM'::text, 'd44311c4-2577-5add-b71d-fcb790e6d96d'::uuid, '1028026717'::text),
    (891::bigint, 'ATL'::text, '3a2be9e9-1360-5fa8-9c15-c20bd48522ba'::uuid, '1057847894'::text)
  ) AS v(stint_id, from_abbr, player_entity_id, player_id)
  JOIN analytics.teams t ON t.abbreviation = v.from_abbr
  WHERE s.stint_id = v.stint_id
    AND s.season = '2026'
    AND s.observed_to IS NULL
    AND s.team_id = t.team_id
    AND s.player_entity_id = v.player_entity_id
    AND s.player_id = v.player_id
    AND s.source = 'nba_stats'
    AND s.observed_from = DATE '2026-09-04';
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  IF closed_count <> 10 THEN
    RAISE EXCEPTION 'close count % expected 10', closed_count;
  END IF;

  INSERT INTO analytics.player_team_stints (
    season, player_id, player_entity_id, team_id,
    observed_from, observed_to, source, source_player_id
  )
  SELECT
    '2026',
    p.player_id,
    e.player_entity_id,
    t.team_id,
    DATE '2026-10-12',
    NULL,
    'balldontlie',
    v.provider_player_id
  FROM (VALUES
    ('158'::text, '42972e0f-05f9-59ab-b1c9-45a8e53f7fa7'::uuid, 'ATL'::text),
    ('210'::text, 'f6c8088a-842d-5b8a-a2ab-ff9ff0865dfa'::uuid, 'CHI'::text),
    ('227'::text, '708a2dd4-d053-5e79-8b4f-064738b1afe1'::uuid, 'LAC'::text),
    ('274'::text, '8f03f1e2-fa7d-5775-9f19-597959f5dfbe'::uuid, 'TOR'::text),
    ('38017686'::text, '5227c08d-998e-5844-868f-54bfab3404b0'::uuid, 'NOP'::text),
    ('56677828'::text, '3c739fc1-d887-581a-b417-7922b7307ccb'::uuid, 'LAC'::text),
    ('56677837'::text, '1e86b555-e158-5786-ac57-20decdc3759a'::uuid, 'CHI'::text),
    ('1028025242'::text, 'eb866094-7b37-5c64-9fcf-171abe257dbe'::uuid, 'BOS'::text),
    ('1028026717'::text, 'd44311c4-2577-5add-b71d-fcb790e6d96d'::uuid, 'NOP'::text),
    ('1057847894'::text, '3a2be9e9-1360-5fa8-9c15-c20bd48522ba'::uuid, 'DEN'::text),
    ('125'::text, '044acd8b-ee90-5fe3-a954-ce176b908048'::uuid, 'DEN'::text),
    ('417'::text, '41a9d692-caf8-56e0-8055-17506ff646a3'::uuid, 'SAC'::text),
    ('3089'::text, '8ec68ebb-109a-5fe3-baba-7900e6890f64'::uuid, 'MIL'::text),
    ('3547240'::text, '73883e02-3ed9-561e-99db-2d4db3defea2'::uuid, 'NYK'::text),
    ('19465584'::text, '3f862dde-d720-5dd3-b28f-ad3b62b6de70'::uuid, 'POR'::text),
    ('19465585'::text, '336b3af6-8dac-5f50-96d7-7a53152bfa27'::uuid, 'MIA'::text),
    ('24489167'::text, '11860ff7-f610-5901-b7a2-efce6263d0a4'::uuid, 'GSW'::text),
    ('38017706'::text, '716894f1-debe-5b89-9ad0-a4ab17e75094'::uuid, 'OKC'::text),
    ('56677831'::text, '1d385fce-4a6a-5ce2-9183-f33487e4b7f2'::uuid, 'DEN'::text),
    ('56677866'::text, 'ea7728fa-8f4b-543b-8aa8-9ed382b3e849'::uuid, 'SAC'::text),
    ('56783340'::text, 'fabaa333-e31a-5603-a3ba-149172c69eec'::uuid, 'PHX'::text),
    ('1028203324'::text, 'f8696c73-0078-506b-b807-3ad37874c62b'::uuid, 'WAS'::text),
    ('1028245237'::text, '6872b0bc-ac71-5366-8208-f80e0d783f1b'::uuid, 'SAS'::text),
    ('1059276748'::text, 'b05a6263-24ca-5d27-a405-43becbdb5411'::uuid, 'NYK'::text),
    ('1059875475'::text, 'ad0218f1-8bac-5633-a5f2-b84074a3577a'::uuid, 'BKN'::text),
    ('1060111739'::text, '73514b0b-8208-5627-ba9e-06dd2b602021'::uuid, 'NOP'::text)
  ) AS v(provider_player_id, player_entity_id, team_abbr)
  JOIN analytics.teams t ON t.abbreviation = v.team_abbr
  JOIN analytics.players p ON p.player_id = v.provider_player_id
  JOIN analytics.player_entities e ON e.player_entity_id = v.player_entity_id;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count <> 26 THEN
    RAISE EXCEPTION 'insert count % expected 26', inserted_count;
  END IF;

  SELECT COUNT(*) INTO open_2026 FROM analytics.player_team_stints WHERE season = '2026' AND observed_to IS NULL;
  SELECT COUNT(*) INTO open_2025 FROM analytics.player_team_stints WHERE season = '2025' AND observed_to IS NULL;
  SELECT COUNT(*) INTO rows_2025 FROM analytics.player_team_stints WHERE season = '2025';
  SELECT COUNT(*) INTO rows_2026 FROM analytics.player_team_stints WHERE season = '2026';
  SELECT COUNT(*) INTO bdl_open FROM analytics.player_team_stints WHERE season = '2026' AND source = 'balldontlie' AND observed_to IS NULL;
  SELECT COUNT(*) INTO dupes FROM (
    SELECT player_entity_id
    FROM analytics.player_team_stints
    WHERE season = '2026' AND observed_to IS NULL
    GROUP BY player_entity_id
    HAVING COUNT(*) > 1
  ) d;
  SELECT COUNT(*) INTO avgs_2025 FROM analytics.player_season_averages WHERE season = '2025';
  SELECT COUNT(*) INTO avgs_2026 FROM analytics.player_season_averages WHERE season = '2026';
  SELECT COUNT(*) INTO players FROM analytics.players;
  SELECT COUNT(*) INTO excluded_still_open
  FROM analytics.player_team_stints
  WHERE stint_id IN (893,1022,1351,1180,1256,953,1129,1245,1019,1111,1433,1420)
    AND season = '2026' AND observed_to IS NULL;
  SELECT t.abbreviation INTO trey_team
  FROM analytics.player_team_stints s
  JOIN analytics.teams t ON t.team_id = s.team_id
  WHERE s.player_id = '1028203085' AND s.season = '2026' AND s.observed_to IS NULL;

  IF open_2026 <> 594 THEN RAISE EXCEPTION 'open 2026 % expected 594', open_2026; END IF;
  IF open_2025 <> 514 THEN RAISE EXCEPTION 'open 2025 % expected 514', open_2025; END IF;
  IF rows_2025 <> 698 THEN RAISE EXCEPTION '2025 rows % expected 698', rows_2025; END IF;
  IF rows_2026 <> 604 THEN RAISE EXCEPTION '2026 rows % expected 604', rows_2026; END IF;
  IF bdl_open <> 26 THEN RAISE EXCEPTION 'bdl open % expected 26', bdl_open; END IF;
  IF dupes <> 0 THEN RAISE EXCEPTION 'duplicate open 2026 entities %', dupes; END IF;
  IF avgs_2025 <> 603 OR avgs_2026 <> 0 THEN RAISE EXCEPTION 'averages changed'; END IF;
  IF players <> 5534 THEN RAISE EXCEPTION 'players changed'; END IF;
  IF excluded_still_open <> 12 THEN RAISE EXCEPTION 'excluded moves changed %', excluded_still_open; END IF;
  IF trey_team IS DISTINCT FROM 'UTA' THEN RAISE EXCEPTION 'trey team %', trey_team; END IF;
END $$;
`;

const READBACK_SQL = `
SELECT p.full_name, t.abbreviation AS team, s.observed_from::text AS observed_from,
       s.observed_to::text AS observed_to, s.source, s.stint_id
FROM analytics.player_team_stints s
JOIN analytics.players p ON p.player_id = s.player_id
JOIN analytics.teams t ON t.team_id = s.team_id
WHERE s.season = '2026'
  AND s.player_id IN (
    '158','210','227','274','38017686','56677828','56677837','1028025242','1028026717','1057847894',
    '125','417','3089','3547240','19465584','19465585','24489167','38017706','56677831','56677866',
    '56783340','1028203324','1028245237','1059276748','1059875475','1060111739','1028203085'
  )
  AND (s.observed_to IS NULL OR s.observed_to = DATE '2026-10-12')
ORDER BY p.full_name, s.observed_from;
`;

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error('SUPABASE_DB_URL is not set');
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(APPLY_SQL);
    await client.query('COMMIT');
    const readback = await client.query(READBACK_SQL);
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM analytics.player_team_stints WHERE season = '2026' AND observed_to IS NULL) AS open_2026,
        (SELECT COUNT(*) FROM analytics.player_team_stints WHERE season = '2025' AND observed_to IS NULL) AS open_2025,
        (SELECT COUNT(*) FROM analytics.player_team_stints WHERE season = '2026' AND source = 'balldontlie' AND observed_to IS NULL) AS bdl_open,
        (SELECT COUNT(*) FROM (
          SELECT player_entity_id FROM analytics.player_team_stints
          WHERE season = '2026' AND observed_to IS NULL
          GROUP BY player_entity_id HAVING COUNT(*) > 1
        ) d) AS duplicate_open_2026
    `);
    process.stdout.write(JSON.stringify({ committed: true, counts: counts.rows[0], rows: readback.rows }, null, 2));
    process.stdout.write('\n');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The failed statement already aborted the transaction.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
