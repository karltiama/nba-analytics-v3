# Played-only shadow projection pipeline

Run: 2026-09-14T01:53:57.745Z
Research version: `played-only-shadow-v1`. Feature definition: **active_season** as-of tipoff.
Seasons 2023, 2024, 2025. Range 2023-10-27T02:00:00.000Z → 2026-06-14T00:30:00.000Z.
Scored: **83479** played player-games with ≥1 prior played game (793 players).
**Production was not changed.** Track A, Track B.1, `getPlayerPropModelInputs()`, APIs, UI, ingestion, and `ev-calibration-artifacts.json` were not edited or overwritten.

## Pipeline (research only)

played-only historical inputs → Track A mean → raw P via existing Normal CDF → research calibration → optional market anchoring → research EV

The projection **mean is market-independent**. The sportsbook line is used only as the probability threshold `P(stat > line)`, then for calibration/anchoring/EV.

| Quantity | Sportsbook? |
| --- | --- |
| Court Context mean | independent |
| Raw model probability | line is the threshold only |
| Calibrated probability | derived from model P |
| Anchored probability | explicitly market-influenced |
| EV | market-dependent |

Do not call anchored probability an independent Court Context probability.

## 1. Clean Track A vs Clean Track B

ΔMAE = Played-only Track B − Played-only Track A. Negative = B better. Classification: materially better: ΔMAE ≤ -0.03; marginal: -0.03 < Δ ≤ -0.01; tied: |Δ| < 0.01; worse: Δ ≥ 0.01. Not a significance test; bootstrap CI reported when computed.

| Prop | Prod A MAE | Prod B MAE | Played A MAE | Played B MAE | Δ B−A   | Class    | Bootstrap 95% CI | Preferred |
| ---- | ---------- | ---------- | ------------ | ------------ | ------- | -------- | ---------------- | --------- |
| PTS  | 4.857      | 4.861      | 4.621        | 4.634        | 0.0127  | worse    | [0.008, 0.018]   | Track A   |
| REB  | 1.985      | 1.988      | 1.918        | 1.925        | 0.0077  | tied     | [0.006, 0.010]   | Track A   |
| AST  | 1.370      | 1.372      | 1.349        | 1.351        | 0.0027  | tied     | [0.001, 0.004]   | Track A   |
| 3PM  | 0.877      | 0.881      | 0.885        | 0.889        | 0.0035  | tied     | [0.003, 0.004]   | Track A   |
| PRA  | 6.658      | 6.629      | 6.108        | 6.096        | -0.0124 | marginal | [-0.017, -0.008] | Track B   |
| PA   | 5.462      | 5.447      | 5.099        | 5.093        | -0.0053 | tied     | [-0.009, -0.001] | Track A   |
| PR   | 6.020      | 6.002      | 5.604        | 5.599        | -0.0055 | tied     | [-0.010, -0.001] | Track A   |
| RA   | 2.801      | 2.795      | 2.644        | 2.643        | -0.0010 | tied     | [-0.003, 0.001]  | Track A   |

Track B does **not** earn its complexity once inputs are clean: played-only B is tied or only marginally different from played-only A on every prop.

## 2. Preferred baseline by prop

| Prop | Preferred clean baseline | Why                  |
| ---- | ------------------------ | -------------------- |
| PTS  | Played-only Track A      | worse (Δ 0.0127)     |
| REB  | Played-only Track A      | tied (Δ 0.0077)      |
| AST  | Played-only Track A      | tied (Δ 0.0027)      |
| 3PM  | Played-only Track A      | tied (Δ 0.0035)      |
| PRA  | Played-only Track B      | marginal (Δ -0.0124) |
| PA   | Played-only Track A      | tied (Δ -0.0053)     |
| PR   | Played-only Track A      | tied (Δ -0.0055)     |
| RA   | Played-only Track A      | tied (Δ -0.0010)     |

## 12. Would-have-shipped MAE / bias

### PTS

| Model               | MAE   | RMSE  | Bias   | Median AE | Coverage | N     |
| ------------------- | ----- | ----- | ------ | --------- | -------- | ----- |
| Production Track A  | 4.857 | 6.587 | -1.648 | 3.630     | 1.000    | 83479 |
| Production Track B  | 4.861 | 6.587 | -1.526 | 3.640     | 1.000    | 83479 |
| Played-only Track A | 4.621 | 6.093 | -0.165 | 3.607     | 1.000    | 83479 |
| Played-only Track B | 4.634 | 6.116 | -0.127 | 3.617     | 1.000    | 83479 |

