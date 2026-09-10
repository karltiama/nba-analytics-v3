# 2026–27 Injuries + Game Odds Canary — Step 13D

**Step verdict:** `YELLOW — canary works but feed/schema issue must be resolved before activation`

**Date:** 2026-09-10  
**Scope:** One-shot injuries + game-odds reads through the shared Dynamo limiter, dry-run production transforms, First Observed contract tests. No recurring schedules, no props, no Market Movement UI, no season-pin flip, no 13E.

Live JSON: `reports/operations/2026-27-injuries-game-odds-canary-live.json`

---

## Safety / Scope

| Gate | Before | After |
| --- | --- | --- |
| `live_ingestion_enabled` | `false` | `false` |
| Recurring schedules | all DISABLED | **all DISABLED** |
| Lambda freeze | `replay` / `1` / `1` | unchanged (not thawed) |
| `PINNED_ANALYTICS_SEASON` | `2025` | **2025** |
| Props / MM player capture | off | **off** (no `/odds/player_props`) |
| Postgame Advanced/Plays/Role | off | **off** |
| Rookie writes | off | **off** |
| Canary persistence | n/a | **dry-run only** (refuses `--persist`) |

Canary was an explicit CLI invoke. No EventBridge/Scheduler thaw.

---

## Canary Execution Architecture

```
scripts/ops/2026-injuries-odds-canary.ts
  → fetchBdlLive (env override live_api / 0 / 0 for this process only)
  → Dynamo table nba-bdl-rate-limit (13s / burst 1)
  → BDL
  → production planners (planInjuryIngest, applyGameOddsObservation)
  → dry-run JSON
```

Lambda environment was **not** changed from replay. Handlers skip BDL while frozen, so the smallest harness reuses `fetchBdlLive` + the same transforms.

---

## Shared Limiter Verification

| Phase | Grants | Wait max | 429 | Retry-After |
| --- | --- | --- | --- | --- |
| Injuries | 1 | 0 ms | 0 | none |
| Game odds | 1 | **12220 ms** (~13s) | 0 | none |

Interval was not raised. No load test. Sibling spacing proves the global bucket, not fail-open.

---

## BDL Entitlement Status

**`BDL_ENTITLEMENT_REQUIRES_ACCOUNT_CONFIRMATION`**

| Endpoint | Live 13D | BDL docs tier |
| --- | --- | --- |
| `GET /v1/games` (13C) | 200 | Free+ |
| `GET /nba/v1/player_injuries` | **401 Unauthorized** | All-Star or GOAT |
| `GET /v2/odds` | **401 Unauthorized** | GOAT |

A 13s success on games does **not** certify paid GOAT. 401 on injuries/odds is consistent with a key that can read games but not All-Star/GOAT feeds. No rate increase. No keys printed.

---

## Injury Worker Audit

| Item | Production |
| --- | --- |
| Worker | `lambda/injuries-snapshot` |
| Endpoint | `GET /nba/v1/player_injuries?per_page=100` + `cursor` |
| Filters | none (full current board) |
| HTTP | `fetchBdlLive` worker `injuries-snapshot` |
| Raw | `raw.injury_pull_runs`, append-only `raw.player_injuries` |
| Analytics | `player_injury_status_current` PK `player_id`; history on meaningful change |
| Natural key | BDL player id → `analytics.players.player_id` (no name matching) |
| Status | stored as provider text |
| Timestamps | **no provider updated_at**; `snapshot_at` = row `created_at` / pull time |
| Stale rows | delete from current when absent **only if** completeness gate passes (≥50 and ≥50% of prior complete pull); else `massClearBlocked` |
| Leave-report | `RemovedFromReport` history, not Available |
| Product | **latest/current board only** — not injury-as-of |

Unmapped players are stored raw and **dropped at transform**; the job does not fail.

---

## Live Injury Canary

| Metric | Value |
| --- | --- |
| HTTP | 1 attempt, **401**, 0×200 |
| Records | 0 |
| Pagination | 1 page then stop (fail isolation) |
| Teams / player IDs | none (unauthorized) |

Provider payload for this canary is empty because of entitlement, not because the board is empty.

---

## Injury Status / Freshness Semantics

**Ingest does not invent a taxonomy.** UI `normalizeAvailabilityStatus` maps known labels and preserves unknowns.

Last successful **current** board in Postgres (read-only; stale offseason snapshot, not this canary):

| Provider status | Current rows |
| --- | --- |
| Out | 121 |
| Questionable | 22 |
| Out For Season | 3 |
| Doubtful | 2 |
| Probable | 2 |

Raw history in this corpus: same five strings only. **No** `Available` or `Day-To-Day` observed in stored pulls.

**Freshness field for live UI later:** `analytics.player_injury_status_current.snapshot_at`  
Semantics: **Court Context observed/fetch time**. Do not imply the player's injury *changed* at fetch time. BDL injury rows have no source `updated_at`.

---

## Injury Identity Coverage

