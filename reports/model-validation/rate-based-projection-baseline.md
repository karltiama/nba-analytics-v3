# Rate-based projection baseline

Run: 2026-09-14T01:05:03.651Z
Track A is the reference counting-stat baseline. R1–R3 use **Track-A expected minutes** × per-minute rates from prior **played** games.
Track B rate is not included (existing Track B logic is a counting-stat blend, not a clean per-minute rate).

Market Line rows in the per-prop tables are **overlap-only** (latest available pregame median). Do not compare that MAE to the 83,269-row basketball sample. Use the market-overlap sentence under each table.

Algebraic identity check: MAE of (season played-minutes × season rate) vs counting season avg = **1.440** (n=666152). Non-zero because counting averages include DNP 0-stat games.

## PTS

| Model                  | MAE   | N     |
| ---------------------- | ----- | ----- |
| Season Avg             | 4.982 | 83269 |
| L10                    | 4.943 | 83269 |
| Track A                | 4.865 | 83269 |
| Minutes × Season Rate  | 4.622 | 83269 |
| Minutes × L10 Rate     | 4.658 | 83269 |
| Minutes × Blended Rate | 4.626 | 83269 |
| Market Line            | 5.040 | 1498  |

Market-overlap (same rows with a latest-pregame line): Track A MAE 5.661 vs Minutes × Blended 5.430 vs Market 5.040 (n=1498).

## REB

| Model                  | MAE   | N     |
| ---------------------- | ----- | ----- |
| Season Avg             | 2.031 | 83269 |
| L10                    | 2.021 | 83269 |
| Track A                | 1.987 | 83269 |
| Minutes × Season Rate  | 1.911 | 83269 |
| Minutes × L10 Rate     | 1.935 | 83269 |
| Minutes × Blended Rate | 1.919 | 83269 |
| Market Line            | 2.067 | 1467  |

Market-overlap (same rows with a latest-pregame line): Track A MAE 2.252 vs Minutes × Blended 2.118 vs Market 2.067 (n=1467).

## AST

| Model                  | MAE   | N     |
| ---------------------- | ----- | ----- |
| Season Avg             | 1.395 | 83269 |
| L10                    | 1.392 | 83269 |
| Track A                | 1.372 | 83269 |
| Minutes × Season Rate  | 1.348 | 83269 |
| Minutes × L10 Rate     | 1.362 | 83269 |
| Minutes × Blended Rate | 1.350 | 83269 |
| Market Line            | 1.625 | 1367  |

Market-overlap (same rows with a latest-pregame line): Track A MAE 1.709 vs Minutes × Blended 1.675 vs Market 1.625 (n=1367).

## 3PM

| Model                  | MAE   | N     |
| ---------------------- | ----- | ----- |
| Season Avg             | 0.882 | 83269 |
| L10                    | 0.890 | 83269 |
| Track A                | 0.879 | 83269 |
| Minutes × Season Rate  | 0.882 | 83269 |
| Minutes × L10 Rate     | 0.894 | 83269 |
| Minutes × Blended Rate | 0.887 | 83269 |
| Market Line            | 1.149 | 1310  |

Market-overlap (same rows with a latest-pregame line): Track A MAE 1.115 vs Minutes × Blended 1.138 vs Market 1.149 (n=1310).

## PRA

| Model                  | MAE   | N     |
| ---------------------- | ----- | ----- |
| Season Avg             | 6.937 | 83269 |
| L10                    | 6.767 | 83269 |
| Track A                | 6.666 | 83269 |
| Minutes × Season Rate  | 6.117 | 83269 |
| Minutes × L10 Rate     | 6.142 | 83269 |
| Minutes × Blended Rate | 6.111 | 83269 |
| Market Line            | 6.300 | 1434  |

Market-overlap (same rows with a latest-pregame line): Track A MAE 7.369 vs Minutes × Blended 6.797 vs Market 6.300 (n=1434).

