# NBA Analytics (v3)

Next.js app for NBA betting analytics: game and player views, odds/props tooling, and Supabase-backed APIs. Scheduled **AWS Lambda** jobs ingest data from **BallDontLie** (and optional scrapers) into Postgres; the UI reads from the `analytics` schema.

## Stack

- **Frontend / API:** Next.js 16 (App Router), React 19, Tailwind CSS  
- **Auth & DB:** Supabase (Auth + Postgres)  
- **Background jobs:** AWS Lambda + EventBridge (and SQS for player props fan-out)  
- **IaC:** Terraform under `infra/`  

## Repository layout

| Path | Purpose |
|------|---------|
| `app/` | Routes, pages, and `app/api/*` route handlers |
| `components/` | Shared UI (including betting-specific components) |
| `lib/` | Server utilities, Supabase clients, betting/analytics queries |
| `lambda/` | Standalone Lambda packages (each has its own `package.json` + build) |
| `infra/` | Terraform for Lambdas, schedules, IAM, etc. |
| `db/schemas/` | SQL schema notes and migrations (reference) |
| `scripts/` | One-off maintenance, seeds, diagnostics (not required for `npm run dev`) |
| `docs/` | Deployment, odds/props design notes, troubleshooting |

Lambda code is **excluded from the root TypeScript project** so `next build` stays fast; build each function inside `lambda/<name>/` when you change it (see `docs/deployment-checklist.md`).

## Prerequisites

- **Node.js 20.x** (see `package.json` `engines`)

## Local development

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your Supabase URL, anon key, and optional SUPABASE_DB_URL
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Betting routes live under `/betting` (exact entry points may vary; explore `app/`).

**Production build:**

```bash
npm run build
npm start
```

## Environment variables

- **Committed template:** [.env.example](.env.example) — copy to `.env.local` for local use.  
- **Reference tables:** [docs/deployment-checklist.md](docs/deployment-checklist.md) (Vercel, Supabase, cron secrets, optional AI keys).  
- **Never commit** `.env`, `.env.local`, or real API keys.

## Data ingestion (high level)

| Source | Where it runs | Typical destination |
|--------|----------------|---------------------|
| BallDontLie games/stats | `lambda/nightly-bdl-updater` | `raw.*` → `analytics.*` game/player stats |
| BallDontLie odds | `lambda/odds-pre-game-snapshot` | `analytics.game_odds_*` |
| BallDontLie injuries | `lambda/injuries-snapshot` | `analytics.player_injury_status_*` |
| BallDontLie player props | `lambda/player-props-snapshot` (controller + worker) | `analytics.player_props_current`, etc. |
| Basketball Reference (optional) | `lambda/boxscore-scraper` / `scripts/` | `bbref_*` tables |

Manual seeds and backfills live in `scripts/`; deeper detail: [docs/data-seeding-guide.md](docs/data-seeding-guide.md).

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run lambdas` | Invoke Lambdas locally via `scripts/call-all-lambdas.ts` |
| `npm run lambdas:aws` | Same, targeting AWS |
| `npm run prune:player-props-v2` | Prune old player-prop snapshot rows (dry-run; add `:execute` to apply) |

## AWS / Terraform

See **[infra/README.md](infra/README.md)** for `terraform init/plan/apply`, building Lambdas before deploy, and schedule variables.

## Documentation index

- [Production deployment checklist](docs/deployment-checklist.md)  
- [Supabase connection troubleshooting](docs/supabase-connection-troubleshooting.md)  
- [Data seeding guide](docs/data-seeding-guide.md)  

## License

Private project (`"private": true` in `package.json`). Adjust if you open-source it.
