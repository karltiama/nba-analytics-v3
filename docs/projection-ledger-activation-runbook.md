# Projection ledger activation runbook

Do not run this until a real 2026 game has passed the status-sync canary and an operator chooses the go-live slate. This phase does not execute these steps.

The ledger records what Court Context believed before tip. A 2026 game with `input_season_key = 2025` stays a valid prospective row when that is the production model at that moment. Do not relabel the input season.

## Before the live date

1. Confirm `nba-game-status-sync-schedule` is enabled and recent CloudWatch events `game_status_sync_completed` show fetches for the slate, not `fetched: 0` because the window is empty.
2. Confirm the slate games in `analytics.games` have a real `start_time` and that ISO `status` values are acceptable for publish. Publish keys off `start_time`. Closing lines still need exact `status = 'Final'` after the game.
3. Confirm props ingestion is writing `analytics.player_props_current` for those games.
4. From a clean git checkout of the commit to deploy, run `npm run build:projection-ledger-lambda`. The stamp writes `lambda/projection-ledger/.package/revision.json` and `infra/projection-ledger.revision.auto.tfvars.json` from `git rev-parse HEAD`. A dirty tree stamps an empty SHA and prospective writes fail closed. Do not type a SHA by hand.
5. Confirm `projectionConfigFingerprint()` is computed in the writer from the runtime constants. It is not an environment variable.
6. Confirm `analytics.projection_snapshots`, `analytics.projection_market_snapshots`, `analytics.projection_publish_attempts`, and `analytics.v_projection_performance` exist.
7. Record the resolved `getAnalyticsSeason()` value and expect `input_season_key` to match it, even when the game season differs.

## Deploy, still disabled

8. `terraform plan -var-file=terraform.tfvars` in `infra/`. The projection-ledger resources must show `state = DISABLED` and `PROJECTION_LEDGER_WRITES = 0`. Stop if unrelated resources would change.
9. Apply only when that plan is limited to the ledger. `projection_ledger_create` must be true for the Lambda to exist. The schedule resource stays `DISABLED`.
10. Put `SUPABASE_DB_URL` in `projection_ledger_lambda_env` only at this activation apply. The packaged SHA in `PROJECTION_LEDGER_GIT_SHA` must match `revision.json`. Leave `PROJECTION_LEDGER_WRITES` forced to `0` on this apply.

## Turn collection on

11. A follow-up change, reviewed on its own, sets `PROJECTION_LEDGER_WRITES` to `1` and the EventBridge rule state to `ENABLED`. Do not do that in the same change that first creates the Lambda.
12. Watch the first `rate(5 minutes)` invocation in CloudWatch for `projection_ledger_cycle`.
13. Confirm one on-time `T_MINUS_60` parent for a due game, with `provenance_type = PROSPECTIVE_LIVE` and `capture_eligible_at_write = true`.
14. Confirm sportsbook children, if any, have `observed_at <= generated_at`. A parent with zero children is valid.
15. Invoke again in the same window and confirm no second official row. A differing recompute logs `duplicate_conflict` and does not update the stored mean.
16. Read `analytics.projection_publish_attempts` for skips.

## Rollback

1. Set the EventBridge rule `projection-ledger-schedule` to `DISABLED`.
2. Set `PROJECTION_LEDGER_WRITES` back to `0` and apply.
3. Leave already-written prospective rows in place. Pausing collection is not a reason to delete them.
4. Use `analytics.projection_ledger_admin_delete` only for a row that was an infrastructure mistake, with an explicit reason. Do not use it to erase a real pre-tip belief.

## First-slate log checks

CloudWatch log group `/aws/lambda/projection-ledger`:

- `projection_ledger_skipped` with `reason` `writes_disabled`, `revision_rejected`, or `missing_database_url` means no prediction was written.
- `projection_ledger_cycle` reports `gamesSeen`, `inserted`, `duplicates`, `skipped`, and `errors`.

Then query:

```sql
SELECT outcome, count(*)
  FROM analytics.projection_publish_attempts
 WHERE attempted_at > now() - interval '6 hours'
 GROUP BY outcome
 ORDER BY outcome;
```

Look for `skipped_no_inputs`, `skipped_missing_code_revision`, `skipped_after_tip`, `duplicate_conflict`, `market_child_rejected`, and `error`.

Official rows:

```sql
SELECT count(*) FROM analytics.v_projection_performance;
```
