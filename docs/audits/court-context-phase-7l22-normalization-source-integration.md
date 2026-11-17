# Court Context Phase 7L.22 — Normalization source integration

Local source preparation only. No push, pull request, merge, deploy, migration, or production change.

## Verdict

**GO to request a separate pull request.**

**NO-GO** to push, open that pull request, merge, deploy the writer, apply Terraform, activate a schedule, or run the migration against production.

## Commits

| Role | SHA | Notes |
|---|---|---|
| Source recovered | `b205480c90929483839eb1dc6f5e86b69dff3d27` | Parent `84b8a34b6370e4407954ef8259a718896d143367`. Karl Tiama, 2026-11-15 19:19:41 -0500. Subject: `feat(db): prepare lossless player-game-stats normalization`. |
| Destination base | `a2e26dd0d6e9fd8145a708ecaad42329f6648f23` | `origin/master` after `git fetch origin master`. Merge of PR #70. |
| Integration commit | `d8ca48cade578364804344cacf0f81ee552c7abf` | Branch `chore/player-game-stats-normalization-7l22`. Worktree `C:\Users\tiama\Desktop\Coding\nba-analytics-v3-7l22`. No upstream. |
| Left out | `84b8a34b6370e4407954ef8259a718896d143367` | Collector-health commit. Not applied. |

The nine integration files are byte-identical to the same paths in `b205480`. `git diff d8ca48c origin/master` is those nine files: 751 insertions, 55 deletions.

PR #71 (`fix/self-hosted-fonts-7l19`) was open, mergeable, and clean against `a2e26dd` at the start of this phase. It is not part of this branch.

## Baseline left untouched

Main checkout `C:\Users\tiama\Desktop\Coding\nba-analytics-v3` is still `fix/ops-collector-health` at `067540bcadbbb4ed899bfbe387bc2f5bec1a98f8`, tracking `origin/fix/ops-collector-health`, ahead 3. Its uncommitted paths were not staged, reset, or edited. That includes the uncommitted season-boundary files `lambda/nightly-bdl-updater/raw-stat-season-boundary.ts` and its test.

## Isolated source changes

1. `db/schemas/MIGRATION_player_game_stats_documents.sql` — Stage A schema.
2. `lambda/nightly-bdl-updater/player-game-stat-documents.ts` — flag selector.
3. `lambda/nightly-bdl-updater/index.ts` — nightly write and the recovery `rawStat` getter call the selector. Quarter-scoring imports and `period-scores.ts` stay.
4. `lambda/nightly-bdl-updater/tsconfig.json` — adds `player-game-stat-documents.ts` after `period-scores.ts`.
5. `scripts/ingestion/materialize-goat-stats-3game-postgres.ts` — insert and delete go through the selector. Reads of `raw.player_game_stats` stay.
6. `scripts/seed-raw-balldontlie.ts` — seed upsert uses the same selector.
7. Three tests: flag unit test, disposable delete test, disposable Stage A test.

Not included: collector health, Terraform, season-boundary edits, font files, and experimental props or prune work. `infra/lambda.tf` still pins `nightly_bdl_certified_code_sha256` to `mSJRZCHC0OmR4O7kx++30+gF7Y1GslxWcFABHSfmBBA=`, ignores `filename` and `source_code_hash`, and sets `PGS_NORMALIZED_STORAGE = "1"` last in the nightly environment merge. Cherry-pick had no conflicts.

## Schema compatibility

The committed SQL describes the normalized objects production already has:

- `raw.player_game_stat_document`
- `raw.player_game_stats_row`
- `raw.upsert_player_game_stat_document`
- `raw.upsert_player_game_stat`, which inserts into `raw.player_game_stats_row`
- `raw.player_game_stats_resolved`, with the comment that writers do not insert through it

It is Stage A. It creates those objects beside a heap named `raw.player_game_stats`. `raw.copy_player_game_stats_documents()` locks and reads that heap. This file does not create the compatibility view that production now serves under the name `raw.player_game_stats`, and it does not drop the old heap.

A disposable PostgreSQL 17.9 cluster on `127.0.0.1:55444` restored only `raw.player_game_stats` from `D:\court-context-backups\cc-pg-logical-20261114T191459Z\postgres.backup`, then applied the Stage A file. The copy returned **50,754** stat rows and **2,525** documents, with **0** mismatches. A second copy kept the same counts. Distinct values were 969 players, 60 teams, and 1,496 games. Deleting a referenced document failed on the foreign-key restrict. Those row counts match the already-normalized production contract. This was not a production connection, and it does not authorize a fresh production migration.

