# 2026–27 Postgame Automation Orchestration — Step 13F.1

**Step verdict:** `GREEN — postgame automation design is ready for controlled implementation`

**Date:** 2026-09-10  
**Depends on:** 13G.1 observability foundation; 13R.3 identity adapter adoption; Historical Explorer v2 serving contract  
**Mode:** audit / design only. No workers, queues, Terraform, BDL HTTP, S3, or Postgres writes.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| BDL HTTP | **0** |
| GOAT canary | none |
| Lambda deploy | none |
| EventBridge / Scheduler | unchanged (`live_ingestion_enabled=false`) |
| DB backfill | none |
| S3 writes | none |
| 2026 serving-row materialization | none |
| Season-pin flip | none (`PINNED_ANALYTICS_SEASON=2025`) |
| Live ingestion | none |
| Historical Explorer UI | unchanged |
| Product FK migration | none |
| Possessions / WOWY | none |
| 13E Market Movement | not started; not coupled |

13F.1 did not create Lambdas, queues, Step Functions, or tables.

---

## Current Postgame Components

Two **deployed** Lambdas (freeze-gated) plus **script-only** S3→Postgres materializers. Historical scripts are **not** live workers.

| Component | Source | Trigger today | Mode | Input | Output | Idempotency | Retry | Season | Deployed | GOAT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nightly BDL | `/v1/games`, `/v1/stats` | EventBridge 08:00 UTC when enabled | `DATA_MODE` / offseason / dry-run skip | ET yesterday–today Finals; forward slate | `raw.games`, `raw.player_game_stats`, `analytics.games`, `player_game_logs`, `team_game_stats`, season averages from PGL | `games(game_id)`; PGL `(game_id,player_id)`; TGS `(team_id,game_id)` | 5xx, 3 retries, 60s base | pin / env, fallback **2025** | **Lambda** (300s) | No (stats tier: ALL-STAR vs GOAT **unconfirmed**) |
| Team game stats | Derived from PGL | Inside nightly | same | Final games in window | `analytics.team_game_stats` | `(team_id,game_id)` | n/a | same | **Lambda** | No |
| BBRef boxscore | HTML scrape | EventBridge 08:00 UTC when `boxscore_enable_schedule` | same freeze | Finals missing `bbref_player_game_stats` | `bbref_games`, `bbref_player_game_stats` | bbref ids | 429/503 backoff | any Final | **Lambda** (900s) | No |
| Advanced | GOAT `/nba/v2/stats/advanced` → S3 | Manual archive + `materialize-player-game-advanced.ts` | archive: trial lock; materialize: `DATA_MODE=replay` | S3 `entity=advanced_stats_v2` | `analytics.player_game_advanced` | `(game_id,player_id)` | archive client | **2023–2025** | Script-only | **Yes** |
| Starters | GOAT `/nba/v1/lineups` → S3 | Manual archive + `materialize-game-starters-2025.ts` | same | S3 `entity=lineups` | `analytics.game_starters` | `(game_id,team_id,player_id)` | archive client | **2025 only** | Script-only | **Yes** (code; 13G catalog currently `false`) |
| Plays | GOAT `/nba/v1/plays` → S3 | Manual `backfill-plays-2025.ts` | trial lock | game inventory | S3 `entity=plays/game_id=*.json` only | skip-existing S3 | fail cap 5 | **2025 only** | Script-only | **Yes** (code; 13G catalog currently `false`) |
| game_flow | Canonical S3 Plays | Manual `materialize-game-flow-2025.ts` | `DATA_MODE=replay` | certified Plays | `analytics.game_flow` (flags, not events) | `(game_id)` | n/a | **2025** | Script-only | No (archive already acquired) |
| Role Profile | GOAT season averages archive | Manual `materialize-player-role-profile.ts` | replay | S3 season-averages pages | `analytics.player_role_profile` | `(player_id,season)` | n/a | **2023–2025** | Script-only | **Yes** |
| Explorer details | Postgres serving | On-demand API | n/a | `game_id` | `availability.*` flags | read-only | n/a | flags from rows, not pin | Serving | n/a |
| Ops / 13G.1 | classifiers + pull-runs | `/ops`, CLI | frozen-aware | existing tables | family cards | n/a | n/a | 2026 completeness separate | n/a | per-family flag |

