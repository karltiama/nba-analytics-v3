# 2026–27 Live Activation Audit — Step 13A

**Step verdict:** `YELLOW — activation path is viable but blockers must be resolved first`

**Date:** 2026-09-10  
**Scope:** Read-only audit + activation runbook. No live ingestion, flag changes, deploys, BDL acquisition calls, S3 writes, schema migrations, or UI work.

Historical Explorer v2 remains `SHIP_READY`. Market Movement v1 remains `SHIP_READY` (historical 3-Hour Pre-Tip → Close only).

STOP after this step. Possession engine and WOWY stay deferred.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| Production flag changes | **none** |
| EventBridge / Scheduler changes | **none** |
| Lambda deploys | **none** |
| Live BDL ingestion / availability probes | **none** |
| S3 mutations | **none** |
| Backfill | **none** |
| Schema migration | **none** |
| UI / billing changes | **none** |
| Possession / WOWY | **not started** |

Inspection sources: repo (`infra/`, `lambda/`, `lib/runtime`, product reports) + read-only Postgres. Deployed AWS actuals (enabled schedules, reserved concurrency in the account) cannot be confirmed without AWS API calls; Terraform **code** is the source of truth below.

---

## Current Production Freeze State

Confirmed local/runtime freeze (`.env`):

| Flag | Value | Effect |
| --- | --- | --- |
| `DATA_MODE` | `replay` | Not `live_api` → skip provider mutations |
| `OFFSEASON_MODE` | `1` | Skip even if `DATA_MODE=live_api` |
| `CRON_DRY_RUN` | `1` | Skip even if the other two are live |

Canonical gate: `lib/runtime/ingestion-mode.ts` `shouldSkipMutations = cronDryRun \|\| offseason \|\| dataMode !== 'live_api'`. Missing `DATA_MODE` is **not** live.

Terraform freeze defaults (`infra/lambda.tf`): same triad merged **before** tfvars, so omitting keys cannot accidentally thaw Lambdas.

Vercel crons (`vercel.json`): paper-settle `12:00` UTC, prune-props `13:00` UTC. Both no-op under freeze. Destructive prune also needs `PRUNE_ENABLED=1`.

**Do not flip all three flags at once across AWS and Vercel.** See Production Flag Sequence.

---

## Ingestion Job Inventory

Schedules in Terraform **default off** (`*_enable_schedule = false` in `infra/variables.tf`). Example `terraform.tfvars.example` turns **odds** and **player-props** schedules on while freeze flags still skip writes. Treat deployed enablement as **unknown** until AWS is inspected in 13D; do not assume example tfvars equals production.

### A. `nightly-bdl-updater`

| Field | Value |
| --- | --- |
| Script | `lambda/nightly-bdl-updater/index.ts` |
| Lambda | `nightly-bdl-updater` |
| Trigger | Optional EventBridge `cron(0 8 * * ? *)` UTC (03:00 ET) |
| Env | `SUPABASE_DB_URL`, `BALLDONTLIE_API_KEY`, freeze triad, `BALLDONTLIE_REQUEST_DELAY_MS` (default 200ms), `MAX_RETRIES` (3), `DISABLE_BDL_SCHEDULE_SYNC` |
| Provider | `GET /v1/games`, `GET /v1/stats` |
| Targets | `raw.games`, `raw.player_game_stats`, `raw.players` → `analytics.games`, `player_game_logs`, `players`, `team_game_stats`, `player_season_averages`, `team_season_averages` |
| Enabled | Function exists; schedule default **off**; freeze **skips calls** |
| Season | `CURRENT_ANALYTICS_SEASON` / `NBA_STATS_SEASON`, else **hardcoded 2025 pin** |
| Volume | One season-date window per run; sequential stats by game |
| VPC | **non-VPC** (IAM basic execution only) |
| Timeout / memory | 300s / 512 MB |
| DLQ | **none** |
| S3 | **no** |

### B. `odds-pre-game-snapshot`

| Field | Value |
| --- | --- |
| Script | `lambda/odds-pre-game-snapshot/index.ts` |
| Lambda | `odds-pre-game-snapshot` |
| Trigger | Optional EventBridge; example crons every 30 min 10:00–12:00 ET |
| Provider | `GET /v2/odds` (today + tomorrow ET) |
| Targets | `raw.odds_pull_runs`, `raw.odds_snapshots` → `analytics.game_odds_current`, `game_odds_history`, `game_line_movement_summary` |
| Freeze | Yes |
| Season | Date window, not pin |
| Timeout / memory | 300s / 512 MB |
| DLQ | **none** |
| Rate | 200ms between pages; 429 → 60s sleep, **unbounded continue** |

### C. `injuries-snapshot`

