# GOAT 48-hour trial — final post-acquisition closeout (Step 10)

Generated: 2026-09-09T23:07:22.396Z

**This audit supersedes Step 9A** because targeted 2023–2025 Season Averages and full 2025 Plays were acquired afterward.

**This step: 0 BALLDONTLIE HTTP. 2022 not started. No possessions. No WOWY. No serving tables. Production not thawed. Configuration not mutated.**

Machine-readable: `reports/trial/goat-final-closeout.json`  
S3 snapshot: `reports/trial/goat-final-closeout-s3-snapshot.json`

## Safety State

- `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`
- Season pin **2025**
- Production frozen
- BDL HTTP this step: **0**
- Acquisition lock not required / not active
- Postgres **342,846,611 bytes / 326.96 MB** (matches expected)
- No Plays serving table
- No possessions table
- No WOWY table
- No Advanced serving table
- No lineup serving table
- No Season Averages GOAT serving table
- No opening-market serving tables
- Legacy `raw.season_averages` exists and is empty (0 rows); not a GOAT serving table
- Material difference vs expected: **none**

## Trial Timing

| | |
| --- | ---: |
| Trial start | 2026-09-08T12:10:59.422Z |
| Current | 2026-09-09T23:07:22.396Z |
| Elapsed | **34.94 h** |
| Remaining of 48 h | **13.06 h** |
| Protected reserve | **6 h** |
| Usable after reserve | **7.06 h** |

Unused trial time is **not** a reason to acquire more data.

## Core History

No serving drift vs the expected table.

### 2023

| Metric | Expected | Actual | Drift |
| --- | ---: | ---: | --- |
| games | 1,319 | 1,319 | no |
| player logs | 46,090 | 46,090 | no |
| team stats | 2,638 | 2,638 | no |
| player averages | 595 | 595 | no |
| team averages | 30 | 30 | no |
| inferred stints | 695 | 695 | no |
| raw.player_game_stats | 0 | 0 | no |
| quality flags | 10 | 10 | no |

### 2024

| Metric | Expected | Actual | Drift |
| --- | ---: | ---: | --- |
| games | 1,321 | 1,321 | no |
| player logs | 46,150 | 46,150 | no |
| team stats | 2,642 | 2,642 | no |
| player averages | 587 | 587 | no |
| team averages | 30 | 30 | no |
| inferred stints | 699 | 699 | no |
| raw.player_game_stats | 0 | 0 | no |

### 2025

| Metric | Expected | Actual | Drift |
| --- | ---: | ---: | --- |
| authoritative BDL Finals | 1,322 | 1,322 | no |
| local `analytics.games` | 1,323 | 1,323 (includes `21681993`) | no |
| player logs | 46,056 | 46,056 | no |
| team stats | 2,644 | 2,644 | no |
| `18447793` | LAC 109 / SAC 118 | LAC 109 / SAC 118 | no |

**Drift: none. Classification: COMPLETE.**

## Quality Registry

Exactly **10** `BDL_PLAYER_POINTS_SCORE_MISMATCH` rows remain (`status=fail`, `severity=error`). They are game-specific 2023 records, not a generic ignore:

`1038319`, `1038322`, `1038342`, `1038362`, `1038379`, `1038433`, `1038439`, `1038453`, `1038491`, `1038504`

Newer archives keep **reason-specific** exclusions. Do not merge these into one generic flag.

### Lineup starter anomalies (2)

- `18447931`
- `18447988`

### Plays rotation reconstruction failures (36)

`18446876`, `18446886`, `18446930`, `18446957`, `18446964`, `18446979`, `18446994`, `18447007`, `18447009`, `18447019`, `18447074`, `18447087`, `18447330`, `18447390`, `18447432`, `18447480`, `18447498`, `18447684`, `18447700`, `18447720`, `18447721`, `18447738`, `18447741`, `18447742`, `18447743`, `18447752`, `18447761`, `18447799`, `18447802`, `18447817`, `18447827`, `18447831`, `18447844`, `18447908`, `18447928`, `18448017`

