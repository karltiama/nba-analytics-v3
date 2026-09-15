# Player projection v1 — usage / rate change

Run: 2026-09-15T00:04:37.757Z
Version: `player-projection-v1-usage-rate-r1`. Research only. Production unchanged.

Minutes candidate is **frozen**: EWM α=0.25, clip 0.85–1.15, applied only when `|L5min−L10min|/L10min ≥ 0.25`, never on 3PM. Not retuned here.

Split: train 2023 n=27653 → val 2024 n=27696 → test 2025 n=28130. Scored 83479. Leakage 0.

## Benchmarks

- **A.** Played-only Track A (`0.70 L10 played + 0.30 season played`)
- **B.** Track A + conditional EWM minutes adjustment (frozen)

Primary delta = usage candidate − Benchmark B. Negative is improvement.

## Usage / rate feature coverage

- PGL FGA/FTA/3PA/ORB/DRB/TO: 0 nulls on Final 2023–25 ({"n":138296,"tpa_null":0,"orb_null":0,"drb_null":0,"to_null":0}).
- `usage_percentage` / possessions on `player_game_advanced` 2023–25 complete aside from 30 missing 2025 rows.
- Usage present on 100.0% of played logs in this extract.
- Team FGA exists on `analytics.team_game_stats` (as-of prior games only). Not used as a candidate this pass.
- Shot volume = FGA + **0.44** × FTA (Oliver, documented, not tuned).

## Leakage audit

Target-game FGA, FTA, usage, minutes, and starter are outcomes. All rolling windows use `start_time < tipoff`. Closing lines and public betting are not inputs.

## Candidate definitions

- Concept A: `BenchmarkB * clip(L5/L10, 0.90–1.10 or 0.85–1.15)` for usage or FGA, either always or only when relative L5/L10 change ≥ 0.15 or 0.25.
- Shot-volume conditional scale. 3PM also tests 3PA L5/L10.
- Concept B: if usage change is large, replace Track A weights with 0.85/0.15 or 0.90/0.10, then apply frozen minutes gate.

## Flag prevalence (scored targets)

| Season | N | Minutes large ≥0.25 | Usage ≥0.15 | Usage ≥0.25 | FGA ≥0.25 | FTA ≥0.25 |
| --- | --- | --- | --- | --- | --- | --- |
| 2023 | 27653 | 2436 (8.8%) | 4659 (16.8%) | 1579 (5.7%) | 2792 (10.1%) | 6755 (24.4%) |
| 2024 | 27696 | 2433 (8.8%) | 4671 (16.9%) | 1531 (5.5%) | 2691 (9.7%) | 6925 (25.0%) |
| 2025 | 28130 | 2379 (8.5%) | 4897 (17.4%) | 1571 (5.6%) | 2812 (10.0%) | 7078 (25.2%) |

## Chronological test (2025–26) — val-selected usage candidate vs minutes candidate

| Prop | Val-selected | Track A MAE | Minutes MAE | Usage MAE | Δ vs Minutes | 95% CI | N |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PTS | fga_l5_l10_cond_025__clip_085_115 | 4.618 | 4.609 | 4.606 | -0.0028 | [-0.007, 0.001] | 28130 |
| REB | track_a_conditional_ewm_minutes | 1.912 | 1.908 | 1.908 | 0.0000 | [0.000, 0.000] | 28130 |
| AST | fga_l5_l10_cond_025__clip_085_115 | 1.349 | 1.347 | 1.347 | -0.0006 | [-0.002, 0.001] | 28130 |
| 3PM | blend_w90_usg_cond_025 | 0.892 | 0.892 | 0.892 | 0.0000 | [-0.000, 0.000] | 28130 |
| PRA | fga_l5_l10_cond_025__clip_085_115 | 6.097 | 6.079 | 6.073 | -0.0061 | [-0.013, 0.001] | 28130 |
| PA | fga_l5_l10_cond_025__clip_085_115 | 5.099 | 5.086 | 5.083 | -0.0034 | [-0.009, 0.002] | 28130 |
| PR | fga_l5_l10_cond_025__clip_085_115 | 5.587 | 5.573 | 5.567 | -0.0052 | [-0.012, 0.001] | 28130 |
| RA | fga_l5_l10_cond_025__clip_085_115 | 2.635 | 2.629 | 2.628 | -0.0009 | [-0.004, 0.002] | 28130 |

