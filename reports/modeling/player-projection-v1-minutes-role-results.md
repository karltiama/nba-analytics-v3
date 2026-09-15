# Player projection v1 — expected minutes / role

Run: 2026-09-14T23:35:30.399Z
Version: `player-projection-v1-minutes-role-r1`. Research only. Production unchanged.

Chronological split: train 2023 (n=27653) → validation 2024 (n=27696) → test 2025 (n=28130). Hyperparameters chosen on validation only.

As-of leakage count: **0**. Starter labels on target games used only as an observed split. Prior known-role coverage: 28130/83479.

## Candidates

### Expected minutes

- A. L5 played-game mean minutes
- B. 0.7 * L5 minutes + 0.3 * season minutes
- C. EWM of played minutes (α ∈ {0.25, 0.40, 0.55}; 0.40 is the default)
- D. Role-aware minutes from **prior** starter/bench minutes (starter-rate L5 ≥ 0.60 / ≤ 0.40); 2025-only labels
- E. Trend: L10 * clip(L3/L10, 0.80, 1.20)

### How minutes enter the mean

- Concept A: `TrackA * clip(expected / L10_minutes, lo, hi)` with L10 floor 5. Clip grids: 0.80–1.20, **0.85–1.15 (default)**, 0.90–1.10. Missing ratio → baseline fallback (paired N).
- Concept B: `expected_minutes * pregame per-minute rate` (season / L10 / 0.7 L10 + 0.3 season).
- Role-shift: if |L5min − seasonMin| / seasonMin ≥ τ, use played L5 counting mean; else Track A. τ ∈ {0.15, 0.20, 0.25}.

## Benchmark (all seasons)

| Prop | Played-only Track A MAE | N |
| --- | --- | --- |
| PTS | 4.621 | 83479 |
| REB | 1.918 | 83479 |
| AST | 1.348 | 83479 |
| 3PM | 0.885 | 83479 |
| PRA | 6.108 | 83479 |
| PA | 5.099 | 83479 |
| PR | 5.604 | 83479 |
| RA | 2.644 | 83479 |

## Chronological test (2025–26) — val-selected candidate vs baseline

Selection: lowest validation MAE, including the baseline. Test was not used to pick. Δ = candidate − baseline. Negative is improvement. Bootstrap seed 20260914, 400 paired resamples.

| Prop | Val-selected | Baseline MAE | Candidate MAE | Delta | 95% CI | N | Class |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PTS | a_min_ewm_a025__clip_085_115 | 4.618 | 4.591 | -0.0261 | [-0.034, -0.019] | 28130 | marginal |
| REB | a_min_ewm_a025__clip_085_115 | 1.912 | 1.902 | -0.0094 | [-0.012, -0.007] | 28130 | tied |
| AST | a_min_ewm_a040__clip_080_120 | 1.349 | 1.341 | -0.0078 | [-0.011, -0.005] | 28130 | tied |
| 3PM | b_min_l5__season_rate | 0.892 | 0.890 | -0.0019 | [-0.005, 0.001] | 28130 | tied |
| PRA | a_min_ewm_a025__clip_085_115 | 6.097 | 6.038 | -0.0582 | [-0.071, -0.046] | 28130 | materially better |
| PA | a_min_ewm_a025__clip_085_115 | 5.099 | 5.056 | -0.0424 | [-0.053, -0.033] | 28130 | materially better |
| PR | a_min_ewm_a025__clip_085_115 | 5.587 | 5.542 | -0.0446 | [-0.056, -0.035] | 28130 | materially better |
| RA | a_min_ewm_a025__clip_085_115 | 2.635 | 2.615 | -0.0202 | [-0.025, -0.016] | 28130 | marginal |

## Test MAE for the pre-specified default family

### PTS

| Candidate | MAE | RMSE | Bias | N |
| --- | --- | --- | --- | --- |
| played_track_a | 4.618 | 6.084 | -0.119 | 28130 |
| a_min_l5__clip_085_115 | 4.612 | 6.083 | -0.099 | 28130 |
| a_min_l5_season__clip_085_115 | 4.611 | 6.077 | -0.131 | 28130 |
| a_min_ewm_a040__clip_085_115 | 4.601 | 6.073 | -0.096 | 28130 |
| a_min_trend__clip_085_115 | 4.619 | 6.099 | -0.092 | 28130 |
| a_min_role__clip_085_115 | 4.618 | 6.096 | -0.162 | 28130 |
| b_min_l5__season_rate | 4.619 | 6.092 | -0.068 | 28130 |
| b_min_l5__l10_rate | 4.655 | 6.143 | -0.043 | 28130 |
| b_min_l5__blended_rate | 4.624 | 6.099 | -0.051 | 28130 |
| b_min_l5_season__blended_rate | 4.604 | 6.068 | -0.093 | 28130 |
| b_min_ewm_a040__blended_rate | 4.606 | 6.083 | -0.038 | 28130 |
| b_min_role__blended_rate | 4.628 | 6.114 | -0.129 | 28130 |
| r_shift_l5__tau_020 | 4.643 | 6.121 | -0.037 | 28130 |

### REB

| Candidate | MAE | RMSE | Bias | N |
| --- | --- | --- | --- | --- |
| played_track_a | 1.912 | 2.538 | -0.048 | 28130 |
| a_min_l5__clip_085_115 | 1.909 | 2.535 | -0.040 | 28130 |
| a_min_l5_season__clip_085_115 | 1.908 | 2.533 | -0.054 | 28130 |
| a_min_ewm_a040__clip_085_115 | 1.907 | 2.533 | -0.040 | 28130 |
| a_min_trend__clip_085_115 | 1.913 | 2.541 | -0.039 | 28130 |
| a_min_role__clip_085_115 | 1.911 | 2.542 | -0.071 | 28130 |
| b_min_l5__season_rate | 1.907 | 2.531 | -0.018 | 28130 |
| b_min_l5__l10_rate | 1.933 | 2.568 | -0.014 | 28130 |
| b_min_l5__blended_rate | 1.917 | 2.546 | -0.015 | 28130 |
| b_min_l5_season__blended_rate | 1.906 | 2.531 | -0.034 | 28130 |
| b_min_ewm_a040__blended_rate | 1.914 | 2.542 | -0.010 | 28130 |
| b_min_role__blended_rate | 1.917 | 2.550 | -0.053 | 28130 |
| r_shift_l5__tau_020 | 1.927 | 2.559 | -0.018 | 28130 |

