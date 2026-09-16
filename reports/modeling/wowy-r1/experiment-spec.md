# wowy-r1 experiment specification

Registered before any candidate training. Frozen PTS C / REB C, shadow protocol, production serving, and ingestion flags are unchanged. This file is the training contract if collection later supplies pregame evidence — it is not permission to train on reconstructed DNP.

## Hypothesis

Cutoff-safe game-level WOWY summaries for a **primary teammate selected from prior minutes** can reduce PTS and REB MAE versus frozen C on rows with **timestamped pregame availability**. Benefit is not assumed from historical with/without gaps.

## Two uses (do not mix)

| Use | Question | Target-game scenario source |
| --- | --- | --- |
| Historical scenario analysis | What happened to A in previous games B missed? | Reconstructed `"00"` DNP on **prior** games only |
| Pregame prediction | Using information available before this game, what should we predict for A? | Timestamped availability **before cutoff** only |

Never select a historical target-game absence from its eventual box score and call that a pregame backtest. Game-derived roster evidence is `reconstructed_historical`, not timestamp-verified.

## Feature allowlist

See `feature_spec.json`. Built by `buildWowyCandidateFeatures` in `lib/wowy/candidate-features.ts`, which calls `summarizeWowyBeforeCutoff`. Overlap policy: **primary_teammate_only**. Diffs stay null when support is insufficient. Unknown availability stays unknown (not zero).

## Availability requirements (predictive rows)

A row is `predictive_eligible` only when:

1. A primary teammate exists (prior minutes ≥ 50 and ≥ 2 shared played games on this stint).
2. WOWY support is not `insufficient` (< 2 games on either side).
3. Latest observation for that teammate with `snapshot_at < cutoff` has status `Out` or `Out For Season`.

Questionable / Doubtful / Probable / RemovedFromReport / missing → unknown. There is no Available membership on the current tape, so **WITH cannot be certified**.

## Dataset eligibility

Same played-game universe as learned-r1 common-eligible **plus** the WOWY feature builder. Stints are not pooled (`teamId` required). Seasons 2023 / 2024 / 2025 remain development evidence. 2025 is previously inspected and cannot promote.

## Dates

| Split | Season | Kind | Role if training were allowed |
| --- | --- | --- | --- |
| Train | 2023 | training | Fit only |
| Validation | 2024 | selection | Early stop + nomination |
| Test | 2025 | historical_confirmation | Previously inspected; cannot promote |
| Prospective | 2026–27 | prospective_shadow | Future holdout after freeze |

## Training budget (fixed, not run)

Do not restart broad tuning. If and only if 2024 **predictive_eligible** n is large enough to compare (spec floor: 2,000 rows; 2023 and 2024 tape = 0; 2025 known-Out window = 399, below that floor):

- Same 6-config CatBoost grid as learned-r1 (`depth` 4/6/8, `learning_rate` 0.08/0.03, `l2_leaf_reg` 3/8, `iterations` 500/800).
- Seed `20260914`, RMSE loss, 40-round early stop on **2024 only**.
- Targets PTS and REB independently. PRA derived; ignore for nomination.
- **Matched ablation:** identical predictive_eligible rows and the same 6-config procedure on frozen-C features only (`wowy_ablation`) vs C + WOWY allowlist (`wowy_candidate`). Compare both to frozen C metrics on those rows.
- Nomination bar (2024): paired ΔMAE vs ablation ≤ −0.01 and game-date clustered 95% CI entirely < 0. 2025 cannot promote.

## Metrics and comparison rules

MAE, RMSE, signed bias, prediction coverage, paired game-date clustered ΔMAE (`bootstrapMaeDifferenceGrouped`, 400 iterations, seed 20260914, `source: paired_observations`). Slices **pre-specified** (not chosen after seeing winners):

- `wowy_support`: insufficient / low / adequate
- `known_teammate_availability`: observed_without / unknown

Paired CIs on a slice use that slice’s rows only.

## Current gate

`known-out-subset.json`: **399** conservative known-Out player-games in late season 2025. Exploratory chronological ablation is possible and **not trained**. Three-season / WITH / 2024 nomination remain closed. See `known-out-feasibility.md`.
