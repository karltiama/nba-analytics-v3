# Historical Explorer v2 — Step 12C certified starters

Date: 2026-09-10 (ET)

Machine-readable: `reports/product/historical-explorer-v2-certified-starters.md` companion JSON.

**Step verdict:** `GREEN — certified historical Starting Five is ready and Historical Explorer can proceed to Advanced context`

Do **not** begin Step 12D automatically.

---

## Safety / Scope

| Guard | Result |
| --- | --- |
| BDL HTTP from this step | **0** (S3 `getJson` only; `fetchLineupsFromBallDontLie` not imported by backfill) |
| Historical Final live lineup fetch | still impossible (12B client skip + matchup-analysis Final early-return) |
| `DATA_MODE` | `replay` (script abort otherwise) |
| Offseason / cron dry-run | not flipped |
| S3 lineup archive | read-only |
| Advanced / Season Average / Plays | none |
| Live lineup ingestion | unchanged |
| Market Movement | unchanged |
| Opportunity / WOWY | none |

Postgres writes: `analytics.game_starters` schema + 13,200 starter rows only.

---

## Lineup Source Certification

Canonical prefix: `raw/source=balldontlie/league=nba/season=2025/entity=lineups`

Re-read of 1,322 game objects matched Step 8B:

- archive rows **28,833**
- `starter=true` **13,218**
- team-games **2,644**
- exactly 5 starters **2,642**
- fewer than 5 **2** (`18447931`, `18447988`, team `10`)
- more than 5 **0**
- valid 5+5 **1,320 / 1,322**
- unknown identity **0**
- missing S3 objects **0**

Natural key remains `game_id + team_id + player_id`. Team = archive **top-level `team.id`**.

---

## Schema / Migration

`db/schemas/MIGRATION_game_starters.sql` applied via `scripts/apply-game-starters-schema.ts`.

```
analytics.game_starters
  game_id, team_id, player_id  PK
  position (nullable text)
  season
  source default bdl_lineups_archive_2025
  created_at, updated_at
  FKs to analytics.games / teams / players
```

**Indexes:** PK `(game_id, team_id, player_id)` only. That prefix covers “starters for this game.”

**RLS:** disabled, matching other `analytics.*` server-serving tables. **No anon/authenticated grants.** Privileges are owner/`postgres` only. App reads go through `SUPABASE_DB_URL`. Schema-wide RLS cleanup was not done.

Season is **not** check-constrained to 2025 so a later certified 2026 archive can insert without replacing the table. Initial backfill is 2025 only.

---

## Candidate Counts (before INSERT)

| Metric | Observed | Expected |
| --- | ---: | ---: |
| Archive games | 1322 | 1322 |
| Archive rows | 28833 | 28833 |
| starter=true | 13218 | ~13218 |
| Team-games | 2644 | 2644 |
| Exactly 5 | 2642 | 2642 |
| Valid 5+5 | 1320 | 1320 |
| Product serving rows | **13200** | **13200** |
| Unmapped players/teams | 0 | 0 |
| Wrong season | 0 | 0 |

No material mismatch. INSERT proceeded.

---

## Backfill Result

`scripts/ingestion/materialize-game-starters-2025.ts`

- starter=true only
- skip anomaly games entirely (**Option A**)
- batch upsert 500
- `ON CONFLICT ... DO UPDATE WHERE IS DISTINCT FROM`

| Run | upsertTouched | serving rows | games | duplicates | anomaly rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 13200 | 13200 | 1320 | 0 | 0 |
| 2 | **0** | 13200 | 1320 | 0 | 0 |

---

## Identity / Historical Team Audit

- All 1,320 serving game IDs exist in `analytics.games` with `season = '2025'`
- All team IDs exist in `analytics.teams`
- All player IDs exist in `analytics.players` (`player.id == analytics.players.player_id`; no name match)
- `18447937`: 10 starter rows; all 10 match `player_game_logs.team_id` (game-night team)
- Traded-player example: **Derrick Jones Jr.** started for **LAC** (`team_id=13`) on `18447937`. He is **DAL** in the 2023 Final `15905067` box. Nested `player.team_id` is ignored (unit-tested)

---

## Anomaly Handling

**Option A:** no serving rows for `18447931` / `18447988`.

Runtime still fail-closes: `available` is true only if grouped home and away are **exactly 5**. Partial fives return empty arrays. UI hides the module. No 4/5, no BDL fallback.

Browser: `/betting/games/18447931` (SAS 127 @ GSW 113 Final) — box only, **no Starting Five**.

---

## Idempotency

