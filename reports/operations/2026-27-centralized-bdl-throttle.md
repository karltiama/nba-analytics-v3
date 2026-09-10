# 2026–27 Centralized BDL Throttle — Step 13B

**Step verdict:** `GREEN — centralized BDL rate limiting is implementation-ready for activation canary`

**Date:** 2026-09-10  
**Scope:** Infrastructure / control-plane hardening only. No schedule enablement, no Terraform apply, no Lambda deploy, no live BALLDONTLIE HTTP, no production freeze-flag changes, no 13C.

Historical Explorer v2 remains `SHIP_READY`. Market Movement v1 remains historical-only. `PINNED_ANALYTICS_SEASON = 2025` is unchanged. `player_props_current` was not repaired. Rookie identity mapping was not touched.

STOP after this step. Do not start Step 13C automatically.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| Live BDL HTTP | **0** (unit/integration tests used mocked `fetch` / fake clocks) |
| Production freeze flags | **unchanged** (`DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`) |
| EventBridge / Scheduler enablement | **none** |
| Lambda deploy | **none** |
| Terraform apply | **none** (`fmt` + `validate` only; `init -backend=false`) |
| S3 writes | **none** |
| DB migration | **none** (DynamoDB table is Terraform-only; not applied) |
| Props/odds/injury ingestion activation | **none** |
| 2026 season-pin flip | **none** (`PINNED_ANALYTICS_SEASON` still `2025`) |
| Rookie mapping | **none** |
| Market Movement live snapshots | **none** |
| Postgame workers / possession / WOWY | **none** |

---

## BDL Caller Inventory

Live-runtime paths that can reach `api.balldontlie.io` (not archive crawls):

| Caller | Client / helper | Previous throttle | Retries | Retry-After | Concurrency | Max calls / invocation | Overlap possible? | Shared infra now? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nightly BDL updater | `fetchBdlLive` via `fetchWithRetry` | local ~200ms between **game batches** only | 5xx: `MAX_RETRIES` (3) + 60s backoff; 429 now inside `fetchBdlLive` | **honored** in shared client | Lambda unreserved | schedule pages + stats pages (dozens typical) | yes vs odds/injuries/props | **yes** (Dynamo token bucket) |
| Odds pre-game snapshot | `fetchBdlLive` | local ~200ms / process | 429 bounded in shared client | **honored** | Lambda unreserved | ~2–4 date pages | yes | **yes** |
| Injuries snapshot | `fetchBdlLive` | local ~200ms / process | same | **honored** | Lambda unreserved | ~1–3 injury pages | yes | **yes** |
| Player props **worker** | `fetchBdlLive` in `src/fetch.ts` | 429 → 5s unbounded loop (removed) | bounded `MAX_RETRIES` | **honored** | **reserved concurrency = 4** (wired) | 1 HTTP / game message (`batch_size=1`) | yes (up to 4 workers + other families) | **yes** |
| Player props **controller** | SQS enqueue only | n/a | SQS send retries | n/a | unreserved | 0 BDL calls | overlapping schedules can duplicate messages | no BDL; still can multiply **work** |
| Vercel schedule refresh | `lib/balldontlie/refresh-schedule-from-bdl.ts` → `fetchBdlLive` | local retry/sleep | 5xx outer loop + shared 429 | **honored** | Vercel request concurrency | date-range pages | yes vs Lambdas | **yes** (same module; needs AWS creds + table when live) |
| Vercel lineups | `lib/balldontlie/lineups.ts` → `fetchBdlLive` | none | fail → `null` | **honored** | on-request | 1 / matchup | yes | **yes**; skip HTTP when freeze |
| Player name lookup | `lib/balldontlie/bdl-player-names-from-api.ts` → `fetchBdlLive` | none | catch → empty map | **honored** | on-request / research | 1 batch | yes | **yes** |
| Boxscore scraper | Basketball-Reference `fetch` | BBRef delay | BBRef 429 | n/a | n/a | n/a | n/a | **not BDL** |

**Bypasses (intentional, not live product traffic):**

- `lib/balldontlie/archive-client.ts` + `trial-limiter.ts` (~13s, concurrency 1) — GOAT-trial / historical acquisition
- `scripts/archive/*`, `scripts/seed-*-bdl.ts`, `scripts/seed-raw-balldontlie.ts` — operator crawls; keep local `BALLDONTLIE_REQUEST_DELAY_MS`

