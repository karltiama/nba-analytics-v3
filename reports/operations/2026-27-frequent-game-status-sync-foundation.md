# 2026–27 Frequent Game Status Sync Foundation — Step 13C.2

**Step verdict:** `GREEN — frequent game status sync is ready for controlled activation testing`

**Date:** 2026-09-10  
**Depends on:** 13C.1 Final-preserve + `/v1/games` canary; 13G.2 missed-run metadata; 13F.1 orchestration gap (nightly-only cannot meet 10–20 min Final detection)

13F provider work remains parked. This slice did **not** enable a schedule, call `/v1/stats`, or run a live `/v1/games` canary.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| `/v1/stats`, lineups, Advanced, Plays, injuries, odds, props, GOAT | **not called** |
| Postgame scanner / SQS / worker | **not invoked** |
| S3 / PGL / product FK / season pin | **unchanged** (`PINNED_ANALYTICS_SEASON=2025`) |
| Terraform apply / schedule activation | **none** |
| Live `/v1/games` HTTP | **none** (fixtures + mocks only) |
| `live_ingestion_enabled` | **false** |
| Lambda freeze env | `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1` |

Preferred path used: **fixtures + mocks + local dry-run**. Previous 13C.1 canary already certified `/v1/games` access.

---

## Existing Game-Sync Audit

| Path | Endpoint | Fields | Final-preserve | Raw writes | Stats | Pagination | Season | Reuse for frequent? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nightly BDL Lambda | `GET /v1/games?start_date&end_date&seasons[]` | raw.games + analytics.games + later `/v1/stats` | **yes** (`final-preserve-guard`) | yes | **yes (out of scope)** | cursor/100 | pin / env, fallback 2025 | Query shape **yes**; job **no** (too heavy, 08:00 UTC) |
| `refresh-schedule-from-bdl` | same `/v1/games` window | raw + analytics | **yes** | yes | no | cursor/100 | `resolveIngestionSeasonStartYear` → pin | Same SQL invariant; still a date-range helper, not a 15m job |
| `transform-raw-to-analytics` | none (raw → analytics) | analytics.games overwrite | **was missing** | n/a | n/a | n/a | raw season | **not** the live route. Guard added this step so it cannot clobber Finals if run |
| Betting on-request refresh | same helper | same | yes | yes | no | cursor/100 | pin | Gated by freeze; not a scheduler |
| EventBridge nightly | 08:00 UTC | full nightly pipeline | yes | yes | yes | — | pin | **Unsuitable** as frequent trigger |

**Do not** put `transform-raw-to-analytics` (pre-guard) on the live frequent path. Frequent sync uses the shared `shouldPreserveCertifiedFinal` planner + the same SQL CASE fragments.

---

## New Status-Sync Ownership

`lib/games/status-sync.ts` owns **only**:

- scoped `/v1/games` fetch (via injected adapter; production must use `fetchBdlLive`)
- status + tip UTC + scoreboard scores on `analytics.games`
- certified Final-preserve
- insert of newly published **target-season** games
- structured transitions (`became_final`) and run accounting

It does **not** fetch player/team box stats, lineups, market data, or enqueue postgame work.

---

## Provider Query Scope

Certified form already used by nightly + refresh:

`GET https://api.balldontlie.io/v1/games?seasons[]=2026&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&per_page=100`

Optional `cursor` for extra pages. **Not** `/nba/v1/games`. Frequent mode **refuses** to omit the date window. Full-season (`seasons[]` only) is explicit `mode: 'full_season'` and is not the default.

---

## Time Window / Date Semantics

Frequent window: **ET yesterday → ET tomorrow** (lookback 1 / lookahead 1) using America/New_York calendar dates.

Covers today’s slate, late starts, OT past midnight UTC, recent Finals, and near-future/rescheduled tips. Cap **3 pages** so a bug cannot scan 13 full-season pages.

---

## Status Normalization

Reuse `normalizeGameStatus` / `isFinalStatus` (no second table):

| Provider | Canonical |
| --- | --- |
| `Final` | Final |
| `Scheduled` | Scheduled |
| ISO / `7:00 pm ET` / clock strings | Scheduled |
| `In Progress`, `InProgress`, `in_progress`, `Live`, `Halftime` | In Progress |
| `Postponed` | Postponed |
| `Canceled` / `Cancelled` | Canceled |

