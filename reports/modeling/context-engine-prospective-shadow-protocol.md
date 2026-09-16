# STEP 14M.C1 — Context Engine + Prospective Shadow Evaluation Protocol

## Executive Result

Court Context now has a frozen model-status registry, a versioned prospective prediction contract, and a shared Context Engine contract. Production 70/30 is unchanged. PTS C and REB C remain frozen shadow candidates. Model D stays not promoted. WOWY remains inconclusive. Live injury collection and shadow scoring stay disabled. Provider entitlement remains blocked. No models were retrained. A persistence migration is proposed and not applied.

GREEN — frozen model candidates, shared Context Engine contract, and prospective evaluation protocol are ready; live evidence collection remains intentionally blocked

## Existing Model Lab Audit

`/admin/model-lab` already exists as a research workbench (`app/admin/model-lab/page.tsx`). It does not train, deploy, or serve production predictions.

Reusable:

| Area | Location | Status |
| --- | --- | --- |
| Experiment catalog | `lib/model-lab/registry.ts` | Reused. Not duplicated. |
| Metrics | MAE, RMSE, signed bias, coverage, n, paired ΔMAE | Reused as primary metrics. |
| Split kinds | training / selection / historical_confirmation / prospective_shadow | Reused; historical confirmation is already “not pristine holdout.” |
| Production copy | `lib/model-lab/status.ts` | 70/30 DNP-inclusive `computeProjection`. |
| PTS C / REB C freeze | `reports/modeling/shadow-pts-reb-c-r1/manifest.json` | SHA-256, feature spec, training config already recorded. |
| Shadow protocol r1.1 | `lib/betting/player-projection-shadow-protocol.ts` | T−60 cutoff, on-time vs late, 60-day window. |
| Shadow scoring helpers | `lib/betting/player-projection-shadow-scoring.ts` | First-write-wins snapshots; settlement is append-only. |
| Shadow SQL store | `lib/betting/player-projection-shadow-store.ts` | Isolated from Next.js request path. |
| Worker / Terraform | `lib/betting/player-projection-shadow-worker.ts`, `infra/shadow-projection.tf` | Implementation complete. Defaults paused. |
| Injury collector | `lib/injuries/collector-persist.ts`, Lambda package | Code ready, not activated. |
| As-of helpers | `lib/context/collection-asof.ts` | Freshness, membership, prediction snapshot clock. |
| WOWY v1 | `lib/wowy/` | Game-level participation WOWY, not possession on/off. |
| Availability gate | `lib/wowy/availability-gate.ts` | Missing ≠ Available; missing ≠ healthy. |

Missing before this step:

- One source of truth for **lifecycle status** (70/30 vs PTS C vs REB C vs D vs WOWY).
- Production 70/30 as the prospective **control** (existing `pred_a` is played-only Track A).
- Per-market prediction identity and explicit shadow cohorts.
- Shared Context Engine fact/signal/reliability/feature/interpretation contract.
- Pre-registered evaluation-report shape and activation checklist that includes a separate box-score canary.
- Walk-forward + missing-data rules as Model Lab protocol tests.

Shadow infrastructure readiness: **PARTIAL**. Injury collection: **DISABLED**, provider **BLOCKED_BY_ENTITLEMENT**.

## Frozen Model Registry

Source of truth: `lib/model-lab/lifecycle-registry.ts` (`court-context-model-lifecycle-c1.0`).

This is separate from the experiment catalog. The catalog remains the scored-artifact list. The lifecycle registry is model-status.

| Model | Status |
| --- | --- |
| 70/30 baseline | PRODUCTION_CONTROL |
| PTS C | FROZEN_SHADOW_CANDIDATE |
| REB C | FROZEN_SHADOW_CANDIDATE |
| Model D | RESEARCH_ONLY_NOT_PROMOTED |
| WOWY availability adjustment | RESEARCH_INCONCLUSIVE |

PTS C / REB C are **not** production-certified. WOWY is **not** classified as failed or ineffective.

## 70/30 Control

Production control remains `computeProjection` in `lib/betting/player-prop-model.ts`:

`0.7 * last10Avg + 0.3 * seasonAvg`

DNP-inclusive. Weights were not changed.

Played-only research Track A is **not** this control. Future prospective scoring must record production 70/30 separately from research A/B.

## PTS C / REB C Freeze

Identifiers taken from the existing freeze, not retrained.