Shared SDK boundary: `lambda/shared/bdl-live-rate-limit.ts` re-exported as `lib/balldontlie/live-rate-limit.ts`, **copied** into each Lambda zip root (`source_dir` cannot see `lambda/shared`). Drift test enforces byte-identical copies.

---

## Existing Throttle Audit

13A blocker confirmed in code (now closed at the process boundary):

- Independent Lambdas used **in-process** sleeps (~200ms). Account-level stampede was possible.
- Props reserved concurrency lived only in `infra/variables.tf` (`default = 4`) and was **not** set on `aws_lambda_function.player_props_worker`.
- Props worker 429 handling could retry forever at 5s (removed; shared client bounds retries).
- Repo does **not** encode a certified live GOAT requests/minute number. Encoded numbers:
  - Trial archive: **5 req/min** (`BDL_TRIAL_MODE`, 12–13s) — **not** applied to live workers
  - Historical process default: **200ms** — process-local only, not an account quota

---

## Chosen Centralized Architecture

**Option A — DynamoDB optimistic-lock token bucket.**

Canonical module: `lambda/shared/bdl-live-rate-limit.ts` + `bdl-live-rate-limit-dynamo.ts`.

Flow: worker → `fetchBdlLive` → `acquireLiveBdlPermit` (conditional `PutItem`/`UpdateItem` on `pk=bdl, sk=token-bucket`) → HTTP → on 429 write `sk=cooldown` and sleep `Retry-After`.

Fail-closed: missing table, Dynamo errors, acquire timeout, and replay/offseason/dry-run **do not** call BDL.

No lease row that can deadlock: tokens are decremented on grant; crashed workers simply leave a consumed token that refills by elapsed time. Bucket + cooldown items carry `expires_at` TTL (default 120s, cooldown TTL ≥ Retry-After).

---

## Alternatives Rejected

| Option | Why not |
| --- | --- |
| Process-local mutex / sleep | 13A hole: Lambdas do not share memory |
| SQS serialization of all BDL work | Would redesign nightly/odds/injuries/props around one queue; large Terraform + worker rewrite |
| Apply trial 13s cadence to live | Historical crawl limiter; too slow for ~400 req/day product polls and not the live certified quota |
| Redis / ElastiCache | Extra always-on cost for ~400 req/day |
| Reserved concurrency on every BDL Lambda | Provider safety is the token bucket; extra reserved concurrency is for duplicate-work/cost, not required for 13B |

---

## Shared Client Integration

```ts
await fetchBdlLive(url, init, { worker: 'player-props-worker' })
```

Workers no longer implement token math, burst rules, or 429 Retry-After. Nightly still has a **batch** sleep (`BALLDONTLIE_REQUEST_DELAY_MS`) between game-id groups — not HTTP spacing; the limiter already spaces HTTP.

Replay/offseason/dry-run: `shouldSkipLiveBdlHttp` → `BdlRateLimitError` code `replay`. Defense-in-depth even if a worker forgets `SHOULD_CALL_LIVE_API`.

---

## Rate Configuration

Configurable; **not** a certified provider cap. Defaults are conservative vs independent 200ms sleeps, not vs the 5 req/min trial crawl.

| Terraform / env | Default | Notes |
| --- | --- | --- |
| `bdl_rate_limit_interval_ms` / `BDL_RATE_LIMIT_INTERVAL_MS` | `1000` | refill window |
| `bdl_rate_limit_max_requests` / `BDL_RATE_LIMIT_MAX_REQUESTS` | `1` | tokens per interval |
| `bdl_rate_limit_burst` / `BDL_RATE_LIMIT_BURST` | `1` | cap |
| `bdl_rate_limit_acquire_timeout_ms` / `BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS` | `20000` | fail closed |
| `BDL_RATE_LIMIT_TABLE` | `nba-bdl-rate-limit` | required for dynamodb backend |
| `BDL_RATE_LIMIT_BACKEND` | `dynamodb` on AWS Lambdas | `memory` in Vitest / when explicitly set |
| Interval floor | **200ms** | unless `BDL_RATE_LIMIT_ALLOW_FAST=1` (tests only) |