Preferred clean baseline: **Track A**

### REB

| Model               | MAE   | RMSE  | Bias   | Median AE | Coverage | N     |
| ------------------- | ----- | ----- | ------ | --------- | -------- | ----- |
| Production Track A  | 1.985 | 2.724 | -0.656 | 1.471     | 1.000    | 83479 |
| Production Track B  | 1.988 | 2.723 | -0.612 | 1.473     | 1.000    | 83479 |
| Played-only Track A | 1.918 | 2.549 | -0.055 | 1.500     | 1.000    | 83479 |
| Played-only Track B | 1.925 | 2.559 | -0.042 | 1.500     | 1.000    | 83479 |

Preferred clean baseline: **Track A**

### AST

| Model               | MAE   | RMSE  | Bias   | Median AE | Coverage | N     |
| ------------------- | ----- | ----- | ------ | --------- | -------- | ----- |
| Production Track A  | 1.370 | 1.948 | -0.393 | 0.967     | 1.000    | 83479 |
| Production Track B  | 1.372 | 1.947 | -0.365 | 0.970     | 1.000    | 83479 |
| Played-only Track A | 1.349 | 1.850 | -0.044 | 1.000     | 1.000    | 83479 |
| Played-only Track B | 1.351 | 1.855 | -0.034 | 1.000     | 1.000    | 83479 |

Preferred clean baseline: **Track A**

### 3PM

| Model               | MAE   | RMSE  | Bias   | Median AE | Coverage | N     |
| ------------------- | ----- | ----- | ------ | --------- | -------- | ----- |
| Production Track A  | 0.877 | 1.288 | -0.187 | 0.617     | 1.000    | 83479 |
| Production Track B  | 0.881 | 1.292 | -0.175 | 0.623     | 1.000    | 83479 |
| Played-only Track A | 0.885 | 1.260 | -0.018 | 0.655     | 1.000    | 83479 |
| Played-only Track B | 0.889 | 1.267 | -0.015 | 0.656     | 1.000    | 83479 |

Preferred clean baseline: **Track A**

### PRA

| Model               | MAE   | RMSE  | Bias   | Median AE | Coverage | N     |
| ------------------- | ----- | ----- | ------ | --------- | -------- | ----- |
| Production Track A  | 6.658 | 8.891 | -2.698 | 5.077     | 1.000    | 83479 |
| Production Track B  | 6.629 | 8.852 | -2.549 | 5.051     | 1.000    | 83479 |
| Played-only Track A | 6.108 | 7.924 | -0.263 | 4.940     | 1.000    | 83479 |
| Played-only Track B | 6.096 | 7.913 | -0.219 | 4.901     | 1.000    | 83479 |

Preferred clean baseline: **Track B**

### PA

| Model               | MAE   | RMSE  | Bias   | Median AE | Coverage | N     |
| ------------------- | ----- | ----- | ------ | --------- | -------- | ----- |
| Production Track A  | 5.462 | 7.375 | -2.041 | 4.100     | 1.000    | 83479 |
| Production Track B  | 5.447 | 7.352 | -1.929 | 4.103     | 1.000    | 83479 |
| Played-only Track A | 5.099 | 6.682 | -0.208 | 4.000     | 1.000    | 83479 |
| Played-only Track B | 5.093 | 6.681 | -0.173 | 4.000     | 1.000    | 83479 |

Preferred clean baseline: **Track A**

### PR

| Model               | MAE   | RMSE  | Bias   | Median AE | Coverage | N     |
| ------------------- | ----- | ----- | ------ | --------- | -------- | ----- |
| Production Track A  | 6.020 | 8.061 | -2.305 | 4.594     | 1.000    | 83479 |
| Production Track B  | 6.002 | 8.035 | -2.180 | 4.577     | 1.000    | 83479 |
| Played-only Track A | 5.604 | 7.295 | -0.220 | 4.495     | 1.000    | 83479 |
| Played-only Track B | 5.599 | 7.293 | -0.183 | 4.476     | 1.000    | 83479 |

Preferred clean baseline: **Track A**

### RA

