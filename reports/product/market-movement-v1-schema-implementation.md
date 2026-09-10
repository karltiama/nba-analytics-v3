# Market Movement v1 — Schema Implementation (Step 11B)

Generated: 2026-09-09  
Status: **schema + shared deterministic market math + tests. No historical backfill.**

**Step verdict:** `GREEN — Market Movement schema and shared math are ready for historical backfill`

Do not start Step 11C until this report is reviewed.

---

## Safety / Scope

Confirmed before and after implementation:

| Guardrail | Status |
| --- | --- |
| No BALLDONTLIE HTTP | Held. Apply script uses `SUPABASE_DB_URL` only. Shared math is local. 7E script still reads S3 if run, but **was not executed**. |
| Production ingestion frozen | Held. `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`. |
| No historical S3 acquisition | Held. No S3 list/get for population. |
| No writes to existing research market datasets | Held. No INSERT/UPDATE on `research.prop_decision_lines`, history, current boards, or `*_movement_summary`. |
| No Props Explorer UI changes | Held. |
| No API response changes | Held. |
| No backfill | Held. Serving tables exist and are empty. |
| No Historical Explorer / Role Check / possession / WOWY | Held. |
| No global RLS policy change | Held. New tables match existing `analytics` serving convention (RLS off, no `anon` grant). |

This step is schema + reusable logic only.

---

## Migration Created

| Item | Value |
| --- | --- |
| SQL | `db/schemas/MIGRATION_market_movement_v1.sql` |
| Apply helper | `scripts/apply-market-movement-v1-schema.ts` |
| Convention | Same as other `db/schemas/MIGRATION_*.sql` files (manual / `tsx` apply via `SUPABASE_DB_URL`). No `supabase/migrations/` folder in this repo. |
| Idempotent | `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` |
| Applied to Production app deploy | **No** |
| Applied to the frozen working Supabase used by 11A | **Yes — DDL only** (empty tables). Required to verify row counts = 0. |
| Rows inserted | **0** |

Existing first-seen tables were not altered:

- `analytics.player_prop_movement_summary` still **1,611** rows
- `analytics.game_line_movement_summary` still **334** rows

---

## Player Prop Table

`analytics.player_prop_market_movement`

Certified grain: **`game_id + player_id + prop_type + vendor`**

ID types match research/analytics text IDs (`game_id text`, `player_id text`), not the unused integer `analytics.player_props_current` shape.

| Group | Columns |
| --- | --- |
| Identity | `game_id`, `player_id`, `player_name`, `prop_type`, `vendor`, `vendor_raw` |
| Reference | `reference_kind` (`3_hour_pre_tip`), `reference_line`, `reference_over_odds`, `reference_under_odds`, `reference_timestamp` |
| Comparison | `comparison_kind` (`decision_close` historical; `live_current` reserved), `comparison_line`, `comparison_over_odds`, `comparison_under_odds`, `comparison_timestamp` |
| Derived | `line_delta`, `over_implied_probability_delta`, `under_implied_probability_delta`, `movement_class` |
| Provenance | `backfill_revision`, `created_at`, `updated_at` |

Not stored: raw provider payloads, consensus median/min/max/count.

Lines and odds are **nullable** so unmatched sides can exist without manufacturing numbers. `movement_class` is **NOT NULL** (`A`/`B`/`C`/`D`/`unclassified`).

Vendor CHECK: `betmgm`, `fanduel`, `draftkings`, `caesars`.  
Prop CHECK: seven v1 markets; PRA stored as `points_rebounds_assists`.

---

## Game Odds Table

`analytics.game_odds_market_movement`

Certified grain: **`game_id + vendor`**

One provider snapshot row holding spread, total, and moneyline — not a generic market union with player props.

| Group | Columns |
| --- | --- |
| Identity | `game_id`, `vendor`, `vendor_raw`, `outlier_class` |
| Coverage | `reference_kind` (`opening_snapshot`), `certified_window_start` / `end` (**2026-03-09** through **2026-03-22**) |
| Reference | home/away spread + odds, total + over/under odds, home/away ML, `reference_timestamp` |
| Comparison | same markets; `comparison_kind` (`last_pre_tip_history` historical; `live_current` reserved) |
| Derived | `spread_delta`, `total_delta`, `home_ml_implied_probability_delta`, `away_ml_implied_probability_delta` |