| Prop | Track A RMSE/bias/medAE | Minutes RMSE/bias/medAE | Usage RMSE/bias/medAE |
| --- | --- | --- | --- |
| PTS | 6.084 / -0.119 / 3.611 | 6.074 / -0.116 / 3.601 | 6.071 / -0.102 / 3.592 |
| REB | 2.538 / -0.048 / 1.497 | 2.534 / -0.047 / 1.490 | 2.534 / -0.047 / 1.490 |
| AST | 1.849 / -0.032 / 1.000 | 1.847 / -0.031 / 1.000 | 1.847 / -0.029 / 1.000 |
| 3PM | 1.259 / -0.013 / 0.667 | 1.259 / -0.013 / 0.667 | 1.259 / -0.013 / 0.667 |
| PRA | 7.905 / -0.198 / 4.952 | 7.886 / -0.195 / 4.936 | 7.880 / -0.173 / 4.925 |
| PA | 6.681 / -0.150 / 4.000 | 6.668 / -0.147 / 4.000 | 6.662 / -0.131 / 4.000 |
| PR | 7.266 / -0.167 / 4.500 | 7.251 / -0.163 / 4.490 | 7.247 / -0.144 / 4.481 |
| RA | 3.456 / -0.080 / 2.080 | 3.449 / -0.079 / 2.073 | 3.448 / -0.071 / 2.068 |

Val-selected per prop: PTS=fga_l5_l10_cond_025__clip_085_115; REB=track_a_conditional_ewm_minutes; AST=fga_l5_l10_cond_025__clip_085_115; 3PM=blend_w90_usg_cond_025; PRA=fga_l5_l10_cond_025__clip_085_115; PA=fga_l5_l10_cond_025__clip_085_115; PR=fga_l5_l10_cond_025__clip_085_115; RA=fga_l5_l10_cond_025__clip_085_115.

## Usage-change segments (test, val-selected FGA candidate vs Benchmark B)

Usage magnitude: stable `|L5−L10|/L10 < 0.15`; moderate `[0.15, 0.25)`; large `≥ 0.25`. Direction uses the same 0.25 tau. Usage `%` scaling (not shown) **hurt** PTS/PRA on usage *increase* and is not the val-selected rule.

Val-selected for PTS/PRA/AST/PA/PR/RA: `fga_l5_l10_cond_025__clip_085_115`. REB kept Benchmark B. 3PM kept a blend that is numerically identical to Benchmark B on test.

| Prop | Slice | Bucket | N | Cand MAE | B MAE | Δ | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PTS | usgMag | stable | 22528 | 4.840 | 4.840 | -0.0010 | [-0.005, 0.002] |
| PTS | usgMag | moderate | 3326 | 3.949 | 3.961 | -0.0120 | [-0.033, 0.006] |
| PTS | usgMag | large | 1571 | 3.566 | 3.575 | -0.0084 | [-0.033, 0.016] |
| PTS | usgDir | decrease | 750 | 3.446 | 3.457 | -0.0115 | [-0.047, 0.030] |
| PTS | usgDir | increase | 821 | 3.676 | 3.682 | -0.0055 | [-0.040, 0.029] |
| PRA | usgMag | stable | 22528 | 6.275 | 6.277 | -0.0016 | [-0.008, 0.004] |
| PRA | usgMag | moderate | 3326 | 5.507 | 5.531 | -0.0237 | [-0.059, 0.006] |
| PRA | usgMag | large | 1571 | 5.176 | 5.212 | -0.0352 | [-0.080, 0.011] |
| PRA | usgDir | decrease | 750 | 4.927 | 4.959 | -0.0318 | [-0.086, 0.041] |
| PRA | usgDir | increase | 821 | 5.404 | 5.442 | -0.0383 | [-0.096, 0.022] |
| REB | usgMag | large | 1571 | 1.678 | 1.674 | 0.0033 | [-0.010, 0.018] |
| AST | usgDir | decrease | 750 | 0.908 | 0.921 | -0.0132 | [-0.021, -0.004] |
| AST | usgDir | increase | 821 | 0.992 | 0.985 | 0.0069 | [-0.000, 0.016] |