| Field | Value |
| --- | --- |
| Script | `lambda/injuries-snapshot/index.ts` |
| Lambda | `injuries-snapshot` |
| Trigger | Optional EventBridge `cron(0 13,18,22 * * ? *)` UTC (~2–3× daily) |
| Provider | `GET /nba/v1/player_injuries` |
| Targets | `raw.injury_pull_runs`, `raw.player_injuries` → `analytics.player_injury_status_current`, `player_injury_status_history` |
| Timeout / memory | 120s / 256 MB |
| Injury-as-of | **Not certified.** Current/latest only |

### D. Player props (controller + worker)

| Field | Value |
| --- | --- |
| Scripts | `lambda/player-props-snapshot/controller.ts`, `worker.ts` |
| Lambdas | `nba-player-props-controller-lambda`, `nba-player-props-ingestion-lambda` |
| Trigger | EventBridge Scheduler `rate(30 minutes)` **or** list of ET crons; default **off** |
| Queue | `nba-player-props-game-queue` + DLQ `nba-player-props-game-dlq` (`maxReceiveCount=4`) |
| Provider | Worker: `GET /v2/odds/player_props?game_id=` (controller does **not** call BDL) |
| Targets | `raw.player_prop_pull_runs`, `raw.player_prop_game_runs`, `raw.player_prop_snapshots_v2`, **`analytics.player_props_current` (multi-book)**, `analytics.player_prop_current` (preferred vendor wipe+insert, default DraftKings) |
| Worker timeout / memory | 600s default (example tfvars 300s) / 512 MB |
| Controller | 120s / 256 MB |
| Reserved concurrency | Variable exists (`default 4`) — **NOT wired** on `aws_lambda_function.player_props_worker` |
| SQS batch | 1 |

### E. `boxscore-scraper`

| Field | Value |
| --- | --- |
| Script | `lambda/boxscore-scraper/index.ts` |
| Provider | Basketball-Reference HTML (**not BDL**) |
| Targets | `bbref_games`, `bbref_player_game_stats`; may patch `games` scores |
| Schedule | Optional daily 08:00 UTC; default **off** |
| Timeout / memory | 900s / 1024 MB |
| Delay | `BBREF_SCRAPE_DELAY_MS` default 4000 |

### F. Vercel crons (not acquisition)

| Route | Schedule | Gate |
| --- | --- | --- |
| `/api/cron/paper-settle` | 12:00 UTC | ingestion-mode skip |
| `/api/cron/prune-props` | 13:00 UTC | materialize needs live triad; delete needs `PRUNE_ENABLED=1` |

### G. Scripts-only (no live Lambda)

| Job | Path | Live worker? |
| --- | --- | --- |
| Advanced serving | `scripts/ingestion/materialize-player-game-advanced.ts` | **No** — seasons `2023–2025` |
| Role Profile | `scripts/ingestion/materialize-player-role-profile.ts` | **No** — `2023–2025` |
| Game starters | `scripts/ingestion/materialize-game-starters-2025.ts` | **No** — `GAME_STARTERS_SEASON='2025'` |
| Game flow | `scripts/ingestion/materialize-game-flow-2025.ts` | **No** — 2025 Plays archive |
| Plays / lineups / advanced raw | `scripts/archive/backfill-*-2025.ts` | **No** |
| Market Movement v1 | `scripts/backfill-market-movement-v1.ts` | **No live 3-hour freezer** |
| On-request BDL lineups | `fetchLineupsFromBallDontLie` in matchup-analysis | Live page only; skipped on Finals; freeze disables dashboard schedule refresh |

---

## AWS / Scheduler Audit

Architecture represented in Terraform:

```text
EventBridge or EventBridge Scheduler
  → Lambda (non-VPC)
    → BallDontLie or Basketball-Reference
      → Supabase Postgres
```

| Topic | Finding |
| --- | --- |
| IAM | Per-function execution roles + `AWSLambdaBasicExecutionRole`; props worker SQS consume; controller SQS send; Scheduler invoke role |
| Logging | CloudWatch via basic execution |
| Alarms (`infra/monitoring.tf`) | Props `GamesFailed`, controller `GamesQueued < 1`, Lambda Errors for nightly/odds/boxscore. `treat_missing_data=notBreaching` on Errors. **No injuries Errors alarm.** No “snapshot missed” alarm |
| VPC | **None** — Lambdas reach Supabase over public pooler |
| Retry | Lambda async default; props SQS redrive 4×; odds/injuries 429 loops unbounded |
| DLQ | **Props SQS only** |
| Concurrency | Account-unreserved; props reserved concurrency **unwired** |
| Distributed throttle | **None** |

---

## Season Configuration Audit

