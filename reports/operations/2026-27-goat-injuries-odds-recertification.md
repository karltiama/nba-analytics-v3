# 2026–27 GOAT Injuries + Game Odds Recertification — Step 13D.1

**Step verdict:** `YELLOW — entitlement works but live feed/transform issue remains`

**Date:** 2026-09-10  
**Scope:** Re-run the 13D CLI canary after owner-confirmed NBA GOAT. Same production transforms, same Dynamo limiter, **13s** interval. No props, no schedule thaw, no season pin, no persistence.

Live artifact: `reports/operations/2026-27-goat-injuries-odds-recertification-live.json`

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| `live_ingestion_enabled` | `false` |
| nightly / injuries / odds / boxscore EventBridge | **DISABLED** |
| props Scheduler | **DISABLED** |
| Lambda freeze (injuries + odds) | `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1` |
| Lambda limiter env | `BDL_RATE_LIMIT_INTERVAL_MS=13000` |
| `PINNED_ANALYTICS_SEASON` | **2025** |
| Canary path | CLI only (`scripts/ops/2026-injuries-odds-canary.ts`) |
| Persistence | **none** (dry-run; `--persist` refused) |
| Player props / MM scheduler / postgame | **not invoked** |

---

## GOAT Entitlement Confirmation

Recorded as **`BDL_ENTITLEMENT_CONFIRMED_GOAT`** because the account owner confirmed NBA GOAT in the BALLDONTLIE dashboard **before this step**.

This is **not** inferred from HTTP 200. The recertification still received **401** on both entitled endpoints, so dashboard confirmation and this runtime key/path are **not yet aligned**.

No API keys, billing data, or secrets printed.

---

## Canary Rate

Activation-canary safety rate unchanged:

* `BDL_RATE_LIMIT_INTERVAL_MS=13000`
* burst 1
* Dynamo `nba-bdl-rate-limit`
* Retry-After global cooldown still in `fetchBdlLive`

Not raised toward 1 rps or 600/min.

---

## Injuries HTTP Result

| Field | Value |
| --- | --- |
| Endpoint | `GET /nba/v1/player_injuries` |
| Requests / grants | **1** |
| **200** | **0** |
| **401** | **1** (`Unauthorized`) |
| 429 | 0 |
| Retry-After | none |
| Retries | 0 |
| Elapsed | 623 ms |
| Limiter wait | 0 ms |

---

## Live Injury Payload

**Not inspected.** Zero rows because of 401, not because the board was empty.

Completeness gate on this empty pull: `massClearBlocked=true` (`pull stored zero rows`).

---

## Injury Transform Certification

Production transform (`planInjuryIngest` / identity skip) was dry-run on 0 live rows:

* inserts/updates/unchanged/skips: 0
* deletes: 0
* injury-as-of: **false**

Live payload shape (status / description / timestamps) **cannot** be certified from this recertification until 200.

Fixture/unit coverage from 13D still stands for mapped/unmapped/null/idempotent current.

**Freshness:** `snapshot_at` remains Court Context observed time. Live 401 did not reveal a provider `updated_at`.

---

## Injury Completeness Safety

Existing tests (still passing) require:

| Case | Deletes current board? |
| --- | --- |
| Complete successful pull | yes, only players absent from this pull |
| Partial (`rowsStored` << `rowsReturned`) | **no** (`massClearBlocked`) |
| Zero/error pull | **no** |
| Unmapped player | skip row; job continues |

This canary’s 401/zero pull would **not** mass-clear.

---

## Odds HTTP Result

| Field | Value |
| --- | --- |
| Endpoint | `GET /v2/odds?dates[]=2026-09-10` then stop |
| Requests / grants | **1** |
| **200** | **0** |
| **401** | **1** (`Unauthorized`) |
| 429 | 0 |
| Retry-After | none |
| Limiter wait | **12495 ms** (~13s after injuries) |
| Elapsed | 12973 ms |

**Classification: authorization problem (`UNAUTHORIZED`), not `NO_CURRENT_MARKET`.**