| Item | Notes |
| --- | --- |
| Mapping | BDL `player.id` as text vs `analytics.players.player_id` |
| Live unmapped | n/a (0 live rows) |
| Current table | 150 rows; 5534 analytics players |
| Rookies / Class C | do not fabricate mappings; skip row |
| Job failure | per-row skip; full job continues |

---

## Injury Transform / Dry Run

Live dry-run on 0 rows: inserts/updates/unchanged 0; `massClearBlocked=true` (`pull stored zero rows`) — **no deletes**. Completeness gate would have blocked a wipe even if we had persisted.

Optional write: **not performed**.

---

## Game Odds Worker Audit

| Item | Production |
| --- | --- |
| Worker | `lambda/odds-pre-game-snapshot` |
| Endpoint | `GET /v2/odds?dates[]=<ET date>&per_page=100` |
| Dates | today + tomorrow ET |
| HTTP | `fetchBdlLive` worker `odds-pre-game-snapshot` |
| Vendors | all books in payload; **current** table keeps `PREFERRED_VENDOR` (default `draftkings`) |
| Shape | one wide row: ML home/away, spread home/away + prices, total + over/under |
| Raw | append `raw.odds_snapshots` |
| Current | upsert `analytics.game_odds_current` PK **`game_id` only** |
| History | append `game_odds_history` unique `(game_id, vendor, snapshot_at)` |
| Summary | `game_line_movement_summary` open vs current (preferred vendor) |
| Games | **not created**; unknown `game_id` dropped at analytics transform |
| Opening Snapshot MM | `game_odds_market_movement` — **not written** by this worker |

`snapshot_at` currently prefers `provider_updated_at` else ingest now. First Observed must be grounded in **our** capture (`created_at` / `observedAt`).

---

## Live Game Odds Canary

| Metric | Value |
| --- | --- |
| Dates queried | 2026-09-10, 2026-09-11 ET |
| HTTP | 1 attempt, **401**, 0×200 (stopped after first date) |
| Rows / games / books | 0 |
| Coverage | **`NO_CURRENT_MARKET`** |

September emptiness would have been valid; **401 is not emptiness**. It is unauthorized.

---

## Moneyline Semantics

Certified from production schema + last `game_odds_current` rows (historical, not this canary):

- One record per game (preferred vendor) with **both** `home_moneyline` and `away_moneyline` as American integers.
- Do not invent the opposite side if the provider omits it (`applyGameOddsObservation` allows one-sided ML).
- Sample: home -850 / away +575; home +110 / away -130.

---

## Total Semantics

- `total` line + `over_odds` / `under_odds` on the same row.
- Sides are independent fields; missing over or under is allowed.
- Usable as soon as a finite total exists — do not wait for spread/props.
- Historical current table: 334/334 rows had a total (that corpus). Live 13D: none.

---

## Spread Semantics

- `home_spread` / `away_spread` with opposite signs (e.g. -13.5 / +13.5) plus American prices.
- Sign is provider-passed, not derived.
- Spread must not block First Observed of ML/total.

---

## Sportsbook Coverage

| Source | Classification |
| --- | --- |
| Live 13D | **`NO_CURRENT_MARKET`** (401) |
| Historical `game_odds_history` | many books (DraftKings, FanDuel, BetMGM, Caesars, …) — that is **not** live consensus |

Do not call single-book data consensus. Books are independent: a late FanDuel row gets its **own** First Observed.

---

## First Observed Contract

Label: **First Observed** — earliest line Court Context captured from this sportsbook through the feed. **Not** “Opening Line”. Distinct from historical Opening Snapshot.

Tests: 224.5 → 225 → 226 keeps FO=224.5, Current=226. A later book does not inherit another book’s timestamp.

Production summary SQL now **freezes** `open_*` / `first_seen_at` with `COALESCE` so Current cannot rewrite First Observed. Not terraform-applied in 13D (schedules stay disabled).

---

## Current Contract

Latest valid quote per `game + vendor + market`. Preferred-vendor convenience table remains `game_odds_current` (one book). Per-book current lives in `game_odds_history` (latest `snapshot_at` / `created_at` per vendor).

---

## Close Contract (design only)

> Last valid supported sportsbook snapshot captured **before** the game is In Progress or at/after tip (`analytics.games.start_time` + status).

`certifyGameOddsClose` refuses In Progress / Final / past tip. Current polls must not overwrite Close. Live tables have **no close column**; `game_odds_market_movement.comparison_kind = last_pre_tip_history` is historical Opening Snapshot MM and must not be rewritten as live Close. **Prerequisite for activation:** freeze Close separately (or add a close snapshot) without mutating Opening Snapshot rows.

Do not build the Close scheduler in 13D.

---

## Schema Fit

