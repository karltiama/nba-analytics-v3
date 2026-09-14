# Owls `/history/public-betting` full coverage

Generated: 2026-09-14T23:13:32.315Z

# Live Contract

- Endpoint: `GET /api/v1/history/public-betting`
- Wrapper: `{ success, data: { betting, pagination:{total,limit,offset,hasMore} } }`
- Row shape: one betting[] row per event: eventId, sport, homeTeam, awayTeam, gameDate, spread{homePct,awayPct}, total{overPct,underPct}
- Docs mention bet % and money % by side. Live rows expose a single ticket-style percent per spread/total side. No moneyline object, no money-share fields, no book, no capturedAt.
- Request cost: 1 request/game at limit=100; pagination.hasMore=false on probes

# Capture-Time Semantics

- Class: **TIMING_UNKNOWN**
- Owls midnight UTC game identity, not a public-betting capture timestamp
- NOT SAFE AS A TIME-SPECIFIC MODEL FEATURE

EMPTY_PROVIDER_HISTORY means Owls returned HTTP 200 with no betting[] rows. It is not proof that no public betting market existed. Provider 0 is preserved and is not rewritten to missing. All-zero snapshots are POPULATED, not empty.

# 2023–24 Coverage

- Games eligible (Court Context Final): **1319**
- Games mapped to Owls eventId: **1319**
- POPULATED: **1319** (100.0%)
- EMPTY_PROVIDER_HISTORY: **0**
- GAME_MAPPING_FAILED: **0**
- REQUEST_FAILED: **0**
- ARCHIVE_FAILED: **0**
- Rows: **1319**
- All-zero snapshots (provider 0 on every present side): **1317**
- Joinable to closing-odds POPULATED games: **1319**
- Percentage completeness (non-zero spread %): **2 / 1319 (0.2%)**
- Percentage completeness (non-zero total %): **2 / 1319 (0.2%)**

# 2024–25 Coverage

- Games eligible (Court Context Final): **1321**
- Games mapped to Owls eventId: **1319**
- POPULATED: **1319** (99.8%)
- EMPTY_PROVIDER_HISTORY: **0**
- GAME_MAPPING_FAILED: **2**
- REQUEST_FAILED: **0**
- ARCHIVE_FAILED: **0**
- Rows: **1319**
- All-zero snapshots (provider 0 on every present side): **160**
- Joinable to closing-odds POPULATED games: **1319**
- Percentage completeness (non-zero spread %): **1086 / 1319 (82.3%)**
- Percentage completeness (non-zero total %): **638 / 1319 (48.4%)**

# 2025–26 Coverage

- Games eligible (Court Context Final): **1322**
- Games mapped to Owls eventId: **1319**
- POPULATED: **1268** (95.9%)
- EMPTY_PROVIDER_HISTORY: **51**
- GAME_MAPPING_FAILED: **3**
- REQUEST_FAILED: **0**
- ARCHIVE_FAILED: **0**
- Rows: **1267**
- All-zero snapshots (provider 0 on every present side): **89**
- Joinable to closing-odds POPULATED games: **1268**
- Percentage completeness (non-zero spread %): **1084 / 1268 (85.5%)**
- Percentage completeness (non-zero total %): **667 / 1268 (52.6%)**
- Extracted betting rows vs populated games: **1267 / 1268** (one POPULATED game did not yield an extractable betting[] row in the reporter pass)

# Coverage by Market

| Season | populated | ML object | spread object | spread non-zero | total object | total non-zero | money share |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2023 | 1319 | 0 | 1319 | 2 | 1319 | 2 | 0 |
| 2024 | 1319 | 0 | 1319 | 1086 | 1319 | 638 | 0 |
| 2025 | 1268 | 0 | 1267 | 1084 | 1267 | 667 | 0 |

# Coverage by Game Type

| Season | phase | games | populated | empty | rows | coverage |
|---|---|---:|---:|---:|---:|---:|
| 2023 | regular | 1231 | 1231 | 0 | 1231 | 100.0% |
| 2023 | play_in | 6 | 6 | 0 | 6 | 100.0% |
| 2023 | playoff | 82 | 82 | 0 | 82 | 100.0% |
| 2024 | regular | 1231 | 1231 | 0 | 1231 | 100.0% |
| 2024 | play_in | 6 | 6 | 0 | 6 | 100.0% |
| 2024 | playoff | 84 | 82 | 0 | 82 | 97.6% |
| 2025 | regular | 1231 | 1230 | 1 | 1229 | 99.9% |
| 2025 | play_in | 6 | 6 | 0 | 6 | 100.0% |
| 2025 | playoff | 85 | 32 | 50 | 32 | 37.6% |

