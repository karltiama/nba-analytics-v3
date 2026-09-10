# Market Movement v1 — API Integration (Step 11D)

Generated: 2026-09-09  
Status: **certified serving rows wired into existing Props Explorer market API. No UI. No live/current ingestion.**

**Step verdict:** `GREEN — certified Market Movement API is ready for Props Explorer UI integration`

Do not start Step 11E until this report is reviewed.

---

## Safety / Scope

Confirmed before and after implementation:

| Guardrail | Status |
| --- | --- |
| BDL HTTP | **0** |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Production ingestion | Frozen |
| Historical backfill rerun | **Not run** (read-only verification only) |
| S3 | Untouched |
| Serving-table schema | Untouched (no migration, no FKs, no consensus columns) |
| Props Explorer UI | **Unchanged** |
| Historical Explorer / Role / Opportunity / WOWY | Untouched |
| `live_current` population | **0** (`comparison_kind = decision_close` on all 21,132 player rows) |
| Game-odds public route | **Not added** |
| Movement math | Unchanged (`lib/betting/market-movement.ts` classifiers / median) |

This step is API + response contract + tests only.

---

## Existing Props Explorer API Audit

**Route:** `GET /api/betting/props-explorer/market`  
**Handler:** `app/api/betting/props-explorer/market/route.ts` (pass-through; no new endpoint)

### Query params (unchanged)

| Param | Required | Role |
| --- | --- | --- |
| `game_id` | yes | Market identity |
| `player_id` | yes | Market identity |
| `prop_type` | yes | Market identity |
| `side` | yes | Selected Explorer row |
| `line_value` | yes | Selected Explorer row |
| `sportsbook` | yes | Selected Explorer row |
| `snapshot_at` | no | Freshness / live shopping |
| `odds_american` | no | Selected price |
| `date` | no | ET calendar date for historical vs live context |

Missing identity keys still return **400** `{ error: 'Missing market keys' }`.

### Auth / access (unchanged)

1. `requireBettingAuth` — unauthenticated → **401**
2. `getPropMarketResearch(...)` computes the full payload
3. `getUserEntitlements` + `sanitizePropMarketResearch` strip Pro fields for Free

No new subscription product or billing work.

### Pre-11D response shape

```
{
  marketContext, lineLabel, comparisonLabel, paperBetAllowed,
  selected,          // the Explorer row
  shopping,          // book comparison board
  movement,          // LEGACY first/last player_prop_lines snapshots
  entitlement
}
```

### Pre-11D DB reads

| Path | Source |
| --- | --- |
| Historical shopping | `research.prop_decision_lines` |
| Live shopping (when not frozen) | latest `analytics.player_prop_lines` snapshot |
| Legacy `movement` | all `analytics.player_prop_lines` snapshots for selected book/side, first vs last |
| Date fallback | `analytics.games.start_time` if `date` omitted |

Legacy movement is produced by `summarizePropMovement` in `lib/betting/prop-market-compare.ts` from first-seen / last-seen polling snapshots. **That is not 3-Hour Pre-Tip.**

### Pre-11D `movement` contract

```
{
  status: 'ok' | 'unavailable',
  openedLine, closedLine, delta, from, to
}
```

UI copy: **“Opened {line} → Closed {line}”**.

---

## Consumers / Backward Compatibility

| Consumer | Reads |
| --- | --- |
| `components/betting/PropsExplorerMarketPanel.tsx` | `shopping.*`, legacy `movement.openedLine/closedLine/delta`, `entitlement` |
| `app/betting/props-explorer/page.tsx` | hosts the panel |
| `app/betting/saved/page.tsx` | hosts the same panel |

The panel does **not** read a certified historical object today. Changing or removing `movement` in 11D would blank the existing “Opened → Closed” line before 11E.

**11D choice:** additive field `marketMovement`. Legacy `movement` is unchanged.

The two fields are named differently on purpose. There is no second top-level Market Movement route.

---

## Certified Serving Query

