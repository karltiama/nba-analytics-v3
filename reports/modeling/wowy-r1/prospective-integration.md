# Prospective WOWY collection (independent of shadow scoring)

Do not activate this package in the current task. Frozen PTS C / REB C, shadow schedules, and other ingestion families stay unchanged.

BallDontLie `GET /nba/v1/player_injuries` returns **reported injuries**, not a healthy roster. It does not emit `Available`. Court Context must not require a provider status the API does not offer.

## Four states (keep separate)

| State | What it is | WOWY scenario |
| --- | --- | --- |
| Roster membership | Player belongs to a team-night (PGL `team_id` / future slate join). Not an injury label. | Required to associate a teammate to a game. Does not select with vs without. |
| Explicit reported injury status | Provider status on a complete pull: `Out`, `Out For Season`, `Questionable`, `Doubtful`, `Probable`, … | **WITHOUT** only for fresh `Out` / `Out For Season` before cutoff. Questionable / Doubtful / Probable stay **unknown**. |
| Not listed on a complete report | Absent from pull N+1 after a complete pull (stored as `RemovedFromReport` when we record leave-report). | **Unknown.** Not Available. Not WITH. Not WITHOUT. |
| Unknown / stale | No observation before cutoff; observation older than 48h at cutoff; incomplete/failed pull; team_id mismatch; ambiguous team-night. | **Unknown.** Do not fill a zero effect. |

Do not infer Available from report omission. Do not use box-score `"00"` as a pregame observation. Provider status, report membership, freshness, and realized participation stay four different fields.

## What may select a WOWY scenario

- `observed_pregame` **without**: explicit Out / Out For Season, `snapshot_at` (or `observed_at` when present) strictly before T−60, age ≤ 48h, injury `team_id` matches the subject’s team-night, unique Final team-night on that ET date.
- `observed_pregame` **with**: not available from this provider. Leave unknown until a real pregame source exists (e.g. confirmed active list), which BDL injuries is not.
- Hypothetical with/without: user-explicit only, never scored as a backtest.

## Smallest independent collection package (not applied here)

Injuries family only. Shadow scoring stays paused.

1. Remaining access decision: live entitlement probe of `GET /nba/v1/player_injuries` (still UNKNOWN in the shadow deploy package). Do not enable collection until that probe is recorded.
2. Terraform: `injuries_execution_enabled=true` **and** `live_ingestion_enabled=true`. Keep `shadow_execution_enabled`, `odds_execution_enabled`, `player_props_execution_enabled`, `postgame_execution_enabled`, `boxscore_execution_enabled` **false**.
3. Injuries Lambda env: `DATA_MODE=live_api`, `OFFSEASON_MODE=0`, `CRON_DRY_RUN=0`. Leave `BDL_GOAT_SUBSCRIPTION` unset.
4. `COLLECTION_SCHEMA_MODE=optional` until `MIGRATION_context_collection_snapshots.sql` is applied. The migration adds `observed_at`, `source_published_at`, `report_membership`, `game_id` — useful, not a prerequisite for unique team-night joins.
5. Do not apply WOWY index migration or unpause EventBridge shadow.

That package appends injury history only. It does not score frozen C, does not write shadow snapshots, and does not thaw odds/props/postgame.

## Historical 2025 tape

Usable for a **known-Out-only** exploratory subset (see `known-out-subset.json`). Not a reason to skip prospective collection: 2023–24 are empty, WITH is unobservable, and 2025 is already development evidence.
