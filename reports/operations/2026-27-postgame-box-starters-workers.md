# 2026–27 Postgame Box + Starters Workers — Step 13F.3

**Step verdict:** `YELLOW — workers are implemented but provider/schema issue needs review`

**Date:** 2026-09-10  
**Depends on:** 13F.2 GREEN (state / scanner / queue foundation)  
**Mode:** fixture/unit implementation only. No provider canary. No deploy. No 13F.4.

`production postgame_game_stages migration = NOT_APPLIED`

---

## Safety / Scope

Confirmed before and after this step:

| Gate | Result |
| --- | --- |
| `live_ingestion_enabled` | **false** (`infra/terraform.tfvars`) |
| Ingestion / postgame schedules | remain DISABLED via `ingestion_schedule_state` |
| SQS consumer | **NOT_ACTIVE** (ESM `enabled = var.live_ingestion_enabled`) |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| `PINNED_ANALYTICS_SEASON` | **2025** (unchanged) |
| GOAT subscription | inactive (`BDL_GOAT_SUBSCRIPTION` not enabled) |
| BDL HTTP this step | **0** |
| S3 production writes | **0** |
| 2026 serving writes | **0** |
| Terraform apply | **not run** |
| Lambda deploy | **not run** |

Allowed work: implemented-stage gate, atomic claim, box + starters handlers, freeze-closed Lambda/Terraform **code**, fixtures/tests, this report.

Not done: live BDL, GOAT call, live S3, live Postgres serving writes, Terraform apply, Lambda deploy, event-source activation, schedule thaw, Advanced / Plays / game_flow workers, Role Profile, Market Movement, product FK migration, canonical-ID URL migration, possession / WOWY.

13F.1 / 13F.2 architecture was not redesigned.

---

## Worker Architecture

One compact dispatcher, not five Lambdas:

```text
SQS (v=1, gameId, season, stage, attempt, enqueuedAt)
  → parse/validate
  → freeze gate
  → implemented-stage gate
  → subscription gate
  → QUEUED → RUNNING claim
  → dispatch
       ├── box
       └── starters
```

Code:

- Domain worker: `lib/postgame/worker.ts` (`handlePostgameMessage`)
- Box quality: `lib/postgame/box-stage.ts` + `lib/postgame/box-transform.ts`
- Starters quality: `lib/postgame/starters-stage.ts` (reuses `extractStarterCandidatesFromArchive` / `certifyStarterGame`)
- Providers (future runtime, unused in tests): `lib/postgame/box-provider.ts`, `lib/postgame/starters-provider.ts`
- AWS shell: `lambda/postgame-stage-worker/index.ts` (freeze-first, **not bundled** with `@/lib`)

Provider-specific HTTP stays outside the generic SQS handler. Tests inject `fetchBoxStats` / `fetchLineups`.

---

## Implemented-Stage Gate

| Stage | Capability |
| --- | --- |
| `box` | **IMPLEMENTED** |
| `starters` | **IMPLEMENTED** |
| `advanced` | **NOT_IMPLEMENTED** |
| `plays` | **NOT_IMPLEMENTED** |
| `game_flow` | **NOT_IMPLEMENTED** |

`POSTGAME_IMPLEMENTED_STAGES` in `lib/postgame/capability.ts`.

Scanner `shouldEnqueue` returns false unless the stage is implemented. GOAT_ACTIVE does **not** queue Advanced / Plays / game_flow. Unimplemented messages in the worker skip without provider work and without writing FAILED.

Known orchestration rows may still be planned (WAITING / BLOCKED from subscription evidence) so `/ops` can show five stages. That is not a fake provider FAILED.

---

## Queue Claim / Idempotency

Claim is `QUEUED → RUNNING` only (`lib/postgame/claim.ts`).

- `attempt_count` increments **only** on successful claim
- Sets `started_at` and `last_attempt_at`
- Duplicate SQS delivery: claim fails, ack, **no** second provider call, **no** extra attempt
- Scanner / freeze / hold do not increment attempts
- Box retry upserts PGL on `(game_id, player_id)` — same game does not duplicate rows

Malformed / unknown version: `ack: false` (normal SQS → DLQ). No provider.

