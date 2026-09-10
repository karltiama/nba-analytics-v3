# 2026–27 GOAT Key Replacement Recanary — Step 13D.3

**Step verdict:** `YELLOW — replacement credential is deployed but provider still rejects entitled endpoints`

**Classification:** `PROVIDER_KEY_OR_ENTITLEMENT_STILL_UNRESOLVED`

**Date:** 2026-09-10  
**Retry:** Owner confirmed the first 13D.3 pass used a tfvars value they had **not** updated. This pass used the current untracked `infra/terraform.tfvars` as the GOAT source, copied it to `.env`, applied Lambda env, recanaried.

Fingerprints are not stored here.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| `live_ingestion_enabled` | `false` |
| EventBridge ingestion rules | **DISABLED** after apply |
| props Scheduler | **DISABLED** after apply |
| injuries Lambda freeze | `replay` / `1` / `1`, interval **13000** |
| Persistence | none |
| Props HTTP | not invoked |
| Season pin | **2025** |

---

## Sensitive Log Cleanup

Unchanged from earlier 13D.3: local Cursor transcript redaction; not Git. Owner rotated before retry.

---

## Credential Replacement

**First pass (wrong source):** treated then-tfvars as the new key and copied it onto `.env`. Owner: tfvars had not been updated.

**This pass:**

1. Fingerprint showed `.env` + AWS on one cluster, **tfvars on a different cluster** (owner had just edited tfvars).
2. `--sync-dotenv-from-tfvars` replaced canonical `BALLDONTLIE_API_KEY` from that tfvars value (not committed).
3. Typo alias remains commented out.
4. Frozen apply pushed that value to nightly, injuries, odds, props worker, props controller.

---

## Fingerprint Cluster Before / After (this retry)

| Moment | `.env` canonical | tfvars | AWS Lambdas |
| --- | --- | --- | --- |
| Before copy | cluster-X (matched AWS) | **cluster-Y (tfvars edit)** | cluster-X |
| After copy | cluster-Y | cluster-Y | cluster-X |
| After apply | **one cluster** (`.env` = tfvars = all five Lambdas) | same | same |

Alignment-script labels (`cluster-A`/`B`) reset by source order; the invariant is: CLI, tfvars, and AWS now match.

---

## Terraform Plan / Apply

Plan `infra/13d3-key.tfplan` (gitignored): **0 add, 5 change, 0 destroy**.

- All five BDL Lambdas: `environment.variables` (sensitive) — credential
- Nightly + odds also `source_code_hash` (local zip vs deployed)
- No schedule enablement in the plan

**Apply complete:** 0 added, **5 changed**, 0 destroyed. `live_ingestion_enabled=false` kept rules DISABLED.

---

## AWS Credential Verification

Nightly, injuries, odds, props worker, props controller all match the post-copy `.env`/tfvars cluster. Props not invoked.

---

## Freeze Verification

After apply: all listed EventBridge rules **DISABLED**; props Scheduler **DISABLED**; injuries `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`, `BDL_RATE_LIMIT_INTERVAL_MS=13000`.

---

## Games Smoke

`GET /nba/v1/games?seasons[]=2026&per_page=1` via `fetchBdlLive`  
**HTTP 200** at `2026-09-10T23:10:47Z`

---

## Injuries Re-Canary

`GET /nba/v1/player_injuries`  
**HTTP 401** `Unauthorized` at ~`2026-09-10T23:11Z`

**Stopped.** Odds not called.

---

## Live Injury Payload

Not inspectable (401, 0 rows). Dry-run zeros. `massClearBlocked=true`.

---

## Odds Re-Canary

Skipped after injuries 401.

---

## Live Odds Payload

Not run.

---

## Transform Dry Runs

Injury dry-run 0/0/0. No persistence.

---

## First Observed Regression

Prior 13D.3 run: 18 related tests passed. Architecture not reopened.

---

## Secret-State Risk

Key remains in Terraform state. Secrets Manager migration is a later follow-up, not this 401.

---

## Lambda Quota Status

ConcurrentExecutions **10**, **`NOT_REQUESTED`**. Props reserved concurrency unapplied (`-1`). Not the 401 cause.

---

## HTTP Accounting (this retry)

| Probe | Requests | 200 | 401 | 429 |
| --- | --- | --- | --- | --- |
| Games smoke | 1 | **1** | 0 | 0 |
| Injuries | 1 | 0 | **1** | 0 |
| Odds | 0 | — | — | — |

---

## Remaining Blockers

`PROVIDER_KEY_OR_ENTITLEMENT_STILL_UNRESOLVED`

CLI, tfvars, and AWS now share one credential. That key authorizes **games** and still **401s injuries**. Same shape as 13D.2, now with tfvars actually updated and applied.

### BALLDONTLIE support packet (no secret)

| Field | Value |
| --- | --- |
| Account tier (owner-confirmed) | NBA GOAT |
| `GET /nba/v1/games` | **200** — 2026-09-10T23:10:47Z |
| `GET /nba/v1/player_injuries` | **401** — ~2026-09-10T23:11Z |
| `GET /v2/odds` | not called after injuries 401 |
| Header | raw `Authorization` (no Bearer) |

---

## Recommendation

Do **not** start 13E. Do **not** thaw schedules. Ask BALLDONTLIE to enable NBA GOAT (injuries All-Star+ / odds GOAT) on the key now in the dashboard, `.env`, tfvars, and Lambdas.

---

## Verification Checklist

1. `.env` canonical matches tfvars and all five BDL Lambdas (do not commit `.env`/tfvars).
2. Apply was 5 Lambda env updates; schedules still DISABLED.
3. Games **200**, injuries **401**, odds not called.
4. Freeze `replay/1/1`, interval 13000.
5. Do not start props.

---

## Step Verdict

`YELLOW — replacement credential is deployed but provider still rejects entitled endpoints`
