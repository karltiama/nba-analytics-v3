# Owls final acquisition — 2022–23 player props

Generated: **2026-09-16T23:33:46.416Z** (backfill + S3 verification complete). Snapshot probes completed immediately after.

Provider: **Owls Insight** (`owls_insight`). Endpoint: `GET /api/v1/history/player-props`.

This was the last bounded trial acquisition. Seasons 2023–25 were **not** re-fetched. No public betting, closing odds, stats, plays, starters, or Postgres normalization. No schema/Terraform/AWS changes.

---

## Decision

**Cancel the Owls subscription.**

2022–23 historical player props **were available** and are now raw-archived. That was the only remaining high-value Owls dataset from the 2026-09-16 trial audit. Capped `/history/props` (FanDuel, Pinnacle) and `/history/odds` probes on a known populated 2023 game returned **zero snapshot rows**. There is no further bounded Owls crawl justified before cancellation.

Empty HTTP 200s are `EMPTY_PROVIDER_HISTORY`, not proof that no sportsbook market existed.

---

## Preflight (before Owls calls)

| Item | Value |
| --- | --- |
| Eligible 2022–23 Final games in `analytics.games` | **0** |
| Existing `season=2022` player-prop S3 objects | **0** |
| Existing `season=2022` historical_games S3 objects | **0** |
| Checkpoint `owls-2026-09-16-season-2022` | none |
| Destination prefix | `raw/source=owls_insight/league=nba/season=2022/entity=historical_player_props/` |
| Phase / concurrency | 4 (season) / 2 |

**Assumption (stated in preflight):** Court Context has no 2022 Final rows, so the game universe was loaded from Owls `/history/games` (`season=2022-23`, `gameType=regular|playin|playoff`) and converted in-memory to `CourtContextGame[]`. Acquisition still used `runOwlsPropBackfill` (same mapping, envelope, checksum, checkpoint, `EMPTY_PROVIDER_HISTORY`, retry rules).

After the universe list:

| Item | Value |
| --- | --- |
| Eligible 2022–23 games | **1,321** (regular 1,237 / play-in 0 / playoff 84) |
| Date range | 2022-10-18 → 2023-06-13 |
| Planned requests | 1,321 `/history/games` lookups + ≥1,321 `/history/player-props` pages |
| Expected units (min) | 1,321 games archives + 1,321 player-prop pages |

Owls `playin` returned 0 rows; the extra regular-season count (1,237 vs a 1,230-game 82-game schedule) is consistent with play-in games labeled `regular`. Coverage `playerProps.earliest = 2022-10-18` matches the first game date.

---

## P0 — 2022–23 `/history/player-props`

Run id: `owls-2026-09-16-season-2022`  
Started: 2026-09-16T22:51:20.181Z  
Completed: 2026-09-16T23:31:13.591Z  
Requests: 3,271 attempted / 3,271 successful / 0 retried / 0×429 / 0×503

### Verification from S3 (not process stdout alone)

| Metric | Value |
| --- | ---: |
| Expected / eligible games | 1,321 |
| Successfully mapped (no `GAME_MAPPING_FAILED`) | 1,321 |
| Mapping failures | 0 |
| Populated games | 316 |
| `EMPTY_PROVIDER_HISTORY` games | 1,005 |
| Request failed | 0 |
| Archive failed | 0 |
| Player-prop archive objects | 1,935 |
| Games archive objects | 1,321 |
| Total prop rows | 78,911 |
| Unique player names | 410 |
| Checksum verified pages | 1,935 |
| Checksum failures | 0 |
| Missing expected archive units | 0 |
| Earliest game date | 2022-10-18 |
| Latest game date | 2023-06-13 |
| **populated / eligible** | **316 / 1,321 = 23.9%** |

Checkpoint rematch against the full synthetic universe marked **17** games `AMBIGUOUS` (same teams inside the 18h/calendar window). Per-game `/history/games` resolve still bound each row to its own event id. That is **not** `GAME_MAPPING_FAILED`.

Books: **draftkings**, **betmgm**, **caesars** (same mix as 2023–24; no ESPN BET).

Markets: **rebounds, points, turnovers, assists, steals, blocks, threes**. No combo markets (`pts_rebs_asts`, etc.) on this season’s tape.

| Quote shape | Rows |
| --- | ---: |
| FULL_TWO_WAY | 78,783 |
| PARTIAL | 128 |
| SINGLE_PRICE | 0 |
| MISSING_PRICE | 0 |

Open/close availability:

