# Played-only Track A research benchmark

Run: 2026-09-14T23:35:30.399Z
Research version: `player-projection-v1-minutes-role-r1`.

Production projection defaults, APIs, UI, calibration, and EV were **not** changed.

## Definition

- Formula: `0.70 * mean(last 10 PLAYED games) + 0.30 * mean(season PLAYED games)`
- Played predicate: played if parsed minutes > 0, or minutes token is "0" / "0.0"; minutes token "00" is always DNP; real zero-stat appearances with minutes remain included
- As-of rule: strictly start_time < target tipoff; active_season only (same analytics.games.season)
- Targets: Final player-games that are played (isPlayedGame) with ≥1 prior played game in-season
- Leakage: target-game box, minutes, and starter flag are never inputs

Entrypoint: `npm run evaluate:player-projection-v1` (`scripts/evaluate-player-projection-v1.ts`).
Helpers: `lib/betting/player-projection-v1-research.ts` (uses `isPlayedGame` + `buildPlayedOnlyAsOfModelInputs`).

## Chronological split

| Split | Season | N played targets |
| --- | --- | --- |
| Train / fit-history | 2023–24 (`2023`) | 27653 |
| Validation / select | 2024–25 (`2024`) | 27696 |
| Test / freeze | 2025–26 (`2025`) | 28130 |

Coverage is complete and comparable across those three seasons (Final box logs). 2026 games are excluded (no Finals in this extract).

Scored: **83479** played player-games with ≥1 prior played game (793 players). Range 2023-10-27T02:00:00.000Z → 2026-06-14T00:30:00.000Z. As-of leakage rows: **0** (must be 0).

## Appearance corpus (Final 2023–2025 logs loaded)

| Token / class | n |
| --- | --- |
| All logs | 138296 |
| minutes `"00"` DNP | 53094 |
| minutes `"0"` / `"0.0"` played | 210 |
| Played | 85202 |
| Zero-point played kept | 10319 |
| DNP | 53094 |

## Benchmark MAE (all three seasons, played targets)

| Prop | MAE | RMSE | Bias | N |
| --- | --- | --- | --- | --- |
| PTS | 4.621 | 6.093 | -0.165 | 83479 |
| REB | 1.918 | 2.549 | -0.055 | 83479 |
| AST | 1.348 | 1.850 | -0.044 | 83479 |
| 3PM | 0.885 | 1.260 | -0.018 | 83479 |
| PRA | 6.108 | 7.924 | -0.263 | 83479 |
| PA | 5.099 | 6.682 | -0.208 | 83479 |
| PR | 5.604 | 7.295 | -0.219 | 83479 |
| RA | 2.644 | 3.461 | -0.099 | 83479 |

