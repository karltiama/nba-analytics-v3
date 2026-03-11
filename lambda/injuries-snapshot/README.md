# Injuries Snapshot Lambda

Fetches NBA player injuries from BallDontLie `GET /nba/v1/player_injuries`, stores append-only raw snapshots, and transforms into analytics current + history tables. Player/team based; no game_id.

## Pipeline

```
EventBridge (e.g. 2–3x daily) or manual invoke
  -> Lambda handler
    -> BDL API: GET /nba/v1/player_injuries (paginated)
    -> raw.injury_pull_runs (audit log)
    -> raw.player_injuries (append-only)
    -> analytics.player_injury_status_current (upsert — latest per player)
    -> analytics.player_injury_status_history (append — only on meaningful change)
```

**Grain:**
- **raw.injury_pull_runs:** one row per ingestion run.
- **raw.player_injuries:** one row per provider injury row per pull.
- **analytics.player_injury_status_current:** one row per player (latest known status).
- **analytics.player_injury_status_history:** one row per meaningful injury state change (status, description, return_date_raw, team_id).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_DB_URL` | Yes | Postgres connection string |
| `BALLDONTLIE_API_KEY` | Yes | BallDontLie API key (ALL-STAR tier or higher for injuries) |

## Local Testing

```bash
cd lambda/injuries-snapshot
npm install

# Run once (uses .env from repo root or this directory)
npx tsx index.ts
```

Requires `.env` with `SUPABASE_DB_URL` and `BALLDONTLIE_API_KEY`.

## Build & Package

```bash
cd lambda/injuries-snapshot
npm install
npm run build
cd dist
cp ../package.json ../package-lock.json .
npm install --production
zip -r ../injuries-snapshot.zip .
```

Produces `lambda/injuries-snapshot/injuries-snapshot.zip` for upload.

## EventBridge schedule (suggested)

Run 2–3x daily so injury reports stay current (e.g. morning, midday, pre-game).

- **UTC example:** `cron(0 13,18,22 * * ? *)` (13:00, 18:00, 22:00 UTC ≈ 8am, 1pm, 6pm ET).
- In Terraform: set `injuries_enable_schedule = true` and `injuries_schedule_cron` to the desired expression.

## Terraform

This Lambda is designed to be wired into Terraform-managed infrastructure:

- **Env:** Pass `SUPABASE_DB_URL` and `BALLDONTLIE_API_KEY` via `injuries_lambda_env` (or shared Lambda env var pattern).
- **Handler:** `dist/index.handler`.
- **Source:** `archive_file` from `lambda/injuries-snapshot` (run `npm install && npm run build` before `terraform apply`).

See `infra/lambda.tf` and `infra/variables.tf` for the injuries Lambda resources and variables.
