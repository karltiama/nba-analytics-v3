# Owls Insight final trial audit (read-only)

Generated: **2026-09-16T22:32:13.518Z** (S3 listing) / report written 2026-09-16.

Provider name in this repository: **Owls Insight** (`owls_insight`), not “Owl Insight”.

This is an inventory of **already stored** artifacts. No Owls API calls, no ingestion, no schema/infrastructure changes, and no new normalization were performed.

Evidence sources:

- Live S3 listing and sample `GetObject` of `s3://nba-analytics-data-260029269390/raw/source=owls_insight/` (19,030 objects, 35,864,516 bytes).
- Local checkpoints under `data/owls-insight/runs/` (2026-09-14 runs).
- Prior coverage reports generated 2026-09-14 from those same archives (checksum-verified then).
- Live Postgres reads of Court Context serving tables (to separate BDL data from Owls).
- Live `/history/coverage` payload archived on 2026-09-14.

---

## Executive answer

Owls data we already possess is **safely raw-archived on S3** for three Court Context seasons (2023–24, 2024–25, 2025–26): historical player props, games identity, closing game odds, and public-betting percents. Raw provider JSON is preserved in gzip envelopes with checksums, request metadata, and empty HTTP 200s labeled `EMPTY_PROVIDER_HISTORY`.

**Normalized Owls rows are not stored in Postgres.** There are no `raw.*` / `analytics.*` Owls tables and no `owls` provider IDs.

The previously reported **~642k-event / ~1,322-game 2025 play archive is BallDontLie, not Owls.** It is still present. Owls has no plays, substitutions, starters, advanced stats, or season-average datasets in storage.

**Do not keep the Owls subscription merely because 2023–26 prop coverage is sparse.** Those gaps are already captured as empty provider responses. Re-fetching them is unlikely to create markets Owl already returned as empty.

**One acquisition pass is still justified before cancellation:**

Owls’ own archived `/history/coverage` payload says NBA player-prop history starts **2022-10-18**. We have **zero** `season=2022` Owls objects. That 2022–23 closing-prop tape is the only high-value, hard-to-replace Owls dataset that is advertised and not yet preserved.

After that pass (or if a capped probe shows 2022–23 is also empty), cancel.

---

## 1. What we searched

Repository surfaces:

- `lib/providers/owls-insight/` (client, archive envelopes, backfill, normalize, probes)
- `scripts/owls-insight/`
- `fixtures/owls-insight/`
- `data/owls-insight/runs/` (gitignored checkpoints)
- `tmp/owls-probe/` (probe dumps)
- `reports/data-infrastructure/owls-*.md|json`
- S3 prefix `raw/source=owls_insight/`
- Postgres: no table/column names containing `owl`

Documented Owls REST paths in `lib/providers/owls-insight/contract.ts`:

| Path | Role | Stored in S3? |
| --- | --- | --- |
| `/api/v1/history/coverage` | Dataset date ranges | **Yes** (1 object) |
| `/api/v1/history/games` | Game identity / snapshot counts | **Yes** (3,962 objects) |
| `/api/v1/history/player-props` | Closing player-prop archive | **Yes** (7,141 objects) |
| `/api/v1/history/closing-odds` | Per-book close ML/spread/total | **Yes** (3,956 objects) |
| `/api/v1/history/public-betting` | Spread/total percents | **Yes** (3,956 objects) |
| `/api/v1/history/props` | Prop **snapshots** (line movement) | **Probe only** (14 empty objects) |
| `/api/v1/history/odds` | Odds snapshot tape | **No** |
| `/api/v1/history/stats` | Historical stats | **No** (path listed; no acquisition script) |

---

## 2. Dataset inventory

Season labels below are Court Context start-years (`2023` = 2023–24). Eligible denominator is `analytics.games` status=Final as frozen 2026-09-14: **1,319 / 1,321 / 1,322**.

### A. Historical player props (`/history/player-props`)

**Possessed.** Raw S3 envelopes. Not loaded into Postgres.