| Field | Rows with value |
| --- | ---: |
| Opening line | 78,797 |
| Closing line | 78,911 |
| Opening over / under | 78,792 / 78,788 |
| Closing over / under | 78,908 / 78,902 |

Usable two-way quotes: **78,783 FULL_TWO_WAY** (99.8% of archived rows).

S3 objects retain raw payload, request path/query, requested/fetched/archive time, checksum, archive schema, backfill run id, HTTP status / empty state, and provider event id.

---

## Comparison with later seasons

Player-prop object counts for 2023–25 were re-listed after this run and **match the 2026-09-16 audit**. Row / populated / FULL_TWO_WAY figures for those seasons are therefore the current archive values (unchanged). 2022–23 uses this run’s S3 verification.

Eligible games for 2022–23 are the Owls 2022-23 regular/playin/playoff list (Court Context Final = 0). Later seasons use Court Context Final counts.

| Season  | Eligible games | Populated games | Coverage |    Rows | Books             | FULL_TWO_WAY |
| ------- | -------------: | --------------: | -------: | ------: | ----------------- | -----------: |
| 2022–23 |          1,321 |             316 |    23.9% |  78,911 | BetMGM/Caesars/DK |       78,783 |
| 2023–24 |          1,319 |             276 |    20.9% |  79,399 | BetMGM/Caesars/DK |      ~79,397 |
| 2024–25 |          1,321 |             324 |    24.5% | 230,317 | ESPN BET          |       33,662 |
| 2025–26 |          1,322 |              82 |     6.2% |  42,677 | ESPN BET/DK       |        5,315 |

2022–23 looks like 2023–24: DraftKings / BetMGM / Caesars, almost entirely FULL_TWO_WAY open+close, ~24% of games populated. It does **not** look like the ESPN BET-heavy 2024–25 tape.

---

## P1 — capped snapshot existence probes

Control game (already known populated historical player props): **2023-12-25 LAL vs BOS** (`1037995`, eventId `nba:Boston Celtics@Los Angeles Lakers-20231225`).

### `/history/props`

| Book | HTTP | Rows | Archived |
| --- | ---: | ---: | --- |
| FanDuel | 200 | 0 | yes |
| Pinnacle | 200 | 0 | yes |

Both zero → **stopped**. No additional games, books, or season crawl.

Response shape (empty): `{ success, data: { eventId, opening, timeRange, snapshots, count, limit, offset } }`.

### `/history/odds`

Same control game. One page (`limit=1000`). HTTP 200, **0 rows**. Archived under `entity=historical_odds`. Stopped. No additional games. No season backfill.

Response shape (empty): `{ success, data: { eventId, opening, timeRange, snapshots, count, limit, offset, dataQuality } }`.

Do not extrapolate beyond this one game.

---

## Part C — final archival verification

### 2022–23 props

| | |
| --- | ---: |
| S3 objects (player-props) | 1,935 |
| Row count | 78,911 |
| Populated games | 316 |
| Empty games | 1,005 |
| Mapping failures | 0 |
| Checksum errors | 0 |
| Books | draftkings, betmgm, caesars |
| Markets | rebounds, points, turnovers, assists, steals, blocks, threes |
| Usable two-way quotes | 78,783 FULL_TWO_WAY |

### Existing 2023–25 archive

Unchanged except for the new snapshot/odds **probe** objects written under 2023-12-25:

| Dataset | 2023 | 2024 | 2025 | vs 2026-09-16 audit |
| --- | ---: | ---: | ---: | --- |
| `historical_player_props` | 1,968 | 3,467 | 1,706 | unchanged |
| `historical_games` | 1,319 | 1,321 | 1,322 | unchanged |
| `historical_closing_odds` | 1,319 | 1,319 | 1,318 | unchanged |
| `historical_public_betting` | 1,319 | 1,319 | 1,318 | unchanged |

Added this run (not 2023–25 player-prop data):

- 2 empty `/history/props` probe objects (FanDuel, Pinnacle) on 2023-12-25
- 1 empty `/history/odds` probe object on 2023-12-25
- 1,935 player-prop + 1,321 games objects under `season=2022`

### Snapshot probes

- `/history/props`: **empty** (0 rows, 1 game, FanDuel + Pinnacle, opening=true, points)
- `/history/odds`: **empty** (0 rows, 1 game)

---

## What was not done (by design)

- No re-fetch of 2023, 2024, or 2025
- No public betting / closing-odds / stats / plays / starters
- No normalized rows written to Postgres
- No snapshot season backfill
- No commit

Checkpoint remains at `data/owls-insight/runs/owls-2026-09-16-season-2022/` (resumable; run completed).
