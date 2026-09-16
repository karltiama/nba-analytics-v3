# STEP 14P.X2A — Parlay XRay Postgres Guardrail Certification

## Executive Result

Postgres-backed quota, reservation, concurrency, dedupe, and usage accounting are certified on a **dedicated local Docker Postgres**. The product/Supabase database was **not** mutated. Extraction remains disabled. Mocked providers only. **Real OpenAI calls: 0.**

## Safety / Cost

- `PARLAY_XRAY_EXTRACTION_ENABLED` remains false (not enabled in this step).
- No XRay OpenAI key configured for canary.
- Persistence tests spy `globalThis.fetch` and assert `api.openai.com` is never contacted.
- Kill-switch HTTP path and leftover parse path stay closed.

**PAID_EXTRACTION:** DISABLED  
**REAL_OPENAI_CALLS:** 0  
**CANARY:** NOT_RUN

## Database Target

Preference order was followed:

1. **Dedicated local/test Postgres — used.** Docker container `nba-xray-guardrail-pg` (Postgres 16 Alpine) on `127.0.0.1:55432`, database `xray_guardrails`. Connection is test-only (`postgres://xray@127.0.0.1:55432/xray_guardrails`). Not `SUPABASE_DB_URL`.
2. Local Windows PostgreSQL 17 is installed and listening, but it requires a password this step does not have. Not used.
3. Connected Supabase project (product data: games, entitlements, billing webhooks, profiles) was classified as the **application/production database**. **Not used.**

## SQL Audit

File: `sql/proposed/parlay-xray-extraction-guardrails.sql`