| Model               | MAE   | RMSE  | Bias   | Median AE | Coverage | N     |
| ------------------- | ----- | ----- | ------ | --------- | -------- | ----- |
| Production Track A  | 2.801 | 3.781 | -1.050 | 2.100     | 1.000    | 83479 |
| Production Track B  | 2.795 | 3.768 | -0.994 | 2.100     | 1.000    | 83479 |
| Played-only Track A | 2.644 | 3.461 | -0.099 | 2.089     | 1.000    | 83479 |
| Played-only Track B | 2.643 | 3.459 | -0.082 | 2.090     | 1.000    | 83479 |

Preferred clean baseline: **Track A**

## 3. Probability impact (raw, all market overlap, no anchor)

Market tape: 2026-04-03T01:30:00.000Z → 2026-05-02T23:30:00.000Z (10581 rows). Thin. Not season-long proof.

| Model                   | Brier  | ECE    | Log loss | N     |
| ----------------------- | ------ | ------ | -------- | ----- |
| Production Track A raw  | 0.2695 | 0.1051 | 0.7558   | 10492 |
| Production Track B raw  | 0.2629 | 0.0892 | 0.7320   | 10492 |
| Played-only Track A raw | 0.2632 | 0.0919 | 0.7251   | 10492 |
| Played-only Track B raw | 0.2593 | 0.0861 | 0.7156   | 10492 |

## 4–5. Calibration and market-anchor contribution (held-out chronological rows)

Split: unique start times, fitFraction=0.7, cut=2026-04-24T01:30:00.000Z. Fit rows 7920, holdout 2661. Never random-split.
Production calibration on played-only raw P is labeled **mismatched calibration** and is diagnostic only.
Research refit family: `p = slope * p_raw + intercept` with identity shrink λ=0.35 (same as production fitter). Saved to `reports/model-validation/shadow-calibration.json`, not `lib/betting/ev-calibration-artifacts.json`.

| Stage                          | Brier  | ECE    | Log loss | N    |
| ------------------------------ | ------ | ------ | -------- | ---- |
| production_raw                 | 0.2516 | 0.0542 | 0.7056   | 2636 |
| production_calibrated          | 0.2477 | 0.0277 | 0.6924   | 2636 |
| production_anchored            | 0.2455 | 0.0340 | 0.6841   | 2636 |
| played_a_raw                   | 0.2589 | 0.0930 | 0.7138   | 2636 |
| played_a_mismatched_cal        | 0.2531 | 0.0773 | 0.7002   | 2636 |
| played_a_research_cal          | 0.2472 | 0.0442 | 0.6875   | 2636 |
| played_a_research_cal_anchored | 0.2471 | 0.0477 | 0.6873   | 2636 |

Mismatched production calibration vs played-only raw: Brier 0.2531 vs 0.2589.
Research refit vs mismatched: Brier 0.2472 vs 0.2531.
Anchor after research refit: Brier 0.2471 (production anchored 0.2455). Good calibration after anchoring is **not** an independent model edge.

## 6. 3PM shrinkage (market-independent)

Do not preserve fake DNP zeros. Explicit shrinkage: `reliability * player_projection + (1-r) * center`, `r = n/(n+k)`, k ∈ {5,10,20}.

| Model                       | MAE   | Bias   | N     |
| --------------------------- | ----- | ------ | ----- |
| Production Track A          | 0.877 | -0.187 | 83479 |
| Played-only Track A         | 0.885 | -0.018 | 83479 |
| Shrink → league k=5         | 0.925 | 0.006  | 83479 |
| Shrink → player season k=5  | 0.883 | -0.020 | 83479 |
| Shrink → league k=10        | 0.949 | 0.012  | 83479 |
| Shrink → player season k=10 | 0.882 | -0.022 | 83479 |
| Shrink → league k=20        | 0.982 | 0.013  | 83479 |
| Shrink → player season k=20 | 0.881 | -0.024 | 83479 |

Chronological holdout (70% unique start times, cut 2025-11-14T02:00:00.000Z):

| Model (holdout)             | MAE   | Bias   | N     |
| --------------------------- | ----- | ------ | ----- |
| Production Track A          | 0.882 | -0.204 | 24671 |
| Played-only Track A         | 0.890 | -0.009 | 24671 |
| Shrink → league k=5         | 0.920 | 0.011  | 24671 |
| Shrink → player season k=5  | 0.889 | -0.010 | 24671 |
| Shrink → league k=10        | 0.940 | 0.016  | 24671 |
| Shrink → player season k=10 | 0.888 | -0.011 | 24671 |
| Shrink → league k=20        | 0.970 | 0.019  | 24671 |
| Shrink → player season k=20 | 0.887 | -0.012 | 24671 |

