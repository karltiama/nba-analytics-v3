# Known-Out subset feasibility (not trained)

Season **2025** is 2025–26. March–May 2026 is inside that season. The earlier “zero timestamped availability in 2023–2025” sentence was wrong.

## Coverage statement

- **2023, 2024:** no `player_injury_status_history` rows.
- **2025:** 4,801 timestamped injury rows, 2026-03-10 → 2026-05-06. No provider `Available` status.
- **`game_id`:** missing on history (schema gap). Not inherently impossible to join. In this window, unique Final team-nights on an America/New_York date have **0 collisions** (656 team-games). Conservative join: injury `team_id` = subject’s game `team_id`, unique team-ET date, observation strictly before T−60.

315/322 was “some Out listed on either team before tip.” That is not a player-level primary-teammate scenario.

## Audit (script: `scripts/audit-wowy-r1-known-out.ts`)

Universe: season-2025 Final played subject-games in 2026-03-10 … 2026-05-07 (**7,083**). Primary teammate from prior minutes only. Explicit Out / Out For Season, 48h freshness, unambiguous team-night, WOWY support not insufficient.

| Eligible | Count |
| --- | ---: |
| Player-games | **399** |
| Distinct game dates | 36 |
| Distinct games | 106 |
| Distinct players | 172 |
| Distinct teammate pairs | 184 |
| Low support (2–7 / side) | 238 |
| Adequate support (≥8 / side) | 161 |

Date-clustered 70/30: train **247** rows (25 dates, 2026-03-11 → 2026-04-07), eval **152** rows (11 dates, 2026-04-08 → 2026-05-06).

### Exclusions (from the 7,083 played rows)

| Reason | N |
| --- | ---: |
| No primary teammate (prior minutes floor) | 84 |
| Ambiguous team-ET date / unique-game mismatch | 0 |
| No observation before cutoff | 1,378 |
| Only observations at/after cutoff | 1,959 |
| Stale (>48h before cutoff) | 2,300 |
| Latest status not explicit Out | 837 |
| Insufficient WOWY support | 126 |

RemovedFromReport / Questionable / Probable were not treated as Out or Available.

## Feasibility decision

**Exploratory known-Out-only chronological comparison is possible. Do not train it in this slice.**

- Sample and span (399 rows, 36 dates, 247/152 date-clustered split) can support a matched no-WOWY ablation as **development evidence**.
- It is **not** enough for the original 2,000-row 2024 nomination plan or a three-season backtest.
- Applies only to explicitly known-Out primary teammates. WITH remains untested.
- Season 2025 was already inspected in learned-r1; this window cannot promote.

Three-season pregame WOWY evaluation stays closed, with these counts rather than a blanket zero.

## UI verification

Model Lab **adapter tests passed**. Browser verification of `/admin/model-lab` **succeeded** on 2026-09-16 (known-Out residual labeled exploratory/inconclusive; prospective **Not started.**). `/parlay-xray` compiles again. Adapter tests remain a separate claim from the UI check.
