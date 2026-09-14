# Played-game baseline vs minutes × rate

Run: 2026-09-14T01:26:16.141Z  
Feature definition: **active_season** as-of tipoff.  
Seasons 2023–2025. Range 2023-10-27 → 2026-06-14.  
Scored: **83,276** player-games with minutes > 0 and ≥1 prior played game (793 players).  
Production Track A / Track B.1 was **not** changed. Sportsbook lines are evaluation-only.

## Played-game definition

`analytics.player_game_logs` has no DNP-CD / inactive / DND column. `public.bbref_player_game_stats.dnp_reason` is unused (all null). Minutes are integer-like text; no MM:SS; no nulls.

| Token / case | n (Final 2023–25) | Class |
| --- | ---: | --- |
| minutes `"00"` | 53,094 | **DNP** (roster row; ~zero box; 2 anomalous FGA rows still DNP) |
| minutes `"0"` | 210 | **Played** (sub-minute appearance; 18 have box activity) |
| minutes > 0 | 84,992 | **Played** (includes 10,112 zero-point games) |
| malformed | 0 | — |

Canonical research predicate (`isPlayedGame`):

- played if parsed minutes > 0, **or** minutes token is `"0"` / `"0.0"`
- `"00"` is always DNP
- 0-point games with minutes > 0 stay in the average

Target universe for scoring remains minutes > 0 (same as the prior minutes experiment).

## DNP contamination

- **53,094 / 138,296 Final logs = 38.4%** were DNP `"00"` and were inside production counting averages as 0-stat games.
- In as-of season windows actually used at tipoff, mean DNP share is **24.8%**.
- Current L10 log window contains **1.84 DNP rows on average**.
- Mean |Current Track A − Played-only Track A| shift: PTS 1.48, PRA 2.44, PR 2.09, PA 1.83, RA 0.95, REB 0.60, AST 0.35, 3PM 0.17.

Combos and PTS move most because a DNP zero is a large counting miss relative to typical production.

## Improvement decomposition (most important)

n=83,276 except minutes×rate n=83,269.

| Prop | Current Track A | Played-only Track A | DNP cleanup A−B | Best min×rate | That MAE | Structural B−C |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| PTS | 4.865 | 4.625 | **0.239** | Track-A min × Season Rate | 4.622 | **0.004** |
| REB | 1.987 | 1.919 | 0.069 | Track-A min × Season Rate | 1.911 | 0.008 |
| AST | 1.372 | 1.350 | 0.022 | L5 min × Season Rate | 1.345 | 0.005 |
| 3PM | **0.879** | 0.887 | **−0.008** | Track-A min × Season Rate | 0.882 | 0.004 |
| PRA | 6.666 | 6.111 | **0.555** | L5 min × Season Rate | 6.111 | 0.000 |
| PA | 5.470 | 5.102 | **0.368** | Track-A min × Blended Rate | 5.103 | −0.000 |
| PR | 6.028 | 5.608 | **0.421** | L5 min × Season Rate | 5.601 | 0.007 |
| RA | 2.805 | 2.645 | 0.160 | L5 min × Season Rate | 2.638 | 0.007 |

**Almost all of the previous minutes × rate gain was DNP cleanup.** Structural leftover is ≤0.008 MAE.

## PTS primary table

| Model | MAE | Bias | N |
| --- | ---: | ---: | ---: |
| Current Season Avg | 4.982 | −2.005 | 83276 |
| Current L10 | 4.943 | −1.507 | 83276 |
| Current Track A | 4.865 | −1.656 | 83276 |
| Played-only Season Avg | 4.678 | −0.292 | 83276 |
| Played-only L10 | 4.665 | −0.120 | 83276 |
| Played-only L5 | 4.779 | −0.078 | 83276 |
| Played-only Track A | **4.625** | −0.172 | 83276 |
| Track-A min × Season Rate | 4.622 | −0.181 | 83269 |
| L5 min × Season Rate | 4.623 | −0.097 | 83269 |
| Track-A min × Blended Rate | 4.626 | −0.166 | 83269 |
| L5 min × L10 Rate | 4.675 | −0.061 | 83269 |
| L5 min × L5 Rate | 4.780 | −0.071 | 83269 |

Rates are already `sum(stat)/sum(minutes)`. Mean-of-game-rates is slightly worse (4.632). Requiring ≥3 or ≥5 minutes in rate history does not help (4.630 / 4.647).

## Expected minutes vs rate window

L5 minutes had the best *minutes* MAE last time. For *final stats*, L5 minutes × season rate (4.623) ties Track-A minutes × season rate (4.622). L5 rate is worse. Season rate beats L10 rate beats L5 rate when minutes are held fixed. Minutes like recency; per-minute production likes stability.

## Error decomposition after DNP cleanup (PTS)

| Counterfactual | MAE |
| --- | ---: |
| Played-only Track A | 4.626 |
| Actual minutes × blended rate | 3.812 |
| L5 minutes × actual rate | 2.084 |

Rate misses remain larger than minute misses. corr(signed rate error, PTS error)=0.68 vs minutes 0.54. That does **not** justify shipping minutes×rate: the same residual exists under played-only Track A, and multiplying by E[min] does not beat it.

## Segments (PTS MAE)

| Slice | n | Current TA | Played TA | Min×season (M4) |
| --- | ---: | ---: | ---: | ---: |
| Regular | 77502 | 4.885 | 4.621 | 4.613 |
| Postseason | 5774 | **4.594** | 4.691 | 4.736 |
| 1–4 prior played | 6624 | 4.691 | 4.380 | 4.382 |
| 5–9 | 7759 | 4.567 | 4.194 | 4.198 |
| 10–19 | 14248 | 4.712 | 4.409 | 4.403 |
| 20+ | 54645 | 4.968 | 4.773 | 4.768 |
| Starter (2025 observed) | 13027 | 5.995 | 5.456 | 5.465 |
| Bench | 15023 | 3.924 | 3.895 | 3.901 |
| High-min (≥28 season) | 25772 | 6.323 | 5.822 | 5.806 |
| Low-min (<15) | 20283 | 3.348 | 3.309 | 3.311 |
| No team change | 78067 | 4.873 | 4.631 | 4.625 |
| First 5 new team | 706 | 4.804 | 4.608 | 4.561 |

DNP cleanup helps starters and high-minute players most. Postseason: current Track A still wins (played-only over-projects). No starter feature was added.

## 3PM

Current Track A **0.879** remains best. Played-only 0.887. Minutes×season 0.882. DNP zeros act like shrinkage toward 0 on a zero-inflated stat. Do not force 3PM onto minutes×rate. If anything, keep current (DNP-inclusive) Track A for 3PM.

## Combos

Direct PRA rate vs PTS+REB+AST summed projections: **identical MAE 6.111**. Algebraic identity under current null handling. Combo gains were DNP cleanup (PRA +0.555), not structure.

## Market overlap (latest available pregame median, not closing)

PTS n=1,498: Current TA 5.661 · Played TA 5.430 · M4 5.509 · Market **5.040**.  
Played-only closes some of the book gap via bias (Current −2.07 → Played +0.22) but does not beat the line. Not season-long market validation.

## Recommendation

**A. PLAYED-ONLY TRACK A**

Minutes × rate is not a better model structure once DNPs are removed from counting averages. Shadow next: `0.7 * L10_played + 0.3 * season_played`, keep 0-point played games, drop `"00"`. Leave 3PM on current Track A unless a dedicated 3PM pass says otherwise. Do not implement in production in this task.