| Location | Value | Class |
| --- | --- | --- |
| `PINNED_ANALYTICS_SEASON` (`lib/season.ts`) | `'2025'` | **Needs 2026 activation change** after schedule + averages exist |
| `CURRENT_ANALYTICS_SEASON` / `NBA_STATS_SEASON` | env override | **Correctly dynamic** |
| `LIVE_AVAILABILITY_SEASON` | calendar unless env | **Correctly dynamic** (injuries vs pin) |
| `resolveIngestionSeasonStartYear` | CLI else pin | **Correctly dynamic** with pin fallback |
| Nightly Lambda default | `return 2025` | **Needs 2026 activation change** |
| Live details `availability.advanced/role/timeline/starters` | hardcoded `false` | **Dangerous if treated as 2026-ready**; intentional fail-closed for historical modules on live path |
| `PLAYER_GAME_ADVANCED_SEASONS` / `PLAYER_ROLE_PROFILE_SEASONS` | 2023–2025 | **Historical-only; stay fixed until 2026 archive exists** |
| `HISTORICAL_TIMELINE_SEASON` / `GAME_STARTERS_SEASON` | `2025` | **Historical-only** |
| MM / plays / lineups S3 `season=2025` | trial prefixes | **Historical-only** |
| `PREFERRED_VENDOR` | `draftkings` | Operational pin — must not be MM “the market” |

**Do not flip the analytics pin to 2026 yet.** `player_season_averages` / logs for 2026 are **0**. Calendar already says 2026; the pin exists so dashboards are not emptied.

---

## 2026 Schedule Readiness

Read-only `analytics.games`:

| Fact | Value |
| --- | --- |
| Rows | **1,200** distinct `game_id`s |
| Date range (`start_time`) | **2026-10-20 → 2027-04-12** |
| Finals | **0** |
| Canonical status (`Scheduled`/`Final`/…) | **0** |
| Status looks like ISO timestamp | **1,200 / 1,200** |
| Example `21717855` | `status='2026-10-20T19:00:00Z'` = `start_time`; scores 0–0; teams `2` @ `9` |
| Team IDs | 30 home / 30 away |
| 2026 PGL / season averages | **0 / 0** |

Expected 30×82 regular season = **1,230** games. Seed is **30 short**. Do not treat 1,200 as certified complete.

UI already maps tipoff-like `status` → **Scheduled** (`lib/betting/normalize-game-status.ts`), which is why 2026 matchup pages render. **Ingestion jobs that write `status` must start emitting real BDL statuses** (`Scheduled` / `In Progress` / `Final`) or live/Final transitions will never land.

**Sufficient to plan against. Not sufficient to declare opening-day certified.** Status repair + count recertification is Stage 1.

---

## Identity / Rookie Readiness

| Metric | Count |
| --- | --- |
| `analytics.player_entities` | 5,615 |
| BDL provider maps | 5,534 |
| `analytics.players` | 5,534 |
| Entities **without** BDL map | **81** |
| Repair report Class C `blocked_by_schema` | **81** |

`analytics.players.player_id` remains **BDL-coupled**. Class C have NBA entity maps (`player_id` nullable on stints) but **no** analytics player PK.

| Feed | Rookie impact |
| --- | --- |
| Box / PGL | Empty until BDL publishes a real id and nightly upserts `raw.players` |
| Props | Empty until BDL props payload includes that id |
| Advanced / lineups / Plays | Cannot materialize player-grain rows without BDL id |
| Roster UI | Can list NBA-only entities |

**Do not fabricate BDL ids or use NBA ids as `analytics.players.player_id`.**

Prerequisite: when BDL first returns the player → attach `player_provider_ids(balldontlie)` to the **existing** entity → upsert `analytics.players`. Nightly box path can do this for players who appear in `/stats`; props can appear earlier than box.

**Launch impact:** veterans (~5.5k) are not blocked. Opening-night **rookie** box/props/Advanced are delayed until BDL localization. Treat as **REQUIRED onboarding**, not a reason to invent bridges.

---

## Daily Game-Day Operating Model

Jobs that **exist** vs **gaps** (labeled).

### Overnight / early morning (03:00 ET if enabled)

* Existing: `nightly-bdl-updater` — schedule/status, Final box logs, season averages rebuild  
* Existing: `boxscore-scraper` — BBRef HTML fallback (optional)  
* Gap: 2026 Advanced / Role / Plays / certified starters materializers

### Game-day morning

* Existing: injuries 2–3× daily cron (if enabled)  
* Existing: odds + props windows (if enabled) — **not** tip-relative  
* Gap: no “games today” scheduler that follows tip times

### Throughout day

* Existing: props controller every 30 min **or** fixed ET cron list; odds similar  
* Existing: on-request BDL schedule refresh from Dashboard **only when thawed** (`isLiveBdlScheduleRefreshEnabled`)  
* Gap: no distributed rate limit across these callers

### ~3 hours pre-tip

* **Gap:** no job freezes certified 3-Hour Pre-Tip references  
* Historical MM used S3 opening-props archive, not this Lambda

