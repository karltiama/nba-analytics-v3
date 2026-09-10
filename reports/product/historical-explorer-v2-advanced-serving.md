# Historical Explorer v2 — Step 12D Compact Advanced Serving

**Step verdict:** `GREEN — compact Advanced serving is certified and ready for Historical Explorer UI`

**Date:** 2026-09-10  
**Scope:** certified Advanced archive → `analytics.player_game_advanced` → exact certification → historical Final contract. **No Advanced UI. No Role Profile. No Season Average serving. No Plays/Timeline. Starting Five and Market Movement unchanged.**

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| BDL HTTP | **0** (script does not import `BdlArchiveClient` / live lineups) |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Advanced S3 | **read-only** (`listByPrefix` + `getJson`) |
| New provider acquisition | none |
| Raw Advanced dump into Postgres | none — 12 selected columns only |
| UI implementation | none |
| Role / Timeline / WOWY | none |
| Live ingestion changes | none |
| Starting Five | **13,200 rows unchanged** |
| Market Movement | `analytics.game_odds_history` **63,380** unchanged by this step |

Execute required `--i-understand-production-write`. Permissions: postgres owner grants only; RLS **off**; **no anon grants**.

---

## Advanced Source Certification

Canonical prefix: `raw/source=balldontlie/league=nba/season={YYYY}/entity=advanced_stats_v2` (`page=N.json`). Grain `game.id + player.id`. Period **0** only.

| Season | Archive rows | Games | Players | Notes |
| ---: | ---: | ---: | ---: | --- |
| 2025 | 34,810 | 1,322 | 594 | matches GOAT |
| 2024 | 35,103 | 1,321 | 577 | matches GOAT rows/games |
| 2023 | 34,843 | 1,319 | 586 | matches GOAT |
| **Combined** | **104,756** | **3,962** | | **exact** |

Grain before INSERT: archive rows **104,756** · distinct keys **104,756** · duplicate keys **0** · null game IDs **0** · null player IDs **0** · non-full-game period **0**.

---

## Selected Fields

Approved 12A fields only. Minutes stay on `analytics.player_game_logs`.

| Internal | API | Scale (certified archive) |
| --- | --- | --- |
| `usage_percentage` | `usagePercentage` | **0–1 fraction** (0.14 = 14%) |
| `true_shooting_percentage` | `trueShootingPercentage` | typically 0–1; can exceed 1.0 on tiny 3P samples |
| `effective_field_goal_percentage` | `effectiveFieldGoalPercentage` | typically 0–1; can exceed 1.0 on tiny 3P samples |
| `offensive_rating` | `offensiveRating` | points / 100 possessions |
| `defensive_rating` | `defensiveRating` | points / 100 possessions |
| `net_rating` | `netRating` | points / 100 possessions (can be negative) |
| `pace` | `pace` | provider pace estimate |
| `possessions` | `possessions` | count; integer-valued in archive |
| `assist_percentage` | `assistPercentage` | **0–1 fraction** |
| `rebound_percentage` | `reboundPercentage` | **0–1 fraction** |
| `turnover_ratio` | `turnoverRatio` | provider ratio, **not** 0–1 (sample 5.3) |
| `pie` | `pie` | typically 0–1; extremes exist on tiny samples |

**Not copied:** `switches_on`, entire `matchup_*` block, `estimated_*`, names, current team IDs, raw payload.

Sample 2025 `page=1` (Luguentz Dort): usage **0.14**, TS **0.233**, eFG **0.167**, ORtg **111.9**, pace **91.22**, possessions **84**, PIE **0.015**. Serving preserves this representation. The future UI must **not** guess whether `0.62` means 62% — it is **62% already as a fraction**.

---

## Schema / Migration

Table: `analytics.player_game_advanced`  
Grain / PK: `(game_id, player_id)` — `game_id` first covers “all Advanced for one game”.  
FKs: `analytics.games`, `analytics.players`. **No FK to PGL** (Alex Len must be allowed).  
Types: `double precision` for all 12 metrics (nulls preserved).  
Indexes: **PK only**. No `player_id + season` index (no current product query).  
RLS: **false**. Grants: postgres INSERT/SELECT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE only.

Files: `db/schemas/MIGRATION_player_game_advanced.sql`, `scripts/apply-player-game-advanced-schema.ts`.

---

## Candidate Counts

Dry-run (before INSERT):