Classes: **27 `MISSING_PARTICIPANT`**, **5 `BOTH_OFF_COURT`**, **4 `BOTH_ON_COURT`**. Do not repair.

### Plays score mismatches (20)

`18446874`, `18446876`, `18446885`, `18446886`, `18446941`, `18447009`, `18447024`, `18447157`, `18447188`, `18447236`, `18447292`, `18447388`, `18447389`, `18447390`, `18447432`, `18447741`, `18447742`, `18447470`, `18447953`, `21709227`

## Advanced Stats

S3-only. No serving table.

| Season | Records |
| ---: | ---: |
| 2023 | 34,843 |
| 2024 | 35,103 |
| 2025 | 34,810 |
| **Combined** | **104,756** |

Preserved limitations: `switches_on` dead/zero; `matchup_minutes` null; tracking variability; low-possession outliers; Advanced-only key `1038324|273`.

## Markets

### Player props

- 129 games
- 44,127 opening rows
- 27,491 deterministic Open→Close matches
- product-grade matched subset **24,412**
- terminology: **3-Hour Pre-Tip**
- v1 books: BetMGM, FanDuel, DraftKings, Caesars
- v1 markets: points, rebounds, assists, threes, points_rebounds, points_assists, PRA
- meaningful movement **~31.8%**

### Game odds

- certified window **Mar 9–22, 2026**
- 107 games / 1,179 rows / 965 sportsbook rows
- 945 Open→Close matches / **97.9%**
- terminology: **Opening Snapshot**
- March 23 coverage cliff preserved

## Lineups

- 1,322 games / 28,833 records
- 1,320 / 1,322 valid 5+5
- reliability **99.85% / EXCELLENT**
- quality exclusions: `18447931`, `18447988`

Certified: historical starters, listed non-starters.

Not certified: active roster, DNP, inactive, five-man units, WOWY.

## Season Averages

Targeted archive only. Not a broad dump. No general/advanced duplicate archive.

**Player:** isolation, PnR ball handler, roll man, drives, passing, by_zone  
**Team:** isolation, possessions, by_zone_opponent  
**Seasons:** 2023, 2024, 2025

- 7,888 records / **~8.78 MB** canonical
- S3 prefix including characterization **~8.89 MB**
- manifests present
- **Role Profile / Matchup Profile enrichment**

Preserved: season-grain limitation; qualification-limited playtype coverage; `gp` is not necessarily season GP.

## Plays

Canonical archive:

- games **1,322**
- events **642,354**
- duplicates **0**
- event-order gaps **0**
- zero-result games **0**
- S3 canonical **~566.1 MB**; full prefix **570.41 MB** (includes 10 characterization objects + manifest/run)

Score quality: exact final-score reconciliation **1,302 / 1,322** (20 mismatches).

Starter eligibility: **1,320**.

Rotation reconstruction: successful **1,284** / failed **36** / reliability **97.27% / GOOD**.

Do not repair failures.

## WOWY Pre-Possession Eligibility

WOWY was **not** calculated. No serving table. Conceptual gate only.

A game may enter future possession/WOWY research only if:

1. authoritative game exists
2. lineup archive has valid 5+5 starters
3. Plays score quality is acceptable for the intended analysis
4. rotation reconstruction succeeds
5. all player/team identities map
6. possession reconstruction later passes its own validation

Gate 5 currently passes (579/579 participants mapped; 0 unknown teams). Gate 6 is not implemented and is **not** counted below.

| Gate | Games / 1,322 | Notes |
| --- | ---: | --- |
| **Strict** (valid starters + successful rotation + exact Plays final-score) | **1,271 (96.14%)** | excludes 2 starter anomalies, 36 rotation failures, and 13 additional exact-score mismatches that still reconstructed |
| **Rotation-only** (valid starters + successful rotation) | **1,284 (97.13%)** | matches 97.27% of the 1,320 starter-eligible games |

## WOWY Readiness Statement

Use this wording in future roadmap/docs:

- **Data acquisition:** Complete.
- **Rotation reconstruction:** GOOD / usable with exclusions.
- **Possession segmentation:** Not implemented.
- **Possession validation:** Not implemented.
- **Production WOWY:** Not ready.
- **Research WOWY potential:** High.

## Product Readiness

### Historical Explorer

Sufficient **raw/serving** data now exists for:

- 3-season game/player history — **compact Postgres serving ready**
- actual starters — **raw 2025 lineup archive ready; serving model still required**
- advanced profiles — **raw 3-season S3 archive ready; compact serving still required**
- season role/play-style — **targeted Season Averages ready; compact serving still required**
- 2025 game timelines — **raw Plays archive ready; serving/read model still required**

### Market Movement

Product-ready to build (not built this step):

- **P1:** 3-Hour Pre-Tip → Close; Market Consensus; Opening Snapshot → Close
- **P2:** Line Shopping; Book Movement
- **Later:** Market + Context

### Role / Opportunity / WOWY

| Surface | Status |
| --- | --- |
| **Role** | Now supported by starter signal + Advanced Stats + Season Averages playtype/tracking/zone profile |
| **Opportunity** | Still blocked by robust injury-as-of state and game-level role redistribution methodology |
| **WOWY** | Still blocked by possession engine + validation |

## Final S3 Inventory

| | Bytes | MB | Objects |
| --- | ---: | ---: | ---: |
| Pre-trial | 561,953,620 | 535.9 | 897 |
| Step 9A (pre-Plays) | 1,337,635,097 | 1,275.67 | 4,594 |
| **Current** | **1,945,070,856** | **1,854.96 (1.81 GB)** | **6,072** |
| Trial added | 1,383,117,236 | 1,319.06 | 5,175 |
| Post-9A add (SA + Plays prefixes) | 607,435,759 | 579.29 | 1,478 |

Largest prefixes:

| Prefix | MB | Objects |
| --- | ---: | ---: |
| **plays 2025** | **570.41** | 1,334 |
| player_props_raw_v2 2025 | 337.30 | 27 |
| Advanced 2024 | 173.58 | 355 |
| Advanced 2023 | 172.33 | 351 |
| Advanced 2025 | 172.08 | 351 |

Plays is now one of the largest raw datasets (~566 MB canonical / ~570 MB prefix). Storage remains **operationally reasonable** at **1.81 GB**.

## Final Postgres State

| | |
| --- | ---: |
| Pre-trial | 303.95 MB |
| Current | **326.96 MB (342,846,611 bytes)** |
| Trial delta | **+23.01 MB** |

Unchanged since 9A despite ~579 MB of additional S3.

**S3 = deep/raw event + historical data. Postgres = compact product-serving analytics.**

## Final API Accounting

Approximate. Interrupted/resumed lineups and certify re-runs prevent exact combined wall-clock. Precision is not fabricated.

| Objective | HTTP | Hours | 429s |
| --- | ---: | ---: | ---: |
| Step 9A baseline (through lineups) | ~3,585 | see 9A | 2 |
| Season Averages characterization (9B) | 16 | ~0.06 | 0 |
| Season Averages targeted archive (9C) | 126 | 0.47 | 0 |
| Plays characterization (9D) | 10 | 0.04 | 0 |
| Plays full archive (9E) | 1,134 | 4.36 | 0 |

**Approx total trial provider requests: ~4,871.**

## Dataset Scorecard

| Dataset | Archived | Serving | Quality | Unique value | Next action |
| --- | --- | --- | --- | --- | --- |
| core history | yes | compact Postgres | COMPLETE; 10 2023 flags; `21681993` local-only | 3-season Explorer foundation | Wire Explorer |
| Advanced Stats | yes | no | 104,756; S3-only; known field/identity limits | Role Check raw history | Compact serving design |
| injuries | yes | current + history | density insufficient for causal absence | as-of research input | injury-as-of model |
| opening props | yes | no | 129/129; 24,412 product-grade | 3-Hour Pre-Tip | Market Movement serving + UI |
| opening game odds | yes | no | 107/107; 97.9%; March 23 cliff | Opening Snapshot | P1 Snapshot → Close |
| lineups | yes | no | 1320/1322 EXCELLENT; 2 starter anomalies | historical starters | Starter serving |
| Season Averages | targeted yes | no | 7,888 / 8.78 MB; season grain | Role / Matchup Profile | Compact serving with Advanced |
| Plays | yes | no | 1,322 / 642,354; 97.27% GOOD rotation | 2025 timelines + rotation research | Timeline read model; later possessions |