| Field | PTS C | REB C |
| --- | --- | --- |
| Status | FROZEN_SHADOW_CANDIDATE | FROZEN_SHADOW_CANDIDATE |
| Model version | `player-projection-learned-r1-pts-reb-c` | same |
| Feature spec | `player-projection-learned-features-r1` | same |
| Artifact SHA-256 | `23176a81…7321421` | `2acd2b6c…8bc6469` |
| Config | depth 6, lr 0.08, l2 3, 500 iter, best 171 | depth 6, lr 0.03, l2 3, 800 iter, best 294 |
| Seed / loss | 20260914 / RMSE | 20260914 / RMSE |
| Trained/frozen at | 2026-09-15T02:24:00.000Z | same |
| Deterministic fingerprint | `28fad7ef…bbcda470` | `183deba9…c70d683a` |

Training-data freeze:

- dataset SHA-256 `20d90fed…556e5fa`
- feature spec SHA-256 `7644e819…fab4c8b3`
- feature order SHA-256 `1ad8e619…67e75b`
- code commit `da7763d9…40b0848`
- `models_retrained: false`

Tests assert these hashes still match `reports/modeling/shadow-pts-reb-c-r1/manifest.json`.

## Model D Status

RESEARCH_ONLY_NOT_PROMOTED.

Additional schedule/team/opponent context did not show consistent incremental gain over C. Not a shadow candidate. Artifacts may still exist under learned-r1; they are not in the frozen shadow bundle.

## WOWY Status

RESEARCH_INCONCLUSIVE.

Game-level participation WOWY v1, **not** possession-based on/off. Historical teammate-absence experiment remains inconclusive. Usable pregame availability history is the main limitation. A WOWY difference is **not** a projection adjustment.

## Historical Evidence Boundaries

| Item | Recorded status |
| --- | --- |
| Original modeling player-games | 83,479 |
| Injury observations | March–May 2026 only |
| Known-Out qualified player-games | 625 after safety/freshness filters |
| WOWY known-Out eval examples | 231 across ~12 dates |
| 2023 train / 2024 selection / 2025 confirmation | development / validation / previously inspected |
| Previously inspected periods | **not** untouched holdout |

Default config cannot relabel `historical_confirmation` as pristine holdout.

## Prospective Evaluation Protocol

Machine-readable record: `PROTOCOL_MACHINE_RECORD` in `lib/model-lab/prospective-shadow-protocol.ts`.

Version: `context-engine-prospective-shadow-c1.0`  
Extends: `player-projection-shadow-pts-reb-c-r1.1-timing`

For each eligible player/market prediction, generate **before** the game. Feature cutoff remains scheduled tip minus 60 minutes. Do not include future outcomes at prediction time. Later evaluation uses captured-at-prediction-time features only.

Live scoring is **not** started.

## Prediction Record Contract

Required fields on `ProspectivePredictionRecord`:

- prediction id
- generated_at
- context cutoff
- game id
- scheduled tip
- player canonical id
- team / opponent
- market
- sportsbook line if applicable
- model version / feature version
- production 70/30 control prediction
- frozen Candidate C prediction
- captured feature values and event timestamps
- candidate context fields available
- missing context fields
- data freshness
- eligibility flags
- experiment cohort flags
- Context Engine snapshot (nullable; freeze whatever was actually available)

`createProspectivePrediction` rejects generated_at after cutoff and rejects captured feature events on or after cutoff.

## Outcome Join Contract

Prediction row is immutable once generated. Outcome is a separate append-only record (`ProspectiveOutcomeRecord`). `joinOutcome` does not rewrite prediction values. `rewritePredictionAfterOutcome` throws. If correction metadata is needed later, append audit metadata.

## Market-Specific Evaluation

PTS and REB are separate cohorts. Pooling them into one headline score is forbidden.

Primary metrics, reused from Model Lab:

- MAE
- RMSE
- signed error / bias
- n
- coverage
- prediction availability
- candidate-vs-control delta (paired, same player-games)

No new headline metric.

## Shadow Cohorts

| Cohort | Comparable to full baseline population? |
| --- | --- |
| ALL_ELIGIBLE_PTS_C | Yes, vs 70/30 on the same PTS rows |
| ALL_ELIGIBLE_REB_C | Yes, vs 70/30 on the same REB rows |
| AVAILABILITY_KNOWN | No |
| TEAMMATE_OUT_QUALIFIED | No |
| WOWY_QUALIFIED | No; same-example comparison only |

## WOWY Prospective Cohort

Future WOWY test:

Candidate C vs Candidate C + availability/WOWY candidate  
**on the same qualified examples.**