Moneyline product metric is **implied-probability delta**, not American-odds subtraction.

No consensus columns. No vendor CHECK (game-odds universe is wider than the four prop books; outliers stay as rows with `outlier_class`).

Window CHECK forces every row to the certified Opening Snapshot dates so the API can later say **certified Opening Snapshot window = 2026-03-09 through 2026-03-22** without pretending this is season-wide opening history.

`live_current` is reserved on `comparison_kind` but the NOT NULL window CHECK currently forbids storing games outside that window. That is acceptable for 11C historical backfill; live activation will need a later constraint change. See Risks.

---

## Constraints / Indexes

### Constraints

| Table | Constraint | Meaning |
| --- | --- | --- |
| player | `player_prop_market_movement_pk` | UNIQUE grain `(game_id, player_id, prop_type, vendor)` |
| player | `player_prop_mm_reference_kind_chk` | `3_hour_pre_tip` only |
| player | `player_prop_mm_comparison_kind_chk` | `decision_close` \| `live_current` |
| player | `player_prop_mm_class_chk` | `A`/`B`/`C`/`D`/`unclassified` |
| player | `player_prop_mm_vendor_chk` | four v1 books |
| player | `player_prop_mm_prop_chk` | seven v1 markets |
| game | `game_odds_market_movement_pk` | UNIQUE grain `(game_id, vendor)` |
| game | `game_odds_mm_reference_kind_chk` | `opening_snapshot` |
| game | `game_odds_mm_comparison_kind_chk` | `last_pre_tip_history` \| `live_current` |
| game | `game_odds_mm_window_chk` | window dates locked |

No FKs to `analytics.games` / `analytics.players` (11A: confirm archive IDs in 11C before adding FKs).

No consensus table: `to_regclass('analytics.market_movement_consensus')` is null.

### Indexes (and why)

| Index | Why |
| --- | --- |
| `player_prop_market_movement_pk` `(game_id, player_id, prop_type, vendor)` | Grain uniqueness. Also covers by-game, game+player, game+player+prop, and vendor rows for one market (leftmost `game_id`). |
| `analytics_player_prop_mm_player_game_idx` `(player_id, game_id)` | Player-page lookups that are **not** game-prefixed. PK cannot serve `WHERE player_id = $1` cheaply. |
| `game_odds_market_movement_pk` `(game_id, vendor)` | Grain uniqueness. Leftmost `game_id` covers by-game and vendor rows for one game. |

**Not added:** standalone `(game_id)` on either table, speculative prop/vendor-only indexes, covering indexes.

---

## RLS / Permission Behavior

Inspected comparable `analytics` serving objects (`game_odds_history`, `player_prop_movement_summary`):

- `relrowsecurity = false`
- `relacl` null (owner-only; no `anon` / `authenticated` table grants)
- App access is server-side `pg` via `SUPABASE_DB_URL`, not PostgREST public reads

**New tables match that convention exactly:**

- RLS **not** enabled
- No `GRANT` to `anon` or `authenticated`
- No schema-wide RLS enable/disable
- No public access introduced

This is the **minimal table-specific decision**: inherit existing analytics owner-only access. Global RLS cleanup remains out of scope.

---

## Shared Market Math

Single module: `lib/betting/market-movement.ts`

Extracted from certified Step 7E (`scripts/archive/analyze-market-intelligence.ts`), which now **imports** these helpers instead of keeping a second copy.

| Function | Behavior |
| --- | --- |
| `parseAmericanOdds` | Finite number; **0 is missing**, not even money |
| `americanOddsToImpliedProbability` | Negative: `\|odds\| / (\|odds\| + 100)`. Positive: `100 / (odds + 100)`. null / non-finite / 0 → null |
| `impliedProbabilityDelta` | comparison − reference; null if either side missing |

No vig normalization. Even money is **+100 / −100 → 0.5**.

Existing `lib/betting/odds-utils.ts` was **not** changed (it treats `<= 0` as 0%). Product Market Movement must use this module.

---

## Movement Classification

`classifyPropMovement` — exact 7E taxonomy.