Running this file against production is unnecessary and unsafe: the tables and function already exist, and `LOCK TABLE raw.player_game_stats` does not apply to the compatibility view.

## Writer behavior

`PGS_NORMALIZED_STORAGE=1` selects `select raw.upsert_player_game_stat(...)` and `delete from raw.player_game_stats_row where game_id = $1`.

Any other value, including unset, selects the legacy insert into `raw.player_game_stats` and `delete from raw.player_game_stats where game_id = $1`. That default is intentional for a legacy heap. On the current production database that name is a view, so the default-off statements are not a writable production path. The deployed writer has the flag set to `1`.

The goat materializer uses the same selector. With the flag on, its delete targets `raw.player_game_stats_row`. It does not insert through `raw.player_game_stats_resolved` or through the compatibility view.

`DATA_MODE`, `OFFSEASON_MODE`, `CRON_DRY_RUN`, and `requireLiveIngestionSeasonStartYear` remain in `index.ts`. The recovery disposable test still commits one box and does not touch the 2025 season. The uncommitted season-boundary module is not in this commit.

## Tests

Node 24.22.3 from the portable install. `npm ci` added 749 packages in the isolated worktree.

| Check | Result |
|---|---|
| `player-game-stat-documents.test.ts` | 2 passed |
| `recovery-controls.test.ts` | 42 passed |
| `tsc -p lambda/nightly-bdl-updater/tsconfig.json --noEmit` | exit 0 |
| `player-game-stat-delete.pg.test.ts` on `127.0.0.1:55446` | 3 passed |
| `recovery-postgres.test.ts` on `127.0.0.1:55443` | 5 passed |
| `player-game-stat-documents.pg.test.ts` on `127.0.0.1:55444` | 4 passed |

The delete test showed a flag-off delete removing a legacy-heap row while leaving `raw.player_game_stats_row` in place, and a flag-on write landing only on `raw.player_game_stats_row`.

## Lambda reproducibility

Git source and the deployed binary are different artifacts. This commit records the selector the certified writer uses. A fresh build from `d8ca48c` or from `origin/master` does **not** reproduce CodeSha256 `mSJRZCHC0OmR4O7kx++30+gF7Y1GslxWcFABHSfmBBA=`. This base also contains quarter-scoring commits that are not in that ZIP. No Lambda package was built or uploaded. The Terraform live-hash guard was not edited.

## Remaining source drift

- The compatibility-view DDL, the heap rename, and the heap drop are not in Git. Production already has that end state.
- Season-boundary protection beyond `requireLiveIngestionSeasonStartYear` remains uncommitted in the collector-health checkout.
- Collector health remains only on `84b8a34` and PR #61.
- Building or deploying this branch would not recreate the certified ZIP.

## Proposed pull request

Do not open it until a later phase authorizes the push.

**Title:** `feat(db): record the normalized player-game-stats writer`

**Body:**

```
## Summary
- Records the player-game-stats normalization source from b205480 onto current master as d8ca48cade578364804344cacf0f81ee552c7abf.
- PGS_NORMALIZED_STORAGE=1 calls raw.upsert_player_game_stat and deletes from raw.player_game_stats_row. Any other value keeps the legacy heap statements.
- The Stage A SQL documents the tables and function production already has. It must not be executed against production. raw.player_game_stats is already the compatibility view.

## Test plan
- [ ] Flag unit test: off and exactly 1
- [ ] Disposable Postgres delete test
- [ ] Disposable Postgres recovery test, including the 2025 skip
- [ ] Disposable Stage A copy: 50,754 rows, 2,525 documents, 0 mismatches
- [ ] Lambda tsc --noEmit
- [ ] No production DDL, Lambda deploy, Terraform apply, or schedule change
- [ ] Do not treat a build of this branch as the certified writer ZIP
```

## Production confirmation

No production DDL or DML. No Lambda invoke, code update, or configuration change. No Terraform apply. No schedule activation. No S3 write. No Vercel deployment. No ingestion or backfill. No Supabase upgrade. No Neon migration. No local web server. The twelve writer schedules were not read or changed in this phase. The certified backup object was not modified.
