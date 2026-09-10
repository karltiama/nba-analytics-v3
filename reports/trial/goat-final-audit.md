# GOAT 48-hour trial — final audit (Step 9A)

Generated: 2026-09-09T13:12:00.000Z

**This step: 0 BALLDONTLIE HTTP. 2022 not started. No serving tables created. Production not thawed.**

Machine-readable: `reports/trial/goat-final-audit.json`

## Safety State

- `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`
- Season pin **2025**
- Production frozen
- BDL HTTP this step: **0**
- Acquisition lock not required / not active
- Postgres **342,846,611 bytes / 326.96 MB** (matches expected)
- No Advanced Stats serving table
- No lineup serving table
- No opening-props serving table
- No opening-game-odds serving table
- Material difference vs expected: **none**

## Trial Timing

| | |
| --- | ---: |
| Trial start | 2026-09-08T12:10:59.422Z |
| Current | 2026-09-09T13:12:00.000Z |
| Elapsed | **25.017 h** |
| Remaining of 48 h | **22.983 h** |
| Protected reserve | **6 h** |
| Usable after reserve | **16.983 h** |

Do not consume provider requests merely because time remains.

## Core Historical Audit

No serving drift vs the expected table.

### 2023

| Metric | Expected | Actual |
| --- | ---: | ---: |
| games | 1,319 | 1,319 |
| player logs | 46,090 | 46,090 |
| team stats | 2,638 | 2,638 |
| player averages | 595 | 595 |
| team averages | 30 | 30 |
| inferred stints | 695 | 695 |
| raw.player_game_stats | 0 | 0 |
| quality flags | 10 | 10 |

### 2024

| Metric | Expected | Actual |
| --- | ---: | ---: |
| games | 1,321 | 1,321 |
| player logs | 46,150 | 46,150 |
| team stats | 2,642 | 2,642 |
| player averages | 587 | 587 |
| team averages | 30 | 30 |
| inferred stints | 699 | 699 |
| raw.player_game_stats | 0 | 0 |

### 2025

| Metric | Expected | Actual |
| --- | ---: | ---: |
| authoritative BDL Finals | 1,322 | 1,322 |
| local `analytics.games` | 1,323 | 1,323 (includes `21681993`) |
| player logs | 46,056 | 46,056 |
| team stats | 2,644 | 2,644 |
| `18447793` | LAC 109 / SAC 118 | LAC 109 / SAC 118 |
| raw.player_game_stats | 46,056 | 46,056 |

Observed, not in the expected list: player averages **603**, stints **698**.

### 2026

| Metric | Expected | Actual |
| --- | ---: | ---: |
| games | 1,200 | 1,200 |
| logs | 0 | 0 |
| team stats | 0 | 0 |
| stints | 578 | 578 |

**Classification: COMPLETE**

## Quality Audit

Exactly **10** rows:

- `check_name=BDL_PLAYER_POINTS_SCORE_MISMATCH`
- `status=fail`
- `severity=error`

IDs (match the approved 2023 allowlist; none extra, none missing):

`1038319`, `1038322`, `1038342`, `1038362`, `1038379`, `1038433`, `1038439`, `1038453`, `1038491`, `1038504`

Policy is game-specific. No generic `ignoreScoreMismatch` behavior exists in the ingestion libraries.

**Classification: COMPLETE**

## Advanced Stats Audit

S3 manifests (cursor exhausted, status success):

| Season | Pages | Records | Expected games |
| ---: | ---: | ---: | ---: |
| 2025 | 349 | 34,810 | 1,322 |
| 2024 | 352 | 35,103 | 1,321 |
| 2023 | 349 | 34,843 | 1,319 |
| **Combined** | | **104,756** | |

- No Advanced serving table
- Canonical page sequences present (`page=1…N` plus `_manifest.json` / `_run.json`)
- Identity note `1038324|273` was **not** on S3 manifests; it is recorded here as the known 2023 Advanced-only key
- Known field limitations (from earlier characterization, not re-probed row-by-row this step): `switches_on` dead/zero; `matchup_minutes` null; low-possession extreme rates; tracking fields season-variable
- Local `reports/trial` markdown for 5B/5C/5D is absent; S3 is canonical

**Classification: COMPLETE**

## Player-Props Audit

Canonical 2025 opening-player-props archive:

- target **129** / archived **129** / zero-result **0** / rows **44,127**
- reused 5 characterization objects; **124** provider requests
- completionStatus **success**

Recertified Open→Close (zero-API analysis):

