# Agent instructions

Always-on rules only. Open the one doc the task needs. Do not paste runbooks into this file.

`notes/` and `reports/` are local and gitignored. They are not shared authority.

## Terraform apply freeze (since 2026-11-02)

Live AWS intentionally differs from Terraform: odds, player props and the regular-season scoreboard were activated outside Terraform, and the deployed odds/props/scoreboard code is not yet on `master`.

Until Karl approves **Phase 3 of the Terraform reconciliation** (project decision record `TF_RECONCILIATION_DECISION_RECORD.md`), in any session, human or agent:

- Do **not** run `terraform apply`, `destroy`, `import`, `taint`, `state rm|mv|push`, `force-unlock`, or any `-target` apply.
- Do **not** deploy Lambda code outside Terraform, and do not edit Lambda env, schedules or rules in the console.
- `terraform plan` is read-only but rewrites local `infra/*.zip` via `archive_file`. Run it only with explicit approval, and never with `-out` (saved plans contain secrets).

A plain `apply` today would refreeze odds and props, disable the props schedules and worker mapping, stop regular-season Today's Games, and redeploy unreviewed local builds.

Remove this section only as part of the approved Phase 3.

## Safety

- Do not commit `.env`, `.env.local`, or `*.tfvars`. Copy from `.env.example` and `infra/terraform.tfvars.example`.
- Root `tsconfig.json` excludes `lambda/`, `scripts/`, and `tmp/`. `npm run build` does not typecheck them. Build a Lambda in its own package. Terraform apply and schedules: [infra/README.md](infra/README.md) only.
- Missing `DATA_MODE` is not live. Destructive prune also needs cron auth and `PRUNE_ENABLED=1`, with `DATA_MODE=live_api`, `OFFSEASON_MODE=0`, and `CRON_DRY_RUN=0`. Full checks: [docs/production-security.md](docs/production-security.md).
- Provider key name is `BALLDONTLIE_API_KEY`. `BALDONTLIE_API_KEY` is a typo alias fallback only.

## Dev server

Before `npm run dev`, `next dev`, `next start`, or any other local web server, identify the port 3000 listener and its parent chain. Procedure: [docs/dev-server.md](docs/dev-server.md).

- The main Court Context server is `http://localhost:3000`, started with `npm run dev -- --port 3000`. Bare `npm run dev` is the Next.js 16 path that walks to 3001–3010. Pass `--port 3000`.
- Reuse port 3000 only when that chain positively matches this worktree after path normalization. The port number is not ownership. Leave another worktree's process running. Unknown ownership is reported; do not start a server and do not kill a process.
- A temporary preview server is one explicit free port in a tracked session, and only when port 3000 is positively another worktree. Stop it through that session. Stop a surviving child only when its PID, creation time, and ancestry still match the tree you started. Otherwise report the remaining PID and do not claim the port was released.
- Extra Next.js processes open more Supabase Postgres connections (`EMAXCONNSESSION`). Load tests against production Supabase need explicit authorization.
- When the task ends, report the server reused or started, its port, worktree, ownership, and whether temporary cleanup was confirmed.

## Do not treat these as settled

- **Node.** App pin is `package.json` `engines.node` (`24.x`). Each Lambda `runtime` is on that function in `infra/*.tf`. Ingestion functions in `infra/lambda.tf` are `nodejs22.x`. `projection-ledger` and `context-prospective-shadow` are `nodejs20.x`. Shadow projection also has `python3.11`. README text that says Node 20, and CLI docs that pass `--runtime nodejs20.x`, are not the app pin. "Node 22" in `infra/README.md` is the build note for the functions that file lists.
- **Box scores.** BallDontLie nightly writes `raw.*`. Many product queries read `analytics.player_game_logs`. Basketball Reference scrapers write `bbref_*`, and some team/player queries still read those tables. `db/schemas/BBREF_ARCHITECTURE.md` calls BBRef the primary source for every box score. That claim is not settled. Follow the query the feature uses. Do not switch writers unless the task says so.

## Route

Start at [docs/index.md](docs/index.md). Open one row.

| Task | Doc |
|---|---|
| Layout, schemas, which jobs exist | [docs/architecture.md](docs/architecture.md) |
| Tests | [docs/testing.md](docs/testing.md) |
| Local dev server | [docs/dev-server.md](docs/dev-server.md) |
| Project style deltas | [docs/coding-standards.md](docs/coding-standards.md) |
| Deploy and secrets | [docs/deployment-checklist.md](docs/deployment-checklist.md) |
| Auth, cron, prune, freeze | [docs/production-security.md](docs/production-security.md) |
| Terraform apply | [infra/README.md](infra/README.md) |
| Seed or backfill | [docs/data-seeding-guide.md](docs/data-seeding-guide.md) |
| UI type | [docs/typography.md](docs/typography.md) |
| Entitlements | [docs/product/free-pro-entitlement-policy.md](docs/product/free-pro-entitlement-policy.md) |
| Roster identity | [docs/roster-canonical-identity-design.md](docs/roster-canonical-identity-design.md) |

Odds essays, scraping notes, and `docs/internal/*` are historical unless the task names the file.
