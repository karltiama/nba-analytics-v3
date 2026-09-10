# Lineups characterization (Step 8A)

Generated: 2026-09-09T03:44:18.452Z (analysis refresh after S3 re-read)

**YELLOW — lineup data useful but overlap/semantics need review**

Product value: **MEDIUM_VALUE_CONSIDER**

Do not launch the full-season lineup archive. Do not start 2022.

Machine-readable: `reports/trial/lineups-characterization.json`

## Safety State

- `BDL_TRIAL_MODE=1`; delay **13,000 ms** (trial-default); min observed spacing **13,484 ms**
- concurrency 1
- acquisition lock acquired for the 25-request fetch, then released
- `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`, season pin 2025
- Postgres **342,846,611 bytes / 326.96 MB** before and after
- No lineup serving table (`to_regclass` empty)
- Characterization script writes S3 only (same Postgres-free archive helper as the prepared lineup job)
- Full-season `backfill-lineups-2025.ts` was **not** executed

## Sample Selection

25 games from the 1,322 BDL 2025 inventory (excluded local-only `21681993`).

| Phase | n | Dates | Context |
| --- | ---: | --- | --- |
| Early RS | 5 | 2025-10-21 → 11-15 | opening night HOU@OKC through DEN@MIN |
| Midseason | 5 | 2026-01-05 → 01-25 | complete box logs |
| Late RS | 5 | 2026-04-02 → 04-12 | all in `prop_decision_lines` |
| Early playoffs | 5 | 2026-04-19 → 04-30 | first round |
| Later postseason | 5 | 2026-05-15 → 05-19 | ECF / WCF window |

## Acquisition Result

- 25 / 25 games with data
- 0 zero-result games
- Prefix: `raw/source=balldontlie/league=nba/season=2025/entity=lineups/_characterization_25game/`
- No canonical full-season `_manifest.json`
- Wall clock **329.9 s (~5.5 min)**

## Request / Rate-Limit Result

- HTTP attempts **25**; successes **25**
- 429s **0**; retries **0**
- Spacing min/avg/max: 13,484 / 13,718 / 15,889 ms

## Record Grain

Not five-man stint units. One row = one player listed for a game/team.

Fields: `id`, `game_id`, `starter`, `position`, nested `player`, nested `team`. No status, period, timestamp, or unit id.

Natural unique key: **`(game_id, team_id, player_id)`** (also unique on provider `id` and on `(game_id, player_id)` in this sample).

Mean **23.5** records/game (588 total). 250 starters / 338 non-starters.

## Team Object / Type Audit

Every record has a top-level `team` (`id`, `abbreviation`, `city`, `conference`, `division`, `full_name`, `name`). All 588 match the game’s home or away team.

`player.team_id` disagrees with `team.id` on **162 / 588** records — treat `player.team_id` as a possibly stale/current roster team, not the game team.

**TypeScript is incomplete:** `BdlLineupEntry` in `lib/balldontlie/lineups.ts` omits `team`. No production type change in this step.

## Player Identity Compatibility

314 unique lineup players. **314 mapped** to `analytics.players` by provider id. 0 unmapped. 0 conflicts. No name guessing.

## Player-Game Log Comparison

| Direction | Match | Only-side |
| --- | ---: | ---: |
| Lineup → logs | 563 (95.7%) | 25 lineup-only (4.3%) |
| Logs → lineup | 563 (67.5%) | 271 log-only (32.5%) |

Lineup-only: all 25 are `starter=false` with no box log — **not** classified as DNP without extra evidence.

Log-only: mostly box rows with `minutes=00` (DNP on the stats feed) that the lineup endpoint **omits**. Lineups are not a full roster/availability census.

## Starter Reliability

- Team-games: 50
- Exactly 5 starters: **50 / 50**
- Fewer / more / duplicates / null: **0**
- Valid 5+5 games: **25 / 25**

Starter designation is highly reliable in this sample.

## Starter agreement with existing information

**We do not have a trustworthy stored starter flag.** `analytics.player_game_logs` has minutes only. Live matchup analysis *projects* usual starters from recent minutes. Lineup `starter=true` is new information.

## Bench Semantics

`starter=false` is mixed:

- 310 entered the game (positive minutes in logs)
- 25 have no log
- 3 have zero minutes in logs

It is **not** “active bench only” and **not** “full roster.”

## Availability Semantics

Supported: `starter=true` vs `starter=false`.

Not supported from provider fields: active bench vs active DNP vs inactive vs absent-from-roster. No status/active/inactive field.

## Starter Replacement Examples

Usable injury-backed case:

- **2026-04-08 ATL @ CLE** — Darius Garland injury status **Out** near tip; not in box logs; **Dean Wade** listed starter. Descriptive only, not causal.

Other minutes-proxy examples (Harden on CLE, Garland on LAC) are **weak** — `player_game_logs.team_id` can disagree with the game team, so “usual starter for this team” is not a clean local proxy. Do not productize those.

## Unique Information Added

Adds: actual per-game starter five, which logs/stints/injuries/Advanced Stats/markets do not store.

Does not add: full availability roster, inactive vs DNP, five-man units, WOWY on/off from this endpoint alone.

## Role / Opportunity / WOWY Assessment

| Use case | Rating |
| --- | --- |
| Role Check (explicit starter) | **strong** |
| Opportunity Check (who started instead) | moderate (needs injury/context join; proxy alone is noisy) |
| WOWY | **weak** |
| Injury context (unavailable vs DNP) | **weak** |
| Historical Explorer (show starters) | **strong** |

## Full-Season Request / Time / S3 Estimate

For **1,322** games, from this sample:

- Requests: **1,322** (one page per game observed)
- API time: **~4.77 hours** at 13s spacing
- Records: **~31,093**
- S3: **~13.4 MB**
- Likely zeros: **0**

## Utility Per API Hour

| Option | Hours | Unique value |
| --- | --- | --- |
| Full 2025 lineups | ~4.77 | Reliable starter flags; weak availability |
| 2022 core S3 | ~1.8–2 | Fourth season of box data (pattern already proven) |
| Preserve reserve | 0 | Final-audit / unexpected repair |

**Do not launch lineups now.** Starter info is real but narrow. Availability/WOWY do not justify spending the remaining usable window on a 5-hour crawl before the 6-hour reserve.

## Product Value Classification

**MEDIUM_VALUE_CONSIDER**

## Updated Trial Time Budget

- Characterization API cost: **0.092 h** (25 HTTP)
- Elapsed ~**15.67 h**; remaining ~**32.33 h**; usable after 6h reserve ~**26.33 h**
- Estimated full lineups: **4.77 h**
- Optional 2022: **1.8–2 h**
- Keep **6-hour** final-audit reserve

## Postgres Unchanged Confirmation

**342,846,611 bytes → unchanged.** Core serving unchanged. Advanced Stats S3-only. Market-data serving unchanged. No lineup table created.
