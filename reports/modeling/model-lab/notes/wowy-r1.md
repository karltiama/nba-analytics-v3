---
experiment_id: wowy-r1
version: player-projection-wowy-r1
updated: 2026-09-16
---

# WOWY candidate features r1

## Decision
Exploratory known-Out subset exists (399 player-games) and was **not trained**. Three-season evaluation and WITH selection remain closed. Frozen C unchanged.

## Why
2023 and 2024 have no injury tape. Season 2025 includes the March–May 2026 tape. Missing `game_id` is a schema gap; unique team-ET Final nights in that window have 0 collisions. A conservative primary-teammate known-Out audit produced 399 rows / 36 dates — below the 2,000-row 2024 nomination floor and already development evidence.

## Out of scope
Retraining frozen C. Unpausing shadow scoring. Activating injuries collection. Inferring Available from report omission. Browser verification of Model Lab is recorded separately (2026-09-16 `/admin/model-lab` loaded; adapter tests are not a substitute).

## Follow-up
The last-observed known-Out residual is registered separately as `wowy-known-out-r1` (625 eligible; decision inconclusive). Independently: injuries-only collection after a BDL `/nba/v1/player_injuries` probe, per `prospective-integration.md`.