Do not set `BDL_RATE_LIMIT_ALLOW_FAST=1` in production. Operators may raise the interval (e.g. 12000ms) if a future canary shows 429s; do not loosen without evidence.

---

## Retry-After / 429 Behavior

1. Permit is acquired (counts as a provider attempt).
2. If status is **429**, parse `Retry-After` (delta-seconds or HTTP-date).
3. Write a **global cooldown** so other workers wait.
4. Sleep that duration (or exponential `BDL_RATE_LIMIT_RETRY_BASE_MS`, default 60s, if header missing).
5. Retry only while `attempt < MAX_RETRIES` (default 3). Then throw; **no** “call BDL anyway”.
6. **No immediate retry** of a 429.

---

## Lease / Coordination Semantics

Not a mutex lease. Token bucket:

- Conditional create: `attribute_not_exists(pk)`
- Conditional update: `version = :expected`
- `ConditionalCheckFailedException` → `conflict` → retry acquire (no extra HTTP)
- Other Dynamo errors → `unavailable` → fail closed
- Clock going **backwards** does not mint tokens (`elapsed = max(0, now - lastRefillMs)`)
- Residual: Lambdas with skewed clocks can refill slightly fast; burst remains 1

---

## Props Reserved Concurrency

| Item | Value |
| --- | --- |
| Variable | `player_props_worker_reserved_concurrency` |
| Default (unchanged) | **4** |
| Wired on | `aws_lambda_function.player_props_worker.reserved_concurrent_executions` |
| Runtime effect after apply | At most **4** worker invocations at once; SQS queues the rest |
| Mechanical test | `infra/__tests__/player-props-reserved-concurrency.test.ts` asserts the Lambda resource field, not just the variable |

Controller: **no** reserved concurrency, **no** Dynamo IAM, **no** BDL HTTP.

---

## SQS / Worker Interaction

| Setting | Value | Interaction with throttle |
| --- | --- | --- |
| Batch size | **1** | One BDL game HTTP per invocation |
| Worker timeout | default **600s** (example tfvars 300s) | acquire timeout 20s + bounded 429 waits fit |
| Visibility | `max(180, timeout+30)` | waiting for a permit should not expire the message |
| maxReceiveCount | **4** | then DLQ |
| DLQ | `nba-player-props-game-dlq` | unchanged |

If acquire times out (20s), the invocation fails and SQS retries. That is fail-closed, not a bypass. Queue redesign was **not** required.

Controller can still enqueue a full slate; reserved concurrency 4 + 1 rps global cap bounds **provider** traffic. Duplicate controller runs can still duplicate **messages** (cost/work). Recommend controller reserved concurrency **1** in a later schedule step if overlapping EventBridge is enabled — not done in 13B.

---

## Scheduler Overlap Analysis

Terraform **defaults** keep schedules off. Example tfvars still show odds/props schedules on while freeze flags skip work. After thaw, likely overlaps (unchanged from 13A):

| Pair | Why |
| --- | --- |
| Props 30-min window + odds morning crons | same ET late-morning band |
| Injuries 13/18/22 UTC + props | game-day |
| Nightly 08:00 UTC + injuries 13 UTC | usually not simultaneous; retry/timeout could extend nightly into later jobs |
| Vercel on-request lineups/schedule + any Lambda | user traffic |

13B makes overlapping **HTTP** safe at the account token bucket **before** 13C/13D stagger schedules. FIFO throttle can delay nightly behind near-tip props if they overlap — see Priority.

Schedules were **not** enabled.

---

## IAM Changes

Four new inline policies (`*-bdl-rate-limit`) on:

- `lambda_nightly_bdl_execution`
- `lambda_odds_execution`
- `lambda_injuries_execution`
- `lambda_player_props_execution` (worker only)

Actions: `dynamodb:GetItem`, `PutItem`, `UpdateItem` on **one** table ARN. No `Scan`, no `*`, no controller role, no boxscore role.

**Not in this Terraform:** Vercel/Next runtime IAM. Live Vercel BDL (`lineups`, schedule refresh, player names) fail closed without `BDL_RATE_LIMIT_TABLE` + AWS credentials. Wire that before thawing on-request BDL.

---

## Terraform Changes

