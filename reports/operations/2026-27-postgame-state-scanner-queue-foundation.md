# 2026–27 Postgame State / Scanner / Queue Foundation — Step 13F.2

**Step verdict:** `GREEN — postgame state, scanner, and queue foundation are ready for worker implementation`

**Date:** 2026-09-10  
**Depends on:** 13F.1 orchestration audit (approved)

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| BDL HTTP | **0** |
| GOAT calls | none |
| Schedule activation | none (`live_ingestion_enabled=false`) |
| Season-pin flip | none |
| 13E | none |
| Historical Explorer UI | unchanged |
| Product FK migration | none |
| 2026 Advanced/starters/Plays materialization | none |
| Possession / WOWY | none |
| Stage workers | **none** |
| SQS SendMessage | **none** (CLI dry-run only) |
| Terraform apply | **not run** |

Allowed work shipped: schema file, domain scanner, queue contract, SQS/DLQ Terraform definitions, dry-run CLI, tests, observability integration.

---

## Architecture Preserved (13F.1)

- Final-driven eligibility (`analytics.games.status` + proven scores)
- Capability-based Explorer (ops aggregate only; no product `historical_complete`)
- Per-game / per-stage isolation (`game_id` + `stage` messages)
- At-least-once + idempotent writes (workers later)
- Periodic reconciliation via lookback scanner
- BBRef outside live Explorer pipeline
- Role Profile outside per-game postgame

No architecture redesign. No Step Functions. No nightly monolith.

---

## `analytics.postgame_game_stages`

File: `db/schemas/MIGRATION_postgame_game_stages.sql`

Grain: `(game_id, stage)`

Stages: `box` · `starters` · `advanced` · `plays` · `game_flow`

Not included: role, injuries, odds, props, Market Movement.

Statuses: `WAITING` · `QUEUED` · `RUNNING` · `READY` · `BLOCKED` · `EXPECTED_ABSENCE` · `FAILED`

Compact columns only (counts, `reason_code`, bounded `provider_http`). No jsonb payloads, no keys, no stack traces. No GRANT to anon. Not seeded.

**Not applied to production in this step.** Operator applies the SQL when ready; empty table is enough.

---

## Scanner

`lib/postgame/scanner.ts` — pure function, fixtures only in tests.

- Non-Final / 0-0 scores skipped
- Optional `--season=2026` ignores 2023–2025 certified games
- Lookback window (default 36h)
- Serving evidence can mark box/starters/advanced/timeline READY without enqueue
- Truncated Plays → `EXPECTED_ABSENCE` + `SOURCE_TRUNCATED` for plays **and** game_flow (not FAILED forever)
- `game_flow` is not queued until `plays` is READY
- Freeze → plan messages with `action: hold` (not send)
- Live + GOAT inactive → starters/advanced/plays `BLOCKED` / `SUBSCRIPTION_BLOCKED`, not FAILED; box may still enqueue
- GOAT catch-up re-enqueues `SUBSCRIPTION_BLOCKED`
- Identity catch-up re-enqueues `IDENTITY_NOT_SERVING`
- Retryable FAILED (`PROVIDER_NOT_READY`, 429, 5xx, timeout, DB/S3 write) vs permanent `MALFORMED_SOURCE`
- Game A FAILED Advanced does not block Game B

Queue message:

```json
{ "v": 1, "gameId": "...", "season": "2026", "stage": "box", "attempt": 1, "enqueuedAt": "..." }
```

---

## Readiness Grades (ops only)

- **MINIMUM_READY** — Final + scores + box READY
- **ENRICHED** — MINIMUM + any optional READY
- **COMPLETE** — MINIMUM + every remaining stage READY or EXPECTED_ABSENCE

Product Explorer still uses independent `availability.*` flags.

---

## Terraform

`infra/postgame.tf`: `nba-postgame-stage-queue` + DLQ. **No Lambda, no EventBridge, no Scheduler, no event source mapping.**

DLQ alarm `nba-postgame-stage-dlq-not-empty` uses `treat_missing_data=notBreaching`.

Queues are inert until a future worker exists. Creating them does not thaw ingestion. **Terraform was not applied.**

---

## Observability

- Catalog: `starters_lineups` and `plays` now `goatRequired: true` (13F.1 correction). `game_flow` remains false.
- `/ops` compact **Postgame stages** card (counts). Table missing → UNKNOWN, does not redden `/ops`.
- Frozen empty table → `FROZEN_EXPECTED`.

---

## CLI

```bash
npx tsx scripts/ops/postgame-scan.ts --season=2026 --lookback-hours=36
```

Always dry-run: `sentSqs: 0`, `wroteStages: 0`, `bdlHttp: 0`.

---

## Tests

`npx vitest run lib/postgame lib/ops infra/__tests__/postgame-queue.test.ts`

**7 files, 63 tests, passed.** No BDL. No job invocation.

Covered: frozen hold, live GOAT block, serving box READY, game_flow waits on plays, truncated expected absence, per-game isolation, subscription catch-up, identity catch-up, retry vs malformed, 2025 season skip, schema, SQS without worker, `/ops` fail-closed.

---

## Remaining for 13F.3+

- Apply the SQL migration
- Optional Terraform apply for empty queues (still no consumer)
- Box + starters **workers** (13F.3) behind freeze
- Confirm `/v1/stats` ALL-STAR vs GOAT before live box
- Advanced `game_ids[]` (13F.4)
- Frequent status sync still required for 10–20 min BASE_READY

---

## Recommended Next Step

**13F.3 — Box + certified starters automation** (still freeze-gated, no schedule thaw).

Do **not** start it automatically.

---

## Verification Checklist

1. Confirm `live_ingestion_enabled=false` and no ingest Lambda / BDL call.
2. Confirm git diff has **no** postgame Lambda worker and **no** EventBridge for postgame.
3. `npx vitest run lib/postgame lib/ops infra/__tests__/postgame-queue.test.ts` passes.
4. `GET /api/ops/health` still 401 without session; signed-in `/ops` shows Postgame stages as frozen/unknown.
5. Optional: apply `MIGRATION_postgame_game_stages.sql` (empty table). Do not seed.
6. Do not `terraform apply` unless you intend only to create unused queues.
7. Do not start 13F.3 / 13E / live ingestion automatically.

---

## Step Verdict

`GREEN — postgame state, scanner, and queue foundation are ready for worker implementation`
