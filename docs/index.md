# Documentation index

Open the section that matches the task. Do not read this folder top to bottom.

Agent entrypoint: [../AGENTS.md](../AGENTS.md). Map of code and schemas: [architecture.md](./architecture.md).

`notes/` and `reports/` are gitignored. They are not part of this index.

## Current

- [Architecture map](./architecture.md)
- [Testing](./testing.md)
- [Coding standards](./coding-standards.md)
- [Deployment checklist](./deployment-checklist.md)
- [Production security](./production-security.md) — auth, cron, prune, freeze flags
- [Infra / Terraform apply](../infra/README.md) — authoritative for apply and schedules
- [Data seeding guide](./data-seeding-guide.md)
- [Typography roles](./typography.md)
- [Free / Pro entitlement policy](./product/free-pro-entitlement-policy.md)
- [Roster canonical identity](./roster-canonical-identity-design.md)
- [Roster snapshot semantics](./roster-snapshot-semantics.md)
- [Projection ledger activation runbook](./projection-ledger-activation-runbook.md)

## Domain notes (only when the task is that feature)

- [Odds data flow example](./odds-data-flow-example.md)
- [Optimized odds fetching strategy](./optimized-odds-fetching-strategy.md)
- [Player props fetching strategy](./player-props-fetching-strategy.md)
- [Markets schema deployment checklist](./markets-schema-deployment-checklist.md)
- [API comparison: odds vs BallDontLie](./api-comparison-odds-vs-balldontlie.md)

## Historical

Kept for engineering history. Not current authority. CLI snippets here that hardcode `nodejs20.x` are not the app Node pin and are not every Lambda runtime.

- [Lambda deployment guide](./lambda-deployment-guide.md)
- [Odds best practices](./odds-best-practices.md)
- [Odds implementation checklist](./odds-implementation-checklist.md)
- [Odds setup summary](./odds-setup-summary.md)
- [Odds snapshot strategy recommendation](./odds-snapshot-strategy-recommendation.md)
- [Odds snapshot schedule](./odds-snapshot-schedule.md)
- [Odds storage strategy](./odds-storage-strategy.md)
- [Odds API credit analysis](./odds-api-credit-analysis.md)
- [Odds API endpoints](./odds-api-endpoints-detailed.md)
- [Historical odds strategy](./historical-odds-strategy.md)
- [Player props API findings](./player-props-api-findings.md)
- [Player props API calls explained](./player-props-api-calls-explained.md)
- [Team markets vs player props](./team-markets-vs-player-props-explained.md)
- [Schema player-props validation](./schema-player-props-validation.md)
- [Advanced stats for props betting](./advanced-stats-for-props-betting.md)
- [Scraping summary](./SCRAPING_SUMMARY.md)
- [HTML boxscore scraping](./html-boxscore-scraping.md)
- [Live boxscore scraping options](./live-boxscore-scraping-options.md)
- [Live boxscore scraping summary](./live-boxscore-scraping-summary.md)
- [Data filling action plan](./data-filling-action-plan.md)
- [Missing data strategies](./missing-data-strategies.md)
- [Missing team stats root cause](./missing-team-stats-root-cause.md)
- [Script cleanup analysis](./script-cleanup-analysis.md)
- [Team page outline](./team-page-outline.md)

Internal GUI walkthroughs (historical):

- [Lambda creation GUI](./internal/lambda-creation-gui-guide.md)
- [IAM role GUI](./internal/iam-role-gui-guide.md)
- [EventBridge setup](./internal/eventbridge-setup-guide.md)
- [EventBridge CLI setup](./internal/eventbridge-cli-setup.md)
- [EventBridge scheduler diagnosis](./internal/eventbridge-scheduler-diagnosis.md)
- [Supabase connection troubleshooting](./internal/supabase-connection-troubleshooting.md)

Schema essays that disagree on box-score authority are flagged inside the files. Start from [architecture.md](./architecture.md) instead:

- [BBRef architecture](../db/schemas/BBREF_ARCHITECTURE.md)
- [Schema decision](../db/schemas/SCHEMA_DECISION.md)