- deterministic matches **27,491**
- all-opening match rate **62.3%**
- eligible match rate **83.5%**
- expected “comparable” **73.4%** is **not** a labeled field in the current analysis JSON
- product-grade matched observations **24,412**

v1 books: BetMGM, FanDuel, DraftKings, Caesars  
v1 markets: points, rebounds, assists, threes, points_rebounds, points_assists, PRA  

Terminology: **3-Hour Pre-Tip** (not true market open, not first print).

Limitations: Betway/BetParx opening gaps; BetRivers simultaneous variants; DD/TD unsupported; scoped coverage.

**Classification: COMPLETE**

## Game-Odds Audit

Window **2026-03-09 → 2026-03-22**

- games **107** / opening rows **1,179** / sportsbook rows **965**
- sportsbook Open→Close **945** / **97.9%**
- zero-result **0**
- **107/107 `MULTIBOOK_SPORTSBOOK`**
- median **9** sportsbook vendors/game
- 20 unmatched rows are Rebet-only closing gaps
- March 23 degradation is embedded in the canonical manifest (`limitationAfterMarch22`)

Terminology: **Opening Snapshot** (not season-wide opening odds, not first market open).

**Classification: COMPLETE**

## Market-Intelligence Audit

Zero-API analysis reproduces:

- product-grade dataset **n=24,412**
- no meaningful movement **68.2%**
- juice only **17.1%**
- line movement **3.2%**
- line + material price **11.5%**
- meaningful movement **31.8%**

No profitability/CLV claims.

P1: 3-Hour Pre-Tip → Close; Market Consensus; Historical Opening Snapshot → Close  
P2: Line Shopping; Book Movement  
Later: Market + Context  

**Classification: STRONG_SUCCESS**

## Lineup Audit

Canonical season-2025 archive:

- target **1,322** / canonical objects **1,322** / records **28,833**
- zero-result **0** / logical duplicates **0**
- team-games **2,644** / exactly 5 **2,642** / anomaly team-games **2**
- valid 5+5 **1,320 / 1,322**
- reliability **99.85% / EXCELLENT**
- anomalies: `18447931` and `18447988`, both team `10` with four starters
- authoritative game-context team: top-level `team.id` (not `player.team_id`)

Certifies starter + listed non-starter. Does **not** certify active roster, inactive, DNP, five-man units, or WOWY possessions. Limitation is in `_manifest.json`.

**Classification: COMPLETE**

## S3 Storage Audit

| | Bytes | MB | Objects |
| --- | ---: | ---: | ---: |
| Pre-trial | 561,953,620 | 535.9 | 897 |
| Current | 1,337,635,097 | **1,275.67** | 4,594 |
| Trial added | 775,681,477 | **739.77** | 3,697 |

Major trial prefixes: Advanced (~518 MB across 2023–2025), 2023/2024 core games+stats (~178 MB), lineups (~24 MB), opening props (~17 MB), targeted game odds (~0.7 MB), 2025 repair stats (~2 MB). Remainder is mostly pre-trial props/odds/injuries.

S3 size remains **operationally reasonable** (~1.28 GB).

## Postgres Storage Audit

| | |
| --- | ---: |
| Pre-trial | 303.95 MB |
| Current | 326.96 MB |
| Trial delta | **+23.01 MB** |
| Headroom to 340 MB | 13.04 MB |
| Headroom to 400 MB | 73.04 MB |
| Headroom to 450 MB | 123.04 MB |

No Advanced / opening-props / opening-odds / lineup raw history was materialized.

**S3 = deep/raw history. Postgres = compact serving.**

## API / Time Accounting

Approximate (lineups was interrupted/resumed):

| Objective | HTTP | Hours | 429s |
| --- | ---: | ---: | ---: |
| 2025 repair 3-game | 3 | ~0.04 | 0 |
| 2025 repair remaining 31 | 31 | ~0.12 | 0 |
| 2024 core | 477 | 1.81 | 1 |
| 2023 core | 476 | 1.80 | 1 |
| 2023 mismatch diagnostics | ~10 | ~0.04 | n/a |
| Advanced 2025 | 349 | 1.34 | 0 |
| Advanced 2024 | 347 (+5 reused pages) | 1.33 | 0 |
| Advanced 2023 | 349 | 1.36 | 0 |
| Opening player props | 124 | ~0.45 | 0 |
| Opening game-odds targeted | 97 | 0.35 | 0 |
| Lineup 8A | 25 | 0.092 | 0 |
| Lineup 8B | 1,297 | ~4.7 + 1.82 resume | 0 |