Do not compare 70/30 full population vs WOWY-restricted population and infer causal improvement. WOWY promotion requires incremental value beyond Candidate C.

## Context Engine Architecture

```
AS-OF-SAFE FACTS
  → CONTEXT SIGNALS
    → RELIABILITY / AVAILABILITY
      → CONSUMERS (projections, Parlay XRay, Props Explorer, player/game pages, Context Check, Model Lab)
```

This is not an XRay-only model. Consumers must not own basketball truth in the core engine.

Contract id: `court-context-engine-c1`  
Contract version: `court-context-engine-c1.0`  
Production-certified engine: **false** (contract is certified; live signals are not).

## Fact Layer

Candidate fact categories: MINUTES, PRODUCTION, OPPORTUNITY, AVAILABILITY, WOWY, MATCHUP, MARKET.

Each fact records value, observed_at, source, as-of-safe flag, and whether it is live-available. Missing facts stay missing. This step does not claim all categories are currently available live. Availability and market movement are blocked by entitlement / data.

## Signal Layer

| Signal | Status | Threshold |
| --- | --- | --- |
| MINUTES_ELEVATED / REDUCED | EXPERIMENTAL | THRESHOLD_NOT_CERTIFIED |
| ROLE_EXPANSION / CONTRACTION | EXPERIMENTAL | THRESHOLD_NOT_CERTIFIED |
| OPPORTUNITY_ELEVATED / REDUCED | EXPERIMENTAL | THRESHOLD_NOT_CERTIFIED |
| TEAMMATE_OUT | DEFINED | no new numeric cut; requires as-of-safe Out |
| TEAMMATE_RETURNED | BLOCKED_BY_DATA | Available vocabulary not certified |
| WOWY_DIFFERENCE_PRESENT | DEFINED | not an adjustment |
| SMALL_WOWY_SAMPLE | DEFINED | existing floors 2 / 8 |
| MATCHUP_PACE_* | EXPERIMENTAL | THRESHOLD_NOT_CERTIFIED |
| MARKET_REPRICED_* | BLOCKED_BY_DATA | movement snapshots not certified live |

No new arbitrary thresholds were invented.

## Reliability Contract

Reliability is separate from direction. Opaque confidence percentages are forbidden.

Dimensions: sample count, recency, freshness, source availability, historical coverage, stability (`THRESHOLD_NOT_CERTIFIED`), qualification status.

Semantic states: INSUFFICIENT, LIMITED, MODERATE, STRONG.

Only WOWY sample floors are already certified (`wowy_support_policy_v1`). Other state cuts remain `THRESHOLD_NOT_CERTIFIED`.

## Model Feature Boundary

FACT: teammate X is OUT  
SIGNAL: ROLE_EXPANSION candidate  
MODEL FEATURE: numeric value consumed by a projection model  
INTERPRETATION: “Recent role is elevated”

`assertLayerSeparation` rejects using a fact as a signal. These are not interchangeable.

## Interpretation Boundary

XRay (and other products) may later consume Context Engine signals as presentation. Example: engine `MINUTES_ELEVATED` → XRay “Recent minutes are above the player's season baseline.”

XRay is **not** wired in this step. XRay must not become the owner of basketball modeling logic.

## Availability Contract

Availability signals must preserve source, observed_at, status, freshness, game/player identity, and whether known before context cutoff.

Stale or post-tip observations do not qualify as pregame availability evidence. Missing availability is not healthy. Missing is not imputed Out.

Collection is **not** activated.

## WOWY Contract

WOWY = game-level participation WOWY v1, not possession on/off.

A future Context Engine WOWY signal exposes: teammate condition, WITH sample, WITHOUT sample, stat difference, minutes difference, cutoff, sample reliability.

`qualifyWowySignal` fails closed without as-of-safe Out and certified sample floors. `mayAdjustProjection` is always false.

## XRay / Product Consumer Boundary

Owner of basketball logic: Context Engine.  
XRay role: presentation consumer.  
Wired in this step: no.

Products may continue independently. This step does not change XRay, Props Explorer, or Parlay Explorer.

## Model Lab Responsibility

`/admin/model-lab` is the research surface for inspecting facts/signals, testing candidate features, comparing baseline vs candidate, inspecting failures, evaluating reliability, replaying development datasets, freezing versions, and reviewing prospective shadow results later.

It is not a production prediction endpoint.

## Walk-Forward Safety