### AST

| Candidate | MAE | RMSE | Bias | N |
| --- | --- | --- | --- | --- |
| played_track_a | 1.349 | 1.849 | -0.032 | 28130 |
| a_min_l5__clip_085_115 | 1.345 | 1.844 | -0.028 | 28130 |
| a_min_l5_season__clip_085_115 | 1.345 | 1.845 | -0.035 | 28130 |
| a_min_ewm_a040__clip_085_115 | 1.342 | 1.841 | -0.028 | 28130 |
| a_min_trend__clip_085_115 | 1.345 | 1.845 | -0.027 | 28130 |
| a_min_role__clip_085_115 | 1.348 | 1.850 | -0.042 | 28130 |
| b_min_l5__season_rate | 1.346 | 1.845 | -0.029 | 28130 |
| b_min_l5__l10_rate | 1.358 | 1.864 | -0.013 | 28130 |
| b_min_l5__blended_rate | 1.346 | 1.847 | -0.018 | 28130 |
| b_min_l5_season__blended_rate | 1.344 | 1.842 | -0.027 | 28130 |
| b_min_ewm_a040__blended_rate | 1.343 | 1.843 | -0.016 | 28130 |
| b_min_role__blended_rate | 1.349 | 1.852 | -0.035 | 28130 |
| r_shift_l5__tau_020 | 1.356 | 1.860 | -0.017 | 28130 |

### 3PM

| Candidate | MAE | RMSE | Bias | N |
| --- | --- | --- | --- | --- |
| played_track_a | 0.892 | 1.259 | -0.013 | 28130 |
| a_min_l5__clip_085_115 | 0.891 | 1.259 | -0.010 | 28130 |
| a_min_l5_season__clip_085_115 | 0.891 | 1.258 | -0.014 | 28130 |
| a_min_ewm_a040__clip_085_115 | 0.890 | 1.258 | -0.010 | 28130 |
| a_min_trend__clip_085_115 | 0.892 | 1.260 | -0.010 | 28130 |
| a_min_role__clip_085_115 | 0.891 | 1.261 | -0.018 | 28130 |
| b_min_l5__season_rate | 0.890 | 1.254 | -0.004 | 28130 |
| b_min_l5__l10_rate | 0.900 | 1.275 | -0.005 | 28130 |
| b_min_l5__blended_rate | 0.893 | 1.262 | -0.004 | 28130 |
| b_min_l5_season__blended_rate | 0.891 | 1.258 | -0.010 | 28130 |
| b_min_ewm_a040__blended_rate | 0.892 | 1.261 | -0.003 | 28130 |
| b_min_role__blended_rate | 0.893 | 1.263 | -0.014 | 28130 |
| r_shift_l5__tau_020 | 0.897 | 1.271 | -0.005 | 28130 |

### PRA

| Candidate | MAE | RMSE | Bias | N |
| --- | --- | --- | --- | --- |
| played_track_a | 6.097 | 7.905 | -0.198 | 28130 |
| a_min_l5__clip_085_115 | 6.076 | 7.891 | -0.166 | 28130 |
| a_min_l5_season__clip_085_115 | 6.076 | 7.886 | -0.219 | 28130 |
| a_min_ewm_a040__clip_085_115 | 6.058 | 7.873 | -0.163 | 28130 |
| a_min_trend__clip_085_115 | 6.091 | 7.919 | -0.158 | 28130 |
| a_min_role__clip_085_115 | 6.100 | 7.928 | -0.275 | 28130 |
| b_min_l5__season_rate | 6.096 | 7.928 | -0.115 | 28130 |
| b_min_l5__l10_rate | 6.133 | 7.967 | -0.071 | 28130 |
| b_min_l5__blended_rate | 6.098 | 7.924 | -0.085 | 28130 |
| b_min_l5_season__blended_rate | 6.058 | 7.867 | -0.154 | 28130 |
| b_min_ewm_a040__blended_rate | 6.065 | 7.892 | -0.065 | 28130 |
| b_min_role__blended_rate | 6.119 | 7.960 | -0.217 | 28130 |
| r_shift_l5__tau_020 | 6.118 | 7.940 | -0.073 | 28130 |

### PA

| Candidate | MAE | RMSE | Bias | N |
| --- | --- | --- | --- | --- |
| played_track_a | 5.099 | 6.681 | -0.150 | 28130 |
| a_min_l5__clip_085_115 | 5.089 | 6.673 | -0.126 | 28130 |
| a_min_l5_season__clip_085_115 | 5.085 | 6.668 | -0.165 | 28130 |
| a_min_ewm_a040__clip_085_115 | 5.072 | 6.659 | -0.123 | 28130 |
| a_min_trend__clip_085_115 | 5.096 | 6.692 | -0.119 | 28130 |
| a_min_role__clip_085_115 | 5.101 | 6.697 | -0.204 | 28130 |
| b_min_l5__season_rate | 5.102 | 6.698 | -0.097 | 28130 |
| b_min_l5__l10_rate | 5.136 | 6.734 | -0.057 | 28130 |
| b_min_l5__blended_rate | 5.103 | 6.693 | -0.069 | 28130 |
| b_min_l5_season__blended_rate | 5.074 | 6.654 | -0.120 | 28130 |
| b_min_ewm_a040__blended_rate | 5.077 | 6.669 | -0.054 | 28130 |
| b_min_role__blended_rate | 5.113 | 6.718 | -0.164 | 28130 |
| r_shift_l5__tau_020 | 5.122 | 6.715 | -0.055 | 28130 |

### PR