Exclusive historical source: `analytics.player_prop_market_movement`.

SQL lives in `playerMarketMovementSql()` (`lib/betting/market-movement-api.ts`), executed by `getPlayerMarketMovement()` (`lib/betting/market-movement-server.ts`).

Grain: `game_id + player_id + prop_type` (canonical), `vendor = ANY(betmgm, fanduel, draftkings, caesars)`.

Regression guards (tests + SQL string):

- query **must** mention `analytics.player_prop_market_movement`
- query **must not** mention `player_prop_movement_summary`, `player_prop_lines`, or `player_prop_history`

Unsupported v1 props (`blocks`, `steals`, `rebounds_assists`, …) **do not query** the serving table (`status: 'unsupported_prop'`).

Game-odds helper `getGameOddsMarketMovementMeta` reads `analytics.game_odds_market_movement` for later reuse. **No public game-odds route.**

---

## Player Join Strategy

Serving rows have `player_name` null (11C). API joins `analytics.players.full_name` on `player_id` in the same SELECT (`LEFT JOIN`).

- Name-based joining: **none**
- Names are **not** written back into the serving table
- On a serving hit: player name comes from the join (1 query)
- On a serving miss: extra `SELECT full_name FROM analytics.players WHERE player_id = $1`
- On `unsupported_prop`: no player lookup (Explorer already has the display name)

---

## API Response Contract

Added on `PropMarketResearch`:

```ts
marketMovement: PlayerMarketMovementResponse
```

Types: `lib/betting/market-movement-api.ts`.

```ts
{
  status: 'ok' | 'empty' | 'unsupported_prop',
  reason: 'no_certified_historical_snapshot' | 'unsupported_prop' | null,
  sourceTable: 'analytics.player_prop_market_movement',
  detail: 'full' | 'summary',          // summary = Free sanitize
  market: {
    gameId,
    player: { id, name },
    propType,                          // stored canonical, e.g. points_rebounds_assists
    displayLabel                       // Points / PRA / 3-Pointers / ...
  },
  reference: { kind: '3_hour_pre_tip', label: '3-Hour Pre-Tip', timestamp },
  comparison: { kind: 'decision_close', label: 'Close', timestamp },
  consensus: {
    note: 'Consensus is a statistical median and may not correspond to a line offered by any individual sportsbook.',
    isStatisticalMedianNotAnOfferedLine: true,
    reference: { available, median, min, max, bookCount },
    comparison: { available, median, min, max, bookCount },
    lineDelta                          // comparison.median - reference.median, else null
  },
  books: [{
    vendor, vendorLabel,
    reference: { line, overOdds, underOdds, timestamp },
    comparison: { line, overOdds, underOdds, timestamp },
    movement: {
      lineDelta,
      overImpliedProbabilityDelta,     // decimal probability, e.g. 0.024 = 2.4pp
      underImpliedProbabilityDelta,
      class,                           // Quiet | Juice | Line | Line+Price
      classCode                        // A | B | C | D | unclassified (debug)
    }
  }],
  coverage: {
    referenceType: '3_hour_pre_tip',
    comparisonType: 'decision_close',
    historical: true,
    liveCurrent: false,
    eligibleBookCount,
    consensusMinimumBooks: 2,
    booksWithMeaningfulMovement        // count of classCode B/C/D; not a sentiment score
  }
}
```

The frontend must not calculate implied probabilities, movement class, median, range, book count, vendor normalization, or prop normalization.

No market sentiment score. No directional betting signal. No aggregate “dominant class.”

---

## Reference / Comparison Semantics

| Side | Internal kind | Product label |
| --- | --- | --- |
| Reference | `3_hour_pre_tip` | **3-Hour Pre-Tip** |
| Comparison | `decision_close` | **Close** |

`coverage.historical = true`, `coverage.liveCurrent = false` on every payload, including empty states.

Do not label this as true open, first print, or live current.

---

## Movement Mapping

Serving `movement_class` is **passed through**, not recomputed.

