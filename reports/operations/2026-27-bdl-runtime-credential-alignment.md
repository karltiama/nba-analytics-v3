# 2026–27 BDL Runtime Credential Alignment — Step 13D.2

**Step verdict:** `YELLOW — runtime credential is aligned but provider still rejects entitled endpoints`

**Classification:** `PROVIDER_ENTITLEMENT_OR_KEY_ACTIVATION_ISSUE`

**Date:** 2026-09-10  
**Scope:** Identify the BALLDONTLIE secret each runtime uses, compare by fingerprint cluster only, align CLI naming, re-smoke games / injuries / odds. No props, no persistence, no schedule thaw, no season-pin change.

Fingerprints themselves are **not** stored in this report.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| `live_ingestion_enabled` | `false` |
| nightly / injuries / odds / boxscore EventBridge | **DISABLED** |
| props Scheduler | **DISABLED** |
| injuries + odds Lambda freeze | `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1` |
| limiter | `BDL_RATE_LIMIT_INTERVAL_MS=13000` |
| `PINNED_ANALYTICS_SEASON` | **2025** |
| Persistence | none |
| Player props HTTP | not invoked |
| Market Movement capture | not invoked |
| Terraform apply | not run |

---

## Credential Source Inventory

### Local CLI

| Source | Present | Notes |
| --- | --- | --- |
| Shell `BALLDONTLIE_API_KEY` | no | does not override dotenv |
| Shell `BALDONTLIE_API_KEY` | no | |
| `.env` canonical `BALLDONTLIE_API_KEY` | yes after 13D.2 | was missing; only typo alias existed |
| `.env` typo `BALDONTLIE_API_KEY` | yes | canary already fell back to this |
| `.env.local` | absent | canary does not load it |
| `.env.development.local` | absent | |

Canary loader: `dotenv` on repo-root `.env` only. Default dotenv does **not** override an already-set shell variable.

### AWS Lambda

| Function | `BALLDONTLIE_API_KEY` |
| --- | --- |
| `nightly-bdl-updater` | present |
| `injuries-snapshot` | present |
| `odds-pre-game-snapshot` | present |
| `nba-player-props-ingestion-lambda` | present (audit only; not invoked) |
| `nba-player-props-controller-lambda` | present (audit only; not invoked) |

Terraform maps `var.lambda_env` / `odds_lambda_env` / `injuries_lambda_env` / `player_props_lambda_env` into Lambda `environment.variables`. No Secrets Manager. No SSM.

### Vercel (audit only, unchanged)

`vercel.json` crons are paper-settle and prune-props. Next.js `app/` does not read `BALLDONTLIE_API_KEY`. Serving-data move remains later work.

### CI

No GitHub workflow in this repo injects the BDL key.

---

## Environment Precedence

1. Process/shell environment (wins; dotenv will not override)
2. Repo-root `.env` via canary `loadEnv({ path: '.env' })`
3. Typo alias `BALDONTLIE_API_KEY` if the canonical name is empty
4. AWS: Lambda environment from last `terraform apply` of tfvars maps (console edits are overwritten on the next apply)
5. Terraform state holds the same maps (`sensitive = true` redacts CLI; state still stores values)

---

## Safe Fingerprint Comparison

Helper: `sha256(secret).slice(0, 12)` via `lib/balldontlie/credential-fingerprint.ts`.  
Diagnostic: `npx tsx scripts/ops/2026-bdl-credential-alignment.ts`

All **present** sources hashed to a **single cluster** (`cluster-A`):

- `.env` typo alias
- `.env` canonical name (after 13D.2 copy)
- all four tfvars BDL keys
- terraform state (one unique value)
- nightly, injuries, odds, props worker, props controller Lambdas

Dashboard-confirmed GOAT fingerprint: **not available** (owner did not supply a compare token). Entitlement remains `BDL_ENTITLEMENT_CONFIRMED_GOAT` from dashboard confirmation, not from HTTP 200.

No whitespace padding, no embedded newlines, no `Bearer ` prefix on any present source.

---

## Mismatch Root Cause

**Not a CLI vs AWS copy mismatch.** Every runtime copy is `cluster-A`.

Exact path that produced 13D.1 401s:

1. Canary and Lambdas already shared the same key.
2. Local `.env` stored that key only under the typo name `BALDONTLIE_API_KEY` (canonical name was empty). Canary still resolved it via fallback, so this was **not** the 401 cause.
3. `GET /nba/v1/games` with the same key and raw `Authorization` header returns **200**.
4. `GET /nba/v1/player_injuries` and `GET /v2/odds` return **401 Unauthorized**.

So this is **not** “stale local vs new AWS.” It is: **the key actually deployed everywhere is authorized for free-tier games and not for injuries/odds**, despite owner-confirmed GOAT on the dashboard.

Most likely remaining explanations (cannot distinguish without a dashboard fingerprint or a newly pasted GOAT key):

- The GOAT dashboard key is a **different** credential that was never copied into `.env` / tfvars / Lambda.
- This `cluster-A` key has not had NBA GOAT (or All-Star injuries) **activated** on BALLDONTLIE’s side yet.

Terraform would **not** have overwritten a correct AWS key with a different local key: tfvars and Lambda already match.

