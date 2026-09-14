# Played-game baseline vs minutes × rate

Run: 2026-09-14T01:26:16.141Z  
Feature definition: **active_season** as-of tipoff.  
Seasons 2023–2025. Range 2023-10-27 → 2026-06-14.  
Scored: **83,276** player-games with minutes > 0 and ≥1 prior played game (793 players).  
Production Track A / Track B.1 was **not** changed. Sportsbook lines are evaluation-only.

Same content as `projection-v2-structure.md` (this filename is the alias requested in the task).

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

## Recommendation

**A. PLAYED-ONLY TRACK A**

See `projection-v2-structure.md` for the full tables (PTS primary, segments, 3PM, combos, market overlap).