| Class | Meaning | Threshold |
| --- | --- | --- |
| A Quiet | line unchanged + juice &lt; 2pp | `JUICE_IMPLIED_PROB_THRESHOLD = 0.02` |
| B Juice | line unchanged + juice ≥ 2pp on either side | same |
| C Line | line changed, no material juice (or missing juice) | line epsilon `1e-9` |
| D Line+Price | line changed + juice ≥ 2pp | both |
| unclassified | missing reference or comparison line | — |

Juice uses **either** over or under implied-probability absolute delta ≥ 0.02. Thresholds were not changed.

---

## Consensus Utility

**No consensus table.** Derived at read time from compact per-book rows.

`playerPropConsensus(rows)`:

- Eligible books: BetMGM, FanDuel, DraftKings, Caesars (after `normalizeVendor`)
- Minimum **2** eligible books with finite lines
- 1 book or only unsupported vendors → `{ available: false, median: null, reason: insufficient_books | no_finite_lines }`
- Null lines skipped; do not manufacture numbers
- Median: interpolating quantile 0.5 (`25.5, 26.5` → `26.0`)
- Always returns min, max, count when available

`26.0` is mathematically valid consensus and **is not necessarily an offered sportsbook line**. Future API/UI must say so.

`numericConsensus` is the same interpolating helper for caller-supplied numbers (game-odds outlier filtering stays in 11C/11D). It also requires ≥2 finite values so a one-book midpoint cannot be labeled consensus.

Repo evidence does **not** contradict read-time consensus: four v1 prop books, tiny groups, and live rows (later) should reuse the same function.

---

## Vendor Normalization

`normalizeVendor`: trim + lowercase only. **No fuzzy match.**

- `BetMGM` → `betmgm` (v1)
- `Fan Duel` → `fan duel` (unknown, `isPlayerPropV1Vendor: false`)
- empty/null → `null`

`isPlayerPropV1Vendor` is the product allowlist. Unknown vendors are returned explicitly, never silently mapped.

Reusable by 11C backfill and 11D API.

---

## Prop Normalization

`canonicalizePropType` reuses the 7E `PROP_ALIAS` map.

v1 allowlist (`isPlayerPropV1PropType`) is **separate**:

`points`, `rebounds`, `assists`, `threes`, `points_rebounds`, `points_assists`, `points_rebounds_assists`

`PRA` / `pra` canonicalize to `points_rebounds_assists`. Display helper returns `PRA`.

`blocks`, `steals`, `rebounds_assists` are recognized by the matcher but **not** v1. `double_double` / `triple_double` → null.

---

## Variant Handling

`findAmbiguousSimultaneousLineKeys`: group by `game|player|vendor|prop`; if `Set(line).size > 1`, the whole key is excluded.

Does **not** pick first, last, min, or max. Certified BetRivers simultaneous-variant policy is preserved for 11C.

---

## Coverage Constants

In `lib/betting/market-movement.ts` (do not hardcode independently in future routes):

| Constant | Value |
| --- | --- |
| `PLAYER_PROP_REFERENCE_KIND` | `3_hour_pre_tip` |
| `PLAYER_PROP_COMPARISON_KIND` | `decision_close` |
| `GAME_ODDS_REFERENCE_KIND` | `opening_snapshot` |
| `GAME_ODDS_COMPARISON_KIND` | `last_pre_tip_history` |
| `GAME_ODDS_CERTIFIED_WINDOW` | `2026-03-09` → `2026-03-22` |
| `GAME_ODDS_COVERAGE_DEGRADES_FROM` | `2026-03-23` |
| `PLAYER_PROP_CONSENSUS_MIN_BOOKS` | `2` |
| `JUICE_IMPLIED_PROB_THRESHOLD` | `0.02` |

---

## Tests Added

| File | Coverage |
| --- | --- |
| `lib/betting/__tests__/market-movement.test.ts` | Odds, classification A–D + unclassified, consensus odd/even/min books/nulls/unsupported vendors, vendor/prop normalization, ambiguous variants |
| `lib/betting/__tests__/market-movement-schema.test.ts` | SQL contract: two tables, no consensus table, grains, kinds/window, implied-prob deltas, justified indexes, nullability |

---

## Test Results

```
npx vitest run lib/betting/__tests__/market-movement.test.ts lib/betting/__tests__/market-movement-schema.test.ts

Test Files  2 passed (2)
     Tests  30 passed (30)
```