Stored `analytics.games.status` remains the provider string (same as nightly) so Final-preserve SQL `= 'final'` still matches.

---

## Final-Preserve Invariant

13C.1 semantics, one planner: `shouldPreserveCertifiedFinal`.

- Scheduled → In Progress / Final allowed
- In Progress → Final allowed
- Final → Final may update official scores/tip
- Final → Scheduled / In Progress / tipoff ISO **rejected** (local Final kept)

Shared SQL: `ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL` in `lib/betting/final-preserve.ts`. Nightly + refresh keep their existing markers; transform now uses the same CASE.

---

## Score / Tip-Time Updates

From `/v1/games` only: `home_team_score` / `visitor_team_score` → `home_score` / `away_score`; `datetime` → UTC `start_time` (`canonicalStartTimeUtc`). Venue left null. In Progress scores expected to move. Final scores follow official-source corrections when incoming is still Final. No PGL/Advanced overwrite.

---

## Newly Published Games

If the scoped query returns a real 2026 game with both team ids and no local row → **insert**. The unpublished ~30 RS games are **not** fabricated. 2025 (and 2023/24) rows in the store are rejected for mutation.

---

## Season Safety

- Target season: `STATUS_SYNC_TARGET_SEASON` default **2026** (independent of product pin)
- Product pin remains **2025**
- Incoming or local `2023`/`2024`/`2025` → reject
- Team-id mismatch → reject (no silent overwrite)

---

## Final Transition Contract

When prior normalized status is not Final and the applied status is Final:

```text
{ game_id, previous_status, new_status, became_final: true }
```

Counted as `becameFinal`. Event `game_became_final`. **No SQS, no `postgame_game_stages` insert.** 13F scanner can later discover Finals.

---

## Rate-Limit / Request Budget

| | Full-season canary (13C.1) | Frequent poll |
| --- | --- | --- |
| Query | `seasons[]=2026` all pages | 3-day ET window |
| Requests / run | ~13 pages / **15 requests** | **1** typical (cap 3) |
| Cadence | n/a | 15 min → **4 polls/hour** |
| Typical game night (~8h) | — | ~32 requests |
| Limiter | 13s/token | at most one acquire + one GET per poll |
| Retries | nightly 60s exponential | **none**; next poll retries |

Dramatically smaller. No live benchmarking. 401/403/429/5xx/timeout: one attempt, record, stop.

---

## Lambda Architecture

Domain is testable in `lib/games`.  
`lambda/game-status-sync/index.ts` is a **CODE_ONLY freeze shell**: frozen → skip (0 BDL, 0 writes); thawed without bundle → `CODE_ONLY_NOT_BUNDLED` (still 0 BDL/DB). Packaging the domain into the zip is **13C.3**.

---

## Scheduler / Terraform

`infra/game-status-sync.tf` (CODE_ONLY, **not applied**):

- Lambda + logs + Dynamo limiter IAM (no S3, no SQS)
- Scheduler `rate(15 minutes)` only if `game_status_sync_enable_schedule=true` (default **false**)
- `state = local.ingestion_schedule_state` → **DISABLED** while `live_ingestion_enabled=false`
- Freeze env merge; `STATUS_SYNC_TARGET_SEASON=2026`; acquire timeout 20s

---

## Freeze Protection

Infrastructure: schedule not created by default; if created, DISABLED.  
Application: `LIVE_INGESTION_ENABLED` **and** `shouldSkipLiveMutations` **and** `shouldSkipLiveBdlHttp`.  
Tests: frozen handler/domain → fetch not called, store not written, `skipped`.

---

## IAM

CloudWatch logs + existing `local.bdl_rate_limit_iam`. No S3. No SQS. No postgame.

---

## Run Accounting / Observability

Counts: fetched, inserted, updated, unchanged, rejected, statusChanges, becameFinal, finalPreserved, providerErrors, durationMs.  
Events: `game_status_sync_started|changed|became_final|final_preserved|completed|failed`. No secrets, no payloads.

Ops family `game_status_sync`: FROZEN default, cadence 15m + 15m grace, freshness = 2026 `analytics.games.updated_at` + Lambda last invocation. Frozen → no MISSED.

---

## Ops Integration

