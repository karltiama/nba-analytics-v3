# Market intelligence analysis (Step 7E)

Generated: 2026-09-09T03:34:45.537Z

**GREEN — captured market data supports differentiated Court Context features**

Market-data trial verdict: **STRONG_SUCCESS**

Zero BDL HTTP. Zero Postgres writes. Opening archives read from S3 only.

Machine-readable source: `reports/trial/market-intelligence-analysis.json`

## Safety State

- Production frozen: `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`
- Season pin: 2025
- BDL HTTP: **0**
- Postgres writes: **0**
- Acquisition lock: not held / not acquired
- `research.prop_decision_lines` and `analytics.game_odds_history`: read-only
- Postgres: **342,846,611 bytes / 326.96 MB** before and after (unchanged)
- No advanced-stats serving table
- Isolation: 2025 logs 46,056; 2026 logs 0; `prop_decision_lines` 94,086 / 129 games; `game_odds_history` 63,380 / 334 games

## Reconstructed Matched Datasets

### Player props

- S3 games: 129 / 129
- Opening rows: **44,127**
- Unmapped (double_double / triple_double / other): 6,168
- Ambiguous simultaneous-line groups: **1,827 groups / 5,024 rows** (Betrivers)
- Eligible canonical non-ambiguous: 32,935
- Deterministic Open→Close matches: **27,491** (62.3% of opening; 83.5% of eligible)
- Key: `game_id + player_id + lower(vendor) + canonical prop_type`
- Odds live under nested `market.over_odds` / `market.under_odds`

### Game odds (Mar 9–22 2026)

- S3 games: 107 / 107
- Opening rows: 1,179 (965 sportsbook + 214 prediction-market)
- Deterministic sportsbook matches: **945 / 965 = 97.9%**
- Unmatched: 20, all **Rebet** with no last-pre-tip close
- Key: `game_id + lower(vendor)`

## Recommended v1 Market Movement universe

**Vendors:** BetMGM, FanDuel, DraftKings, Caesars

**Markets:** points, rebounds, assists, threes, points_rebounds, points_assists, PRA

**Not v1:** BetRivers (ambiguous variants), Fanatics (Tier B, ~100 opening rows/market), blocks, steals, Double Double, Triple Double, rebounds_assists (v1.1)

## Prop line movement (product-grade books)

Overall n=24,412: **85.3% unchanged**, 14.7% moved ≥1.0. Combos move much more:

| Market | n | % unchanged | % moved ≥1.0 |
| --- | ---: | ---: | ---: |
| points | 4,716 | 79.0 | 21.0 |
| rebounds | 4,180 | 91.0 | 9.0 |
| assists | 2,777 | 91.5 | 8.5 |
| threes | 3,397 | 96.1 | 3.9 |
| blocks | 1,248 | 99.0 | 1.0 |
| steals | 365 | 98.1 | 1.9 |
| points_rebounds | 2,116 | 74.6 | 25.4 |
| points_assists | 1,709 | 74.8 | 25.2 |
| rebounds_assists | 1,667 | 85.4 | 14.6 |
| PRA | 2,237 | 72.4 | 27.6 |

## Prop juice movement (line unchanged)

When the line is unchanged and both prices exist (n=20,823): **17.9%** move ≥2 implied-probability points; **2.5%** move ≥5pp. Mean absolute move **1.09pp**. Not a profitability claim.

## Movement taxonomy

Naive “86% unchanged” hides juice. Product-grade books:

| Class | n | % |
| --- | ---: | ---: |
| A — no meaningful movement | 16,652 | 68.2 |
| B — juice only | 4,171 | 17.1 |
| C — line movement | 776 | 3.2 |
| D — line + material price | 2,813 | 11.5 |

**31.8%** of matched markets have meaningful movement (B+C+D).

## Cross-book dispersion (3-hour)