New `infra/bdl-rate-limit.tf`: table `nba-bdl-rate-limit`, PAY_PER_REQUEST, keys `pk`/`sk`, TTL `expires_at`, env locals, IAM, outputs.

`infra/lambda.tf`: merge `local.bdl_rate_limit_env` into nightly/odds/injuries/props **worker**; force table/backend/worker name last; **wire reserved concurrency**.

Freeze defaults still `replay` / `1` / `1`. No schedule `count` / enable flags changed.

---

## Observability

Structured logs: `{ evt: 'bdl_throttle', worker, decision, wait_ms, acquire_retries, attempt, retry_after_ms, delay_ms }`.

Decisions include `granted`, `provider_429`, `replay_skip`, `config_error`, `coordination`, `timeout`. API keys and bodies are stripped.

No dashboard.

---

## Observability / Metrics recommendation (13G)

Props already has EMF `emitCoverageMetric`. Do **not** expand that into a platform metrics project here.

Later (13G), cheap CloudWatch metrics if still needed:

- permits granted
- throttle wait_ms
- BDL 429 count
- coordination errors

JSON logs are enough to grep a canary.

---

## Cost Estimate

DynamoDB on-demand, ~2 tiny items, ~400–800 reads/writes per game day:

- ≈ 25k WRU + 25k RRU / month → **well under $0.01/month**
- storage: negligible
- no extra Lambda, queue, or cache fleet

Justified vs ~400 anticipated BDL requests/day.

---

## Request-Budget Simulation

Fake-clock tests (no HTTP) against the memory store, policy **1 request / 1000ms / burst 1**:

| Scenario | Result |
| --- | --- |
| ~400 sequential game-day requests | 400 grants; min gap ≥ 1000ms; elapsed ≥ 399s |
| Nightly + injuries concurrent | shared bucket `version=2` |
| Odds + 4 props workers | 5 grants; gaps ≥ 1000ms |
| 429 then sibling worker | sibling waits `Retry-After` cooldown |
| Retry after network failure | second attempt consumes a **new** permit (no bypass) |

Heavy slate (15 games × props + odds pages + injuries) still serializes at 1 rps → tens of seconds, not a burst.

---

## Latency Impact

At default 1 rps:

| Job | Typical HTTP count | Extra wait vs old 200ms sleeps | Fits interval/timeout? |
| --- | --- | --- | --- |
| Props (10-game slate, 4 reserved workers) | ~10 | ~10s wall vs ~2s | **yes** vs 30-min poll |
| Odds (2–4 pages) | ~4 | ~4s | **yes** vs 30-min window |
| Injuries | ~1–3 | ~3s | **yes** vs multi-hour gaps |
| Nightly | dozens of pages | ~1s/page; 50 pages ≈ 50s | **yes** vs 300s timeout if pagination stays modest |

A props cycle at 1 rps is **much shorter** than the 30-minute poll. Do not loosen the limit to “go faster” without 429 evidence.

If nightly stats pagination were hundreds of pages, 1 rps could approach the 300s timeout — flag for 13C duration canary, not a 13B rate increase.

---

## Priority Policy

**Not implemented.** Single FIFO account bucket.

If nightly averages/stats overlap a near-tip props/odds wave, nightly can delay snapshots (or vice versa). 13C/13D should **stagger schedules** rather than build a priority scheduler. Separate P0 vs P1 buckets would be a later change if staggering is insufficient.

---

## Tests Added

| File | Covers |
| --- | --- |
| `lib/balldontlie/__tests__/live-rate-limit.test.ts` | replay skip, config fail-closed, concurrent acquire, crash recovery, timeout, 429 Retry-After, overlap sim, 400/day sim |
| `lib/balldontlie/__tests__/live-rate-limit-dynamo.test.ts` | conditional-write race, conflict retry, Dynamo down → fail closed |
| `lib/balldontlie/__tests__/bdl-live-rate-limit-copy-drift.test.ts` | Lambda copies == shared; archive client not wired |
| `infra/__tests__/player-props-reserved-concurrency.test.ts` | reserved concurrency **on the Lambda resource**; SQS batch/visibility; IAM not on controller; freeze defaults |
| `lib/runtime/__tests__/fail-closed-ingestion-sources.test.ts` | live Lambdas import `fetchBdlLive` |
| `lib/balldontlie/__tests__/bdl-player-names-from-api.test.ts` | freeze does not call fetch |

