# 2026–27 game-status-sync operational signoff (Step 13C.4)

**Date:** 2026-09-11  
**Track:** Frequent game-status-sync activation — **closed**  
**Track status:** `OPERATIONALLY_SIGNED_OFF`  
**Step verdict:** `GREEN — game-status-sync is operationally signed off for the 2026–27 season`

This document is the production monitoring contract and operator runbook. It does **not** add ingestion behavior, activate another family, resume 13F, purchase GOAT, or start WOWY.

---

## Safety / Scope

Read-only reconfirm + documentation only. No Terraform apply. No AWS mutations. No BDL HTTP. No SQL writes. No `/ops` redesign. No product-pin change.

**Unchanged (must remain):**

| Item | Value |
|---|---|
| Cadence | `rate(15 minutes)` |
| Query window | Frequent: ET yesterday → tomorrow |
| Provider | BallDontLie `/v1/games` only |
| Status normalization | Existing canonical mapping (fixtures) |
| Final-preserve | Existing semantics (fixtures) |
| Target season | `STATUS_SYNC_TARGET_SEASON=2026` |
| Product pin | `PINNED_ANALYTICS_SEASON=2025` |
| Other family execution flags | All false / unset |
| Props ESM | Disabled |
| Postgame | Not created |
| GOAT | Inactive |

**Do not call:** `/v1/stats`, injuries, odds, props, lineups, Advanced, Plays.

---

## Current Production State

Reconfirmed 2026-09-11T05:01:22Z (read-only AWS + Terraform plan).

| Resource | State |
|---|---|
| Lambda `game-status-sync` | Exists, **Active**, last modified 2026-09-11T04:34:57Z |
| Scheduler `nba-game-status-sync-schedule` | Exists, **ENABLED** |
| Cadence | `rate(15 minutes)` |
| Target | Lambda `game-status-sync` |
| Scheduler Input | `{}` |
| Errors alarm `nba-game-status-sync-errors` | Exists, **OK**, `treat_missing_data=notBreaching` |
| Target season | `2026` |
| Family env (status-sync last-merge) | `DATA_MODE=live_api`, `OFFSEASON_MODE=0`, `CRON_DRY_RUN=0`, `LIVE_INGESTION_ENABLED=1` |
| Shared Dynamo limiter | Certified (13C.3A + 13C.3B grants `wait_ms=0`) |
| Real Postgres | Certified (canary + empty-slate scheduled runs) |
| Recurring polls observed | Two scheduler-originated runs (04:37:15Z, 04:51:47Z) |
| Typical BDL cost | 1 request/poll, max pages 1 |
| Global `live_ingestion_enabled` | `true` (tfvars; gitignored) |
| `game_status_sync_execution_enabled` | `true` |
| Other families | **FROZEN** |
| Nightly / odds 0–8 / injuries / BBRef / props 0–2 | **DISABLED** |
| Props ESM | **Disabled** |
| Postgame queue / worker | **Absent** (`NOT_DEPLOYED`) |

Certified activation state remains:

`GREEN — game-status-sync is safely active and observed in production`

---

## Terraform State / Plan

Full `terraform plan` (2026-09-11T05:01Z, no `-target`):

```text
No changes. Your infrastructure matches the configuration.
```

The active status-sync configuration is the **desired Terraform-managed state**, not manual AWS drift. Signoff is not YELLOW for plan cleanliness.

---

## Health Contract

Use existing 13G missed-run semantics (`lib/ops/ingestion-cadence.ts` + `classifyMissedRun` in `lib/ops/ingestion-observability.ts`). Do not invent a second health model.

Cadence config for `game_status_sync`: `intervalHours = 0.25`, `graceHours = 0.25`.

### HEALTHY

All of the following:

- Scheduler **ENABLED**
- Lambda **Active**
- Latest **expected** invocation (scheduler-originated) within **cadence + grace** (30 minutes)
- `/v1/games` request succeeds (HTTP 200)
- Provider errors = 0 for that run
- Query remains bounded (typical 1 page; never more than the hard cap of 3)
- Database operation succeeds (`ok: true`)
- No wrong-season writes (season ≠ 2026)
- Errors alarm **OK**
- Empty window (`fetched=0`) is HEALTHY when the 2026 ET window has no games (see Empty-Slate)

13G `classifyMissedRun`: invocation within interval+grace → `OK` / `HEALTHY`.

