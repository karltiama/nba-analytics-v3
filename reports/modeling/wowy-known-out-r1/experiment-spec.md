# wowy-known-out-r1 — residual experiment specification

Declared **before** fitting. Exploratory development evidence only. Frozen PTS C / REB C, production, shadow, and ingestion are unchanged.

## Hypothesis

On player-games whose primary prior-minutes teammate is freshly observed Out before T−60, a small ridge correction on residual (actual − frozen C) that includes WOWY with/without differences will reduce MAE versus the same correction without WOWY.

## Models

| Id | Definition |
| --- | --- |
| A `frozen_c` | Unchanged learned-r1 C prediction |
| B `residual_role` | A + ridge(actual − A \| role/history features) |
| C `residual_wowy` | A + ridge(actual − A \| role/history + WOWY features) |

B and C use identical rows, identical missingness handling, and the same lambda grid / inner split. Preprocessing (median impute, standardize) is fit on training data only.

## Features (fixed)

Role/history (from learned-r1 `features_c`, pregame reconstructed):

- PTS: `min_l10`, `min_season`, `pts_l10`, `pts_per_min_l10`, `opportunity_matched_l10`, `prior_played_count`
- REB: `min_l10`, `min_season`, `reb_l10`, `reb_per_min_l10`, `opportunity_matched_l10`, `prior_played_count`

WOWY (primary teammate only; diffs null if insufficient support — those rows are already excluded):

- PTS: `wowy_primary_delta_minutes`, `wowy_primary_delta_pts`, `wowy_primary_delta_fga`, `wowy_primary_with_games`, `wowy_primary_without_games`, `wowy_primary_support_adequate`
- REB: same with `wowy_primary_delta_reb` instead of `delta_pts`

No player/pair IDs. No summed multi-teammate effects.

## Regularization

Ridge, intercept unpenalized. Lambda ∈ {0.3, 1, 3, 10, 30}. Inner selection: last 30% of **training ET dates** as inner validation; pick the lambda with lowest inner MAE. If inner-val N < 40, skip selection and use λ = 10. Never tune on the frozen evaluation dates.

## Cohort

Frozen by `scripts/freeze-wowy-known-out-cohort.ts` after last-observed freshness (raw successful pulls, not history change rows). Chronological split by ET basketball date: first 70% of distinct eligible dates train, remainder eval. Subject must have played. Reported-Out teammates who later played stay in.

## Evaluation (once)

Frozen eval dates only. PTS and REB separately: MAE, RMSE, signed bias, N; paired ΔMAE (B−A, C−A, C−B) with game-date clustered bootstrap (400, seed 20260914); per-date error differences; WOWY support slices if N permits. ~11 eval dates → limited uncertainty. Previously inspected 2025 development window. No feature revision after eval.

## Out of scope

CatBoost. WITH scenarios. Production promotion. Shadow activation. Provider calls.
