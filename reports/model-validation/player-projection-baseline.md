# Player projection baseline evaluation

**Run:** 2026-09-14T00:36:25.186Z  
**Command:** `npm run evaluate:player-projections`  
**Machine-readable:** `reports/model-validation/player-projection-baseline.json`  
**Production:** unchanged (no formula, calibration, API, or UI edits)

Primary feature definition: **ACTIVE-SEASON-AS-OF-GAME** (serving-compatible).  
Career-as-of-game is research-only.

---

## 1. Executive Summary

Universe: **11,348** unique player-prop opportunities on **129 Final games**, **302 players**, **2026-04-03 → 2026-05-02** (2025–26 late season / playoffs only). No 2024–25 sportsbook history exists in `research.prop_decision_lines`.

| Question | Answer |
|---|---|
| Best current projection method | **Track A** (`0.7 * L10 + 0.3 * season`) is the simplest method that is at or near the best Court Context score on every prop. Track B is slightly better on most props, slightly worse on REB and 3PM. Differences are **0.004–0.072 MAE**. |
| Does Track B beat Track A? | **Barely, and not everywhere.** Overall MAE 4.640 vs 4.667. Worse on REB (+0.008) and 3PM (+0.004). It does not earn its complexity on this sample. |
| Does Court Context beat the sportsbook line as a raw predictor? | **No**, except **3PM**. Track B MAE is worse than the latest-pregame median line on PTS/REB/AST/PRA/PA/PR/RA. 3PM: CC 1.140 vs market 1.194 (delta −0.054). |
| Does projection gap show useful signal? | **Weak, and contaminated by bias.** Directional hit rate rises from 53.6% (gap 0–1) to 60.9% (gap 4+), but that is mostly **unders hitting** because CC under-projects. Not a betting edge. |

**Production recommendation: MORE VALIDATION NEEDED.** Do not change the live formula. Do not switch the baseline. Expand beyond this playoff window before any feature work.

---

## 2. Data Definition

Features are rebuilt from `analytics.player_game_logs` joined to `analytics.games` with `status = 'Final'`.

For each target game:

- Keep only logs with `start_time < target.start_time` (timestamp, not calendar date).
- **ACTIVE-SEASON-AS-OF-GAME:** same `season` as the target (production-like).
- **CAREER-AS-OF-GAME:** all prior NBA games.
- L5 / L10 = newest-first windows on that filtered set.
- Season average = mean of the full filtered set (not `player_season_averages`, which can include the target game).
- Track A = live `computeProjection` (`0.7 * L10 + 0.3 * season`).
- Track B = live `computeTrackB1PlayerPropProbability` (same L5 blend / stability / combo rules as serving).
- Missing windows stay **null**. Never filled with 0.

Market line:

- Source: `research.prop_decision_lines` (last snapshot per book with `decision_at < start_time`).
- Side: OVER.
- Aggregation: **median of latest pregame line per sportsbook**.
- Label: **latest available pregame line**, not closing.
- Median snapshot is **330 minutes** before tip (p10 = 60 min, min ≈ 14 min). `raw.player_prop_snapshots_v2` is empty (0 rows), so true closers cannot be proven.
- 8 books. Consensus when ≥3 books. Preferred-book order for odds: BetMGM, FanDuel, DraftKings.

Chronological split: unique tip times sorted ascending; first 70% development (n=8,593), last 30% holdout (n=2,755). Only season `2025` is present.

---

## 3. Baseline Results

Primary definition: active-season-as-of-game. Coverage = 100% on this universe (rotation players with lines in April/May; 11,312 / 11,348 have 20+ prior games).

### PTS (n=1,607)

| Model | MAE | RMSE | Bias | MedAE | N |
|---|---:|---:|---:|---:|---:|
| Season Avg | 6.509 | 8.454 | −1.715 | 5.299 | 1607 |
| L10 | 6.157 | 8.078 | −0.893 | 4.800 | 1607 |
| L5 | 6.233 | 8.149 | −0.734 | 4.800 | 1607 |
| Track A | 6.070 | 7.928 | −1.140 | 4.841 | 1607 |
| Track B | 6.034 | 7.897 | −0.988 | 4.700 | 1607 |
| Market Line | **5.750** | 7.631 | +0.977 | 4.500 | 1607 |

### REB (n=1,579)

