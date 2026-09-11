# 2026–27 Postgame Box Provider Canary — Step 13F.3A

**Canary verdict:** `BLOCKED — Box endpoint is unavailable on the current subscription`

**Date:** 2026-09-10  
**Depends on:** 13F.3 YELLOW (Box/starters workers implemented; entitlement was UNCONFIRMED)

```text
BOX_PROVIDER_ENTITLEMENT=BLOCKED_BY_SUBSCRIPTION
```

HTTP classification: `SUBSCRIPTION_OR_ENTITLEMENT_BLOCKED` (401). Provider testing stopped. No second endpoint. No credential diagnosis.

---

## Safety / Scope

Preserved throughout:

| Gate | Result |
| --- | --- |
| `live_ingestion_enabled` | **false** |
| Schedules | DISABLED (unchanged) |
| Process `.env` freeze | `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1` |
| `PINNED_ANALYTICS_SEASON` | **2025** |
| GOAT | inactive; **lineups not called** |
| Stage-table migration | **NOT_APPLIED** (`to_regclass` = null) |
| Terraform | **NOT_APPLIED** |
| Lambda | **NOT_DEPLOYED** |
| SQS consumer | **NOT_ACTIVE** |

Allowed HTTP: **one** `GET /v1/stats?game_ids[]=<id>` via `fetchBdlLive` + Dynamo limiter.

Not called: `/nba/v1/lineups`, Advanced, Plays, injuries, odds, props, Season Averages, `/v1/games`.

Process freeze flags were **not** flipped. Live limiter env was passed only as `fetchBdlLive({ env })` (same pattern as the 13C schedule canary).

---

## Selected Game

Certified 12B/12C 2025 Final, not an anomaly id (`18447931` / `18447988`).

| Field | Value |
| --- | --- |
| game id | `18447937` |
| season | `2025` (not 2026) |
| date | `2026-04-03 02:30:00+00` (season-2025 Final) |
| home | LAC LA Clippers (`13`) |
| away | SAS San Antonio Spurs (`27`) |
| official score | 99–118, status `Final` |
| local `player_game_logs` | **36** (18 home / 18 away) |
| starter anomaly | false |

Read-only SELECT only. No DB mutation for selection.

---

## Pre-Canary Tests

Ran before HTTP:

```bash
npx vitest run lib/balldontlie/__tests__/live-rate-limit.test.ts \
  lib/balldontlie/__tests__/live-rate-limit-dynamo.test.ts \
  lib/postgame \
  lib/identity/__tests__/adapter-adoption.test.ts \
  lib/identity/__tests__/ingest-identity-gate.test.ts \
  lib/identity/__tests__/classify-sql-rows.test.ts
```

**11 files, 90 tests, passed.** Covered shared live client, freeze/replay skip, Box pagination/transform/quality gate (fixtures), identity, freeze-gated worker.

HTTP did not start until this was green.

---

## Request

Client: `fetchBdlLive` (`lib/balldontlie/live-rate-limit` → Lambda shared limiter). Worker name `postgame-box-canary`.

Shape (same as 13F.3 Box worker):

```text
GET https://api.balldontlie.io/v1/stats?game_ids[]=18447937&per_page=100
```

No undocumented params. No season enumeration. No raw `fetch`. No curl. No second retry loop. Dynamo `nba-bdl-rate-limit` permit granted (`wait_ms=0`).

Script: `scripts/ops/2026-postgame-box-stats-canary.ts` (SELECT-only SQL; abort if non-SELECT).

---

## HTTP / Entitlement Result

| Item | Value |
| --- | --- |
| HTTP status | **401** |
| Classification | `SUBSCRIPTION_OR_ENTITLEMENT_BLOCKED` |
| `BOX_PROVIDER_ENTITLEMENT` | **BLOCKED_BY_SUBSCRIPTION** (Case B) |
| Body used | none (stopped) |
| Further provider calls | **0** |

This canary does **not** assert “bad credentials” vs “tier does not include `/v1/stats`”. Both present as 401. Worker already maps 401/403 → `BLOCKED / SUBSCRIPTION_BLOCKED`.

ALL-STAR vs GOAT **not** named; provider did not return a tier label.

---

## Pagination

Not certifiable. One request, no `data`/`meta`. Cap of 8 pages was not reached. No contract mismatch on page count.