**Do not lift historical backfill scripts into production Lambdas.** Reuse their transforms (certify starters, selected Advanced fields, 12G Plays quality, game_flow flags, identity gates). New workers must be game-scoped, limiter-aware, and season-explicit.

---

## Final Detection

Canonical eligibility: **normalized `analytics.games.status` is Final**, from BDL `/v1/games` `status === 'Final'`, after `normalizeGameStatus`.

Progression (13C.1):

```text
Scheduled → In Progress → Final
Scheduled → Final          (allowed)
Final → Final              (allowed; scores/datetime may correct)
Final → Scheduled / In Progress / tipoff ISO   FORBIDDEN on nightly + refresh-schedule
```

Observer today: **nightly BDL** (`finalGames = allGames.filter(status === 'Final')`) plus forward slate sync. Alternate: `lib/balldontlie/refresh-schedule-from-bdl.ts` (same Final-preserve SQL marker `final-preserve-guard`).

**Regression:** nightly and refresh **cannot** demote Final. `scripts/transform-raw-to-analytics.ts` **can** (`status = excluded.status`). Postgame automation must not use that bulk transform for live 2026 writes.

`status_state` is **not** the trigger (13C.1 deferred).

Trigger must be **state-driven**: a game is eligible iff it is Final in `analytics.games`. A periodic scanner discovers Finals; wall-clock alone is not eligibility.

**Gap:** nightly at **08:00 UTC (~03:00–04:00 ET)** cannot meet a 10–20 minute BASE_READY target. Frequent status sync is a **prerequisite**, not something nightly can absorb.

Postponed / Canceled are not Final. Overtime / late / after-midnight ET games remain eligible as soon as status is Final.

---

## Historical Explorer Readiness Model

Product already uses independent capabilities (`HistoricalModuleAvailability`):

```text
box          ← player_game_logs rows (section always mounts)
starters     ← game_starters with exactly 5+5
advanced     ← player_game_advanced rows attached to box players
roleProfile  ← player_role_profile for game.season + box player ids
timeline     ← game_flow.timeline_available === true  (not “S3 Plays exists”)
rotationContext ← game_flow.rotation_available (not a Timeline show gate)
```

Official score is always `analytics.games`, never Plays.

### MINIMUM_READY (= BASE_READY)

All of:

1. `analytics.games.status` is Final (preserve-guarded)
2. Official home/away scores present
3. Box: `player_game_logs` for that `game_id` with **player rows > 0** and both team sides represented (wrong `team_id` rows dropped, never reassigned)
4. No catastrophic identity failure that emptied the box (partial skip of Class C is OK)

Does **not** require starters, Advanced, Plays, Timeline, or Role refresh.

### ENRICHED (= RESEARCH_READY)

MINIMUM_READY plus **any** certified optional module (starters / Advanced / Role / Timeline).

### COMPLETE (= FULLY_ENRICHED)

MINIMUM_READY plus every **expected** module for that season and subscription, **or** a terminal expected-absence for that module (truncated Timeline, starter identity fail-closed, player Advanced unqualified).

Do **not** use a single all-or-nothing `historical_complete` boolean for the product. Keep per-capability flags. Aggregate is ops-only.

A permanently truncated Timeline is COMPLETE-with-absence, not FAILED forever.

---

## Dependency Graph

Certified from serving code (not a serial pipeline):

```text
Final (analytics.games)
  ├── BDL /v1/stats ──► PGL + team_game_stats ──► BOX_READY ──► MINIMUM_READY
  ├── BDL /nba/v1/lineups ──► S3 ──► certify 5+5 ──► game_starters ──► starters capability
  ├── BDL /nba/v2/stats/advanced ──► S3 ──► player_game_advanced ──► advanced capability
  └── BDL /nba/v1/plays ──► S3 canonical
         └── 12G certify ──► game_flow ──► timeline capability
Role Profile: separate periodic season-averages job (not per Final)
BBRef: parallel archive tables only — never writes Explorer box
13E market close: not in this graph
```