`NO_CURRENT_MARKET` is reserved for **HTTP 200 + zero rows**. This recertification did not get that.

---

## Live Odds Payload

**None.** No vendors, games, or prices.

---

## Moneyline / Total / Spread

Not certifiable from live 200 data in 13D.1.

Historical corpus and 13D unit tests still describe the wide-row American ML / total / spread shape. That is **not** live coverage.

---

## Sportsbook Coverage

**`UNAUTHORIZED`** for this canary.

Not `SINGLE_BOOK_ONLY`. Not `MULTI_BOOK_READY`. Not `NO_CURRENT_MARKET`.

Do not use historical `game_odds_history` vendor lists as live evidence.

---

## First Observed Certification

Live-shaped FO pass: **vacuous** (0 quotes).

Deterministic invariant remains covered by fixtures:

Observation A → FO A; B/C update Current; FO stays A. New vendor gets its own FO. Partial markets do not invent missing sides.

Production SQL freeze (`COALESCE` on `open_*`) is in the odds worker source; **not AWS-applied** in 13D.1.

Label remains **First Observed**, not Opening Line.

---

## Current / Close Protection

Current updates still must not rewrite FO (`COALESCE` + lifecycle module).

Close remains **design-only**. No Close scheduler. Current polling must not overwrite a certified Close. 13E owns player-prop 3-Hour / Current / Close separately.

---

## Optional Persistence

**Not performed.** 401 + empty completeness block + no live odds rows.

A 200/dry-run would have been enough for GREEN; we did not get 200.

---

## Request Accounting

### Injuries
1 request, 0×200, **1×401**, 0×429, 0 Retry-After, 0 retries, 623 ms

### Odds
1 request, 0×200, **1×401**, 0×429, 0 Retry-After, wait 12495 ms, 12973 ms

All grants went through Dynamo. Counts are separate.

---

## Lambda Quota Status

| Item | Value |
| --- | --- |
| ConcurrentExecutions (`L-B99A9384`) | **10** |
| Recommended | 20 |
| Request history | empty |
| Classification | **`NOT_REQUESTED`** |
| Props reserved concurrency | **unapplied** (not required for this step) |

---

## Freeze Verification (after canary)

All audited schedules **DISABLED**. Lambda freeze + 13s limiter env unchanged. Pin 2025. Canary did not alter infrastructure state.

---

## Remaining Blockers

1. **Runtime still 401s injuries and game odds** despite owner-confirmed GOAT. Likely the CLI/Lambda API key is not the entitled NBA GOAT key, or dashboard access has not attached to this key yet. Re-point the canary at the confirmed key **without pasting it into chat**, then re-run 13D.1-style 200 recertification.
2. FO SQL freeze not deployed to AWS (schedules remain disabled; not blocking a dry-run recert).
3. Close still design-only (expected).
4. Quota 20 still `NOT_REQUESTED` (not a 13D.1 success criterion).

---

## Recommendation for 13E

**Do not start 13E.** Player props also require GOAT HTTP 200. After this runtime key returns 200 on injuries and `/v2/odds`, 13D.1 can be re-run to GREEN, then:

**13E — live player-props current board + 3-Hour Pre-Tip / Current / Close capture**

Keep models distinct:

* Game odds: First Observed → Current → Close  
* Player props: 3-Hour Pre-Tip → Current → Close  

Keep the 13s canary rate until an explicit operating-rate plan. Do not probe 600/min.

---

## Verification Checklist

1. Confirm BALLDONTLIE dashboard GOAT is on the **same key** the CLI loads from `.env` (do not paste the key).
2. Re-run `npx tsx scripts/ops/2026-injuries-odds-canary.ts` and expect injuries/odds **200**, not 401.
3. If odds is 200 with zero rows, classify **`NO_CURRENT_MARKET`**, not unauthorized.
4. Confirm schedules still DISABLED and Lambda still `replay/1/1`.
5. Do not persist until 200 + completeness/FO checks are green.
6. Do not enable `live_ingestion_enabled`.
7. Do not start props.

---

## Step Verdict

`YELLOW — entitlement works but live feed/transform issue remains`
