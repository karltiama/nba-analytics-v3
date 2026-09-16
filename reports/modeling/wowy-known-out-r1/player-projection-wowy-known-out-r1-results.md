# WOWY known-Out residual r1

**Conclusion: inconclusive.** Adding a small predefined WOWY feature set to a matched ridge residual did not demonstrate incremental benefit over the same residual without WOWY.

**About 12 evaluation dates provide limited uncertainty evidence.** This is a previously inspected 2025 development window (season 2025 = 2025–26, including March–May 2026). Frozen C, production serving, shadow protocol, and ingestion were not changed. Features were not revised after seeing evaluation results.

## Reconciled cohort

Source population: **7,083** played subject-games (season 2025 Final, tip in 2026-03-10–2026-05-07 ET). Mutually exclusive terminal reasons sum to that population:

| Terminal reason | N |
| --- | ---: |
| no_primary_teammate | 84 |
| ambiguous_team_et_date | 0 |
| missing_tip_or_cutoff | 0 |
| no_precutoff_observation | 3,337 |
| observation_stale (last observed) | 2,155 |
| status_not_explicit_out | 755 |
| insufficient_wowy_support | 127 |
| **eligible** | **625** |
| **sum** | **7,083** |

Diagnostic counts (not terminals; they overlap the exclusive waterfall):

| Diagnostic | N |
| --- | ---: |
| not_played_in_window (outside sourcePlayed) | 4,333 |
| no_precutoff_but_had_postcutoff_obs | 1,959 |
| history_change_stale_but_raw_fresh_eligible | 210 |
| raw.injury_pull_membership present | no |

The earlier 399 + 2,300 + 1,959 + 1,378 + 837 + 126 = 7,099 vs 7,083 mismatch omitted `no_primary_teammate` (84) and treated post-cutoff as a second terminal label overlapping no-precutoff. Post-cutoff-only rows are now diagnostic inside `no_precutoff_observation`.

## Freshness

`analytics.player_injury_status_history` stores **status last changed**. `raw.player_injuries` on successful `raw.injury_pull_runs` stores **status last observed**. An unchanged Out can be re-listed on later successful pulls. Observation timestamps are pull `created_at` strictly before T−60; no post-cutoff rows were used.

Using last-observed recovered **210** rows that were history-stale. Eligible N moved 399 → **625** (**+226**, not +210). The extra **16** are freeze-eligible rows whose history timestamps were already fresh; they entered via raw last-observed status/membership rather than the stale-timestamp diagnostic. `raw.injury_pull_membership` does not exist in this database. See `cohort-delta.json`.

Frozen split (before training): train **394** (ET 2026-03-10–04-06), eval **231** (12 dates: 2026-04-07, 04-08, 04-09, 04-10, 04-12, 04-18, 04-21, 04-24, 04-26, 04-29, 05-01, 05-05). Cohort hash `b1db16cbbb9b324bc7fdb7a25e7692e0a4b18421205f3788453d7cd31c9b3dc4`. 135 games, 182 players, 195 pairs. **16** reported-Out primary teammates later played; those rows were retained. Accuracy is conditioned on the subject having played.

Only explicit fresh pre-cutoff Out / Out For Season selected WITHOUT. Other statuses remain unknown. Does not generalize to WITH, all players, or all injury situations.

## Declared procedure (before fit)

A = unchanged frozen learned-r1 C prediction. Residual target = actual − A.

B = A + ridge on role/history features. C = same ridge procedure plus the WOWY set. Identical training/eval rows. Train-only median impute and standardize. Intercept unpenalized. Lambda from inner chronological holdout (last 30% of training ET dates; grid {0.3, 1, 3, 10, 30}; inner N=127 ≥ 40 so selection ran). No player/pair identity features. Primary-teammate overlap only.

PTS role: `min_l10`, `min_season`, `pts_l10`, `pts_per_min_l10`, `opportunity_matched_l10`, `prior_played_count`.  
PTS WOWY: `wowy_primary_delta_minutes`, `wowy_primary_delta_pts`, `wowy_primary_delta_fga`, `wowy_primary_with_games`, `wowy_primary_without_games`, `wowy_primary_support_adequate`.

REB role: `min_l10`, `min_season`, `reb_l10`, `reb_per_min_l10`, `opportunity_matched_l10`, `prior_played_count`.  
REB WOWY: `wowy_primary_delta_minutes`, `wowy_primary_delta_reb`, `wowy_primary_delta_fga`, `wowy_primary_with_games`, `wowy_primary_without_games`, `wowy_primary_support_adequate`.

Selected λ: PTS B=30, PTS C=0.3; REB B=30, REB C=30. Inner chrono λ used 127 rows on the last 30% of the 28 training ET dates. Final ridge fits used all **394** training rows after that selection. `n_dropped_missing_frozen_c` = 0. Procedure matches the spec; not refit.

## Matched eval (once)

Eval N=231 both targets. Paired ΔMAE grouped by game date, 400 bootstrap iterations, seed 20260914. Negative delta means the right-hand model has lower MAE.