| DB | API `class` |
| --- | --- |
| A | Quiet |
| B | Juice |
| C | Line |
| D | Line+Price |
| unclassified | Unclassified |

`classCode` is preserved for debugging. Implied-probability deltas are decimal probability changes (not American-odds subtraction). No extra formatted percentage-point fields (existing APIs prefer raw numerics).

---

## Consensus Implementation

`playerPropConsensus()` from `lib/betting/market-movement.ts`. No new median logic in the route.

Eligible books: `betmgm`, `fanduel`, `draftkings`, `caesars`.  
Minimum: **2 books with usable line values**.

Even-book interpolating example: 25.5 + 26.5 → median **26.0**, range 25.5–26.5, `bookCount` 2. The median is **not** claimed as an offered sportsbook line (`isStatisticalMedianNotAnOfferedLine: true` + disclaimer `note`).

Do not call it “best line.”

---

## Reference vs Close Consensus

Both are returned:

- `consensus.reference` — 3-Hour Pre-Tip book lines
- `consensus.comparison` — decision-close book lines
- `consensus.lineDelta` — close median minus 3-Hour median when both available

This lets 11E show **3-Hour Consensus → Closing Consensus** without inferring from per-book rows.

Market-level extras kept conservative:

- dual consensus + `lineDelta`
- `coverage.booksWithMeaningfulMovement` (B/C/D count)

Omitted: dominant class, sentiment score, directional signal.

---

## Empty-State Behavior

Always a normal JSON success inside the existing 200 market payload (unless the request is 401/400/500 for unrelated reasons). **Never 500** for “no certified rows.” **Never fake zero lines/deltas.**

| Situation | `marketMovement.status` | `reason` | HTTP |
| --- | --- | --- | --- |
| ≥2 v1 books | `ok` | `null` | 200 |
| 1 v1 book | `ok` (book row present) | `null` | 200; `consensus.*.available = false` |
| No certified rows | `empty` | `no_certified_historical_snapshot` | 200 |
| Unsupported prop (e.g. blocks) | `unsupported_prop` | `unsupported_prop` | 200 |
| Missing request keys | n/a | n/a | **400** |
| Unauthenticated | n/a | n/a | **401** |

How 11E should distinguish:

| UI case | Signal |
| --- | --- |
| No certified 3-Hour snapshot | `status === 'empty'` (shopping may still be ok from PDL) |
| Unsupported prop | `status === 'unsupported_prop'` |
| Unsupported book universe | same as empty — non-v1 books never appear as v1 MM |
| No matching request | 400 missing keys, or empty if the ids are well-formed but absent |

---

## Prop / Vendor Presentation

| Stored `propType` | `displayLabel` |
| --- | --- |
| `points` | Points |
| `rebounds` | Rebounds |
| `assists` | Assists |
| `threes` | 3-Pointers |
| `points_rebounds` | Points + Rebounds |
| `points_assists` | Points + Assists |
| `points_rebounds_assists` | PRA |

Aliases such as `PRA` canonicalize server-side before lookup.

| `vendor` | `vendorLabel` |
| --- | --- |
| `betmgm` | BetMGM |
| `fanduel` | FanDuel |
| `draftkings` | DraftKings |
| `caesars` | Caesars |

No logos. No fuzzy vendor names. Unsupported books are dropped, not remapped.

---

## Auth / Free-Pro Considerations

Existing gate unchanged: betting auth, then `features.market_movement` (Founding Pro).

| Surface | Free (11D sanitize) | Pro |
| --- | --- | --- |
| Legacy `movement` | still blanked (`reason: 'entitlement'`) | first/last snapshots |
| `marketMovement.detail` | `summary` | `full` |
| Close / comparison consensus | **kept** | kept |
| 3-Hour reference consensus, timestamps, per-book rows, juice/line classes | **stripped** | kept |

11E/11F should key Free vs Pro off `detail` (and `entitlement.features.market_movement`), not invent a second flag.

