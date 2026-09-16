# Court Context prospective activation handoff

**Updated 2026-09-16 after the injuries entitlement probe.** SQL, Terraform, schedules, live ingestion, and notifications were not executed. Prepared code is not running. Frozen C / production / WOWY known-Out r1 / `nba-game-status-sync-schedule` unchanged.

## Lead

**Injuries-only collection is not ready to activate.** The existing BDL credential was **denied** on the injuries endpoint (HTTP 401). Shadow prediction remains separately **not ready**.

What still blocks injuries-only:

1. **Entitlement denied for this request.** Probe `GET https://api.balldontlie.io/nba/v1/player_injuries?per_page=1` at 2026-09-16T12:06:56.221Z returned HTTP 401, non-JSON body, no rate-limit headers. Evidence: `reports/operations/bdl-injuries-entitlement-probe.json`. Do not infer the precise plan or key-mismatch cause from 401 alone.
2. **Required collection schema is missing in the target database.** `raw.injury_pull_membership`, `raw.injury_pull_runs.completeness_reason`, `raw.injury_pull_runs.health_class`, and history `observed_at` / `game_id` / `game_link_provenance` are absent. Do not apply SQL until access is confirmed.
3. **Injuries Lambda is frozen.** Deployed env is `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`. EventBridge rule `injuries-snapshot-schedule` is **DISABLED**.
4. **Human apply step.** Production SQL and the scoped Terraform overlay have not been applied.

What does **not** block injuries-only: shadow scoring, odds, props, GOAT post-tip lineups, nightly box scores.

What **would** block a naive freeze-all apply: `nba-game-status-sync-schedule` is **ENABLED**. Setting `live_ingestion_enabled=false` would disable it.

## Work completed (prep only)

| Item | Evidence |
| --- | --- |
| Research record 399→625 = **+226** | `reports/modeling/wowy-known-out-r1/cohort-delta.json`, `research-record-corrections.md` |
| Inner 127 is λ selection; final fit is 394 | `scripts/run-wowy-known-out-residual.ts` `selectLambda` then `fitAndApply(usableTrain, …)`; not refit |
| Inconclusive decision preserved | `results.json` `decision.label=inconclusive`; Model Lab notes |
| Empty success ≠ failed fetch | completeness reason `empty_successful_provider_response` vs `pull status is not success` |
| Membership `in_report=false` without Available | `planInjuryPullMembership`; incomplete pulls do not write omissions |
| Game join unknown if ambiguous | `lib/injuries/game-association.ts` |
| WOWY research inputs (not predictions) | `db/schemas/MIGRATION_wowy_research_inputs.sql`, `lib/wowy/research-input.ts` |
| Entitlement probe (executed, denied) | `reports/operations/bdl-injuries-entitlement-probe.json` |
| Scoped overlay that keeps status-sync | `infra/activation/injuries-only.tfvars.example` |
| Material-risk tests | `lib/injuries/__tests__/activation-risks.test.ts` |
| Model Lab copy | History badges include exploratory / inconclusive; prospective **Not started.**; frozen C role shown separately from residual ids |

## Browser verification (separate from adapter tests)

`/parlay-xray` compiles and renders (the earlier duplicate-export blocker is gone). `/admin/model-lab` loaded 2026-09-16:

- History: learned r1 comparisons present; **WOWY known-Out residual r1** badge `partial · exploratory · inconclusive`; models `frozen_c (frozen_shadow)`, `residual_role (baseline)`, `residual_wowy (candidate)`; prospective split **Not started.**
- Frozen shadow PTS C / REB C is a separate card from the residual experiment.
- Status: production unchanged; frozen C hashes; deployment paused; prospective **Not started.**
- Compare: historical A vs C MAE on learned-r1 validation.
- Hypothetical/reconstructed copy is on the WOWY cards.

Adapter tests remain a separate claim. The page logged missing `analytics.shadow_run_records` (expected; schema not applied).

