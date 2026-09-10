# Market Movement v1 — Props Explorer UI (Step 11E)

Generated: 2026-09-09  
Status: **certified Market Movement is the Explorer panel movement UI. Legacy Opened → Closed removed. No new page/route. No live ingestion.**

**Step verdict:** `GREEN — certified Market Movement v1 is live in Props Explorer and ready for polish`

Do not start Step 11F until this report is reviewed.

---

## Safety / Scope

| Guardrail | Status |
| --- | --- |
| BDL HTTP | **0** |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Production ingestion | Frozen |
| Serving schema | Untouched |
| Historical serving writes | **0** |
| Backfill rerun | **Not run** |
| Game-odds UI | **Not built** |
| Historical Explorer / Role / Opportunity / WOWY | Untouched |
| New Market Movement page | **Not created** |
| New API route | **Not created** |
| Global design-system rewrite | **Not done** |

---

## Existing Panel Audit

`components/betting/PropsExplorerMarketPanel.tsx` is shared by:

- `app/betting/props-explorer/page.tsx` (sidebar + mobile drawer)
- `app/betting/saved/page.tsx` (same)

Pre-11E the panel read:

| Field | Use |
| --- | --- |
| `shopping` | Market range, best line/price, sportsbook comparison, Free upgrade |
| `movement.openedLine` / `closedLine` / `delta` | **“Opened → Closed”** under heading “Line moved” |
| `movement.reason === 'entitlement'` | Founding Pro upgrade copy |
| `entitlement.features.line_shopping_detail` | Premium shopping |
| `entitlement.isPro` | Gated the legacy movement block |

No other UI consumer of `openedLine` / `closedLine` / `response.movement` existed.

Loading: `data` is cleared while fetching (`Loading market comparison…`). Errors stay inside the panel; the Explorer table is unchanged.

---

## Certified Data Source Migration

The movement block now renders `data.marketMovement` via `presentPlayerMarketMovement` → `MarketMovementSection`.

It does **not** read `response.movement`.

Labels always come from API `reference.label` / `comparison.label` (**3-Hour Pre-Tip → Close**). Timestamps are not shown and are never used to order snapshots.

---

## Legacy Movement Removal

After the panel switch, no UI consumer of `response.movement` remained.

Removed from the Explorer market API in this same step:

- `PropMarketResearch.movement`
- `loadMovementPoints` / first-last `player_prop_lines` query
- Free sanitize of `openedLine` / `closedLine`

`GET /api/betting/props-explorer/market` now returns `shopping` + `marketMovement` only.

`summarizePropMovement` remains in `lib/betting/prop-market-compare.ts` with unit tests. It is **not** served. Documented leftover helper — candidate to delete in a later cleanup if still unused.

---

## Market Movement Summary

Pro primary answer:

**Market Movement**  
**3-Hour Pre-Tip → Close**

Then:

- 3-Hour Pre-Tip consensus median + range · book count  
- Close consensus median + range · book count  
- **Consensus movement** from `consensus.lineDelta` (not recalculated in React)

Reference is never called Open / Opening Line / Market Open / First Print.

---

## Consensus Presentation

When available:

`Consensus {median}`  
`{min}–{max} · N books` (or `{line} · N books` when min = max)

Plus the server disclaimer that consensus is a statistical median and may not be an offered sportsbook line.

Median / range / count / delta are formatted from API values. Interpolating 25.5 + 26.5 shows **Consensus 26** with range **25.5–26.5 · 2 books**, and no book row at 26.

---

## Per-Book Presentation

Pro only (`detail: full`). Max four stacked rows (BetMGM, FanDuel, DraftKings, Caesars).

Each row: book name, class label + explanation, 3-Hour quote, Close quote, line delta and/or price movement.

No logos. Grid collapses to one column on small screens (`grid-cols-1 sm:grid-cols-2`).

Odds follow the selected Explorer side (over/under). Missing line/odds render **—**, never 0/NaN.