Permanent Model Lab rule: for target game G, features may use only rows/events with timestamps **before** G’s cutoff. Later games cannot enter captured features. `lib/model-lab/walk-forward.ts` enforces this.

## Missing Data Behavior

Fail-closed:

| Condition | Behavior |
| --- | --- |
| Injury data unavailable | Candidate C usable without WOWY |
| Availability stale | Candidate C usable without WOWY |
| WOWY sample unqualified | Candidate C usable without WOWY |

Do not impute an OUT teammate. Do not treat missing availability as healthy.

## Shadow Infrastructure Status

**PARTIAL**, scoring **DISABLED**.

Ready in code: freeze bundle, r1 protocol, worker, scorer packaging, Terraform with paused defaults, as-of helpers, first-write-wins store.

Not ready for C1 activation: production 70/30 field, per-market logical identity, cohort flags, Context Engine snapshot persistence, provider entitlement, applied collection schema in the target DB, live writes.

Remaining before future activation is listed in Future Activation Sequence.

## Injury Collector Status

| Item | Record |
| --- | --- |
| Code readiness | READY_NOT_ACTIVATED |
| Storage | `raw.injury_pull_runs`, `raw.player_injuries`, membership table unapplied, `analytics.player_injury_status_history` |
| Schedule | `injuries-snapshot-schedule` `cron(0 13,18,22 * * ? *)` DISABLED |
| Freshness | collection-asof default 36h; stale/post-tip ≠ pregame |
| Required BDL entitlement | `GET /nba/v1/player_injuries` |
| Required deploy | injuries canary HTTP 200, SQL, injuries-only overlay, `COLLECTION_SCHEMA_MODE=required` |
| Provider | BLOCKED_BY_ENTITLEMENT |
| Last probe | 2026-09-16T12:06:56.221Z HTTP 401 |
| Activated this step | no |

## Fresh Box-Score Requirement

Future shadow outcome scoring requires fresh authoritative game/player results. Injury entitlement does **not** imply stats entitlement. When provider access returns, box-score/stats access must be verified separately.

## Future Activation Sequence

Do **not** execute now.

1. verify provider subscription/key
2. injury endpoint canary
3. fresh stats/box-score canary
4. verify identity mappings
5. verify timestamps/freshness
6. apply required deployment changes
7. activate injury collection
8. observe collection only
9. verify completeness/freshness
10. activate frozen shadow predictions
11. observe predictions before tip
12. join outcomes after final
13. accumulate untouched sample
14. evaluate control vs frozen candidate
15. separately evaluate WOWY-qualified cohort

## Freeze / Version Rules

Once prospective scoring begins, do not silently change model weights, model artifact, feature version, signal definitions, or qualification rules during an active evaluation cohort. A material change requires a new experiment/version.

## Sample-Size / Power Planning

`nTarget = POWER_ANALYSIS_REQUIRED_BEFORE_ACTIVATION`

A defensible paired-difference power estimate was **not** computed from residual dumps in this step (would require loading research `predictions.jsonl` and choosing an effect size after freeze). Inventing “500 games” is forbidden. Do not choose n from future observed results.

Calendar duration is reused from the already-certified shadow protocol: **60 calendar days** from the first regular-season tipoff (`SHADOW_PRIMARY_WINDOW_DAYS`). That is not a new invented floor.

## Future Evaluation Report Contract

`emptyProspectiveEvaluationReport()` pre-registers:

- model / feature versions
- evaluation window
- total eligible / scored / missing predictions
- market-specific MAE / RMSE / bias / coverage / delta
- availability-known, teammate-out, WOWY-qualified cohorts
- freshness/completeness
- exclusions with reason
- `cherryPickedDateRemovalForbidden: true`

## Model Lab UI Changes

Restrained Status-tab additions only:

- Research status summary: Production Control 70/30; Frozen Shadow Candidates PTS C / REB C; WOWY Inconclusive; Live Data blocked; Prospective Evaluation not started; Model D not promoted.
- Read-only Context Engine inspector using a historical/dev fixture.

PTS C / REB C are not shown as production models. No broad Model Lab redesign. XRay/product pages unchanged.

## Tests

Added:

- `lib/model-lab/__tests__/lifecycle-registry.test.ts`
- `lib/model-lab/__tests__/prospective-shadow-protocol.test.ts`
- `lib/context-engine/__tests__/contract.test.ts`