### Points

| Model | MAE | RMSE | signed bias | N |
| --- | ---: | ---: | ---: | ---: |
| A frozen C | 6.212 | 8.179 | −3.461 | 231 |
| B residual role | 5.870 | 7.657 | −1.505 | 231 |
| C residual + WOWY | 5.837 | 7.665 | −1.036 | 231 |

| Contrast | ΔMAE | 95% grouped CI | nGroups |
| --- | ---: | --- | ---: |
| B vs A | −0.342 | [−0.554, 0.084] | 12 |
| C vs A | −0.375 | [−0.705, 0.090] | 12 |
| C vs B | −0.033 | [−0.202, 0.171] | 12 |

### Rebounds

| Model | MAE | RMSE | signed bias | N |
| --- | ---: | ---: | ---: | ---: |
| A frozen C | 2.591 | 3.548 | −1.273 | 231 |
| B residual role | 2.561 | 3.498 | −1.135 | 231 |
| C residual + WOWY | 2.543 | 3.493 | −1.098 | 231 |

| Contrast | ΔMAE | 95% grouped CI | nGroups |
| --- | ---: | --- | ---: |
| B vs A | −0.030 | [−0.057, 0.002] | 12 |
| C vs A | −0.048 | [−0.106, 0.014] | 12 |
| C vs B | −0.019 | [−0.064, 0.031] | 12 |

All C vs B intervals include zero.

### Per-date MAE (eval used once)

Points (C−B is the WOWY increment on that date):

| ET date | N | MAE A | MAE B | MAE C | C−B |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-04-07 | 40 | 5.771 | 5.619 | 6.080 | +0.461 |
| 2026-04-08 | 4 | 5.814 | 5.216 | 4.400 | −0.816 |
| 2026-04-09 | 25 | 5.558 | 5.031 | 5.027 | −0.004 |
| 2026-04-10 | 43 | 5.799 | 5.347 | 5.328 | −0.019 |
| 2026-04-12 | 70 | 7.728 | 7.005 | 6.841 | −0.164 |
| 2026-04-18 | 7 | 6.220 | 6.053 | 5.030 | −1.023 |
| 2026-04-21 | 6 | 6.183 | 6.728 | 6.637 | −0.091 |
| 2026-04-24 | 6 | 7.357 | 6.499 | 6.547 | +0.048 |
| 2026-04-26 | 7 | 4.896 | 5.659 | 5.604 | −0.055 |
| 2026-04-29 | 8 | 3.405 | 4.338 | 4.236 | −0.102 |
| 2026-05-01 | 8 | 4.801 | 4.771 | 4.694 | −0.077 |
| 2026-05-05 | 7 | 3.858 | 4.294 | 4.128 | −0.165 |

Rebounds:

| ET date | N | MAE A | MAE B | MAE C | C−B |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-04-07 | 40 | 2.292 | 2.190 | 2.143 | −0.047 |
| 2026-04-08 | 4 | 1.152 | 0.941 | 0.627 | −0.314 |
| 2026-04-09 | 25 | 2.517 | 2.487 | 2.568 | +0.081 |
| 2026-04-10 | 43 | 2.877 | 2.834 | 2.895 | +0.061 |
| 2026-04-12 | 70 | 3.004 | 2.989 | 2.938 | −0.051 |
| 2026-04-18 | 7 | 2.154 | 2.221 | 2.126 | −0.095 |
| 2026-04-21 | 6 | 1.478 | 1.569 | 1.561 | −0.008 |
| 2026-04-24 | 6 | 2.011 | 2.086 | 2.012 | −0.075 |
| 2026-04-26 | 7 | 2.173 | 2.239 | 2.097 | −0.142 |
| 2026-04-29 | 8 | 3.008 | 3.017 | 2.885 | −0.132 |
| 2026-05-01 | 8 | 2.189 | 2.152 | 2.348 | +0.196 |
| 2026-05-05 | 7 | 1.794 | 1.791 | 1.707 | −0.084 |

### WOWY support slices (eval)

| Target | Slice | N | MAE B | MAE C | C−B ΔMAE [95% CI] | nGroups |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| PTS | low_support | 116 | 5.949 | 5.903 | −0.046 [−0.471, 0.366] | 9 |
| PTS | adequate | 115 | 5.790 | 5.770 | −0.020 [−0.082, 0.050] | 12 |
| REB | low_support | 116 | 2.748 | 2.705 | −0.042 [−0.095, 0.042] | 9 |
| REB | adequate | 115 | 2.373 | 2.379 | +0.005 [−0.060, 0.058] | 12 |

## Registration

Experiment `wowy-known-out-r1`, version `player-projection-wowy-known-out-r1`, Model Lab adapter `wowy-r1`. Artifacts: `freeze.json`, `waterfall.json`, `cohort.jsonl`, `feature_spec.json`, `results.json`, `selection.json`, `slices.json`, `predictions.jsonl`, `reconciliation.json`. Exploratory known-Out research only. No production promotion.