---

## Juice / Line Movement Presentation

| Class | Copy | Extra |
| --- | --- | --- |
| Quiet | No meaningful movement | none |
| Juice | Price moved | `Price movement +2.4 pp implied probability` |
| Line | Line moved | signed line delta |
| Line+Price | Line and price moved | delta + pp |

No bullish/bearish/sharp-money language. No American-odds subtraction as the derived metric. Raw odds remain on the snapshot quotes (`12.5 -108`).

---

## Free Experience

`detail: summary` → **Market consensus** (Close median / range / count only).

Does not render 3-Hour values, per-book rows, or juice history.

Upgrade: **See how this market moved from 3 hours before tip** + existing `FoundingProUpgradeLink` (`/billing`). No billing logic.

---

## Pro Experience

`detail: full` → 3-Hour + Close consensus, consensus movement, per-book classes, line/juice as certified.

A/B/C/D codes are not shown as the product label (`class` is Quiet / Juice / Line / Line+Price). `classCode` stays on the API only.

---

## Empty / Unsupported / One-Book States

| `status` | UI |
| --- | --- |
| `empty` | **Historical Market Movement unavailable** — no certified 3-Hour Pre-Tip snapshot. No 0→current. No Opened → Closed fallback. |
| `unsupported_prop` | **Market Movement isn't available for this prop yet.** Not a data error. |
| 1 book, Pro | Book row shown. **Consensus unavailable · Requires at least 2 supported books.** That book’s line is not called consensus. |
| API failure | Panel error only (`Failed to load market comparison`). No silent legacy fallback. Explorer table stays. |

---

## Shopping Coexistence

Shopping (`Market range` / best book / comparison) is unchanged and **above** Market Movement.

`shopping.status === ok` + `marketMovement.status === empty` still shows shopping. Tested via `shoppingStillVisible('ok', 'empty')`.

---

## Responsive / Accessibility

- Stacked book rows; 2-column quotes from `sm:`
- Class meaning is text (`Quiet` + `No meaningful movement`), not color alone
- `sr-only` sentence: certified historical 3-Hour Pre-Tip to Close; not live / open / first print
- Section `aria-label`; book list `aria-label="Sportsbook movement"`
- Loading does not flash Opened → Closed (`setData(null)` until the certified payload arrives)

---

## Components / Types

| Piece | Role |
| --- | --- |
| `lib/betting/market-movement-format.ts` | Odds, line, signed delta, `+2.4 pp` |
| `lib/betting/market-movement-present.ts` | API → UI model (uses 11D types) |
| `components/betting/market-movement/MarketMovementSection.tsx` | Section + consensus + book rows |
| `PlayerMarketMovementResponse` | Unchanged 11D contract |

No parallel hand-written movement types in the panel.

---

## Tests Added

`lib/betting/__tests__/market-movement-present.test.ts`:

- Pro 3-Hour → Close (no Opened)
- Quiet / Juice / Line / Line+Price
- Split interpolating median
- One-book consensus unavailable
- Empty / unsupported
- Free hides 3-Hour values and books
- Shopping still visible when MM empty
- Inverted timestamps do not reorder
- Missing odds → em dash

Serving/API tests now assert **`movement` is absent** and certified SQL is not `player_prop_lines`.

---

## Test Results

```
npx vitest run lib/betting/__tests__/market-movement.test.ts
  lib/betting/__tests__/market-movement-schema.test.ts
  lib/betting/__tests__/market-movement-backfill.test.ts
  lib/betting/__tests__/market-movement-server.test.ts
  lib/betting/__tests__/market-movement-present.test.ts
  lib/betting/__tests__/prop-market-serving.test.ts
  lib/betting/__tests__/prop-market-compare.test.ts
  lib/entitlements/__tests__/sanitize-prop-market.test.ts
  lib/entitlements/__tests__/market-api.test.ts
  lib/entitlements/__tests__/copy.test.ts

Test Files  10 passed (10)
     Tests  106 passed (106)
```

