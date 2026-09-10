# 2026–27 Schedule/Status Canary — Step 13C

**Step verdict:** `YELLOW — schedule/status canary works but reconciliation or infrastructure issue must be resolved`

**Date:** 2026-09-10  
**Scope:** Deploy 13B provider-safety infrastructure under freeze, then one bounded live `GET /v1/games?seasons[]=2026` read through `fetchBdlLive`. No recurring schedule activation, no analytics pin flip, no market ingestion, no 13D.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| Freeze flags on Lambdas after deploy | `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1` |
| `PINNED_ANALYTICS_SEASON` | **2025** (unchanged) |
| Recurring BDL schedules enabled by this step | **no** |
| DB migration / S3 writes / market ingest / rookies | **none** |
| Full Terraform apply | **not used** (would risk re-enabling DISABLED EventBridge rules) |
| Targeted apply | Dynamo + IAM + Lambda packages/env |
| Live BDL | **one** schedule/games pagination canary (~15 HTTP attempts) |

Production freeze was certified **before** apply and **after** apply. Frozen invokes of nightly/odds/injuries returned `skippedProviderCalls` / skip payloads with **no** BDL.

---

## 13B Deployment Result

| Item | Deployed? |
| --- | --- |
| DynamoDB `nba-bdl-rate-limit` | **yes** (ACTIVE, PAY_PER_REQUEST, pk/sk, TTL `expires_at`) |
| Least-privilege IAM on 4 BDL worker roles | **yes** |
| Throttle env on nightly / odds / injuries / props worker | **yes** |
| Limiter + `@aws-sdk/client-dynamodb` in Lambda zips | **yes** |
| `player_props_worker` reserved concurrency **4** | **no** — account quota blocks it |

---

## Terraform Plan / Apply

### Why `-target`

Live `terraform.tfvars` has all `*_enable_schedule = true`, and those schedule **resources already exist**. AWS actuals:

| Family | AWS state |
| --- | --- |
| nightly EventBridge | **DISABLED** |
| odds EventBridge (9 rules) | **DISABLED** |
| injuries EventBridge | **DISABLED** |
| boxscore EventBridge | ENABLED (BBRef, freeze no-op) |
| props EventBridge Scheduler (3) | ENABLED (freeze no-op; not BDL HTTP while frozen) |

HCL does not set `state = DISABLED`. A **full apply** could re-enable nightly/odds/injuries. That is exactly the 13C stop condition, so apply was **targeted**.

### Targeted plan (applied)

`5 to add, 4 to change, 0 to destroy`

| Action | Resource |
| --- | --- |
| create | `aws_dynamodb_table.bdl_rate_limit` |
| create | 4× `aws_iam_role_policy.*_bdl_rate_limit` |
| update | nightly / odds / injuries / props worker Lambdas (hash + `BDL_RATE_LIMIT_*` env keys) |
| update | props `reserved_concurrent_executions` `-1 → 4` **(this sub-step failed)** |

Env key diffs were only `BDL_RATE_LIMIT_*`. Freeze triad stayed `replay` / `1` / `1`. No season env added. No destroys.

### Apply

- Table + IAM + nightly/odds/injuries Lambda updates: **succeeded**
- Props worker **code + env succeeded**, then `PutFunctionConcurrency` failed:

> Specified ReservedConcurrentExecutions for function decreases account's UnreservedConcurrentExecution below its minimum value of [10].

Account `ConcurrentExecutions` quota is **10**. Unreserved floor is **10**. **Any** reserved concurrency is impossible until the quota is raised.

Terraform state was refresh-only updated so observed reserved concurrency is **-1**, not a false **4**.

---

## Dynamo / IAM Verification

**Table `nba-bdl-rate-limit`**

- Billing: PAY_PER_REQUEST
- Keys: `pk` (HASH), `sk` (RANGE)
- TTL: `expires_at` ENABLED
- GSI/LSI: **none**
- SSE: default AWS-owned (no customer CMK) — appropriate

**IAM (exact workers)**

| Role | Actions | Resource |
| --- | --- | --- |
| `nightly-bdl-updater-execution-role` | GetItem, PutItem, UpdateItem | table ARN only |
| `odds-pre-game-snapshot-execution-role` | same | same |
| `injuries-snapshot-execution-role` | same | same |
| `nba-player-props-ingestion-lambda-execution-role` | same | same |

No Scan, no `dynamodb:*`, no controller role. Lambda env `BDL_RATE_LIMIT_TABLE=nba-bdl-rate-limit`.

---

## Lambda Packaging Verification

