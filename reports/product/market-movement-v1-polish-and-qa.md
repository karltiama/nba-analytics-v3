# Market Movement v1 — Step 11F polish and QA

Status: **historical Props Explorer Market Movement is product-clear and technically ready for its intended scope. Product analytics cannot be wired because the app has no event tracker. Classify READY_WITH_MINOR_FOLLOWUPS.**

Date: 2026-09-09 (ET) / 2026-09-10 (UTC)

This is **not** a declaration that live 2026–27 Market Movement is ready.

---

## Safety / Scope

Confirmed before and during this step:

| Guard | Result |
| --- | --- |
| BDL HTTP | **0** — no provider calls added; local Explorer/market APIs only |
| `DATA_MODE` | `replay` (`.env`) |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Schema changes | **none** |
| Historical serving writes | **none** |
| Backfill rerun | **none** |
| S3 mutation | **none** |
| Game-odds Market Movement UI | **not started** |
| Historical Explorer / Role Check / Opportunity Check / possessions / WOWY | **untouched** |
| New Market Movement page | **none** |
| Live ingestion | **still off** |

Step 11F was polish + analytics audit + QA only.

---

## Visual Audit

Inspected `MarketMovementSection` **in the Props Explorer panel**, next to Shopping — not from component source alone.

Desktop (signed-in Founding Pro, `KrazyKarlHD`):

- Shopping (Selected / range / best line / book list) stays above Market Movement.
- The two cards share the panel chrome but are visually distinct: shopping is a comparable board; MM is certified 3-Hour → Close history.
- Headline numbers (`12.5` / `11.5` → `+1` → `12.5`) carry the weight. Book rows sit below.
- Panel width ~350px on desktop sidebar; no giant dashboard.

Mobile (~390–430px drawer):

- Headline stacks: **3-Hour Pre-Tip** number → signed delta → **Close** number.
- Book rows wrap (`3-Hour` then `Close` on separate lines).
- No horizontal overflow on the MM card (`overflowX: false`).
- Upgrade CTA is absent for Pro (does not dominate).
- Card is tall with four books **plus** shopping; the panel scrolls. Semantics are not hidden.

---

## Hierarchy Changes

Product order is now:

1. **What happened** — `3-Hour Pre-Tip` consensus → signed delta → `Close` consensus
2. **How meaningful** — class labels with plain-language explanations on each book
3. **Where books differed** — compact per-book rows last

Neither consensus number is labeled as a sportsbook line.

---

## Consensus Presentation

- Medians are the large numbers.
- Range + book count appear **once** under the headline (`12.5 · 4 books` or `25.5–26.5 range · 2 books`).
- When 3-Hour and Close spans differ: `3-Hour 11.5–12.5 · Close 12.5 · 4 books`.
- Copy no longer repeats “Consensus” on every line.
- Disclaimer (unobtrusive): *Median across supported books — not necessarily a line any book offered.*
- Split example (RJ Barrett `21681978` Pts+Reb): headline **26**, range **25.5–26.5 · 2 books**, books only at 25.5 and 26.5.

---

## Movement / Juice Presentation

| Class | Copy |
| --- | --- |
| Quiet | Little meaningful movement |
| Juice | Price moved, line held |
| Line | Line moved |
| Line+Price | Both line and price moved |

Banned predictive language (Sharp / Steam / Smart money / Bullish / Bearish / Strong signal) is not used.

Juice inline (Clarkson `21681977` FanDuel points):

> Line stayed at 4.5, but the price shifted +2.4 percentage points.

Price deltas format as `+2.4 pp` / `-2.3 pp`. Missing implied probability does not print `+NaN pp`.

---

## Free Experience

Free presentation (unit-tested; this session’s browser account is Pro so Free was not click-through):

- Title: **Market Consensus**
- Close median + range + book count
- Label: `Close consensus`
- Disclaimer
- Restrained upgrade: *See how this line moved from 3 hours before tip*
- CTA: existing `FoundingProUpgradeLink` → `/billing` (“Upgrade to Founding Pro”)
- No 3-Hour numbers, book names, or hidden historical quotes in the Free blob

---

## Pro Experience

Pro upgrade is the **data**:

- 3-Hour reference + Close comparison
- Consensus movement
- Per-book 3-Hour / Close quotes
- Juice / Line / Line+Price classes

No decorative Pro-only chrome.

---

## Upgrade Experience