## 7. Postseason diagnostic (no adjustment added)

|                              | Value          |
| ---------------------------- | -------------- |
| N played postseason games    | 5785           |
| Starter share (known role)   | 0.445          |
| High-minute share (≥28)      | 0.408          |
| Mean actual minutes          | 22.460         |
| Mean prior played games      | 68.582         |
| PTS n                        | 5785           |
| PTS mean actual              | 10.012         |
| PTS mean production A        | 9.526          |
| PTS mean played-only A       | 11.197         |
| PTS production A MAE / bias  | 4.590 / -0.486 |
| PTS played-only A MAE / bias | 4.689 / 1.184  |
| PTS played-only B MAE / bias | 4.668 / 1.058  |

DNP zeros shrink playoff projections toward 0. Played-only removes that accidental regularizer. If played-only over-projects playoff minutes/usage, that is a role/minutes problem — not a reason to keep `"00"` in counting averages.

## 8. Confidence tier validation (played-only Track B, market overlap)

| Prop | Tier   | N    | MAE   | RMSE  | Bias   | Directional hit |
| ---- | ------ | ---- | ----- | ----- | ------ | --------------- |
| PTS  | high   | 374  | 5.823 | 7.634 | -0.001 | 0.553           |
| PTS  | medium | 799  | 5.343 | 6.808 | 0.420  | 0.491           |
| PTS  | low    | 325  | 4.987 | 6.190 | -0.071 | 0.465           |
| REB  | high   | 182  | 2.367 | 3.105 | 0.438  | 0.538           |
| REB  | medium | 854  | 2.117 | 2.784 | -0.051 | 0.494           |
| REB  | low    | 431  | 2.072 | 2.693 | -0.405 | 0.500           |
| AST  | high   | 113  | 2.062 | 2.612 | 0.443  | 0.482           |
| AST  | medium | 595  | 1.833 | 2.461 | 0.189  | 0.551           |
| AST  | low    | 659  | 1.434 | 1.932 | -0.118 | 0.547           |
| 3PM  | high   | 68   | 0.773 | 1.207 | -0.072 | 0.662           |
| 3PM  | medium | 342  | 1.253 | 1.574 | 0.154  | 0.579           |
| 3PM  | low    | 900  | 1.128 | 1.445 | 0.061  | 0.523           |
| PRA  | high   | 0    | n/a   | n/a   | n/a    | n/a             |
| PRA  | medium | 0    | n/a   | n/a   | n/a    | n/a             |
| PRA  | low    | 1434 | 6.712 | 8.512 | 0.626  | 0.505           |
| PA   | high   | 0    | n/a   | n/a   | n/a    | n/a             |
| PA   | medium | 0    | n/a   | n/a   | n/a    | n/a             |
| PA   | low    | 1119 | 5.994 | 7.667 | 0.274  | 0.502           |
| PR   | high   | 0    | n/a   | n/a   | n/a    | n/a             |
| PR   | medium | 0    | n/a   | n/a   | n/a    | n/a             |
| PR   | low    | 1291 | 6.289 | 7.990 | 0.320  | 0.515           |
| RA   | high   | 0    | n/a   | n/a   | n/a    | n/a             |
| RA   | medium | 0    | n/a   | n/a   | n/a    | n/a             |
| RA   | low    | 1095 | 2.987 | 3.859 | 0.026  | 0.530           |

## 9. Segment stability (played-only A vs B)

### phase:regular

| Prop | A MAE | B MAE | Δ B−A   | N(A)  |
| ---- | ----- | ----- | ------- | ----- |
| PTS  | 4.616 | 4.631 | 0.0152  | 77694 |
| REB  | 1.919 | 1.927 | 0.0081  | 77694 |
| AST  | 1.352 | 1.356 | 0.0038  | 77694 |
| 3PM  | 0.885 | 0.888 | 0.0038  | 77694 |
| PRA  | 6.101 | 6.092 | -0.0095 | 77694 |
| PA   | 5.092 | 5.090 | -0.0025 | 77694 |
| PR   | 5.598 | 5.595 | -0.0031 | 77694 |
| RA   | 2.646 | 2.646 | 0.0001  | 77694 |

### phase:postseason

