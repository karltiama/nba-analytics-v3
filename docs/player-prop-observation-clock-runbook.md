# Player-prop observation clock: recovery runbook

Covers `db/schemas/MIGRATION_player_prop_observation_clock.sql`. Applied to production on 2026-10-09 (Phase 1B.5B Gate 1).

## What the migration added

- `raw.player_prop_snapshots_v2` and `analytics.player_props_current`: `observed_at`, `controller_enqueued_at`, `provider_updated_at`, `observation_clock`, plus a `NOT VALID` all-or-nothing clock check on each.
- `research.prop_decision_lines`: `decision_clock`, plus a `NOT VALID` value check.
- `research.v_prop_decision_lines`: `decision_clock` appended as column 15. The dependent view `research.v_prop_eval_units` does not read it.

Expected schema check after the migration: `9|3|1`.

```sql
select
  (select count(*) from information_schema.columns
    where column_name in ('observed_at','controller_enqueued_at','provider_updated_at','observation_clock','decision_clock')
      and table_schema in ('raw','analytics','research')
      and table_name in ('player_prop_snapshots_v2','player_props_current','prop_decision_lines'))
  ||'|'|| (select count(*) from pg_constraint where conname in (
      'player_prop_snapshots_v2_observation_clock_check',
      'player_props_current_observation_clock_check',
      'prop_decision_lines_decision_clock_check'))
  ||'|'|| (select count(*) from information_schema.columns
      where table_schema='research' and table_name='v_prop_decision_lines' and column_name='decision_clock');
```

## Prefer leaving it in place

The change is additive and backward compatible. Old readers ignore the new columns; the deployed props worker requires them.
Roll back only if the migration itself breaks something (for example the decision-line views error).

## When rollback is safe

Safe only while every observation-clock value is NULL:

```sql
select
  (select count(*) from raw.player_prop_snapshots_v2
    where observation_clock is not null or observed_at is not null
       or controller_enqueued_at is not null or provider_updated_at is not null) as snapshots,
  (select count(*) from analytics.player_props_current
    where observation_clock is not null or observed_at is not null
       or controller_enqueued_at is not null or provider_updated_at is not null) as current_props,
  (select count(*) from research.prop_decision_lines where decision_clock is not null) as decision_lines;
```

All three must be `0`. Rollback stops being safe as soon as either of these happens:

- The props worker writes its first snapshot (it fills `observation_clock` and `observed_at`).
- Closing-line materialization writes `decision_clock`.

After that, dropping the columns would destroy observation evidence. The rollback script checks this and refuses.
Freeze the props worker (ESM disabled, schedules disabled) before considering any rollback.

## Rollback procedure

Do not use `research_v_prop_decision_lines.sql`. It needs the new columns.
`CREATE OR REPLACE VIEW` also cannot remove `decision_clock`.

`db/schemas/ROLLBACK_player_prop_observation_clock.sql`, in one transaction (5 s lock timeout, 60 s statement timeout):

1. Refuses if any observation-clock value exists.
2. Drops `research.v_prop_eval_units`, then `research.v_prop_decision_lines`.
3. Drops the three constraints and the added columns.
4. Clears the two column comments the migration added.
5. Recreates both views from the pre-migration production definitions, with their original comments.

Run it as the owning role (`postgres`), with `psql -v ON_ERROR_STOP=1 -f db/schemas/ROLLBACK_player_prop_observation_clock.sql`. Do not print the connection string.
The Supabase MCP connection is read-only and cannot run DDL.

Expected after rollback:

- The schema check returns `0|0|0`.
- `md5(pg_get_viewdef('research.v_prop_decision_lines'::regclass, true))` = `499b7eb810b98a50518c9a69f1b3b141`.
- `md5(pg_get_viewdef('research.v_prop_eval_units'::regclass, true))` = `46dae27e91dedba1f75f3daaa92234f5`.
- `research.prop_decision_lines` row count unchanged.

The deployed props worker refuses to run (before any provider call) once the columns are gone. Keep it frozen until the migration is reapplied.

## Verifying the rollback locally

`scripts/ops/observation-clock-rollback/verify-rollback.ps1` starts a throwaway local PostgreSQL 17 cluster under `tmp/`. It uses schema-only stubs with production column types, and no production data.

It checks:

- The pre-migration view definitions reproduce the production hashes.
- The migration yields `9|3|1`, with `decision_clock` as column 15.
- A second run of the migration is a no-op.
- The rollback restores both hashes and the row counts.
- The guard refuses when a clock value exists.
- A row with `observed_at` but no clock is rejected.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ops/observation-clock-rollback/verify-rollback.ps1
```

Expected last line before shutdown: `ROLLBACK_VERIFY=PASS`.
If the production view definitions change later, recapture them and update both the rollback file and the expected hashes.
