# 2025–26 final completeness certification

Generated: 2026-09-08T13:29:10.512Z

Read-only. Cached BDL inventory only. No provider HTTP. No Postgres writes.

## Safety

- DATA_MODE=replay
- OFFSEASON_MODE=1
- CRON_DRY_RUN=1
- season pin=2025
- BDL lock active=false
- BDL HTTP requests=0

## Inventory

- Cached season games: 1322
- Authoritative Finals: 1322
- 21681993 in cache: false

## Certification matrix

| Gate | Result |
| --- | --- |
| BDL Final inventory | GREEN |
| Games metadata | GREEN |
| Raw player stats | GREEN |
| Analytics player logs | GREEN |
| Team stats | GREEN |
| Score reconciliation | GREEN |
| Raw ↔ analytics parity | GREEN |
| 33 playoff-tail repairs | GREEN |
| 18447793 replacement | GREEN |
| Season averages sanity | GREEN |
| Stints sanity | GREEN |
| 2026 isolation | GREEN |
| 2024/2023 still empty | GREEN |
| S3 repair archive | GREEN |
| Storage | GREEN |
| Production freeze | GREEN |

## Explicit answers

1. Authoritative 2025–26 Finals in cached BDL inventory: **1322**
2. Complete raw stats: **1322**
3. Complete analytics player logs: **1322**
4. Exactly two valid team-stat rows: **1322**
5. Score-reconciliation failures: **0**
6. 33 playoff-tail games: **33 / 33 repaired**
7. 18447793 fully corrected: **true**
8. Raw/analytics key parity: **true**
9. 2024/2023/2026 serving data: No 2024/2023/2026 serving-data change detected (read-only counts match expected isolation).
10. 21681993 contaminates 1,322-game set: **No** (classification LOCAL_ONLY_UNRESOLVED; excluded from BDL ID set)
11. Postgres below historical-materialization thresholds: **true** (304.07 MB; headroom to 400=95.93; to 450=145.93)
12. 2025–26 repair phase fully complete: **true**

## Local-only game

`21681993` = **LOCAL_ONLY_UNRESOLVED**. Not in cached BDL inventory. Player logs=0. Not deleted or relabeled.

## Verdict

**GREEN — 2025–26 certified complete; proceed to 2024 historical backfill**