### DEGRADED

Recoverable, non-escalating unless it persists:

- One provider timeout/5xx, next scheduled run succeeds
- Temporary 429 handled by `bdl_throttle` (grant after wait / cooldown), then recovery
- Ops telemetry unavailable (`invocationQueried=false`) while Lambda continues (13G → `UNKNOWN`)
- Unexpected pagination increase to **2 pages** but still within cap
- Single missed invocation beyond cadence+grace while schedule remains ENABLED (13G `classifyMissedRun` overdue → `MISSED` / **DEGRADED**, not FAILED)

### FAILED

Stop treating as “wait and see”; disable or investigate immediately:

- Schedule **DISABLED** (or missing) while this family is expected active
- Repeated missed invocations across **multiple** cadence+grace windows
- Repeated provider failures (consecutive runs `ok: false` / non-200)
- Wrong-season mutation (any write with `season !== 2026`)
- Database connectivity repeatedly failing
- Uncontrolled request growth (persistent 3-page polls, or any attempt past cap)
- Terraform desired state and AWS actual state diverge after an unplanned manual change

### BLOCKED

Capability / authorization — **not** the same as FAILED:

- HTTP **401 / 403** on `/v1/games` (key invalid, plan restriction, or endpoint not authorized)
- Shared limiter table missing or IAM deny (cannot acquire token)

BLOCKED means “this family cannot legally proceed until capability is restored.” FAILED means “the system that should be running is misbehaving.” Do not conflate them.

---

## Cadence / SLA

| Parameter | Value |
|---|---|
| Schedule expression | `rate(15 minutes)` |
| 13G interval | 0.25 h |
| 13G grace | 0.25 h |
| Healthy maximum gap | **cadence + grace = 30 minutes** |

**Practical expectation:** the normal healthy maximum time between scheduler-originated successful polls is **30 minutes**, unless an AWS or BallDontLie incident is known.

EventBridge `rate(15 minutes)` is not wall-clock exact; observed gap on 2026-09-11 was ~14.5 minutes. Do not treat 14–16 minute jitter as DEGRADED.

`npm run ops:game-status-sync` is a **local** CLI. It is not the production poller. Do not use laptop dry-runs as SLA evidence.

---

## Empty-Slate Semantics

Mid-September frequent polling uses ET yesterday → tomorrow. That window currently has **no 2026 NBA games**.

> **Zero games in the current polling window is HEALTHY if the 2026 schedule has no games in that ET window.**

Do **not** treat `fetched=0` / `writes=0` as an ingestion failure by itself.

This distinction holds until preseason or regular-season dates enter the ET ±1 day window. Observed production proof: two scheduled runs with `games_fetched: 0`, `bdl_http_requests: 1`, `ok: true`.

---

## Season Lifecycle Expectations

No implementation change. Expected phases:

### Current offseason / distant slate

Typical: `fetched=0`, writes 0, 1 HTTP request, limiter grant. **HEALTHY.**

### Approaching scheduled games

When a 2026 game’s ET date falls in yesterday→tomorrow:

- Provider returns those games
- Mostly **unchanged** Scheduled rows (status already matches)
- Legitimate newly published games may **insert** (new `game_id`)
- Canonical `start_time` may update if provider datetime is more complete

### Game in progress

- Local status → In Progress (from Scheduled)
- Scoreboard fields update
- Polling still `/v1/games` only; still typically 1 request

### Game ends

- Transition to Final
- `became_final > 0` on that run
- Official scores updated
- **No postgame fanout** (13F not deployed; worker has no enqueue)
- Later stale provider payloads must **not** regress Final (Final-preserve)

---

## First Scheduled Game Watchpoint

**When:** the first actual nearby 2026 preseason/regular-season game enters the frequent ET window (local 2026 rows already exist from prior work, e.g. 2026-10-20 / 2026-10-22; the watchpoint is when **today±1 ET** intersects those dates — around **2026-10-19…23**, not now).

**Verify (read-only + logs, do not synthesize games):**

- [ ] Game appears in `games_fetched > 0`
- [ ] Canonical `start_time` is correct (ET-safe, not a naive UTC date-only)
- [ ] Scheduled normalization correct
- [ ] Score fields sane (null/0 as appropriate for not-started)
- [ ] No wrong-game insert/update (`game_id` / teams / date)
- [ ] BDL requests remain bounded (expect 1)

