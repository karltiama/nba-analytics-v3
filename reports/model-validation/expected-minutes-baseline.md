# Expected minutes baseline

Run: 2026-09-14T01:05:03.651Z
Feature definition: **active_season** (as-of before tipoff).
Seasons: 2023, 2024, 2025
Date range: 2023-10-27T02:00:00.000Z → 2026-06-14T00:30:00.000Z
Scored player-games (minutes > 0, ≥1 prior played game): **83269** across **793** players.

## Target and features

- Target: actual minutes played (`minutes > 0`). DNP/`00` logs are not scored as targets.
- Expected minutes windows use **prior played games only** (skip DNP).
- Track-A minutes = `0.7 * L10 played minutes + 0.3 * season played minutes`.
- Starter vs bench is an observed split from `analytics.game_starters` (season 2025 coverage). It is **not** a model feature.
- No sportsbook line is used as an input.

## Overall

| Model                                  | MAE   | RMSE  | Bias   | MedAE | Cover  | N     |
| -------------------------------------- | ----- | ----- | ------ | ----- | ------ | ----- |
| Season minutes avg                     | 5.387 | 7.052 | -0.594 | 4.250 | 100.0% | 83269 |
| L10 minutes avg                        | 5.079 | 6.681 | -0.270 | 4.000 | 100.0% | 83269 |
| L5 minutes avg                         | 5.039 | 6.652 | -0.175 | 4.000 | 100.0% | 83269 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.088 | 6.673 | -0.367 | 4.000 | 100.0% | 83269 |

Best simple minutes method by MAE: **L5 minutes avg**.

### By season

#### Season 2023

| Model                                  | MAE   | Bias   | N     |
| -------------------------------------- | ----- | ------ | ----- |
| Season minutes avg                     | 5.446 | -0.636 | 27596 |
| L10 minutes avg                        | 5.068 | -0.288 | 27596 |
| L5 minutes avg                         | 5.032 | -0.190 | 27596 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.092 | -0.393 | 27596 |

#### Season 2024

| Model                                  | MAE   | Bias   | N     |
| -------------------------------------- | ----- | ------ | ----- |
| Season minutes avg                     | 5.336 | -0.728 | 27585 |
| L10 minutes avg                        | 5.083 | -0.335 | 27585 |
| L5 minutes avg                         | 5.046 | -0.213 | 27585 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.083 | -0.453 | 27585 |

#### Season 2025

| Model                                  | MAE   | Bias   | N     |
| -------------------------------------- | ----- | ------ | ----- |
| Season minutes avg                     | 5.380 | -0.421 | 28088 |
| L10 minutes avg                        | 5.088 | -0.187 | 28088 |
| L5 minutes avg                         | 5.039 | -0.123 | 28088 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.089 | -0.257 | 28088 |

### By prior played-game sample

#### 1-4 prior played games

| Model                                  | MAE   | Bias   | N    |
| -------------------------------------- | ----- | ------ | ---- |
| Season minutes avg                     | 4.916 | -0.971 | 6674 |
| L10 minutes avg                        | 4.916 | -0.971 | 6674 |
| L5 minutes avg                         | 4.916 | -0.971 | 6674 |
| Track-A minutes (0.7 L10 + 0.3 season) | 4.916 | -0.971 | 6674 |

#### 5-9 prior played games

| Model                                  | MAE   | Bias   | N    |
| -------------------------------------- | ----- | ------ | ---- |
| Season minutes avg                     | 5.011 | -0.972 | 7796 |
| L10 minutes avg                        | 5.011 | -0.972 | 7796 |
| L5 minutes avg                         | 4.964 | -0.637 | 7796 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.011 | -0.972 | 7796 |

#### 10-19 prior played games

| Model                                  | MAE   | Bias   | N     |
| -------------------------------------- | ----- | ------ | ----- |
| Season minutes avg                     | 5.246 | -0.899 | 14261 |
| L10 minutes avg                        | 5.151 | -0.497 | 14261 |
| L5 minutes avg                         | 5.080 | -0.204 | 14261 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.151 | -0.618 | 14261 |

#### 20+ prior played games

| Model                                  | MAE   | Bias   | N     |
| -------------------------------------- | ----- | ------ | ----- |
| Season minutes avg                     | 5.536 | -0.414 | 54538 |
| L10 minutes avg                        | 5.090 | -0.024 | 54538 |
| L5 minutes avg                         | 5.054 | -0.004 | 54538 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.104 | -0.141 | 54538 |

