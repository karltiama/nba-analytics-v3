# STEP 14P.X2A.1 — Parlay XRay Product DB Guardrail Apply

## Executive Result

The certified XRay guardrail SQL was applied to the Court Context product Supabase database (`public` schema). Pre-apply inventory was empty. Post-apply objects match the Docker-certified shape. Synthetic smoke rows were created and deleted. Extraction remains **disabled**. No OpenAI calls.

## Safety / Spend

- `PARLAY_XRAY_EXTRACTION_ENABLED` unset locally → safe default **false**. Not changed.
- `PARLAY_XRAY_OPENAI_API_KEY` not configured. Not added.
- Apply used DDL + a scoped synthetic reserve/release on user id `xray-cert-x2a1-operator` (not a real auth UUID). Cleanup left **0** rows.
- Live extract still refuses paid work. Parse route still `PARSE_DISABLED`.

**PAID_EXTRACTION:** DISABLED  
**REAL_OPENAI_CALLS:** 0  
**PRODUCT_SQL:** APPLIED  
**OPENAI_PROJECT:** NOT_CONFIGURED  
**CANARY:** NOT_RUN

## Product Database Target

| Field | Value |
| --- | --- |
| Environment | Court Context product Supabase (same project as the running app) |
| Project identifier | `mbub…ghqb` (matches MCP `https://mbubzxjglvhaxikdghqb.supabase.co`) |
| Database | `postgres` |
| Schema | `public` |
| Host (redacted) | `aws-…pabase.com:5432` (SSL) |
| MCP execute_sql role | `supabase_read_only_user` — **cannot** CREATE (used for inventory/verify only) |
| Apply role | `postgres` via `SUPABASE_DB_URL` — `has_schema_privilege(..., CREATE)` = true |

Target was unambiguous: connection string contains the same project ref as the MCP product project.

## SQL Re-Certification

Re-read `sql/proposed/parlay-xray-extraction-guardrails.sql`.

Materially identical to the X2A-certified file:

- `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` only
- XRay objects only (`parlay_xray_*`)
- no DROP / TRUNCATE / DELETE / destructive ALTER
- `schema_version` on usage (added during X2A certification)
- no screenshot/`bytea` columns

**Not** `SQL_CHANGED_SINCE_CERTIFICATION`. Applied as-is.

## Pre-Apply Inventory

`parlay_xray%` objects: **none**.

## Apply Result

| | |
| --- | --- |
| Start | 2026-09-15T22:28:38.873Z |
| End | 2026-09-15T22:28:39.316Z |
| File | `sql/proposed/parlay-xray-extraction-guardrails.sql` |
| Errors | none |
| IF NOT EXISTS | all creates were new (empty pre-inventory) |

Command: `npx tsx scripts/ops/apply-parlay-xray-guardrail-sql.ts --apply`

## Post-Apply Schema

Matches Docker-certified shape. No drift.

Tables: `parlay_xray_daily_counters`, `parlay_xray_inflight`, `parlay_xray_cooldowns`, `parlay_xray_dedupe`, `parlay_xray_extraction_usage`.

Verified: PK/unique indexes, `count integer NOT NULL DEFAULT 0`, `CHECK (count >= 0)`, timestamptz `expires_at` / `acquired_at` / `last_attempt_at` / `created_at`, usage `schema_version text`, indexes `parlay_xray_inflight_expires_idx`, `parlay_xray_dedupe_expires_idx`, `parlay_xray_usage_user_created_idx`, `parlay_xray_usage_created_idx`.

## Existing Product Safety

DDL-only on new XRay tables. Row counts after apply (same as pre-apply snapshot):

| Table | Count |
| --- | --- |
| analytics.games | 5163 |
| analytics.player_game_logs | 138296 |
| analytics.team_game_stats | 7924 |
| analytics.players | 5534 |
| public.games | 2353 |
| public.profiles | 2 |
| public.user_entitlements | 2 |
| public.billing_webhook_events | 88 |
| analytics.player_prop_market_movement | 21132 |

No WOWY/MM/historical table mutations.

