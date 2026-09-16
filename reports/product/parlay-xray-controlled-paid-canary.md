# STEP 14P.X2B — Parlay XRay Controlled Paid Canary

## Executive Result

One authenticated paid extraction ran through the production XRay path and mapped four legs into `ExtractedParlayLeg[]`. The identical screenshot replay was a cache hit with **zero** additional provider calls. Extraction was then disabled again. Full XRay analysis and Parlay Explorer did not run.

## Safety Preconditions

| Check | Result |
| --- | --- |
| A. Five `parlay_xray_*` tables | Present, empty before canary |
| B. Unexpected prior rows | None |
| C. `POST /api/betting/bet-slip/parse` | `PARSE_DISABLED` 503 |
| D. Kill switch off | Quota `enabled: false`. Authenticated extract unit test: `EXTRACTION_DISABLED`, `providerAttempted: false`. Unauthenticated live extract: `AUTH_REQUIRED`, `providerAttempted: false` |
| E. Dedicated server-side XRay API key | Present (`PARLAY_XRAY_OPENAI_API_KEY`). Not printed |
| F. `NEXT_PUBLIC_*` XRay provider key | Absent |
| G. Model | `gpt-4o-mini` (certified default; `PARLAY_XRAY_VISION_MODEL` unset) |
| H. Detail | `low` (certified default) |
| I. Authenticated | Yes (operator account `KrazyKarlHD`) |
| J. Quota remaining | 10 of 10 Pro before canary |
| K. Provider spend backstop | Operator-stated configured; not independently opened in the OpenAI console from this environment |

Quota defaults were not changed (Free 3 / Pro 10 / Global 100). Concurrency, cooldown, and dedupe TTL were not changed.

## Provider Project State

Dedicated XRay project key was available server-side. Shared leftover `OPENAI_API_KEY` was not used by the XRay config preference. No client-exposed key.

## Canary Screenshot Metadata

Synthetic four-leg NBA parlay PNG (no account IDs). Not committed. Deleted from temp after verification.

| Field | Value |
| --- | --- |
| Type | `image/png` |
| Dimensions | 1024 × 1024 |
| Bytes | 30672 |
| SHA-256 | `27b563cb50fd921612c4b6f4a7303fb99719e016711c64dd6f91053c60318234` |
| Persisted | No (no Postgres blob, no Storage object, no repo file) |

Visible legs: Tatum Over 27.5 Points −110; Edwards Over 5.5 Rebounds −125; Doncic Over 7.5 Assists +100; Curry Over 4.5 Threes −120. Sportsbook header: DraftKings.

## First Extraction

Production path: auth → validation → dedupe miss → reserve → lock → one `gpt-4o-mini` vision call → structured map → usage → UI.

- Result: `SUCCESS`
- UI: 4 detected · 4 resolved · 0 need confirmation
- Quota after: **9 of 10** remaining
- Server log: `xray_extract_completed` `cacheHit: false` `providerAttempted: true` `latencyMs: 5745`
- HTTP: `POST /api/parlay-xray/extract` 200 in 7.5s (one request)

## Structured Output Quality

Each leg mapped into `ExtractedParlayLeg`.

| Leg | Player | Market | Side / line | Odds | Context |
| --- | --- | --- | --- | --- | --- |
| 1 | Jayson Tatum known | Points | Over 27.5 | −110 | BOS vs MIA |
| 2 | Anthony Edwards known | Rebounds | Over 5.5 | −125 | MIN vs LAL |
| 3 | Luka Doncic known | Assists | Over 7.5 | +100 | DAL @ DEN |
| 4 | Stephen Curry known | 3-Pointers Made | Over 4.5 | −120 | GSW @ SAC |

Canonical `playerId` / `nbaPlayerId`: **unknown** on all four (not invented). Sportsbook status: **known**. Resolution: all `resolved`.

## Provider Call Count

First submission: **1**. No retry, no second pass, no model fallback in logs.

## Usage / Quota Accounting

UTC 2026-09-15:

- User daily counter: 1
- Global daily counter: 1
- Usage row 1: `cache_hit=false`, `provider_attempted=true`, `success=true`, versions `xray-extract-v1` / `xray-legs-v1` / `gpt-4o-mini`, image hash prefix `27b563cb50fd`, 1024×1024 / 30672 bytes, no screenshot bytes, no extracted-slip text in usage columns, `prompt_tokens=3365`, `completion_tokens=549`, `total_tokens=3914`, `estimated_cost_usd=0.000834`, provider request id present