# Coverage by Month

## Season 2023

| Month | games | populated | EMPTY_PROVIDER_HISTORY | all-zero | rows | coverage |
|---|---:|---:|---:|---:|---:|---:|
| 2023-10 | 52 | 52 | 0 | 50 | 52 | 100.0% |
| 2023-11 | 212 | 212 | 0 | 212 | 212 | 100.0% |
| 2023-12 | 212 | 212 | 0 | 212 | 212 | 100.0% |
| 2024-01 | 226 | 226 | 0 | 226 | 226 | 100.0% |
| 2024-02 | 176 | 176 | 0 | 176 | 176 | 100.0% |
| 2024-03 | 237 | 237 | 0 | 237 | 237 | 100.0% |
| 2024-04 | 156 | 156 | 0 | 156 | 156 | 100.0% |
| 2024-05 | 43 | 43 | 0 | 43 | 43 | 100.0% |
| 2024-06 | 5 | 5 | 0 | 5 | 5 | 100.0% |

## Season 2024

| Month | games | populated | EMPTY_PROVIDER_HISTORY | all-zero | rows | coverage |
|---|---:|---:|---:|---:|---:|---:|
| 2024-10 | 67 | 67 | 0 | 1 | 67 | 100.0% |
| 2024-11 | 222 | 222 | 0 | 51 | 222 | 100.0% |
| 2024-12 | 192 | 192 | 0 | 12 | 192 | 100.0% |
| 2025-01 | 224 | 224 | 0 | 3 | 224 | 100.0% |
| 2025-02 | 173 | 173 | 0 | 48 | 173 | 100.0% |
| 2025-03 | 245 | 245 | 0 | 12 | 245 | 100.0% |
| 2025-04 | 151 | 151 | 0 | 1 | 151 | 100.0% |
| 2025-05 | 39 | 37 | 0 | 24 | 37 | 94.9% |
| 2025-06 | 8 | 8 | 0 | 8 | 8 | 100.0% |

## Season 2025

| Month | games | populated | EMPTY_PROVIDER_HISTORY | all-zero | rows | coverage |
|---|---:|---:|---:|---:|---:|---:|
| 2025-10 | 75 | 75 | 0 | 1 | 75 | 100.0% |
| 2025-11 | 221 | 221 | 0 | 9 | 221 | 100.0% |
| 2025-12 | 196 | 196 | 0 | 23 | 196 | 100.0% |
| 2026-01 | 233 | 233 | 0 | 29 | 233 | 100.0% |
| 2026-02 | 168 | 168 | 0 | 27 | 167 | 100.0% |
| 2026-03 | 237 | 237 | 0 | 0 | 237 | 100.0% |
| 2026-04 | 147 | 138 | 8 | 0 | 138 | 93.9% |
| 2026-05 | 40 | 0 | 38 | 0 | 0 | 0.0% |
| 2026-06 | 5 | 0 | 5 | 0 | 0 | 0.0% |

# Ticket vs Money Fields

Live rows do not expose a money-share field. ticket_money_gap cannot be computed from this archive.

Do not interpret any single-side percent as sharp money or as a fade-the-public signal.

# Joinability With Closing Odds

- Join key: Court Context game_id / Owls eventId
- spread home/away and total over/under can be aligned to historical_closing_odds nested sides. moneyline is not present on live public-betting rows.
- No destructive merge was performed.

# Leakage / Timing Warning

Capture timing is **TIMING_UNKNOWN**. `gameDate` is not an as-of timestamp. Do not use these percentages as pregame model features until a capture time is established.

# Archive Integrity

- Expected units: **3956**
- Actual units: **3956**
- Missing: **0**
- Checksum mismatches: **0**
- Incomplete games: **0**
- Failed pages: **0**
- OK: **true**

# API Usage

- Requests: **3956**
- 429: **0**
- 503: **0**
- Last remaining-month header: **280868**
- Runtime (checkpoint elapsed): **1154582 ms**

# Storage

- Objects: **3956**
- Compressed bytes: **5345405**
- Season 2023: 1319 objects, 1779342 bytes
- Season 2024: 1319 objects, 1786260 bytes
- Season 2025: 1318 objects, 1779803 bytes

# Research Usability

- SAFE_FOR_DESCRIPTIVE_RESEARCH: **YES**
- SAFE_FOR_PREGAME_MODEL_FEATURES: **NO**
- money share != sharp money
- public majority != bad side
- unknown timing can create leakage
- missing provider history != no public betting market
- provider 0 != proven absence of public betting