---

## Real-Data Verification

Read-only `getPlayerMarketMovement` + `presentPlayerMarketMovement` against the certified serving table (no writes). `hasOpened = false` on every case.

| Scenario | Result |
| --- | --- |
| John Collins `18447937` points | 4× Quiet, Consensus 12.5 · 4 books |
| Jordan Clarkson `21681977` points | FanDuel Juice **+2.4 pp implied probability**, line 4.5 unchanged |
| Collins `18447959` points | Line / Line+Price mix, consensus **11.5 → 12.5**, **+1** |
| Collins PRA | Line+Price 19.5 → 20.5, display PRA |
| RJ Barrett 25.5 + 26.5 | **Consensus 26**, range 25.5–26.5 · 2 books, no book at 26 |
| Clarkson 1-book PRA | Consensus unavailable; BetMGM 7.5 shown |
| Empty / blocks | informational empty / unsupported copy |

Free blobs for those markets show Close consensus only (no BetMGM/FanDuel rows, no 3-Hour heading).

Browser: Explorer shell loads (offseason banner, historical date). Table fetch is slow in the automation browser; certified presentation of the same identities was verified from the serving table. Checklist item 6 is for a signed-in click-through.

---

## Files Changed

| File | Change |
| --- | --- |
| `lib/betting/market-movement-format.ts` | **New** formatters |
| `lib/betting/market-movement-present.ts` | **New** presentation model |
| `lib/betting/__tests__/market-movement-present.test.ts` | **New** UI-contract tests |
| `components/betting/market-movement/MarketMovementSection.tsx` | **New** panel section |
| `components/betting/PropsExplorerMarketPanel.tsx` | Certified MM; shopping kept |
| `lib/betting/prop-market-serving.ts` | Dropped legacy `movement` field + query |
| `lib/entitlements/sanitize-prop-market.ts` | No legacy movement sanitize |
| `lib/entitlements/types.ts` | 3-hour upgrade copy |
| Serving / entitlement / copy tests | Match new contract |
| This report + JSON + learning log | |

---

## Remaining Legacy Dependencies

- `summarizePropMovement` / `movementUnavailableMessage` in `lib/betting/prop-market-compare.ts` (unit-tested helper, **not** on the market API)
- No UI `Opened` / `openedLine` remaining under `components/betting`

---

## Risks / Open Questions

1. Timestamp inversion is still in serving data. UI omits timestamps; order is semantic. Do not add a timeline sort in 11F without a product decision.
2. Explorer table loading can be slow on historical dates; that is existing serving, not MM.
3. Free upgrade copy mentions “three hours before tip” without showing 3-Hour numbers. Keep it that way.

---

## Recommendation for Step 11F

Polish only unless a product gap appears in click-through:

- Tighten spacing/type on the MM card now that copy is stable
- Optional: show snapshot clocks as footnotes with a “clocks are not sort order” note
- Do **not** start game-odds Opening Snapshot UI until this player-prop card feels right
- Optional cleanup: delete unused `summarizePropMovement` if still unreferenced
- Live/current Market Movement remains off

STOP. Do not start 11F automatically.

---

## Verification Checklist

1. Confirm the 10-file vitest run above is green.
2. Confirm replay / offseason / cron dry-run flags.
3. Open Props Explorer on a historical date (e.g. 2026-04-02, game `18447937`, John Collins points).
4. Confirm the panel shows **3-Hour Pre-Tip → Close**, not **Opened → Closed**.
5. Confirm shopping (market range) still appears when MM is empty on another row.
6. As Free vs Pro, confirm Free sees Close consensus + upgrade, not per-book 3-Hour rows.
7. Spot-check Juice (Clarkson `21681977` points): same line, **+2.4 pp implied probability**.

---

## Step Verdict

`GREEN — certified Market Movement v1 is live in Props Explorer and ready for polish`