**Parallel after Final:** box, starters, Advanced, Plays.  
**Serial:** Plays certified → game_flow → Timeline.  
**Independent failures** must not block siblings.

---

## Box / Stats

| Item | Decision |
| --- | --- |
| Authoritative Explorer box | **BDL `/v1/stats`** → `raw.player_game_stats` → `analytics.player_game_logs` |
| Team stats | **Derived** from PGL + home/away (no separate BDL team box) |
| Fallback | **None silent.** BBRef must not overwrite PGL |
| Final required | Yes. Nightly already filters Final before `/stats` |
| Typical availability | Usually with Final; retry `PROVIDER_NOT_READY` if 0 rows |
| Identity | Nightly `upsertAnalyticsPlayer` is the **owned BDL projection-creation** path. Generic PGL gate (`lib/identity/box-identity.ts`) still requires serving for non-owner writes. One Class C skip ≠ crash the game |
| Conflict | UPSERT `(game_id, player_id)`. Do not dual-write from BBRef into these tables |
| Volume gate | Final + 0 player rows is unexpected → not BOX_READY |

BOX_READY:

- Final game exists with official scores
- Expected two team sides
- Player rows > 0 after identity filter
- No empty-box identity catastrophe

Advanced/Plays not required.

---

## BBRef Ownership

**Reconciliation / historical-only archive.** Not primary. Not Explorer box. Not a fallback that silently fills PGL.

- Writes `bbref_*` only
- Identity is **13R.3 DEFERRED** (name match; `bbref` bridges = 0)
- Must not race BDL for the same serving box
- Keep schedule **disabled**; do not put BBRef inside the 2026 postgame orchestrator

If a future operator wants BBRef as a last-resort box, that is a separate explicit dual-source policy — not 13F.

---

## Starting Five

2025 production path: BDL lineups archive → `certifyStarterGame` → `analytics.game_starters`. Product shows only **exact 5 home + 5 away**.

| Kind | Source | Allowed on Historical Explorer? |
| --- | --- | --- |
| Pregame projected | Live `/nba/v1/lineups` **or** minutes heuristic | **No** (Final path already skips these) |
| Postgame certified | Postgame lineup object `starter=true`, archive team.id | **Yes**, after 5+5 certify |

Never copy Projected Starters into `game_starters`.

If one identity cannot serve: **do not emit 4.** Mark starters unavailable (`IDENTITY_NOT_SERVING` / `canonical_identity_unresolved`). Other stages continue.

Anomalies stay fail-closed (`incomplete`, `duplicate_starter`, known 2025 anomaly ids). Do not generalize 2025 anomaly IDs into 2026 without evidence.

Lineups comment: data only after game has begun; endpoint does not reliably distinguish DNP/inactive. Postgame uses `starter=true` only.

---

## Advanced

Provider-supplied V2. Court Context does **not** recompute.

| Item | Current |
| --- | --- |
| Endpoint | `GET /nba/v2/stats/advanced?seasons[]=&period=0` (full-game rows) |
| Selected fields | usage, TS, eFG, ORtg, DRtg, net, pace, possessions, AST%, REB%, TO ratio, PIE |
| Excluded | estimated_* , switches_on, matchup_minutes |
| Serving | `analytics.player_game_advanced`, attach onto **existing box players only** |
| Seasons | `['2023','2024','2025']` — **2026 not allowed yet** |
| Idempotency | PK `(game_id, player_id)`; duplicate grain is hard fail |
| GOAT | Required |

**Open (must resolve in 13F.4 before live calls):** historical job paginates **season-wide** (~350–460 pages). That is not a per-game worker. Prefer `game_ids[]` (or equivalent) if the API supports it. If not, overnight cursor-delta from S3 manifest — never full-season recrawl after every Final.