| Candidate | MAE | RMSE | Bias | N |
| --- | --- | --- | --- | --- |
| played_track_a | 5.587 | 7.266 | -0.167 | 28130 |
| a_min_l5__clip_085_115 | 5.571 | 7.260 | -0.138 | 28130 |
| a_min_l5_season__clip_085_115 | 5.571 | 7.253 | -0.184 | 28130 |
| a_min_ewm_a040__clip_085_115 | 5.559 | 7.246 | -0.135 | 28130 |
| a_min_trend__clip_085_115 | 5.587 | 7.285 | -0.131 | 28130 |
| a_min_role__clip_085_115 | 5.590 | 7.285 | -0.233 | 28130 |
| b_min_l5__season_rate | 5.581 | 7.282 | -0.086 | 28130 |
| b_min_l5__l10_rate | 5.625 | 7.334 | -0.058 | 28130 |
| b_min_l5__blended_rate | 5.590 | 7.289 | -0.066 | 28130 |
| b_min_l5_season__blended_rate | 5.557 | 7.239 | -0.127 | 28130 |
| b_min_ewm_a040__blended_rate | 5.567 | 7.264 | -0.049 | 28130 |
| b_min_role__blended_rate | 5.605 | 7.314 | -0.182 | 28130 |
| r_shift_l5__tau_020 | 5.610 | 7.304 | -0.056 | 28130 |

### RA

| Candidate | MAE | RMSE | Bias | N |
| --- | --- | --- | --- | --- |
| played_track_a | 2.635 | 3.456 | -0.080 | 28130 |
| a_min_l5__clip_085_115 | 2.627 | 3.446 | -0.068 | 28130 |
| a_min_l5_season__clip_085_115 | 2.627 | 3.446 | -0.088 | 28130 |
| a_min_ewm_a040__clip_085_115 | 2.622 | 3.440 | -0.067 | 28130 |
| a_min_trend__clip_085_115 | 2.634 | 3.453 | -0.066 | 28130 |
| a_min_role__clip_085_115 | 2.633 | 3.461 | -0.113 | 28130 |
| b_min_l5__season_rate | 2.627 | 3.448 | -0.047 | 28130 |
| b_min_l5__l10_rate | 2.657 | 3.486 | -0.028 | 28130 |
| b_min_l5__blended_rate | 2.636 | 3.459 | -0.034 | 28130 |
| b_min_l5_season__blended_rate | 2.622 | 3.439 | -0.061 | 28130 |
| b_min_ewm_a040__blended_rate | 2.628 | 3.449 | -0.026 | 28130 |
| b_min_role__blended_rate | 2.640 | 3.473 | -0.088 | 28130 |
| r_shift_l5__tau_020 | 2.648 | 3.475 | -0.035 | 28130 |

## Segment results (test, paired vs Track A)

Target-game starter is an **observed postgame split**, not a feature. Minutes-change and volume buckets are pregame.

