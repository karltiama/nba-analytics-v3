# Player projection learned r1

Version: `player-projection-learned-r1`. Research only. Production unchanged.

Train 2023, select on 2024, score 2025 as **previously inspected historical confirmation**. No historical period here is an untouched holdout. Prospective 2026–27 shadow is the future holdout.

A = frozen played-only 70/30. B = frozen conditional EWM minutes (never on 3PM). C = learned production/role/opportunity features. D = C + schedule/team/opponent reconstructed context.

PRA is ŷ_PTS+ŷ_REB+ŷ_AST. It is a derived target and is not independent evidence.

Historical validity: reconstructed from completed boxes. Publication timestamps and retrospective corrections are not fully observable.

Common eligible rows: validation n=27696; 2025 confirmation n=28130.

## 2024 validation (selection)

| Target | Model | MAE | RMSE | Bias | Coverage | N |
| --- | --- | --- | --- | --- | --- | --- |
| POINTS | A | 4.6638 | 6.1446 | -0.2249 | 1.000 | 27696 |
| POINTS | B | 4.6557 | 6.1355 | -0.2162 | 1.000 | 27696 |
| POINTS | C | 4.6039 | 6.0291 | -0.0730 | 1.000 | 27696 |
| POINTS | D | 4.5969 | 6.0104 | -0.0394 | 1.000 | 27696 |
| REBOUNDS | A | 1.9402 | 2.5750 | -0.0655 | 1.000 | 27696 |
| REBOUNDS | B | 1.9368 | 2.5709 | -0.0628 | 1.000 | 27696 |
| REBOUNDS | C | 1.9216 | 2.5366 | -0.0418 | 1.000 | 27696 |
| REBOUNDS | D | 1.9194 | 2.5319 | -0.0327 | 1.000 | 27696 |
| ASSISTS | A | 1.3487 | 1.8523 | -0.0508 | 1.000 | 27696 |
| ASSISTS | B | 1.3475 | 1.8509 | -0.0490 | 1.000 | 27696 |
| ASSISTS | C | 1.3419 | 1.8265 | -0.0081 | 1.000 | 27696 |
| ASSISTS | D | 1.3386 | 1.8217 | -0.0100 | 1.000 | 27696 |
| THREES | A | 0.8978 | 1.2791 | -0.0274 | 1.000 | 27696 |
| THREES | B | 0.8978 | 1.2791 | -0.0274 | 1.000 | 27696 |
| THREES | C | 0.8921 | 1.2490 | -0.0188 | 1.000 | 27696 |
| THREES | D | 0.8929 | 1.2484 | -0.0178 | 1.000 | 27696 |
| PRA (derived) | A | 6.1431 | 7.9731 | -0.3412 | 1.000 | 27696 |
| PRA (derived) | B | 6.1264 | 7.9547 | -0.3281 | 1.000 | 27696 |
| PRA (derived) | C | 6.0715 | 7.8244 | -0.1229 | 1.000 | 27696 |
| PRA (derived) | D | 6.0496 | 7.7912 | -0.0821 | 1.000 | 27696 |

Paired ΔMAE with game-date grouped bootstrap (negative = improvement). C−B, D−C, D−B.

| Target | C−B | C−B 95% CI | D−C | D−C 95% CI | D−B | D−B 95% CI | N |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POINTS | -0.0518 | -0.0716, -0.0329 | -0.0071 | -0.0140, -0.0001 | -0.0589 | -0.0782, -0.0417 | 27696 |
| REBOUNDS | -0.0153 | -0.0208, -0.0096 | -0.0022 | -0.0049, 0.0004 | -0.0175 | -0.0243, -0.0110 | 27696 |
| ASSISTS | -0.0056 | -0.0102, -0.0010 | -0.0033 | -0.0054, -0.0012 | -0.0090 | -0.0136, -0.0036 | 27696 |
| THREES | -0.0057 | -0.0095, -0.0016 | 0.0008 | -0.0002, 0.0020 | -0.0049 | -0.0091, -0.0007 | 27696 |
| PRA (derived) | -0.0549 | -0.0783, -0.0329 | -0.0219 | -0.0330, -0.0116 | -0.0768 | -0.1019, -0.0555 | 27696 |

## 2025 previously inspected confirmation

| Target | Model | MAE | RMSE | Bias | Coverage | N |
| --- | --- | --- | --- | --- | --- | --- |
| POINTS | A | 4.6176 | 6.0837 | -0.1187 | 1.000 | 28130 |
| POINTS | B | 4.6091 | 6.0744 | -0.1160 | 1.000 | 28130 |
| POINTS | C | 4.5549 | 5.9671 | -0.0146 | 1.000 | 28130 |
| POINTS | D | 4.5555 | 5.9456 | 0.0950 | 1.000 | 28130 |
| REBOUNDS | A | 1.9118 | 2.5378 | -0.0480 | 1.000 | 28130 |
| REBOUNDS | B | 1.9082 | 2.5337 | -0.0472 | 1.000 | 28130 |
| REBOUNDS | C | 1.8970 | 2.5020 | -0.0076 | 1.000 | 28130 |
| REBOUNDS | D | 1.8914 | 2.4985 | -0.0711 | 1.000 | 28130 |
| ASSISTS | A | 1.3493 | 1.8494 | -0.0315 | 1.000 | 28130 |
| ASSISTS | B | 1.3472 | 1.8474 | -0.0314 | 1.000 | 28130 |
| ASSISTS | C | 1.3436 | 1.8245 | 0.0082 | 1.000 | 28130 |
| ASSISTS | D | 1.3413 | 1.8210 | -0.0045 | 1.000 | 28130 |
| THREES | A | 0.8916 | 1.2592 | -0.0131 | 1.000 | 28130 |
| THREES | B | 0.8916 | 1.2592 | -0.0131 | 1.000 | 28130 |
| THREES | C | 0.8876 | 1.2296 | -0.0003 | 1.000 | 28130 |
| THREES | D | 0.8894 | 1.2313 | -0.0160 | 1.000 | 28130 |
| PRA (derived) | A | 6.0966 | 7.9055 | -0.1982 | 1.000 | 28130 |
| PRA (derived) | B | 6.0794 | 7.8863 | -0.1946 | 1.000 | 28130 |
| PRA (derived) | C | 6.0134 | 7.7562 | -0.0141 | 1.000 | 28130 |
| PRA (derived) | D | 5.9994 | 7.7196 | 0.0193 | 1.000 | 28130 |