### Closer to tip / immediately pre-tip

* Existing: whatever the last props/odds poll wrote to `*_current` / history  
* Gap: no explicit last-pre-tip close capture for live MM (`decision_close` is research/historical)

### During game

* Existing: status only if nightly/on-request schedule refresh runs (not a live PBP worker)  
* Gap: no live Plays worker. **Recommend postgame Timeline, not in-game PBP.**

### Postgame

* Existing: nightly stats → PGL / team stats / averages  
* Gap: 2026 `game_starters`, `player_game_advanced`, `game_flow`, Role refresh as scheduled jobs

---

## Current Props Readiness

| Table | Rows | Books | Last `snapshot_at` |
| --- | --- | --- | --- |
| `analytics.player_props_current` | **0** | — | null |
| `analytics.player_prop_current` | 25,812 | **draftkings only** | 2026-05-02 |

Prior audit stands: **multi-book current board is empty.** Worker code **can** upsert `player_props_current`; freeze + empty table means live Props Explorer current boards will not populate until Stage 4.

`PREFERRED_VENDOR=draftkings` still wipes/refills the legacy table. That table must **not** be used as Market Movement comparison.

---

## Market Movement Live Readiness

Historical v1 **proves** 3-Hour Pre-Tip → `decision_close` (21,132 rows, `live_current` = **0**).

Schema allows `comparison_kind ∈ ('decision_close','live_current')` but comments: **reserved, not populated**.

**Current ingestion does not support live MM.**

Needed pipeline (not implemented):

```text
Current market polling (player_props_current, multi-book)
        ↓
3 hours before scheduled tip → freeze reference (immutable)
        ↓
continue polling current
        ↓
before tip: 3-Hour Pre-Tip → live_current
        ↓
last certified pre-tip snapshot → 3-Hour Pre-Tip → close
```

| Question | Recommended policy (do not implement in 13A) |
| --- | --- |
| Who captures reference? | **New** tip-relative worker (not the 30-min board poller). Persist once per `game_id` + vendor + market |
| Tip time | Authoritative `analytics.games.start_time` after schedule sync |
| Tip changes, reference **not** captured | Use latest start; capture at new T−3h (or immediately if already inside the window) |
| Tip changes, reference **already** captured | **Keep the original freeze. Never overwrite.** Annotate `tip_at_capture`. Do not silently recapture |
| Postponed | Do not close. Keep reference. Resume live_current when rescheduled |
| Book missing at reference | That book is **out** of 3h delta (fail-closed per book) |
| Book appears later | Current-only; not a 3h move |
| Idempotency | Insert-once unique `(game_id, player_id, sportsbook, prop_type, reference_kind)` |

Game-odds MM window CHECK is still the **March 9–22 2026** certified Opening Snapshot. Live season dates **cannot** reuse that CHECK without a migration (not in 13A).

---

## Game Odds Readiness

| Table | Rows | Vendor | Last snapshot |
| --- | --- | --- | --- |
| `analytics.game_odds_current` | 334 | **draftkings** | 2026-05-06 |

Lambda writes current + history for dates it polls. Product books list is 9 names; **stored current is one book.** Live matchup odds charts can work once the odds Lambda is thawed, but they will look DK-centric until multi-book current is a product requirement.

Closing semantics for **live game odds** (recommend):

> Last valid supported-book snapshot **before** BDL status becomes In Progress.

Grace: if still `Scheduled` five minutes after `start_time`, keep polling; first `In Progress`/`Final` ends close capture. **Do not** label post-tip ticks as close.

Historical game-odds comparison stays `last_pre_tip_history` for the certified March window only.

---

## Injury Readiness

Lambda + tables exist. `player_injury_status_current`: **150** rows, last snapshot **2026-05-06**. Freshness helper: `INJURY_FRESHNESS_HOURS` default **36**; frozen UI marks `not_current`.

**Safe to activate for live game pages:** latest injury board, labeled with age, fail-closed if stale.

**Not safe:** historical Opportunity / injury-as-of. Do not build that in 13x live activation.

---

## Lineup / Starter Readiness

| Mode | Source | Semantics |
| --- | --- | --- |
| Pregame / Scheduled | BDL `/nba/v1/lineups` with analytics fallback | **Projected** |
| Postgame Final | `analytics.game_starters` from lineup **archive** | **Certified Starting Five** |

These must never mix. Final details already skip live lineup fetch.

2026 Finals **will not** get Starting Five until a `season=2026` lineup archive + season-generic materializer exist (`GAME_STARTERS_SOURCE` is `bdl_lineups_archive_2025`). That is **P2 / Stage 8**, not opening-night P0.

---

## Postgame Box / Team Stats Readiness

Source of truth for Historical Explorer box: `analytics.player_game_logs` from BDL `/v1/stats` via nightly (not BBRef). BBRef is a fallback scraper.