| Season | Archive | Valid logical | Unique games | Unique players |
| ---: | ---: | ---: | ---: | ---: |
| 2023 | 34,843 | 34,843 | 1,319 | 586 |
| 2024 | 35,103 | 35,103 | 1,321 | 577 |
| 2025 | 34,810 | 34,810 | 1,322 | 594 |
| **Combined** | | **104,756** | | |

No transform exclusions. Pages scanned: **1,050**.

---

## Identity Audit

| Check | Count |
| --- | ---: |
| Mapped (game ∈ `analytics.games`, player ∈ `analytics.players`, season match) | **104,756** |
| Unmapped games | **0** |
| Unmapped players | **0** |
| Season mismatch (archive prefix vs `games.season`) | **0** |
| Nested `game.season` vs prefix conflict | **0** |
| Advanced-only (valid identity, no PGL) | **1** (`1038324\|273`) |

No name-matching. No ID repair.

**Team association:** 104,756 rows compared; **50,286 (48.0%)** have archive `team.id` ≠ nested `player.team_id`. Serving **does not store team**. 12E must group from `player_game_logs.team_id` / game home-away, never current roster.

---

## Backfill Result

Script: `scripts/ingestion/materialize-player-game-advanced.ts`  
Modes: `--dry-run` · `--execute --i-understand-production-write` · `--certify-only`.

| Pass | `upsertTouched` | Serving rows | Duplicate keys |
| --- | ---: | ---: | ---: |
| First execute | 104,756 | 104,756 | 0 |
| Immediate second upsert | **0** | 104,756 | 0 |

Guarded `ON CONFLICT ... WHERE ... IS DISTINCT FROM`. Source S3 untouched.

---

## Season Counts

Serving vs raw archive: **identical** per season.

| Season | Serving rows | Games | Players |
| ---: | ---: | ---: | ---: |
| 2023 | 34,843 | 1,319 | 586 |
| 2024 | 35,103 | 1,321 | 577 |
| 2025 | 34,810 | 1,322 | 594 |
| **Total** | **104,756** | **3,962** | |

2025 analytics `games` still has **1,323** rows (known local-only extra). Advanced covers the certified **1,322** archive games. Not an acquisition failure.

---

## Coverage vs Player Logs

| Season | PGL rows | Matched Advanced | Coverage | Advanced-only |
| ---: | ---: | ---: | ---: | ---: |
| 2023 | 46,090 | 34,842 | **75.6%** | 1 |
| 2024 | 46,150 | 35,103 | **76.1%** | 0 |
| 2025 | 46,056 | 34,810 | **75.6%** | 0 |
| Combined | 138,296 | 104,755 | **75.7%** | 1 |

Expected 75–76%. Missing Advanced is **provider qualification/participation**, not a serving bug. Do not classify missing rows as data errors. Do not fabricate Advanced for every PGL.

---

## Null / Field Quality Audit

All 12 selected fields: **30 nulls / 104,726 present** (0.029%). The 30 nulls are the **same rows** (all selected metrics null together). Do not drop them.

| Field | min | max | Quality |
| --- | ---: | ---: | --- |
| usage_percentage | 0 | 1 | **Strong** (0–1; never >1) |
| assist_percentage | 0 | 1 | **Strong** |
| rebound_percentage | 0 | 1 | **Strong** |
| true_shooting_percentage | 0 | 1.5 | **Context-dependent** when possessions are tiny (can exceed 1.0) |
| effective_field_goal_percentage | 0 | 1.5 | **Context-dependent** on tiny 3P samples |
| offensive_rating | 0 | 300 | **Context-dependent** |
| defensive_rating | 0 | 400 | **Context-dependent** |
| net_rating | -400 | 300 | **Context-dependent** |
| pace | 0 | 28,800 | **Context-dependent** (ultra-low possession) |
| possessions | 0 | 122 | **Strong** as sample-size denominator |
| turnover_ratio | 0 | 100 | **Context-dependent** |
| pie | -11 | 10 | **Context-dependent** (typical 0–1) |

**Often-null:** none of the selected twelve.

`0` is a real archived value (not missing). UI must not treat `0` as null.

---

## Advanced-Only Edge Cases

`1038324|273` — **Alex Len**, SAC vs DET, 2024-02-08, season **2023**.

- Identity valid (`games` + `players`)
- **0** matching `player_game_logs` rows
- Serving row **kept** (source zeros: all selected metrics `0`)
- Policy: **serve if identity/game is valid; Historical Explorer attaches Advanced only onto box-score players; do not fabricate a box row**

---

## Extreme / Low-Sample Audit

No minutes/possessions threshold was applied in 12D.

