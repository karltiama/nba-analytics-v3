# BallDontLie roster observations

Primary membership source for Court Context roster continuity. NBA.com snapshots stay in `raw.nba_roster_snapshots` as a historical reference. There is no second schedule.

## Storage

Migration: `db/schemas/MIGRATION_roster_observations.sql`.

- `raw.roster_observation_batches` is one completed collection. `collected_at` is the UTC instant. Two batches on the same UTC date both remain.
- `raw.roster_observation_members` is that batch's player list. One row per BallDontLie player id. `provider_team_id` is the BallDontLie team id. `team_abbreviation` is how a reader finds the current franchise. The lookup joins `raw.teams` to `analytics.teams` on abbreviation and keeps East/West rows on both sides. It does not equate the two numeric ids. On the current 30 franchises those numbers happen to match, including BallDontLie `17` and analytics team `17` for Milwaukee. BallDontLie `42` is the historical Washington Capitols row and is excluded. A missing or duplicate match fails closed.

Update and delete are rejected by append-only triggers. The table owner can still drop a trigger. That is the repair path, not an application write.
- `completeness_scope = response_integrity`. Passing the gate means pagination and coverage checks passed. It does not certify an official roster or game-day availability.
- Incomplete collections are not inserted. A later batch does not delete an earlier one.
- Public, anon, and authenticated have no grants. The server connection writes and reads these tables. Row level security is unchanged.

The migration source is in the repository. It has already been applied in production. Deploying the Matchup application does not run `db/schemas/`, and this file must not be applied again.

## Collection

Command, not a page view and not a schedule:

```bash
npx tsx scripts/roster/collect-bdl-active-rosters.ts --season=2026-27 --dry-run
npx tsx scripts/roster/collect-bdl-active-rosters.ts --season=2026-27 --apply
```

Endpoint: `GET https://api.balldontlie.io/nba/v1/players/active?per_page=100`.

The command uses the shared live limiter. Its own env copy sets `BDL_RATE_LIMIT_MAX_RETRIES=0`, so a 429 stops this collector instead of looping. It does not lower the shared interval and it does not switch the limiter to memory. Default budget is 12 requests. A partial result is not stored.

`--dry-run` writes a local report only. `--apply` is refused when the gate fails. A matching `provider + collected_at` is left as stored. A different membership at that same instant is refused.

## Reader

The scoreboard Matchup loader reads the latest complete batch with `collected_at` before tipoff. It does not mix `raw.nba_roster_snapshots` into the continuity percentages. Historical minutes, field-goal attempts, and free-throw attempts stay in the existing continuity formulas.

## Activation

Apply `db/schemas/MIGRATION_roster_observations.sql` in the Supabase SQL editor as one run. The editor rolls the script back if a statement fails. Do not collect a roster in that same run.

If a statement-by-statement runner stops halfway, and both new tables have zero rows, drop the triggers, the function, and the two tables, then run the file again. After a real observation is stored, do not drop the tables. Fix a bad batch by an authorized follow-up, not by deleting history.

After a schema-only apply, confirm the tables exist, the append-only triggers exist, `anon`, `authenticated`, and `service_role` have no privileges, and the postgres owner can insert and select. The scoreboard Matchup page reads a stored BallDontLie batch when one was collected before tipoff. It does not fall back to `raw.nba_roster_snapshots`.

This release does not add a collector schedule. The stored observation ages in place. Freshness stays 0–7 Eastern calendar days fresh, 8–21 days informative and dated, and 22 or more days stale with continuity percentages hidden. Collecting a later observation so the label stays fresh is a later operational task, not part of the Matchup deploy.
