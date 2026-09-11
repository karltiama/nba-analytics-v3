# 2026–27 Ingestion Observability Foundation — Step 13G.1

**Step verdict:** `GREEN — ingestion observability foundation is ready for live-season operations`

**Date:** 2026-09-10  
**Depends on:** 13R.3 identity adapter adoption (approved)

---

## Safety / Scope

Observability foundation only. Confirmed:

| Gate | Result |
| --- | --- |
| Schedule thaw | **none** (`live_ingestion_enabled=false`) |
| Season-pin flip | none (`CURRENT_ANALYTICS_SEASON` untouched) |
| GOAT canary | none |
| Props / odds / injury activation | none |
| BDL HTTP | **0** |
| S3 backfill | none |
| Historical Explorer | unchanged |
| Product FK migration | none |
| Possessions / WOWY | none |
| Monitoring-platform build | none (extended existing `/ops`) |
| Live job invocation | **none** |
| Identity quarantine seed | **none** |

No `ingestion_runs` table: injuries/odds/props already have pull-run tables; other families are MANUAL_ONLY / NOT_DEPLOYED. CloudWatch + `/ops` + CLI are enough.

---

## Existing Observability Audit

### AWS (already present)

- Lambda log groups for nightly, odds, injuries, props controller/worker, boxscore
- Errors alarms: nightly, odds, boxscore (injuries **added** this step)
- Props EMF: `NBA/PlayerProps` GamesFailed / GamesQueued
- SQS game queue + DLQ
- EventBridge + Scheduler `state = local.ingestion_schedule_state`
- DynamoDB BDL limiter table; `evt=bdl_throttle` JSON logs

### Application (already present)

- `/ops` + `GET /api/ops/health` (session auth, `robots: noindex`)
- `classifyIngestionSource` / injury snapshot freshness / archive manifests / prune coverage
- Pull-run tables: `raw.injury_pull_runs`, `raw.odds_pull_runs`, `raw.player_prop_pull_runs`
- `scripts/ops/2026-player-identity-quarantine-report.ts`
- `scripts/ops/platform-health-snapshot.ts`

### Identity (13R.3)

- `analytics.player_identity_unresolved`
- Gate accounting + events `identity_resolved|not_serving|unresolved|conflict`

**Not duplicated:** pull-run freshness, archive manifests, freeze flags, existing Errors alarms.

---

## Operational Health Model

Ten operator questions map to:

| # | Question | Signal |
| --- | --- | --- |
| 1–2 | Did it run / finish? | pull-run `status` / `completed_at`; Lambda Errors alarms |
| 3 | Expected volume? | `rows_stored` + volume gate (ACTIVE only) |
| 4–7 | Fresh / stale / identity? | per-feed SLA + quarantine counts |
| 5 | Provider errors? | bounded 401/403/429/5xx/timeout/malformed |
| 8 | Missed snapshot? | schedule intent vs AWS state; **missed-run metric alarm = 13G.2** |
| 9 | Queue backing up? | depth / age / DLQ (fixture or future AWS snapshot) |
| 10 | Isolated vs system-wide? | family cards; one feed cannot crash `/ops` (`safeSection`) |

**Config ≠ health:** FROZEN + no run = expected. ACTIVE + no run = UNAVAILABLE. GOAT missing while ACTIVE = BLOCKED, not FAILED.

---

## Ingestion Families

Catalog in `lib/ops/ingestion-observability.ts` (`INGESTION_FAMILY_CATALOG`).

| Family | Default config | Freshness source |
| --- | --- | --- |
| Schedule / nightly BDL | FROZEN | `analytics.games` 2026 `updated_at` / `start_time` |
| Injuries | FROZEN (GOAT required if activated) | `player_injury_status_current.snapshot_at` |
| Game odds | FROZEN (GOAT) | `game_odds_current.updated_at` |
| Props controller | FROZEN (GOAT) | `raw.player_prop_pull_runs.completed_at` |
| Props worker | FROZEN (GOAT) | current-board `snapshot_at` |
| BBRef boxscore | FROZEN | `bbref_player_game_stats` latest |
| Advanced | MANUAL_ONLY | `player_game_advanced.updated_at` |
| Starters / lineups | MANUAL_ONLY | `game_starters.updated_at` |
| Plays | MANUAL_ONLY | canonical S3 / game_flow timestamp |
| Role Profile | MANUAL_ONLY | `player_role_profile.updated_at` |
| game_flow | MANUAL_ONLY | `game_flow.updated_at` |
| Market Movement capture | NOT_DEPLOYED | 13E timestamps (not built) |

Inactive/manual jobs are **not** marked unhealthy.

---

## Run Accounting