| Prop | A MAE | B MAE | Δ B−A   | N(A) |
| ---- | ----- | ----- | ------- | ---- |
| PTS  | 4.689 | 4.668 | -0.0208 | 5785 |
| REB  | 1.902 | 1.904 | 0.0021  | 5785 |
| AST  | 1.302 | 1.291 | -0.0112 | 5785 |
| 3PM  | 0.892 | 0.892 | 0.0003  | 5785 |
| PRA  | 6.205 | 6.152 | -0.0527 | 5785 |
| PA   | 5.183 | 5.140 | -0.0435 | 5785 |
| PR   | 5.687 | 5.649 | -0.0375 | 5785 |
| RA   | 2.616 | 2.600 | -0.0156 | 5785 |

### sample:1-4

| Prop | A MAE | B MAE | Δ B−A  | N(A) |
| ---- | ----- | ----- | ------ | ---- |
| PTS  | 4.357 | 4.357 | 0.0000 | 6681 |
| REB  | 1.893 | 1.893 | 0.0000 | 6681 |
| AST  | 1.230 | 1.230 | 0.0000 | 6681 |
| 3PM  | 0.803 | 0.803 | 0.0000 | 6681 |
| PRA  | 5.791 | 5.791 | 0.0000 | 6681 |
| PA   | 4.772 | 4.772 | 0.0000 | 6681 |
| PR   | 5.342 | 5.342 | 0.0000 | 6681 |
| RA   | 2.565 | 2.565 | 0.0000 | 6681 |

### sample:5-9

| Prop | A MAE | B MAE | Δ B−A   | N(A) |
| ---- | ----- | ----- | ------- | ---- |
| PTS  | 4.184 | 4.182 | -0.0019 | 7802 |
| REB  | 1.811 | 1.811 | 0.0004  | 7802 |
| AST  | 1.235 | 1.236 | 0.0009  | 7802 |
| 3PM  | 0.798 | 0.798 | 0.0004  | 7802 |
| PRA  | 5.597 | 5.594 | -0.0026 | 7802 |
| PA   | 4.634 | 4.630 | -0.0040 | 7802 |
| PR   | 5.125 | 5.120 | -0.0049 | 7802 |
| RA   | 2.490 | 2.490 | -0.0002 | 7802 |

### sample:10-19

| Prop | A MAE | B MAE | Δ B−A   | N(A)  |
| ---- | ----- | ----- | ------- | ----- |
| PTS  | 4.404 | 4.419 | 0.0143  | 14286 |
| REB  | 1.837 | 1.841 | 0.0041  | 14286 |
| AST  | 1.283 | 1.284 | 0.0014  | 14286 |
| 3PM  | 0.831 | 0.836 | 0.0046  | 14286 |
| PRA  | 5.882 | 5.874 | -0.0075 | 14286 |
| PA   | 4.885 | 4.883 | -0.0022 | 14286 |
| PR   | 5.381 | 5.378 | -0.0028 | 14286 |
| RA   | 2.537 | 2.534 | -0.0020 | 14286 |

### sample:20+

| Prop | A MAE | B MAE | Δ B−A   | N(A)  |
| ---- | ----- | ----- | ------- | ----- |
| PTS  | 4.772 | 4.788 | 0.0159  | 54710 |
| REB  | 1.957 | 1.968 | 0.0107  | 54710 |
| AST  | 1.396 | 1.400 | 0.0037  | 54710 |
| 3PM  | 0.922 | 0.926 | 0.0042  | 54710 |
| PRA  | 6.279 | 6.263 | -0.0167 | 54710 |
| PA   | 5.261 | 5.254 | -0.0069 | 54710 |
| PR   | 5.763 | 5.756 | -0.0070 | 54710 |
| RA   | 2.703 | 2.702 | -0.0010 | 54710 |

### team:changed

| Prop | A MAE | B MAE | Δ B−A   | N(A) |
| ---- | ----- | ----- | ------- | ---- |
| PTS  | 4.548 | 4.523 | -0.0248 | 5219 |
| REB  | 1.900 | 1.895 | -0.0050 | 5219 |
| AST  | 1.399 | 1.390 | -0.0095 | 5219 |
| 3PM  | 0.831 | 0.832 | 0.0010  | 5219 |
| PRA  | 6.327 | 6.250 | -0.0765 | 5219 |
| PA   | 5.165 | 5.115 | -0.0500 | 5219 |
| PR   | 5.670 | 5.622 | -0.0480 | 5219 |
| RA   | 2.763 | 2.741 | -0.0221 | 5219 |