- Wording uses **Founding Pro** (existing subscription term; not Premium/Plus/VIP).
- Link: `FOUNDING_PRO_UPGRADE_HREF` = `/billing`. Does not start Checkout.
- Keyboard-accessible (`<Link>`).
- No new billing implementation.
- **Not tracked** — no product analytics helper exists (see below).

---

## Analytics Instrumentation

**No suitable product analytics abstraction exists.** Repo search found no Umami, PostHog, Vercel Analytics, `trackEvent`, or similar. `lib/analytics/*` is NBA data access, not product events.

Per Step 11F rule 14, this step **does not** create a tracker.

Intended events (for when infra exists). Fire once at interaction boundaries — not on rerender. No player names, no raw odds dumps:

### `market_movement_viewed`

When certified Market Movement is meaningfully displayed.

| Property | Notes |
| --- | --- |
| `game_id` | ID, not name |
| `prop_type` | Canonical prop key |
| `detail` | `summary` \| `full` |
| `movement_status` | `ok` / `empty` / `unsupported_prop` |
| `consensus_book_count` | Number |

### `market_movement_upgrade_clicked`

When a Free user clicks the Market Movement upgrade affordance.

### `market_movement_books_expanded`

**Do not add.** Book rows are not collapsible.

---

## Loading / Empty / Unsupported States

| State | Copy / behavior |
| --- | --- |
| Loading | Reserved card titled Market Movement; “Loading certified history…”; no fake lines; no Opened → Closed flash (`setData(null)` until payload) |
| Empty | **No 3-Hour Pre-Tip history for this market** / Current shopping data may still be available. |
| Unsupported | **Market Movement isn't available for this prop yet.** (verified on Collins steals). No allowlist / archive / provider wording. |
| One book | **1 supported book available** / Not a consensus. Row still shown for Pro. |

Missing odds/lines use **—**, never `0` or `NaN`.

---

## Mobile QA

- Summary readable without horizontal scroll.
- Sportsbook rows stack/wrap.
- Range / book count remain readable.
- No upgrade CTA on Pro.
- Drawer scrolls rather than hiding 3-Hour → Close.

---

## Desktop QA

- Fits the existing Explorer sidebar/drawer.
- Shopping and Market Movement feel related but distinct.
- Visual weight is a research card, not a second Explorer.

---

## Accessibility QA

- Movement classes have text labels + explanations (not color-only).
- Decorative arrows are `aria-hidden`; the delta group has an accessible name (`Moved +1 from 3-Hour Pre-Tip to Close`).
- Upgrade action is a real link (Free).
- Disclaimer is visible text, not hover-only.
- Screen readers get “Certified historical movement from 3-Hour Pre-Tip to Close. Not live current.”
- Book rows are a labeled list (`Sportsbook movement`).
- Timestamps are **not** on the primary surface (and are not used to sort).

---

## Legacy Cleanup

`summarizePropMovement`, `movementUnavailableMessage`, `PROP_MARKET_MOVEMENT_CAP`, `MovementSummary`, and unused `PropMovementPoint` were removed from `lib/betting/prop-market-compare.ts`. Repo grep shows **no remaining consumers**. Associated dead tests were removed; a regression test asserts the exports are gone.

User-facing Props Explorer MM copy uses **3-Hour Pre-Tip → Close** only. No Opened / Opening line / Open → Close / first print on the player-prop card. Unrelated game-odds/research “opening” terminology was left alone.

---

## Tests Added

Presentation / format / legacy:

- Pro 3-Hour → Close hierarchy
- Free leak (no 3-Hour numbers / book names)
- Selected Over vs Under odds (`Under` normalized)
- Consensus median / range / book count; interpolating 26
- Juice `+2.4 pp` + contextual sentence
- Missing values → `—`, no NaN pp
- One book not labeled consensus
- Vendor order BetMGM → FanDuel → DraftKings → Caesars
- Empty / unsupported copy
- No Opened → Closed wording
- Dead helper no longer exported
- Upgrade copy + `/billing` (existing copy tests)

Analytics “fires once” tests were **not** added because there is no tracker to assert.

---

## Test Results

```
12 files, 119 passed (0 failed)
```

Includes 11B–11E suites plus 11F presentation/compare/copy/sanitize/market-api/explorer tests.

Targeted lint on 11F files: **0 errors** (pre-existing Tailwind `bg-white/[0.03]` style warnings on the panel).

Targeted typecheck: **no errors in 11F files**. Repo `tsc` still reports unrelated teams/ops/research test issues; not caused by this step.