Shared shape `IngestionRunResult` (`lib/ops/ingestion-run-result.ts`): job, status `success|partial|failed|skipped`, counts, timestamps, optional identity slice. Helpers only — workers not rewritten.

Existing pull-run tables remain the persisted run history for injuries/odds/props. No new Postgres operational table.

Retention: pull-run rows already exist; quarantine is encounter-based and unbounded-but-small. No archive job.

---

## Identity Observability

Per run (from 13R.3 accounting): resolved, not_serving_yet, unresolved, conflicts, quarantined.

`/ops` identity card: quarantine counts only (no provider ids in the web JSON). CLI quarantine report still lists recent ids for operators.

**Class C canonical = 81 does not alert.** Alert only when ingest writes quarantine / conflicts.

---

## Quarantine Visibility

- `/ops` Identity card
- `npx tsx scripts/ops/2026-player-identity-quarantine-report.ts` (unchanged CLI)
- `npx tsx scripts/ops/ingestion-health-report.ts` (compact health JSON)

Production quarantine remains **0**. Not seeded.

---

## Freshness Contracts

States: **FRESH / STALE / UNAVAILABLE / FROZEN / BLOCKED**.

SLA hours (ACTIVE only; test-certified, not a live thaw):

| Feed | SLA hours |
| --- | --- |
| Props | 12 |
| Odds | 24 |
| Injuries | 36 |
| Nightly / BBRef | 30 |
| Postgame Advanced / starters / Plays / game_flow | 36 |
| Role Profile | 168 |

Timestamps are the persisted columns listed in the family catalog. Unrelated rows are not used.

---

## Provider Error Accounting

Classifiers for 401, 403, 429, 5xx, timeout, malformed. **429 is distinct.** 401/403 while `BLOCKED_BY_SUBSCRIPTION` is BLOCKED, not a credential/outage/code failure.

Bodies are not stored.

---

## BDL Throttle Observability

Reuse `evt=bdl_throttle`. CloudWatch Insights snippets in `lib/ops/cloudwatch-queries.ts` (permits/wait/429/Retry-After via log fields). `/ops` does **not** query CloudWatch (failure isolation). CLI prints the query text for operators.

---

## Lambda / SQS Health

| Item | 13G.1 |
| --- | --- |
| Last invocation | CloudWatch (not on `/ops`; optional `OpsAwsSnapshot`) |
| Errors | existing + **injuries Errors alarm** |
| Timeouts / throttles | Lambda metrics (AWS console / Insights) |
| Schedule enabled | `live_ingestion_enabled` vs observed ENABLED/DISABLED |
| Queue depth / age / DLQ | snapshot-injectable; DLQ>0 is DEGRADED even while frozen |
| Reserved concurrency | configured default 4, **apply flag false** — reported as not applied when snapshot says so |

Frozen functions are not expected to run.

---

## Schedule-State Visibility

`/ops` freeze strip now includes `live_ingestion_enabled`.

Mismatch classifier:

- intended frozen + DISABLED → FROZEN_EXPECTED
- intended frozen + ENABLED → DEGRADED (accidentally on)
- intended active + DISABLED → FAILED
- intended active + ENABLED → HEALTHY
- AWS not queried → UNKNOWN (does not fail `/ops`)

Terraform state was **not** changed (still DISABLED).

---

## Subscription-Blocked State

GOAT-required families resolve to `BLOCKED_BY_SUBSCRIPTION` only when live ingest is enabled **and** `goatSubscriptionActive` is false. While freeze holds they stay **FROZEN**, not BLOCKED.

---

## Schedule Completeness

Certified 13C: **1200 published / 1230 expected RS / 30 unpublished**.

`/ops` reports local `analytics.games` season `2026` count vs 1200/1230. Matching 1200 is **HEALTHY** with reconciliation `PROVIDER_NOT_YET_PUBLISHED`. No alert on the 30 unpublished games. Local behind provider → DEGRADED.

Does not use the product season pin (still 2025).

---

## Postgame Readiness Contract

Not automated. Observable flags reserved for 13F:

`basic_box_complete` · `starters_certified` · `advanced_available` · `plays_archived` · `game_flow_built` · `role_current_enough`

---

## Market Snapshot Readiness Contract

13E not started. Reserved:

`game_discovered` · `first_odds_observed` · `three_hour_prop_snapshot_captured` · `current_board_fresh` · `close_captured` · `reference_missed`

---

## Ops Surface

Extended existing `/ops` + `/api/ops/health` with compact cards (not a redesign):

- freeze includes `live_ingestion_enabled`
- identity counts
- family config/freshness
- 2026 schedule completeness
- schedule intent vs AWS
- props queue/DLQ