| Season | Final games | POPULATED | EMPTY_PROVIDER_HISTORY | Mapping failed | Rows | Game coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023–24 | 1,319 | 276 | 1,043 | 0 | 79,399 | 20.9% |
| 2024–25 | 1,321 | 324 | 995 | 2 | 230,317 | 24.5% |
| 2025–26 | 1,322 | 82 | 1,237 | 3 | 42,677 | 6.2% |
| **Total** | **3,962** | **682** | **3,275** | **5** | **352,393** | **17.2%** |

Live S3 scan of populated pages (≥1.8 KiB): **350,062 rows**, **515 unique `playerName` values**, **0 provider player IDs**. The ~2.3k row gap vs the 2026-09-14 coverage report is last-page objects smaller than the scan threshold, not missing archives.

**Fields present on live rows (2023 sample, opening night LAL @ DEN):**

`eventId`, `sport`, `playerName`, `propType`, `book`, `gameDate` (midnight UTC), nested `opening{line,overPrice,underPrice,americanPrice}`, nested `closing{line,overPrice,underPrice,americanPrice}`.

**Absent on live rows:** provider player id, per-row snapshot timestamp, sportsbook event timestamps, intermediate snapshots. Envelope `requested_at` is our fetch time (2026-09-14), not market time.

**Books (from stored rows):**

| Season | Books with rows |
| --- | --- |
| 2023–24 | BetMGM, Caesars, DraftKings |
| 2024–25 | ESPN BET only |
| 2025–26 | ESPN BET (62 games) + DraftKings (20 games) |

FanDuel is **not** on this endpoint’s documented book list.

**Markets:**

- 2023–24 populated games: PTS/REB/AST/`threes` plus blocks/steals/turnovers. **PRA/PA/PR/RA = 0 games.**
- 2024–25: combos and milestones appear; PRA/PA/PR/RA on 241 of 324 populated games.
- 2025–26: mixed core + milestones + `basketball_player_prop` + 1st-quarter markets; RA only 27 games.

**Quote completeness (coverage report, checksum-verified 2026-09-14):**

| Season | FULL_TWO_WAY | PARTIAL | Open line | Close line |
| --- | ---: | ---: | ---: | ---: |
| 2023–24 | 79,397 / 79,399 | 2 | ~100% | ~100% |
| 2024–25 | 33,662 / 230,317 | 196,655 | line yes; two-way O/U sparse | same |
| 2025–26 | 5,315 / 42,677 | 37,362 | same pattern as 2024 | same |

**Snapshots / line movement:** this endpoint is a **closing archive with nested opening+closing quotes**, not a time series. Live scan: `snapshotAt` present on **0 / 350,062** rows. Open vs close **can** be compared on FULL_TWO_WAY rows. Intermediate movement **cannot**.

**Empty vs missing:** empty HTTP 200s were archived. Checkpoints record `EMPTY_PROVIDER_HISTORY`. That is **not** proof a sportsbook had no market. We cannot distinguish “no market existed” from “Owls retained no historical record.”

**Earliest/latest game_date in populated scan:** 2023-10-24 → 2026-04-28.

**Usable for Court Context today:** yes, as a **research subset** (especially 2023–24 two-way O/U on 276 games). Not a season-wide sportsbook tape.

### B. Historical game odds (`/history/closing-odds`)

**Possessed.** One close observation per book per game, not a movement tape.

| Season | POPULATED | EMPTY | Mapping failed | Rows | Books |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2023–24 | 1,319 (100%) | 0 | 0 | 2,638 | betmgm + consensus |
| 2024–25 | 1,319 (99.8%) | 0 | 2 | 2,638 | betmgm + consensus |
| 2025–26 | 1,268 (95.9%) | 51 | 3 | 2,517 | betmgm + consensus |

2025–26 May–June playoffs are empty (0/45). Regular season is 1,230/1,231.

**Live row fields:** `eventId`, `sport`, `book`, `source` (`archive-1` / `archive-2`, **not** the documented yahoo/oddsshark/espn enum), `gameDate` (midnight UTC), `moneyline{home,away}`, `spread{home,away,homePrice,awayPrice}`, `total{line,overPrice,underPrice}`.

**No close timestamp.** `gameDate` is not tip time. Line movement **cannot** be reconstructed from this dataset. Documented 28-book list is not what live rows contain (only BetMGM + Owls consensus).