| Check | Result |
| --- | --- |
| `tsc` emits `bdl-live-rate-limit.js` + dynamo adapter | yes (tsconfig include fixed for nightly/odds/injuries) |
| Zip contains `node_modules/@aws-sdk/client-dynamodb` | yes (all four BDL zips) |
| Copy-drift unit test | pass |
| Frozen nightly invoke | 200, `skippedProviderCalls: true` |
| Frozen odds invoke | 200, skipped |
| Frozen injuries invoke | 200, skipped |
| Props worker live invoke | **not run** (do not trigger props ingestion); zip + env verified instead |
| Dynamo client at runtime | **proven by canary** (`fetchBdlLive` + dynamodb backend granted permits) |

Limiter sleep typing was tightened (`Promise<void>`) so Lambda `tsc` compiles. That is a packaging fix, not a limiter redesign.

---

## Props Reserved Concurrency Verification

| Source | Value |
| --- | --- |
| Terraform variable default | **4** |
| Terraform desired on worker | **4** |
| AWS observed | **unset / -1 (unreserved)** |
| Match? | **no** |

Cannot wire 4 on this account without raising the Lambda concurrent-execution quota above 10.

---

## Freeze-State Verification

After deploy:

- All four BDL Lambdas: `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`
- Pin still 2025
- BDL EventBridge rules still DISABLED
- No automatic BDL traffic from this deploy (canary was an explicit operator script)
- Frozen worker invokes skipped provider calls

Pre-existing props Scheduler rules remain ENABLED but freeze still no-ops the controller/worker. This step did **not** disable them (would be extra schedule mutation).

---

## Canary Request Accounting

Operator script: `scripts/ops/2026-schedule-status-canary.ts`  
Artifact: `reports/operations/2026-27-schedule-status-canary-live.json`

| Field | Value |
| --- | --- |
| Path | `GET /v1/games?seasons[]=2026&per_page=100` |
| Successful pages | **13** |
| HTTP attempts | **15** (13×200 + 2×429 retried) |
| Throttle grants | 15 |
| 429 count | **2** |
| Retry-After | **55s** both times (honored; no immediate retry) |
| Duration | **124.0s** (dominated by two 55s cooldowns) |
| Burst | 1; inter-grant waits ~0.3–0.7s when not in cooldown |

Client: `fetchBdlLive` / worker `schedule-status-canary` / Dynamo table `nba-bdl-rate-limit`. API keys not logged.

**This is not a certified GOAT quota.** 1 req/s is the current Court Context live safety **setting**. Live evidence: that setting still drew 429s after ~6 requests.

---

## Live 2026 Schedule Certification

| Metric | Live provider |
| --- | --- |
| Total games | **1200** |
| Unique IDs | 1200 |
| Null IDs | 0 |
| Duplicate IDs | 0 |
| `postseason=true` | **0** |
| Teams | **30** |
| First `date` | **2026-10-20** |
| Last `date` | **2027-04-11** (some `datetime`/`status` instants are `2027-04-12T00:30Z` = Apr 11 evening ET) |
| Null `datetime` | **0** |

NBA 30×82/2 = **1230** regular-season games. Provider currently publishes **1200** — **30 not released**, not a local ingestion bug.

---

## Local vs Provider Schedule Reconciliation

Local `analytics.games` season `2026`: **1200** rows.

| Set | Count |
| --- | --- |
| Matching IDs | **1200** |
| Present live / missing locally | **0** |
| Present locally / absent live | **0** |

---

## Missing / Extra Games

None vs local. Gap vs 1230 is **provider schedule incompleteness** (late-season / unreleased games). No inserts performed.

---

## Status Semantics

Every live `status` is an ISO instant (`2026-10-20T19:00:00Z`, …). **0** `Scheduled`/`Final`/`In Progress` strings.

`normalizeGameStatus` / `looksLikeTipoffOrDatetimeStatus` maps all **1200 → Scheduled**. Existing logic is correct; do not rewrite because strings look unusual.

---

## Tip-Time / Timezone Certification

**Canonical field for scheduled tip:** BDL `datetime` (UTC instant) stored as `analytics.games.start_time` (timestamptz). Do not treat `status` as a second clock, though today it duplicates the same ISO.

Fallback `date + T12:00:00.000Z` in nightly/refresh was **not** needed (0 null datetimes).

Samples:

| Game | UTC | ET | PT |
| --- | --- | --- | --- |
| BOS `21717855` | 2026-10-20T19:00:00Z | Tue Oct 20, 3:00 PM EDT | 12:00 PM PDT |
| NYK `21717856` | 2026-10-20T23:00:00Z | Tue Oct 20, 7:00 PM EDT | 4:00 PM PDT |
| LAL/GSW `21717859` | 2026-10-22T02:00:00Z | Wed Oct 21, 10:00 PM EDT | 7:00 PM PDT |

Future 3-Hour Pre-Tip must derive from `start_time` / `datetime`, not calendar `date` noon.

---

## Dry-Run Sync Result

Against current local 2026 rows (no writes):

| Proposed | Count |
| --- | --- |
| inserts | 0 |
| updates | 0 |
| unchanged | 1200 |
| conflicts | 0 |