Approx total HTTP **~3,585**. Notable retries: one 429 on 2024 core and one 429 on 2023 core (Retry-After used; min spacing briefly 567–621 ms during retry).

## Objective Scorecard

| Objective | Status | Result | Product/Engineering Value |
| --------- | ------ | ------ | ------------------------- |
| **MUST: safety** | COMPLETE | Frozen; pin 2025; DB 326.96 MB | Production never thawed |
| **MUST: 2025 repair** | COMPLETE | 34-game GOAT repair; 1,322 finals | Current season serving complete |
| **MUST: 2024 history** | COMPLETE | S3 + serving 1,321/46,150 | Historical Explorer |
| **MUST: 2023 history** | COMPLETE | S3 + serving 1,319/46,090 | Third serving season |
| **MUST: quality policy** | COMPLETE | 10 game-specific flags | No generic ignore |
| **MUST: storage sustainability** | COMPLETE | DB +23 MB; S3 +740 MB | Compact vs deep split holds |
| **HIGH: Advanced Stats** | COMPLETE | 104,756 rows, 3 seasons, S3-only | Role Check raw history |
| **HIGH: opening props** | COMPLETE | 129/129, 44,127 rows | 3-Hour Pre-Tip archive |
| **HIGH: Open→Close** | COMPLETE | 27,491 matches; 24,412 v1 | Market Movement dataset |
| **HIGH: opening game odds** | COMPLETE | 107/107, 97.9% | Opening Snapshot window |
| **HIGH: market intelligence** | STRONG_SUCCESS | 31.8% meaningful move; no CLV | Feature ranking |
| **OPTIONAL: lineups** | COMPLETE | 1,320/1,322 EXCELLENT | Starter history |
| **OPTIONAL: 2022** | NOT_STARTED | Intentionally skipped | Not a trial failure |

## 2022 Recommendation

**SKIP_2022**

Three complete core seasons, three-season Advanced, 2025 lineups, and historical market archives already satisfy current product/research needs. A 1.8–2 hour 2022 S3-only core crawl would add cold depth without unblocking Role Check, Market Movement, or Historical Explorer.

## GOAT Subscription Assessment

**One-time historical acquisition (already captured):** Advanced history, 2025 lineups, historical openings (129-game props + 107-game odds window).

**Recurring live-season value:** opening props (3-Hour Pre-Tip cannot be reconstructed later); opening game odds inside a working sportsbook-open window; Advanced/lineups only if those features ship live.

Preliminary recommendation: **REASSESS_AT_LIVE_ACTIVATION**

Subscription was not changed.

## Product Roadmap Implications

- **Historical Explorer** — supported by three complete serving seasons.
- **Role Check** — Advanced (S3) + reliable 2025 starter signal; serving schema still to design.
- **Opportunity Check** — possible, but injury-as-of / availability semantics still need work.
- **Market Movement** — strongly supported as a scoped surface.
- **Market + Context** — future; not ready.
- **WOWY** — still needs dedicated methodology; lineups are not five-man units.

## Technical Follow-Ups

Do not implement now:

1. Design Advanced Stats serving schema
2. Decide starter serving representation; flag `18447931` / `18447988`
3. Model top-level lineup `team.id` vs `player.team_id`
4. Handle Alex Len Advanced-only key `1038324|273`
5. Formalize market variant policy
6. Model injury as-of state
7. Define market consensus tables/views
8. Wire Historical Explorer to multiple seasons
9. Build Role / Opportunity features
10. Prepare live-season activation / GOAT reassess

## Irreplaceable Data Check

No critical GOAT-only dataset is missing raw objects + manifest + counts + limitation notes.

Documented gaps that are **not** `FIX_BEFORE_TRIAL_EXPIRES`:

- No 2025 season-wide BDL `games` / `player_stats` `_manifest.json` (repair slice is archived; full 2025 serving is Postgres/Step 2D)
- Advanced identity key was missing from S3 manifests (now in this audit)
- No local Advanced 5B/5C/5D markdown under `reports/trial` (S3 `_run.json` exists)
- No `reports/storage/after-2023.json` checkpoint (counts re-queried live)

**FIX_BEFORE_TRIAL_EXPIRES: no**

## Final Trial Verdict

**STRONG_SUCCESS**

All core/high-value objectives achieved. Remaining work is optional/post-trial. Skipping 2022 is intentional, not a gap.

## Remaining Trial-Time Recommendation

Do **not** start 2022. Do **not** start another acquisition. Keep the 6-hour reserve. The ~17 hours of usable remainder is buffer, not a mandate to crawl.