Auth: session (`requireBettingAuth` / `/ops` HTML gate). No public AWS ids, keys, or quarantine player-id lists on the page.

A broken CloudWatch/AWS snapshot cannot take down `/ops` (AWS is optional). DB section failures become UNKNOWN.

---

## CloudWatch / Alerts

Added `nba-injuries-snapshot-errors` (`AWS/Lambda` Errors, `treat_missing_data=notBreaching`).

Changed props controller GamesQueued missing-data from **breaching → notBreaching** so frozen quiet periods do not page.

Missed-run-when-activated alarms: **13G.2** (requires activation-aware evaluation).

---

## Tests Added

| File | Cases |
| --- | --- |
| `lib/ops/__tests__/ingestion-observability.test.ts` | frozen, FRESH, STALE, UNAVAILABLE, BLOCKED, identity, partial, schedule mismatch, DLQ, 429, 1200/1230 |
| `lib/ops/__tests__/platform-health.test.ts` | identity quarantine visible; DLQ; freeze not red |
| `infra/__tests__/ingestion-alarms.test.ts` | injuries alarm; no breaching missing-data |

---

## Test Results

`npx vitest run lib/ops infra/__tests__/ingestion-alarms.test.ts lib/betting/__tests__/historical-timeline.test.ts lib/identity/__tests__/player-identity-class-c.test.ts`

**7 files, 67 tests, passed.** No BDL HTTP. No job invocation.

---

## Current Readiness Matrix

| Area | Grade | Reason |
| --- | --- | --- |
| Schedule | **FROZEN** | `live_ingestion_enabled=false`; 1200/1230 unpublished expected |
| Injuries | **FROZEN** | schedule disabled; GOAT would BLOCK if thawed without subscription |
| Game odds | **FROZEN** | same |
| Player props | **FROZEN** | controller/worker + queue idle expected |
| Identity | **HEALTHY** | quarantine 0; Class C 81 is census only |
| Postgame enrichment | **FROZEN** | MANUAL_ONLY scripts; 13F not started |
| Queue | **FROZEN** | AWS metrics not queried on `/ops`; reserved concurrency unapplied |
| BDL throttle | **FROZEN** | limiter idle; Insights query documented |
| Infrastructure freeze | **HEALTHY** | intended frozen + schedules DISABLED |

---

## Files Changed

- `lib/ops/ingestion-observability.ts`
- `lib/ops/ingestion-run-result.ts`
- `lib/ops/cloudwatch-queries.ts`
- `lib/ops/health-status.ts` (`BLOCKED`)
- `lib/ops/platform-health.ts`
- `lib/ops/__tests__/*`
- `app/ops/PlatformHealthView.tsx`
- `scripts/ops/ingestion-health-report.ts`
- `infra/monitoring.tf` (injuries Errors alarm; controller missing-data notBreaching)
- `infra/outputs.tf`
- `infra/__tests__/ingestion-alarms.test.ts`

---

## Remaining Blind Spots

- `/ops` does not call AWS (by design). Last Lambda invocation, live queue depth, and Scheduler describe require console / a future snapshot CLI (13G.2).
- Missed-run alarm while ACTIVE is not implemented (would be noisy if attached now).
- Nightly BDL has no pull-run table; freshness for that family is catalogued, not auto-queried beyond existing ingestion cards.
- `BDL_GOAT_SUBSCRIPTION` is an optional observability hint, default inactive; it does not purchase or detect the real dashboard tier.
- Props **raw** may contain unmapped ids; identity health watches quarantine, not raw.
- Controller GamesQueued alarm still will not detect a missed run while ACTIVE (13G.2).

---

## Recommended Next Step

**13F.1 — postgame automation orchestration audit/design.**

The health model now has family config, freshness SLAs, identity accounting, and a postgame status contract. Orchestration can be designed against those signals. Remaining CloudWatch last-invocation wiring is 13G.2 and is not required to start 13F design.

Do **not** start 13F.1, 13E, or live ingestion automatically.

---

## Verification Checklist

1. Confirm `live_ingestion_enabled=false` and no ingest Lambda was invoked.
2. Open `/ops` (signed in): freeze strip shows live_ingestion_enabled false; families FROZEN/MANUAL_ONLY; identity not alerting.
3. `GET /api/ops/health` still 401 without session.
4. Run the vitest command above; expect pass, no network.
5. Confirm production quarantine still 0 if you run the quarantine CLI (optional, read-only).
6. Confirm Terraform was not applied; injuries alarm exists in code only until next apply.
7. Do not treat 1200 vs 1230 as an incident.

---

## Step Verdict

`GREEN — ingestion observability foundation is ready for live-season operations`
