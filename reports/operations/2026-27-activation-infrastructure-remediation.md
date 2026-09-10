# 2026–27 Activation Infrastructure Remediation — Step 13C.1

**Step verdict:** `GREEN — activation infrastructure is safe enough to proceed to injuries/odds canary`

**Date:** 2026-09-10  
**Scope:** Fail-close Terraform schedule enablement, keep reserved concurrency 4 as the *desired* target without faking AWS application, set an activation-canary BDL operating rate, add a Final-preserve upsert guard. No injuries/odds activation. No recurring ingestion thaw. No `PINNED_ANALYTICS_SEASON` flip.

---

## Safety / Scope

| Gate | Before 13C.1 | After 13C.1 |
| --- | --- | --- |
| `DATA_MODE` | `replay` | `replay` (all four BDL Lambdas) |
| `OFFSEASON_MODE` | `1` | `1` |
| `CRON_DRY_RUN` | `1` | `1` |
| BDL ingestion schedules | nightly/odds/injuries DISABLED; props Scheduler ENABLED; boxscore ENABLED | **all DISABLED** (EventBridge + Scheduler) |
| Analytics pin | `PINNED_ANALYTICS_SEASON=2025` | **2025** |
| Props / odds / injuries activation | no | **no** |
| Market Movement snapshots | no | **no** |
| DB writes / migrations | no | **no** |
| S3 writes | no | **no** |
| Rookie mappings | no | **no** |
| Postgame ingestion | no | **no** |
| Vercel Dynamo/BDL creds | deferred | **`MOVE_TO_SERVING_DATA_LATER`** (unchanged) |

Master infrastructure switch: `live_ingestion_enabled = false` (Terraform default and live tfvars).

---

## Schedule Certification Carry-Forward

Do not redesign schedule ingestion. 13C live reconciliation remains exact:

| Metric | Value |
| --- | --- |
| Live BDL 2026 games | **1,200** |
| Local `analytics.games` season 2026 | **1,200** |
| Matching IDs | **1,200** |
| Live-only / local-only | **0 / 0** |
| Dry-run inserts / updates / conflicts | **0 / 0 / 0** |
| Tip-time semantics | READY (`datetime` → `start_time` UTC) |
| Status normalization | READY (ISO `status` → Scheduled) |

Expected regular-season complement is 1,230. The remaining **30** are classified **`PROVIDER_NOT_YET_PUBLISHED`**. Future sync must discover them idempotently by stable BDL game ID. Do not fabricate them.

---

## Terraform Schedule-State Problem

13C found a deployment-safety hole:

* live tfvars still have per-family `*_enable_schedule = true` (and non-empty `odds_schedule_crons` / props crons)
* AWS EventBridge nightly/odds/injuries were **manually DISABLED**
* HCL did not set `state`, so a later full apply could re-enable those rules
* props Scheduler and boxscore were **ENABLED** in AWS while freeze env no-op’d the Lambdas

Odds count is driven by `odds_schedule_crons` (non-empty list ignores `odds_enable_schedule` for resource existence). That count was **left unchanged** so existing rules were not destroyed. Enablement is now a separate `state` control.

---

## Schedule-State Remediation

Single source of truth:

```hcl
variable "live_ingestion_enabled" {
  type    = bool
  default = false
}

locals {
  ingestion_schedule_state = var.live_ingestion_enabled ? "ENABLED" : "DISABLED"
}
```

Every ingestion schedule resource now sets `state = local.ingestion_schedule_state`:

* `aws_cloudwatch_event_rule.nightly_bdl_schedule`
* `aws_cloudwatch_event_rule.odds_schedule` (9 rules)
* `aws_cloudwatch_event_rule.injuries_schedule`
* `aws_cloudwatch_event_rule.boxscore_schedule`
* `aws_scheduler_schedule.player_props_crons`
* `aws_scheduler_schedule.player_props_rate`