`/history/odds` (the snapshot tape) has **zero stored objects**.

### C. Public betting (`/history/public-betting`)

**Possessed.** One row per mapped game on almost the same footprint as closing odds.

**Live fields only:** `eventId`, `sport`, `homeTeam`, `awayTeam`, `gameDate` (midnight UTC), `spread{homePct,awayPct}`, `total{overPct,underPct}`.

**Not present:** moneyline object, money-share / handle fields, book, `capturedAt`, ticket vs money split. Provider `0` is stored as 0 and is **not** rewritten to missing. These percents are **not** labeled money share in the payload; do not treat them as sharp money.

Capture timing class: **TIMING_UNKNOWN**. Not safe as a pregame model feature.

| Season | POPULATED | All-zero snapshots | Non-zero spread % | Non-zero total % | Money share |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2023–24 | 1,319 | 1,317 | 2 (0.2%) | 2 (0.2%) | 0 |
| 2024–25 | 1,319 | 160 | 1,086 (82.3%) | 638 (48.4%) | 0 |
| 2025–26 | 1,268 | 89 | 1,084 (85.5%) | 667 (52.6%) | 0 |

### D. Advanced stats

**Not an Owls dataset.** `analytics.player_game_advanced` is BDL `advanced_stats_v2` (34,843 / 35,103 / 34,810 rows; 1,319 / 1,321 / 1,322 games). S3 archives live under `raw/source=balldontlie/.../entity=advanced_stats_v2` (trial reports 2026-09-08). Grain: player-game.

Owls `/history/games` sample rows include `playerStats: 0`. No Owls stats archive exists.

### E. Season averages

**Not an Owls dataset.** `analytics.player_season_averages` has 1,785 rows (595/587/603 by season). Role-profile materialize source is `bdl_season_averages_targeted_archive` (2023–2025). These are current/final-style season tables, not intra-season snapshots from Owls.

### F. Starters

**Not an Owls dataset.** `analytics.game_starters`: season **2025 only**, 13,200 rows, 1,320 games, 30 teams, 447 players (BDL lineups; 5+5 certified). S3: `raw/source=balldontlie/league=nba/season=2025/entity=lineups`. 2023–24 starters are not in Postgres.

### G. Plays / play-by-play

**Not Owls.** Previously reported ~642k / ~1,322 is **BDL 2025 Plays**. Verified **today**:

| Check | Value | Source |
| --- | --- | --- |
| `analytics.game_flow` games | **1,322** | Postgres `source='bdl_plays_2025_canonical'` |
| `sum(event_count)` | **642,354** | Postgres |
| S3 objects under `raw/source=balldontlie/league=nba/season=2025/entity=plays/` | **1,334** (1,332 `game_id=` + 2 meta; 10 of those are characterization copies) | Live list |
| S3 bytes | **598,114,275** (~570 MiB) | Live list |
| Owls plays objects | **0** | Live list |

BDL 2025 event types include **82,649 substitutions**. Fields on characterization: `order`, `period`, `period_display`, `clock`, `wallclock`, `team`, `participants`, scores, shot flags.

### H. Substitutions / rotations / WOWY ingredients

Owls play data: **none**, so Owls cannot supply WOWY.

BDL 2025 Plays (already owned):

| Metric | Value |
| --- | --- |
| Games with `rotation_available` | 1,284 / 1,322 (97.1%) |
| Rotation failures | 38 |
| Failure classes | MISSING_PARTICIPANT 27, BOTH_OFF_COURT 5, BOTH_ON_COURT 4, STARTER_ANOMALY 2 |
| Timeline available | 1,319 |
| Stream complete | 1,319 |

**Lineup reconstruction from BDL 2025: possible with cleanup** (~97% of games). Not possible from Owls. Not possible for 2023–24 from this Owls archive. This audit did not build WOWY.

---

## 3. Raw preservation

Every Owls production object uses schema envelopes (`owls_historical_*.v1`) with:

1. Original provider JSON in `payload`
2. Normalized representation: **code exists, not persisted** (`normalizeOwlsArchiveOffline` computes in memory; no Postgres write path)
3. Manifest: per-run checkpoints (`data/owls-insight/runs/owls-2026-09-14-*/checkpoint.json`) plus coverage JSON reports
4. Acquisition timestamp: `requested_at` / `archived_at` / `fetched_at` (all 2026-09-14)
5. Endpoint: `request.path` + `request.query`
6. Request parameters: stored
7. Provider IDs: `eventId` strings like `nba:Team@Team-YYYYMMDD`; player **names only**
8. SHA-256 `checksum` of canonical payload; S3 metadata `checksum` / `archive-schema` / `backfill-run-id`
9. Empty responses: archived (HTTP 200, `row_count` 0 or empty arrays) and classified `EMPTY_PROVIDER_HISTORY`

**No dataset has normalized-only data with discarded raw.** The risk is the opposite: **normalization was never materialized**, so research jobs must read S3 envelopes.

Unknown fields in the provider payload remain inside `payload`. Sample player-prop rows did not include extra undocumented keys beyond the nested open/close quotes.

---

## 4. Physical storage

| Dataset | Local | S3 prefix | Postgres |
| --- | --- | --- | --- |
| Player props | checkpoints + probe JSON | `raw/source=owls_insight/league=nba/season={2023,2024,2025}/entity=historical_player_props/` | none |
| Games | checkpoints | `.../entity=historical_games/` | none (CC games used only as join universe) |
| Closing odds | checkpoints | `.../entity=historical_closing_odds/` | none |
| Public betting | checkpoints | `.../entity=historical_public_betting/` | none |
| Prop snapshots (probe) | `tmp/owls-probe/history-props-probe.json` | `.../entity=historical_prop_snapshots/` (14 objects) | none |
| Coverage | fixture JSON (synthetic) + live archive | `.../season=all/entity=historical_coverage/` | none |
| Reports | `reports/data-infrastructure/owls-*.md|json` | — | — |
| Fixtures | `fixtures/owls-insight/` | `source=owls_insight_fixture/` **0 objects** | — |
| BDL plays (not Owls) | trial reports | `raw/source=balldontlie/league=nba/season=2025/entity=plays/` | `analytics.game_flow` compact flags only |

Bucket: `nba-analytics-data-260029269390`. Versioned, no expiration (prior ops reports). Fixture prefix is empty on S3.

---

## 5. Coverage matrix

Coverage Quality is derived from **share of Court Context Final games with populated Owls rows** (or, for public betting, share with non-zero percents). “Complete” means ≥99% populated objects of that product, even if field richness is limited.

| Dataset | 2022–23 | 2023–24 | 2024–25 | 2025–26 | Raw preserved | Normalized | Coverage quality |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Player props | **not captured** (coverage claims 2022-10-18 start) | sparse (20.9% games; 3-book two-way) | sparse (24.5%; ESPN BET; mostly PARTIAL) | sparse (6.2%; Oct–Nov + April cluster) | **yes** | code only | sparse overall |
| Game closing odds | not captured | complete (100%; 2 books; no timestamps) | near-complete (99.8%) | near-complete RS, sparse late playoffs (95.9%) | **yes** | no | near-complete close quotes; **no movement** |
| Public betting | not captured | objects complete, usable % sparse (0.2%) | near-complete objects; spread % partial | same; May–Jun empty | **yes** | no | 2023 sparse / 2024–25 partial |
| Prop snapshots | — | probe empty (4 games) | probe empty | probe empty | empty probes yes | no | unknown beyond 4-game opening=true probe |
| Advanced stats | BDL, not Owls | BDL | BDL | BDL | BDL S3 | BDL serving | n/a (not Owls) |
| Season averages | — | BDL | BDL | BDL | BDL S3 | BDL serving | n/a |
| Starters | — | none | none | BDL 1,320/1,322 | BDL S3 | `analytics.game_starters` | n/a |
| Plays | — | none | none | BDL 1,322 / 642,354 | BDL S3 | compact `game_flow` | n/a |
| Substitutions | — | none | none | BDL; 1,284/1,322 rotation_ok | BDL S3 | derived flags | n/a |

---

## 6. Replacement difficulty