| Prop | Candidate | Slice | Bucket | N | Cand MAE | Base MAE | Delta | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PTS | a_min_l5__clip_085_115 | minutes | stable | 19637 | 4.857 | 4.848 | 0.0091 | [0.002, 0.018] |
| PTS | a_min_l5__clip_085_115 | minutes | moderate | 6109 | 4.237 | 4.255 | -0.0183 | [-0.047, 0.010] |
| PTS | a_min_l5__clip_085_115 | minutes | large | 2379 | 3.556 | 3.644 | -0.0877 | [-0.117, -0.053] |
| PTS | a_min_l5__clip_085_115 | volume | low | 6604 | 3.320 | 3.341 | -0.0208 | [-0.031, -0.009] |
| PTS | a_min_l5__clip_085_115 | volume | rotation | 13197 | 4.530 | 4.544 | -0.0136 | [-0.027, -0.002] |
| PTS | a_min_l5__clip_085_115 | volume | high | 8324 | 5.769 | 5.748 | 0.0211 | [0.003, 0.042] |
| PTS | a_min_l5__clip_085_115 | role | starter_to_starter | 11335 | 5.458 | 5.436 | 0.0217 | [0.002, 0.039] |
| PTS | a_min_l5__clip_085_115 | role | bench_to_bench | 13963 | 3.790 | 3.816 | -0.0265 | [-0.036, -0.015] |
| PTS | a_min_l5__clip_085_115 | role | bench_to_starter | 1692 | 5.574 | 5.591 | -0.0163 | [-0.048, 0.022] |
| PTS | a_min_l5__clip_085_115 | role | starter_to_bench | 1098 | 4.851 | 4.839 | 0.0120 | [-0.039, 0.065] |
| PTS | a_min_ewm_a040__clip_085_115 | minutes | stable | 19637 | 4.851 | 4.848 | 0.0032 | [-0.008, 0.014] |
| PTS | a_min_ewm_a040__clip_085_115 | minutes | moderate | 6109 | 4.211 | 4.255 | -0.0446 | [-0.077, -0.023] |
| PTS | a_min_ewm_a040__clip_085_115 | minutes | large | 2379 | 3.539 | 3.644 | -0.1041 | [-0.134, -0.074] |
| PTS | a_min_ewm_a040__clip_085_115 | volume | low | 6604 | 3.299 | 3.341 | -0.0415 | [-0.053, -0.029] |
| PTS | a_min_ewm_a040__clip_085_115 | volume | rotation | 13197 | 4.519 | 4.544 | -0.0249 | [-0.039, -0.009] |
| PTS | a_min_ewm_a040__clip_085_115 | volume | high | 8324 | 5.765 | 5.748 | 0.0175 | [-0.005, 0.042] |
| PTS | a_min_ewm_a040__clip_085_115 | role | starter_to_starter | 11335 | 5.462 | 5.436 | 0.0264 | [0.004, 0.044] |
| PTS | a_min_ewm_a040__clip_085_115 | role | bench_to_bench | 13963 | 3.772 | 3.816 | -0.0444 | [-0.056, -0.033] |
| PTS | a_min_ewm_a040__clip_085_115 | role | bench_to_starter | 1692 | 5.553 | 5.591 | -0.0378 | [-0.075, -0.003] |
| PTS | a_min_ewm_a040__clip_085_115 | role | starter_to_bench | 1098 | 4.780 | 4.839 | -0.0597 | [-0.124, 0.004] |
| PTS | a_min_role__clip_085_115 | minutes | stable | 19637 | 4.854 | 4.848 | 0.0058 | [0.001, 0.011] |
| PTS | a_min_role__clip_085_115 | minutes | moderate | 6109 | 4.244 | 4.255 | -0.0117 | [-0.024, 0.006] |
| PTS | a_min_role__clip_085_115 | minutes | large | 2379 | 3.626 | 3.644 | -0.0179 | [-0.033, 0.006] |
| PTS | a_min_role__clip_085_115 | volume | low | 6604 | 3.335 | 3.341 | -0.0055 | [-0.012, 0.003] |
| PTS | a_min_role__clip_085_115 | volume | rotation | 13197 | 4.542 | 4.544 | -0.0017 | [-0.012, 0.007] |
| PTS | a_min_role__clip_085_115 | volume | high | 8324 | 5.755 | 5.748 | 0.0069 | [-0.002, 0.017] |
| PTS | a_min_role__clip_085_115 | role | starter_to_starter | 11335 | 5.432 | 5.436 | -0.0041 | [-0.010, 0.003] |
| PTS | a_min_role__clip_085_115 | role | bench_to_bench | 13963 | 3.784 | 3.816 | -0.0317 | [-0.039, -0.025] |
| PTS | a_min_role__clip_085_115 | role | bench_to_starter | 1692 | 5.755 | 5.591 | 0.1643 | [0.130, 0.196] |
| PTS | a_min_role__clip_085_115 | role | starter_to_bench | 1098 | 5.029 | 4.839 | 0.1898 | [0.145, 0.231] |
| PTS | b_min_l5__blended_rate | minutes | stable | 19637 | 4.870 | 4.848 | 0.0217 | [0.013, 0.032] |
| PTS | b_min_l5__blended_rate | minutes | moderate | 6109 | 4.243 | 4.255 | -0.0121 | [-0.046, 0.022] |
| PTS | b_min_l5__blended_rate | minutes | large | 2379 | 3.572 | 3.644 | -0.0716 | [-0.145, 0.008] |
| PTS | b_min_l5__blended_rate | volume | low | 6604 | 3.329 | 3.341 | -0.0115 | [-0.034, 0.017] |
| PTS | b_min_l5__blended_rate | volume | rotation | 13197 | 4.540 | 4.544 | -0.0040 | [-0.024, 0.013] |
| PTS | b_min_l5__blended_rate | volume | high | 8324 | 5.785 | 5.748 | 0.0374 | [0.018, 0.059] |
| PTS | b_min_l5__blended_rate | role | starter_to_starter | 11335 | 5.477 | 5.436 | 0.0407 | [0.021, 0.060] |
| PTS | b_min_l5__blended_rate | role | bench_to_bench | 13963 | 3.794 | 3.816 | -0.0220 | [-0.037, -0.004] |
| PTS | b_min_l5__blended_rate | role | bench_to_starter | 1692 | 5.541 | 5.591 | -0.0501 | [-0.095, 0.001] |
| PTS | b_min_l5__blended_rate | role | starter_to_bench | 1098 | 4.945 | 4.839 | 0.1058 | [0.034, 0.179] |
| PTS | r_shift_l5__tau_020 | minutes | stable | 19637 | 4.873 | 4.848 | 0.0246 | [0.015, 0.034] |
| PTS | r_shift_l5__tau_020 | minutes | moderate | 6109 | 4.286 | 4.255 | 0.0312 | [-0.006, 0.064] |
| PTS | r_shift_l5__tau_020 | minutes | large | 2379 | 3.661 | 3.644 | 0.0177 | [-0.068, 0.112] |
| PTS | r_shift_l5__tau_020 | volume | low | 6604 | 3.358 | 3.341 | 0.0173 | [-0.009, 0.050] |
| PTS | r_shift_l5__tau_020 | volume | rotation | 13197 | 4.583 | 4.544 | 0.0397 | [0.017, 0.060] |
| PTS | r_shift_l5__tau_020 | volume | high | 8324 | 5.757 | 5.748 | 0.0093 | [-0.003, 0.022] |
| PTS | r_shift_l5__tau_020 | role | starter_to_starter | 11335 | 5.458 | 5.436 | 0.0227 | [0.007, 0.038] |
| PTS | r_shift_l5__tau_020 | role | bench_to_bench | 13963 | 3.837 | 3.816 | 0.0209 | [-0.000, 0.040] |
| PTS | r_shift_l5__tau_020 | role | bench_to_starter | 1692 | 5.574 | 5.591 | -0.0166 | [-0.073, 0.053] |
| PTS | r_shift_l5__tau_020 | role | starter_to_bench | 1098 | 5.021 | 4.839 | 0.1819 | [0.102, 0.254] |
| REB | a_min_l5__clip_085_115 | minutes | stable | 19637 | 1.960 | 1.957 | 0.0024 | [-0.001, 0.005] |
| REB | a_min_l5__clip_085_115 | minutes | moderate | 6109 | 1.857 | 1.862 | -0.0058 | [-0.017, 0.006] |
| REB | a_min_l5__clip_085_115 | minutes | large | 2379 | 1.630 | 1.666 | -0.0359 | [-0.049, -0.021] |
| REB | a_min_l5__clip_085_115 | volume | low | 6604 | 1.607 | 1.611 | -0.0036 | [-0.009, 0.002] |
| REB | a_min_l5__clip_085_115 | volume | rotation | 13197 | 1.911 | 1.921 | -0.0109 | [-0.017, -0.004] |
| REB | a_min_l5__clip_085_115 | volume | high | 8324 | 2.147 | 2.135 | 0.0112 | [0.005, 0.017] |
| REB | a_min_l5__clip_085_115 | role | starter_to_starter | 11335 | 2.156 | 2.148 | 0.0074 | [0.002, 0.014] |
| REB | a_min_l5__clip_085_115 | role | bench_to_bench | 13963 | 1.645 | 1.654 | -0.0086 | [-0.013, -0.004] |
| REB | a_min_l5__clip_085_115 | role | bench_to_starter | 1692 | 2.318 | 2.339 | -0.0208 | [-0.037, -0.006] |
| REB | a_min_l5__clip_085_115 | role | starter_to_bench | 1098 | 2.084 | 2.087 | -0.0032 | [-0.027, 0.022] |
| REB | a_min_ewm_a040__clip_085_115 | minutes | stable | 19637 | 1.961 | 1.957 | 0.0036 | [-0.001, 0.009] |
| REB | a_min_ewm_a040__clip_085_115 | minutes | moderate | 6109 | 1.845 | 1.862 | -0.0172 | [-0.028, -0.006] |
| REB | a_min_ewm_a040__clip_085_115 | minutes | large | 2379 | 1.623 | 1.666 | -0.0431 | [-0.054, -0.028] |
| REB | a_min_ewm_a040__clip_085_115 | volume | low | 6604 | 1.596 | 1.611 | -0.0146 | [-0.022, -0.008] |
| REB | a_min_ewm_a040__clip_085_115 | volume | rotation | 13197 | 1.910 | 1.921 | -0.0114 | [-0.018, -0.004] |
| REB | a_min_ewm_a040__clip_085_115 | volume | high | 8324 | 2.149 | 2.135 | 0.0133 | [0.006, 0.022] |
| REB | a_min_ewm_a040__clip_085_115 | role | starter_to_starter | 11335 | 2.159 | 2.148 | 0.0109 | [0.004, 0.019] |
| REB | a_min_ewm_a040__clip_085_115 | role | bench_to_bench | 13963 | 1.640 | 1.654 | -0.0137 | [-0.018, -0.007] |
| REB | a_min_ewm_a040__clip_085_115 | role | bench_to_starter | 1692 | 2.313 | 2.339 | -0.0257 | [-0.049, -0.007] |
| REB | a_min_ewm_a040__clip_085_115 | role | starter_to_bench | 1098 | 2.063 | 2.087 | -0.0243 | [-0.053, 0.003] |
| REB | a_min_role__clip_085_115 | minutes | stable | 19637 | 1.960 | 1.957 | 0.0026 | [-0.000, 0.005] |
| REB | a_min_role__clip_085_115 | minutes | moderate | 6109 | 1.857 | 1.862 | -0.0058 | [-0.012, 0.002] |
| REB | a_min_role__clip_085_115 | minutes | large | 2379 | 1.653 | 1.666 | -0.0136 | [-0.024, -0.002] |
| REB | a_min_role__clip_085_115 | volume | low | 6604 | 1.606 | 1.611 | -0.0047 | [-0.008, -0.001] |
| REB | a_min_role__clip_085_115 | volume | rotation | 13197 | 1.920 | 1.921 | -0.0015 | [-0.006, 0.004] |
| REB | a_min_role__clip_085_115 | volume | high | 8324 | 2.139 | 2.135 | 0.0040 | [0.001, 0.007] |
| REB | a_min_role__clip_085_115 | role | starter_to_starter | 11335 | 2.150 | 2.148 | 0.0010 | [-0.002, 0.004] |
| REB | a_min_role__clip_085_115 | role | bench_to_bench | 13963 | 1.640 | 1.654 | -0.0143 | [-0.018, -0.011] |
| REB | a_min_role__clip_085_115 | role | bench_to_starter | 1692 | 2.389 | 2.339 | 0.0499 | [0.037, 0.065] |
| REB | a_min_role__clip_085_115 | role | starter_to_bench | 1098 | 2.165 | 2.087 | 0.0777 | [0.056, 0.096] |
| REB | b_min_l5__blended_rate | minutes | stable | 19637 | 1.966 | 1.957 | 0.0089 | [0.005, 0.013] |
| REB | b_min_l5__blended_rate | minutes | moderate | 6109 | 1.866 | 1.862 | 0.0038 | [-0.011, 0.018] |
| REB | b_min_l5__blended_rate | minutes | large | 2379 | 1.639 | 1.666 | -0.0270 | [-0.061, 0.016] |
| REB | b_min_l5__blended_rate | volume | low | 6604 | 1.617 | 1.611 | 0.0065 | [-0.005, 0.019] |
| REB | b_min_l5__blended_rate | volume | rotation | 13197 | 1.918 | 1.921 | -0.0032 | [-0.011, 0.005] |
| REB | b_min_l5__blended_rate | volume | high | 8324 | 2.151 | 2.135 | 0.0159 | [0.009, 0.023] |
| REB | b_min_l5__blended_rate | role | starter_to_starter | 11335 | 2.164 | 2.148 | 0.0158 | [0.009, 0.023] |
| REB | b_min_l5__blended_rate | role | bench_to_bench | 13963 | 1.653 | 1.654 | -0.0012 | [-0.009, 0.007] |
| REB | b_min_l5__blended_rate | role | bench_to_starter | 1692 | 2.297 | 2.339 | -0.0417 | [-0.065, -0.015] |
| REB | b_min_l5__blended_rate | role | starter_to_bench | 1098 | 2.124 | 2.087 | 0.0375 | [0.004, 0.071] |
| REB | r_shift_l5__tau_020 | minutes | stable | 19637 | 1.968 | 1.957 | 0.0108 | [0.007, 0.015] |
| REB | r_shift_l5__tau_020 | minutes | moderate | 6109 | 1.896 | 1.862 | 0.0333 | [0.019, 0.046] |
| REB | r_shift_l5__tau_020 | minutes | large | 2379 | 1.676 | 1.666 | 0.0095 | [-0.025, 0.051] |
| REB | r_shift_l5__tau_020 | volume | low | 6604 | 1.637 | 1.611 | 0.0259 | [0.015, 0.041] |
| REB | r_shift_l5__tau_020 | volume | rotation | 13197 | 1.939 | 1.921 | 0.0175 | [0.008, 0.026] |
| REB | r_shift_l5__tau_020 | volume | high | 8324 | 2.140 | 2.135 | 0.0045 | [0.001, 0.009] |
| REB | r_shift_l5__tau_020 | role | starter_to_starter | 11335 | 2.159 | 2.148 | 0.0110 | [0.004, 0.018] |
| REB | r_shift_l5__tau_020 | role | bench_to_bench | 13963 | 1.675 | 1.654 | 0.0206 | [0.013, 0.029] |
| REB | r_shift_l5__tau_020 | role | bench_to_starter | 1692 | 2.314 | 2.339 | -0.0243 | [-0.053, 0.003] |
| REB | r_shift_l5__tau_020 | role | starter_to_bench | 1098 | 2.148 | 2.087 | 0.0609 | [0.029, 0.094] |
| AST | a_min_l5__clip_085_115 | minutes | stable | 19637 | 1.430 | 1.430 | 0.0001 | [-0.002, 0.002] |
| AST | a_min_l5__clip_085_115 | minutes | moderate | 6109 | 1.204 | 1.216 | -0.0125 | [-0.021, -0.005] |
| AST | a_min_l5__clip_085_115 | minutes | large | 2379 | 1.006 | 1.028 | -0.0211 | [-0.030, -0.013] |
| AST | a_min_l5__clip_085_115 | volume | low | 6604 | 0.896 | 0.897 | -0.0010 | [-0.004, 0.002] |
| AST | a_min_l5__clip_085_115 | volume | rotation | 13197 | 1.317 | 1.326 | -0.0085 | [-0.012, -0.005] |
| AST | a_min_l5__clip_085_115 | volume | high | 8324 | 1.744 | 1.745 | -0.0006 | [-0.006, 0.004] |
| AST | a_min_l5__clip_085_115 | role | starter_to_starter | 11335 | 1.647 | 1.649 | -0.0021 | [-0.006, 0.002] |
| AST | a_min_l5__clip_085_115 | role | bench_to_bench | 13963 | 1.065 | 1.071 | -0.0054 | [-0.008, -0.003] |
| AST | a_min_l5__clip_085_115 | role | bench_to_starter | 1692 | 1.583 | 1.599 | -0.0161 | [-0.025, -0.006] |
| AST | a_min_l5__clip_085_115 | role | starter_to_bench | 1098 | 1.401 | 1.400 | 0.0014 | [-0.013, 0.015] |
| AST | a_min_ewm_a040__clip_085_115 | minutes | stable | 19637 | 1.430 | 1.430 | -0.0003 | [-0.003, 0.003] |
| AST | a_min_ewm_a040__clip_085_115 | minutes | moderate | 6109 | 1.195 | 1.216 | -0.0214 | [-0.029, -0.015] |
| AST | a_min_ewm_a040__clip_085_115 | minutes | large | 2379 | 1.003 | 1.028 | -0.0243 | [-0.032, -0.017] |
| AST | a_min_ewm_a040__clip_085_115 | volume | low | 6604 | 0.891 | 0.897 | -0.0060 | [-0.009, -0.003] |
| AST | a_min_ewm_a040__clip_085_115 | volume | rotation | 13197 | 1.313 | 1.326 | -0.0125 | [-0.015, -0.008] |
| AST | a_min_ewm_a040__clip_085_115 | volume | high | 8324 | 1.747 | 1.745 | 0.0014 | [-0.005, 0.007] |
| AST | a_min_ewm_a040__clip_085_115 | role | starter_to_starter | 11335 | 1.648 | 1.649 | -0.0008 | [-0.006, 0.004] |
| AST | a_min_ewm_a040__clip_085_115 | role | bench_to_bench | 13963 | 1.063 | 1.071 | -0.0081 | [-0.011, -0.005] |
| AST | a_min_ewm_a040__clip_085_115 | role | bench_to_starter | 1692 | 1.574 | 1.599 | -0.0252 | [-0.037, -0.014] |
| AST | a_min_ewm_a040__clip_085_115 | role | starter_to_bench | 1098 | 1.375 | 1.400 | -0.0255 | [-0.042, -0.009] |
| AST | a_min_role__clip_085_115 | minutes | stable | 19637 | 1.430 | 1.430 | 0.0000 | [-0.001, 0.002] |
| AST | a_min_role__clip_085_115 | minutes | moderate | 6109 | 1.213 | 1.216 | -0.0032 | [-0.007, 0.001] |
| AST | a_min_role__clip_085_115 | minutes | large | 2379 | 1.020 | 1.028 | -0.0077 | [-0.014, -0.002] |
| AST | a_min_role__clip_085_115 | volume | low | 6604 | 0.895 | 0.897 | -0.0026 | [-0.004, -0.001] |
| AST | a_min_role__clip_085_115 | volume | rotation | 13197 | 1.323 | 1.326 | -0.0031 | [-0.006, -0.000] |
| AST | a_min_role__clip_085_115 | volume | high | 8324 | 1.748 | 1.745 | 0.0024 | [0.000, 0.005] |
| AST | a_min_role__clip_085_115 | role | starter_to_starter | 11335 | 1.649 | 1.649 | 0.0000 | [-0.002, 0.002] |
| AST | a_min_role__clip_085_115 | role | bench_to_bench | 13963 | 1.060 | 1.071 | -0.0109 | [-0.013, -0.009] |
| AST | a_min_role__clip_085_115 | role | bench_to_starter | 1692 | 1.626 | 1.599 | 0.0269 | [0.018, 0.036] |
| AST | a_min_role__clip_085_115 | role | starter_to_bench | 1098 | 1.460 | 1.400 | 0.0598 | [0.046, 0.072] |
| AST | b_min_l5__blended_rate | minutes | stable | 19637 | 1.432 | 1.430 | 0.0022 | [0.000, 0.004] |
| AST | b_min_l5__blended_rate | minutes | moderate | 6109 | 1.207 | 1.216 | -0.0095 | [-0.019, -0.001] |
| AST | b_min_l5__blended_rate | minutes | large | 2379 | 0.998 | 1.028 | -0.0298 | [-0.049, -0.008] |
| AST | b_min_l5__blended_rate | volume | low | 6604 | 0.900 | 0.897 | 0.0021 | [-0.003, 0.008] |
| AST | b_min_l5__blended_rate | volume | rotation | 13197 | 1.318 | 1.326 | -0.0081 | [-0.012, -0.003] |
| AST | b_min_l5__blended_rate | volume | high | 8324 | 1.746 | 1.745 | 0.0008 | [-0.005, 0.006] |
| AST | b_min_l5__blended_rate | role | starter_to_starter | 11335 | 1.649 | 1.649 | 0.0001 | [-0.006, 0.005] |
| AST | b_min_l5__blended_rate | role | bench_to_bench | 13963 | 1.065 | 1.071 | -0.0058 | [-0.010, -0.002] |
| AST | b_min_l5__blended_rate | role | bench_to_starter | 1692 | 1.579 | 1.599 | -0.0207 | [-0.033, -0.007] |
| AST | b_min_l5__blended_rate | role | starter_to_bench | 1098 | 1.429 | 1.400 | 0.0286 | [0.012, 0.052] |
| AST | r_shift_l5__tau_020 | minutes | stable | 19637 | 1.436 | 1.430 | 0.0062 | [0.003, 0.009] |
| AST | r_shift_l5__tau_020 | minutes | moderate | 6109 | 1.233 | 1.216 | 0.0164 | [0.005, 0.025] |
| AST | r_shift_l5__tau_020 | minutes | large | 2379 | 1.014 | 1.028 | -0.0133 | [-0.034, 0.012] |
| AST | r_shift_l5__tau_020 | volume | low | 6604 | 0.909 | 0.897 | 0.0120 | [0.005, 0.019] |
| AST | r_shift_l5__tau_020 | volume | rotation | 13197 | 1.335 | 1.326 | 0.0087 | [0.004, 0.015] |
| AST | r_shift_l5__tau_020 | volume | high | 8324 | 1.745 | 1.745 | -0.0005 | [-0.004, 0.003] |
| AST | r_shift_l5__tau_020 | role | starter_to_starter | 11335 | 1.652 | 1.649 | 0.0030 | [-0.001, 0.008] |
| AST | r_shift_l5__tau_020 | role | bench_to_bench | 13963 | 1.077 | 1.071 | 0.0066 | [0.001, 0.012] |
| AST | r_shift_l5__tau_020 | role | bench_to_starter | 1692 | 1.603 | 1.599 | 0.0038 | [-0.012, 0.020] |
| AST | r_shift_l5__tau_020 | role | starter_to_bench | 1098 | 1.456 | 1.400 | 0.0564 | [0.032, 0.085] |
| PRA | a_min_l5__clip_085_115 | minutes | stable | 19637 | 6.263 | 6.246 | 0.0171 | [0.005, 0.029] |
| PRA | a_min_l5__clip_085_115 | minutes | moderate | 6109 | 5.810 | 5.889 | -0.0788 | [-0.125, -0.038] |
| PRA | a_min_l5__clip_085_115 | minutes | large | 2379 | 5.218 | 5.397 | -0.1797 | [-0.235, -0.126] |
| PRA | a_min_l5__clip_085_115 | volume | low | 6604 | 4.895 | 4.934 | -0.0386 | [-0.054, -0.019] |
| PRA | a_min_l5__clip_085_115 | volume | rotation | 13197 | 6.023 | 6.079 | -0.0552 | [-0.079, -0.033] |
| PRA | a_min_l5__clip_085_115 | volume | high | 8324 | 7.097 | 7.048 | 0.0495 | [0.015, 0.084] |
| PRA | a_min_l5__clip_085_115 | role | starter_to_starter | 11335 | 6.835 | 6.806 | 0.0290 | [0.004, 0.055] |
| PRA | a_min_l5__clip_085_115 | role | bench_to_bench | 13963 | 5.202 | 5.252 | -0.0493 | [-0.065, -0.030] |
| PRA | a_min_l5__clip_085_115 | role | bench_to_starter | 1692 | 7.844 | 7.955 | -0.1107 | [-0.169, -0.057] |
| PRA | a_min_l5__clip_085_115 | role | starter_to_bench | 1098 | 6.575 | 6.597 | -0.0223 | [-0.107, 0.056] |
| PRA | a_min_ewm_a040__clip_085_115 | minutes | stable | 19637 | 6.257 | 6.246 | 0.0106 | [-0.007, 0.030] |
| PRA | a_min_ewm_a040__clip_085_115 | minutes | moderate | 6109 | 5.758 | 5.889 | -0.1302 | [-0.171, -0.085] |
| PRA | a_min_ewm_a040__clip_085_115 | minutes | large | 2379 | 5.184 | 5.397 | -0.2129 | [-0.265, -0.164] |
| PRA | a_min_ewm_a040__clip_085_115 | volume | low | 6604 | 4.848 | 4.934 | -0.0863 | [-0.106, -0.066] |
| PRA | a_min_ewm_a040__clip_085_115 | volume | rotation | 13197 | 6.005 | 6.079 | -0.0732 | [-0.096, -0.050] |
| PRA | a_min_ewm_a040__clip_085_115 | volume | high | 8324 | 7.101 | 7.048 | 0.0531 | [0.019, 0.090] |
| PRA | a_min_ewm_a040__clip_085_115 | role | starter_to_starter | 11335 | 6.854 | 6.806 | 0.0475 | [0.021, 0.074] |
| PRA | a_min_ewm_a040__clip_085_115 | role | bench_to_bench | 13963 | 5.171 | 5.252 | -0.0805 | [-0.099, -0.062] |
| PRA | a_min_ewm_a040__clip_085_115 | role | bench_to_starter | 1692 | 7.761 | 7.955 | -0.1935 | [-0.266, -0.135] |
| PRA | a_min_ewm_a040__clip_085_115 | role | starter_to_bench | 1098 | 6.439 | 6.597 | -0.1581 | [-0.260, -0.057] |
| PRA | a_min_role__clip_085_115 | minutes | stable | 19637 | 6.261 | 6.246 | 0.0152 | [0.005, 0.024] |
| PRA | a_min_role__clip_085_115 | minutes | moderate | 6109 | 5.865 | 5.889 | -0.0237 | [-0.045, 0.005] |
| PRA | a_min_role__clip_085_115 | minutes | large | 2379 | 5.370 | 5.397 | -0.0277 | [-0.055, 0.013] |
| PRA | a_min_role__clip_085_115 | volume | low | 6604 | 4.920 | 4.934 | -0.0137 | [-0.027, -0.000] |
| PRA | a_min_role__clip_085_115 | volume | rotation | 13197 | 6.082 | 6.079 | 0.0031 | [-0.013, 0.020] |
| PRA | a_min_role__clip_085_115 | volume | high | 8324 | 7.064 | 7.048 | 0.0166 | [0.004, 0.030] |
| PRA | a_min_role__clip_085_115 | role | starter_to_starter | 11335 | 6.789 | 6.806 | -0.0169 | [-0.027, -0.007] |
| PRA | a_min_role__clip_085_115 | role | bench_to_bench | 13963 | 5.201 | 5.252 | -0.0510 | [-0.063, -0.038] |
| PRA | a_min_role__clip_085_115 | role | bench_to_starter | 1692 | 8.305 | 7.955 | 0.3503 | [0.301, 0.397] |
| PRA | a_min_role__clip_085_115 | role | starter_to_bench | 1098 | 6.955 | 6.597 | 0.3584 | [0.282, 0.433] |
| PRA | b_min_l5__blended_rate | minutes | stable | 19637 | 6.286 | 6.246 | 0.0403 | [0.027, 0.054] |
| PRA | b_min_l5__blended_rate | minutes | moderate | 6109 | 5.829 | 5.889 | -0.0596 | [-0.113, -0.005] |
| PRA | b_min_l5__blended_rate | minutes | large | 2379 | 5.240 | 5.397 | -0.1575 | [-0.284, -0.025] |
| PRA | b_min_l5__blended_rate | volume | low | 6604 | 4.904 | 4.934 | -0.0303 | [-0.068, 0.009] |
| PRA | b_min_l5__blended_rate | volume | rotation | 13197 | 6.042 | 6.079 | -0.0364 | [-0.067, -0.002] |
| PRA | b_min_l5__blended_rate | volume | high | 8324 | 7.136 | 7.048 | 0.0880 | [0.053, 0.123] |
| PRA | b_min_l5__blended_rate | role | starter_to_starter | 11335 | 6.865 | 6.806 | 0.0591 | [0.032, 0.089] |
| PRA | b_min_l5__blended_rate | role | bench_to_bench | 13963 | 5.219 | 5.252 | -0.0330 | [-0.057, -0.002] |
| PRA | b_min_l5__blended_rate | role | bench_to_starter | 1692 | 7.760 | 7.955 | -0.1947 | [-0.274, -0.111] |
| PRA | b_min_l5__blended_rate | role | starter_to_bench | 1098 | 6.752 | 6.597 | 0.1553 | [0.046, 0.268] |
| PRA | r_shift_l5__tau_020 | minutes | stable | 19637 | 6.273 | 6.246 | 0.0270 | [0.016, 0.039] |
| PRA | r_shift_l5__tau_020 | minutes | moderate | 6109 | 5.916 | 5.889 | 0.0278 | [-0.026, 0.082] |
| PRA | r_shift_l5__tau_020 | minutes | large | 2379 | 5.352 | 5.397 | -0.0452 | [-0.183, 0.086] |
| PRA | r_shift_l5__tau_020 | volume | low | 6604 | 4.946 | 4.934 | 0.0116 | [-0.030, 0.060] |
| PRA | r_shift_l5__tau_020 | volume | rotation | 13197 | 6.107 | 6.079 | 0.0282 | [-0.004, 0.059] |
| PRA | r_shift_l5__tau_020 | volume | high | 8324 | 7.065 | 7.048 | 0.0174 | [-0.001, 0.036] |
| PRA | r_shift_l5__tau_020 | role | starter_to_starter | 11335 | 6.822 | 6.806 | 0.0162 | [-0.003, 0.039] |
| PRA | r_shift_l5__tau_020 | role | bench_to_bench | 13963 | 5.282 | 5.252 | 0.0302 | [0.003, 0.063] |
| PRA | r_shift_l5__tau_020 | role | bench_to_starter | 1692 | 7.784 | 7.955 | -0.1713 | [-0.266, -0.083] |
| PRA | r_shift_l5__tau_020 | role | starter_to_bench | 1098 | 6.860 | 6.597 | 0.2630 | [0.146, 0.373] |

