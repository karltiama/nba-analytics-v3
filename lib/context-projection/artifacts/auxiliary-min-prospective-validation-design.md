# Phase 18A — Auxiliary MIN Prospective Validation Design

**Status:** `AUXILIARY_MIN_PROSPECTIVE_VALIDATION_DESIGN = APPROVED`  
**Scope:** DESIGN ONLY — no prospective collection, no model refit, no PTS changes.

## Research claim (preserved)

| Claim | Authority |
| --- | --- |
| `H3_ROLE_MIN` | SUPPORTED against B0 |
| `H5_AVAIL_MIN` | SUPPORTED against B0 |
| `AUX_MIN_ROLE_AVAIL_JOINT` | **NOT_PROSPECTIVELY_VALIDATED** |
| Retrospective ΔMAE ≈ +0.36 | `POST_SELECTION_DIAGNOSTIC_ONLY` — **not** certification |

## Primary prospective question

> Among prospectively predicted player-games that subsequently satisfy the frozen PLAYED target definition, does the frozen Role+Availability MIN shadow model reduce absolute minutes error relative to frozen B0_MIN?

Comparison: `B0_MIN` vs `AUX_MIN_ROLE_AVAIL_JOINT` only. Props Explorer has no MIN head.

## PLAYED audit

Canonical function: `classifyWowyAppearance` (`lib/wowy/appearance.ts`).

| Token / case | Class |
| --- | --- |
| minutes `"00"` | `dnp` |
| minutes > 0 | `played` |
| token `"0"` / `"0.0"` | `played` (zero-minute appearance) |
| zero minutes + box activity | `played` |
| other zero / no box | `dnp` |

- Do **not** assign `DNP = 0` as primary MIN scoring target.
- `PLAYED_STATUS_USED_AS_MODEL_FEATURE = NO`
- `PLAYED_STATUS_USED_FOR_TARGET_POPULATION_RESOLUTION = YES`

Postgame PLAYED filtering is **target-population resolution** for minutes conditional on participation — not target leakage — provided it never enters the pregame feature vector.

## Pregame vs scoring eligibility

```text
Pregame:
  create immutable prediction if MIN_PREGAME_ELIGIBILITY holds

Postgame:
  PLAYED  → eligible for primary MIN evaluation (consumes primary N)
  DNP_00  → STORE_AS_DIAGNOSTIC_NOT_PRIMARY_SCORE
  NO_PGL / unresolved → quarantine; not primary
```

Actual PLAYED/DNP must never influence the pregame prediction itself.

### `MIN_PREGAME_ELIGIBILITY`

1. valid `B0_MIN` (expanding same-season/same-team prior PLAYED mean; `history_n >= 1`)
2. valid `role.minutes_delta` (`player-role-context-v1`)
3. Availability `completeness == COMPLETE` (`COMPLETE_ONLY_PRIMARY`)
4. valid `injury.expected_missing_minutes`
5. valid `injury.rotation_players_out_count`
6. `team-injury-context-v2`
7. frozen model artifact SHA `7354e0a8…`
8. matching feature + training manifest SHAs
9. canonical pregame snapshot under snapshot policy
10. `prediction_created_at < game_start` and `<= T−60` intended cutoff
11. `branch == ROLE_AVAIL_JOINT` for primary cohort
12. `prospective_window_id == aux-min-role-avail-joint-v1-first750`
13. no historical backfill (`prediction_created_at >= window_opened_at`)

### Populations

```text
PROSPECTIVE_MIN_PREGAME_POPULATION =
JOINT_ELIGIBLE_PREGAME_PLAYER_GAMES

PROSPECTIVE_MIN_PRIMARY_SCORING_POPULATION =
PLAYED
```

## Primary candidate and fallbacks

```text
PRIMARY_PROSPECTIVE_MIN_CANDIDATE =
AUX_MIN_ROLE_AVAIL_JOINT
```

Role-only / Availability-only / Baseline may be stored prospectively as **SECONDARY / DIAGNOSTIC**. They do **not** enter the primary certification cohort and cannot replace a failed joint model after outcomes.

PARTIAL Availability never enters the joint primary cohort.

## Canonical snapshot

```text
MIN_CANONICAL_SNAPSHOT_POLICY =
LATEST_ELIGIBLE_AT_OR_BEFORE_T_MINUS_60
```

Aligns with certified historical Availability (T−60 reconstruction) and PTS shadow cutoff (`SHADOW_CUTOFF_MINUTES = 60`).