## Deliberately Skipped Acquisition

These were skipped **on purpose**, not left incomplete:

- **2022 core history** — 2023–2025 plus 2025 event/starter/market archives already cover current needs. Cold depth would not unblock Role, Market Movement, Explorer, or WOWY.
- **Broad Season Averages dump** — only characterized unique signals were valuable.
- **Unsupported Season Average categories** — general/advanced would duplicate existing archives; untested types were excluded by allowlist.
- **Season-wide opening game odds after the coverage cliff** — March 23+ degradation would falsify Opening Snapshot.
- **Arbitrary BetRivers prop variants** — simultaneous variants break deterministic Open→Close. v1 is four books / seven markets.

## Deliberately Deferred Engineering

Post-trial product/analytics work. Not trial failures:

- Advanced serving tables
- lineup serving tables
- Plays serving tables
- possession engine
- WOWY
- Opportunity model
- market-context model

## GOAT Subscription Assessment

Previous: `REASSESS_AT_LIVE_ACTIVATION`  
**Revised: still `REASSESS_AT_LIVE_ACTIVATION`.** Subscription not changed.

**Historical acquisition:** now largely complete. `DOWNGRADE_AFTER_ARCHIVE` is viable if remaining work is serving/UI on captured S3.

**Ongoing 2026–27 need:**

| Dataset | Live-season GOAT justification |
| --- | --- |
| live/pre-tip props | **HIGH** — cannot reconstruct later |
| opening odds | **HIGH** inside a working sportsbook-open window; not season-wide after the cliff |
| Advanced Stats | useful if Role Check ships live |
| lineups | useful if daily starters are productized |
| Plays | useful if timelines ship; expensive; not required until possession/WOWY |
| Season Averages | periodic/batch; season grain |

`KEEP_GOAT_DURING_SEASON` if live/pre-tip props and/or working Opening Snapshot coverage are productized. Reassess at live activation.

## 2022 Decision

**`SKIP_2022`**

Nothing discovered after Step 9A changes that conclusion. Do not execute.

## Post-Trial Engineering Roadmap

Evidence-adjusted order (Role is no longer blocked by injury-as-of):

1. **Market Movement serving + UI** — P1 data complete
2. **Historical Explorer multi-season** — serving already in Postgres; 2025 timelines later via Plays read model
3. **Advanced / Season Average compact serving design** — combined Role/Matchup enrichment; do not dump raw pages
4. **Starter serving representation** — flag `18447931` / `18447988`
5. **Role Check** — data-ready from starter + Advanced + Season Averages
6. **injury-as-of model** — blocks Opportunity, not Role
7. **Opportunity Check**
8. **possession engine**
9. **WOWY validation** — apply pre-possession gates, then possession validation
10. **Market + Context**

No implementation in this step.

## Irreplaceable Data Check

Canonical S3 objects, manifests, counts, coverage/scope metadata, quality limitations, reports, and known anomalies are present for every GOAT-derived archive of this trial.

Documented non-critical notes (same class as 9A, plus new archives now complete):

- No 2025 season-wide BDL `games` / `player_stats` `_manifest.json` (repair slice + Postgres serving remain certified)
- Advanced identity key `1038324|273` is in this closeout, not S3 manifests

**`NO_CRITICAL_FIXES`**

## Final Trial Verdict

**`STRONG_SUCCESS`**

All core and high-value acquisitions are archived with quality gates. Remaining work is post-trial serving/product/analytics. Skipping 2022 is intentional.

## Acquisition Decision

**`END_GOAT_ACQUISITION`**

Everything valuable enough for this trial has been captured. 2022 does not count as a remaining critical acquisition.