Covered: frozen registry, version immutability vs manifest, fact vs signal separation, missing availability ≠ healthy, WOWY cannot qualify without sample/context, prediction timestamp precedes cutoff, future rows cannot enter features, prediction immutability after outcome join, PTS/REB cohorts separate, WOWY same-example comparison, previously inspected data cannot be marked pristine holdout.

Ran: new contract tests plus learned-r1, compare, WOWY adapter, explorer, shadow scoring, collection-asof, injury activation-risks, and `lib/wowy/__tests__`. All passed. Candidates were not retrained.

## Files Changed

- `lib/model-lab/lifecycle-registry.ts`
- `lib/model-lab/dataset-roles.ts`
- `lib/model-lab/walk-forward.ts`
- `lib/model-lab/prospective-shadow-protocol.ts`
- `lib/model-lab/types.ts`
- `lib/model-lab/status.ts`
- `lib/model-lab/__tests__/lifecycle-registry.test.ts`
- `lib/model-lab/__tests__/prospective-shadow-protocol.test.ts`
- `lib/context-engine/contract.ts`
- `lib/context-engine/fixtures.ts`
- `lib/context-engine/__tests__/contract.test.ts`
- `components/admin/model-lab/LabStatus.tsx`
- `components/admin/model-lab/ContextEngineInspector.tsx`
- `sql/proposed/context-engine-prospective-shadow-protocol.sql`
- `reports/modeling/context-engine-prospective-shadow-protocol.md`
- `notes/learning-log/2026-09-16/step-14m-c1-prospective-shadow-protocol.mdx`

## Schema Changes

**PROPOSED_NOT_APPLIED**

`sql/proposed/context-engine-prospective-shadow-protocol.sql`

New additive tables `analytics.prospective_shadow_predictions` and `analytics.prospective_shadow_outcomes`. Existing `prediction_snapshots` remains for r1 research A/B/C. Production schema was not mutated.

Why required: current unique key cannot store per-market rows; `pred_a` is not production 70/30; cohort flags / missing context / Context Engine snapshot are not first-class frozen columns.

## Provider Calls

REAL_BDL_CALLS_THIS_STEP = 0  
REAL_OPENAI_CALLS_THIS_STEP = 0

## Remaining Blockers

1. BallDontLie injuries entitlement (last probe HTTP 401).
2. Separate fresh box-score/stats entitlement verification.
3. Unapplied collection schema in the target database.
4. Unapplied C1 prospective prediction schema.
5. Injuries collector and shadow scoring remain intentionally disabled.
6. Power analysis still required before activation.
7. Identity mapping / freshness canaries after provider access returns.

## Recommended Next Step

Do **not** start another historical model experiment and do not activate collection.

Next later step, only after a human provider decision: re-run the injuries entitlement canary. If HTTP 200, then the box-score canary. Only then consider applying proposed SQL.

## Verification Checklist

1. Confirm `/admin/model-lab` Status tab shows 70/30 as production control and PTS C / REB C as frozen candidates, not production.
2. Confirm WOWY copy says inconclusive, not failed.
3. Confirm Live Data is blocked and Prospective Evaluation is not started.
4. Confirm Context Engine inspector is labeled a dev fixture / not production-certified.
5. Confirm no Terraform/env flags were changed and shadow/injury schedules remain disabled.
6. Confirm `sql/proposed/context-engine-prospective-shadow-protocol.sql` was not applied.
7. Re-run `npx vitest run lib/model-lab/__tests__/lifecycle-registry.test.ts lib/model-lab/__tests__/prospective-shadow-protocol.test.ts lib/context-engine/__tests__/contract.test.ts` if needed.

## Step Verdict

GREEN — frozen model candidates, shared Context Engine contract, and prospective evaluation protocol are ready; live evidence collection remains intentionally blocked

```
PRODUCTION_MODEL: 70_30_UNCHANGED
PTS_C: FROZEN_SHADOW_CANDIDATE
REB_C: FROZEN_SHADOW_CANDIDATE
MODEL_D: NOT_PROMOTED
WOWY_AVAILABILITY: INCONCLUSIVE
CONTEXT_ENGINE_CONTRACT: CERTIFIED
PROSPECTIVE_PROTOCOL: CERTIFIED
SHADOW_SCORING: DISABLED
INJURY_COLLECTION: DISABLED
PROVIDER_ENTITLEMENT: BLOCKED
REAL_BDL_CALLS_THIS_STEP: 0
MODEL_RETRAINING: NONE
PRODUCTION_PREDICTION_CHANGES: NONE
SCHEMA_MIGRATION: PROPOSED_NOT_APPLIED
```
