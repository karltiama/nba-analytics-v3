# Player-prop market archive — audit and design (no production change)

Run: 2026-09-14T01:20:00Z (recovery probe). **Nothing in this document was implemented.** Live prune retention stays 3 days until explicitly approved.

This is Track B of the Court Context work: prevent losing raw player-prop market history again. It is independent of the expected-minutes projection experiment.

## B1 — Current ingestion (end to end)

```
BDL GET /v2/odds/player_props?game_id=<bdlGameId>
        ↓
EventBridge Scheduler nba-player-props-*  →  Lambda controller
        ↓ SQS PLAYER_PROPS_QUEUE_URL
Lambda worker  (lambda/player-props-snapshot/worker.ts)
        ↓
raw.player_prop_snapshots_v2          (working tape; hourly unique)
raw.player_prop_pull_runs / game_runs (run metadata; rows_stored kept)
        ↓
analytics.player_props_current        (multi-book latest board)
analytics.player_prop_current         (preferred vendor, default DraftKings)
        ↓
Daily Vercel cron GET /api/cron/prune-props
        ↓
materialize last pregame OVER/UNDER → research.prop_decision_lines
        ↓
archive-gate: S3 batch dump of whatever is STILL in Postgres
        ↓
DELETE raw snapshots older than 3 days (if gate passes)
DELETE analytics.player_props_current for aged games
```

| Piece | Location |
| --- | --- |
| Source | BallDontLie `GET https://api.balldontlie.io/v2/odds/player_props` (`lambda/player-props-snapshot/src/fetch.ts`) |
| Controller | `lambda/player-props-snapshot/controller.ts` — discover games for ET date, create pull/game runs, enqueue SQS |
| Worker | `lambda/player-props-snapshot/worker.ts` — fetch, normalize, insert raw, upsert current |
| Schedule | `infra/lambda.tf` `aws_scheduler_schedule.player_props_crons` / `player_props_rate`; default `rate(30 minutes)` or explicit crons. State follows freeze flags (`local.player_props_schedule_state`). Currently intended DISABLED in offseason freeze. |
| Raw table | `raw.player_prop_snapshots_v2` (`db/schemas/raw_player_prop_snapshots_v2.sql`) |
| Hourly collapse | `db/schemas/MIGRATION_player_props_v2_hourly_retention.sql` — unique on `(game, player, book, prop, side, line, hour)` `ON CONFLICT DO NOTHING` |
| Current boards | `analytics.player_props_current`, `analytics.player_prop_current` |
| Research last-pregame | `research.prop_decision_lines` via `lib/prune/closing-lines.ts` `materializeClosingLines` |
| Prune job | `lib/prune/run-prune-props.ts`, CLI `scripts/prune-player-prop-snapshots-v2.ts`, cron `app/api/cron/prune-props/route.ts` + `vercel.json` daily 13:00 UTC |
| Retention | `RETENTION_DAYS = 3` in `lib/prune/closing-lines.ts` |
| S3 dump (batch, not live append) | `scripts/archive/archive-existing-season-to-s3.ts` + entity `player_props_raw_v2` in `scripts/archive/entity-registry.ts` |
| S3 prefix used | `raw/source=existing_ingestion/league=nba/season=2025/entity=player_props_raw_v2` |
| Opening-only archive | `scripts/archive/backfill-opening-player-props.ts` → `raw/source=balldontlie/.../entity=opening_player_props` |
| Worker S3 writes | **None.** Terraform docs: these Lambdas have no S3 IAM. |
| Raw JSON payload | `STORE_PROP_RAW_JSON` default false; sample rate default 0 |

`raw.player_prop_game_runs` still shows **3,658 game-runs**, **5,896,727 `rows_stored`**, 2026-03-25 → 2026-05-02. That is evidence of ingest, not retained tape.

## B8 — Where history is lost (exact points)