---

## Local Migration Verification

Ran `npx tsx scripts/apply-market-movement-v1-schema.ts` against the **frozen working Supabase** (same project as 11A).

This is **not** a production ingest thaw and **not** a Production app deploy. It is schema-only verification on the development working database.

Output:

```
MIGRATION_OK
player_prop_market_movement=analytics.player_prop_market_movement
game_odds_market_movement=analytics.game_odds_market_movement
consensus_table=null
player_rows=0
game_rows=0
indexes=analytics_player_prop_mm_player_game_idx,game_odds_market_movement_pk,player_prop_market_movement_pk
rls=game_odds_market_movement:false,player_prop_market_movement:false
player_prop_movement_summary_rows=1611
```

Postgres catalog confirmed PK/check constraints, indexes, RLS off, ACL null.

---

## Empty Serving Tables Confirmation

| Table | Rows |
| --- | --- |
| `analytics.player_prop_market_movement` | **0** |
| `analytics.game_odds_market_movement` | **0** |

Correct for 11B. Step 11C populates historical rows.

Unchanged misleading first-seen tables (still must not be relabeled as certified open):

| Table | Rows |
| --- | --- |
| `analytics.player_prop_movement_summary` | 1,611 |
| `analytics.game_line_movement_summary` | 334 |

---

## Files Changed

- `db/schemas/MIGRATION_market_movement_v1.sql` — empty serving schema
- `scripts/apply-market-movement-v1-schema.ts` — apply + empty-table verification
- `lib/betting/market-movement.ts` — shared math, types, constants, consensus, normalization, variants
- `lib/betting/__tests__/market-movement.test.ts`
- `lib/betting/__tests__/market-movement-schema.test.ts`
- `scripts/archive/analyze-market-intelligence.ts` — now imports the shared module (no second formula copy)
- `reports/product/market-movement-v1-schema-implementation.md` — this file
- `reports/product/market-movement-v1-schema-implementation.json`

Not changed: Props Explorer UI, betting APIs, S3 archives, `research.prop_decision_lines`, `odds-utils.ts`, RLS policies, ingestion mode.

---

## Risks / Open Questions

1. **Working DB vs “Production”.** Schema was applied to the frozen trial Supabase used throughout Court Context. Ingestion remains replay/offseason/dry-run. If a separate untouched Production cluster exists outside this project, it does **not** have these tables yet — apply the SQL there only when you intend to.
2. **`live_current` vs window CHECK.** Game-odds rows must currently carry `certified_window_start/end = 2026-03-09/22`. Historical 11C is fine. Live rows for other dates will need a later constraint relaxation.
3. **Player `reference_kind` locked to `3_hour_pre_tip`.** Same story: live Market Movement is not solved by this schema; it is only reserved on `comparison_kind`.
4. **No FKs.** Archive `game_id` / `player_id` matching is an 11C concern. Do not add FKs until backfill proves IDs join.
5. **Explorer movement is still first/last `player_prop_lines`.** Intentionally unchanged. Still misleading if read as 3-Hour Pre-Tip. Replace in 11D/11E, not here.
6. **`numericConsensus` min-books = 2.** Shared with player v1. Game-odds product policy (which vendors, outlier exclusion) is still 11C/11D.

---

## Verification Checklist

1. Confirm `DATA_MODE=replay` / `OFFSEASON_MODE=1` / `CRON_DRY_RUN=1` were not flipped.
2. Confirm Props Explorer market panel still uses the old first/last snapshot movement (no UI diff).
3. Re-run `npx vitest run lib/betting/__tests__/market-movement.test.ts lib/betting/__tests__/market-movement-schema.test.ts` if you edit the module.
4. Confirm serving counts remain 0 until you explicitly start 11C:  
   `select count(*) from analytics.player_prop_market_movement;`  
   `select count(*) from analytics.game_odds_market_movement;`
5. Do **not** treat `player_prop_movement_summary.open_line` as 3-Hour Pre-Tip.
6. Do **not** start S3 read / INSERT backfill until 11C is approved.
7. Future API copy: interpolating median is not necessarily an offered line; always show median + min/max + book count.

---

## Step Verdict

`GREEN — Market Movement schema and shared math are ready for historical backfill`

**STOP.** Do not automatically start the historical backfill.