**Note (pre-existing, not introduced by this apply):** many `public`/`analytics` tables still have RLS disabled. This step did not enable RLS (out of the audited SQL). XRay tables showed no `anon`/`authenticated` grants in `role_table_grants`.

## Runtime Kill Switch

Local env: `PARLAY_XRAY_EXTRACTION_ENABLED` **unset** → treated as false. Not flipped on.

## Endpoint Verification

- Authenticated unit: `EXTRACTION_DISABLED`, `providerAttempted: false` (extract-api test).
- Live unauthenticated `POST /api/parlay-xray/extract`: `AUTH_REQUIRED` 401, `providerAttempted: false`.
- Live `POST /api/betting/bet-slip/parse`: `PARSE_DISABLED` 503.

No screenshot and no provider key were used.

## Product DB Persistence Smoke Test

Against product DB, synthetic user `xray-cert-x2a1-operator` only:

- `reserve` succeeded
- `releaseBeforeProvider` succeeded
- `pg_try_advisory_xact_lock(hashtext(...))` available
- scoped DELETE of only that synthetic user / `2099-01-01` bucket

Leftover counts: counters 0, inflight 0, cooldowns 0, dedupe 0, usage 0.

No real user ids, no provider, no OpenAI key.

## Advisory Lock / Transaction Verification

`pg_advisory_xact_lock` / `pg_try_advisory_xact_lock` available. Store reserve+release executed in product Postgres. High-volume races were **not** re-run on product (already certified on Docker).

## Tests

`npx vitest run lib/parlay-xray` → **68 passed**.

- Unit / memory pipeline: 52
- Docker Postgres persistence: 16
- Endpoint safety: extract-api + live curl + parse disable

No real provider calls.

Fail-closed without store: existing pipeline/unit coverage (kill switch, missing key, `store_unavailable`) unchanged. Product DB was not disrupted.

## Post-Apply Inventory

| Object | Purpose | Rows | Expiry |
| --- | --- | --- | --- |
| `parlay_xray_daily_counters` | UTC user/global quota counts | 0 | next UTC date is a new PK |
| `parlay_xray_inflight` | 1 in-flight lock per user | 0 | `expires_at`; deleted on reserve |
| `parlay_xray_cooldowns` | last paid-attempt timestamp | 0 | checked against cooldown ms |
| `parlay_xray_dedupe` | per-user extraction cache | 0 | `expires_at` predicate |
| `parlay_xray_extraction_usage` | usage/cost metadata | 0 | keep; no sweeper yet |

All empty after synthetic cleanup.

## OpenAI Calls

**0**

## Remaining Manual Operator Requirements

1. Create/use a dedicated OpenAI project for Parlay XRay.
2. Configure a low provider-side project hard spend limit/backstop (suggested testing default $10).
3. Configure usage alerts (50% / 75% / 90%).
4. Create a dedicated server-side project API key.
5. Put the key in the intended server environment only (`PARLAY_XRAY_OPENAI_API_KEY`). Do not put it in `NEXT_PUBLIC_*`.
6. Keep `PARLAY_XRAY_EXTRACTION_ENABLED=false`.
7. Await explicit authorization for the paid canary (X2B). Do not run it now.

Do not paste the API key into chat.

## Canary Readiness

Schema is on the product DB. Provider project/key/cap are **not** configured. Flag remains false. Ready for **provider setup**, not for a paid canary until those operator steps and an explicit X2B authorization.

## Files Changed

- `scripts/ops/apply-parlay-xray-guardrail-sql.ts` (idempotent `--apply` helper; no secrets logged)
- this report
- learning log

SQL file contents were not modified. Product UI/WOWY/models/AWS were not modified.

## Verification Checklist

1. Flag still unset/false.
2. Product DB has the five `parlay_xray_*` tables, all empty.
3. analytics/public row counts unchanged.
4. Unauthenticated extract → `AUTH_REQUIRED`.
5. Parse → `PARSE_DISABLED`.
6. `npx vitest run lib/parlay-xray` → 68 green.
7. Do not enable extraction or configure an OpenAI key until X2B is authorized.

## Step Verdict

**GREEN** — XRay guardrail schema is safely deployed to the product database and ready for provider setup / paid canary