| Signal | Count |
| --- | ---: |
| PGL minutes &lt; 5 (joined) | 26,404 |
| PGL minutes unknown | **1** (Alex Len) |
| possessions &lt; 5 | 22,261 |
| possessions &lt; 10 | 26,294 |
| pace &gt; 140 | 504 |
| pace &lt; 70 (includes zeros) | 19,602 |
| ORtg &gt; 200 | 86 |
| ORtg &lt; 50 (includes zeros) | 21,644 |
| DRtg &gt; 200 | 199 |
| usage &gt; 1 | **0** |

Example: Payton Pritchard in 2023 Finals (`15905067`) — **1 minute**, 3 possessions, TS/eFG **1.5**. Valid source, not clamped.

12E may annotate or de-emphasize tiny samples. Do not clamp serving data.

---

## Idempotency

Second upsert in the same execute: **0 rows touched**. Row count stayed 104,756. No duplicates.

---

## Storage Delta

| Measure | Bytes | Pretty |
| --- | ---: | --- |
| DB before | 358,239,379 | ~341.6 MB |
| DB after | 384,928,915 | ~367.1 MB |
| **Delta** | **26,689,536** | **~25.5 MB** |
| Table heap | 20,488,192 | ~19.5 MB |
| Indexes (PK) | 6,217,728 | ~5.9 MB |
| **Total relation** | **26,705,920** | **~25.5 MB** |

Inside 12A’s **~20–30 MB** estimate. Architecture remains **raw Advanced S3 → compact Postgres serving**, not raw duplication.

---

## Historical Contract / Query Integration

`availability.advanced` is now a **boolean**.

Meaning: **this game has ≥1 Advanced serving row** (module can be offered), **not** “every box player has Advanced”.

| Path | `availability.advanced` |
| --- | --- |
| 2023 Final `15905067` | **true** (after serving) |
| 2024 Final `18444564` | **true** |
| 2025 Final `18447937` | **true** |
| 2026 Scheduled `21717855` | **false** (0 serving rows; live path still hard-codes false) |

Box players: `advanced: HistoricalPlayerAdvanced | null`. Server attaches by `player_id`. Advanced-only rows stay in Postgres and are **not** appended to the box.

---

## API / Server Recommendation for 12E

**Implemented: Option A + C (minimal).**

- Existing `GET /api/betting/games/:id/details` Final payload already includes:
  - `availability.advanced`
  - each box player’s `advanced` object or `null`
- Server helper: `loadCertifiedAdvanced` in `lib/betting/historical-final-server.ts` (one `WHERE game_id = $1` query, **parallel** with PGL + starters).
- **No** public `/advanced` HTTP route.
- Frontend **must not** independently join two arrays; 12E should read `player.advanced`.

Option B (separate fetch) is unnecessary: ~20–36 rows/game, **0.13 ms** index scan.

---

## Tests Added

| File | Coverage |
| --- | --- |
| `lib/archive/__tests__/player-game-advanced.test.ts` | selected mapping, unselected omitted, null preserved, 0–1 scale, IDs not names, Alex Len policy, duplicate key fail, unsupported season, unmapped/mismatch |
| `lib/betting/__tests__/player-game-advanced-schema.test.ts` | PK grain, no names/team/jsonb, no extra indexes, no RLS/anon, `IS DISTINCT FROM`, no BDL client |
| `lib/betting/__tests__/historical-advanced.test.ts` | availability flag, enrich box, missing Advanced null, no fabricated box row |
| `lib/betting/__tests__/details-final-mode.test.ts` | 2023/2024/2025 Final advanced true + enrichment; player without Advanced stays on box with `null`; 2026 Scheduled false |
| `lib/betting/__tests__/historical-final.test.ts` | `historicalModuleAvailability(true, true)` |

---

## Test Results

Targeted suites **passed**:

- 12D transform/schema/contract: 9 + 2 + 3 + 6 details tests
- Starting Five / matchup-analysis Final / slate-date
- Historical seasons + dashboard historical slate
- Market Movement schema/backfill/server/presentational tests

No BDL lineup calls on Final details tests.

---

## Real-Data Verification

S3 page metrics **byte-for-value match** serving rows.