Player missing Advanced ≠ game failure (`NOT_AVAILABLE_YET` / expected absence). Empty game after retries while other games have rows → `FAILED` or `PROVIDER_NOT_READY` then terminal review.

---

## Plays

| Item | Current |
| --- | --- |
| Endpoint | `/nba/v1/plays?game_id=` (fallback `/v1/plays` on 404) |
| Grain | one game; 2025 characterization: **~500 events, 1 page**, `paginationObserved: false`; cap **12 pages** |
| Timing | Postgame only. **No live PBP** |
| Storage | S3 canonical only. **No Postgres event table** |
| Completeness | 12G `classifyStreamCompleteness` + order integrity |
| GOAT | Required |
| Season | **2025 hardcoded** |

`PLAYS_FETCHED` ≠ Timeline.

States: `NOT_ATTEMPTED` → `FETCHED` → `CERTIFIED` \| `TRUNCATED` \| `FAILED`.

---

## game_flow

Depends on **certified** Plays (not truncated, not order-malformed).

```text
Plays archived → normalize/certify (12G) → UPSERT analytics.game_flow → TIMELINE_READY
```

Do not materialize Timeline-available game_flow from incomplete/truncated Plays. Score mismatch can still be Timeline-eligible (official score stays on `analytics.games`). Rotation is independent of Timeline.

---

## Role Profile Cadence

Season grain `(player_id, season)`, not per game. Explorer has **no as-of-game freshness**.

**Out of postgame orchestration.** Separate periodic Season Averages refresh (playtype / tracking / shooting / hustle categories — many probes, not six-after-every-Final).

Recommended cadence: **daily overnight** (aligns with 13G SLA 168h). Useful while stale up to ~7 days mid-season; opening week may want a second refresh after game 3–5.

Nightly PGL-derived `player_season_averages` is a **different** table (box averages). Do not confuse it with Role Profile.

---

## Identity Integration

13R.3 remains source of truth.

| Stage | Policy |
| --- | --- |
| Box / nightly | Owned BDL upsert may create serving rows from attested BDL ids; skip/quarantine unsafe |
| Starters | Per-game 5+5 fail-closed; other games continue |
| Advanced / Role | Skip non-serving; do not throw the whole night |
| Plays | Chronology may keep provider ids; serving names fail-closed; Timeline ≠ invent box rows |
| BBRef | Deferred; not in orchestrator |

One new rookie must not crash the night. `not_serving_yet` → quarantine + later eligibility when a real BDL bridge appears. Never invent bridges.

---

## Subscription Semantics

Integrate 13G.1. If GOAT inactive:

| Stage | Behavior |
| --- | --- |
| Box (if ALL-STAR stats allowed) | May still reach MINIMUM_READY |
| Starters / Advanced / Plays / Role | `BLOCKED_BY_SUBSCRIPTION` — **do not retry-fail** |
| Timeline / game_flow | Blocked until Plays allowed |

Distinguish from `PROVIDER_401` (bad credentials while subscription is believed active), provider outage (`PROVIDER_5XX` / timeout), and code/DB failure.

13G catalog currently marks `starters_lineups` and `plays` as `goatRequired: false`. **Code says GOAT.** Correct the catalog in 13F.2 (observability), not by guessing from 401s.

Subscription detection remains an explicit ops/config flag (as in 13G.1). Do not scrape the provider dashboard in 13F.

When GOAT later activates: reconciler selects stages with `BLOCKED_BY_SUBSCRIPTION` and re-enqueues. No manual game list.

---

## Retry Policy

Not one generic loop. At-least-once + idempotent writes.