7,029 multi-book markets across the four v1 books. **70% all agree**. When they disagree it is almost always a full point (**30% range ≥1.0**; 0.5-point splits are rare). Most disagreement: PRA 46.4%, points 42.1%, PA 41.4%, PR 40.5%. Least: threes 8.9%, blocks 7.3%.

## Closing convergence

Median open range 0 vs median close range 0. **11.2% converge, 11.7% diverge, 77.2% unchanged**. No causality claim. Books do not systematically tighten by close in this window.

## Book-specific behavior (descriptive only)

Do **not** label any book sharp.

- FanDuel: highest line-move (17.3%) and juice-only (20.5%) frequency
- BetMGM: most matches (8,848); 73.5% on 3-hour consensus
- DraftKings / Caesars: sit on consensus more often (91.5% / 96.1%)

## Game-odds consensus (107 games, 9 books)

Median spread movement **0**; median total movement **+0.5**. 79.4% of games have ≥0.5 consensus spread move; 86% have ≥0.5 total move. Cross-book spread range median 1.0 → 0.5 at close; total range 1.5 → 1.0. Betway excluded. Polymarket/Kalshi kept separate (ML-only).

## Game-odds outliers

5 extreme vendor rows vs consensus. **Do not alter the raw archive.** Filter candidates:

- `18447469` DraftKings / BetMGM: suspicious opening snapshots (open far from peers, then huge catch-up)
- `18447469` Rebet: suspicious vendor move vs consensus
- `18447845` Fanatics: suspicious opening snapshot
- `18447808` DraftKings total +10: aligned with cross-book consensus (legitimate)

## Game-odds vendor quality

**Tier A:** Bally Bet, BetMGM, BetRivers, Caesars, DraftKings, Fanatics, FanDuel  
**Tier B:** BetParx (no totals), Rebet (81.3% match, no ML)  
**Excluded:** Betway (3/107)  
**Separate:** Polymarket, Kalshi

## Context joinability

Player-game logs: **1,499 / 1,499 (100%)**. Stints: 99.7%. Advanced Stats S3: **1,470 / 1,499 pairs (98.1%)**, 121/121 matched games — **S3 only, no serving table**. Game odds: 107/107 games, team_game_stats, and home team averages.

## Injury / role feasibility

**Not sufficient for a causal study.** Injury history timestamps cover the prop window (2026-03-10 → 2026-05-06 vs games 2026-04-03 → 2026-05-02), and 11,974 player-games have a history snapshot at or before tip, but: no lineup archive, current injury table is latest-state only, sampling density around the 3-hour mark is unproven, absence vs minutes-drop is not defined.

## Candidate features

| Feature | Readiness | Priority |
| --- | --- | --- |
| A 3-Hour Pre-Tip → Close | ready, scoped v1 | P1 |
| B Market Consensus | ready, 4-book v1 | P1 |
| C Line Shopping | partial (historical, not live) | P2 |
| D Book Movement | ready descriptive | P2 |
| E Opening Snapshot → Close | ready, Mar 9–22 only | P1 with window warning |
| F Market + Context | not ready (lineups / as-of injury / no Adv Stats serving) | later |

## Terminology

- Props: **3-Hour Pre-Tip** (exactly 3.0 hours for all opening rows)
- Game odds: **Opening Snapshot** (median 22.6 hours pre-tip; Mar 9–22 only)
- Avoid: true market open, opening line, first print

## What not to build

Universal all-book opening history; season-wide game opening odds; DD/TD Open→Close; Betway movement; arbitrary Betrivers variants; live shopping from decision lines; profitability/CLV claims; injury-driven teammate movement as v1; mixing prediction markets into sportsbook spread/total UI.

## Remaining trial priorities

**Next:** lineup characterization only (small sample). Do not launch full lineups, 2022, or extra provider probes. Then final trial audit. Keep the **6-hour reserve**. ~32.6 h remaining / ~26.6 h usable after reserve.