## Operational state (read-only, 2026-09-16)

AWS EventBridge:

| Rule | State |
| --- | --- |
| `nba-game-status-sync-schedule` (Scheduler) | **ENABLED** |
| `injuries-snapshot-schedule` | DISABLED · `cron(0 13,18,22 * * ? *)` |
| `nightly-bdl-updater-daily` | DISABLED |
| `boxscore-scraper-daily` | DISABLED |
| odds-pre-game-snapshot-schedule-0..8 | DISABLED |
| `nba-player-props-0..2` | DISABLED |

Injuries Lambda `injuries-snapshot`: nodejs22.x, timeout 120s, last modified 2026-09-11, env freeze flags as above. No `COLLECTION_SCHEMA_MODE` key (defaults optional). `BDL_GOAT_SUBSCRIPTION` unset.

Local `infra/terraform.tfvars`: `live_ingestion_enabled=true`, `game_status_sync_execution_enabled=true`, `injuries_enable_schedule=true`, **`injuries_execution_enabled` not set (defaults false)**. That is why the injuries rule exists but stays DISABLED. Turning every global flag off is **not** a safe disabled plan.

Target DB: `raw.injury_pull_runs` 181 rows, `raw.player_injuries` ~24k, history 4,801 change rows. **No** membership table, prediction snapshots, shadow run records, or `analytics.wowy_research_inputs`. Identity quarantine table exists (0 rows). Roster input `raw.nba_roster_snapshots` exists; the injuries collector does not fetch a live roster — it uses BDL injury rows + `analytics.player_provider_ids` serving projections.

## Database migration plan (reviewable, not applied)

**Injuries-only minimum:** statements 1 of `db/schemas/MIGRATION_context_collection_snapshots.sql` (injury pull health columns, `source_published_at`, `raw.injury_pull_membership`, history `observed_at` / `source_published_at` / `report_membership` / `game_id` / `game_link_provenance`).

**Optional same file, not required to collect injuries:** lineup snapshot tables, prediction snapshots, settlements, shadow run records, window anchors.

**WOWY research inputs (separate, not required to collect injuries):** `db/schemas/MIGRATION_wowy_research_inputs.sql`.

Do not enable RLS in this slice; many `raw`/`analytics` tables currently have RLS off (existing posture). Do not auto-apply the advisor SQL.

Permissions: injuries Lambda DB role needs INSERT/UPDATE on `raw.injury_pull_runs`, `raw.player_injuries`, `raw.injury_pull_membership`; INSERT on history; UPSERT current; INSERT identity quarantine. No odds/props/shadow tables required for injuries-only.

## Scoped Terraform / resource changes

Do **not** apply `terraform.tfvars.example` freeze-all. Overlay `infra/activation/injuries-only.tfvars.example` onto the live tfvars.

Expected plan (after SQL + injuries env live flags):

| Resource | Action |
| --- | --- |
| `aws_cloudwatch_event_rule.injuries_schedule` | update `state` DISABLED → ENABLED |
| `aws_lambda_function.injuries_snapshot` | update env DATA_MODE/OFFSEASON/CRON_DRY_RUN (and COLLECTION_SCHEMA_MODE after SQL) |
| `aws_scheduler_schedule.game_status_sync` (`nba-game-status-sync-schedule`) | **no change / still ENABLED** |
| shadow / nightly / odds / props / boxscore / postgame | **no execution enable** |

If `terraform plan` also wants to replace Lambda zips because local `.package` hashes drifted, review that separately; do not mix a code-rolling apply with first activation unless intended.

## Entitlement probe (executed)

```text
npx tsx scripts/ops/bdl-injuries-entitlement-probe.ts --execute
```

| Field | Result |
| --- | --- |
| Requested at | 2026-09-16T12:06:56.221Z |
| Endpoint | `GET https://api.balldontlie.io/nba/v1/player_injuries?per_page=1` |
| HTTP status | **401** |
| Expected injuries JSON `{ data: array, meta?: object }` | no (body was not JSON) |
| Records returned | n/a |
| Rate-limit / retry headers | none observed |
| Access | **denied** |