---

## Manual Verification

| Scenario | Identity | Result |
| --- | --- | --- |
| Quiet | John Collins, game `18447937`, points | 12.5 → **0** → 12.5, `12.5 · 4 books`, all Quiet, vendor order correct |
| Juice | Jordan Clarkson, game `21681977`, points | Line 4.5 held; FanDuel Juice +2.4 pp sentence |
| Line / Line+Price | John Collins, game `18447959`, points | **11.5 → +1 → 12.5**; mix of Quiet / Line / Line+Price |
| PRA | Collins `18447937` PRA | **19.5 → +1 → 20.5**, Line+Price on BetMGM + FanDuel |
| Split consensus | RJ Barrett `21681978` points_rebounds | Median **26**, range 25.5–26.5, no book at 26 |
| One book | Clarkson `21681977` PRA | **1 supported book available**; BetMGM 7.5 row visible |
| Unsupported | Collins `18447937` steals | “isn't available for this prop yet” |
| Selected side | Collins points Over vs Under | Over `-105` / Under `-125` on BetMGM |
| Legacy wording | All above | No Opened → Closed |
| Free | — | Unit tests only (account is Pro; no entitlement simulation tooling) |
| Empty certified | — | Copy covered by tests; not hit in this click-through set |

Loading: “Loading certified history…” with reserved height; no fake consensus numbers.

---

## Files Changed

| File | Change |
| --- | --- |
| `lib/betting/market-movement-format.ts` | Range/`pp` formatters; span helper |
| `lib/betting/market-movement-present.ts` | Hierarchy, copy, juice context, vendor order, selected side |
| `lib/betting/__tests__/market-movement-present.test.ts` | 11F presentation contracts |
| `components/betting/market-movement/MarketMovementSection.tsx` | Headline / rows / a11y / Free CTA |
| `components/betting/PropsExplorerMarketPanel.tsx` | Loading card; selected side passed through |
| `lib/betting/prop-market-compare.ts` | Removed dead legacy movement helper |
| `lib/betting/__tests__/prop-market-compare.test.ts` | Dropped dead tests; export-absence regression |
| `lib/entitlements/types.ts` | 3-hour upgrade copy |
| `lib/entitlements/__tests__/copy.test.ts` | Upgrade title + `/billing` |
| This report + JSON + learning log | |

---

## Remaining Follow-Ups (non-blocking for historical v1 UI)

1. **Product analytics helper** (Umami or existing convention), then `market_movement_viewed` / `market_movement_upgrade_clicked`.
2. Browser Free click-through once a **non-test** entitlement preview exists (do not add auth bypasses).
3. Optional: de-emphasize consensus delta `0` on Quiet markets.
4. Optional: timestamp footnotes with “clocks are not sort order” — not needed for v1 primary surface.
5. **Do not** start game-odds Opening Snapshot → Close UI until this player-prop card is accepted.
6. Live/current Market Movement remains off.

---

## Product Classification

**READY_WITH_MINOR_FOLLOWUPS**

The historical Props Explorer surface is understandable and shippable for its intended certified 3-Hour → Close scope. The only Step 11F gap that the spec itself treats as YELLOW is **product analytics infrastructure**.

---

## Recommendation for Next Roadmap Step

**Stop.** Review this finished player-prop card.

When ready, the next *separate* steps (not this PR) are:

1. Add a small product-event helper, then instrument the two MM events above.
2. Only after product sign-off: Opening Snapshot → Close **game-odds** UI (reuse presentation ideas; do not start here).

Do **not** activate live ingestion.

---

## Verification Checklist

1. Open Props Explorer → Collins `18447937` points → Compare: headline is **3-Hour Pre-Tip → Close**, not Opened → Closed.
2. Clarkson `21681977` points: FanDuel juice sentence, line unchanged at 4.5.
3. Collins `18447959` points: **11.5 → +1 → 12.5**.
4. Barrett `21681978` Pts+Reb: median **26**, disclaimer visible.
5. Clarkson PRA: one-book copy, row still shown.
6. Narrow the drawer (~390px): no horizontal scroll on the MM card.
7. Confirm upgrade still goes to `/billing` (Free) and uses Founding Pro wording.

---

## Step Verdict

**YELLOW — feature is functional but needs minor follow-up before shipping**

Follow-up is product analytics (no existing abstraction). Historical Props Market Movement v1 UI/copy/QA is otherwise ready.