| Gate | Behavior |
| --- | --- |
| Final status | Nightly should only treat provider Final as complete; 2026 rows are not Final today |
| Idempotency | Upserts by game/player |
| Retry | Nightly `MAX_RETRIES` 3, 429 backoff 60s |

**How fast a 2026–27 Final becomes a complete historical page:**

* Box + official score: **same night** if nightly (or a postgame invoke) runs after BDL Final stats  
* Starting Five: **not until 2026 lineup archive/materialize**  
* Advanced / Season Role / Timeline: **not until those jobs exist for 2026**

A 2026 Final can be a **Box-only** research page quickly; Explorer v2 completeness is **next-day / later**.

---

## Advanced Readiness

Serving table exists for 2023–2025 (~34.8k rows/season). **No 2026 rows. No live Lambda.** Archive script + materializer are season-allowlisted.

Recommend: **overnight postgame**, not game-night polling. Extend allowlist only after S3 `entity=advanced_stats` for `season=2026` exists.

---

## Role Profile Refresh Readiness

Season-grain. Refresh from Season Averages archive/materialize.

Recommend **weekly** (or after each completed week), not per game. Nightly already rebuilds compact `player_season_averages` from box; Role Profile needs GOAT playtype/tracking averages — **periodic batch**, not 82× cost.

---

## Plays / Timeline Readiness

2025 Timeline is postgame S3 Plays + `game_flow`. **No live Plays Lambda.** Pagination: 2025 archive used the certified Plays client (no live product pagination worker).

**Recommend postgame archive, not live PBP**, unless product later requires in-game Timeline. Possession/WOWY still deferred.

---

## Rate Limit / Concurrency Audit

| Item | Finding |
| --- | --- |
| Trial limiter | `lib/balldontlie/trial-limiter.ts`: concurrency 1, ≥12s, default 13s when `BDL_TRIAL_MODE=1` |
| Used by Lambdas? | **No** — archive client only |
| Lambda delays | Nightly/odds/injuries ~200ms local; props 429 → 5s infinite |
| Distributed throttle | **None** |
| Props reserved concurrency | **Unwired** → SQS can scale many workers, each hitting BDL |

**BLOCKER:** multiple Lambdas (nightly + odds + injuries + N props workers) + optional Vercel schedule refresh can independently exceed GOAT quota even if each process “has a limiter.”

Do **not** loosen 200ms or drop trial 12s without a measured budget and a **global** token bucket / serialized queue.

### Recommended cadence (not activated)

Assume ~10-game slate, **one BDL request per game** for props (all books in payload):

| Feed | Cadence | Est. req/day |
| --- | --- | --- |
| Player props | Every **30 min** 11:00–23:30 ET (not 24h `rate(30 minutes)`) | ~10 × 25 ≈ **250** |
| Game odds | Every **30 min** same window (today+tomorrow pages ~2–4) | **~80–100** |
| Injuries | 3× daily + extra game-day morning | **~15–25** |
| Schedule | Nightly + on-request today-only | **<10** |
| Nightly stats | Finals that night | **~20** |
| **Total** | Staggered | **~400/day** |

24h props `rate(30 minutes)` on 15 games ≈ **720 props-only** — avoid until quota proven.

Initial live: **serialize BDL** (effective concurrency 1 across families) until 429 rate is ~trial-like. Then consider 1 req / 1–2s global.

---

## Database / S3 Capacity

Postgres **368 MB** total. Largest: `raw.player_game_stats` 85 MB, `raw.odds_snapshots` 39 MB, PGL 35 MB, prop history 28 MB, advanced 25 MB, injuries raw 24 MB.

| 2026–27 growth | Estimate | Risk |
| --- | --- | --- |
| Core logs / team stats | ~12–15 MB / season | Low |
| Starters / Role / game_flow | <5 MB if serving-only | Low |
| Advanced serving | ~25 MB / season | Low |
| **Current** props/odds boards | Compact if upserted | Low |
| **History** polls in Postgres | High if 30-min ticks retained all season | **True risk** |

**S3 remains deep/raw history.** Do not move Plays/Advanced/opening snapshots into Postgres.

### S3 2026 archive convention (no writes in 13A)

`{NBA_RAW_PREFIX}/source=balldontlie/league=nba/season=2026/entity={advanced_stats|lineups|plays|season_averages|opening_player_props|opening_game_odds}/...`

Skip-existing, version by `game_id` object. Reference snapshots: write-once keys, never overwrite.

---

## Freshness / Observability

| Field | Present | UI “Updated N min ago” |
| --- | --- | --- |
| `snapshot_at` | props/odds/injuries current | Almost never relative; Props Explorer uses locale string |
| `fetched_at` | raw snapshots / pull runs | Ops only |
| `source_updated_at` | **Missing** | — |
| Fake copy | BettingInsights `"Updated 2m ago"` | Not data-driven |