AST usage-decrease is the only CI-backed slice for the FGA rule. It is small, directional, and offset by a usage-increase worsening. Not enough for prop-specific promotion.

## Minutes × usage interaction (test, same FGA candidate)

Minutes large = `|L5min−L10min|/L10 ≥ 0.25`. Usage large = `|L5usg−L10usg|/L10 ≥ 0.25`. Pregame only.

**Especially: stable minutes + changing usage** — the slice that would prove usage is distinct from minutes.

| Prop | Quad | N | Cand MAE | B MAE | Δ | 95% CI |
| --- | --- | --- | --- | --- | --- | --- |
| PTS | stable min + stable usg | 24088 | 4.804 | 4.806 | -0.0020 | [-0.006, 0.002] |
| PTS | **stable min + changing usg** | **1057** | **3.650** | **3.657** | **-0.0074** | **[-0.039, 0.030]** |
| PTS | changing min + stable usg | 1766 | 3.648 | 3.655 | -0.0074 | [-0.043, 0.024] |
| PTS | changing min + changing usg | 514 | 3.395 | 3.405 | -0.0104 | [-0.051, 0.033] |
| PRA | stable min + stable usg | 24088 | 6.238 | 6.243 | -0.0050 | [-0.012, 0.002] |
| PRA | **stable min + changing usg** | **1057** | **5.265** | **5.309** | **-0.0434** | **[-0.095, 0.018]** |
| PRA | changing min + stable usg | 1766 | 5.330 | 5.327 | 0.0028 | [-0.051, 0.058] |
| PRA | changing min + changing usg | 514 | 4.993 | 5.011 | -0.0183 | [-0.087, 0.052] |
| REB | stable min + changing usg | 1057 | 1.724 | 1.728 | -0.0035 | [-0.020, 0.017] |
| AST | stable min + changing usg | 1057 | 1.005 | 1.010 | -0.0046 | [-0.012, 0.004] |

PRA’s point estimate on stable-min / changing-usg is the largest (−0.043) but the CI crosses 0. Usage-percentage scaling on that same slice *hurt* PTS (+0.020) and PRA (+0.035).

Minutes-volume buckets (season played minutes: low <15, rotation 15–28, high ≥28) for PTS FGA candidate: low n=6604 Δ−0.0030; rotation n=13197 Δ−0.0022; high n=8324 Δ−0.0036. All CIs cross 0.

Full segment matrix (all candidates, including usage-% always-on which hurts stable players) is in `player-projection-v1-usage-rate-results.json`.

## Market subset (2023–24 core two-way)

Subset only. Not used to select candidates.

| Prop | Eligible | With market | Coverage % | Track A | Minutes | Usage cand | Market |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PTS | 27653 | 3999 | 14.461 | 5.190 | 5.181 | 5.170 | 4.829 |
| REB | 27653 | 4028 | 14.566 | 2.098 | 2.097 | 2.097 | 2.013 |
| AST | 27653 | 3950 | 14.284 | 1.538 | 1.539 | 1.539 | 1.498 |
| 3PM | 27653 | 3637 | 13.152 | 1.103 | 1.103 | 1.103 | 1.099 |

## Decision

**KEEP MINUTES CANDIDATE ONLY**

Pregame usage/FGA/shot-volume adjustments did not improve 2025–26 test MAE beyond the frozen conditional minutes candidate. No prop cleared ΔMAE ≤ −0.01 with a CI entirely below 0 vs Benchmark B. The independent slice (stable minutes + changing usage) also failed that bar.

## Next recommended experiment

**Opponent context.** Do not implement in this pass.

Minutes captured playing-time volume. Usage/rate did not add a distinct pregame role signal. Opponent defense (as-of `analytics.team_game_stats` prior games: rating / points allowed / opponent 3PA rate) is historically valid, independent of own minutes and usage, and can differ by prop. Pace and rest/home-away remain later. Teammate availability stays blocked until a pregame injury tape exists.