| Cause | Policy |
| --- | --- |
| `PROVIDER_NOT_READY` (empty Advanced/Plays/box right after Final) | Retry later: ~15 min, ~60 min, overnight; then operator review / expected wait |
| `PROVIDER_429` | Account limiter + Retry-After; job yields; retry later. Do not hammer |
| `SUBSCRIPTION_BLOCKED` / 401 while GOAT known inactive | **No retry** until config says active |
| `IDENTITY_NOT_SERVING` | Quarantine; game/stage eligible after bridge appears (reconciler join) |
| `IDENTITY_CONFLICT` | Fail-closed that grain; operator |
| DB transient | Bounded 2–3 retries |
| `MALFORMED_SOURCE` / `QUALITY_FAILED` / `SOURCE_TRUNCATED` | No hot retry; truncated is terminal expected-absence for Timeline |
| `S3_WRITE_FAILED` / `DB_WRITE_FAILED` | Bounded retry then FAILED |

Advanced: distinguish **NOT_AVAILABLE_YET** vs **FAILED**.

Limiter: existing DynamoDB live limiter (default **13s / burst 1**) for all BDL workers. Archive trial limiter must not be used on live AWS workers.

---

## Idempotency

Exactly-once is **not** required.

| Stage | Natural key | Repeat-safe |
| --- | --- | --- |
| Box PGL | `(game_id, player_id)` UPSERT | Yes |
| Team stats | `(team_id, game_id)` | Yes |
| Starters | `(game_id, team_id, player_id)`; rewrite only after full 5+5 certify | Yes; never partial write |
| Advanced | `(game_id, player_id)` | Yes |
| Plays S3 | `.../season=<YYYY>/entity=plays/game_id=<id>.json` overwrite same key | Yes |
| game_flow | `(game_id)` | Yes |
| Role | `(player_id, season)` | Yes (periodic job) |

Retries must not duplicate serving rows or create extra S3 keys.

---

## Per-Game / Per-Stage Isolation

- **Per game:** Game A malformed Advanced must not block Games B/C/D. SQS message grain = `(game_id, stage)`.
- **Per stage:** Advanced fail → box/starters/Timeline may succeed. Plays fail → box/Advanced/starters survive. Starter fail-closed → rest survives.
- Worker reserved concurrency **1** (or low) so the 13s limiter is not stampede. Isolation is **queue + idempotent writes**, not parallel BDL.

Explorer already omits missing modules. Lean into that.

---

## Observability Contract

Reuse 13G.1 `IngestionRunResult` + identity accounting. Do not invent a second log schema.

Per stage attempt:

- `event=ingestion_run` (or `postgame_stage`)
- `job`, `run_id`, `game_id`, `stage`
- `started_at`, `finished_at`, `duration_ms`, `attempts`
- `status`, `reason` (taxonomy below)
- `input_count`, `output_count`, `skipped_count`, `quarantined_count`
- `provider_status` (no bodies)

**13F.2 should add a compact `analytics.postgame_game_stages` (or ops-schema equivalent)** because serving tables cannot distinguish WAITING vs BLOCKED vs FAILED vs expected absence. 13G.1 correctly skipped a generic `ingestion_runs` table; **per-game stage state is justified here**.

Fields (no secrets, no payloads, no unbounded stacks): `game_id`, `season`, `stage`, `status`, `attempts`, `reason_code`, `input_count`, `output_count`, `identity_skipped`, `provider_http`, `started_at`, `finished_at`, `updated_at`.

Retention: current season detailed rows; no archive job required (~1230 games × ~6 stages).

`/ops` (later, not 13F.1 UI): recent Finals with per-capability chips. Example:

```text
BOS @ NYK — Final
Box       READY
Starters  READY
Advanced  WAITING
Plays     READY
Timeline  READY
Role      FRESH
```

---

## Failure Taxonomy

Stable reason codes (keep this list small):

| Code | Meaning |
| --- | --- |
| `PROVIDER_NOT_READY` | Empty/not published yet |
| `SUBSCRIPTION_BLOCKED` | GOAT/tier inactive |
| `IDENTITY_NOT_SERVING` | Class C / not in `analytics.players` |
| `IDENTITY_CONFLICT` | Unsafe mapping |
| `SOURCE_TRUNCATED` | Plays incomplete (12G) |
| `QUALITY_FAILED` | Order malformed / certify fail |
| `PROVIDER_401` | Auth while subscription believed active |
| `PROVIDER_429` | Rate limit |
| `PROVIDER_5XX` | Provider error |
| `NETWORK_TIMEOUT` | Acquire/HTTP timeout |
| `MALFORMED_SOURCE` | Unparseable payload |
| `DB_WRITE_FAILED` | Postgres |
| `S3_WRITE_FAILED` | Archive write |
| `VOLUME_UNEXPECTED_ZERO` | Success path with 0 rows where 0 is wrong |