Per-family `enable_*` / cron lists still **create** resources. They cannot **ENABLED-thaw** them.

**Controlled future activation:**

1. Set `live_ingestion_enabled = true` in live tfvars.
2. Flip freeze env on the families you intend to run (`DATA_MODE=live_api`, `OFFSEASON_MODE=0`, `CRON_DRY_RUN=0`).
3. Do not flip `PINNED_ANALYTICS_SEASON` as part of that thaw.

Until step 1, a full apply with stale `enable_schedule = true` keeps schedules **DISABLED**.

---

## Terraform Safety Tests

Mechanical tests in `infra/__tests__/ingestion-schedule-fail-closed.test.ts`:

| Case | Assertion |
| --- | --- |
| Frozen configuration | `live_ingestion_enabled` default false; every schedule resource uses `local.ingestion_schedule_state`; no hardcoded `state = "ENABLED"` |
| Activation configuration | only the master ternary can resolve `"ENABLED"` |
| Unrelated apply | per-family enable flags control `count` only, not `state` |
| Props Scheduler | `player_props_crons` and `player_props_rate` included |

Example tfvars require `live_ingestion_enabled = false` as an assignment (thaw instructions in comments are allowed).

---

## Lambda Concurrency Quota

| Item | Value |
| --- | --- |
| Current `ConcurrentExecutions` (quota `L-B99A9384`, us-east-1) | **10** |
| AWS unreserved floor | **10** |
| Desired props reserved concurrency | **4** |
| Minimum quota to apply reserved 4 | **14** (4 reserved + 10 unreserved) |
| **Recommended quota target** | **20** |
| Existing increase requests | none |
| Classification | **`NOT_REQUESTED`** |

**Why 20 (modest):** 4 reserved for props + 16 unreserved (6 above the floor) for overlapping nightly / odds / injuries / boxscore / controller. Do not request hundreds.

**Why not applied automatically:** this step documents the exact request; it does not pretend AWS approved it.

CLI (account owner):

```bash
aws service-quotas request-service-quota-increase \
  --service-code lambda \
  --quota-code L-B99A9384 \
  --desired-value 20 \
  --region us-east-1
```

Console: Service Quotas → Amazon Lambda → Concurrent executions → Request increase → **20**.

After approval: set `player_props_apply_reserved_concurrency = true` and apply. Until then Terraform **omits** reserved concurrency (`null` / unreserved).

---

## Props Reserved Concurrency Status

| Item | Status |
| --- | --- |
| Desired target | **4** (unchanged) |
| Apply gate | `player_props_apply_reserved_concurrency` default **false** |
| AWS observed | `ReservedConcurrentExecutions = null` (unreserved); Terraform output `-1` |
| Pretend-applied? | **no** |

**Why 4 stays the target:** SQS `batch_size = 1`; the shared Dynamo limiter now owns BDL request rate; reserved concurrency still bounds worker/cost/duplicate-processing pressure. A reduction to 1 would only dodge the quota and is not justified by queue architecture.

This is **not** a 13D injuries/odds blocker. Injuries and odds do not need the props reservation. Provider safety is the shared limiter + disabled schedules + freeze.

---

## BDL Entitlement Evidence

Classification: **`BDL_ENTITLEMENT_REQUIRES_ACCOUNT_CONFIRMATION`**

Do not treat 13C 429s as proof that paid GOAT is ~5 requests/minute.

| Source | What it shows | What it does not show |
| --- | --- | --- |
| BDL docs (external) | Paid GOAT is substantially higher; 48-hour GOAT trial is 5 req/min | Which tier *this* key currently has |
| `lib/balldontlie/trial-limiter.ts` | Historical-safe trial cadence 12–13s | Live account tier |
| 13C canary (~1 rps) | ~6 grants then 429, Retry-After **55s** | Paid vs trial; no dashboard confirmation |
| Repo subscription/config | Freeze env + API key present; no tier metadata stored | Cannot classify GOAT vs trial without exposing credentials / dashboard |