Unsupported known stage (Advanced / Plays / game_flow): ack, skip, not FAILED.

---

## Freeze Protection

Two layers:

1. **Infra:** `aws_lambda_event_source_mapping.postgame_stage_worker_queue.enabled = var.live_ingestion_enabled` (currently false). Frozen apply cannot start consumption.
2. **Application:** `handlePostgameMessage` returns before claim when `!liveIngestionEnabled || freezeSkipsMutations`. Env helper `postgameWorkerConfigFromEnv` treats `DATA_MODE=replay` / `OFFSEASON_MODE=1` / `CRON_DRY_RUN=1` as freeze even if `LIVE_INGESTION_ENABLED=1`.

Frozen result: ack, skip, stage stays QUEUED, attempts unchanged, spies prove no provider / S3 / serving write. Not FAILED.

CODE_ONLY Lambda adapter: freeze → drain/ack; accidental thaw without bundled worker → `batchItemFailures` (DLQ), never BDL.

---

## Box Provider Adapter

Certified owner remains **BDL `/v1/stats` → `analytics.player_game_logs`**. BBRef is not on this path.

Future runtime uses `fetchBdlLive` with worker name `postgame-box`. No raw `fetch`, no second limiter.

Granularity: `GET https://api.balldontlie.io/v1/stats?game_ids[]=<id>&per_page=100` plus cursor, max 8 pages — same shape as nightly. Game filtering is the current certified client convention, not an invented parameter.

`POSTGAME_BOX_REQUIRES_GOAT` defaults **false** (ALL-STAR vs GOAT still **UNCONFIRMED**). If later proven GOAT-only, set the flag; 401/403 already maps to `BLOCKED / SUBSCRIPTION_BLOCKED`.

---

## Box Identity Resolution

```text
BDL player id → canonical resolver batch (BOX_SCORE) → requireAnalyticsPlayerId
```

- `serving` → transform/write
- `not_serving_yet` / `fail_closed` → skip/quarantine count
- Does **not** create `analytics.players`
- Does **not** fabricate IDs or name-match

Owner of serving-projection creation remains `nightly-bdl-updater / transform-raw-to-analytics upsertAnalyticsPlayer` (`BDL_SERVING_PROJECTION_OWNER`). The generic Box worker does **not** invoke that helper (would broaden ownership). Dependency: a BDL box row can be serving-written only if the nightly-owned projection already exists. PGL FK to `analytics.players` makes this mandatory.

---

## Box Quality / Readiness Gate

| Situation | Stage |
| --- | --- |
| Game not Final / scores unproven | `WAITING / PROVIDER_NOT_READY` |
| HTTP 401/403 | `BLOCKED / SUBSCRIPTION_BLOCKED` |
| 429 / 5xx / timeout | `WAITING` + matching 13G reason |
| HTTP 200, zero rows, early attempts | `WAITING / PROVIDER_NOT_READY` |
| HTTP 200, zero rows, attempt ≥ 3 | `WAITING / VOLUME_UNEXPECTED_ZERO` (not READY) |
| Malformed payload | `FAILED / MALFORMED_SOURCE` |
| Both teams have serving rows **and** `identitySkipped === 0` | `READY` |

HTTP 200 alone is not READY.

**Identity incompleteness decision:** valid serving rows may be upserted; skipped identities are counted (`identity_skipped`, `IDENTITY_NOT_SERVING` / `IDENTITY_CONFLICT`); stage does **not** become READY if any source player row was dropped. No fake players.

`MINIMUM_READY` remains Final + official scores + Box READY. Starters cannot block it and cannot hide a usable Box Final.

---

## Box Serving Writes

Idempotent UPSERT on existing PGL grain `(game_id, player_id)` (`lib/postgame/writes.ts`, same conflict target as nightly). Explicit `season` on the row. Worker refuses protected seasons `2023/2024/2025` and any season ≠ `POSTGAME_TARGET_SEASON` (`2026`) before provider/write.

`analytics.team_game_stats` stays on the nightly catch-up path. Explorer box is PGL.

No production writes in this step.

---

## Certified Starters Provider Adapter