| Model | MAE | RMSE | Bias | MedAE | N |
|---|---:|---:|---:|---:|---:|
| Season Avg | 2.457 | 3.258 | −0.699 | 1.976 | 1579 |
| L10 | 2.402 | 3.169 | −0.472 | 1.900 | 1579 |
| L5 | 2.476 | 3.234 | −0.405 | 2.000 | 1579 |
| Track A | **2.366** | 3.119 | −0.540 | 1.866 | 1579 |
| Track B | 2.373 | 3.119 | −0.492 | 1.869 | 1579 |
| Market Line | **2.277** | 2.961 | +0.253 | 1.500 | 1579 |

### AST (n=1,472)

| Model | MAE | RMSE | Bias | MedAE | N |
|---|---:|---:|---:|---:|---:|
| Season Avg | 1.832 | 2.543 | −0.381 | 1.355 | 1472 |
| L10 | 1.819 | 2.493 | −0.160 | 1.400 | 1472 |
| L5 | 1.817 | 2.485 | −0.152 | 1.400 | 1472 |
| Track A | 1.785 | 2.440 | −0.226 | 1.347 | 1472 |
| Track B | 1.779 | 2.429 | −0.202 | 1.347 | 1472 |
| Market Line | **1.760** | 2.309 | +0.227 | 1.500 | 1472 |

### 3PM (n=1,410)

| Model | MAE | RMSE | Bias | MedAE | N |
|---|---:|---:|---:|---:|---:|
| Season Avg | 1.158 | 1.518 | −0.163 | 0.923 | 1410 |
| L10 | 1.155 | 1.507 | −0.051 | 0.900 | 1410 |
| L5 | 1.192 | 1.557 | −0.033 | 1.000 | 1410 |
| Track A | **1.136** | 1.476 | −0.084 | 0.930 | 1410 |
| Track B | 1.140 | 1.480 | −0.067 | 0.933 | 1410 |
| Market Line | 1.194 | 1.493 | +0.098 | 0.500 | 1410 |

### PRA (n=1,526)

| Model | MAE | RMSE | Bias | MedAE | N |
|---|---:|---:|---:|---:|---:|
| Season Avg | 8.743 | 11.425 | −2.305 | 6.859 | 1526 |
| L10 | 8.182 | 10.871 | −1.266 | 6.300 | 1526 |
| L5 | 8.253 | 10.908 | −1.148 | 6.400 | 1526 |
| Track A | 8.065 | 10.610 | −1.577 | 6.241 | 1526 |
| Track B | 7.993 | 10.545 | −1.455 | 6.225 | 1526 |
| Market Line | **7.391** | 10.071 | +1.679 | 5.500 | 1526 |

### PA (n=1,202)

| Model | MAE | RMSE | Bias | MedAE | N |
|---|---:|---:|---:|---:|---:|
| Season Avg | 7.723 | 10.052 | −2.254 | 6.037 | 1202 |
| L10 | 7.239 | 9.627 | −1.180 | 5.500 | 1202 |
| L5 | 7.336 | 9.674 | −1.053 | 5.600 | 1202 |
| Track A | 7.127 | 9.392 | −1.502 | 5.710 | 1202 |
| Track B | 7.068 | 9.341 | −1.380 | 5.526 | 1202 |
| Market Line | **6.683** | 9.032 | +1.519 | 5.000 | 1202 |

### PR (n=1,376)

| Model | MAE | RMSE | Bias | MedAE | N |
|---|---:|---:|---:|---:|---:|
| Season Avg | 8.034 | 10.396 | −2.376 | 6.373 | 1376 |
| L10 | 7.526 | 9.927 | −1.409 | 5.700 | 1376 |
| L5 | 7.697 | 10.053 | −1.193 | 5.800 | 1376 |
| Track A | 7.426 | 9.706 | −1.699 | 5.766 | 1376 |
| Track B | 7.386 | 9.673 | −1.561 | 5.657 | 1376 |
| Market Line | **6.965** | 9.288 | +1.401 | 5.500 | 1376 |

### RA (n=1,176)

| Model | MAE | RMSE | Bias | MedAE | N |
|---|---:|---:|---:|---:|---:|
| Season Avg | 3.734 | 4.898 | −1.072 | 3.025 | 1176 |
| L10 | 3.583 | 4.700 | −0.618 | 2.800 | 1176 |
| L5 | 3.632 | 4.752 | −0.579 | 3.000 | 1176 |
| Track A | 3.523 | 4.606 | −0.754 | 2.745 | 1176 |
| Track B | 3.511 | 4.587 | −0.708 | 2.766 | 1176 |
| Market Line | **3.327** | 4.379 | +0.682 | 2.500 | 1176 |