Free payloads still include `reference.kind/label` metadata so the contract is stable; numbers and books are empty. **11E must not render “3-Hour Pre-Tip” history for `detail === 'summary'`.**

No billing work.

---

## Query Performance

Certified Market Movement path (tiny groups):

| Case | Queries |
| --- | --- |
| Serving hit | **1** (all v1 vendors + player join) |
| Serving miss | **2** (serving SELECT + `analytics.players`) |
| Unsupported prop | **0** |

Full existing Explorer research, when `date` is provided:

| Context | Queries |
| --- | --- |
| Historical | 3 = PDL shopping + legacy `player_prop_lines` movement + certified MM |
| Frozen current | 2 = legacy movement + certified MM (no live board read) |

No per-book round trips. No new cache.

---

## Legacy Movement Transition Plan

**11D (this step):** `marketMovement` is additive. UI still shows legacy “Opened → Closed.”

**11E:** Switch the panel to `marketMovement`:

- labels **3-Hour Pre-Tip → Close**
- per-book Quiet / Juice / Line / Line+Price
- dual consensus
- empty/unsupported states from `status` / `reason`
- Free: comparison consensus only (`detail === 'summary'`)
- Pro: books + 3-Hour snapshot (`detail === 'full'`)

**After 11E is verified:** deprecate and remove legacy `movement` from this route so the two meanings cannot coexist permanently.

Do not mount a second competing widget. Do not relabel first/last snapshots as 3-Hour Pre-Tip.

---

## Tests Added

| File | What |
| --- | --- |
| `lib/betting/__tests__/market-movement-server.test.ts` | SQL source guard; 0/1/2/4-book maps; PRA label; null odds; unsupported prop; player join; dual consensus; interpolating median; vendor drop; Free summarize; game helper table |
| `lib/betting/__tests__/prop-market-serving.test.ts` | research path issues certified SQL, not `player_prop_movement_summary` |
| `lib/entitlements/__tests__/sanitize-prop-market.test.ts` | Free keeps close consensus, strips 3-Hour books; Pro keeps classes |
| `lib/entitlements/__tests__/market-api.test.ts` | route 200 still additive; Free `detail: summary`; Pro `sourceTable` certified |
| `lib/betting/__tests__/market-movement.test.ts` | API display labels |

---

## Test Results

```
npx vitest run lib/betting/__tests__/market-movement.test.ts
  lib/betting/__tests__/market-movement-schema.test.ts
  lib/betting/__tests__/market-movement-backfill.test.ts
  lib/betting/__tests__/market-movement-server.test.ts
  lib/betting/__tests__/prop-market-serving.test.ts
  lib/entitlements/__tests__/sanitize-prop-market.test.ts
  lib/entitlements/__tests__/market-api.test.ts

Test Files  7 passed (7)
     Tests  75 passed (75)
```

---

## Real-Data Verification

Read-only `getPlayerMarketMovement` against the populated development serving table. No writes. No backfill.

Serving still: **21,132** player rows / **945** game rows / **6,286** consensus-eligible player markets.

| Scenario | Identity | Result |
| --- | --- | --- |
| Quiet 4-book | game `18447937`, player `101` John Collins, points | 4× Quiet, close consensus 12.5, `lineDelta` 0 |
| Juice | game `21681977`, player `100` Jordan Clarkson, points | FanDuel Juice (`overIpDelta` ≈ 0.024), 3× Quiet, close 4.5 |
| Line / Line+Price mix | game `18447959`, player `101`, points | FanDuel/Caesars Line, DraftKings Line+Price; ref median 11.5 → close 12.5 |
| Line+Price PRA | game `18447937`, player `101`, `points_rebounds_assists` | `displayLabel: PRA`, 2× Line+Price, 19.5 → 20.5 |
| Split consensus | game `18447974`, player `101`, points_rebounds | close 16.5 / 17.5 → median **17** (not an offered line) |
| Interpolating 25.5+26.5 | game `21681978`, player `666423` RJ Barrett, points_rebounds | median **26**, books 25.5 and 26.5 only |
| 1-book | game `21681977`, player `100`, PRA | 1 BetMGM row, `consensus.available = false`, `bookCount` 1 |
| Empty | game `0` / player `0` | `status: empty`, no zero lines |
| Unsupported | `blocks` | `status: unsupported_prop`, 0 serving queries |
| Game helper (not public) | game `18447469` | `opening_snapshot` → `last_pre_tip_history`, 9 vendor rows |