Paired ΔMAE with game-date grouped bootstrap (negative = improvement). C−B, D−C, D−B.

| Target | C−B | C−B 95% CI | D−C | D−C 95% CI | D−B | D−B 95% CI | N |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POINTS | -0.0542 | -0.0752, -0.0336 | 0.0006 | -0.0061, 0.0085 | -0.0536 | -0.0741, -0.0334 | 28130 |
| REBOUNDS | -0.0113 | -0.0171, -0.0049 | -0.0056 | -0.0083, -0.0030 | -0.0169 | -0.0233, -0.0099 | 28130 |
| ASSISTS | -0.0036 | -0.0078, 0.0009 | -0.0023 | -0.0042, -0.0005 | -0.0059 | -0.0104, -0.0005 | 28130 |
| THREES | -0.0040 | -0.0080, -0.0006 | 0.0018 | 0.0009, 0.0027 | -0.0022 | -0.0061, 0.0011 | 28130 |
| PRA (derived) | -0.0660 | -0.0898, -0.0427 | -0.0140 | -0.0229, -0.0052 | -0.0800 | -0.1039, -0.0566 | 28130 |

## Pregame slices (2024 validation, PTS)

| Slice | N | B MAE | C MAE | D MAE | D−C | D−C 95% CI |
| --- | --- | --- | --- | --- | --- | --- |
| minutes stable | 19486 | 4.8841 | 4.8207 | 4.8124 | -0.0083 | -0.0165, -0.0003 |
| minutes moderate | 5776 | 4.2460 | 4.2167 | 4.2118 | -0.0049 | -0.0168, 0.0082 |
| minutes large | 2433 | 3.7981 | 3.7867 | 3.7845 | -0.0023 | -0.0211, 0.0180 |
| volume low | 6780 | 3.3251 | 3.3419 | 3.3425 | 0.0006 | -0.0098, 0.0116 |
| volume rotation | 12401 | 4.5720 | 4.5066 | 4.4967 | -0.0099 | -0.0189, 0.0006 |
| volume high | 8514 | 5.8370 | 5.7506 | 5.7415 | -0.0091 | -0.0225, 0.0045 |
| limited history (<5 prior played) | 2209 | 4.3884 | 4.1428 | 4.1376 | -0.0051 | -0.0226, 0.0173 |
| not limited history | 25487 | 4.6789 | 4.6439 | 4.6367 | -0.0072 | -0.0135, -0.0002 |

Slices use pregame information only (minutes-change, season-to-date minutes volume, prior played count). Realized target minutes are not used.

## Shadow nomination (from 2024 validation only)

A model may be nominated for 2026–27 prospective shadow if 2024 ΔMAE vs B is ≤ −0.01 with grouped 95% CI entirely below 0. D is nominated over C only when context also clears that bar versus C. 2025 confirmation cannot promote. PRA is ignored for nomination.

- POINTS: val C−B Δ=-0.0518 [-0.0716, -0.0329]; D−C Δ=-0.0071 [-0.0140, -0.0001]; nominee=C
- REBOUNDS: val C−B Δ=-0.0153 [-0.0208, -0.0096]; D−C Δ=-0.0022 [-0.0049, 0.0004]; nominee=C
- ASSISTS: val C−B Δ=-0.0056 [-0.0102, -0.0010]; D−C Δ=-0.0033 [-0.0054, -0.0012]; nominee=none
- THREES: val C−B Δ=-0.0057 [-0.0095, -0.0016]; D−C Δ=0.0008 [-0.0002, 0.0020]; nominee=none

Activation of collection and production serving are out of scope for this slice.

## Reproducibility

- Feature spec: `player-projection-learned-features-r1`
- Dataset SHA-256: `20d90fedd3b6e25047e81acf32d05aafbd470f1827e96916aaf38de0d556e5fa`
- Seed: `20260914`. Loss: RMSE. Early stopping: 40 rounds on 2024 only.
- CatBoost 1.2.8 / pandas 2.2.3 / numpy 2.2.6
- Selected configs (equal 6-config budget for C and D):
  - C points / C threes: depth 6, lr 0.08, l2 3, 500 iter (best 171 / 92)
  - D points, C/D rebounds, C/D assists: depth 6, lr 0.03, l2 3, 800 iter
  - D threes: depth 4, lr 0.08, l2 3, 500 iter
- A/B eligible N matches the frozen benchmark 27653 / 27696 / 28130. Common-eligible N is identical (zero A/B-only rows). The ET-date cutoff changed some C/D priors, not the row set.
