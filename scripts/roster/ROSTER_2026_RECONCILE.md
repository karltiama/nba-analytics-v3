# Season 2026 roster reconcile

Prepared from the stored BallDontLie batch `65912e16-9343-51b0-8e29-9cbb99ada16b` (`snapshot_date` 2026-10-12, season label 2026-27). No provider call.

The dry run proposed 22 moves and 57 additions. The NBA opening-night roster publication of October 19–20, 2026 confirmed 10 of those moves and 16 of those additions. The applied write is that confirmed subset. Conflicting and provider-only rows were left unchanged. A second run of `apply-approved-2026-roster.ts` aborts because the open-2026 baseline is no longer 578.

Regenerate the summary with:

```
npx tsx scripts/roster/dry-run-stored-roster.ts
```

That script runs SELECT statements only.

## Prepared writes

All writes are `analytics.player_team_stints` where `season = '2026'`.

- Close 10 confirmed open stints by setting `observed_to = 2026-10-12`. The September row stays.
- Insert 10 replacement stints for those players, `observed_from = 2026-10-12`, `source = 'balldontlie'`, `observed_to` null.
- Insert 16 stints for confirmed players who had no open 2026 stint.
- Leave the other 12 proposed moves and 41 proposed additions unchanged.
- Leave 446 matching memberships unchanged.
- Do not close the 110 open 2026 stints absent from the batch.
- Do not insert the 99 batch players with no canonical entity.
- Do not write season 2025 or earlier.
- Do not write `analytics.players`, `analytics.player_game_logs`, `analytics.player_season_averages`, or prop tables.

Apply in one transaction. Close a stint before inserting its replacement so the open-stint unique index `(player_entity_id, season) WHERE observed_to IS NULL` holds. Roll back the transaction if any close matches 0 rows.

```sql
UPDATE analytics.player_team_stints
   SET observed_to = DATE '2026-10-12',
       updated_at = now()
 WHERE stint_id = $stint_id
   AND season = '2026'
   AND observed_to IS NULL
   AND team_id = $from_team_id;
```

```sql
INSERT INTO analytics.player_team_stints (
  season, player_id, player_entity_id, team_id,
  observed_from, observed_to, source, source_player_id
) VALUES (
  '2026', $player_id, $player_entity_id, $to_team_id,
  DATE '2026-10-12', NULL, 'balldontlie', $provider_player_id
);
```

Use the names, entity ids, and stint ids in `october-2026-roster-dry-run.json`.

## Pre-check

```sql
SELECT season, COUNT(*) FILTER (WHERE observed_to IS NULL) AS open_stints
FROM analytics.player_team_stints
WHERE season IN ('2025', '2026')
GROUP BY season;
-- Expect 514 open 2025 and 578 open 2026 before apply.
```

```sql
SELECT COUNT(*) FROM analytics.player_team_stints
WHERE season = '2026' AND source = 'balldontlie' AND observed_to IS NULL;
-- Expect 0 before apply.
```

## Post-check

```sql
SELECT COUNT(*) FROM analytics.player_team_stints
WHERE season = '2026' AND source = 'balldontlie' AND observed_to IS NULL;
-- Expect 26 after the confirmed apply (10 moves + 16 additions).
```

```sql
SELECT player_entity_id, COUNT(*)
FROM analytics.player_team_stints
WHERE season = '2026' AND observed_to IS NULL
GROUP BY player_entity_id
HAVING COUNT(*) > 1;
-- Expect no rows.
```

```sql
SELECT COUNT(*) FILTER (WHERE observed_to IS NULL) AS open_2025
FROM analytics.player_team_stints
WHERE season = '2025';
-- Expect 514, unchanged.
```

## Rollback

Inside the same change window, reverse only rows this apply created:

```sql
DELETE FROM analytics.player_team_stints
WHERE season = '2026'
  AND source = 'balldontlie'
  AND observed_from = DATE '2026-10-12'
  AND observed_to IS NULL;

UPDATE analytics.player_team_stints
   SET observed_to = NULL, updated_at = now()
 WHERE season = '2026'
   AND observed_to = DATE '2026-10-12'
   AND stint_id IN (943, 890, 1403, 1117, 1123, 1402, 1249, 900, 1162, 891);
```

Run the open-stint duplicate check again after rollback. Do not delete 2025 rows.

## Mass-close guard

Closing the 110 absent stints would be 110 of 578 open rows (19.0%). The existing guard refuses more than 30 closes or more than 5% of open stints. `massCloseIfAbsenceWereApplied.ok` is false. This plan sets those closes to zero.