### Regular season vs postseason

Postseason includes play-in from the first play-in ET date (2023: 2024-04-16, 2024: 2025-04-15, 2025: 2026-04-14).

#### regular

| Model                                  | MAE   | Bias   | N     |
| -------------------------------------- | ----- | ------ | ----- |
| Season minutes avg                     | 5.318 | -0.730 | 77495 |
| L10 minutes avg                        | 5.047 | -0.349 | 77495 |
| L5 minutes avg                         | 5.014 | -0.235 | 77495 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.049 | -0.463 | 77495 |

#### postseason

| Model                                  | MAE   | Bias  | N    |
| -------------------------------------- | ----- | ----- | ---- |
| Season minutes avg                     | 6.318 | 1.239 | 5774 |
| L10 minutes avg                        | 5.516 | 0.794 | 5774 |
| L5 minutes avg                         | 5.367 | 0.629 | 5774 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.617 | 0.927 | 5774 |

### Starter vs bench (observed this-game role, not a feature)

#### starter

| Model                                  | MAE   | Bias   | N     |
| -------------------------------------- | ----- | ------ | ----- |
| Season minutes avg                     | 5.162 | -1.690 | 13027 |
| L10 minutes avg                        | 4.864 | -1.132 | 13027 |
| L5 minutes avg                         | 4.826 | -0.883 | 13027 |
| Track-A minutes (0.7 L10 + 0.3 season) | 4.879 | -1.300 | 13027 |

#### bench

| Model                                  | MAE   | Bias  | N     |
| -------------------------------------- | ----- | ----- | ----- |
| Season minutes avg                     | 5.563 | 0.690 | 15019 |
| L10 minutes avg                        | 5.274 | 0.643 | 15019 |
| L5 minutes avg                         | 5.217 | 0.546 | 15019 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.265 | 0.657 | 15019 |

#### unknown

| Model                                  | MAE   | Bias   | N     |
| -------------------------------------- | ----- | ------ | ----- |
| Season minutes avg                     | 5.393 | -0.684 | 55223 |
| L10 minutes avg                        | 5.077 | -0.314 | 55223 |
| L5 minutes avg                         | 5.041 | -0.204 | 55223 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.090 | -0.425 | 55223 |

### Team-change diagnostics (no special handling)

#### no_team_change

| Model                                  | MAE   | Bias   | N     |
| -------------------------------------- | ----- | ------ | ----- |
| Season minutes avg                     | 5.274 | -0.559 | 78060 |
| L10 minutes avg                        | 5.024 | -0.243 | 78060 |
| L5 minutes avg                         | 4.997 | -0.157 | 78060 |
| Track-A minutes (0.7 L10 + 0.3 season) | 5.022 | -0.338 | 78060 |

#### after_team_change

| Model                                  | MAE   | Bias   | N    |
| -------------------------------------- | ----- | ------ | ---- |
| Season minutes avg                     | 7.094 | -1.119 | 5209 |
| L10 minutes avg                        | 5.901 | -0.670 | 5209 |
| L5 minutes avg                         | 5.669 | -0.446 | 5209 |
| Track-A minutes (0.7 L10 + 0.3 season) | 6.073 | -0.804 | 5209 |

#### first5_new_team

| Model                                  | MAE   | Bias   | N   |
| -------------------------------------- | ----- | ------ | --- |
| Season minutes avg                     | 6.766 | -0.773 | 706 |
| L10 minutes avg                        | 6.687 | -1.173 | 706 |
| L5 minutes avg                         | 6.476 | -1.286 | 706 |
| Track-A minutes (0.7 L10 + 0.3 season) | 6.654 | -1.053 | 706 |

#### first10_new_team

| Model                                  | MAE   | Bias   | N    |
| -------------------------------------- | ----- | ------ | ---- |
| Season minutes avg                     | 6.761 | -0.951 | 1462 |
| L10 minutes avg                        | 6.331 | -1.208 | 1462 |
| L5 minutes avg                         | 5.922 | -0.955 | 1462 |
| Track-A minutes (0.7 L10 + 0.3 season) | 6.385 | -1.131 | 1462 |