One GET. No pagination, ingestion, or database writes. Credentials and body omitted. A 401 does not identify whether the cause is plan, key, or another auth failure.

## Ordered activation (later decision)

Injuries-only (blocked on access until a 200 is recorded):

1. Resolve injuries-endpoint access for the existing BDL account/credential. Re-run this same probe after that change. Do not purchase from this task.
2. Only after HTTP 200: apply injury statements of `MIGRATION_context_collection_snapshots.sql`. Confirm `to_regclass('raw.injury_pull_membership')` is not null.
3. Terraform apply **only** injuries overlay: `injuries_execution_enabled=true`, injuries env `live_api` / `0` / `0`, `COLLECTION_SCHEMA_MODE=required`. Leave `game_status_sync_execution_enabled=true`. Leave `shadow_execution_enabled=false` and other families false.
4. Confirm `injuries-snapshot-schedule` ENABLED and `nba-game-status-sync-schedule` still ENABLED.
5. Wait for one scheduled run or a single manual invoke **after** that decision. First-run evidence below.

Rollback injuries: `injuries_execution_enabled=false` and/or injuries env back to replay/1/1. Does not delete pull runs. Does not touch game_status_sync.

Shadow (separate, later):

1. Linux-build Python scorer (`python3.11`, catboost 1.2.8) so the zip is manylinux/x86_64, not Windows wheels. Unzipped `.package` < 250MB.
2. `npm run build:shadow-projection-lambda` and checksum match `manifest.json`.
3. Apply remaining snapshot SQL (prediction + shadow run tables).
4. `shadow_create=true` CODE_ONLY first, schedule DISABLED.
5. Nightly box entitlement for settlement (`/v1/stats`) still unknown (prior related 401).
6. Only then `shadow_execution_enabled=true`. Do not backdate `generated_at`.

## First-run evidence (injuries)

Success:

- `raw.injury_pull_runs` row `status=success`, `health_class=ok`, `completeness_reason=successful complete pull`.
- `raw.injury_pull_membership` rows with `in_report=true` for listed players.
- Unchanged Out re-listed: raw row on the new pull, **no** extra history change row.
- Failed later pull: `status=error` or `health_class=degraded_failed_latest`; current board retained; no mass RemovedFromReport.
- Empty 200: `empty_successful_provider_response`, `incomplete_latest`, no Available, no mass-clear.
- Unresolved BDL ids in `analytics.player_identity_unresolved`, not on the serving board.
- Ambiguous team-night: `game_id` null, provenance none.

Freshness monitoring: last successful `pulled_at` age vs 48h research window; `health_class` of latest run; membership table non-empty on complete runs.

## Readiness states

| Surface | State |
| --- | --- |
| Injuries-only collection | **Not ready.** Injuries endpoint access **denied** (HTTP 401). Schema still missing; schedule still DISABLED. Implementation is not running. |
| Shadow PTS C / REB C | **Not ready.** Scorer `.package` not present in-repo; Windows pip would be the wrong architecture; snapshot tables missing; nightly settlement path disabled; `shadow_create=false`. Protocol r1.1 unchanged. |
| WOWY known-Out r1 | **Closed / inconclusive.** No prospective claim. |
| Frozen C / production projections | Unchanged. |

## Request volume (proposed injuries cadence)

3 runs/day × `per_page=100`. Typical complete pull ~110–150 rows ≈ 2 pages ≈ **6 GETs/day**, serialized by the existing 13s / burst-1 limiter. Injuries family does not call odds, props, or lineups.

## Commands not run

- No `terraform apply`
- No production SQL
- No EventBridge enable
- No Lambda invoke
- No further provider calls after this 401
- No SNS

The injuries entitlement probe **was** executed once (401). No Terraform, SQL, schedule, collector, or notification actions.