Compared to the forward stack (BallDontLie + Basketball-Reference + our own future collectors):

### HIGH (Owls-specific historical tape)

- Historical player-prop open/close quotes (2023–26 subset already stored; **2022–23 not stored**). Our own `analytics.player_prop_history` only covers **2026-03-09 → 2026-03-17**, 38 games.
- Historical closing game odds for 2023–25. Our `analytics.game_odds_history` starts **2026-01-25**. Basketball-Reference does not replace sportsbook closes.
- Public-betting percents (even with unknown timing / no money share). No BDL equivalent in this repo.

### MEDIUM

- `/history/props` or `/history/odds` **if** they actually contain snapshots. Four-game opening=true probe of DK/MGM/Caesars was empty, including a game that **has** closing player-props. FanDuel/Pinnacle were not tried. Not proven to exist.
- Play-by-play / substitutions / starters / advanced: **already replaced by BDL** for 2025 (plays/starters) and 2023–25 (advanced). Do not spend Owls trial quota here.

### LOW

- Schedules, scores, box scores, season averages: BDL + BBRef already in `analytics.*` / `public.bbref_*`.

---

## 7. Gap analysis

### Already safely captured

- 2023–25 `/history/player-props` **for every Final game we asked about**, including empty responses.
- 2023–25 `/history/games` identity pages (3,962).
- 2023–25 `/history/closing-odds` (3,956 units; 2023 100%, 2024 99.8%, 2025 95.9%).
- 2023–25 `/history/public-betting` (same footprint).
- Live `/history/coverage` payload (2026-09-14).
- Raw envelopes + checksums + checkpoints.

### Captured but incomplete

| Gap | Detail |
| --- | --- |
| Player-prop game coverage | 82.8% of Final games are EMPTY_PROVIDER_HISTORY |
| 2025–26 props | Dec 2025–Mar 2026 almost entirely empty (one January game) |
| 2023–24 combos | PRA/PA/PR/RA absent |
| 2024–25 books | ESPN BET only; 85% PARTIAL quotes |
| Player IDs | names only; mapping is fuzzy |
| Prop timestamps | none on rows; cannot reconstruct intra-day movement |
| Closing odds books | BetMGM + consensus only, not 28 documented books |
| Closing odds timestamps | midnight `gameDate` only |
| 2025 playoff closes | May–June EMPTY |
| Public betting 2023 | 1,317/1,319 all-zero |
| Public betting fields | no money %, no ML, no capture time |
| `/history/props` | 14 empty probe objects; DK/MGM/Caesars opening=true not found |

### Not captured (referenced in code/docs, no stored data)

- **2022–23 player props** (coverage: NBA `playerProps.earliest=2022-10-18`).
- `/history/odds` snapshot tape.
- `/history/stats`.
- Owls plays / substitutions / starters / advanced / season averages (no acquisition implementation except a stats path constant).
- FanDuel (and other `/history/props` books) snapshot tape.

### Worth acquiring before cancellation

#### P0 — acquire before trial expires

1. **2022–23 `/history/player-props`** for Court Context Final games in that season, using the existing backfill (same envelope/checksum path). Owl’s archived coverage says this range exists. We have none of it. It is the same irreplaceable closing-prop product we already valued. Re-fetching 2023–25 empties is **not** P0.

#### P1 — valuable but not essential

1. **Capped `/history/props` existence check** on one 2023 populated game (e.g. 2023-12-25 LAL vs BOS) for **FanDuel and Pinnacle** (valid snapshot books never tried). If empty, stop. If populated, archive only that game under the existing snapshot envelope; do **not** fan out a season crawl without a new quota cap. DK/MGM/Caesars opening=true already failed on this control.
2. **Capped `/history/odds` existence check** on the same game. `oddsSnapshots: 0` on the 2023-10-24 games row; treat as likely empty.

#### P2 — replaceable / do not spend trial time

- Re-requesting EMPTY_PROVIDER_HISTORY player-prop games from 2023–26.
- Re-requesting 2025 May–June closing odds.
- Owls plays/starters/advanced/stats (BDL already has the research tape).
- Public-betting re-pulls (2023 zeros are already archived).
- Keeping the subscription to “wait for” denser 2025–26 props.