This is a **season observation checkpoint**, not an activation blocker. September emptiness does not make this signoff YELLOW.

---

## First In-Progress Watchpoint

**When:** the first real 2026 game enters live play.

**Verify:**

- [ ] Scheduled → In Progress
- [ ] Scoreboard updates on subsequent polls
- [ ] No excessive DB churn (unchanged polls stay `unchanged`, not rewrite storms)
- [ ] Status normalization matches fixtures
- [ ] Polling remains approximately **1 request/run**

Runbook only. No automation added in 13C.4.

---

## First Final Watchpoint

**Most important future observation.** Do **not** synthesize a Final now.

**When:** the first real 2026 game naturally becomes Final.

**Verify:**

- [ ] `became_final > 0` on the completing poll
- [ ] Local status is Final
- [ ] Official score matches provider
- [ ] A later stale/non-Final provider payload **cannot** regress it (Final-preserve)
- [ ] **No** postgame enqueue (no SQS, no worker invoke)
- [ ] **No** paid endpoint called (`/v1/stats`, lineups, etc.)

This is a **future production verification milestone**, not a 13C.4 blocker.

---

## Request Budget

Observed in production (13C.3B): **1 request/poll**, max pages 1, no 429.

| Guardrail | Rule |
|---|---|
| Typical | 1 request (`per_page=100`) |
| Soft review | Persistent **2–3** page polling → operator review (window too wide or data volume unexpected) |
| Hard cap | **3** pages (`STATUS_SYNC_FREQUENT_MAX_PAGES`) |
| Fail-closed | Page 4+ must not be requested (existing implementation) |

Do not change limits in this step. Limits were not changed.

---

## Limiter Monitoring

`bdl_throttle` (shared Dynamo table + `withBdlLimit`).

**Healthy:**

- `limiter_acquired: true`
- `limiter_granted: true`
- `limiter_wait_ms` low or 0
- No repeated 429 cooldown

**Investigate:**

- Repeated long waits
- Persistent provider 429
- Unexpected contention **while all other BDL families are frozen** (should be near-zero contention today)

Contention becomes more important after a future family is activated. Until then, unexpected waits are a signal of misconfiguration or a second unofficial caller.

---

## Database Mutation Boundary

Status-sync **owns** (season 2026 only):

- `analytics.games.status`
- Official score fields (`home_score`, `away_score`, period/time remaining as mapped)
- Canonical tip time (`start_time`)
- Legitimate **insert** of a newly published 2026 game

Status-sync does **not** own:

- Player game logs / PGL
- Team stats
- Players / identities
- Injuries
- Odds
- Props
- Starters
- Advanced
- `game_flow` / plays
- Postgame stages / queue

This is the production mutation boundary. Product surfaces remain on the **2025** pin and must not be assumed to read these 2026 heartbeat rows.

---

## Operator Commands