Health: `GET /api/ops/health`, `/ops` UI, `npm run ops:health-snapshot`. Pull-run tables for props/odds/injuries. Schedule + boxscore **untracked**. Alarms visibility-only (no SNS in Terraform). Frozen ingest is `FROZEN_EXPECTED`, not failure.

### Minimal live-season observability (do not build a platform)

1. Job did not run (Scheduler/EventBridge invoke count + `pull_runs` gap)  
2. Provider returned **zero** on a date with Scheduled games  
3. 429 spike (CloudWatch metric / log filter)  
4. **3-Hour reference missing** within 2h of tip (new check — none today)  
5. DB write failure (Lambda Errors + DLQ depth)  
6. Stale props (>12h) / odds (>24h) / injuries (>36h) — thresholds already in `LIVE_INGEST_STALE_HOURS`

---

## Failure Isolation

| Failure | Product behavior (recommend) |
| --- | --- |
| Props job | Explorer/matchup props empty or last `snapshot_at`; **do not** 500 the game page |
| Odds job | Hide charts / “lines unavailable”; keep score/schedule |
| Injury job | Hide badges if stale; never show May-2026 as current |
| Lineup job | Analytics projected fallback; label Projected |
| Postgame Advanced | Box still ships; Advanced hidden via availability flags |
| Plays | Timeline absent; Final page remains Box-capable |

Fail-closed per module. Site shell + Dashboard date list must survive any single enrichment outage.

---

## Live Product Readiness

2026 Scheduled page (`21717855` class) **already renders** from replay Postgres: date, normalized Scheduled, records, AI Projection UI, Odds & sentiment, Matchup, Projected starters, props CTA.

| Surface | Replay today | After thaw |
| --- | --- | --- |
| AI Projection | Entitlement + on-page signals; offseason briefing copy | Same; quality follows injuries/odds/lineups |
| Odds | Last stored DK current (May 2026) if any | Live `game_odds_*` |
| Sentiment | **Illustrative / not live** | Still unfinished — **not** a live-data blocker; do not imply live crowd |
| Projected starters | Analytics fallback; BDL lineups only if matchup-analysis thawed | Real BDL lineups |
| Injuries | Filtered `not_current` while frozen | Latest board if fresh |
| Props | `player_props_current` empty → Explorer link | Multi-book current **if Stage 4 works** |
| Historical modules | Hardcoded off on live path | Correct |

Launch blockers once users land: **stale/empty markets**, **sentiment looking live**, **pin still 2025 on team/default season pages**, **no freshness clock**. Sentiment is SHOULD (hide or label). Markets are BLOCKER for a betting product.

---

## GOAT Subscription Recommendation

Reassessment of `REASSESS_AT_LIVE_ACTIVATION`:

**Recommend `KEEP_GOAT_DURING_SEASON` before any live props/odds thaw.** Historical archives cannot reconstruct pre-tip boards.

| Dataset | Class |
| --- | --- |
| Live / pre-tip player props (`/v2/odds/player_props`) | **Definitely required** |
| Live game odds (`/v2/odds`) | **Definitely required** |
| 3-Hour reference capture (same props endpoint, tip-timed) | **Definitely required** for live MM |
| Schedule `/v1/games` | **Likely required** (plan-dependent; key already used) |
| Lineups `/nba/v1/lineups` | **Likely required** if Projected starters stay productized |
| Box `/v1/stats` | **Likely required** (ALL-STAR vs GOAT — confirm plan) |
| Advanced `/nba/v2/stats/advanced` | **Optional** until 2026 Advanced serving |
| Season Averages playtype/tracking | **Optional** / weekly batch |
| Plays `/nba/v1/plays` | **Optional** postgame; **historical-only** until 2026 Timeline |
| Opening Snapshot game-odds window | **Historical-only** (March cliff); do not expect season-wide opening odds |

Do not purchase/change in 13A. Do not assume GOAT trial 5 rpm still applies; **measure** after a serialized canary.

---

## Opening-Day Checklist

Executable before the first 2026–27 regular-season slate (2026-10-20 in current seed):