L10 beats L5 on PTS/REB/3PM/PRA/PA/PR/RA. Season average is last on every prop. Track A beats raw L10 on every prop.

---

## 4. Track A vs Track B

`Δ = Track B MAE − Track A MAE`. Negative = Track B better.

| Prop | Track A MAE | Track B MAE | Δ |
|---|---:|---:|---:|
| PTS | 6.070 | 6.034 | −0.036 |
| REB | 2.366 | 2.373 | **+0.008** |
| AST | 1.785 | 1.779 | −0.005 |
| 3PM | 1.136 | 1.140 | **+0.004** |
| PRA | 8.065 | 7.993 | −0.072 |
| PA | 7.127 | 7.068 | −0.060 |
| PR | 7.426 | 7.386 | −0.040 |
| RA | 3.523 | 3.511 | −0.013 |

Track B does not earn its complexity. If a single Court Context point estimate is required, **Track A is the honest default**.

---

## 5. Court Context vs Market

`delta = Track B MAE − Market MAE`. Negative = Court Context better. Market = latest available pregame median, **not** a proven closer.

| Prop | Track B MAE | Market MAE | Delta |
|---|---:|---:|---:|
| PTS | 6.034 | 5.750 | +0.284 |
| REB | 2.373 | 2.277 | +0.096 |
| AST | 1.779 | 1.760 | +0.019 |
| 3PM | 1.140 | 1.194 | **−0.054** |
| PRA | 7.993 | 7.391 | +0.602 |
| PA | 7.068 | 6.683 | +0.384 |
| PR | 7.386 | 6.965 | +0.421 |
| RA | 3.511 | 3.327 | +0.184 |

CC bias is negative (under-projects). Market bias is positive (over-projects). The market is the better raw point estimate on 7 of 8 props.

---

## 6. Projection Gap Analysis

Gap = Track B projection − market line. Bucketed by |gap|.

| |gap| | N | CC MAE | Market MAE | Over hit | Under hit | Actual − line | Dir. hit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0–1 | 5009 | 2.890 | 2.903 | 48.8% | 56.9% | −0.08 | 53.6% |
| 1–2 | 2249 | 4.211 | 4.218 | 52.0% | 61.1% | −0.50 | 58.4% |
| 2–3 | 1253 | 5.452 | 5.207 | 45.2% | 55.9% | −0.84 | 53.4% |
| 3–4 | 797 | 6.035 | 5.768 | 46.4% | 59.5% | −1.45 | 57.0% |
| 4+ | 2040 | 8.368 | 7.239 | 46.5% | 61.8% | −2.85 | 60.9% |

Larger gaps have a higher directional hit rate, but that is **under-driven** (model too low). Market MAE is better than CC once |gap| ≥ 2. This is exploratory validation, not a betting edge.

Overall directional hit rate: **56.1%** (n=11,259; 89 pushes). Over hit 48.9%, under hit 59.0%.

---

## 7. Confidence Tier Validation

| Tier | N | Track B MAE | RMSE | Dir. hit | Coverage |
|---|---:|---:|---:|---:|---:|
| HIGH | 320 | 4.850 | 7.331 | 55.6% | 100% |
| MEDIUM | 2303 | **2.976** | 4.540 | 54.8% | 100% |
| LOW | 8725 | 5.072 | 7.500 | **56.5%** | 100% |

**HIGH does not outperform MEDIUM or LOW.** Combos are forced LOW, so mixed-prop MAE is confounded by stat scale (LOW includes PRA/PA/PR). Directional hit is also not ordered HIGH > MEDIUM > LOW. Flag: current tiers are not a validated quality ranking.

---

## 8. Probability Calibration

Track B OVER probability vs actual over (pushes excluded). Calibration artifacts **not regenerated** (`v1-fit-2026-03-25`).

| Stage | Brier | ECE | N |
|---|---:|---:|---:|
| Raw CDF | 0.2548 | 0.0767 | 11259 |
| Calibrated | 0.2489 | 0.0519 | 11259 |
| Anchored | **0.2454** | **0.0471** | 11259 |

CDF → calibration → anchoring each improves Brier and ECE on this window. Anchoring still uses the market, so better calibration here is not evidence that the projection mean beats the line.