Read-only. Do **not** print secrets (`BALLDONTLIE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, full `Environment.Variables`). Prefer freeze keys and resource names.

From `infra/` (Windows PowerShell):

```powershell
terraform.exe --% plan
```

Expect: `No changes.`

AWS Scheduler:

```powershell
aws scheduler get-schedule --name nba-game-status-sync-schedule --query "{State:State,Expr:ScheduleExpression,Input:Target.Input,Fn:Target.Arn}"
```

Expect: `ENABLED`, `rate(15 minutes)`, Input `{}`.

Lambda (freeze keys only):

```powershell
aws lambda get-function-configuration --function-name game-status-sync --query "{State:State,DM:Environment.Variables.DATA_MODE,OS:Environment.Variables.OFFSEASON_MODE,DR:Environment.Variables.CRON_DRY_RUN,LIVE:Environment.Variables.LIVE_INGESTION_ENABLED,SEASON:Environment.Variables.STATUS_SYNC_TARGET_SEASON}"
```

Expect: Active; `live_api` / `0` / `0` / `1` / `2026`.

Latest logs (filter pattern already used in 13C.3B):

```powershell
aws logs filter-log-events --log-group-name /aws/lambda/game-status-sync --limit 20 --filter-pattern "game_status_sync_complete"
```

Confirm `trigger_kind":"scheduled"` (not `manual_canary`).

Errors alarm:

```powershell
aws cloudwatch describe-alarms --alarm-names nba-game-status-sync-errors --query "MetricAlarms[0].{Name:AlarmName,State:StateValue}"
```

Repo CLI (AWS inventory; does not flip flags):

```powershell
npm run ops:aws-ingestion-status
```

Expect: `game-status-sync` DEPLOYED + schedule ENABLED; other families DISABLED; postgame NOT_DEPLOYED.

Local health snapshot (app env — **do not** set app `LIVE_INGESTION_ENABLED=true`):

```powershell
npm run ops:health-snapshot
```

`npm run ops:game-status-sync` is **local dry-run only**. Do not use it as a production invoke. Do not run it without `--dry-run`.

Selected `analytics.games` freshness (read-only SQL, season 2026):

```sql
select game_id, game_date, status, start_time, home_score, away_score, updated_at
from analytics.games
where season = 2026
order by game_date, game_id;
```

Do not dump connection strings.

---

## Emergency Disable

**Principle:** disable execution, keep infrastructure, preserve state, investigate.

**Preferred (Terraform-managed, narrow):**

In gitignored `infra/terraform.tfvars`:

```hcl
game_status_sync_execution_enabled = false
```

Then `terraform plan` (expect: schedule **DISABLED**, status-sync env last-merge back to replay freeze) → `terraform apply` if the plan matches.

Keep:

- `game_status_sync_create = true` (do **not** destroy the Lambda)
- `live_ingestion_enabled = true` is optional to leave as-is; the family flag is the narrow stop. Setting global live to `false` also stops status-sync but is a coarser hammer — use only if you intend a global freeze.

Optional additional: `game_status_sync_enable_schedule = false` **destroys** the schedule resource (`count = 0`). Prefer leaving the schedule resource in place and **DISABLED** via the execution flag.

**Do not:**

- Destroy the Lambda
- Set `game_status_sync_create = false`
- Disable the entire account’s EventBridge/ingestion blindly
- Manually flip AWS console state and leave Terraform drift unless a true emergency requires an immediate console disable — if you do, follow with Terraform to restore desired state

---

## Recovery Procedure

For recoverable failures (provider blip, transient 5xx, one missed poll):

1. Identify **provider vs AWS vs DB** (logs: HTTP status, limiter, `db_ok`, scheduler State).
2. Keep **other families frozen**. Do not “fix” by enabling nightly/odds/props.
3. Fix the **narrow** problem (key, IAM, table, network).
4. `terraform plan` — apply only if desired state must change.
5. Re-enable status-sync **only** if it was disabled (`game_status_sync_execution_enabled = true`).
6. Observe the **next scheduled runs** (do not invent a canary JSON Input).

Do **not** replay historical full-season `/v1/games?seasons[]=2026` queries as the first recovery step. Frequent ET ±1 is the production path.

If BLOCKED (401/403): stop; do not retry-hammer; restore capability.

---

## Ops Known Limitation

`/ops` and `npm run ops:health-snapshot` use a **global** app `LIVE_INGESTION_ENABLED` plus per-feed freeze flags (`resolveFeedConfig` in `lib/ops/ingestion-observability.ts`).

Setting the **app** env to `LIVE_INGESTION_ENABLED=true` would classify **frozen** families as ACTIVE/CONFIG_MISMATCH. Only status-sync is live in AWS.

**Known 13G follow-up (do not redesign in 13C.4):**

> Ops should derive intended state **per family** rather than using a single global live boolean.

Until then: **AWS CLI + Terraform + CloudWatch are the activation source of truth.** `/ops` is an operator summary that may show status-sync as FROZEN/CONFIG_MISMATCH under app freeze. That is a UI limitation, not a production failure.

---

## Monitoring Ownership

| System | Source of truth for |
|---|---|
| **Terraform** | Desired resource + activation flags |
| **AWS Scheduler** | Actual recurring trigger (ENABLED, rate, Input `{}`) |
| **CloudWatch** | Actual Lambda invocations, `game_status_sync_complete` logs, Errors alarm |
| **`/ops`** | Operator summary (may lag / mis-classify under global live boolean) |
| **Supabase** | Data freshness and `analytics.games` row state |

Do not ask one of these every question. Example: “is the schedule on?” → Scheduler. “did the last poll succeed?” → CloudWatch logs. “did scores update?” → Supabase. “should the schedule be on?” → Terraform.

---

## Signoff Matrix

| Capability | State |
|---|---|
| Terraform-managed deployment | **READY** (plan NO-OP) |
| Recurring scheduler | **ACTIVE** (ENABLED, 15 min, Input `{}`) |
| Shared limiter | **READY** |
| Provider `/v1/games` | **AVAILABLE** |
| Real Postgres path | **READY** |
| Scheduled polling | **OBSERVED** (two production runs) |
| Empty-slate handling | **READY** (`fetched=0` HEALTHY) |
| Scheduled → In Progress | **FIXTURE_CERTIFIED / LIVE_PENDING** |
| In Progress → Final | **FIXTURE_CERTIFIED / LIVE_PENDING** |
| Final-preserve | **FIXTURE_CERTIFIED / LIVE_PENDING** |
| Postgame fanout | **NOT_ENABLED** |
| Other ingestion families | **FROZEN** |
| Operational monitoring | **PARTIAL** (`/ops` global live boolean; AWS/CW/TF READY) |

Live-pending transitions are **season checkpoints**, not activation blockers. No September games in the window does **not** make this YELLOW.

---

## Future Production Checkpoints

The 13C implementation/activation track is **closed**. Monitoring continues.

| Checkpoint | Trigger | Blocker for 13C? |
|---|---|---|
| First scheduled game in window | ET ±1 intersects a real 2026 game date | No |
| First In Progress | First live 2026 game | No |
| First Final | First natural Final + preserve | No |
| First newly published schedule insert | New `game_id` insert in-season | No |

---

## Roadmap Handoff

Compare only (do not start either):

### Branch A — GOAT activation

Requires purchasing/re-enabling BallDontLie GOAT.

Then a long ingestion chain: injuries → odds → props → Box/Starters/Postgame (13F still parked). Paid `/v1/stats` cannot be certified today. Additional infrastructure has **diminishing launch value** while the product pin is 2025 and the UI/model surface is under-invested.

### Branch B — Product differentiation sprint (GOAT-independent)

- WOWY **model foundation** (not a possession engine — archive scripts still say do not build WOWY from current play-by-play)
- UI redesign/polish
- Context Check completion (v1 is presentation + studio + mocks; auto discovery / public publish are future)
- Product onboarding
- Social/content preparation

**Primary recommendation: Branch B.**

Reason: live heartbeat is already working; paid endpoints cannot be certified; 13F must stay parked; Context Check and UI are comparatively under-invested relative to ingestion/infra. A **short** sprint should emphasize UI polish, Context Check completion, and onboarding — not a full WOWY possession system.

---

## Recommended Next Step

**A short WOWY/UI product sprint while status-sync runs in production.**

Do **not** start it in this step. Do not buy GOAT. Do not activate another ingestion family. Do not deploy postgame.

Suggested first slice when that sprint begins (operator choice, not this PR): Context Check completion and UI polish, with WOWY limited to a design/model foundation that does not require GOAT or 13F.

---

## Remaining risks (accepted)

- `/ops` per-family intended-state is unfinished (PARTIAL monitoring).
- Architecture overview (`reports/architecture/terraform-aws-architecture-overview.md`) still describes some pre-13C.3B snapshots (e.g. status-sync CODE_ONLY). Update when convenient; not a signoff blocker.
- First live Scheduled → In Progress → Final cycle is still **LIVE_PENDING**.
- Product pin 2025: 2026 heartbeat rows are not the public product season.

---

## Verification Checklist

1. Confirm `terraform plan` still prints `No changes` before any future flag edit.
2. Spot-check Scheduler State=ENABLED and Input=`{}` after any AWS console visit.
3. Treat `fetched=0` as HEALTHY until the ET window contains 2026 games.
4. At first nearby 2026 game date: run the First Scheduled Game Watchpoint.
5. At first live game: run In-Progress then Final watchpoints (Final-preserve + no postgame).
6. Never set app `LIVE_INGESTION_ENABLED=true` to “fix” `/ops` while other families are frozen.
7. Emergency stop = `game_status_sync_execution_enabled=false`, keep `game_status_sync_create=true`.

---

## Step Verdict

**GREEN — game-status-sync is operationally signed off for the 2026–27 season**

Frequent game-status-sync activation track: **`OPERATIONALLY_SIGNED_OFF`**.

This is the end of implementation/activation work for 13C. It is **not** the end of monitoring.