1. **GOAT** access confirmed for props + odds (and games/stats/lineups as classified).  
2. **Secrets present (names only):** `BALLDONTLIE_API_KEY`, `SUPABASE_DB_URL`, AWS Lambda env freeze triad, `NBA_DATA_BUCKET` / `NBA_RAW_PREFIX` if prune/archive, `CRON_SECRET`.  
3. **Umami:** confirm Vercel `NEXT_PUBLIC_UMAMI_WEBSITE_ID` + `NEXT_PUBLIC_UMAMI_SRC` (repo: **unconfigured / unknown in prod**).  
4. **2026 schedule:** recertify count vs 1,230; **canonical status** not ISO timestamps; provider IDs join 30 teams; no duplicate `game_id`.  
5. **Pin:** `CURRENT_ANALYTICS_SEASON=2026` only after 2026 games are queryable and empty-state copy is acceptable.  
6. **Identity:** 81 Class C watchlist; onboarding path tested on **one** BDL-new player (no fake ids).  
7. **DB:** 368 MB baseline; prune `PRUNE_ENABLED` still **0**.  
8. **Rate limit:** global serialize proven; props `reserved_concurrency` **wired**.  
9. **AWS:** schedules still off except the certified canary family.  
10. **Current props:** `player_props_current` non-empty for **one** upcoming game, ≥2 allowlist books.  
11. **Game odds:** `game_odds_current` snapshot_at today.  
12. **Injuries:** snapshot_at < 36h.  
13. **Lineups:** Projected labeled; certified starters **not** claimed.  
14. **MM reference:** job exists and captured for the canary game (or explicitly deferred with product copy).  
15. **Postgame:** one historical Final path still works (2025) after any 2026 job.  
16. **Observability:** `/ops` shows live ingest not `FROZEN_EXPECTED`; 429 and zero-row checks watched.  
17. **Rollback switches** documented and tested in staging/canary env.

---

## Rollback Plan

Prefer **stop writes**, never delete.

1. Set the misbehaving Lambda env `CRON_DRY_RUN=1` (or `OFFSEASON_MODE=1`) — freeze defaults already merge in Terraform.  
2. `*_enable_schedule = false` / disable Scheduler (ops action, not 13A).  
3. Vercel: keep or restore `DATA_MODE=replay`, `CRON_DRY_RUN=1` so Dashboard does not call BDL.  
4. `DISABLE_BDL_LIVE_SCHEDULE_REFRESH=1` as extra kill switch.  
5. `PRUNE_ENABLED` stays 0.  
6. UI: existing stale/unavailable copy; do not wipe `analytics.games` or MM historical tables.

---

## Production Flag Sequence

**Never** set `DATA_MODE=live_api` + `OFFSEASON_MODE=0` + `CRON_DRY_RUN=0` on **all** Lambdas and Vercel in one step.

Safest future order:

0. Credentials only. Schedules **off**. Pin stays **2025**.  
1. Wire limiter + reserved concurrency (13B).  
2. **One** Lambda manual invoke with that function’s env thawed; others frozen.  
3. Enable **that** schedule only.  
4. Repeat per family (schedule → injuries → odds → props).  
5. Flip `CURRENT_ANALYTICS_SEASON=2026` when 2026 slate is canonical.  
6. Thaw Vercel last (`CRON_DRY_RUN=0`) so on-request schedule refresh and paper-settle start.  
7. `PRUNE_ENABLED=1` only after S3 archive gate is proven.

Other kill switches: `DISABLE_BDL_LIVE_SCHEDULE_REFRESH`, `DISABLE_BDL_SCHEDULE_SYNC`, `BDL_TRIAL_MODE`, `PRUNE_ENABLED`.

---

## Go / No-Go Criteria

### GO (full live automation)

* 2026 IDs recertified; statuses canonical; count explained vs 1,230  
* Rate limiter proven under **concurrent** job families  
* `player_props_current` has target book coverage (v1 allowlist ≥2 books) on canary slates  
* Reference snapshot job tested (if MM is in scope for opening week)  
* Ingest alerts distinguish frozen vs missed run  
* No unresolved **critical** identity (veteran maps intact; Class C policy documented)

### NO-GO

* Concurrent Lambdas still unbounded vs BDL  
* Current board still empty or DK-only **and** product claims multi-book MM  
* Missing reference scheduler while marketing 3-Hour → Current  
* Provider quota insufficient (sustained 429s)  
* Fake BDL ids proposed as the rookie fix  
* Analytics pin flipped to 2026 while 2026 averages/logs still 0 **and** empty dashboards are unacceptable

---

## Blockers Ranked

### BLOCKER (must fix before live HTTP / full thaw)

1. **No distributed BDL throttle; props reserved concurrency unwired**  
2. **No live 3-Hour reference capture** if opening-week Market Movement is in scope  
3. **`analytics.player_props_current` empty** — multi-book live board not proven  

### REQUIRED (staged activation can begin after BLOCKER-1)

4. **2026 `status` stored as timestamps; 1,200 vs 1,230 games** — recertify before trusting Final/In Progress  
5. **Season pin still 2025** — flip only after 2026 seed is certified  
6. **Class C (81) onboarding path** when BDL ids appear — no unsafe bridges  
7. **DK-only `player_prop_current` / `game_odds_current`** — do not call this “the market”  
8. **Tip-relative scheduler** (3h pre-tip + close) vs wall-clock crons  
9. **Game-odds MM date CHECK** still March 2026 window — live dates need a later serving design  