1. **Intra-hour collapse (before prune).** Hourly unique index drops later snapshots in the same UTC hour for the same line key. Line movement inside an hour is not stored.
2. **Postgres 3-day prune.** `deleteRawEligibleBatches` deletes `raw.player_prop_snapshots_v2` where `fetched_at` is older than 3 days, after materializing only the **latest pregame row per (game, player, book, prop, side)** into `research.prop_decision_lines`. Multi-snapshot tape is not copied there.
3. **Archive is a point-in-time dump of remaining Postgres rows**, not an append-only write from the worker. If prune already deleted March, August's dump cannot resurrect it.
4. **S3 is not versioned.** `GetBucketVersioning` = unset. Deleted or overwritten objects cannot be undeleted via versions/Glacier.
5. **Current boards overwrite.** `analytics.player_props_current` upserts; `player_prop_current` is preferred-vendor latest only.

Likely 2025–26 sequence:

- In-season ingest filled `raw.player_prop_snapshots_v2`.
- Raw prune was often **blocked** until an S3 success manifest existed (`archive-gate.ts`), so a late-season window could accumulate.
- 2026-08-31: `archive-existing` dumped remaining rows (fetched_at 2026-04-02 … 2026-05-02, 26 date files + manifest, 337.3 MB).
- Subsequent prune emptied Postgres raw (now ~0 rows).
- March 25–April 1 ingest is **not** in that dump (already gone, or never partitioned).

## B2 / B3 — Proposed durable archive (do not implement yet)

Preferred flow:

```
BDL snapshot
  → raw working table (short Postgres window)
  → current / analytics boards
  → S3 append-only archive  (same write path as the worker, before prune can run)
  → research loader when needed
```

**Object grain:** one gzip JSON (or JSONL) **per (pull_run_id, game_id)** containing every normalized prop row from that fetch. Not one object per prop row. Not one giant season file.

Suggested path:

```
raw/source=balldontlie/league=nba/season={startYear}/entity=player_prop_snapshots/
  game_date={YYYY-MM-DD}/
  game_id={analyticsGameId}/
  snapshot_at={ISO-compact}Z__pull={pullRunId}.json.gz
```

Plus a daily manifest:

```
.../entity=player_prop_snapshots/_manifest/dt={YYYY-MM-DD}.json
```

Why this partition:

- Game-level retrieval is a prefix list of a few dozen objects.
- Date-range research is `game_date=` prefixes.
- ~15 games × ~20 snapshots/game-day × ~180 days ≈ **54k objects/season**, acceptable.
- Opening captures stay in the existing `entity=opening_player_props` prefix (already 136 objects / 16.8 MB for 2025).

Payload fields (minimum): `game_id`, `player_id`, `player_name`, `team`, `opponent` if known, `prop_type`, `line`, `side`, `price/odds`, `sportsbook`, `snapshot_at`, `game_start_time`, `source=balldontlie`, `ingestion_run_id`, plus original `raw_json` when `STORE_PROP_RAW_JSON=true` (recommend `true` at 100% for archive objects even if Postgres still samples).

## B4 — Postgres vs S3 policy (recommend, do not apply)

| Store | Keep | Do not use as the tape |
| --- | --- | --- |
| **Postgres raw** | 14–30 days working window for serving, movement, and closing-line materialize | Indefinite multi-million-row tape |
| **Postgres current** | Latest board for upcoming/in-progress games only | History |
| **Postgres research** | `prop_decision_lines` (last pregame per book), derived movement summaries | Full snapshot tape |
| **S3** | All raw snapshots **indefinitely** (IA/Glacier after 90 days optional) | Anything the prune job can delete |

Do not prune Postgres raw unless `archived_rows >= rows_stored` for that `pull_run_id` **and** S3 `HeadObject` succeeds for that game snapshot key.

## B5 — 2026–27 snapshot cadence (recommend)

Controller already runs as a **slate poller**, not a per-game closer. Use that:

| Window | Cadence | Why |
| --- | --- | --- |
| Lines first appear / opening | Dedicated opening fetch (existing BDL opening endpoint) once per game | Opening archive |
| Until 6h before tip | Every **60 minutes** | Cheap movement |
| 6h–3h | Every **30 minutes** | Matches current default scheduler |
| 3h–1h | Every **15 minutes** | Late steam |
| 1h–15m | Every **15 minutes** | Pregame |
| Last successful pull with `snapshot_at < start_time` | Mark as `latest_pre_tip` in the manifest | Decision line |
| After tip | Do not write to the research tape (or prefix `post_tip/` separately) | Avoid contamination |

Do not rely on “3h + close” only (`analytics.player_prop_market_movement` already proved that is too thin).

Hourly unique in Postgres can remain for the **working** table. S3 objects are per pull and keep intra-hour movement if the scheduler fires twice in one hour.

## B6 — Integrity checks / alerts

Emit from the worker (CloudWatch + a daily SQL/S3 recon):

- `rows_fetched`, `rows_stored`, `rows_archived`, `games_archived`, `books_present`
- `min(snapshot_at)`, `max(snapshot_at)`
- `latest_snapshot_before_tip` present (bool per game)
- `post_tip_count`
- `duplicate_snapshot_count` (same pull_run + game)
- `archive_object_count`

**Page if:** `rows_stored > 0 AND rows_archived == 0` for any successful game-run.

**Block prune if:** any eligible raw `pull_run_id` lacks a complete S3 object + manifest entry.

Daily recon: `sum(game_runs.rows_stored)` for yesterday vs S3 object row counts from manifests. Gap → alert, not silent prune.

## B7 — Recovery (report only, no restore)

| Location | Result |
| --- | --- |
| S3 `.../source=existing_ingestion/.../entity=player_props_raw_v2` | **Still present:** 27 objects, 337.3 MB, fetched_at dates 2026-04-02–05-02 (gaps 04-11, 04-13–16). Written 2026-08-31. Do not delete. |
| S3 `.../source=balldontlie/.../entity=player_props_raw_v2` | Empty (wrong prefix vs the batch dumper) |
| S3 opening props 2025 | **Present:** 136 objects, 16.84 MB |
| S3 `player_props_current` dump | 1 JSONL + manifest, 52.3 MB, 2026-08-31 (latest board, not tape) |
| Bucket versioning / Glacier | **Off.** `versionId=null`. No undelete. |
| Opening 2023 / 2024 prefixes | Empty |
| Postgres raw v2 | Effectively empty vs 5.90M historically stored |
| `research.prop_decision_lines` | Last-pregame only, Apr 3–May 2 2026, 129 games |
| `analytics.player_prop_history` | Thin Mar 9–17 snapshot window (prior inventory) |
| Git LFS / repo artifacts | No prop tape. Lambda zips only. |
| GitHub Actions artifacts | None found via `gh` in this pass |
| Supabase PITR | Not confirmed here. Even if enabled, a 7-day window cannot reach Mar–May 2026 from Sep 2026. A retained physical backup from May 2026 would be the only DB path — check the dashboard; do not restore automatically. |

**May still be loadable for research:** the 337 MB April dump + opening-props files + decision lines. **Cannot reconstruct** a season-long 2023–25 or full Mar 2026 intra-game tape from what remains.

## Files that would need changes (not done)

- `lambda/player-props-snapshot/worker.ts` — archive to S3 before/with DB write
- `lambda/player-props-snapshot/src/bulk-writers.ts` — `rows_archived` on game runs
- `lambda/player-props-snapshot/src/env.ts` — bucket/prefix flags
- `infra/lambda.tf` — S3 IAM for the worker (currently none)
- `lib/prune/run-prune-props.ts` / `archive-gate.ts` / `closing-lines.ts` — per-snapshot gate; retention only after approval
- `scripts/archive/entity-registry.ts` — new append entity (do not reuse `existing_ingestion` batch dump as the tape)
- New: archive writer + daily recon + CloudWatch alarm
- `db/schemas/raw_player_prop_game_runs.sql` — `rows_archived` column

Production prune behavior must not change until this list is reviewed.