## Market subset (2023–24 core two-way tape)

Subset only. Closing/generic archive line vs Played-only Track A. Not season-wide. Combos are absent from the 2023-24 core tape and are not scored here.

| Prop | Eligible | With market | Coverage % | Court Context MAE | Market MAE |
| --- | --- | --- | --- | --- | --- |
| PTS | 27653 | 3999 | 14.461 | 5.190 | 4.829 |
| REB | 27653 | 4028 | 14.566 | 2.098 | 2.013 |
| AST | 27653 | 3950 | 14.284 | 1.538 | 1.498 |
| 3PM | 27653 | 3637 | 13.152 | 1.103 | 1.099 |

This is not season-wide market validation. 2024–25 ESPN BET / combo rows were not mixed in.

## Interpretation

The promoted family is **Concept A**: scale Played-only Track A by `clip(EWM minutes / L10 minutes, 0.85, 1.15)`. That is **not** minutes × rate, and it is **not** the `game_starters` role estimator.

- Minutes × rate (Concept B) still does not beat Track A on the 2025–26 test (same conclusion as the earlier DNP-cleanup study).
- Role-aware minutes from prior certified starters **hurt** observed bench→starter and starter→bench slices (PTS +0.16 / +0.19). Those labels are 2025-only and postgame-certified; they are the wrong feature for a pregame role shift.
- Switching to L5 counting when minutes moved (`r_shift_l5`) also failed overall.
- The EWM ratio helps **large pregame minutes-change** (PTS ΔMAE −0.10, PRA −0.21, CI entirely below 0) and **bench** slices. It is flat-to-worse on **stable minutes** and **high-minute starter→starter**.
- 3PM, REB, and AST stay essentially tied. Combos (PRA/PA/PR) carry the overall promote. Do not force one formula onto 3PM.
- This is a **research v1 candidate**, not a production change. A minutes-change gate (`|L5−L10|/L10` moderate or large) is the natural way to avoid harming stable high-minute starters if this family is ever served.

## Decision

**PROMOTE TO V1 CANDIDATE**

5 props have val-selected candidates with test ΔMAE ≤ -0.01 and 95% CI entirely below 0.

Promoted candidate: Concept A EWM minutes-ratio (val-selected α=0.25 / clip 0.85–1.15; pre-specified α=0.40 also wins on combos). Production Track A is unchanged.