### SHOULD

10. Injuries + Lambda Errors alarms; schedule/boxscore pull-run tracking  
11. Relative freshness UI; remove fake “Updated 2m ago”  
12. Sentiment labeled or hidden (not live)  
13. Document `DISABLE_BDL_LIVE_SCHEDULE_REFRESH` in `.env.example`  
14. Umami production vars confirmation  

### LATER

15. 2026 Advanced / Role / Plays / certified Starting Five jobs  
16. Injury-as-of  
17. Possession / WOWY  
18. Game-odds Opening Snapshot season-wide  
19. Explicit History nav  
20. Free/Pro live MM packaging (see below)

---

## Free / Pro Live Behavior

Historical MM: Free = close consensus; Pro = 3-Hour → Close + books.

**Future live contract (do not implement):**

| Plan | Before tip | After close |
| --- | --- | --- |
| Free | Current consensus only | Close consensus |
| Pro | 3-Hour → **current** + per-book | 3-Hour → **close** + per-book |

Do not show Free users a 3-Hour move until Pro entitlement. Same sanitize helper can branch on `comparison_kind` once `live_current` exists.

---

## Credentials / Secrets (names only)

Expected: `BALLDONTLIE_API_KEY` (typo alias `BALDONTLIE_API_KEY`), `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_*`, freeze triad, `CRON_SECRET` / `PAPER_SETTLE_CRON_SECRET`, `OPENAI_API_KEY`, Stripe vars, `NBA_DATA_BUCKET`, `NBA_RAW_PREFIX`, `CURRENT_ANALYTICS_SEASON`, `PREFERRED_VENDOR`.

**Umami:** `NEXT_PUBLIC_UMAMI_WEBSITE_ID`, `NEXT_PUBLIC_UMAMI_SRC` — **missing in repo / unknown in production**. Deployment follow-up, not a live-data blocker.

---

## Recommended Step 13B

**Centralized BDL rate limiting + wire `player_props_worker` reserved concurrency.**

Why this first: any canary that calls BDL is unsafe while nightly, odds, injuries, props workers, and Vercel schedule refresh can stampede independently. Identity must not be “fixed” with fake ids. Schedule/status certification needs a later **authorized** BDL canary (13C). Live props/MM need the limiter first.

Do **not** implement 13B in this step.

---

## Controlled Activation Sequence

| Step | Slice |
| --- | --- |
| **13B** | Global BDL throttle + reserved concurrency (no thaw) |
| **13C** | 2026 schedule/status certification canary (one date, dry-run then single thawed nightly invoke) |
| **13D** | Injuries + odds canary (one worker family at a time) |
| **13E** | Props `player_props_current` + Market Movement live snapshot pipeline |
| **13F** | Postgame box → later Advanced / starters / Plays |
| **13G** | Observability (reference-missed, 429, zero-row) + operational signoff |

Do not bundle thaw into one giant step.

---

## Possession / WOWY

**Not needed for season launch.** They remain differentiators after live operation is healthy. Historical Explorer + prop MM already provide research depth. Launch risk is current-season refresh, not possession math.

---

## Product Readiness Matrix

| Surface | Status | Evidence |
| --- | --- | --- |
| Historical product | **READY** | 12I `SHIP_READY`; 2023–2025 serving |
| Market Movement historical | **READY** | v1 `SHIP_READY`; 21,132 `decision_close`; `live_current`=0 |
| Live schedule / game experience | **PARTIAL** | 1,200 2026 games; UI Scheduled; raw status ISO; 30-game gap |
| Live markets | **BLOCKED** | `player_props_current`=0; DK-only legacy; no 3h job; freeze |
| Live injuries | **PARTIAL** | Lambda+schema; snapshots May 2026; freeze → `not_current` |
| Postgame enrichment | **PARTIAL** | Nightly/BBRef exist; 2026 Advanced/Role/Plays/starters scripts not live |
| Operations / monitoring | **PARTIAL** | `/ops` + CW Errors; no distributed limiter; no reference-missed check |

---

## What 13A did NOT do

No BDL acquisition/testing calls, production flag edits, Lambda deploys, EventBridge changes, DB migrations, S3 writes, serving-table writes, live polling, WOWY, possessions, or UI redesign.

---

## Verification Checklist

1. `.env` still `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`.  
2. `analytics.games` season 2026: 1200 rows, 0 canonical statuses.  
3. `analytics.player_props_current` still 0.  
4. `infra/lambda.tf` `player_props_worker` still has no `reserved_concurrency`.  
5. No new GOAT purchase / no Terraform apply from this step.  
6. 2025 Historical Final (`18447937`) still loads (activation audit did not touch serving).  
7. Class C count still 81 entities without BDL maps — no fake ids added.

---

## Step Verdict

`YELLOW — activation path is viable but blockers must be resolved first`