---

## 9. Train/Serve Comparison

`diff = career MAE/Brier/ECE − active-season` for Track B. Negative = career better.

| Prop | MAE diff | Brier diff | ECE diff |
|---|---:|---:|---:|
| PTS | −0.017 | −0.0009 | −0.0009 |
| REB | −0.002 | −0.0009 | −0.0006 |
| AST | −0.007 | −0.0003 | −0.0032 |
| 3PM | −0.007 | −0.0012 | −0.0072 |
| PRA | −0.049 | −0.0007 | +0.0015 |
| PA | −0.019 | −0.0006 | −0.0084 |
| PR | −0.038 | −0.0009 | +0.0068 |
| RA | −0.013 | −0.0008 | +0.0047 |

Career-as-of is slightly better on MAE for every prop. The gap is small on this late-season sample (almost everyone already has a full 2025 season). **Do not regenerate production calibration from this.** The mismatch is real and should be re-measured on early-season / low-sample games, where it will matter more.

---

## 10. Leakage Audit

| Check | Result |
|---|---|
| Target game in L5/L10/season | **0** |
| Later games in features | **0** |
| Sportsbook lines after tipoff | **0** in scored rows; **0** in `prop_decision_lines` |
| `player_season_averages` used | **No** — recomputed from logs |
| Current injury tables used | **No** |
| Duplicate game logs | **0** skipped |
| Time comparison | `start_time` timestamps, not `game_date < start_time::date` |
| Non-Final games | Excluded (`status = 'Final'` only) |
| Missing start_time | **0** |
| Postponed / rescheduled | Canonical `analytics.games.start_time`; non-Final omitted |
| Timezone / same-day doubleheader | Strict `< tip`; same-calendar-day later tip excluded |

Known limitation of **older** fit/eval SQL (`game_date < start_time::date` plus career logs): that path was **not** used here. Production still serves active-season L10 from current tables; this eval reconstructs as-of from logs.

Game `status` in `analytics.games` is dirty for 2026–27 (ISO timestamps stored as status). Those rows are not Final and were not scored.

---

## 11. Weakest Areas

1. **Combo props vs market** — PRA/PA/PR deltas +0.38 to +0.60 MAE. Largest miss vs the line.
2. **Systematic under-projection** — Track B bias −0.85 overall, −0.99 PTS, −1.46 PRA. Playoff minutes/role not in the mean.
3. **PTS MAE** — 6.03 vs market 5.75. Absolute error is large.
4. **Confidence tiers** — HIGH is not better than LOW.
5. **Low-sample behavior is unmeasured** — 4 rows in 1–4, 12 in 5–9, 20 in 10–19. This universe cannot answer rookie / early-season questions.
6. **No regular-season market history** — conclusions are playoff-conditioned.

---

## 12. Recommended Modeling Priorities

Do **not** implement yet. Ranked by this evidence:

1. **Expected minutes / role in the current game** — CC under-projects; market over-projects; combo miss is minutes error compounded. Highest-leverage missing input on this window.
2. **Re-evaluate on regular season + early-season sample** — current results cannot speak to rookies, role changes, or the train/serve mismatch when season N is small.
3. **Combo mean structure** — PRA/PA/PR lose the most to the market. Treat as minutes × rate, not a third blended series, only after minutes is in the mean.
4. **Bias / minutes shrinkage toward the market as a diagnostic**, not as a product claim — anchoring already helps probability; the *mean* still loses.
5. **Opponent / 3PT environment** — only 3PM already beats the line; opponent 3s is a secondary test, not the first.
6. **Teammate availability / injury / WOWY** — not supported yet (injury as-of is not certified). Do not add.
7. **Home/away, rest, pace** — plausible but not identified by this playoff sample. Test after a regular-season window exists.

Do not add features because they sound like basketball. The observed failure is **the mean is too low, especially on counting stats and combos**, in a high-sample playoff population the market already prices.

---

## 13. Production Recommendation

**MORE VALIDATION NEEDED**

- Keep the live Track B.1 formula for now. Do not swap to L5, season average, or a new feature stack.
- Treat **Track A as the reference baseline** any future model must beat, per prop, on a holdout that includes regular season.
- Do not sell projection gap as an edge.
- Do not regenerate calibration artifacts until as-of active-season features are used in the fitter on a broader window.

Stop here. No live formula change until this is reviewed.
