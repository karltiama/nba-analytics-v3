# STEP 14P.X2 — Parlay XRay Paid-Path Guardrails + Extraction Adapter

## Executive Result

Paid-path guardrails and a dedicated XRay extraction adapter are implemented. The kill switch defaults to **off**. No production OpenAI vision call was made in this step. The frontend now requires an explicit **Extract screenshot** click and maps results into `ExtractedParlayLeg[]`. Full XRay analysis and Parlay Explorer were not started.

**PAID_EXTRACTION:** DISABLED  
**FULL_XRAY_ANALYSIS:** NOT_IMPLEMENTED  
**PARLAY_EXPLORER:** NOT_IMPLEMENTED

## Prior Paid Endpoint Audit

| Asset | Reuse decision |
| --- | --- |
| `POST /api/betting/bet-slip/parse` | Isolated leftover. Different schema (`BetSlipExtraction`), 6 MB limit, `detail: "high"`. **Not** the XRay contract. Disabled by default (`BET_SLIP_PARSE_ENABLED` missing/false). |
| `lib/betting/bet-slip/openai-extract.ts` | Not imported by XRay. Kept for the leftover route only. |
| `POST /api/betting/bet-slip/analyze` | EV / projection summary, **not** vision. No app callers found. Left in place; XRay does not call it. |
| OpenAI client | No shared SDK client exists. Other AI routes use ad-hoc `fetch` to Chat Completions. XRay uses the same pattern in its own provider module — not a second client class, and not the old parser. |
| Auth | `requireBettingAuth` reused. |
| Entitlements | `getUserEntitlements` reused. Unresolved plan → Free daily limit. No new feature key. |
| Rate-limit / Redis / Dynamo | BDL Dynamo is ingestion-only. No app quota store existed. |
| Postgres `lib/db.ts` | Reused for a **proposed** durable store. Migration was **not** applied. |
| Umami | Extended with surface-only extract events. |
| Env | `.env.example` documented. Kill switch fail-closed. |

**Old parse callers:** only `app/api/betting/bet-slip/parse/route.ts`. Bet-slip UI components (`UploadPanel`, `ReviewEditor`, `AnalysisResults`) are not imported by any live page.

## Architecture

Ordered pipeline in `runXrayExtraction`:

1. Kill switch  
2. File validation / pass-through normalization  
3. API key present  
4. Per-user SHA-256 dedupe cache  
5. Atomic quota + inflight reservation  
6. **One** provider attempt  
7. Map to `ExtractedParlayLeg[]`  
8. Usage record + inflight release  
9. UI result  

Canonical endpoint: **`POST /api/parlay-xray/extract`**. Quota read: **`GET /api/parlay-xray/quota`**. XRay UI calls only these routes.

Store: in-memory (tests / `PARLAY_XRAY_STORE=memory`) or Postgres (default outside test). Proposed SQL lives in `sql/proposed/parlay-xray-extraction-guardrails.sql` and was **not** applied.

## Authentication

Unauthenticated extract returns `AUTH_REQUIRED` (401) with product copy, `providerAttempted: false`. Verified live: unauthenticated POST → 401, no OpenAI. Anonymous users can still open `/parlay-xray` and preview a local file.

## Kill Switch

`PARLAY_XRAY_EXTRACTION_ENABLED` — missing or anything other than true/1/yes is **false**. Rejects before reservation and before any model call. Client flags are not the safety boundary.

## User Quotas

UTC daily buckets (`YYYY-MM-DD` from `toISOString()`).

- Free: `PARLAY_XRAY_FREE_DAILY_LIMIT` default **3**  
- Pro (`entitlement.isPro`): `PARLAY_XRAY_PRO_DAILY_LIMIT` default **10**  
- Plan lookup failure → Free limit  

## Global Quota

`PARLAY_XRAY_GLOBAL_DAILY_LIMIT` default **100**. Enforced in the same atomic reservation as the user counter.

## Concurrency

Maximum 1 in-flight paid extract per user. Lock TTL default 120s. Simultaneous second request → `IN_FLIGHT`. Failures clear the lock in `finalizeAttempt` / `releaseBeforeProvider`.

Cooldown default 45s between **new** paid attempts. Cache hits skip cooldown.

## Atomic Reservation Semantics

| Path | Quota | Provider |
| --- | --- | --- |
| Kill switch / unauthenticated / invalid file / missing key | Not consumed | Not called |
| Dedupe cache hit | Not consumed | Not called |
| Internal failure **before** provider after reserve | Reservation released (decrement) | Not called |
| Provider request **attempted** (success, 429, 5xx, timeout, malformed JSON) | Kept | Exactly one attempt |
| Missing Postgres tables | `store_unavailable` → `INTERNAL_ERROR` | Not called |

Avoided: check-then-increment-after-success.

## File Validation

Canonical XRay policy (aligned UI + API): **PNG / JPEG / WebP**, **10 MB**, PDF not advertised and rejected. Magic-byte decode required. Zero-byte, corrupt, MIME mismatch, and long edge > 4096 reject before the provider.