Source: actual postgame BDL lineups (`starter: true`), not projected/pregame/UI guesses.

Future runtime: `fetchBdlLive` `GET /nba/v1/lineups?game_ids[]=` (one request per game), worker `postgame-starters`.

`goatRequired: true` preserved. GOAT inactive → worker `BLOCKED / SUBSCRIPTION_BLOCKED` **before** provider. Fixture-tested only.

`extractStarterCandidatesFromArchive(gameId, body, season)` now accepts an explicit season so 2026 workers can pass `'2026'` without flipping `GAME_STARTERS_SEASON` (`'2025'`) or the product pin.

---

## Starter Certification

Exact **5 home + 5 away**. Never persist/display 4+5, 5+4, duplicates, or name-substituted identities.

| Situation | Stage |
| --- | --- |
| Empty / absent lineup shortly after Final | `WAITING / PROVIDER_NOT_READY` |
| 401/403 | `BLOCKED / SUBSCRIPTION_BLOCKED` |
| Valid 5+5 + all serving | `READY` + writes |
| Incomplete / duplicate | `WAITING / QUALITY_FAILED` until `maxAttempts`, then `EXPECTED_ABSENCE` |
| Identity unsafe (`not_serving_yet`, unresolved, conflict) | `EXPECTED_ABSENCE` immediately, **writes = 0** (no 4-player result) |

First empty attempt is **not** `EXPECTED_ABSENCE`. Terminal absence uses attempt cap (~36h reconciliation via scanner `next_attempt_at`, maxAttempts 8).

---

## Starter Identity Handling

Canonical resolver / `selectArchiveRowsForServing(..., 'LINEUP')` / `starterGameIdentityReason` / `failStarterCertificationIfIdentityUnsafe`.

No fake IDs, no name matching, no Class C promotion. One unsafe starter fails the whole game’s Starting Five.

---

## Retry / Blocking Semantics

Shared schedule (`lib/postgame/retry.ts`): ~15m, ~1h, ~12h overnight, cap 36h from first start. No sleep-in-Lambda for publication delay. Scanner honors `next_attempt_at`.

| Result | Transition | SQS |
| --- | --- | --- |
| certified writes done | RUNNING → READY | ack |
| provider latency / 429 / 5xx / timeout / not ready | RUNNING → WAITING + `next_attempt_at` | ack (scanner retries) |
| GOAT / stats subscription | RUNNING → BLOCKED / `SUBSCRIPTION_BLOCKED` | ack; do not hammer |
| identity / certified absence after window | RUNNING → EXPECTED_ABSENCE | ack |
| malformed / quality crash | RUNNING → FAILED | ack; retry only if reason is retryable |

429 uses centralized limiter; leftover 429 → `PROVIDER_429` + later retry. No worker-local retry loop.

---

## SQS Acknowledgment Strategy

Ack (delete) on READY / WAITING / BLOCKED / EXPECTED_ABSENCE / freeze-skip / unimplemented-skip / duplicate-claim.

Do **not** use SQS redelivery for `PROVIDER_NOT_READY`.

`ack: false` only for unparseable / unknown-version messages → DLQ after `maxReceiveCount = 4`.

`batch_size = 1`.

---

## Worker Terraform / IAM

`infra/postgame-worker.tf` — **CODE_ONLY, NOT_APPLIED**.

- Lambda `postgame-stage-worker`
- IAM: logs + SQS Receive/Delete/ChangeVisibility/GetQueueAttributes on the postgame queue only
- DynamoDB rate-limit policy (existing table)
- **No `s3:*`**. No S3 IAM yet (no bucket resource in this stack). Future lineup archive should scope `raw/source=balldontlie/league=nba/season=2026/entity=lineups/`
- **Reserved concurrency unset** (account quota 10; unreserved floor previously blocked props reserved concurrency). Limiter remains the BDL brake. Do not request quota in this step.
- No EventBridge / Scheduler for postgame

Timeout 120s (above one 13s limiter wait + fetch, not publication delay).

---

## Event Source Freeze Safety

```text
live_ingestion_enabled=false
        ↓
SQS event source mapping DISABLED
        ↓
handler freeze gate (if somehow invoked)
```

