# Market Movement v1 — Serving Design (Step 11A)

Generated: 2026-09-09  
Status: **audit + design only. No implementation.**

**Step verdict:** `YELLOW — design is viable but one or more architecture questions need review`

Review before Step 11B (see [Risks / Open Questions](#risks--open-questions)). Recommended defaults are stated for each question so 11B can start immediately after sign-off.

---

## Existing Market Architecture

Court Context already has **three overlapping market stacks**. None of them is a certified 3-Hour Pre-Tip → Close serving layer.

### 1. Historical research / closing proxy (usable as comparison side)

- `research.prop_decision_lines` — last **pre-tip** over/under row per `(game, player, book, prop, side)`.
- View `research.v_prop_decision_lines` — same table plus a live fallback from `raw.player_prop_snapshots_v2` for Final games not yet materialized.
- **Today:** raw v2 is empty (pruned). The view is effectively the materialized table.

This is the certified **Close / decision line** for player props. It is **not** an opening snapshot and must not be labeled as current sportsbook offers.

### 2. Live / current serving (frozen, incomplete, vendor-narrow)

- `analytics.player_props_current` — the table Props Explorer **live** queries. **0 rows.**
- `analytics.player_prop_current` — 25,812 rows, **DraftKings only**, 153 games.
- `analytics.player_prop_lines` — flattened O/U shopping board. **7,168 rows / 5 games / 2026-03-09 only.**
- `analytics.game_odds_current` — **one row per game** (not per book). All 334 rows are **draftkings**.
- Ingestion is frozen: `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`. Do not thaw.

Live Market Movement (earlier snapshot → current line) is **architecturally compatible** with the proposed grain, but **not data-ready**. v1 must ship as historical snapshot → close.

### 3. Intra-window snapshot history (wrong “open”)

- `analytics.player_prop_history` — 93,246 rows / **38 games** / 2026-03-09 → 03-17.
- `analytics.player_prop_movement_summary` — 1,611 rows. “Open” = first seen in history, not 3-Hour Pre-Tip.
- `analytics.game_odds_history` — 63,380 rows / 334 games. Real timeline; first snapshot ≠ certified Opening Snapshot.
- `analytics.game_line_movement_summary` — 334 rows, one per game, first-seen vs latest. No vendor grain. No certified window label.

**Do not reuse these as Market Movement v1.** They would lie about source semantics.

### 4. Certified S3 opening archives (reference side)

- Player props: 129-game 3-Hour Pre-Tip archive.
- Game odds: targeted `2026-03-09_to_2026-03-22` Opening Snapshot archive.

Raw/deep history stays in S3. Postgres gets compact matched serving rows only.

### 5. Legacy

- `public.markets` — 4,302 rows; fallback for old line-movement charts.
- `raw.odds_snapshots` — 61,667 raw BDL odds rows (39 MB). Not a product grain.

---

## Existing Database Objects

Live Postgres size (read-only audit): **342,846,611 bytes / 327 MB**. Unchanged from the Step 7E checkpoint.

### Player props

#### `research.prop_decision_lines`

| Field | Value |
| --- | --- |
| Grain | one row per `(game_id, player_id, sportsbook, prop_type, side)` |
| PK | `(game_id, player_id, sportsbook, prop_type, side)` |
| Rows | 94,086 |
| Games | 129, all `analytics.games.season = '2025'` |
| Tip window | 2026-04-03 → 2026-05-02 |
| Players | 303 |
| Sides | over 47,043 / under 47,043 (perfect pairs) |
| Nulls | 0 null `line_value`, `odds_american`, `implied_probability` |
| Vendor column | `sportsbook`, already lowercase |
| Prop column | `prop_type` already canonical (`points`, `points_rebounds_assists`, …) |
| Timestamps | `decision_at` (last pre-tip), `game_start_time`, `materialized_at` |
| Semantics | historical **close proxy**, not live, not 3-Hour Pre-Tip |
| Frontend | Props Explorer historical table; `/api/betting/props-explorer/market` shopping board |

Books present (not v1-filtered): betmgm 19,388; betway 17,542; fanduel 15,586; betparx 12,586; draftkings 10,162; betrivers 9,240; caesars 8,194; fanatics 1,388.

#### `research.v_prop_decision_lines`

View. Same columns. Live fallback is currently a no-op because `raw.player_prop_snapshots_v2` has **0 rows**.

#### `analytics.player_prop_current`

| Field | Value |
| --- | --- |
| Grain | latest O/U or milestone per `(game, player, vendor, prop, market_type, line_value)` |
| Unique | `(game_id, player_id, vendor, prop_type, market_type, line_value)` |
| Rows | 25,812 / 153 games |
| Vendor | **draftkings only** |
| Semantics | preferred-vendor current board (pipeline), not multi-book |
| Frontend | game player-props route can read it; Explorer live path does **not** |

#### `analytics.player_props_current`

| Field | Value |
| --- | --- |
| Grain | `(game_id, player_id, sportsbook, prop_type, side, line_value)` |
| Rows | **0** |
| Types | `game_id`/`player_id` are **integer** (unlike text IDs elsewhere) |
| Frontend | **this** is what live Props Explorer queries |

Live Explorer is empty in the frozen DB. Historical Explorer uses decision lines and works.

#### `analytics.player_prop_history`

93,246 rows, 38 games, 10 vendors, 2026-03-09 → 03-17. Append-only snapshot timeline. Unique `(game_id, player_id, vendor, prop_type, market_type, line_value, snapshot_at)`. **Not** a 3-hour archive. **Not** consumed by Market Movement v1.

#### `analytics.player_prop_movement_summary`

1,611 rows. Unique `(game_id, player_id, vendor, prop_type)`. `open_line` = first history snapshot. **Do not serve.** No frontend read found.

#### `analytics.player_prop_lines`

7,168 rows, 5 games, 8 books, all snapshots on 2026-03-09. Current shopping + existing Explorer “movement” (first vs last snapshot). Too sparse for v1 history.

#### `raw.player_prop_snapshots_v2`

0 rows (hourly unique index exists; table pruned). Deep history is not in Postgres.

### Game odds

#### `analytics.game_odds_history`

| Field | Value |
| --- | --- |
| Grain | one row per `(game_id, vendor, snapshot_at)` |
| PK | `id`; unique `(game_id, vendor, snapshot_at)` |
| Rows | 63,380 / 334 games / 12 vendors |
| Snapshot range | 2026-01-25 → 2026-05-06 (created_at through 2026-09-06) |
| Columns | home/away ML, home/away spread + odds, total, over/under odds, vendor, snapshot_at |
| Semantics | append-only **poll timeline**. Last pre-tip row is the certified **close** for Open→Close matching |
| Frontend | `getLineMovement()` → game page `LineMovementChart` (preferred book, default draftkings) |

Vendors (history counts): polymarket 7,202; kalshi 5,549; fanduel 5,455; draftkings 5,371; betrivers 5,258; betparx 5,257; ballybet 5,257; betway 5,240; caesars 5,109; fanatics 5,024; betmgm 4,948; rebet 3,710.

#### `analytics.game_odds_current`

334 rows, PK `game_id`, **vendor = draftkings for every row**. Latest preferred-book card, not a market board.

#### `analytics.game_line_movement_summary`

334 rows, PK `game_id`. Open vs current **without vendor**. First-seen vs last-seen in history. **Not** Opening Snapshot. No frontend read found (game page uses history series instead).

#### `raw.odds_snapshots`

61,667 rows / 39 MB. BDL `/v2/odds` grain (`game_id + vendor` per pull). Includes spread/total/ML prices. Not serving.

### Size (total relation)

| Object | Size |
| --- | ---: |
| `raw.odds_snapshots` | 39 MB |
| `analytics.player_prop_history` | 28 MB |
| `research.prop_decision_lines` | 23 MB |
| `analytics.game_odds_history` | 16 MB |
| `analytics.player_prop_current` | 10 MB |
| `public.markets` | 5.7 MB |
| `analytics.player_prop_lines` | 2.4 MB |
| `analytics.player_prop_movement_summary` | 568 kB |
| `analytics.game_odds_current` | 184 kB |
| `analytics.game_line_movement_summary` | 160 kB |
| `analytics.player_props_current` | 56 kB |
| `raw.player_prop_snapshots_v2` | 56 kB |

Compact v1 serving should stay in the **low-MB** class, not join this raw/history pile.

---

## Historical S3 Sources

Inspected via Step 7E/7D reports and archive plan code. **No BDL HTTP. No reacquisition.**

### Player opening props (129-game archive)

- **Canonical prefix:** `raw/source=balldontlie/league=nba/season=2025/entity=opening_player_props`
- **Objects:** `game_id=<id>.json` (129). Manifest: `${prefix}/_manifest.json` (written by the archive job).
- **Queue origin:** distinct `game_id` from `research.prop_decision_lines`.
- **Endpoint (already captured):** `GET /nba/v2/odds/player_props/opening?game_id=`
- **Record shape (sample keys):** `id`, `game_id`, `player_id`, `vendor`, `prop_type`, `line_value`, `market`, `opened_at`
- **Odds:** nested `market.over_odds` / `market.under_odds` (American)
- **Line:** `line_value` (also parsed from `market.line` fallbacks)
- **Natural key used in 7E:** `game_id + player_id + lower(vendor) + canonical prop_type`
- **Timing:** every opening row is **exactly 3.0 hours** pre-tip (`min = median = max = 3`). Label: **3-Hour Pre-Tip**. Never “market open” / “true opening line” / “first print”.
- **Rows:** 44,127

### Game opening odds (certified window)

- **Canonical prefix:** `raw/source=balldontlie/league=nba/season=2025/entity=opening_game_odds/window=2026-03-09_to_2026-03-22`
- **Do not use** the unwindowed entity prefix from `planOpeningGameOddsArchive()` as the product source.
- **Preserve, do not serve:** `_characterization_march_cutoff`, `_characterization_schedule_phase`, `_characterization_10game`
- **Objects:** 107 `game_id=<id>.json` (cert: 107 objects, 0.58 MB, 1,179 records)
- **Record shape (sample keys):** `id`, `game_id`, `vendor`, `spread_home_value`, `spread_home_odds`, `spread_away_value`, `spread_away_odds`, `moneyline_home_odds`, `moneyline_away_odds`, `total_value`, `total_over_odds`, `total_under_odds`, `opened_at`
- **Natural key used in 7E:** `game_id + lower(vendor)`
- **Timing:** median **22.57 hours** pre-tip. Label: **Opening Snapshot**. Certified **2026-03-09 → 2026-03-22** only. Coverage degrades beginning March 23.
- **Sportsbook opening rows:** 965. Deterministic matches: **945 / 965 = 97.9%**. Unmatched: 20 Rebet.

Backfill must key off **S3 `game_id` lists**, not a UTC `start_time` between those calendar dates. A UTC filter on `analytics.games` returned 105 games vs 107 archive objects (ET/UTC boundary). The archive inventory is the source of truth.

---

## Existing Analysis Logic

Primary source: `scripts/archive/analyze-market-intelligence.ts`  
Certified outputs: `reports/trial/market-intelligence-analysis.md` + `.json`

Supporting: `lib/archive/opening-player-props.ts`, `lib/archive/opening-game-odds.ts`, `lib/betting/odds-utils.ts`, `lambda/player-props-snapshot/src/normalize.ts`

### Product-ready — extract, do not rewrite

| Logic | Location | Notes |
| --- | --- | --- |
| American → raw implied probability | `americanToImpliedProb` + 7E `impliedFromAmerican` | Use 7E null handling (0 → null) |
| Canonical prop alias map | `PROP_ALIAS` / `CANONICAL_PROPS` in 7E | Internal PRA = `points_rebounds_assists` |
| Vendor lowercasing | `lower(vendor)` / `lower(sportsbook)` | No fuzzy match |
| Ambiguous simultaneous lines | group by key, `Set(line)` size > 1 | Exclude the whole group |
| Open→Close prop match | same key into PDL over/under slots | Deterministic |
| Open→Close game match | `game_id + lower(vendor)` vs last pre-tip history | Deterministic |
| Movement taxonomy A–D | `taxonomy()` | Juice threshold **2pp**; any nonzero line delta |
| Interpolating median | `quantile(xs, 0.5)` | Used for consensus |
| Game-odds outlier flags | spread abs ≥ 8, total abs ≥ 10, consensus diverge ≥ 6 | Store flag; do not drop raw |

### Research-script-only — do not copy into the API as a blob

- S3 listing, sample-key capture, isolation byte checks, injury/advanced-stats joinability
- Quality-tier matrix used to **choose** the v1 universe (already chosen)
- Book “sharpness” descriptives (FanDuel move rate, etc.) — never product copy
- Closing-convergence percentages — not v1 UI
- Prediction-market separation bookkeeping — keep as a filter, not a feature

### Do not use for v1 movement

- `summarizePropMovement()` in `lib/betting/prop-market-compare.ts` — first vs last `player_prop_lines` snapshot
- `analytics.player_prop_movement_summary` / `game_line_movement_summary` transformers
- Stored `implied_probability` columns as the movement metric (7E **recomputed** from American odds)
- Raw American-odds subtraction

There is **no** existing shared `classifyMovement()` module. Step 11B should extract one from the 7E script into `lib/betting/`.

---

## Frontend Audit

Primary nav (`components/betting/primary-nav.ts`): Dashboard, Teams, **Props Explorer**, Saved, Paper, Profile. No Market Movement page.

| Route | What it renders | APIs | Reuse? |
| --- | --- | --- | --- |
| `/betting/props-explorer` | Prop table + market sidebar/drawer | `GET /api/betting/props-explorer`, `GET /api/betting/props-explorer/market` | **Yes — first surface.** Replace the movement block; keep shopping/range. |
| `/betting/games/[gameId]` | Odds card + `LineMovementChart` (preferred book timeline) | `GET /api/betting/games/[gameId]/details` → `getGameOdds`, `getLineMovement` | Later. Chart is poll history, not Opening Snapshot. |
| `/betting/players/[playerId]` | Manual line analysis (`BettingLinePanel`); `FutureOddsPlaceholderCard` (“Odds integration coming soon”) | `GET /api/betting/players/[playerId]/props` (mostly empty live table) | Not first. Placeholder is honest; don’t pretend current odds exist. |
| `/betting` dashboard | Slate + trending players | `/api/betting/games` | No |

`PropsExplorerMarketPanel` already shows: selected book/line, market range (min/max/book count), Pro line-shopping, Pro movement (open line / close line / delta **in points only**). Entitlement keys already exist: `line_shopping_detail`, `market_movement`.

**Replace rather than extend:** the movement section’s data path (`player_prop_lines` first/last snapshot) and copy (“open-to-close when snapshot history exists”). It is not 3-Hour Pre-Tip and will be empty/wrong for the 129-game historical set.

**Keep:** auth (`requireBettingAuth`), sanitize (`sanitizePropMarketResearch`), range preview for Free, book-cap patterns, “do not coerce missing lines to 0” (`line-movement-series.ts`).

Do not add a dedicated Market Movement page in v1.

---

## v1 Product Scope

User question: **How has the market changed, and how much agreement is there across books?**

### Player props

- Books: `betmgm`, `fanduel`, `draftkings`, `caesars`
- Markets: `points`, `rebounds`, `assists`, `threes`, `points_rebounds`, `points_assists`, `points_rebounds_assists` (display **PRA**)
- Reference: **3-Hour Pre-Tip** (exactly 3.0h)
- Comparison (v1): last pre-tip **decision line** (`research.prop_decision_lines`)
- Certified set: 129 games, 24,412 product-grade Open→Close matches, 31.8% meaningful (B+C+D)

### Game odds (schema in 11B, UI later)

- Reference: **Opening Snapshot**
- Window: **2026-03-09 → 2026-03-22** (107 games, 945 matched sportsbook rows)
- Consensus: median across product-grade sportsbooks (outliers exist)
- Not season-wide. Not mixed into player-prop cards.

### Out of v1

BetRivers variants, Fanatics, blocks, steals, rebounds_assists, DD/TD, Betway, Polymarket/Kalshi in the sportsbook UI, live ingestion, WOWY, Role Check, possessions, Historical Explorer redesign, profitability/CLV claims.

---

## Movement Semantics

Reuse Step 7E **verbatim**. Constants:

```
JUICE_PP_2 = 0.02   // 2 implied-probability points
lineMoved  = abs(closeLine - openLine) >= 1e-9
juiceMeaningful = any(abs(closeImplied - openImplied) >= 0.02) among sides that exist on both snapshots
```

| Class | Rule (7E JSON `movementTaxonomy.definition`) | n | % of 24,412 |
| --- | --- | ---: | ---: |
| **A — Quiet** | line unchanged + implied-prob move **< 2pp** | 16,652 | 68.2 |
| **B — Juice Movement** | line unchanged + implied-prob move **≥ 2pp** | 4,171 | 17.1 |
| **C — Line Movement** | line changed, price move **< 2pp or missing** | 776 | 3.2 |
| **D — Line + Price Movement** | line changed **and** implied-prob move **≥ 2pp** | 2,813 | 11.5 |

Rows with missing open or close **line** are skipped (`unclassified`), not forced into A.

**Unchanged line is not “no market movement.”** A vs B is the product distinction.

The “14.7% moved ≥ 1.0” table is **descriptive only**. Taxonomy C/D fires on **any** line change, including 0.5.

Juice uses **either** over or under side (`some >= 2pp`). Display both deltas when present.

5pp was an analysis cut only (`JUICE_PP_5 = 0.05`). **Do not** use 5pp as the product class boundary.

Game odds: 7E did **not** define A–D for spread/total. v1 game serving stores numeric deltas + ML implied-prob deltas + outlier flags. Do not invent a second taxonomy.

---

## Consensus Semantics

### Player props

7E multi-book definition: unique vendors **≥ 2** on the same `(game_id, player_id, canonical prop)` among the four v1 books.

| Fact | Value |
| --- | --- |
| Product-grade matched book-rows | 24,412 |
| Unique multi-book markets (≥2) | **7,029** |
| Book-rows that participate in those markets | 20,564 |
| Single-book matched rows (no consensus) | 3,848 |
| Mean books in a multi-book market | **2.92** |
| All four books agree (among ≥2) | **70%** |
| Range ≥ 1.0 | 30% (0.5 splits are rare) |

Per-book matched n: BetMGM 8,848; FanDuel 7,136; DraftKings 4,802; **Caesars 3,626** (coverage bottleneck). Almost all Caesars rows already sit in multi-book markets (3,549 / 3,626).

**Recommended consensus availability: ≥ 2 v1 books.**

- Matches the certified 7E universe (7,029 markets).
- Requiring 3 is **not counted** in 7E.
- Requiring 4 is capped by Caesars and would throw away most of the 7,029 set.

When `bookCount < 2`: return book-level movement only; `consensus.available = false`; **do not** emit a fake median.

Median: **interpolating `quantile(lines, 0.5)`** (7E). Even-n example: 25.5 and 26.5 → **26.0**. UI must also show **range** so a midpoint that no book printed is not mistaken for a printed line.

Range: `min → max` of distinct vendor lines (one line per vendor after de-dupe).

Agreement count (v1): number of v1 books whose line equals the median within `1e-9`. Optional; range + bookCount are sufficient.

### Game odds

Keep **median** across the nine product-grade sportsbooks (exclude Betway; keep Polymarket/Kalshi out of sportsbook consensus). Medians exist specifically because of outliers (`18447469`, `18447845`, etc.).

---

## Historical vs Live Semantics

| Side | v1 historical (ship this) | Later live (do not activate now) |
| --- | --- | --- |
| Player reference | S3 3-Hour Pre-Tip | same snapshot if captured; otherwise no reference |
| Player comparison | `research.prop_decision_lines` (`decision_close`) | current multi-book board (`live_current`) — **not ready** |
| Game reference | S3 Opening Snapshot, Mar 9–22 only | n/a until a new certified window |
| Game comparison | last pre-tip `game_odds_history` | `game_odds_current` / history tail |

Same serving grain works for both if every row carries:

- `reference_label`: `3_hour_pre_tip` | `opening_snapshot`
- `comparison_source`: `decision_close` | `last_pre_tip_history` | `live_current`
- coverage metadata (see below)

**Do not** compare 3-Hour Pre-Tip to `player_prop_current` (DraftKings-only) and call it “the market.”

Frozen ingestion: live cadences are historical (props ~1 min when live; 30-minute shopping freshness already in code). Irrelevant until thaw.

---

## Proposed Serving Architecture

**Option B (recommended): separate compact tables**

- `analytics.player_prop_market_movement`
- `analytics.game_odds_market_movement`

Raw archives stay in S3. No dump of provider JSON into Postgres.

| Option | Verdict |
| --- | --- |
| A. One generic snapshot table + view | Reject for v1. Player grain includes `player_id + prop_type`; game grain is `game + vendor` with spread/total/ML. Reference labels and vendor universes differ. |
| B. Separate tables | **Accept.** Matches existing `player_prop_*` vs `game_odds_*` split. |
| C. Materialized movement rows from S3/research | **Accept as the write path** into B. Historical rows are immutable; upsert by natural key. |

Consensus is **not** a third table (see next section).

Do not upsert into `player_prop_movement_summary` or `game_line_movement_summary`.

---

## Player Prop Grain

**One row per** `game_id + player_id + prop_type + vendor`  
v1 universe only (4 books × 7 markets × deterministic non-ambiguous matches).

Minimal columns:

```
game_id text not null
player_id text not null
player_name text null
prop_type text not null          -- canonical, including points_rebounds_assists
vendor text not null             -- canonical lowercase
vendor_raw text null             -- original provider string if different

reference_label text not null    -- '3_hour_pre_tip'
reference_line numeric null
reference_over_odds integer null
reference_under_odds integer null
reference_at timestamptz null    -- opened_at

comparison_source text not null  -- v1: 'decision_close'
comparison_line numeric null
comparison_over_odds integer null
comparison_under_odds integer null
comparison_at timestamptz null   -- decision_at

line_delta numeric null
over_implied_prob_delta numeric null   -- close - open, raw implied in [0,1]
under_implied_prob_delta numeric null
movement_class text not null     -- A|B|C|D|unclassified

backfill_revision text not null
created_at timestamptz not null
updated_at timestamptz not null
```

PK: `(game_id, player_id, prop_type, vendor)`

Nullable lines/odds: missing price is allowed; missing both lines → `unclassified`.

Do **not** store vig-normalized probabilities. Do **not** store American-odds deltas.

Expected rows: **~24,412**. Do not store excluded BetRivers/unmapped rows in this table (absence + static coverage catalog handles empty states).

---

## Game Odds Grain

**One row per** `game_id + vendor` (matches S3 and `game_odds_history`).

v1 population: **945** deterministic sportsbook matches in the certified window. Exclude prediction markets from this table. Attach `outlier_class` on the five 7E flagged rows; do not delete them.

```
game_id text not null
vendor text not null
vendor_raw text null
outlier_class text null   -- suspicious_opening_snapshot | suspicious_vendor_move_vs_consensus | aligned_with_cross_book_consensus | null

reference_label text not null    -- 'opening_snapshot'
certified_window_start date not null  -- 2026-03-09
certified_window_end date not null    -- 2026-03-22
reference_home_spread numeric null
reference_home_spread_odds integer null
reference_away_spread numeric null
reference_away_spread_odds integer null
reference_total numeric null
reference_over_odds integer null
reference_under_odds integer null
reference_home_ml integer null
reference_away_ml integer null
reference_at timestamptz null

comparison_source text not null  -- v1: 'last_pre_tip_history'
comparison_* (same shape as reference)
comparison_at timestamptz null

spread_delta numeric null
total_delta numeric null
home_ml_implied_prob_delta numeric null
away_ml_implied_prob_delta numeric null

backfill_revision text not null
created_at / updated_at
```

PK: `(game_id, vendor)`

Moneyline product metric is **implied-probability delta**, never home_ml_close − home_ml_open.

---

## Coverage Metadata

Put metadata on **every API response**, not only on empty states. Hard-code a coverage catalog in `lib/betting/` (not a SQL table) so the UI cannot omit it.

Player response:

```
coverage: {
  referenceLabel: '3_hour_pre_tip',
  referenceDisplay: '3-Hour Pre-Tip',
  comparisonSource: 'decision_close',
  comparisonDisplay: 'Closing line (last pre-tip)',
  books: ['betmgm','fanduel','draftkings','caesars'],
  markets: [...],
  gameCountCertified: 129
}
```

Game response:

```
coverage: {
  referenceLabel: 'opening_snapshot',
  referenceDisplay: 'Opening Snapshot',
  certifiedHistoricalWindow: { start: '2026-03-09', end: '2026-03-22' },
  comparisonSource: 'last_pre_tip_history',
  notSeasonWide: true,
  coverageDegradesFrom: '2026-03-23'
}
```

UI copy rules: never render `opening_snapshot` as “season opening line.” Never render `3_hour_pre_tip` as “market open.”

---

## Variant Policy

**Problem:** BetRivers opening archive contains **1,827 groups / 5,024 rows** with **two or more simultaneous lines** for the same `(game, player, vendor, canonical prop)`. 7E: 100% of ambiguous groups are BetRivers. Picking any one line would invent a market.

**v1:** exclude the entire ambiguous group. Do not store a BetRivers row in the serving table. Do not display BetRivers on Market Movement.

Pipeline representation for later (do not implement now):

| Status | Meaning |
| --- | --- |
| `deterministic` | single line for the key; eligible to match |
| `ambiguous_simultaneous_variants` | multiple lines same key; excluded as a group |
| `unsupported_market` | unmapped prop (DD/TD/other) or out-of-universe book/market |

No arbitrary BetRivers pick. v1.1+ may store variants as child rows with an explicit `variant_id` only after a provider field distinguishes them.

---

## Vendor / Prop Normalization

### Vendors

Canonical IDs (lowercase, exact):

`betmgm` | `fanduel` | `draftkings` | `caesars`

Display: BetMGM, FanDuel, DraftKings, Caesars (`displayVendor` in 7E).

Existing helpers (none is the shared product module yet):

- Lambda `normalizeSportsbook`: `vendor.trim().toLowerCase()`
- 7E `lower()` + `displayVendor()`
- `prop-market-compare` private `normalizeBook()`
- Onboarding `SPORTSBOOK_OPTIONS` is a **search list**, not a matcher — do not use it to fuzzy-map books

Preserve `vendor_raw` when the archive string differs in case/spacing. **No aliases, no contains-matching.**

Game-odds extra IDs (serving table, not player UI): `ballybet`, `betparx`, `betrivers`, `fanatics`, `rebet`. Excluded: `betway`. Separate: `polymarket`, `kalshi`.

### Prop types

Store 7E canonical strings, **not** display “PRA”:

| Internal | Display |
| --- | --- |
| `points` | Points |
| `rebounds` | Rebounds |
| `assists` | Assists |
| `threes` | Threes |
| `points_rebounds` | Points + Rebounds |
| `points_assists` | Points + Assists |
| `points_rebounds_assists` | PRA |

7E aliases to reuse: `pts`/`player_points` → points; `pra` → `points_rebounds_assists`; `three_pointers`/`3pt` → threes; etc.

Related but **different** maps (EV model, do not overload):

- `lib/betting/player-prop-inputs.ts` `PROP_TO_STAT` (`pra` → stat key `pra`)
- `lib/betting/track-b1-policy.ts` `propTypeToStatKey`

Extract `canonicalPropType()` from 7E. Do not introduce `PRA` as a stored value.

PDL already stores `points_rebounds_assists`. Opening S3 `prop_type` may be aliased; matcher must run the same `PROP_ALIAS` table.

---

## API Proposal

Stay under `/api/betting/*` with `requireBettingAuth`. Do **not** add unauthenticated `/api/markets/*`.

### First endpoint (11D, used by first UI)

**Extend** `GET /api/betting/props-explorer/market` with a `movementV1` object from the new table. Keep existing shopping fields.

Query params (already required): `game_id`, `player_id`, `prop_type`, `side`, `line_value`, `sportsbook`, optional `date`.

If `prop_type` is out of v1 universe: shopping may still work from decision lines; `movementV1.status = 'unsupported_prop'`.

### Dedicated read APIs (same step or immediately after, still no extra UI)

**`GET /api/betting/players/[playerId]/market-movement`**

- Query: `game_id` (required for v1), optional `prop_type`
- 404 player unknown; 200 empty payload if no certified rows (not 404)
- Returns markets[] for that player-game

**`GET /api/betting/games/[gameId]/market-movement`**

- Game-odds block + optional player-prop index
- If game outside certified odds window: `gameOdds.status = 'outside_certified_window'` with window metadata; player props may still exist (different 129-game set)

Errors:

- 401 unauthenticated
- 400 missing keys
- 500 unexpected
- Empty certified data is **200 + empty-state reason**, never fabricated zeros

---

## Frontend Contract

Server owns joins, implied prob, classification, vendor/prop canonicalization, consensus.

```ts
export type MovementClass = 'A' | 'B' | 'C' | 'D' | 'unclassified';

export type MarketSnapshot = {
  label: '3_hour_pre_tip' | 'opening_snapshot' | 'decision_close' | 'live_current';
  displayLabel: string;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  overImpliedProb: number | null; // raw, includes vig
  underImpliedProb: number | null;
  at: string | null; // ISO
};

export type BookMovement = {
  vendor: string;
  vendorDisplay: string;
  reference: MarketSnapshot;
  comparison: MarketSnapshot;
  lineDelta: number | null;
  overImpliedProbDelta: number | null; // comparison - reference, probability points as fraction
  underImpliedProbDelta: number | null;
  movementClass: MovementClass;
};

export type MarketConsensus = {
  available: boolean;
  reason: 'ok' | 'insufficient_books' | null;
  bookCount: number;
  medianLine: number | null;
  minLine: number | null;
  maxLine: number | null;
  booksReporting: string[];
};

export type PlayerPropMarketMovement = {
  gameId: string;
  playerId: string;
  playerName: string | null;
  propType: string;          // points_rebounds_assists
  propDisplay: string;       // PRA
  books: BookMovement[];     // 0–4
  consensus: MarketConsensus;
  coverage: PlayerCoverageMetadata;
  emptyReason: PlayerEmptyReason | null;
};

export type PlayerEmptyReason =
  | 'no_reference_snapshot'
  | 'no_comparison_line'
  | 'unsupported_prop'
  | 'ambiguous_variant_excluded'
  | 'book_missing_one_side'
  | 'outside_certified_prop_games';
```

UI must not compute implied probability or class. Implied-prob deltas are fractions (0.02 = 2pp); format in the client as “+2.1 pp”.

Existing Explorer `movement` (`openedLine`/`closedLine`/`delta`) should be **deprecated** once `movementV1` ships, not run in parallel with conflicting “open” meanings.

---

## Empty States

Never substitute `0` for missing lines or prices (same rule as `line-movement-series.ts`).

| Situation | API | UI |
| --- | --- | --- |
| No 3-Hour Pre-Tip row | omit book; if no books, `emptyReason: 'no_reference_snapshot'` | “No 3-Hour Pre-Tip snapshot” |
| Only one v1 book | book movement yes; `consensus.available = false`, `reason: 'insufficient_books'` | Show the one book; hide consensus median |
| Missing over or under price | odds/implied null; juice on that side omitted; class may still be C if line moved | “—” for that price |
| Unsupported prop | `emptyReason: 'unsupported_prop'` | No movement module |
| Ambiguous variant (BetRivers) | not in serving table; if client asks for betrivers, `ambiguous_variant_excluded` | “This book’s opening lines are not unique — excluded from v1” |
| No closing decision line | no serving row (7E unmatched); `no_comparison_line` | “No closing line to compare” |
| Book on open but not close (or reverse) | no matched row for that vendor | Book omitted; others still shown |
| Game outside opening-odds window | game endpoint 200 + `outside_certified_window` | “Opening Snapshot coverage is 9–22 Mar 2026 only” |
| Player game not in 129-game prop archive | `outside_certified_prop_games` | Don’t imply season-wide 3-hour history |

---

## Storage / Performance Estimate

| Table | Rows | Est. heap + indexes |
| --- | ---: | ---: |
| `player_prop_market_movement` | ~24,412 | **~4–8 MB** |
| `game_odds_market_movement` | ~945 | **< 0.5 MB** |
| **Total add** | ~25k | **≪ 10 MB** on a 327 MB DB |

Indexes:

- PK `(game_id, player_id, prop_type, vendor)` — Explorer + player-game
- `(player_id, game_id)` — player page
- `(game_id)` — game page
- Game table PK `(game_id, vendor)` + `(game_id)`

Query pattern: point lookup by player-game-prop (4 rows) or game (≤9 rows). No scans of 63k history. **No DB growth risk** at historical v1 scale.

Live later: upsert comparison columns in place (same ~25k keys), not append-only clones of `player_prop_history`.

---

## Migration Proposal (Step 11B — do not run now)

New files under `db/schemas/`. Simple `text` + check constraints. No enums (easier to extend `live_current`). No generic sportsbook JSON.

```sql
create table if not exists analytics.player_prop_market_movement (
  game_id text not null,
  player_id text not null,
  player_name text,
  prop_type text not null,
  vendor text not null,
  vendor_raw text,
  reference_label text not null,
  reference_line numeric,
  reference_over_odds integer,
  reference_under_odds integer,
  reference_at timestamptz,
  comparison_source text not null,
  comparison_line numeric,
  comparison_over_odds integer,
  comparison_under_odds integer,
  comparison_at timestamptz,
  line_delta numeric,
  over_implied_prob_delta numeric,
  under_implied_prob_delta numeric,
  movement_class text not null,
  backfill_revision text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_prop_market_movement_pk
    primary key (game_id, player_id, prop_type, vendor),
  constraint player_prop_mm_reference_label_chk
    check (reference_label = '3_hour_pre_tip'),
  constraint player_prop_mm_comparison_source_chk
    check (comparison_source in ('decision_close', 'live_current')),
  constraint player_prop_mm_class_chk
    check (movement_class in ('A', 'B', 'C', 'D', 'unclassified')),
  constraint player_prop_mm_vendor_chk
    check (vendor in ('betmgm', 'fanduel', 'draftkings', 'caesars')),
  constraint player_prop_mm_prop_chk
    check (prop_type in (
      'points', 'rebounds', 'assists', 'threes',
      'points_rebounds', 'points_assists', 'points_rebounds_assists'
    ))
);

create index if not exists analytics_player_prop_mm_player_game_idx
  on analytics.player_prop_market_movement (player_id, game_id);
create index if not exists analytics_player_prop_mm_game_idx
  on analytics.player_prop_market_movement (game_id);

create table if not exists analytics.game_odds_market_movement (
  game_id text not null,
  vendor text not null,
  vendor_raw text,
  outlier_class text,
  reference_label text not null,
  certified_window_start date not null,
  certified_window_end date not null,
  reference_home_spread numeric,
  reference_home_spread_odds integer,
  reference_away_spread numeric,
  reference_away_spread_odds integer,
  reference_total numeric,
  reference_over_odds integer,
  reference_under_odds integer,
  reference_home_ml integer,
  reference_away_ml integer,
  reference_at timestamptz,
  comparison_source text not null,
  comparison_home_spread numeric,
  comparison_home_spread_odds integer,
  comparison_away_spread numeric,
  comparison_away_spread_odds integer,
  comparison_total numeric,
  comparison_over_odds integer,
  comparison_under_odds integer,
  comparison_home_ml integer,
  comparison_away_ml integer,
  comparison_at timestamptz,
  spread_delta numeric,
  total_delta numeric,
  home_ml_implied_prob_delta numeric,
  away_ml_implied_prob_delta numeric,
  backfill_revision text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_odds_market_movement_pk
    primary key (game_id, vendor),
  constraint game_odds_mm_reference_label_chk
    check (reference_label = 'opening_snapshot'),
  constraint game_odds_mm_comparison_source_chk
    check (comparison_source in ('last_pre_tip_history', 'live_current')),
  constraint game_odds_mm_window_chk
    check (
      certified_window_start = date '2026-03-09'
      and certified_window_end = date '2026-03-22'
    )
);

create index if not exists analytics_game_odds_mm_game_idx
  on analytics.game_odds_market_movement (game_id);
```

Optional FKs to `analytics.games` / `analytics.players` — yes if 11B confirms every S3 `game_id` exists (7E join was 107/107 for odds games). If any archive id is missing, **do not** add the FK until repaired; serving can still store the text id.

No RLS change in 11B (existing analytics tables are already RLS-off; inherited risk, not introduced here).

---

## Backfill Proposal (Step 11C — do not run now)

Inputs:

- S3 player prefix (129 objects)
- `research.prop_decision_lines`
- S3 game prefix `window=2026-03-09_to_2026-03-22`
- `analytics.game_odds_history` last pre-tip per `(game_id, lower(vendor))` — same SQL as 7E `distinct on`

Rules:

- Zero BDL HTTP. Read-only S3 + Postgres reads; writes **only** to the two new tables.
- Extract matcher/taxonomy from 7E into `lib/betting/market-movement.ts`. The backfill imports it. The analysis script should call the same functions (thin wrapper) so counts cannot drift.
- Idempotent `INSERT … ON CONFLICT (pk) DO UPDATE` keyed by natural PK. `backfill_revision` constant per run.
- Resumable: iterate S3 `game_id=*.json`; skip games already at this revision if desired.
- Quality gates (props): canonical prop in v1 set; vendor in v1 set; not ambiguous; close match exists; recompute implied from American odds (0/null → null).
- Quality gates (games): sportsbook class; skip polymarket/kalshi/betway; match exists; attach outlier_class from 7E rules (recomputed, not hardcoded game ids except as regression fixtures).
- Certification vs 7E JSON: matched product-grade prop rows **24,412**; taxonomy A/B/C/D counts; game sportsbook matches **945**; 0 HTTP; DB size delta ≈ new tables only.

Do not write to PDL, history, current, or S3.

---

## Testing Plan

### Unit (11B, before backfill)

- American → implied: +150, −110, −100, +100, `null`, `0`, `NaN`
- Taxonomy: quiet; juice-only; line-only; line+juice; missing line; missing prices with line change → C
- Vendor: `FanDuel` → `fanduel`; unknown vendor stays unmatched (no fuzzy)
- Prop: `PRA`/`pra` → `points_rebounds_assists`; `double_double` → null
- Consensus: 1 book → unavailable; 2 books 25.5/26.5 → median 26.0, range 25.5–26.5; 3 books; 4 books agree
- ML: implied delta, not American subtraction

### Integration (11C–11D)

- Deterministic reconstruction: fixture S3 JSON + fixture PDL rows → exact serving row
- Idempotent second backfill: row count unchanged
- API contract: coverage metadata always present; empty reasons; no `0` for missing line

### Regression fixtures (from 7E)

| Fixture | Assertion |
| --- | --- |
| Unchanged line + ≥2pp juice | class B |
| Line change | class C or D |
| Four books, 70% agree case vs ≥1.0 range | consensus + range |
| Game `18447469` DK/BetMGM | `suspicious_opening_snapshot` |
| Game `18447808` DK total +10 | `aligned_with_cross_book_consensus` (legitimate) |
| Missing comparison book | vendor omitted, others remain |
| BetRivers two lines | no serving row; empty reason if requested |

No tests implemented in 11A.

---

## Recommended First UI Surface

**D — enhance the existing Props Explorer market panel** (`PropsExplorerMarketPanel` movement section).

Why this one:

- Users already select a player-prop row.
- Nav already has Props Explorer.
- `market_movement` entitlement and sanitize path already exist.
- Historical Explorer already reads the 129-game decision-line set.
- Smallest path to “how did this market move, and do books agree?”

What to replace: the current open/close **point-delta** fed by `player_prop_lines`.

What not to build first: dedicated page (C), game-page Opening Snapshot section (B — 107-game window is easy to mislabel as season-wide), player-page card (A — still a “coming soon” odds placeholder and weaker selection context).

Game-page Market Movement is the **second** surface after 11E.

---

## Free / Pro Recommendation

Do not over-paywall the first useful experience. Align with current Explorer gating.

| | Free | Pro (`market_movement`) |
| --- | --- | --- |
| Comparison (close) line for selected book | yes | yes |
| Consensus median / min–max / book count at **comparison** | yes (same as today’s range preview) | yes |
| 3-Hour Pre-Tip snapshot | no | yes |
| Line delta, implied-prob delta, class A–D | no | yes |
| Book-by-book reference vs comparison | no | yes |
| Line shopping best book/price | unchanged (`line_shopping_detail`) | unchanged |

Free copy: current/close consensus only. Pro copy: “3-Hour Pre-Tip vs close.” Do not implement access-control changes in 11B–11C.

Update `UPGRADE_COPY.market_movement.detail` in 11F so it no longer says “when snapshot history exists.”

---

## Controlled Implementation Sequence

### Step 11B — schema + shared market math

- Migration for the two tables (unpopulated).
- Extract `americanToImpliedProb` (null-safe), `canonicalPropType`, `canonicalVendor`, `classifyPropMovement`, `median`, `lineRange` into `lib/betting/`.
- Point 7E script at the shared functions **or** leave script frozen and copy with tests that pin 7E constants — prefer **one implementation**.
- Unit tests. No backfill. No API. No UI.

### Step 11C — historical backfill + certification

- S3 + PDL + history → upsert serving rows.
- Certify 24,412 / A–D / 945 against 7E JSON.
- Report + `backfill_revision`. Stop.

### Step 11D — read API / contract

- Extend `/api/betting/props-explorer/market`.
- Add player + game GET as specified.
- Empty states + coverage metadata.
- Sanitize: Free strips reference/class/per-book deltas.

### Step 11E — first UI

- Replace Explorer movement block only.
- Verify historical date + v1 prop + missing snapshot paths.

### Step 11F — polish / Free–Pro copy / remaining tests

- Upgrade copy, chart-adjacent empty states, regression fixtures.

Each step stays individually reviewable. Do not start 11B until this document is accepted (or the YELLOW questions are answered).

---

## Risks / Open Questions

These are why the verdict is **YELLOW**, not GREEN. Recommended default in **bold**.

1. **Reuse vs replace Explorer `movement`.** Existing Pro field is first/last `player_prop_lines` snapshot. **Replace with `movementV1` in 11D/11E; do not show two “opens.”**
2. **Even-n interpolating median (25.5 + 26.5 → 26.0).** Faithful to 7E; can look like a printed line. **Keep interpolating median; always show range.**
3. **Game-odds table in 11B.** UI is not first. **Create the table + backfill in 11B/11C anyway** (945 rows); hide from 11E.
4. **Live comparison later** depends on a real multi-book current table. `player_props_current` is empty; `player_prop_current` is DK-only. **Out of scope; do not pretend 11B solves live.**
5. **FK to `analytics.games`.** Use S3 game ids; confirm 129/107 exist before adding FKs. UTC date filters are wrong.
6. **Inherited RLS-off on analytics/research.** Do not enable blindly in 11B; serving tables would match current analytics posture unless security work is scheduled separately.
7. **7E script vs extracted module drift** if 11B copies formulas instead of importing them. **One module.**

Not open: juice threshold (2pp), v1 books/markets, BetRivers exclusion, terminology, no BDL, no thaw.

---

## Verification Checklist

1. Confirm you want **Option B** (two compact tables) and **not** reuse `*_movement_summary`.
2. Confirm consensus availability **≥ 2 books**, interpolating median + visible range.
3. Confirm first UI is **Props Explorer market panel**, game page later.
4. Confirm 11B may create **both** player and game serving tables, with UI only on props in 11E.
5. Confirm Free sees comparison consensus only; Pro sees 3-Hour Pre-Tip + class + per-book deltas.
6. After sign-off, 11B is schema + shared math only — still no backfill until 11C.
7. Re-read coverage copy: never “market open” / never “season-wide opening odds.”

---

## Step Verdict

`YELLOW — design is viable but one or more architecture questions need review`

The certified 7E methodology, S3 archives, and PDL/history closes are sufficient to implement a compact serving layer. The YELLOW items are product/architecture choices (replace existing movement, median display, whether to migrate game-odds serving before its UI), not missing data.

---

## What this step did not do

- No BALLDONTLIE requests
- No Production flag / ingestion-mode changes
- No live ingestion
- No WOWY, possessions, Role Check, Opportunity Check
- No Historical Explorer redesign
- No market serving tables created
- No migrations run
- No historical research data modified
- No raw S3 dump into Postgres
- No website redesign
- No existing market-calculation changes (`odds-utils` left as-is until 11B extraction)

---

## Implied-probability handling (audit detail)

`lib/betting/odds-utils.ts` `americanToImpliedProb`:

- Negative (`<= 0`): `|odds| / (|odds| + 100)` — **treats 0 as 0%**, which is wrong if 0 ever arrives
- Positive: `100 / (odds + 100)`
- Even money should be **+100 or −100 → 0.5**, not American 0

7E wraps it with `oddsAmerican()`: **0 → null**, then `americanToImpliedProb`. Juice math used **raw** per-side implied probability. **Not vig-normalized.**

Duplicates: props-explorer, player props route, parlay-summary, lambda normalize, SQL `analytics.american_to_implied_prob` (0 → 0%).

**v1 display:** raw implied probability (includes vig), labeled as such. **Do not** vig-normalize (would change 7E). **Do not** subtract American odds. **Do** treat 0/null/NaN as missing.

---

## Existing Market Architecture (one-line map)

```
S3 opening archives  --reference-->  NEW compact serving tables  --read-->  betting APIs / Explorer
PDL / last pre-tip history  --comparison-->  same serving tables
player_prop_history / movement_summary / lines  --do not use for v1 "open"--
player_props_current (empty) / player_prop_current (DK)  --live later, not now--
```