`sourceTable` was `analytics.player_prop_market_movement` on every player response.

---

## Files Changed

| File | Change |
| --- | --- |
| `lib/betting/market-movement.ts` | API display labels, class labels, consensus disclaimer |
| `lib/betting/market-movement-api.ts` | **New.** Contract, SQL strings, mapper, Free summarize (no `lib/db`) |
| `lib/betting/market-movement-server.ts` | **New.** Postgres accessors |
| `lib/betting/prop-market-serving.ts` | Additive `marketMovement` |
| `lib/entitlements/sanitize-prop-market.ts` | Free/Pro split for certified field |
| `lib/betting/__tests__/market-movement-server.test.ts` | **New** |
| `lib/betting/__tests__/market-movement.test.ts` | Display-label cases |
| `lib/betting/__tests__/prop-market-serving.test.ts` | Certified SQL regression |
| `lib/entitlements/__tests__/sanitize-prop-market.test.ts` | Certified sanitize |
| `lib/entitlements/__tests__/market-api.test.ts` | Route contract |
| `reports/product/market-movement-v1-api-integration.md` | This report |
| `reports/product/market-movement-v1-api-integration.json` | Machine-readable twin |

**Not changed:** Props Explorer UI, serving schema, backfill, game-odds public API, ingestion, S3.

---

## Risks / Open Questions

1. Some certified rows have `comparison_timestamp` earlier than `reference_timestamp` (decision clock vs 3-hour archive clock). The API does not reorder. **11E must label by `kind`/`label`, not by timestamp sort.**
2. Free JSON still carries `reference.label = '3-Hour Pre-Tip'` with null timestamp / empty books. Gate rendering on `detail === 'summary'`.
3. `shopping` from PDL can be `ok` while `marketMovement` is `empty` (decision lines exist, no 3-Hour archive match). That is a real empty state, not an error.
4. Game helper `vendorCount` includes every serving vendor (e.g. 9 on `18447469`), not the player 4-book allowlist. Acceptable because it is not a public route.
5. Legacy `movement` remains on the payload until 11E migrates the UI. Two movement concepts exist **only** during that transition, under different names.

---

## Recommendation for Step 11E

1. Keep using `GET /api/betting/props-explorer/market`. Do not add a second MM endpoint.
2. Render `marketMovement`, not legacy `movement`.
3. Copy: **3-Hour Pre-Tip → Close**. Never “Opened” / true open / live current.
4. Show per-book `class` (Quiet / Juice / Line / Line+Price) from the payload.
5. Show both consensus snapshots; print the disclaimer; do not treat interpolating medians as offered lines.
6. Empty / unsupported from `status` + `reason`.
7. Free: `detail === 'summary'` → close consensus only. Pro: books + 3-Hour.
8. After the panel is correct, remove legacy `movement` in a follow-up so the names cannot drift.

STOP. Do not modify the UI in 11D.

---

## Verification Checklist

1. Confirm `npx vitest run` on the seven files above is green.
2. Confirm `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`.
3. Open network tab on Props Explorer (unchanged UI) and confirm the market request still 200s; extra `marketMovement` is additive.
4. Spot-check John Collins `18447937` points: 4× Quiet, consensus 12.5.
5. Spot-check RJ Barrett `21681978` points_rebounds: median 26 from 25.5/26.5, no book at 26.
6. Confirm the panel still says “Opened → Closed” (legacy) until 11E.
7. Confirm no new public `/api/.../market-movement` route exists.

---

## Step Verdict

`GREEN — certified Market Movement API is ready for Props Explorer UI integration`
