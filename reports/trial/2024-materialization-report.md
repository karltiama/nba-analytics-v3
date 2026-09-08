# 2024 materialization (Step 3C)

Generated: 2026-09-08T16:25:16.224Z

## Step Verdict

**GREEN — 2024 materialized successfully; storage gate passes**

## Safety State

- DATA_MODE=replay OFFSEASON_MODE=1 CRON_DRY_RUN=1
- season pin=2025 dbHost=aws-1-us-east-2.pooler.supabase.com
- BDL HTTP=0 stagingMode=none

## Counts

- games 1321/1321
- logs 46150/46150
- team stats 2642/2642
- player avgs 587/587
- team avgs 30/30
- inferred stints 699 (expected ~699)
- score 1321/1321
- raw 2024 rows 0 (must be 0)

## Storage

- before 304.07 MB after 315.02 MB delta 10.95 MB
- headroom to 340/400/450: 24.98 / 84.98 / 134.98 MB
- gate ok=true

## 2023

- S3 acquisition: likely still safe / recommended (~450-500 req, ~1.8-2.0 h). Not started.
- Postgres materialization: eligible (depends on 2024 delta). Not started.
