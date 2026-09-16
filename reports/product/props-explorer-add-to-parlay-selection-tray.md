# STEP 14P.E2 — Props Explorer Add to Parlay + Transient Selection Tray

Generated: 2026-09-16  
Status: **GREEN — transient canonical multi-leg selection on Props Explorer; no analysis, workspace, or persistence**

---

## Executive Result

**GREEN — Props Explorer can naturally build a transient canonical multi-leg selection without duplicating discovery or triggering analysis.**

A Props Explorer row can now be added as an exact canonical offer (`player`, `market`, `side`, `line`, `book`, `decision_close` or `live_current`) into an in-memory tray. The board remains the discovery surface. Save / Compare / Paper are unchanged. Compare still owns Market Movement. Add/remove/clear are local and do not call XRay analysis, OpenAI, or BDL.

| Decision | Value |
| --- | --- |
| Architecture | **HYBRID** |
| PROPS_EXPLORER | **KEEP** |
| ADD_TO_PARLAY | **CERTIFIED** |
| PARLAY_SELECTION_TRAY | **CERTIFIED** |
| PARLAY_WORKSPACE | **NOT_IMPLEMENTED** |
| PARLAY_ANALYSIS | **NOT_CONNECTED** |
| CANONICAL_PARLAY_FROM_PROP_ROW | **CERTIFICATION_PRESERVED** |
| DECISION_CLOSE_SEMANTICS | **CERTIFICATION_PRESERVED** |
| XRAY_ANALYSIS_PIPELINE | **UNCHANGED** |
| PARLAY_PERSISTENCE | **NOT_IMPLEMENTED** |
| FREE_PRO_ENTITLEMENTS | **NOT_FINALIZED** |
| MODEL_TUNING | **FROZEN** |
| REAL_OPENAI_CALLS_THIS_STEP | **0** |
| REAL_BDL_CALLS_THIS_STEP | **0** |
| SCHEMA_MIGRATION | **NONE** |

---

## Existing Props Explorer UI Audit

Inspected before adding UI:

| Surface | Finding | E2 decision |
| --- | --- | --- |
| Row | Dense table, book/side/line/odds per offer | Keep table. Add one compact action column |
| Save / Compare / Paper | Existing research actions; Paper already uses “Add” | Preserve all three. Parlay copy is `+ Parlay` / `Added` |
| Mobile | Horizontal scroll on the table; custom drawers for player + Compare | Do not add a permanent side panel. Bottom bar + existing drawer pattern |
| Action density | Three small `text-[10px]` buttons | Fourth button uses the same chrome, not a primary CTA |
| Breakpoints | `xl` (1280) sticky research rail; custom `isXlViewport` | Do not steal the rail. Tray floats left of it on desktop |
| Client/server | Client page; fetch for board, saved props, paper, Compare market | Selection is `useState` only. Add does not fetch |
| State/context | URL filters; local panel selection | Parlay selection stays out of the query string |
| Toast | None. `saveNotice` inline banner | Parlay uses the same restrained notice pattern |
| Sheet/drawer | No shadcn Sheet. `PropsExplorerMarketPanel` / player panel custom overlays | Reuse that overlay pattern for “View Parlay” |
| Sticky UI | Filter table header; xl research rail | Board stays dominant. Tray is overlay, not a second column |
| shadcn | `Skeleton` only on this page | No new component library |

The board was not redesigned.

---

## Selection Architecture

Client-only module: `lib/parlay/selection.ts`.

- Store: React `useState<SelectedParlayLeg[]>` on the Props Explorer page
- Lifetime: **session memory / hard reload clears**
- No `localStorage` (app has no existing Explorer localStorage convention)
- No URL encoding of wagers
- No DB / schema
- Soft runtime ceiling: `PARLAY_SELECTION_SOFT_CAP = 12` (XRay structural scale, **not** public product policy)

`SelectedParlayLeg` holds the certified `CanonicalParlayOffer` plus an optional display `gameLabel` (matchup text from the games picker, not identity).

---

## E1 Adapter Reuse

Add path:

```
Explorer row
→ rowToParlayOfferInput (ids, market, side, line, book, odds, snapshotAt, marketContext, sourceTable)
→ addExplorerOfferToSelection
→ adaptPropsExplorerOffer
→ CanonicalParlayOffer
→ selection store
```

The UI does not reconstruct canonical identity. Failed adapter results are not added. Copy is restrained (`ADAPTER_ADD_COPY`); missing fields are not guessed.

---

## Canonical Offer Preservation

Each selected leg keeps:

- player id + display name
- game id + optional matchup label
- canonical market
- exact side
- exact line
- sportsbook vendor + display name
- odds as metadata
- snapshot kind + snapshot timestamp
- `source = props_explorer`

Historical board rows (`marketContext: historical` / `research.prop_decision_lines`) remain **`decision_close`**.

Not selected:

- 3-Hour Pre-Tip
- Opening

`threeHourLine` is not passed from the row. Compare still loads 3-Hour only inside Market Movement.

---

## Add to Parlay

Space-constrained column copy: **`+ Parlay`**. Accessible name: **Add to Parlay**.