A normal frozen apply must not start consumption.

---

## 2026 Stage Guards

- Worker target season: `POSTGAME_TARGET_SEASON=2026`
- Protected seasons: 2023, 2024, 2025 fail closed
- Product pin stays `PINNED_ANALYTICS_SEASON=2025`
- `GAME_STARTERS_SEASON` stays `'2025'` (historical materializer)
- Starters extract accepts an explicit `'2026'` argument only on the postgame path
- Box serving table already has a `season` column; no global 2025 search-replace
- `POSTGAME_TARGET_SEASON` and the product pin are different concerns

---

## Observability

Structured events (no payloads / keys):

- `postgame_stage_claimed`
- `postgame_stage_ready`
- `postgame_stage_waiting`
- `postgame_stage_blocked`
- `postgame_stage_failed`
- `postgame_stage_skipped`

Fields: `game_id`, `season`, `stage`, `attempt`, `duration_ms`, input/output counts, `identity_skipped`, `reason_code`.

Stage rows (`last_attempt_at`, `next_attempt_at`) are additive SQL **not applied**. `/ops` Postgame card unchanged; it will reflect rows when the migration is applied later. No `/ops` redesign.

---

## Historical Regression

Unchanged:

- 2025 Box / Starting Five transforms and schema
- Historical Explorer availability flags
- No new public routes
- No historical rewrite path in the worker (2025 messages rejected)

`GAME_STARTERS_SEASON === '2025'` and `PINNED_ANALYTICS_SEASON === '2025'` asserted in tests.

---

## Tests Added

- `lib/postgame/__tests__/worker.test.ts` — box READY, not-ready, unexpected zero, mixed identity, duplicate claim, starters 5+5 / 4+5 / duplicate / not_serving_yet / conflict / GOAT block / empty lineup, mixed-stage isolation, multi-game isolation, freeze spies, historical reject, unimplemented skip, bad version
- `lib/postgame/__tests__/adapters.test.ts` — `fetchBdlLive` + `game_ids[]`, no Advanced worker, pin vs target season, write SQL grain
- `lib/postgame/__tests__/retry.test.ts`
- `lib/postgame/__tests__/lambda-adapter.test.ts`
- scanner: unimplemented stages not queued even with GOAT; freeze hold is box+starters only
- schema: 13F.3 additive columns, do not apply
- archive extract: explicit 2026 season without flipping 2025 constant
- `infra/__tests__/postgame-queue.test.ts` — worker ESM fail-closed, batch_size 1, no reserved concurrency, no `s3:*`

---

## Test Results

```bash
npx vitest run lib/postgame lib/ops infra/__tests__/postgame-queue.test.ts \
  lib/archive/__tests__/game-starters-from-lineups.test.ts \
  lib/betting/__tests__/historical-final.test.ts \
  lib/betting/__tests__/historical-final-seasons.test.ts \
  lib/betting/__tests__/historical-advanced.test.ts \
  lib/betting/__tests__/details-final-mode.test.ts \
  lib/__tests__/season.test.ts
```

**17 files, 138 tests, passed.** Additional Historical Explorer / identity files: 34 passed.

No BDL HTTP. `fetch` stubbed in worker tests (`network forbidden in 13F.3 tests`).

---

## Provider Request Budget

From code (no live measurement):

| Stage | Requests |
| --- | --- |
| Box | typically **1** `/v1/stats` page per game (`game_ids[]`, `per_page=100`; ~25 players). Hard cap **8** cursor pages. |
| Starters | **1** `/nba/v1/lineups?game_ids[]=` GET |

Under the **13,000 ms** global limiter (burst 1): one stage invocation ≈ one permit ≈ **~13s wait + HTTP**. Box then starters as separate messages ≈ **~26s** of limiter wait per game, plus handler CPU. Worker timeout 120s. No in-invocation publication polling.

---

## Deployment / Migration State