## Dedupe Record

One per-user identity row. `result=SUCCESS`, 4 legs, unexpired, TTL 24h.

## Identical Replay

Same file, same user, Extract clicked again. UI returned the same four legs. Quota stayed **9 of 10**.

## Replay Provider Call Count

Server log: `xray_extract_cache_hit` `providerAttempted: false`. HTTP POST 200 in 764ms.

Additional provider attempts: **0**. Total provider attempts: **1**.

## Provider Usage / Estimated Cost

App-computed from provider token usage (not file size): **$0.000834**. Replay usage row has null tokens / null cost / `provider_attempted=false`. Spend is consistent with one `gpt-4o-mini` low-detail vision call. OpenAI project dashboard was not opened from this environment; application usage rows are the source of truth here.

## Screenshot Privacy

- No `bytea` / image columns on XRay tables
- `storage.objects` count: 0
- No S3 upload from this path
- No committed local image
- Server logs: dimensions/bytes/hash only, not raw image or player payload
- Umami events: `surface` + `result_category` only
- Browser local preview only; temp PNG deleted after canary

Dedupe `result_json` stores structured legs for cache replay (required). Usage telemetry does not.

## Analytics Privacy

Client extract events send `{ surface: 'parlay_xray', result_category }`. No filename, hash, player, line, odds, or sportsbook.

## Lock / Cooldown State

After first extract: inflight **0**. Cooldown row present (paid attempt). Replay still succeeded because cache is checked before reserve/cooldown.

## Old Parse Endpoint

After canary: `POST /api/betting/bet-slip/parse` → `PARSE_DISABLED` 503.

## Post-Canary Kill Switch

`PARLAY_XRAY_EXTRACTION_ENABLED=false`. Dev server restarted. Quota endpoint: `enabled: false`, `used: 1`, `remaining: 9`.

## Tests

`npx vitest run lib/parlay-xray` → **68 passed**.

- Unit / memory / API contract: 52
- Docker Postgres persistence: 16
- Endpoint safety: extract-api + live parse disable + live canary logs

No test edits. No real provider calls from tests.

## Evidence Matrix

| Check | Expected | Observed |
| --- | --- | --- |
| First submission provider attempts | 1 | 1 |
| Replay provider attempts | 0 | 0 |
| Total provider attempts | 1 | 1 |
| User quota consumed | 1 | 1 |
| Global quota consumed | 1 | 1 |
| Replay quota consumed | 0 | 0 |
| Usage record written | yes | yes (paid + cache-hit audit) |
| Dedupe hit on replay | yes | yes |
| Screenshot persisted | no | no |
| Analysis auto-ran | no | no (still unavailable after Confirm) |
| Kill switch restored false | yes | yes |
| Old parse enabled | no | `PARSE_DISABLED` |

## Extraction Quality Notes

Not a benchmark. One synthetic slip:

- 4/4 legs detected
- Names, markets, sides, lines, odds correct
- `Threes` → `3-Pointers Made` (usable mapping)
- `MIN @ LAL` rendered as `MIN vs LAL` (separator only)
- Sportsbook known in contract; not shown in the leg card UI
- Canonical IDs left unknown
- Edit / Confirm present; Confirm does not attach analysis
- No obvious invented stats

## Remaining Risks

- Canary image was a constructed slip, not a noisy phone sportsbook screenshot
- Sportsbook field is not surfaced in the extracted-leg card
- Free/Pro daily limits remain safety defaults, not product policy
- Broad extraction is off; a forgotten `true` in a deployed env would re-open spend
- OpenAI console usage was not independently screenshotted

## Recommended Next Step

Keep extraction **disabled**. Do not start public extraction, historical replay, or full analysis until a later authorized step. Next useful work is a broader controlled screenshot set (real books, poor lighting, 2–8 legs) under a later explicit authorization.

## Verification Checklist

1. `.env` shows `PARLAY_XRAY_EXTRACTION_ENABLED=false`.
2. Quota API reports `enabled: false`.
3. Parse route still `PARSE_DISABLED`.
4. Product DB: 1 user + 1 global counter, 2 usage rows, 1 dedupe, 0 inflight, 0 storage objects.
5. `npx vitest run lib/parlay-xray` → 68 green.
6. Do not enable public extraction.
7. Do not start historical replay or full analysis from this step.

## Step Verdict

**GREEN** — one paid XRay extraction was successfully certified and identical replay produced no additional provider call