---

## Auth Header Verification

Production workers and `fetchBdlLive` send `Authorization: <raw key>` (no `Bearer`).  
`fetchBdlLive` does not rewrite headers.

13D.2 now builds that header through `bdlAuthorizationHeader`, which strips surrounding whitespace and a mistaken `Bearer ` prefix.

Games smoke **200** certifies that construction for this key. Injuries/odds **401** are therefore entitlement/activation, not a double-Bearer or newline bug.

---

## CLI Alignment

- Canonical `BALLDONTLIE_API_KEY` appended to local `.env` from the existing typo alias (same `cluster-A`; `.env` not committed).
- Canary uses `bdlAuthorizationHeader`.
- `.env.example` documents canonical vs typo.

---

## AWS Alignment

No Lambda env update. Deployed injuries/odds already match CLI `cluster-A`. Writing the same value would not change 401s. Schedules left DISABLED; freeze env unchanged.

Props worker/controller also `cluster-A`. Not invoked.

---

## Terraform / Secret Persistence Risk

`lambda_env` (and sibling maps) are `sensitive = true` but **the key is stored in Terraform state**. Anyone with state access can read it. There is no Secrets Manager/SSM pattern today; 13D.2 did **not** start a secrets-manager migration.

**Convention (smallest):** untracked `infra/terraform.tfvars` is the AWS source of truth. All four env maps must share one `BALLDONTLIE_API_KEY`. `terraform apply` overwrites Lambda env from those maps — do not set the key only in the AWS console. Before apply, run the fingerprint alignment script. Documented in `infra/terraform.tfvars.example` and `docs/production-security.md`.

---

## Injuries Re-Canary

`GET /nba/v1/player_injuries` via `fetchBdlLive` at 13s.

| Field | Value |
| --- | --- |
| Requests | 1 |
| 200 | 0 |
| 401 | 1 (`Unauthorized`) |
| 429 | 0 |
| Retries | 0 |

---

## Odds Re-Canary

Endpoint-tier check after games 200 vs injuries 401 (not a blind second guess).

`GET /v2/odds`

| Field | Value |
| --- | --- |
| Requests | 1 |
| 200 | 0 |
| 401 | 1 (`Unauthorized`) |
| 429 | 0 |
| Retries | 0 |
| Coverage | **`UNAUTHORIZED`** (not `NO_CURRENT_MARKET`) |

---

## Live Payload Smoke Result

| Probe | HTTP | Rows |
| --- | --- | --- |
| `GET /nba/v1/games?seasons[]=2026&per_page=1` | **200** | n/a (auth format smoke) |
| Injuries | 401 | 0 |
| Odds | 401 | 0 vendors |

No live injury/odds payload shape to certify. No persistence.

---

## HTTP Accounting

### Injuries
1 request, 0×200, **1×401**, 0×429, 0 retries, Dynamo grant wait 0 ms

### Odds
1 request, 0×200, **1×401**, 0×429, 0 retries, Dynamo grant wait 0 ms

### Games smoke (pre-paid)
1 request, **1×200**, 0×401, 0×429

---

## Freeze Verification

Re-checked: all listed EventBridge rules DISABLED; props Scheduler DISABLED; injuries/odds `replay/1/1` + interval 13000; pin 2025. Quota ConcurrentExecutions **10**, history empty → **`NOT_REQUESTED`**. Quota is not the 401 cause.

---

## Remaining Blockers

1. **`PROVIDER_ENTITLEMENT_OR_KEY_ACTIVATION_ISSUE`** — aligned `cluster-A` key still 401s injuries and odds.
2. Owner must put the **dashboard GOAT key** into `.env` **and** all four tfvars maps (do not paste it into chat), then re-run the fingerprint script. A real GOAT key should appear as a **new cluster**, not `cluster-A`.
3. Then `terraform apply` with `live_ingestion_enabled=false` to push that key to Lambda without thawing schedules.
4. Re-run 13D.2/13D.1 canary for 200s. Do not start 13E until those 200s exist.

If the dashboard key fingerprints as `cluster-A` and BDL still 401s, this is provider support / key regeneration — not more ingestion code.

---

## Recommendation

Do **not** start 13E. Do **not** enable recurring ingestion.

Next human action: replace `cluster-A` everywhere with the key shown on the confirmed GOAT dashboard (or regenerate that key), fingerprint until a new cluster appears, apply Terraform with freeze still on, re-canary injuries then odds.

Keep the 13s canary rate.

---

## Verification Checklist

1. Run `npx tsx scripts/ops/2026-bdl-credential-alignment.ts` and confirm a **single** present cluster (today: `cluster-A`).
2. Confirm `.env` now has canonical `BALLDONTLIE_API_KEY` (do not commit `.env`).
3. Confirm games smoke 200 and injuries/odds 401 with the same header helper.
4. Confirm schedules still DISABLED and Lambda still `replay/1/1`.
5. After pasting the dashboard GOAT key, re-fingerprint: expect a **new** cluster vs today’s `cluster-A`.
6. Do not enable `live_ingestion_enabled`.
7. Do not start props.

---

## Step Verdict

`YELLOW — runtime credential is aligned but provider still rejects entitled endpoints`