| Item | State |
| --- | --- |
| `MIGRATION_postgame_game_stages.sql` | **NOT_APPLIED** |
| `MIGRATION_postgame_game_stages_13f3.sql` (`last_attempt_at`, `next_attempt_at`) | **NOT_APPLIED** |
| Terraform | **NOT_APPLIED** |
| Lambda | **NOT_DEPLOYED** (CODE_ONLY zip/handler; `@/lib` not bundled) |
| SQS consumer | **NOT_ACTIVE** |
| BDL HTTP | **0** |
| S3 writes | **0** |
| 2026 serving writes | **0** |

---

## Readiness Matrix

| Component | State |
| --- | --- |
| Box worker code | **READY** (fixture-certified) |
| Box provider entitlement | **UNCONFIRMED** (`/v1/stats` ALL-STAR vs GOAT) |
| Starters worker code | **READY** (fixture-certified) |
| Starters subscription | **BLOCKED_BY_SUBSCRIPTION** |
| Worker Lambda infra | **CODE_ONLY** |
| Event source mapping | **DISABLED / CODE_ONLY** |
| Advanced | **NOT_IMPLEMENTED** |
| Plays | **NOT_IMPLEMENTED** |
| game_flow | **NOT_IMPLEMENTED** |
| Production execution | **FROZEN** |

---

## Remaining Risks / Entitlement Questions

1. **`/v1/stats` tier still unknown.** Code supports `POSTGAME_BOX_REQUIRES_GOAT`. Do not invent ALL-STAR vs GOAT. Live certification is a canary prerequisite, not a reason to skip this code step.
2. **Stage table not in production.** Workers are written against the committed schema; runtime claim/complete needs the SQL applied in a later authorized step.
3. **Lambda is a freeze shell.** Production dispatch of `handlePostgameMessage` still needs a bundling step (copy or compile `@/lib` + Postgres/S3 ports). Accidental ESM enable without that bundle fail-closes.
4. **Serving projection dependency.** Box cannot create `analytics.players`. Nightly-owned upsert must already have attested BDL ids or identity skips will keep Box from READY.
5. **Lineup S3 archive** future key: `raw/source=balldontlie/league=nba/season=2026/entity=lineups/game_id=<id>.json` (generalized 2025 convention). Mocked only; no IAM bucket in this stack yet.
6. **GOAT still inactive.** Do not run a Starters canary.

---

## Recommended Next Step

**Option A — `13F.3A — controlled Box-only provider canary`**

Box entitlement cannot be confirmed from fixtures. A freeze-gated, single-game `/v1/stats` canary (no GOAT, no starters, no Advanced) is the lowest-risk way to learn whether Box can run on the current subscription before any worker thaw.

Do **not** recommend a live Starters canary (GOAT inactive).  
Do **not** start 13F.4 (Advanced) while `/v1/stats` is unconfirmed.  
**This step does not begin 13F.3A.**

---

## Verification Checklist

1. Confirm `infra/terraform.tfvars` still has `live_ingestion_enabled = false` and Lambda env `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`.
2. Confirm production SQL was **not** applied (`analytics.postgame_game_stages` still absent or unchanged).
3. Confirm no Terraform apply / Lambda deploy / ESM enable ran.
4. Re-run `npx vitest run lib/postgame infra/__tests__/postgame-queue.test.ts` if you pull these files onto another machine.
5. Confirm `PINNED_ANALYTICS_SEASON` is still `'2025'` in `lib/season.ts`.
6. Do not set `BDL_GOAT_SUBSCRIPTION=1` or call `/nba/v1/lineups`.
7. Do not start 13F.3A or 13F.4 until this report is accepted.

---

## What this step did **not** do

- live BDL call
- GOAT call
- live S3 write
- live Postgres serving write
- Terraform apply
- Lambda deploy
- event-source activation
- recurring schedule activation
- Advanced / Plays / game_flow workers
- Role job
- Market Movement
- product FK migration
- canonical-ID URL migration
- possession / WOWY

---

## Step Verdict

`YELLOW — workers are implemented but provider/schema issue needs review`

Box and certified Starting Five **code** is fixture-ready and freeze-gated, but `/v1/stats` entitlement is unconfirmed, the stage table is not applied, Terraform/Lambda are CODE_ONLY, and production execution stays frozen.

**STOP after Step 13F.3.**
