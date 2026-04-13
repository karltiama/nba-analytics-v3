# NBA Analytics (v3)

Production-style NBA analytics platform with a modern web app, data pipelines, and cloud automation. The project combines:

- A **Next.js 16** application for interactive analysis and internal APIs
- A **Supabase Postgres** data layer for analytics-ready tables
- Multiple **AWS Lambda** jobs scheduled by EventBridge for ingestion
- **Terraform** infrastructure definitions for repeatable deployment

---

## Quick Context For Employers

This repository is intended to demonstrate end-to-end product engineering, including:

- Building full-stack web features in a React/Next.js architecture
- Designing data ingestion workflows from external APIs
- Operating scheduled, serverless background jobs in AWS
- Structuring analytics data for query performance and maintainability
- Writing operational docs and troubleshooting guides for real deployment workflows

If you only have a few minutes, review:

1. `app/` and `lib/` for application and API design
2. `lambda/` for ingestion architecture and reliability patterns
3. `infra/` for Terraform-managed cloud resources
4. `docs/` for deployment, incident handling, and design tradeoffs

---
## Why This Project Exists

Sports betting tools often rely on surface-level statistics or manual analysis. This project was built to:

- Automate ingestion of real-time NBA data (games, odds, injuries, props)
- Transform raw data into structured analytics tables
- Generate data-driven insights for evaluating player prop bets
- Enable backtesting and performance tracking of betting strategies

The goal is to remove emotion from decision-making and replace it with measurable, repeatable analysis.

## What The System Does

At a high level:

1. Scheduled jobs fetch games, odds, injuries, and player props from external providers.
2. Raw and transformed records are stored in Postgres (`raw.*` and `analytics.*`).
3. The Next.js app serves dashboards and API routes powered by analytics tables.
4. Utility scripts support backfills, data hygiene, and diagnostics.

### Data Ingestion Coverage

| Source | Runtime | Destination (typical) |
|--------|---------|------------------------|
| BallDontLie games/stats | `lambda/nightly-bdl-updater` | `raw.*` -> `analytics.*` |
| BallDontLie odds | `lambda/odds-pre-game-snapshot` | `analytics.game_odds_*` |
| BallDontLie injuries | `lambda/injuries-snapshot` | `analytics.player_injury_status_*` |
| BallDontLie player props | `lambda/player-props-snapshot` | `analytics.player_props_current` and related tables |
| Basketball Reference (optional) | `lambda/boxscore-scraper` / `scripts/` | `bbref_*` tables |

---

## Tech Stack

- **Frontend/API:** Next.js 16, React 19, Tailwind CSS
- **Data/Auth:** Supabase (Postgres + Auth)
- **Cloud Jobs:** AWS Lambda, EventBridge, SQS
- **Infra as Code:** Terraform
- **Validation/Quality:** ESLint, Vitest

---

## Repository Guide

| Path | Why it exists |
|------|----------------|
| `app/` | App Router pages plus API route handlers |
| `components/` | Reusable UI and betting-focused presentation components |
| `lib/` | Data access, Supabase clients, shared server utilities |
| `lambda/` | Independent Lambda packages for ingestion and processing |
| `infra/` | Terraform for Lambdas, IAM, scheduling, and deployment resources |
| `scripts/` | Operational scripts for seeding, maintenance, and diagnostics |
| `db/schemas/` | Schema references, migration notes, consolidation docs |
| `docs/` | Runbooks, troubleshooting, design notes, and checklists |

Note: Lambda packages are intentionally excluded from the root TypeScript project to keep web app builds fast. Build and test each Lambda package within its own folder when changing ingestion code.

---

## Local Setup

### Prerequisites

- Node.js `20.x`

### Run Locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### Production Build Check

```bash
npm run build
npm start
```

---

## Environment And Secrets

- Start from `.env.example` and copy values into `.env.local`
- Full environment matrix and deployment context are in `docs/deployment-checklist.md`
- Never commit `.env`, `.env.local`, or live credentials

---

## Common Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start local Next.js dev server |
| `npm run build` | Build production bundle |
| `npm start` | Run built production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest suite |
| `npm run lambdas` | Invoke Lambda flows locally |
| `npm run lambdas:aws` | Invoke Lambda flows against AWS |
| `npm run prune:player-props-v2` | Dry-run cleanup for old prop snapshots |
| `npm run prune:player-props-v2:execute` | Execute cleanup for old prop snapshots |

---

## Engineering Decisions Worth Calling Out

- **Separation of concerns:** Web app, data pipelines, and infrastructure code are isolated by directory and runtime boundary.
- **Operational readiness:** Runbooks and deployment checklists are part of the repo, not external tribal knowledge.
- **Scalable ingestion:** Player props ingestion supports controller/worker fan-out patterns via SQS.
- **Maintainability focus:** Scripts and schema docs exist for iterative cleanup, backfill, and migration safety.

---

## Additional Documentation

- [Documentation index (start here)](docs/index.md)
- [Deployment checklist](docs/deployment-checklist.md)
- [Supabase troubleshooting](docs/internal/supabase-connection-troubleshooting.md)
- [Data seeding guide](docs/data-seeding-guide.md)
- [Infra guide](infra/README.md)

---

## License

Currently private (`"private": true` in `package.json`). Add a formal license before open sourcing.
