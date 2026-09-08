# 2023 provider-quality policy (Step 4E)

Generated: 2026-09-08T19:21:20.744Z

**GREEN — quality policy is fail-closed and 2023 is ready for controlled materialization**

BDL HTTP: 0. Postgres writes: 0. Do not materialize 2023 from this step.

## Safety State

Production frozen. `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`, season pin 2025. 2023 serving empty. 2024/2025/2026 isolation unchanged.

## Existing Quality Infrastructure Audit

`public.game_validation_results` exists (5,817 rows). Unique `(game_id, check_name)`. Existing IDs are `bbref_*`; BDL numeric IDs do not collide. `details` jsonb can hold season, source, official, provider sum, delta, notes.

## Chosen Quality Representation

Reuse `public.game_validation_results`. No migration. Write the 10 rows at materialization time, not now.

- `check_name`: `BDL_PLAYER_POINTS_SCORE_MISMATCH`
- `status`: `fail`
- `severity`: `error` (high)

## Anomaly Code / Semantics

Provider official game score is authoritative for the game record, but the sum of provider player `pts` is lower. Targeted `/v1/stats` refetch and Box Scores independently reproduced the same provider data. Player stats are not “corrected.” Missing points are not inferred.

## Policies

- **Game score:** `analytics.games` from BDL Games.
- **Player stats:** store BDL rows exactly. Do not alter `pts`.
- **Team stats:** `team_points` = SUM(player logs). `points_allowed` and `result` use official `analytics.games` scores. Do not overwrite `team_points` with official scores.
- **Season averages:** include the 10 games as reported. Preserve quality metadata so score-sensitive work can exclude them.
- **Research filter:** `check_name = BDL_PLAYER_POINTS_SCORE_MISMATCH AND status = fail AND severity = error`. Do not auto-exclude from Historical Explorer.

## Dry-run counts

| Object | Projected |
| --- | --- |
| games | 1,319 |
| player logs | 46,090 |
| team stats | 2,638 |
| player averages | 595 |
| team averages | 30 |
| inferred stints | 695 |
| quality flags | 10 |
| strict PASS | 1,309 |
| persistent anomaly allow | 10 |
| reject | 0 |

## Validator tests

`lib/ingestion/historical-serving/__tests__/provider-quality-policy.test.ts` — 8 passed. Known 10 allowed only under the explicit policy. Unknown mismatch, structural defect on a known ID, and delta drift fail closed. Clean games unchanged. No `ignoreScoreMismatch`.

## Projected storage

Calibrated from 2024 actual **+10.95 MB**.

- low 10.39 MB
- base 10.94 MB
- high 12.58 MB
- projected DB after 2023: **325.96 MB**
- headroom to 340 MB: **14.04 MB**

## Trial API cost

**0.** BDL anomaly investigation is CLOSED for the trial.

## Remaining blockers

Wire `evaluateSeason` into 2023 materialize execute and upsert the 10 quality rows. Do not write from this step.