---

## Expected Availability / SLA

Targets **after frequent status sync exists**. Current 08:00 UTC nightly does **not** meet these.

| Stage | Product target | Bound (13G SLA hours, ACTIVE) |
| --- | --- | --- |
| Final detected | 10–15 min of provider Final | status job cadence |
| Box / MINIMUM_READY | **10–20 min of Final** | 30h catch-up |
| Starters | 15–30 min if GOAT | 36h |
| Advanced | often lags; 15m / 1h / overnight | 36h |
| Timeline | postgame; 30–90 min typical if 1-page Plays | 36h |
| Role | not per game; overnight | 168h |

Immediate: status + box. Overnight: Advanced/Plays catch-up + Role + reconciler.

---

## Request Budget

Typical **10-game night**, postgame-only (status sync counted separately). **No live BDL in this step** — from code shapes.

| Call | Shape | 10 games |
| --- | --- | --- |
| Status `/v1/games` | date window, cursor/100 | ~1–2 (shared with schedule job, not 10) |
| Box `/v1/stats` | `game_ids[]` batch 25, cursor/100; ~25 players/game → ~250 rows | **~3 pages** |
| Lineups `/nba/v1/lineups` | one `game_id` / request | **10** |
| Advanced | unknown per-game filter; if `game_ids[]` works | **~1–10**; if season cursor only, **do not** recrawl 350+ pages nightly |
| Plays | usually **1 page / game** (~500 events); max 12 | **10 typical, 120 worst** |
| Role / season averages | many category probes | **0 in postgame** |

**Serial total typical:** ~3 + 10 + 5 + 10 ≈ **28 calls** if Advanced is cheap per-game.  
**Worst Plays-heavy:** ~130+ calls.

At **13s limiter:** 28 × 13s ≈ **6.1 min**; 130 × 13s ≈ **28 min**. Fits a worker night if concurrency is 1. Does **not** fit inside the existing **300s nightly Lambda** if Plays are added.

At a future paid ~200ms interval: 28 × 0.2s ≈ **6s** request wait (plus parse/write). Still serialize through the limiter.

---

## S3 / Postgres Strategy

**S3 = raw/deep archive.** 2026 paths (existing convention):

```text
raw/source=balldontlie/league=nba/season=2026/entity=lineups/game_id=<id>.json
raw/source=balldontlie/league=nba/season=2026/entity=plays/game_id=<id>.json
raw/source=balldontlie/league=nba/season=2026/entity=advanced_stats_v2/page=<n>.json + _manifest
raw/source=balldontlie/league=nba/entity=season_averages/...   (periodic Role, not per game)
```

Skip-existing / overwrite same key. No characterization prefixes in production.

**Postgres = compact serving:**

- `player_game_logs`, `team_game_stats`
- `game_starters`
- `player_game_advanced`
- `player_role_profile` (periodic)
- `game_flow` (flags only)
- future `postgame_game_stages`

Do **not** store Plays events in Postgres.

---

## 2026 Season Guard Changes

Do **not** flip now. Required before activation of each stage:

| Guard | Today | 2026 change |
| --- | --- | --- |
| `PINNED_ANALYTICS_SEASON` / nightly fallback | 2025 | still **not** a postgame-only flip; status/box jobs need explicit `season=2026` scoping |
| `PLAYER_GAME_ADVANCED_SEASONS` | 2023–2025 | add `'2026'` when Advanced serving is certified |
| `GAME_STARTERS_SEASON` / lineups prefix | `'2025'` | `'2026'` + drop `lineups_2025`-only assert |
| `HISTORICAL_TIMELINE_SEASON` / plays prefix | `'2025'` | `'2026'` |
| `PLAYER_ROLE_PROFILE_SEASONS` / `SEASON_AVERAGES_TARGET_SEASONS` | through 2025 | add 2026 |
| `TRIAL_ARCHIVE_SUPPORTED_SEASONS` | 2023, 2024, 2025 | add 2026 **or** stop using trial allowlist for live workers |
| Materializer script names `*-2025.ts` | 2025 inventory 1322 | game-scoped workers; do not run full-season 2025 inventory against 2026 |
| Historical safety | — | workers **must** filter `season = 2026` (or explicit allowlist). **Forbidden:** rewrite 2023/2024/2025 certified rows |

---

## Recovery / Reconciliation

Do not rely on a one-shot Final transition event.

**Scanner (same code as enqueue):**

> Recent Finals (`season=2026`) whose expected stages are not READY / EXPECTED_ABSENCE / BLOCKED.

| Window | Cadence (once thawed) |
| --- | --- |
| Last 36 hours | every 10–15 min during slate hours (after status sync) |
| Last 7 days | overnight |

Offline for a night: next scan finds Finals with missing stages and enqueues them.

GOAT reactivation: `WHERE reason_code = 'SUBSCRIPTION_BLOCKED'`.  
New BDL bridges: join quarantine / `IDENTITY_NOT_SERVING` stages to newly serving player ids; re-enqueue starters/Advanced/box grains only.

---

## Manual Rerun

Design-only CLI (implement in 13F.6):

```text
postgame-run --game <bdl_game_id> --stage box|starters|advanced|plays|game_flow
postgame-run --game <bdl_game_id> --missing
postgame-run --lookback-hours 36 --missing
```

Must be idempotent, season-scoped, freeze-aware, and must not call BDL when `DATA_MODE≠live_api`.

---

## Recommended Orchestration Architecture

**Choose: Option A + B — periodic scanner + per-stage SQS worker.**  
Not Step Functions. Not a nightly monolith. Not wall-clock “11:30 PM fetch everything.”

| Option | Verdict |
| --- | --- |
| A periodic scanner + tasks | **Yes** — discovery + self-heal |
| B Scheduler + SQS | **Yes** — isolation/retries; already used by props |
| C Step Functions | **No** — new platform, cost, no current fit |
| D extend nightly | **No** — 300s timeout; 08:00 UTC too late; Plays blow the budget; poor isolation |

Nightly BDL **keeps** schedule + overnight box catch-up + PGL-derived averages. It must **not** grow Advanced/Plays/lineups.

Mirrors props: controller (scan) → queue → worker (one stage per message) → DLQ.

```text
Frequent game/status sync (/v1/games)     [prerequisite; not 08:00-only]
        ↓
analytics.games.status = Final
        ↓
Postgame scanner (10–15 min slate / overnight 7d)
  derive missing stages from serving + postgame_game_stages
        ↓
SQS postgame_stage_queue   (game_id, stage, attempt)
        ↓
Worker (concurrency 1, DynamoDB 13s limiter)
  ├── box        FREE/ALL-STAR? → PGL + team stats → BOX_READY
  ├── starters   GOAT → S3 → 5+5 certify
  ├── advanced   GOAT → S3 → selected fields
  └── plays      GOAT → S3
         ↓
      certify (12G) → game_flow → TIMELINE_READY
        ↓
Explorer availability.* (already productized)
        ↓
Reconciler catches misses, BLOCKED catch-up, identity catch-up
```

Role Profile: **separate daily job**.  
13E close: **separate**. Postgame may *read* finalized markets later; it must not capture them.

---

## Proposed 13F Implementation Slices

Do **not** start these automatically.