No real BDL network.

---

## Test Results

```
vitest: live-rate-limit, dynamo, copy-drift, player-names, trial-limiter,
        reserved-concurrency, fail-closed, ingestion-mode, details-final-mode,
        injuries ingest-plan, matchup-analysis-final
→ 9 files / 60 tests (core 13B set) + 2 files / 11 tests (regressions) passed
```

Trial limiter behavior unchanged (archive path). Final-mode details still do not call live BDL for completed games.

---

## Terraform Validation

| Command | Result |
| --- | --- |
| `terraform -chdir=infra fmt` | ran (Windows `fmt -check -diff` needs `diff` on PATH; not used as a gate) |
| `terraform -chdir=infra init -backend=false` | success (local providers) |
| `terraform -chdir=infra validate` | **Success! The configuration is valid.** |
| `terraform plan` | **not run** (would use AWS + zip Lambda source_dirs) |
| `terraform apply` | **not run** |

---

## Files Changed

- `lambda/shared/bdl-live-rate-limit.ts`
- `lambda/shared/bdl-live-rate-limit-dynamo.ts`
- copies in `lambda/nightly-bdl-updater/`, `lambda/odds-pre-game-snapshot/`, `lambda/injuries-snapshot/`, `lambda/player-props-snapshot/src/`
- `lib/balldontlie/live-rate-limit.ts` (re-export)
- worker integrations: nightly, odds, injuries, props `fetch.ts`, `lineups.ts`, `refresh-schedule-from-bdl.ts`, `bdl-player-names-from-api.ts`
- `infra/bdl-rate-limit.tf`, `infra/lambda.tf`, `infra/terraform.tfvars.example`
- `.env.example`
- `package.json` / `package-lock.json` (`@aws-sdk/client-dynamodb`)
- four Lambda `package.json` files
- tests listed above
- this report + JSON + learning log

---

## Remaining Risks

1. **Not applied.** Production AWS still has the unwired limiter and unwired reserved concurrency until a later apply/deploy.
2. **Vercel live BDL** needs Dynamo table name + AWS credentials; otherwise fail-closed (correct) and lineups/schedule refresh stay empty.
3. **1 rps is not a certified GOAT quota.** Raise interval if 429s appear; do not lower it without evidence.
4. **Lambda zips** must include `@aws-sdk/client-dynamodb` (`npm install` in each BDL Lambda dir before package).
5. **Copy drift** if shared files are edited without recopy; CI test will fail.
6. **Controller overlap** can duplicate SQS work after thaw; provider rate still capped.
7. **Clock skew** across Lambdas can slightly over-refill; burst=1 limits damage.
8. Historical scripts remain independently throttled — do not point them at the live Dynamo bucket unless an operator wants that.

---

## Recommendation for Step 13C

**Schedule / status canary only after:**

1. Review + apply Terraform (table, IAM, env, reserved concurrency) **without** flipping freeze flags or enabling new schedules.
2. Deploy the four BDL Lambda packages that include the limiter + Dynamo SDK.
3. Confirm Vercel will fail closed (freeze still on) and plan AWS creds before any on-request live BDL.
4. Then 13C: 2026 schedule/status canary with freeze still in place until explicitly thawed.

Do **not** start 13C from this step. Do **not** flip `PINNED_ANALYTICS_SEASON`. Do **not** enable Market Movement live snapshots.

---

## Verification Checklist

1. Confirm freeze is still `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1` in the runtime you care about.
2. Read `infra/lambda.tf` and confirm `reserved_concurrent_executions = var.player_props_worker_reserved_concurrency` on `player_props_worker`.
3. Run `npx vitest run lib/balldontlie/__tests__/live-rate-limit.test.ts infra/__tests__/player-props-reserved-concurrency.test.ts`.
4. Run `terraform -chdir=infra validate` (no apply).
5. Confirm `lib/balldontlie/archive-client.ts` still does not import `fetchBdlLive`.
6. Confirm no EventBridge `enable_schedule` defaults were flipped to `true` in `infra/variables.tf`.
7. Do not call BALLDONTLIE and do not apply Terraform from this step.

---

## Step Verdict

`GREEN — centralized BDL rate limiting is implementation-ready for activation canary`
