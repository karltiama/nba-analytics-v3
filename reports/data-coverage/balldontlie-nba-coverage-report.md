# BallDontLie NBA Data Coverage Report

- Generated at: 2026-08-31T23:42:28.751Z
- Storage mode: s3
- Bucket: `nba-analytics-data-260029269390`
- Seasons: 2023, 2024, 2025, 2026

## Season Coverage

### Season 2023
- games_count: 0
- player_logs_count: 0
- game_partitions: 0
- player_log_partitions: 0
- curated_games_count: 0
- curated_logs_count: 0
- feature_rows_count: 0
- prop_odds_detected: no
- missing_dates.games: (none detected)
- missing_dates.player_game_logs: (none detected)
- warnings:
  - Missing raw games archives under existing_ingestion.
  - Missing raw player_game_logs archives under existing_ingestion.
  - Missing curated games parquet manifest/rows.
  - Missing curated player_game_logs parquet manifest/rows.
  - Missing feature-layer outputs for player_game_features.
  - Missing prop odds/lines archives for this season.

### Season 2024
- games_count: 0
- player_logs_count: 0
- game_partitions: 0
- player_log_partitions: 0
- curated_games_count: 0
- curated_logs_count: 0
- feature_rows_count: 0
- prop_odds_detected: no
- missing_dates.games: (none detected)
- missing_dates.player_game_logs: (none detected)
- warnings:
  - Missing raw games archives under existing_ingestion.
  - Missing raw player_game_logs archives under existing_ingestion.
  - Missing curated games parquet manifest/rows.
  - Missing curated player_game_logs parquet manifest/rows.
  - Missing feature-layer outputs for player_game_features.
  - Missing prop odds/lines archives for this season.

### Season 2025
- games_count: 1297
- player_logs_count: 45066
- game_partitions: 190
- player_log_partitions: 186
- curated_games_count: 0
- curated_logs_count: 0
- feature_rows_count: 0
- prop_odds_detected: no
- missing_dates.games: 2025-11-27, 2025-12-24, 2026-02-13, 2026-02-14, 2026-02-15, 2026-02-16, 2026-02-17, 2026-02-18, 2026-04-11, 2026-04-13, 2026-04-16, 2026-05-09, 2026-05-10, 2026-05-11
- missing_dates.player_game_logs: 2025-11-27, 2025-12-24, 2026-02-13, 2026-02-14, 2026-02-15, 2026-02-16, 2026-02-17, 2026-02-18, 2026-04-11, 2026-04-13, 2026-04-16
- warnings:
  - Missing curated games parquet manifest/rows.
  - Missing curated player_game_logs parquet manifest/rows.
  - Missing feature-layer outputs for player_game_features.
  - Missing prop odds/lines archives for this season.

### Season 2026
- games_count: 0
- player_logs_count: 0
- game_partitions: 0
- player_log_partitions: 0
- curated_games_count: 0
- curated_logs_count: 0
- feature_rows_count: 0
- prop_odds_detected: no
- missing_dates.games: (none detected)
- missing_dates.player_game_logs: (none detected)
- warnings:
  - Missing raw games archives under existing_ingestion.
  - Missing raw player_game_logs archives under existing_ingestion.
  - Missing curated games parquet manifest/rows.
  - Missing curated player_game_logs parquet manifest/rows.
  - Missing feature-layer outputs for player_game_features.
  - Missing prop odds/lines archives for this season.

## Preservation Priority

- Preserve missing raw archives first (games + player_game_logs) for any season with zero partitions.
- Preserve prop odds/lines immediately if not detected, before API access expires.
- Materialize curated and feature manifests after raw preservation to validate downstream completeness.