Existing upsert (`on conflict (id)` / `game_id`) can later insert missing games and update tip/status. **Risk to flag, not fix:** it also overwrites `status`/scores on existing rows, including historical Finals, with whatever BDL returns. Add a Final-preserve guard before thawing nightly write sync. Game IDs are stable BDL integers. Schedule sync does **not** require roster/rookie rows.

---

## Season Configuration Dependencies

`PINNED_ANALYTICS_SEASON=2025` **not flipped**.

| Reference | Class |
| --- | --- |
| `lib/season.ts` pin 2025 | **activation flip required** for product “current season” |
| Nightly `resolveIngestionSeasonStartYear` fallback 2025 | **dangerous hardcode** if thawed without pin/env |
| `CURRENT_ANALYTICS_SEASON` env (unset on Lambdas) | **live/current dynamic** when set |
| Historical Explorer 2023–2025 | **historical fixed intentionally** |
| 2026 rows already in `analytics.games` | schedule/status season **independent** of analytics pin |

Keeping the pin at 2025 after later live ingest: dashboards/averages/logs stay on 2025; 2026 schedule can already sit in `analytics.games`. A successful 13C canary is **not** authorization to flip analytics.

---

## Vercel BDL Recommendation

**`MOVE_TO_SERVING_DATA_LATER`**

| Path | Today | 13C recommendation |
| --- | --- | --- |
| `refresh-schedule-from-bdl` | Vercel on-request BDL | AWS nightly/schedule job owns writes; Vercel should read Supabase |
| Matchup `fetchLineupsFromBallDontLie` | Vercel BDL (60s cache) | freeze currently skip; later serve starters from DB/archive, keep BDL only if in-game lineups are required |
| `bdl-player-names-from-api` | occasional research | not a production slate path |

Do not give Vercel Dynamo credentials just to duplicate AWS ingress. Canary stayed AWS-credentials + shared client, not Vercel.

---

## Limiter Live Verification

| Check | Result |
| --- | --- |
| Went through `fetchBdlLive` | yes (`evt: bdl_throttle`) |
| Dynamo coordination | succeeded (grants, not `coordination_error`) |
| Fail-open on throttle failure | **no** |
| Burst > 1 | **no** |
| 429 handling | Retry-After 55s + global cooldown; retry then success |
| 1 rps “safe vs provider” | **not claimed**; 429s occurred |

Language: **current Court Context live safety setting**, not certified GOAT limit.

---

## Schedule Product Readiness

| Slice | Status |
| --- | --- |
| Schedule coverage | **PARTIAL** — 1200/1200 vs local; 1200/1230 vs full RS |
| Tip-time quality | **READY** |
| Status normalization | **READY** |
| Dry-run sync | **READY** (no writes needed now) |
| Live recurring schedule job | **NOT ACTIVATED** |

---

## Remaining Blockers

1. **Lambda account concurrency quota = 10** → reserved concurrency 4 cannot be applied. Raise quota, then apply worker reserved concurrency.
2. **1 rps drew 429s** (Retry-After 55s). Raise `BDL_RATE_LIMIT_INTERVAL_MS` (toward 10–12s) **before** any thawed recurring BDL job. Do not treat 1 rps as provider capacity.
3. **30 regular-season games** still unpublished by BDL (vs 1230). Re-canary later; no local write required today.
4. Nightly upsert can overwrite Finals — guard before write activation.
5. Do not full-apply Terraform until EventBridge `state` is explicit DISABLED or tfvars schedules are false.

---

## Recommendation for Step 13D

**Do not start injuries + odds activation yet.**

Next implementation slice:

**Raise Lambda unreserved/concurrency quota and slow the live BDL interval, then re-apply props reserved concurrency = 4.**

Only after that: **13D — certify injuries + game-odds under still-disabled or explicitly bounded schedules.**

Schedule reconciliation does **not** need a write pass first (0 diffs).

---

## What 13C did NOT do

- Enable recurring BDL EventBridge rules
- Activate props / odds / injuries ingestion
- Market Movement snapshots
- Flip analytics season to 2026
- Rookie mappings
- Advanced / Season Averages / Plays / 2026 starters
- Possessions / WOWY / UI redesign

---

## Verification Checklist

1. Freeze still `replay` / `1` / `1` on the four BDL Lambdas.
2. `nba-bdl-rate-limit` exists with TTL `expires_at`.
3. Props reserved concurrency in AWS is **unset**, not 4.
4. Nightly/odds EventBridge remain **DISABLED**.
5. Canary JSON: 1200 live = 1200 local, 0 missing/extra.
6. Pin still 2025.
7. Do not start 13D until quota + interval are addressed.

---

## Step Verdict

`YELLOW — schedule/status canary works but reconciliation or infrastructure issue must be resolved`