Additive only: `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.

| Object | Kind | Notes |
| --- | --- | --- |
| `parlay_xray_daily_counters` | table | PK `(bucket_date, scope)`; `count integer NOT NULL DEFAULT 0 CHECK (count >= 0)` |
| `parlay_xray_inflight` | table | PK `user_id`; `reservation_id uuid`; `acquired_at` / `expires_at` timestamptz |
| `parlay_xray_inflight_expires_idx` | index | `expires_at` |
| `parlay_xray_cooldowns` | table | PK `user_id`; `last_attempt_at` timestamptz |
| `parlay_xray_dedupe` | table | PK `identity`; `result_json jsonb`; `created_at` / `expires_at` |
| `parlay_xray_dedupe_expires_idx` | index | `expires_at` |
| `parlay_xray_extraction_usage` | table | PK `id uuid`; usage metadata including `schema_version` |
| `parlay_xray_usage_user_created_idx` | index | `(user_id, created_at DESC)` |
| `parlay_xray_usage_created_idx` | index | `created_at DESC` |

No `DROP`, `DELETE`, `TRUNCATE`, or `ALTER` of existing product objects. No screenshot/`bytea` columns. Dedupe stores structured legs JSON only (not image bytes). TTL is application-enforced via `expires_at` predicates, not a DB job.

This step added `schema_version` to the usage table so application usage records match the X2 contract.

## Schema Applied

Applied **only** to the Docker test database via the persistence harness (`CREATE TABLE IF NOT EXISTS`). Verified `information_schema` table/column names match `createPostgresXrayStore`.

**Product/Supabase: not applied.**

## User Quota Persistence

Certified:

- Free limit and Pro limit from config; unresolved plan uses Free (`isPro: false`).
- UTC day key (`YYYY-MM-DD` from ISO).
- Increments persist in `parlay_xray_daily_counters`.
- Next UTC day is a new bucket.
- `CHECK (count >= 0)` plus `GREATEST(count-1,0)` on release.
- User A usage does not consume User B’s daily slot.
- Concurrent two-requests / one remaining slot: exactly one reservation.

## Global Cap Persistence

Global `scope = 'global'` counter persists. User + global rows are locked with `SELECT … FOR UPDATE` in one transaction. Concurrent two users / one global slot: exactly one mocked provider call and persisted count = 1.

## Concurrency Lock

Postgres inflight is one row per `user_id`. This step added `pg_advisory_xact_lock` so a missing inflight row cannot be inserted twice under a race. Certified:

- Second request while first is in mocked provider → `IN_FLIGHT`
- Different user proceeds
- Expired lock is deleted and a new reservation succeeds
- Success and pre-provider failure both clear inflight

## Cooldown

`parlay_xray_cooldowns.last_attempt_at` is written on provider-attempt finalize, not on cache hits. Certified: in-window new image → `RATE_LIMITED`; cache hit allowed; other user allowed; after TTL a new mocked attempt succeeds.

## Dedupe

Identity remains `userId:imageHash:extractionVersion:schemaVersion:model`. Certified: same user+image+version cache hit; different user no share; new extract version misses; expired `expires_at` ignored. No PNG/base64 in dedupe or usage rows.

## Atomic Reservation Semantics

| Path | DB effect |
| --- | --- |
| Kill switch / missing key / invalid file | no counter rows |
| Cache hit | no new reservation |
| Internal throw **before** provider | inflight cleared, counters decremented |
| Mocked provider attempt (ok, timeout, 429, 5xx, malformed) | quota kept, inflight cleared, usage row |

## Race Tests

Deterministic barriers (provider gate), not sleep-only:

- **A.** 1 user slot left, 2 requests → 1 mocked provider call, persisted count 1
- **B.** 1 global slot, 2 users → 1 mocked provider call, global count 1
- **C/D.** Same user duplicate image in parallel → 1 mocked provider call (second `IN_FLIGHT`)

## Usage Accounting

Persisted: user id, UTC `created_at`, extraction version, schema version, model, image hash, original/normalized dimensions and bytes, cache hit, provider attempted, success, latency, mocked request id, token fields, nullable estimated cost, error category.

Not stored: raw screenshot, OCR dump, player/line payload in the usage table.

## Failure Recovery

Certified: before-provider exception releases; timeout/429/5xx/malformed mocks keep quota, clear lock, return no legs; stale expired inflight recovers.

## Expiry / Cleanup

- Inflight: expired rows deleted at the start of `reserve`.
- Dedupe: `expires_at > now` filter; expired rows are ignored.
- Daily counters: next UTC date is a new PK; old rows remain.
- No scheduled sweeper in this step.

**Future (minimal):** a periodic `DELETE FROM parlay_xray_dedupe WHERE expires_at < now()` plus optional prune of counters/usage older than N days. Not required for correctness of current queries.

## Endpoint Kill-Switch Verification

Authenticated unit test: `EXTRACTION_DISABLED`, `providerAttempted: false`, provider not called.

Live unauthenticated `POST /api/parlay-xray/extract`: `AUTH_REQUIRED` 401, `providerAttempted: false` (auth layer before spend).

## Old Parse Endpoint Verification

Live `POST /api/betting/bet-slip/parse` → `PARSE_DISABLED` 503.

## Tests

`npx vitest run lib/parlay-xray` → **68 passed**.

| Suite | Count / notes |
| --- | --- |
| Unit (memory pipeline, image, map, session, page, cost, upload, odds) | 52 including new pre-provider release test |
| Persistence (Docker Postgres) | 16 |
| Concurrency | included in persistence A/B/C/D plus memory inflight |
| Endpoint safety | extract-api kill switch + live curl parse/extract |

Unrelated repo `tsc` debt is not treated as an XRay failure.

## Files Changed

- `sql/proposed/parlay-xray-extraction-guardrails.sql` (`schema_version` column)
- `lib/parlay-xray/extraction/postgres-store.ts` (advisory lock; schema version persist)
- `lib/parlay-xray/extraction/store.ts`, `pipeline.ts` (schema version; release-before-provider hook)
- `lib/parlay-xray/extraction/__tests__/pg-harness.ts`
- `lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts`
- `lib/parlay-xray/extraction/__tests__/pipeline-guardrails.test.ts`
- `lib/parlay-xray/extraction/__tests__/extract-api.test.ts`
- this report

No XRay visual/UX, WOWY, Explorer, AWS, or Terraform changes.

## Production Apply Status

**NOT_APPLIED**

Applying the same SQL to the product Supabase database requires explicit operator approval.

## Remaining Operator Requirements

1. Explicit approval to apply `sql/proposed/parlay-xray-extraction-guardrails.sql` on the product database.
2. Dedicated OpenAI XRay project, project key, $10 hard cap, 50/75/90% alerts.
3. Keep `PARLAY_XRAY_EXTRACTION_ENABLED=false` until the paid canary is scheduled.
4. Optional later: expired-dedupe prune job.

## Recommended Next Step

Operator applies SQL to the product DB **with approval**, then a **single** controlled paid canary (STEP after X2A). Do not enable extraction in this step.

## Verification Checklist

1. Confirm extraction flag is still false.
2. `npx vitest run lib/parlay-xray` — 68 green.
3. Unauthenticated extract → `AUTH_REQUIRED`.
4. Parse route → `PARSE_DISABLED`.
5. Product DB still has no `parlay_xray_*` tables until you approve apply.
6. Do not run a real screenshot canary yet.
7. Docker test DB `nba-xray-guardrail-pg` is local-only; stop/remove when finished if desired.

## Step Verdict

**GREEN** — Postgres-backed XRay spend guardrails are certified and ready for a controlled paid canary

**PAID_EXTRACTION:** DISABLED  
**REAL_OPENAI_CALLS:** 0  
**PRODUCTION_SQL:** NOT_APPLIED  
**CANARY:** NOT_RUN