| Slice | Scope |
| --- | --- |
| **13F.2** | `postgame_game_stages` + status/readiness model + scanner/queue **foundation** (Terraform optional behind freeze). Fix 13G `goatRequired` for lineups/plays. **No BDL.** Tests with fixtures |
| **13F.3** | Box automation (Final → stats → PGL/TGS) + certified starters worker **behind GOAT/subscription skip**. Season=2026 guards. Still freeze-gated |
| **13F.4** | Advanced per-game (or proven overnight delta). Confirm `game_ids[]`. Bounded NOT_AVAILABLE_YET retries |
| **13F.5** | Plays archive + 12G certify + game_flow. Timeline postgame only |
| **13F.6** | Reconciler lookback, GOAT/identity catch-up, manual `postgame-run`, `/ops` compact Final cards, activation signoff |

Avoid one giant implementation.

---

## Activation Prerequisites

| Prerequisite | Class |
| --- | --- |
| Frequent schedule/status job (not 08:00-only) certified | **Required** for 10–20 min BASE_READY |
| Identity resolver deployed (13R.3) | **Required** (code already adopted) |
| Observability foundation (13G.1) | **Required** |
| Centralized BDL limiter on workers | **Required** |
| Idempotent UPSERT / S3 keys | **Required** |
| 2026 season guards per stage | **Required** before that stage’s live writes |
| S3 bucket/prefix + IAM | **Required** for starters/Advanced/Plays |
| Bounded retries + DLQ | **Required** |
| Freeze flags until explicit thaw | **Required** |
| GOAT entitlement | **Required** for starters/Advanced/Plays/Role; **optional** for MINIMUM_READY if `/v1/stats` is allowed on current plan |
| Confirm `/v1/stats` ALL-STAR vs GOAT | **Required** before 13F.3 live box |
| Confirm Advanced `game_ids[]` | **Required** before 13F.4 live |
| Historical 2023–2025 write protection | **Required** |
| `/ops` Final cards | Optional (13F.6) |
| BBRef in orchestrator | **Not required** |
| Live Timeline / PBP | **Not required** |
| Role inside postgame | **Not required** |
| 13E market close | **Not required** |
| Step Functions | **Not required** |

---

## Risks / Open Questions

1. **`/v1/stats` plan tier** — ALL-STAR vs GOAT unconfirmed (no HTTP this step). If stats are GOAT-only, MINIMUM_READY is also blocked until subscription.
2. **Advanced per-game query** — not in current archive client (season cursor only). 13F.4 must prove a cheap filter or overnight delta.
3. **13G catalog vs code** — lineups/plays `goatRequired: false` is wrong relative to comments; fix in 13F.2.
4. **Nightly still overwrites 2026 PGL** when thawed — orchestrator and nightly must not double-write conflicting box logic; 13F.3 should make nightly the overnight catch-up **or** the owned box writer, not both with different identity rules.
5. **`transform-raw-to-analytics` lacks Final-preserve** — keep it off the live 2026 path.
6. **Starter 5+5 on lineups that lack inactive/DNP distinction** — already certified for 2025; re-spot-check 2026 samples before 13F.3 thaw.
7. **Plays 1-page assumption** — 2025 characterization; 2026 OT may paginate; cap 12 remains.

None of these block **13F.2** (state + scanner foundation without BDL).

---

## Recommended Next Step

**13F.2 — postgame state/readiness model + queue/scanner foundation.**

Pure contract + persistence + isolation tests. No schedule enable. No BDL. No Explorer UI. No 13E.

---

## Verification Checklist

1. Confirm `live_ingestion_enabled=false` and no ingest Lambda was invoked.
2. Confirm this step added **no** Terraform resources, Lambdas, queues, or Step Functions.
3. Confirm no BDL HTTP, no S3 writes, no 2026 serving materialization, pin still 2025.
4. Read this report’s dependency graph vs Explorer `availability.*` — box is MINIMUM; Timeline requires `game_flow.timeline_available`.
5. Confirm BBRef is **not** listed as Explorer box owner.
6. Confirm Role Profile and 13E are **out** of the postgame graph.
7. Do not start 13F.2 / 13E / live ingestion automatically.

---

## Step Verdict

`GREEN — postgame automation design is ready for controlled implementation`