## PA

| Model                  | MAE   | N     |
| ---------------------- | ----- | ----- |
| Season Avg             | 5.651 | 83269 |
| L10                    | 5.555 | 83269 |
| Track A                | 5.470 | 83269 |
| Minutes × Season Rate  | 5.108 | 83269 |
| Minutes × L10 Rate     | 5.131 | 83269 |
| Minutes × Blended Rate | 5.103 | 83269 |
| Market Line            | 5.688 | 1119  |

Market-overlap (same rows with a latest-pregame line): Track A MAE 6.509 vs Minutes × Blended 6.054 vs Market 5.688 (n=1119).

## PR

| Model                  | MAE   | N     |
| ---------------------- | ----- | ----- |
| Season Avg             | 6.233 | 83269 |
| L10                    | 6.124 | 83269 |
| Track A                | 6.028 | 83269 |
| Minutes × Season Rate  | 5.601 | 83269 |
| Minutes × L10 Rate     | 5.641 | 83269 |
| Minutes × Blended Rate | 5.608 | 83269 |
| Market Line            | 6.009 | 1291  |

Market-overlap (same rows with a latest-pregame line): Track A MAE 6.829 vs Minutes × Blended 6.333 vs Market 6.009 (n=1291).

## RA

| Model                  | MAE   | N     |
| ---------------------- | ----- | ----- |
| Season Avg             | 2.898 | 83269 |
| L10                    | 2.851 | 83269 |
| Track A                | 2.804 | 83269 |
| Minutes × Season Rate  | 2.639 | 83269 |
| Minutes × L10 Rate     | 2.664 | 83269 |
| Minutes × Blended Rate | 2.645 | 83269 |
| Market Line            | 2.895 | 1095  |

Market-overlap (same rows with a latest-pregame line): Track A MAE 3.255 vs Minutes × Blended 2.997 vs Market 2.895 (n=1095).

## Error decomposition (PTS, Minutes × Blended Rate)

- N: 83269
- corr(|minutes error|, |PTS error|): 0.270
- corr(|rate error|, |PTS error|): 0.378
- corr(signed minutes error, signed PTS error): 0.537
- corr(signed rate error, signed PTS error): 0.680
- mean |minutes error|: 5.088
- mean |rate error| (points per minute): 0.199

PTS MAE by Track-A minutes miss bucket:

| Minutes bucket  | Track A MAE | Minutes × Blended MAE | N (Track A) |
| --------------- | ----------- | --------------------- | ----------- |
| actual_over_5+  | 6.770       | 5.851                 | 17922       |
| within_pm2      | 4.240       | 3.934                 | 22382       |
| actual_under_5+ | 4.290       | 5.032                 | 16126       |
| other           | 4.459       | 4.141                 | 26839       |

Counterfactuals (PTS overall):

- Actual minutes × blended rate MAE: 3.812
- Track-A minutes × actual rate MAE: 2.097

If perfect minutes drops MAE a lot while perfect rate does not, minutes is the missing variable. If the reverse, rate/usage mix is.

## Regular vs postseason (PTS)

| Phase      | Track A MAE | Track A bias | Minutes × Blended MAE | N     |
| ---------- | ----------- | ------------ | --------------------- | ----- |
| regular    | 4.885       | -1.743       | 4.621                 | 77495 |
| postseason | 4.594       | -0.492       | 4.689                 | 5774  |

## Low-sample (PTS)

| Prior played | Track A MAE | Minutes × Blended MAE | N     |
| ------------ | ----------- | --------------------- | ----- |
| 1-4          | 4.674       | 4.373                 | 6674  |
| 5-9          | 4.563       | 4.186                 | 7796  |
| 10-19        | 4.714       | 4.412                 | 14261 |
| 20+          | 4.971       | 4.776                 | 54538 |

## Recommendation

**MOVE TOWARD MINUTES × RATE**

Production projection behavior was not changed.