The action sends the visible offer (player, market, side, line, book), not a consensus or another book.

Visual weight matches Save/Compare, not a primary CTA. Paper remains the outlined green “Add”.

---

## Selected State

When `isOfferSelected` is true for that exact offer:

- button label **Added**
- `aria-pressed={true}`
- `aria-label="Added to parlay"`

The rest of the row stays enabled. Save / Compare / Paper still work. Clicking Added again does not duplicate; notice is **Already added**.

---

## Selection Tray

Compact tray answers:

- How many legs? (`N legs selected` or `N legs · MATCHUP` when all share one game label)
- What exactly? Player, Over/Under + line, market, book, optional matchup
- Remove one (per `offerIdentity`)
- Clear all

Empty selection: **tray is hidden**. Board discovery stays uncluttered. E2 does not show “Build a parlay” empty copy because that would add persistent chrome before the user has selected anything. No analysis promises.

---

## Desktop UX

`xl` and up: floating compact panel, bottom of the board, offset `right-[calc(24rem+2.5rem)]` so it does not cover the sticky research rail (game context / Compare / player). Max height `min(28rem, 50vh)` with internal scroll for 8–12 legs.

Not a two-column board redesign.

---

## Mobile UX

Below `xl`: sticky bottom summary `{N legs selected | N legs · matchup}` + **View Parlay**.

View Parlay opens the existing custom overlay (not a route). Inside: legs, remove, Clear, Done. Escape and backdrop dismiss. No workspace navigation. No Analyze.

~390px uses the same bottom bar; the table already scrolls horizontally, so the extra Parlay column does not lock the board.

---

## Duplicate Handling

Duplicates use certified `offerIdentity` (`props_explorer|{snapshotKind}|{wagerIdentity}`).

Same player + market + side + line + book + snapshot twice → one leg + **Already added**.

---

## Distinct Book / Line / Side Handling

Kept distinct by E1 identity:

- DraftKings Jokic Over 27.5 ≠ FanDuel Jokic Over 28.5
- Over 27.5 ≠ Under 27.5

No collapse by player/market.

---

## Same-Player / Same-Game Behavior

Same player, different market (PTS + REB) is allowed.

Tray may show **Same player** and/or **Same game**, and `N legs · LAL @ OKC` when every selected leg shares one game id and a display label exists.

These labels are ID groupings, not correlation.

---

## Structural Dependency Preview

XRay `detectStructuralDependencies` matches OCR **names/matchups**, not canonical ids. Reusing it would miss same-game Explorer legs without matchup text and would couple the tray to interpretation.

E2 therefore uses cheap ID grouping only:

| Preview | Implemented? |
| --- | --- |
| Same player (`SHARED_PLAYER` analogue) | Yes, via `playerId` |
| Same game (`SHARED_GAME` analogue) | Yes, via `gameId` |
| SHARED_TEAM | **Skipped** (no team id on `CanonicalParlayOffer`) |
| DUPLICATE | Prevented at add time; not a tray badge |
| LOGICAL_CONFLICT | **Skipped** (would require interpretation math) |

No Why This Could Fail. No full parlay interpretation.

---

## Remove / Clear

Remove uses `offerIdentity`. Jokic PTS + Jokic REB: removing PTS leaves REB.

**Clear** empties the tray with no confirmation modal (nothing is persisted). `aria-label="Clear parlay"`.

---

## Existing Action Preservation

| Action | Semantics |
| --- | --- |
| Save | Unchanged saved-research toggle |
| Compare | Unchanged; still opens Market Movement panel |
| Paper | Unchanged; still blocked on historical |

Parlay is an additional research action, not a replacement path.

---

## Market Movement Boundary

Compare remains the only owner of **3-Hour Pre-Tip → Decision Close**.

The tray has no movement chart. Add to Parlay does not read or send 3-Hour fields. Selected historical offer = Decision Close.

---

## State Lifetime

**In-memory React state on the Props Explorer page.**

Hard reload clears the selection. Date/filter URL changes do not serialize legs. No `localStorage`.

---

## Entitlement Boundary

No new Parlay tier. Add to Parlay is not charged. XRay quota rules are untouched. Free/Pro policy is still later.

---

## Analytics Privacy

Props Explorer board had no typed Umami events. E2 does **not** add analytics. No player/game/market/line/odds/book/parlay payload is sent.

---

## Accessibility

- Add to Parlay is a labeled button (`aria-label`, not icon-only)
- Selected state via visible **Added** + `aria-pressed`
- Remove has `aria-label="Remove {player} {side} {line} {market} from parlay"`
- Clear labeled
- Mobile drawer: `role="dialog"`, backdrop dismiss, Escape, Done
- View Parlay announces the current summary

---

## Performance

Add/remove/clear are local `setState`. They do not refetch the board, mutate a server, or start analysis. `isOfferSelected` runs the sync E1 adapter per visible row (cheap, no network). Extra page padding (`pb-28`) only while legs exist so the mobile bar does not cover pagination.

---

## Tests

`lib/parlay/__tests__/selection.test.ts` (16) and page-contract (6):