| Need | Fit |
| --- | --- |
| First Observed + Current (preferred vendor) | Reuse `game_line_movement_summary` **if** open_* stays frozen (COALESCE now in worker SQL) |
| Per-book First Observed | Derive from `game_odds_history`; do not wait for all books |
| Close | **Not first-class** on live odds tables — prerequisite, not a new MM table |
| Historical Opening Snapshot | Keep separate; do not backdate live FO onto it |

No broad new market schema in this step. No writes to `game_odds_market_movement`.

---

## Odds Transform / Dry Run

Live: 0 rows, 0 inserts, coverage `NO_CURRENT_MARKET`. Fixture/unit path covers ML/total/spread, partial markets, unknown game skip, malformed isolation.

Unknown game IDs: skip/fail-safe; schedule ingestion remains authoritative.

---

## Optional One-Shot Persistence

**None.** Injuries 401 + completeness-blocked empty pull; odds 401 / no markets. Zero placeholders.

---

## Request Budget

At **13s / burst 1**, injuries + game odds only (no props):

| Cadence | Injury req/day | Odds req/day | Wall time @ 13s |
| --- | --- | --- | --- |
| 3× injury, 2 odds dates, 4 discovery cycles/day | 6 (if 2 pages) | 8 | ~3 min |
| Plus denser `<12h` refresh (example in tests) | 6 | 92 | ~21 min |

**Viable for these two feeds** once HTTP is 200. Not viable while 401.

Staged discovery (do **not** enable): >24h low frequency → 12–24h moderate → <12h regular → <3h higher-value. Volume is small vs 13s because odds is dates[] not per-game.

---

## Failure Isolation

Certified:

- Injuries 401 did **not** skip the odds request.
- Unmapped injury rows skip; job continues.
- Unknown/malformed odds rows skip; other books/games continue.
- Completeness gate blocks mass injury delete on empty/partial pulls.

Future: injuries stale ↛ odds down, and the reverse.

---

## Freshness Contract (no UI)

| State | Injuries | Game odds |
| --- | --- | --- |
| Fresh | `snapshot_at` within serving SLA (`INJURY_FRESHNESS_HOURS`, default 36h) **and** not frozen | `game_odds_current.updated_at` / last history `created_at` within poll SLA |
| Stale | snapshot older than SLA | last observation older than SLA |
| Unavailable | never captured / 401 / freeze | `NO_CURRENT_MARKET` |

Frozen replay serving already treats injury current as non-authoritative.

---

## Canary HTTP Accounting

### Injuries
1 grant, 0×200, **1×401**, 0×429, 0 retries, 823 ms

### Game odds
1 grant, 0×200, **1×401**, 0×429, wait 12220 ms, 12757 ms elapsed

All via shared limiter. Counts are not combined.

---

## AWS Freeze Verification (after canary)

nightly, injuries, odds, boxscore EventBridge: **DISABLED**  
props Scheduler 0: **DISABLED**  
`live_ingestion_enabled=false`

---

## Tests Added

- `lib/injuries/__tests__/canary-board.test.ts` — mapped/unmapped, status preserve, freshness field, dry-run, idempotent current, null status, no injury-as-of
- `lib/betting/__tests__/game-odds-lifecycle.test.ts` — ML/total/spread, FO immutability, per-book FO, partial market, one/multi/no book, malformed/unknown game, Close protection, request budget
- `lib/betting/__tests__/game-odds-fo-sql.test.ts` — COALESCE freeze; no MM/props writes

---

## Test Results

`npx vitest run` on the 13D files: **27 passed** (plus existing ingest-plan tests).

---

## Remaining Blockers

1. **BDL 401 on injuries and game odds** until the account is All-Star (injuries) and GOAT (odds). This blocks controlled **activation**, not transform design.
2. Live Close is design-only; do not activate a Close job until a freeze target exists that is not Opening Snapshot MM.
3. Lambda COALESCE FO freeze is in git, not applied to AWS in 13D.
4. Lambda quota 20 remains **`NOT_REQUESTED`** (not a 13D success criterion).
5. Props reserved concurrency still unapplied (13E).

---

## Recommendation for Step 13E

**Do not start 13E.** Player props also require GOAT. Confirm paid GOAT in the BDL dashboard, keep the 13s operating rate until an explicit rate plan, then start:

**13E — live player-props current board + 3-Hour Pre-Tip / Current / Close Market Movement pipeline**

Game-level First Observed → Current → Close is the model 13E should **not** overwrite with a single snapshot type.

---

## Verification Checklist

1. Confirm EventBridge + props Scheduler still DISABLED.
2. Confirm Lambda env still `replay` / `1` / `1`.
3. Confirm pin is 2025.
4. Re-run `npx vitest run lib/betting/__tests__/game-odds-lifecycle.test.ts lib/injuries/__tests__/canary-board.test.ts`.
5. Confirm BDL dashboard tier before any live injuries/odds write.
6. Do not set `live_ingestion_enabled=true`.
7. Do not persist canary (`--persist` is refused).

---

## Step Verdict

`YELLOW — canary works but feed/schema issue must be resolved before activation`