## Image Normalization

v1 policy: **pass-through**. No extra lossy re-encode (no `sharp`). Oversized long-edge images are rejected rather than downscaled. Original and normalized dimensions/bytes are equal on accept and recorded in usage metadata. Screenshot bytes are not logged.

## Dedupe

SHA-256 of accepted bytes. Identity: `userId:imageHash:extractionVersion:schemaVersion:model`. TTL default 24h. **Per-user only** — same hash for another user is a new paid call.

## Extraction Versioning

- `PARLAY_XRAY_EXTRACTION_VERSION` default `xray-extract-v1`  
- Schema version `xray-legs-v1`  
- Provider: OpenAI Chat Completions `json_object`  
- Model recorded on every usage row  

## Provider / Model Configuration

- `PARLAY_XRAY_VISION_MODEL` default **`gpt-4o-mini`** (repo convention). No silent upgrade to `gpt-4o`.  
- Detail policy **A**: single mode, default **`low`**. `high` only if `PARLAY_XRAY_VISION_DETAIL=high` is set explicitly. Two-pass retry is **not** implemented.  
- Key: `PARLAY_XRAY_OPENAI_API_KEY` preferred; falls back to `OPENAI_API_KEY`. Server-only.

## Structured Output Contract

Zod `xrayVisionOutputSchema` → `ExtractedParlayLeg[]` with `known` / `unknown` / `needs_confirmation`. Compact JSON, `max_tokens` default 800. No analysis fields in the prompt.

## Entity Resolution Boundary

OCR names are display text. `playerId` and `nbaPlayerId` stay **unknown**. Low/medium confidence fields are `needs_confirmation`. Ambiguous names are never silently resolved.

## Prompt Injection Safety

System prompt states the screenshot is untrusted DATA, not instructions, and forbids schema/tool/safety changes from image text.

## Retry Policy

Maximum provider attempts per user extraction = **1**. No retry on malformed output, empty legs, or user-correctable failures.

## Usage / Cost Accounting

One usage record per attempted paid extract (and a cache-hit audit row with `providerAttempted: false`). Fields: user, timestamp, version, model, image hash, dimensions/bytes, cache hit, provider attempted, success, latency, request id, tokens, `estimated_cost_usd` (only for `gpt-4o-mini` when token counts exist), error category.

No screenshot, no OCR dump, no full slip in analytics.

## Provider Spend Backstop Requirements

**Required before any real canary / production enablement** (cannot be done from app code):

1. Dedicated OpenAI **project** for XRay  
2. Dedicated project-scoped server key (`PARLAY_XRAY_OPENAI_API_KEY`)  
3. Provider-side **hard monthly cap** — suggested testing default **$10**  
4. Alerts at 50% / 75% / 90%  
5. Do not reuse a legacy/exposed key  

## Secret Safety

Key is server-only. Not `NEXT_PUBLIC_*`. Not returned in route JSON. Logs omit screenshot bytes and secrets.

## Frontend Integration

`/parlay-xray` upload is local preview only. User must click **Extract screenshot**. Button disables while `pending`. Confirm still does **not** run analysis. Client calls `POST /api/parlay-xray/extract` only.

## Extraction States

`SUCCESS`, `PARTIAL`, `NO_LEGS_FOUND`, `NEEDS_CONFIRMATION`, `UNREADABLE_IMAGE`, `RATE_LIMITED`, `USER_QUOTA_EXCEEDED`, `GLOBAL_QUOTA_EXCEEDED`, `EXTRACTION_DISABLED`, `PROVIDER_UNAVAILABLE`, `INTERNAL_ERROR`, plus `AUTH_REQUIRED` and `IN_FLIGHT`. Product copy never mentions OpenAI credits, keys, or billing.

Quota chip: authenticated users, only when `GET /api/parlay-xray/quota` returns a real snapshot. Hidden if the proposed tables are missing.

## Screenshot Privacy

Ephemeral. No S3, Supabase Storage, or DB blob. Server holds a Buffer for the request only.

## Analytics Privacy

New events: `parlay_xray_extract_started` / `_completed` / `_failed`. Payload: `surface` + `result_category` only.

## Old Parse Route Decision

**Disabled by default** (`BET_SLIP_PARSE_ENABLED` false). Returns `PARSE_DISABLED` 503 before auth and before OpenAI. Verified live. Do not delete yet; leftover UI/schema remain unused. Re-enable only for a documented emergency, not for XRay.

## Tests

`npx vitest run lib/parlay-xray` → **51 passed**.

Pre-provider (OpenAI not invoked): kill switch, unauthenticated (API), invalid MIME/PDF, too large, corrupt, missing key, user quota, global quota, in-flight, cache hit.

Paid-call boundary (mocked): exactly one provider invocation; `detail: low`; `gpt-4o-mini`.

Provider failure: timeout/malformed → no retry, quota kept, lock released, empty legs.

Dedupe: same user/image/version → 1 call. Different users → 2 calls.

Race: one remaining user slot / one remaining global slot → one provider call.