---

## 8. Special focus: historical player props

**How much do we actually have?** 352,393 stored rows across 682 populated Final games (17.2% of 3,962). 3,275 games have archived empty responses.

**Seasons:** 2023–24, 2024–25, 2025–26 only. Coverage claims 2022–23 exists; we did not pull it.

**Games:** 276 + 324 + 82 populated. Strongest months: 2023-10, 2024-03/04, 2025-03/04, 2025-10. Playoffs 2023 almost empty (12/82).

**Sportsbooks:** DK / BetMGM / Caesars (2023); ESPN BET (2024); ESPN BET + some DK (2025). No FanDuel on this endpoint.

**Markets:** core O/U in 2023; combos/milestones dominate 2024–25.

**Prices/juice:** yes on 2023 two-way rows (`overPrice`/`underPrice`). 2024–25 often `americanPrice` on a single side without full O/U.

**Timestamps:** game date midnight UTC only. No snapshot time.

**Open / close:** reconstructable on FULL_TWO_WAY rows (essentially all of 2023–24 populated; ~15% of 2024 rows; ~12% of 2025 rows). Not as a timestamped path.

**Line movement:** **no.** One opening quote + one closing quote at most.

**Empty responses preserved?** **Yes.**

**No-market vs no-record?** **Cannot distinguish.**

**Projection vs sportsbook vs actual?**

**Only on the populated subset, and only where quotes are two-way.**

- 2023–24: **yes, with selection bias** — 276 games, 404 player names in the populated scan, PTS/REB/AST/3PM, three books, open+close+prices. Actuals join via name mapping to `analytics.player_game_logs` (no Owls player id).
- 2024–25: **weak** — ESPN BET, PARTIAL quotes, combos/milestones. Restrict to FULL_TWO_WAY if used at all.
- 2025–26: **too sparse** for season-level comparison (82 games, clustered).

Our live BDL prop history (38 games in March 2026) does **not** replace this tape.

---

## 9. Special focus: WOWY inputs

Owls archive **does not** contain substitutions, play sequencing, period/clock, or lineup events.

WOWY ingredients we **do** have are **BDL 2025 Plays + BDL 2025 starters**, not Owls:

| Ingredient | Owls | BDL 2025 |
| --- | --- | --- |
| Substitutions | no | 82,649 events |
| Play order | no | `order` certified unique/monotonic in the 2026-09-09 archive report |
| Period | no | `period` / `period_display` |
| Game clock | no | `clock` |
| Starters | no | 1,320/1,322 certified 5+5 |
| Player/team ids | names on props only | BDL ids on plays |
| Event ordering | n/a | present |

**Lineup reconstruction:** **not possible from Owls.** **Possible with cleanup from BDL 2025** (1,284/1,322 `rotation_available`). Blockers on the remaining 38 games: missing participant, both-on/both-off, starter anomaly. 2023–24 WOWY from this Owls trial: **not possible**.

---

## 10. Integrity notes

- 2026-09-14 player-prop reporter: expected units 11,103, missing 0, checksum mismatches 0.
- Live 2026-09-16 listing: 7,141 player-prop objects + 3,962 games + 1 coverage = 11,104 under those prefixes (matches the old `s3Storage.objects: 11104` figure).
- Closing odds and public betting object counts still **exactly 3,956** each.
- No Owls writes occurred during this audit.

---

## Verification checklist

1. Confirm `reports/operations/owl-final-trial-audit.md` and `.json` match the S3 totals (19,030 objects).
2. Spot-check one gzip envelope in S3 for `payload` + `checksum` + `request.path`.
3. Confirm Postgres still has **no** `owl*` tables.
4. Confirm BDL plays prefix still lists ~1,334 objects if WOWY planning depends on it.
5. If doing a last Owls pull, run **only** the 2022–23 player-prop backfill (existing scripts), not a new endpoint family.
6. Do not set `OWLS_API_KEY` after cancellation; trial access ends immediately per their Terms §6.3 (see `owls-insight-retention-question.md`).
7. Retention of the S3 tape after cancel is **not** granted in the public Terms; that is a separate legal question, not a data-coverage question.