### team:no_change

| Prop | A MAE | B MAE | Δ B−A   | N(A)  |
| ---- | ----- | ----- | ------- | ----- |
| PTS  | 4.626 | 4.641 | 0.0153  | 78260 |
| REB  | 1.919 | 1.927 | 0.0086  | 78260 |
| AST  | 1.345 | 1.349 | 0.0036  | 78260 |
| 3PM  | 0.889 | 0.892 | 0.0037  | 78260 |
| PRA  | 6.094 | 6.086 | -0.0082 | 78260 |
| PA   | 5.094 | 5.092 | -0.0023 | 78260 |
| PR   | 5.600 | 5.597 | -0.0026 | 78260 |
| RA   | 2.636 | 2.636 | 0.0004  | 78260 |

## 10. Production candidate

**E. More validation needed** — do not switch production.

Shadow mean to keep iterating: **Played-only Track A** (option B as a research candidate, not a ship). Track B does not earn complexity on counting props; PRA’s −0.012 MAE is real (bootstrap CI excludes 0) but small versus the 0.55 DNP-cleanup gain. 3PM explicit shrinkage toward the player season mean recovers only ~half of the accidental DNP-zero benefit and still loses to DNP-inclusive Track A. Research calibration on this thin Apr–May 2026 tape **does** beat mismatched production calibration on holdout Brier, but the tape is one month and points rawSlope was negative before identity shrink — refit on a later window before serving. EV on this overlap is not season-long proof.

This is a recommendation only. **Do not implement the switch.**

## 11. Required migration sequence (if we later ship)

1. Played-game input semantics in `getPlayerPropModelInputs()` / log windows (`"00"` DNP out; `"0"` and 0-stat appearances in)
2. Shadow mean serving (Track A, possibly prop-specific 3PM shrinkage) behind a flag
3. Calibration **refit** on the new raw probabilities (do not reuse `ev-calibration-artifacts.json`)
4. Probability validation (Brier/ECE on a later market window)
5. EV validation on a later tape — do not tune to this thin overlap
6. Production switch + confidence redesign if tiers remain unordered

## 12. Files that would need production changes

List only — **not edited in this task**:

- `lib/betting/player-prop-inputs.ts` (`getPlayerPropModelInputs`, last10/last5/season windows)
- `lib/players/` analytics game-log fetchers if they currently return DNP roster rows in L10
- `lib/betting/ev-calibration-artifacts.json` (refit after mean change; do not reuse)
- `scripts/fit-ev-calibration.ts` (fit SQL currently averages DNP-inclusive logs)
- `lib/betting/player-prop-ev-row.ts` only if serving should expose shadow stages
- Prop APIs / UI copy only if confidence labels or input footnotes change

Not required for a played-only Track A mean: `lib/betting/player-prop-model.ts` (Track A formula), `lib/betting/track-b1-policy.ts` (unless shipping Track B on clean inputs).

## Leakage counters

| Check                              | Count |
| ---------------------------------- | ----- |
| Target game in features            | 0     |
| Later games in features            | 0     |
| DNP retained in played-only inputs | 0     |
| Valid 0-stat played games dropped  | 0     |
| Post-tip market lines in overlap   | 0     |
| Season-average table used          | false |
| Sportsbook used in mean            | false |

## Shadow EV diagnostic (thin tape — do not optimize)

| Pipeline stage                      | N     | +EV n | Avg EV  | Hit rate | +EV hit | +EV unit return |
| ----------------------------------- | ----- | ----- | ------- | -------- | ------- | --------------- |
| Production anchored                 | 10492 | 2019  | -0.0932 | 0.465    | 0.468   | -0.0790         |
| Played-only A raw                   | 10492 | 4799  | -0.0273 | 0.465    | 0.460   | -0.1203         |
| Played-only A mismatched cal        | 10492 | 4115  | -0.0365 | 0.465    | 0.451   | -0.1196         |
| Played-only A research cal          | 10492 | 2261  | -0.0817 | 0.465    | 0.447   | -0.0962         |
| Played-only A research cal + anchor | 10492 | 2261  | -0.0694 | 0.465    | 0.447   | -0.0962         |

Repro: `npm run evaluate:shadow-projection`