Second execute: **0** conflict updates (`IS DISTINCT FROM` guard), identical 13,200 rows, `deltaBytes = 0`.

---

## Storage Delta

| | Bytes | Pretty |
| --- | ---: | --- |
| DB before | 356,084,883 | 339.59 MB |
| DB after | 358,206,611 | ~341.6 MB |
| DB delta | 2,121,728 | **2.02 MB** |
| Table heap | 1,336,064 | 1304 kB |
| Indexes (PK) | 786,432 | 768 kB |
| Total relation | ~2,121,728 | **2072 kB** |

12A guessed **< 2 MB**. Heap is under 2 MB. Total with the required PK is ~2.02 MB — not a material overrun.

---

## Historical Contract Integration

No `/api/history/game/:id`. Extended `GET /api/betting/games/:id/details`:

```ts
starters: { available: boolean; home: [...]; away: [...] }
availability.starters === starters.available
```

Frontend does not infer completeness from row count. `shouldShowStartingFive` requires `available && 5 && 5`.

2023/2024: zero serving rows → `available: false`.

Added query: **one** game-scoped `analytics.game_starters` JOIN `analytics.players`, in parallel with the box query. Not per-player.

---

## Starting Five UI

Label: **Starting Five** (not Projected). Compact two-group card **above the box**. Player + position. Court Context links: `/betting/players/:id?...&season=`.

`18447937` SAS @ LAC:

- SAS (5): Kornet C, Champagnie F, Fox G, Vassell G, Castle G
- LAC (5): Lopez C, Jones Jr. F, Collins F, Leonard F, Garland G

---

## 2023 / 2024 Behavior

`15905067` DAL @ BOS: header + box remain; **Starting Five hidden**. No error card, no skeletons.

---

## 2025 Behavior

Certified Finals: module shown with exactly 5 + 5. Anomalies: hidden.

---

## No-Live-Fallback Verification

- Backfill does not import BDL clients
- Final details still skip `matchup-analysis`
- `getMatchupAnalysis` still returns before `fetchLineupsFromBallDontLie` on Final
- Missing/partial starters → empty module, **not** live fetch (details tests)

---

## Upcoming/Live Regression

`21717855` Scheduled: AI + **Projected starters** remain. No historical Starting Five. No box.

---

## Responsive / Accessibility

- Desktop: two columns
- ~390px: `grid-cols-1`; Starting Five `overflowX = false` (clientWidth = scrollWidth)
- `h2` Starting Five; team `h3`; sr-only team names; position as text; player names are links

---

## Tests Added

- Archive transform: 5+5, non-starter excluded, nested `player.team_id` ignored, anomaly, unknown identity
- Schema contract
- Details: 2023 false, 2025 5+5 true, anomaly false, no BDL
- UI visibility helper
- Existing Final BDL guard still passes

---

## Test Results

Targeted vitest: **passed** (details-final-mode 4, transform 9, plus 12B/MM files rerun).

---

## Real-Data Verification

| Page | Result |
| --- | --- |
| `/betting/games/18447937` | 118–99, Starting Five 5 SAS + 5 LAC, box intact, not Projected |
| `/betting/games/18447931` | Final box; Starting Five hidden |
| `/betting/games/15905067` | 88–106 box; Starting Five hidden |
| `/betting/games/21717855` | live Projected starters |

---

## Files Changed

New: schema, apply script, materialize script, `historical-starters.ts`, `game-starters-from-lineups.ts`, `HistoricalStartingFive.tsx`, tests, this report.

Edited: details route, `historical-final-server.ts`, `MatchupPageLayout.tsx`, `package.json`.

S3 archive, player logs, games, other serving tables: **unchanged**.

---

## Remaining Gaps

- Advanced compact serving (12D)
- Role Profile
- Timeline / Plays
- 2023/2024 have no lineup archive (expected absence)
- Live ingest of future starters into this table (not this step)

---

## Recommendation for Step 12D

Compact **Advanced Stats** serving (~104k rows) behind the same Final `availability.advanced` flag. Do not mix Advanced into Starting Five. Keep 12C fail-closed starter rules.

---

## Verification Checklist

1. `/betting/games/18447937` shows Starting Five, 5 SAS + 5 LAC, official 118–99, box.
2. That page does not say Projected Starters and does not call live BDL.
3. `/betting/games/15905067` has no Starting Five module.
4. `/betting/games/18447931` has no Starting Five module.
5. A 2026 Scheduled game still shows Projected starters.
6. Confirm Advanced serving was **not** started.

---

## Step Verdict

`GREEN — certified historical Starting Five is ready and Historical Explorer can proceed to Advanced context`