---

## Response Shape

Empty. Field presence for player/team/min/pts/reb/ast/shooting/rebounds/stocks was **not** observed live. Fixture transforms remain the source of mapping truth until a 200 canary exists.

---

## Player / Team Coverage

Provider: 0 rows, 0 player ids, 0 team ids, 0 home, 0 away.

Filter `game_ids[]` uniqueness: **not observed** (no rows). Not scored GREEN.

---

## Historical Comparison

Local truth unchanged (read-only):

- Local PGL: 36 players, both teams, 18+18
- Provider: 0 rows because 401
- No rewrite of local Box

This is not a historical reconciliation failure; the endpoint did not return stats.

---

## Identity Compatibility

Skipped. `gateIngestIdentities` / `evaluateBoxStage` need provider player ids. None arrived.

Would have used `loadPartialIdentityIndex` (SELECT bridges/projections only) + in-memory gate. `persistQuarantine` was never invoked.

Quarantine table: count 0 before and after; `max(updated_at)` null both times.

---

## MINIMUM_READY Simulation

Not executed (no 200 payload).

If this game had returned a complete 5+5-team Box, the 13F.3 gate’s expected dry-run for a stable 2025 Final is `READY`. That remains a fixture-certified expectation, not a live proof.

---

## Provider Request Count

**1** request. **1** limiter grant. No lineups. No other BDL paths.

---

## Credential Safety

- Key loaded from local `.env`; never printed
- `logBdlThrottle` strips `apiKey` / `authorization` / `body`
- Canary wraps `console.log` and report JSON with a leak abort
- Authorization header was sent only to `fetchBdlLive`
- This report does not contain the key, `.env`, or Terraform secret values

No credential leak detected in this step’s console output.

---

## Mutation Check

| Surface | Before | After |
| --- | --- | --- |
| `analytics.player_identity_unresolved` | 0 | 0 |
| `player_game_logs` season 2026 | 0 | 0 |
| `analytics.postgame_game_stages` | absent | absent |
| S3 | not called | not called |
| Serving writes | 0 | 0 |

---

## Post-Canary Regression

```bash
npx vitest run lib/postgame lib/balldontlie/__tests__/live-rate-limit.test.ts \
  lib/identity/__tests__/adapter-adoption.test.ts \
  lib/identity/__tests__/ingest-identity-gate.test.ts \
  infra/__tests__/postgame-queue.test.ts
```

**10 files, 86 tests, passed.**

Confirmed: freeze env still replay/offseason/dry-run; `live_ingestion_enabled=false`; stage table not applied; no worker deploy; no 2026 writes.

---

## Remaining Deployment Blockers

Unchanged / still blocking any Box thaw:

1. **`/v1/stats` 401 on current subscription** (this canary)
2. Lambda zip does not bundle `handlePostgameMessage` (do not fix in this step)
3. `analytics.postgame_game_stages` **NOT_APPLIED**
4. Terraform **NOT_APPLIED**; ESM **DISABLED**
5. GOAT inactive (starters still `BLOCKED_BY_SUBSCRIPTION`; not tested)

Do not apply SQL. Do not deploy. Do not enable the queue.

---

## Recommended Next Step

**Park Box activation pending provider subscription work.**

Do not buy or enable GOAT from this step.  
Do not start **13F.4**.  
Do not start **13F.3B** (bundling/migration) until `/v1/stats` returns 200 or an explicit product decision accepts Box as subscription-blocked.

Starters canary remains forbidden while GOAT is inactive.

---

## Verification Checklist

1. Confirm you did not see a BDL key in this report or the canary JSON stdout.
2. Confirm `live_ingestion_enabled` is still false.
3. Confirm `DATA_MODE=replay` / `OFFSEASON_MODE=1` / `CRON_DRY_RUN=1` in process env.
4. Confirm `to_regclass('analytics.postgame_game_stages')` is still null if you check later.
5. Do not call `/nba/v1/lineups` to “double-check” GOAT.
6. Do not apply Terraform or the stage migration from this result.
7. Do not start 13F.4.

---

## Canary Verdict

`BLOCKED — Box endpoint is unavailable on the current subscription`

```text
BOX_PROVIDER_ENTITLEMENT=BLOCKED_BY_SUBSCRIPTION
```

**STOP after Step 13F.3A.**