**No snapshot shopping:** unique index on `(prospective_window_id, player_entity_id, game_id, model_id)` — first canonical insert wins; later updates DO NOTHING.

## Sample unit and N

```text
one PLAYER_GAME =
  one player × one NBA game × one canonical pregame MIN prediction
```

```text
PROSPECTIVE_MIN_REQUIRED_N = 750
N_DEFINITION = resolved PLAYED primary observations
```

### First-N PLAYED cohort rule

Order genuine canonical `ROLE_AVAIL_JOINT` pregame predictions by `(prediction_created_at ASC, shadow_prediction_id ASC)`. After outcomes resolve, retain the first **750** observations in that sequence with `classifyWowyAppearance.class == played`. DNPs remain stored but do not consume primary N.

No outcome-based cherry-picking beyond frozen PLAYED classification.

### Sample-size audit (historical design-stage)

Source: `tmp/auxiliary-min-prospective-validation-design/sample_size_feasibility.json`

| Candidate N | CI half-width (first-N chrono | Mean HW (windows) | Meets dual ≤0.12 | Est. pregame preds | Est. NBA games | Est. nights @12 |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| 250 | 0.128 | 0.184 | NO | ~389 | ~16 | ~1.4 |
| 500 | 0.084 | 0.130 | NO (mean) | ~778 | ~32 | ~2.7 |
| **750** | **0.069** | **0.110** | **YES** | **~1166** | **~49** | **~4.1** |
| 1000 | 0.055 | 0.093 | YES | ~1555 | ~65 | ~5.4 |

**Precision rule (not significance of +0.36):** smallest N in `{250,500,750,1000}` with chronological first-N subject-game block-bootstrap 95% CI half-width ≤ 0.12 **and** mean half-width across contiguous windows ≤ 0.12.

**Clustering:** `SUBJECT_GAME_BLOCK` on `(player_entity_id, game_id)`.

**Historical rates (planning only):**

- Joint COMPLETE pregame candidates: 75,847
- Eventual PLAYED rate among those: ~64.3%
- Avg joint candidates / game: ~24.0
- Est. PLAYED primary / game: ~15.4

`pts_n_500_copied = false` — N=750 is MIN-specific.

### No optional stopping

Once armed: fixed N=750. Do not stop early if significant, extend if inconclusive, or change N after looking at prospective MAE.

## Metric and uncertainty

```text
PRIMARY_METRIC = MAE
DELTA_SIGN_CONVENTION = MAE_B0_MIN - MAE_AUX_MIN
  positive = auxiliary better
  negative = auxiliary worse

BOOTSTRAP_POLICY =
  method: SUBJECT_GAME_BLOCK
  draws: 2000
  base_seed: 20260918
  confidence: 95% percentile CI

PROSPECTIVE_STATUS_POLICY =
  PROSPECTIVE_MIN_SUPPORTED:     CI entirely > 0
  PROSPECTIVE_MIN_HARMFUL:       CI entirely < 0
  PROSPECTIVE_MIN_INCONCLUSIVE:  CI overlaps 0
```

No invented practical-significance threshold. Single primary hypothesis → no multiplicity correction for diagnostic fallbacks.

## Storage decision

```text
AUX_MIN_SHADOW_STORAGE =
analytics.prospective_min_shadow_predictions

AUX_MIN_SHADOW_OUTCOMES_STORAGE =
analytics.prospective_min_shadow_outcomes
```

**Choice A** (dedicated). Rejected B (generic migration of PTS table) and C (reuse existing PTS store):

PTS columns (`role_fga_delta`, `form_points_delta`, `ROLE_FORM_JOINT`, `actual_pts`) are PTS-specific. Mutating that table risks semantic confusion and counter coupling.

Authoritative store is durable Postgres — not `tmp/`.

Pregame fields immutable after insert; outcomes append-only / linked; PLAYED resolution must not rewrite the prediction.

### Designed record (minimum)

`shadow_prediction_id`, `prospective_window_id`, `game_id`, `player_entity_id`, `team_id`, `game_start`, `prediction_created_at`, `target=MIN`, `b0_min`, `shadow_min`, `context_adjustment`, `branch`, `role_minutes_delta`, `injury_expected_missing_minutes`, `injury_rotation_players_out_count`, `role_context_version`, `availability_context_version`, `model_id`, `model_artifact_sha`, `feature_manifest_sha`, `training_manifest_sha`, `availability_completeness`, `pregame_eligibility`, `canonical_snapshot_identity`, `intended_cutoff_at`, plus outcome append: `resolved_appearance_class`, `realized_minutes`, `outcome_resolved_at`, `primary_scoring_eligible`.

## Experiment identity

```text
PROSPECTIVE_MIN_WINDOW_ID =
aux-min-role-avail-joint-v1-first750

PROSPECTIVE_MANIFEST_ID =
auxiliary-min-prospective-window-v1
```

Must never share `prod-pts-context-v1-first500`.

## Collection state machine

```text
NOT_ARMED
→ READY_FOR_PROSPECTIVE_COLLECTION
→ COLLECTING
→ READY_FOR_READOUT   (N==750 AND all primary outcomes resolved)
→ COMPLETE            (after separate certification workload)
```

Operational monitoring may inspect counts, PLAYED/DNP rates, persistence failures, version mismatches — **not** running ΔMAE to change the experiment.

```text
AUX_MIN_PRIMARY_WINDOW_REFIT_COUNT = 0
HISTORICAL_ROWS_IN_MIN_PROSPECTIVE_COHORT = 0
```

When ready for readout: `NEXT = CERTIFY_AUXILIARY_MIN_PROSPECTIVE_VALIDATION` (separate explicit workload — no automatic certification).

## PTS isolation (confirmed)

| Lock | Value |
| --- | --- |
| PTS_MODEL_SHA | `36f68abd…` |
| PTS_REQUIRED_N | 500 |
| PTS_MODEL_CHANGED | NO |
| PTS_WINDOW_CHANGED | NO |
| PTS_STORAGE_MODIFIED | NO |
| PTS_NEXT | CONTINUE_PROSPECTIVE_PTS_SHADOW_COLLECTION |
| PRODUCTION_PTS_CONTEXT_INTEGRATION_AUTHORITY | NO |

## Production path

```text
MIN_PRODUCTION_PATH = DEFER_PROPS_EXPLORER
MIN→PTS chain = NONE
production integration authority = NO
```

Even if MIN prospectively succeeds, this protocol grants no automatic authority to feed MIN into PTS.

## Safety checklist

| Item | |
| --- | --- |
| MIN model refit | NO |
| MIN features changed | NO |
| Schedule MIN added | NO |
| PARTIAL Availability allowed | NO |
| DNP treated as 0-minute primary target | NO |
| actual PLAYED status used as pregame feature | NO |
| PTS model modified | NO |
| PTS prospective N modified | NO |
| PTS storage modified | NO |
| MIN row able to increment PTS counter | NO |
| historical row counted prospectively | NO |
| retrospective +0.36 treated as certification | NO |
| PTS N=500 copied without MIN-specific justification | NO |
| optional stopping designed | NO |
| running MAE used for experiment changes | NO |
| Props Explorer modified | NO |
| MIN→PTS chain created | NO |
| production integration authority granted | NO |

## Final locked state

```text
AUXILIARY_MIN_PROSPECTIVE_VALIDATION_DESIGN = APPROVED

PRIMARY_PROSPECTIVE_MIN_CANDIDATE =
AUX_MIN_ROLE_AVAIL_JOINT

PROSPECTIVE_MIN_PREGAME_POPULATION =
JOINT_ELIGIBLE_PREGAME_PLAYER_GAMES

PROSPECTIVE_MIN_PRIMARY_SCORING_POPULATION =
PLAYED

PROSPECTIVE_MIN_REQUIRED_N =
750

MIN_CANONICAL_SNAPSHOT_POLICY =
LATEST_ELIGIBLE_AT_OR_BEFORE_T_MINUS_60

AUX_MIN_SHADOW_STORAGE =
analytics.prospective_min_shadow_predictions

PRIMARY_METRIC =
MAE

DELTA_SIGN_CONVENTION =
MAE_B0_MIN - MAE_AUX_MIN

PROSPECTIVE_VALIDATION_REQUIRED =
YES

AUXILIARY_MIN_SHADOW_STATUS =
READY_FOR_PROSPECTIVE_IMPLEMENTATION

MIN_PRODUCTION_PATH =
DEFER_PROPS_EXPLORER

NEXT =
IMPLEMENT_AUXILIARY_MIN_PROSPECTIVE_COLLECTION

PTS NEXT =
CONTINUE_PROSPECTIVE_PTS_SHADOW_COLLECTION
```
