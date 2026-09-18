# Activation runbook — dual prospective collection

Do **not** enable until an eligible tip is inside the operational horizon and Phase 19B readiness = PASS.

## Pre-flight (every activation)

1. **Freeze hashes**
   ```bash
   npx vitest run lib/context-projection/__tests__/active-prospective-freeze.test.ts
   npx tsx scripts/ops/certify-context-projection-activation-readiness.ts
   ```
   Require PTS SHA `36f68abd…`, MIN SHA `7354e0a8…`, windows/N unchanged.

2. **Competition universe**
   - Confirm tip passes `isPrimaryProspectiveCompetitionGame` (not preseason).
   - Amendment: `prospective-game-universe-v1`.

3. **Upcoming tip discovery**
   ```bash
   npm run ops:context-projection-prospective-status
   # or readiness cert JSON: NEXT_ELIGIBLE_*_CANDIDATE_TIP
   ```

4. **Deploy infra with collection still disabled** (first time)
   ```bash
   npm run build:context-prospective-shadow-lambda
   # terraform.tfvars:
   #   context_prospective_create = true
   #   context_prospective_enable_schedule = true
   #   context_prospective_execution_enabled = false   # keep DISABLED
   #   live_ingestion_enabled = false                 # or true only if other families allow
   terraform apply
   ```
   Verify EventBridge state **DISABLED**, write flags **0**.

5. **Enable schedule + writes** (activation)
   Set Lambda env (and/or tfvars `context_prospective_lambda_env`):
   ```text
   DATA_MODE=live_api
   CRON_DRY_RUN=0
   OFFSEASON_MODE=0
   CONTEXT_PTS_SHADOW_WRITES=1
   CONTEXT_MIN_SHADOW_WRITES=1
   CONTEXT_PROSPECTIVE_SCHEDULE_CONFIGURED=1
   CONTEXT_PROSPECTIVE_WINDOW_OPENED_AT=2026-09-18T16:05:48Z
   CONTEXT_PROSPECTIVE_ACTIVATION_READY=1
   SUPABASE_DB_URL=<secret>
   ```
   Then:
   ```text
   context_prospective_execution_enabled = true
   live_ingestion_enabled = true
   terraform apply
   ```

6. **Health**
   - Invoke Lambda `{ "action": "status" }` or `npm run ops:context-projection-prospective-status`
   - Expect **ARMED** (writes+schedule on, N=0) until first row.

7. **Zero historical backfill**
   - Confirm `PTS_CURRENT_N=0` and `MIN_PREGAME_N=0` immediately after enable, before first T−60.

8. **First genuine T−60 row**
   - After first due window: verify pregame `prediction_created_at`, cutoff ≤ T−60, correct window IDs, model SHAs, competition class ≠ PRESEASON, not synthetic.

9. **State → COLLECTING**
   - Only after a valid genuine primary row exists (not merely because EventBridge is ENABLED).

## Independent experiments

PTS and MIN may produce first rows on different players/slates. Do not wait for the other.

## Rollback

```text
CONTEXT_*_SHADOW_WRITES=0
context_prospective_execution_enabled=false
```
Schedule DISABLED. Do not delete cohort rows.
