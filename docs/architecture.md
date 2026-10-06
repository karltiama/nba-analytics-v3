# Architecture map

Use this to find the right tree. Procedures stay in the linked runbooks.

## Surfaces

| Path | Role |
|---|---|
| `app/`, `components/`, `lib/` | Next.js App Router UI and server code. Import alias `@/*` is the repo root. |
| `lambda/` | Separate packages. Not typechecked by the root Next build. |
| `scripts/` | Operational scripts (`tsx`). Also excluded from the root `tsconfig.json`. |
| `infra/` | Terraform. Apply rules live only in [../infra/README.md](../infra/README.md). |
| `db/schemas/` | Schema notes and old consolidation decisions. Not a migration runner. |
| `sql/proposed/` | Proposed SQL that is not evidence it has been applied. |
| `docs/` | Runbooks and design notes. Router: [index.md](./index.md). |

`notes/` and `reports/` are gitignored local trails. Do not cite them as repo truth.

## Data

Postgres is Supabase. Common schema names:

- `raw.*` — provider landing tables. The BallDontLie nightly job writes games and player stat lines here.
- `analytics.*` — serving tables. Much of the product reads `analytics.player_game_logs` and related views.
- `bbref_*` — Basketball Reference scrape tables. Independent of canonical `games`. Some team and player queries still read `bbref_player_game_stats`.

**Box-score authority is unresolved.** Both pipelines are in the tree. [../db/schemas/BBREF_ARCHITECTURE.md](../db/schemas/BBREF_ARCHITECTURE.md) and [../db/schemas/SCHEMA_DECISION.md](../db/schemas/SCHEMA_DECISION.md) say BBRef is primary for every box score, and their own checklists still list scraper follow-ups. The README calls Basketball Reference optional. Read the query for the feature you are changing. Do not retarget writers from one family to the other unless the task says so.

## Jobs

The README ingestion table is a subset. Schedules and runtimes are in `infra/*.tf`.

| Runtime in Terraform | Where |
|---|---|
| `nodejs22.x` | Functions in `infra/lambda.tf`, plus `game-status-sync`, `postgame-worker`, and the Node shadow-projection function |
| `nodejs20.x` | `projection-ledger`, `context-prospective-shadow` |
| `python3.11` | Shadow-projection training/scoring function in `infra/shadow-projection.tf` |

App Node is not any of those. It is `package.json` `engines.node` (`24.x`).

Live provider calls and deletes are gated by `DATA_MODE`, `OFFSEASON_MODE`, and `CRON_DRY_RUN`. See [production-security.md](./production-security.md).

## When to open something else

- Deploy checklist: [deployment-checklist.md](./deployment-checklist.md)
- Seed or backfill: [data-seeding-guide.md](./data-seeding-guide.md)
- Roster identity: [roster-canonical-identity-design.md](./roster-canonical-identity-design.md)
- Entitlements: [product/free-pro-entitlement-policy.md](./product/free-pro-entitlement-policy.md)
- One Lambda's behavior: that package's `README.md`, then the matching `infra/*.tf`