| Season | Game | Player | Box | Advanced | Source page |
| --- | --- | --- | --- | --- | --- |
| 2023 | `15905067` DAL @ BOS | **Jayson Tatum** `434` (45 min, 31 pts) | yes | USG 0.284 · TS 0.563 · eFG 0.479 · ORtg 122.4 · poss 85 · PIE 0.205 | `season=2023/.../page=334.json` |
| 2023 | `15905067` | **Payton Pritchard** `3547276` (1 min, 3 pts) | yes | USG 0.333 · TS **1.5** · poss 3 · PIE 0.5 | same page |
| 2024 | `18444564` IND @ OKC | **Bennedict Mathurin** `38017686` (33 min, 24 pts) | yes | USG 0.278 · TS 0.652 · poss 65 · PIE 0.275 | `page=338.json` |
| 2025 | `18447937` SAS @ LAC | **Kawhi Leonard** `274` (32 min, 24 pts) | yes | USG 0.208 · TS 0.75 · poss 68 · PIE 0.227 | `page=299.json` |
| 2023 | `1038324` SAC vs DET | **Alex Len** `273` | **no PGL** | all selected metrics `0`; serving row exists | `page=186.json` |

Tatum archive team.id **2** (BOS) matches game-night. Do not use nested `player.team_id` for grouping.

---

## Source Immutability

Writes: **`analytics.player_game_advanced` only** (plus empty schema apply).

Not written: Advanced S3 archive, `analytics.games`, `analytics.player_game_logs`, `analytics.game_starters`, Market Movement tables, Season Average archive.

---

## Files Changed

**Added**

- `lib/archive/player-game-advanced.ts`
- `lib/betting/historical-advanced.ts`
- `db/schemas/MIGRATION_player_game_advanced.sql`
- `scripts/apply-player-game-advanced-schema.ts`
- `scripts/ingestion/materialize-player-game-advanced.ts`
- `lib/archive/__tests__/player-game-advanced.test.ts`
- `lib/betting/__tests__/player-game-advanced-schema.test.ts`
- `lib/betting/__tests__/historical-advanced.test.ts`
- `reports/trial/player-game-advanced-materialize.json`
- `reports/product/historical-explorer-v2-advanced-serving.md`
- `reports/product/historical-explorer-v2-advanced-serving.json`

**Modified**

- `lib/betting/historical-final.ts` — `availability.advanced: boolean`; `attachAdvancedToBox`
- `lib/betting/historical-final-server.ts` — game-scoped Advanced query + box enrichment
- `lib/betting/__tests__/historical-final.test.ts`
- `lib/betting/__tests__/details-final-mode.test.ts`

---

## Risks / Open Questions

1. **~24% of box players have no Advanced row** — 12E must hide chips, not error.
2. **Tiny samples** produce TS/eFG &gt; 1, PIE outside 0–1, pace in the thousands. Serving is raw; UI policy is 12E.
3. **Zeros vs nulls:** 30 true-null rows vs many legitimate `0` DNP-like Advanced rows (including Alex Len).
4. **No minutes threshold** was invented here. 12E may visually de-emphasize `possessions < 5` or low PGL minutes.
5. Compact table has **no team_id**. If a later tool needs Advanced without PGL, it cannot recover game-night team from this table (Alex Len is the example). That is intentional.

---

## Recommendation for Step 12E

Proceed to **Advanced UI on historical Final pages only**.

- Read `player.advanced` from the existing details contract. Do not add `/advanced`.
- Format 0–1 fields as percents (`0.284` → 28.4%). Do **not** multiply values that are already ratings/pace/possessions/turnover_ratio.
- Hide the module when `availability.advanced === false` (2026 / unsupported).
- Per player, hide chips when `advanced === null`. Keep the box row.
- De-emphasize or footnote low possessions; do not drop serving rows.
- Do **not** start Role Profile, Season Averages, Plays/Timeline, or change Starting Five / Market Movement.

**STOP. Do not start 12E in this step.**

---

## Verification Checklist

1. Confirm `analytics.player_game_advanced` has **104,756** rows and **0** duplicate `(game_id, player_id)` keys.
2. Open `/betting/games/15905067` (2023 Final) — box still renders; **no new Advanced UI**; details JSON has `availability.advanced === true` and Tatum `advanced.usagePercentage === 0.284`.
3. Open `/betting/games/18447937` (2025 Final) — Starting Five still 5+5; Kawhi has Advanced; no BDL lineups.
4. Open `/betting/games/21717855` (2026 Scheduled) — live path; `availability.advanced === false`.
5. Confirm `/betting?date=2024-06-17` still lists DAL @ BOS (12B date nav).
6. Confirm Market Movement surfaces are unchanged.
7. Optional: `npx tsx scripts/ingestion/materialize-player-game-advanced.ts --certify-only` reproduces season counts.

---

## Step Verdict

**GREEN — compact Advanced serving is certified and ready for Historical Explorer UI**