- empty selection
- add one offer through E1 adapter
- selected identity matches adapter `offerIdentity`
- remove by identity
- clear all
- duplicate exact offer prevented
- DraftKings 27.5 vs FanDuel 28.5 distinct
- Over vs Under distinct
- same player different market allowed
- failed adapter does not add (`UNSUPPORTED_MARKET`)
- historical `decision_close` preserved
- `threeHourLine` does not alter the selected line
- 1 / 4 / 8 / 12-leg states
- explicit 12-leg development ceiling
- Save / Compare / Paper preserved in page source
- no `/parlay-workspace`, no Analyze, no `localStorage`
- no analysis / OpenAI / BDL on add

---

## E1 Regression

```
npx vitest run lib/parlay/__tests__/adapt-props-explorer-offer.test.ts
```

**21 passed** (baseline preserved).

---

## XRay Regression

```
npx vitest run lib/parlay-xray --exclude lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts
```

**36 files, 235 passed.** Docker `postgres-persistence` (16) was not run (same pre-existing harness gap as E1). Certified X3F baseline 235 + 16 = **251**. No XRay semantic changes.

---

## Modeling Freeze

No edits to 70/30, PTS C, REB C, Model D, WOWY, Context Engine research definitions, or prospective shadow protocol.

**MODEL_TUNING: FROZEN**

---

## Files Changed

- `lib/parlay/selection.ts` (new)
- `lib/parlay/index.ts` (export selection helpers)
- `lib/parlay/__tests__/selection.test.ts` (new)
- `lib/parlay/__tests__/props-explorer-parlay-selection-page-contract.test.ts` (new)
- `components/betting/PropsExplorerParlayTray.tsx` (new)
- `app/betting/props-explorer/page.tsx` (Add action, notice, tray wiring)
- `reports/product/props-explorer-add-to-parlay-selection-tray.md` (this report)
- `notes/learning-log/2026-09-16/step-14p-e2-add-to-parlay-selection-tray.mdx`

Not changed: navigation, XRay analysis, Market Movement math, entitlements, modeling, Terraform, schema.

---

## Schema Changes

**NONE.** Selection is in-memory. Persistence was not required and was not added.

---

## Remaining Gaps

- No Analyze Parlay (intentional).
- No Parlay Workspace route (intentional).
- No saved parlays / share / wager / payout / EV / win probability.
- Empty tray is hidden rather than showing “Build a parlay” helper copy.
- SHARED_TEAM and LOGICAL_CONFLICT are not previewed (would couple to XRay interpretation or missing team ids).
- Unsupported Explorer markets/books still fail closed at add time (E1).
- Four action columns increase row density on small screens (table already scrolls).
- Live viewport pass was not run in this step (no local app server); contract tests cover structure.

---

## Recommended Next Step

**STOP after E2.** Do not create Parlay Workspace in this step.

After review: a later E3 should be the smallest **Analyze Parlay** on the already-canonical tray (map `CanonicalParlayOffer` → existing analysis path) **or** a dedicated workspace only if tray density proves insufficient. Still no persistence, sharing, or nav rename until that decision.

---

## Verification Checklist

1. On Props Explorer, confirm Save / Compare / Paper still work on a row after it is **Added**.
2. Add Jokic Over 27.5 DraftKings twice → one tray leg + “Already added”.
3. Add FanDuel 28.5 and Under 27.5 as separate legs; remove only PTS and confirm REB remains.
4. Historical board: selected snapshot stays Decision Close; Compare still shows 3-Hour → Close.
5. At ~390px, confirm bottom “View Parlay” opens the overlay and does not navigate.
6. `npx vitest run lib/parlay/__tests__/adapt-props-explorer-offer.test.ts lib/parlay/__tests__/selection.test.ts lib/parlay/__tests__/props-explorer-parlay-selection-page-contract.test.ts`
7. Confirm no `/parlay-workspace`, no Analyze CTA, and a hard reload clears the tray.

---

## Step Verdict

**GREEN — Props Explorer can naturally build a transient canonical multi-leg selection without duplicating discovery or triggering analysis**

ARCHITECTURE: **HYBRID**  
PROPS_EXPLORER: **KEEP**  
ADD_TO_PARLAY: **CERTIFIED**  
PARLAY_SELECTION_TRAY: **CERTIFIED**  
PARLAY_WORKSPACE: **NOT_IMPLEMENTED**  
PARLAY_ANALYSIS: **NOT_CONNECTED**  
CANONICAL_PARLAY_FROM_PROP_ROW: **CERTIFICATION_PRESERVED**  
DECISION_CLOSE_SEMANTICS: **CERTIFICATION_PRESERVED**  
XRAY_ANALYSIS_PIPELINE: **UNCHANGED**  
PARLAY_PERSISTENCE: **NOT_IMPLEMENTED**  
FREE_PRO_ENTITLEMENTS: **NOT_FINALIZED**  
MODEL_TUNING: **FROZEN**  
REAL_OPENAI_CALLS_THIS_STEP: **0**  
REAL_BDL_CALLS_THIS_STEP: **0**  
SCHEMA_MIGRATION: **NONE**