Catalog + `INGESTION_CADENCE.game_status_sync` + AWS resource name `game-status-sync` (optional/NOT_DEPLOYED). `/ops` not redesigned.

---

## Tests Added

Normalization (existing) + transitions, idempotency, season reject, new 2026 insert, frequent-vs-full-season query, freeze (domain + Lambda), became_final event without SQS, 401/403/429/5xx/timeout no retry, Terraform fail-closed, transform Final-preserve grep, Historical Explorer Final header, postgame scanner (unchanged assumptions).

---

## Test Results

`npx vitest run` on status-sync, final-preserve, normalize-game-status, historical-final, ops families, fail-closed sources, game-status-sync terraform, ingestion-schedule fail-closed, postgame scanner:

**12 files, 122 tests, passed.**

CLI: `npx tsx scripts/ops/game-status-sync.ts --season=2026 --dry-run` → `frozen: true`, `wroteDb: false`, `bdlHttp: 0`, `became_final: 1`, `productPin: 2025`.

---

## Historical Regression

Final-preserve, Historical Explorer Final header, and postgame scanner tests passed. Status sync does not change historical product semantics. Pin remains 2025.

---

## Terraform Validation

- Infra unit tests passed (schedule DISABLED pattern, no S3/SQS, freeze defaults).
- `terraform fmt` applied to `infra/game-status-sync.tf`.
- `terraform validate` / frozen plan **not run** (no local `.terraform` init; would risk apply-adjacent workflow). **Do not apply.**

---

## Readiness Matrix

| Component | State |
| --- | --- |
| Status-sync domain | READY |
| Scoped `/v1/games` query | READY |
| Final-preserve | READY |
| Final transition output | READY |
| Lambda code | CODE_ONLY |
| Scheduler Terraform | CODE_ONLY |
| Ops cadence/missed-run metadata | READY |
| Provider entitlement | AVAILABLE |
| Production execution | FROZEN |

---

## Files Changed

- `lib/games/status-sync.ts`, `status-sync-query.ts`, `canonical-start-time.ts`, tests, Lambda freeze tests
- `lib/betting/final-preserve.ts` (shared analytics upsert SQL)
- `scripts/transform-raw-to-analytics.ts` (Final-preserve CASE)
- `lambda/game-status-sync/*`
- `infra/game-status-sync.tf`, `infra/__tests__/game-status-sync.test.ts`, `infra/terraform.tfvars.example`
- `lib/ops/ingestion-observability.ts`, `ingestion-cadence.ts`, `aws-ingestion-resources.ts`, `platform-health.ts`
- `scripts/ops/game-status-sync.ts`
- `.env.example`, `package.json`

---

## Remaining Risks

- Lambda zip is a freeze shell until 13C.3 bundles `lib/games`.
- Serving writes still mocked; first live write needs a controlled canary **after** packaging.
- Team ids use provider `home_team.id` (same fallback as nightly), not a new mapping table.
- `raw.games` is **not** updated by frequent sync (nightly remains the raw backfill).
- 3-day window will not see a game published only on a far-future date until nightly or the window reaches it.

---

## Recommended Next Step

**13C.3 — activation-readiness closure for frequent status sync** (package/bundle Lambda, still frozen).

`/v1/games?start_date&end_date&seasons[]` is already certified; do **not** run 13C.2A unless a new request-shape question appears. Do **not** return to 13F Box/Starters/Advanced/Plays while subscription is blocked. Do **not** enable the schedule in 13C.3 automatically.

---

## Verification Checklist

1. Confirm `live_ingestion_enabled=false` and no EventBridge/Scheduler was enabled.
2. `npx tsx scripts/ops/game-status-sync.ts --season=2026 --dry-run` shows `bdlHttp: 0`, `wroteDb: false`, `productPin: 2025`.
3. Re-run the vitest command in Test Results; expect pass.
4. Confirm `PINNED_ANALYTICS_SEASON` is still `'2025'`.
5. Confirm Terraform was **not** applied (`game-status-sync` Lambda not deployed).
6. Confirm no `/v1/stats` or GOAT calls were made.
7. On `/ops` (signed in), `Frequent game status sync` is FROZEN / missed-run NOT_EXPECTED.

---

## Step Verdict

`GREEN — frequent game status sync is ready for controlled activation testing`