`tsc --noEmit` still has **pre-existing** errors in admin/analytics/wowy tests unrelated to XRay. New XRay source files did not add those.

## Race / Dedupe Verification

Covered by `pipeline-guardrails.test.ts` (mutex store). Postgres uses `SELECT … FOR UPDATE` in a transaction; not live-tested against production because the migration was not applied.

## Canary Status

**CANARY_READY, NOT_RUN**

This step did not have an operator-enabled flag plus a dedicated XRay project key. No real vision request was sent.

Controlled canary checklist (manual, later):

1. Apply `sql/proposed/parlay-xray-extraction-guardrails.sql`  
2. Set dedicated project key + $10 hard cap + alerts  
3. `PARLAY_XRAY_STORE=postgres`  
4. Temporarily `PARLAY_XRAY_EXTRACTION_ENABLED=true` for one operator  
5. One known screenshot → one provider request → structured legs → usage row  
6. Identical second upload → cache, no second provider call  
7. Set flag back to **false**

## Cost Runbook

**NORMAL:** low volume; flag off in production until canary is scheduled.

**WARNING:** usage rows or OpenAI project spend rising while product traffic is not.

**STOP:** global cap (`GLOBAL_QUOTA_EXCEEDED`) or unexpected provider spend.

Emergency:

1. Set `PARLAY_XRAY_EXTRACTION_ENABLED=false`  
2. Redeploy / refresh config  
3. Confirm `POST /api/parlay-xray/extract` returns `EXTRACTION_DISABLED` before any provider call  
4. Inspect `parlay_xray_extraction_usage` (after SQL apply)  
5. Inspect OpenAI project usage  
6. Rotate/revoke the XRay project key if abuse is suspected  

Also keep `BET_SLIP_PARSE_ENABLED` false.

## Environment Configuration

Recommended testing posture (defaults already fail-closed):

```
PARLAY_XRAY_EXTRACTION_ENABLED=false
PARLAY_XRAY_FREE_DAILY_LIMIT=3
PARLAY_XRAY_PRO_DAILY_LIMIT=10
PARLAY_XRAY_GLOBAL_DAILY_LIMIT=100
PARLAY_XRAY_MAX_CONCURRENT_PER_USER=1
PARLAY_XRAY_DEDUPE_TTL_HOURS=24
PARLAY_XRAY_COOLDOWN_SECONDS=45
PARLAY_XRAY_VISION_MODEL=gpt-4o-mini
PARLAY_XRAY_VISION_DETAIL=low
BET_SLIP_PARSE_ENABLED=false
```

Extraction was **not** turned on at the end of this step.

## Files Changed

- `lib/parlay-xray/extraction/*` (config, pipeline, store, provider, image, schema, prompt, map, cost, runtime)
- `app/api/parlay-xray/extract/route.ts`, `app/api/parlay-xray/quota/route.ts`
- `sql/proposed/parlay-xray-extraction-guardrails.sql`
- `app/parlay-xray/ParlayXrayClient.tsx`, `components/parlay-xray/ParlayXrayView.tsx`
- `lib/parlay-xray/{session,copy,types}.ts`
- `app/api/betting/bet-slip/parse/route.ts` (disabled)
- `proxy.ts`, `.env.example`
- `lib/product-analytics/{track-event,parlay-xray-events}.ts`
- Tests under `lib/parlay-xray/**/__tests__`

## Remaining Work

- Apply proposed SQL before a durable production canary  
- Dedicated OpenAI project, key, $10 cap, alerts  
- Operator canary (one screenshot) then disable  
- Full XRay analysis (WOWY / MM / context / correlation) — **out of scope**  
- Parlay Explorer — **out of scope**  
- Optional later: `sharp` long-edge downscale instead of reject  

## Recommended Next Step

STEP 14P.X3 should **not** start analysis until a documented canary has been run. Next product work is either: (a) operator applies SQL + project cap and runs the one-screenshot canary, or (b) a later slice for **confirmed-leg analysis** after extraction is certified.

## Verification Checklist

1. Confirm `.env.local` does **not** set `PARLAY_XRAY_EXTRACTION_ENABLED=true`.  
2. Open `/parlay-xray`, select a PNG — Extract appears; analysis does not auto-run.  
3. Unauthenticated `POST /api/parlay-xray/extract` returns `AUTH_REQUIRED` / 401.  
4. `POST /api/betting/bet-slip/parse` returns `PARSE_DISABLED` / 503.  
5. Run `npx vitest run lib/parlay-xray`.  
6. Do not apply the proposed SQL until you intend a canary.  
7. Do not send a real screenshot to OpenAI until the dedicated project hard cap is set.

## Step Verdict

**GREEN** — XRay paid-path guardrails and screenshot extraction adapter are implemented and ready for controlled canary  

**PAID_EXTRACTION:** DISABLED  
**CANARY:** CANARY_READY, NOT_RUN  
**FULL_XRAY_ANALYSIS:** NOT_IMPLEMENTED  
**PARLAY_EXPLORER:** NOT_IMPLEMENTED  