No API keys printed. No subscription purchase or change.

**Provider entitlement:** unknown / needs account confirmation.  
**Court Context operating rate:** independent, set conservatively below the *observed* trial-like ceiling until confirmation.

---

## Observed 429 / Retry-After Analysis

From 13C captured canary (`reports/operations/2026-27-schedule-status-canary-live.json` + operator report). **No additional provider calls** were made in 13C.1.

| Metadata | Observed? |
| --- | --- |
| HTTP 429 | **yes** (2), after ~6 requests at ~1 rps |
| `Retry-After` | **yes**, **55 seconds** both times (`retry_after_ms` in throttle logs) |
| `X-RateLimit-Limit` / remaining / reset | **not captured** |
| Other rate-limit headers | **not captured** in persisted artifacts |

The canary persisted throttle *decisions*, not a full header dump. Existing limiter code only reads `retry-after`. That is sufficient to keep 13B cooldown behavior.

---

## Temporary Activation Rate

Label: **`activation-canary safety rate`** (not a permanent GOAT production cadence).

| Setting | Value |
| --- | --- |
| `BDL_RATE_LIMIT_INTERVAL_MS` | **13000** |
| `BDL_RATE_LIMIT_MAX_REQUESTS` | **1** |
| `BDL_RATE_LIMIT_BURST` | **1** |
| `BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS` | **90000** |

Matches the already-proven historical trial cadence (`BDL_TRIAL_DEFAULT_DELAY_MS = 13000`). Deployed on nightly / odds / injuries / props worker env. Code default in `lambda/shared/bdl-live-rate-limit.ts` matches.

Raise only after paid GOAT entitlement is confirmed **and** a measured canary. Do not load-test the provider ceiling.

---

## Global Cooldown Verification

13B behavior **kept**:

429 → parse `Retry-After` → `setCooldownUntilMs` on the shared Dynamo store → sibling workers wait → bounded retry → fail closed.

Covered by `lib/balldontlie/__tests__/live-rate-limit.test.ts` (honor Retry-After, bound retries, sibling cooldown). Not removed when the nominal interval changed from 1000ms to 13000ms.

---

## Final-Preserve Guard

Nightly / `refresh-schedule-from-bdl` upserts previously overwrote `status` and scores on conflict, so a stale Scheduled refresh could regress `Final → Scheduled`.

**Lifecycle:**

| Transition | Allowed on schedule sync? |
| --- | --- |
| Scheduled → In Progress | yes |
| Scheduled → Final | yes |
| Scheduled → Scheduled (tip change) | yes |
| Final → Final (score/datetime correction) | yes |
| **Final → Scheduled / In Progress / tipoff ISO** | **no** |

SQL CASE on `raw.games` and `analytics.games` preserves status, scores, and tip when the existing row is certified Final and incoming is not. Marker `final-preserve-guard`. Tests in `lib/betting/__tests__/final-preserve.test.ts` (no production DB mutation).

**`status_state`:** 2025 BDL payloads include `status_state: "final"`. The 2026 canary did not persist that field. Current working normalization of free-form `status` is left intact. Later migration only if the live endpoint is certified and regression tests prove a safety gain.

---

## Optional Re-Canary

**Skipped.** Terraform schedule safety is applied, throttle env is 13000ms, and limiter code is deployed — but entitlement remains `BDL_ENTITLEMENT_REQUIRES_ACCOUNT_CONFIRMATION`. This step does not generate BDL traffic solely to diagnose tier. No full-season re-download. No props/odds/injuries calls.

---

## Terraform Plan / Apply

Full plan with live frozen tfvars (`live_ingestion_enabled = false`, family flags still `true`):

| Action | Count |
| --- | --- |
| Create | **0** |
| Update | **9** |
| Destroy | **0** |

Updates applied:

* `boxscore_schedule`: ENABLED → **DISABLED**
* `player_props_crons[0..2]`: ENABLED → **DISABLED**
* nightly / odds / injuries Lambdas: package + limiter env (`INTERVAL=13000`); freeze flags unchanged
* props worker + controller: package; worker limiter env 13000; **no reserved-concurrency 4**

Nightly / odds / injuries EventBridge rules were already DISABLED in AWS and **did not appear** in the plan (HCL `state=DISABLED` now matches reality, so a future full apply will not ENABLED-thaw them).

Unrelated drift: none destructive. Apply: **0 added, 9 changed, 0 destroyed**.

---

## Freeze Verification

Post-apply AWS:

| Check | Result |
| --- | --- |
| nightly EventBridge | DISABLED |
| injuries EventBridge | DISABLED |
| odds EventBridge (spot-check rule 0) | DISABLED |
| boxscore EventBridge | DISABLED |
| props Scheduler 0/1/2 | DISABLED |
| Lambda freeze env | `replay` / `1` / `1` on nightly, odds, injuries, props worker |
| Limiter env | `INTERVAL=13000`, `BACKEND=dynamodb`, table `nba-bdl-rate-limit` ACTIVE |
| Props reserved concurrency | unreserved (`null` / `-1`) |
| Pin | `PINNED_ANALYTICS_SEASON=2025` |

---

## Remaining Blockers

| Item | Blocks 13D injuries/odds? |
| --- | --- |
| Lambda quota 10; reserved 4 not applied | **no** (preferred, not required; isolate from injuries/odds) |
| `BDL_ENTITLEMENT_REQUIRES_ACCOUNT_CONFIRMATION` | **no** for a conservative injuries/odds canary at 13s; **yes** before raising the operating rate |
| 30 unpublished 2026 games | **no** (`PROVIDER_NOT_YET_PUBLISHED`) |
| Vercel direct BDL | **no** (`MOVE_TO_SERVING_DATA_LATER`) |

---

## 13D Go / No-Go

**GO for Step 13D injuries/odds canary** under freeze + disabled schedules + activation-canary rate.

Do **not** begin 13D automatically from this step. Do **not** enable `live_ingestion_enabled`. Do **not** flip the season pin.

---

## Recommendation

1. Confirm BDL tier in the provider dashboard (do not paste keys). If paid GOAT, a later step may raise the Court Context operating rate *below* the documented GOAT ceiling — never equal to it by default.
2. Account owner requests Lambda `ConcurrentExecutions` **20** (`L-B99A9384`). After `APPROVED`, set `player_props_apply_reserved_concurrency = true`.
3. Start 13D as an explicit injuries/odds canary only. Keep `live_ingestion_enabled = false` until that canary is certified.

---

## Verification Checklist

1. Confirm AWS EventBridge nightly/odds/injuries/boxscore and props Scheduler 0/1/2 are **DISABLED**.
2. Confirm Lambda env still `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`, `BDL_RATE_LIMIT_INTERVAL_MS=13000`.
3. Confirm `PINNED_ANALYTICS_SEASON` is still `2025` in `lib/season.ts`.
4. Confirm props worker has **no** reserved concurrency in AWS (`ReservedConcurrentExecutions` empty).
5. Run `npx vitest run infra/__tests__/ingestion-schedule-fail-closed.test.ts infra/__tests__/player-props-reserved-concurrency.test.ts lib/betting/__tests__/final-preserve.test.ts lib/balldontlie/__tests__/live-rate-limit.test.ts`.
6. Do not enable `live_ingestion_enabled` or start injuries/odds until you explicitly begin 13D.
7. If requesting quota: use desired value **20**, then classify `REQUESTED` / `PENDING` / `APPROVED` from the Service Quotas console — never assume reserved 4 exists.

---

## Step Verdict

`GREEN — activation infrastructure is safe enough to proceed to injuries/odds canary`
