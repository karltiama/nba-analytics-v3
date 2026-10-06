# Agent instructions

Always-on rules only. Open the one doc the task needs. Do not paste runbooks into this file.

`notes/` and `reports/` are local and gitignored. They are not shared authority.

## Safety

- Do not commit `.env`, `.env.local`, or `*.tfvars`. Copy from `.env.example` and `infra/terraform.tfvars.example`.
- Root `tsconfig.json` excludes `lambda/`, `scripts/`, and `tmp/`. `npm run build` does not typecheck them. Build a Lambda in its own package. Terraform apply and schedules: [infra/README.md](infra/README.md) only.
- Missing `DATA_MODE` is not live. Destructive prune also needs cron auth and `PRUNE_ENABLED=1`, with `DATA_MODE=live_api`, `OFFSEASON_MODE=0`, and `CRON_DRY_RUN=0`. Full checks: [docs/production-security.md](docs/production-security.md).
- Provider key name is `BALLDONTLIE_API_KEY`. `BALDONTLIE_API_KEY` is a typo alias fallback only.

## Do not treat these as settled

- **Node.** App pin is `package.json` `engines.node` (`24.x`). Each Lambda `runtime` is on that function in `infra/*.tf`. Ingestion functions in `infra/lambda.tf` are `nodejs22.x`. `projection-ledger` and `context-prospective-shadow` are `nodejs20.x`. Shadow projection also has `python3.11`. README text that says Node 20, and CLI docs that pass `--runtime nodejs20.x`, are not the app pin. "Node 22" in `infra/README.md` is the build note for the functions that file lists.
- **Box scores.** BallDontLie nightly writes `raw.*`. Many product queries read `analytics.player_game_logs`. Basketball Reference scrapers write `bbref_*`, and some team/player queries still read those tables. `db/schemas/BBREF_ARCHITECTURE.md` calls BBRef the primary source for every box score. That claim is not settled. Follow the query the feature uses. Do not switch writers unless the task says so.

## Route

Start at [docs/index.md](docs/index.md). Open one row.

| Task | Doc |
|---|---|
| Layout, schemas, which jobs exist | [docs/architecture.md](docs/architecture.md) |
| Tests | [docs/testing.md](docs/testing.md) |
| Project style deltas | [docs/coding-standards.md](docs/coding-standards.md) |
| Deploy and secrets | [docs/deployment-checklist.md](docs/deployment-checklist.md) |
| Auth, cron, prune, freeze | [docs/production-security.md](docs/production-security.md) |
| Terraform apply | [infra/README.md](infra/README.md) |
| Seed or backfill | [docs/data-seeding-guide.md](docs/data-seeding-guide.md) |
| UI type | [docs/typography.md](docs/typography.md) |
| Entitlements | [docs/product/free-pro-entitlement-policy.md](docs/product/free-pro-entitlement-policy.md) |
| Roster identity | [docs/roster-canonical-identity-design.md](docs/roster-canonical-identity-design.md) |

Odds essays, scraping notes, and `docs/internal/*` are historical unless the task names the file.
