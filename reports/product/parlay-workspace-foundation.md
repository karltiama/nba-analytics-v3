# STEP 14P.E3 — Parlay Workspace Foundation + Canonical Selection Handoff

Generated: 2026-09-16  
Status: **GREEN — transient Workspace receives the exact Explorer selection across client navigation; no analysis or persistence**

---

## Executive Result

**GREEN — Props Explorer selections hand off to a dedicated transient Parlay Workspace with exact canonical identity preserved and no analysis/persistence coupling.**

`/parlay-workspace` is a review shell. Opening it from the Explorer tray keeps the same `CanonicalParlayOffer` objects (player/game/market/side/line/book/odds/snapshot/`offerIdentity`). Remove/clear stay synchronized because Explorer and Workspace share one in-memory store. Direct visits and hard reloads show the empty state. Analysis, XRay handoff, persistence, sharing, and primary-nav placement are not in this step.

| Decision | Value |
| --- | --- |
| Architecture | **HYBRID** |
| PROPS_EXPLORER | **KEEP** |
| ADD_TO_PARLAY | **CERTIFICATION_PRESERVED** |
| PARLAY_SELECTION_TRAY | **CERTIFICATION_PRESERVED** |
| PARLAY_WORKSPACE | **FOUNDATION_CERTIFIED** |
| WORKSPACE_STATE | **TRANSIENT_IN_MEMORY** |
| PROPS_WORKSPACE_SYNC | **CERTIFIED** |
| PARLAY_ANALYSIS | **NOT_CONNECTED** |
| XRAY_WORKSPACE_HANDOFF | **NOT_IMPLEMENTED** |
| PARLAY_PERSISTENCE | **NOT_IMPLEMENTED** |
| PRIMARY_NAV | **UNCHANGED** |
| FREE_PRO_ENTITLEMENTS | **NOT_FINALIZED** |
| XRAY_ANALYSIS_PIPELINE | **UNCHANGED** |
| MODEL_TUNING | **FROZEN** |
| REAL_OPENAI_CALLS_THIS_STEP | **0** |
| REAL_BDL_CALLS_THIS_STEP | **0** |
| SCHEMA_MIGRATION | **NONE** |

---

## E2 Manual Viewport Status

**MANUAL_E2_VIEWPORT = NOT_RUN**

No local app server was running. Contract tests were not treated as visual certification. This did not block E3; no layout defect was observed in code review.

---

## State Ownership Audit

| Question | E2 finding | E3 change |
| --- | --- | --- |
| Where state lived | `useState` on `app/betting/props-explorer/page.tsx` | Module store + `useSyncExternalStore` |
| Component owner | Props Explorer page | Shared `lib/parlay/selection-store.ts` |
| Unmount on navigation | Yes. `/betting/*` and `/parlay-workspace` use **different** App Router layouts, each wrapping a new `BettingAppShell` | Page unmount still happens; **store does not** |
| Canonical type | `CanonicalParlayOffer` / `SelectedParlayLeg` | Unchanged. Wrapped as `CanonicalParlaySelection` |
| Actions | `addExplorerOfferToSelection`, `removeSelectedLeg`, `clearSelectedLegs` | **Reused**, not rewritten |
| `offerIdentity` | E1 `props_explorer\|{snapshotKind}\|{wagerIdentity}` | Unchanged |
| Duplicates | Prevented at add; E3 also dedupes on store write | Defensive first-wins |
| Structural grouping | ID-based Same player / Same game | Reused + count summary in Workspace |

A React provider inside `BettingAppShell` would **not** survive Explorer → Workspace, because those routes do not share a layout instance. Root-layout wrapping was heavier than needed. The module store is memory-only and clears on hard reload.

---

## Cross-Route State Architecture

```
Props Explorer page ─┐
                     ├─ useParlaySelection()
Parlay Workspace ────┘         │
                               ▼
              lib/parlay/selection-store.ts  (module memory)
                               │
              lib/parlay/selection.ts        (certified add/remove/identity)
```

No new state-management dependency. Future XRay confirmed legs can call `replaceParlaySelectionLegs` with the same `SelectedParlayLeg` / `CanonicalParlayOffer` shape. OCR metadata is not on Explorer offers.

---

## State Lifetime

| Event | Selection |
| --- | --- |
| Client-side Explorer → Workspace | **PRESERVED** |
| Workspace → Explorer → add → Workspace | **PRESERVED** |
| Hard reload | **CLEARED** (empty Workspace) |
| New device / new JS process | **CLEARED** |

Lifetime: **session memory for the current client JS runtime.** Not localStorage, sessionStorage, cookies, DB, or URL-encoded wagers.

An Explorer filter return path (`/betting/props-explorer?…`) is remembered in the same memory store so **Add More Props** can return to the board the user left. It is not part of wager identity.

---

## Workspace Route

Created: **`/parlay-workspace`**

Not created: `/parlay-explorer`

Props Explorer is not renamed. Workspace is **not** in `PRIMARY_NAV`. Header chrome is shown via `shouldShowLayoutHeader('/parlay-workspace')` so the page is still inside Court Context, without a nav item.

---

## Props Explorer Entry Point

| Surface | Copy | Behavior |
| --- | --- | --- |
| Desktop tray | **Open Workspace** | Client `Link` to `/parlay-workspace` |
| Mobile sticky bar | **View Parlay** | Opens the existing overlay (unchanged) |
| Mobile overlay | **Open Workspace** | Same Workspace route |

No **Analyze Parlay**. Navigation is not ambiguous: View Parlay = tray detail; Open Workspace = dedicated review page.

---

## Canonical Selection Handoff

Handoff does **not** re-adapt display text. Workspace reads `CanonicalParlayOffer` already in the store.

Container:

```ts
CanonicalParlaySelection {
  legs: SelectedParlayLeg[]  // each has CanonicalParlayOffer
  sourceContext: 'props_explorer'
}
```

No persistence ids. No saved-parlay fields.

---

## Canonical Identity Preservation

Workspace receives, per offer:

- player id, player display name
- game id, optional matchup label
- market, side, line
- sportsbook vendor + display name
- odds metadata
- snapshot kind + timestamp
- `source` / `sourceProvenance`
- `offerIdentity` / `wagerIdentity`

No fuzzy match, provider lookup, line/book/snapshot substitution.

---

## Workspace Purpose / Hybrid Boundary

Workspace is **not** a second board. It has no player search, prop/book/market/date filters, or Market Movement.

Discovery CTA: **Add More Props** / empty **Explore Props** → Props Explorer.

---

## Workspace Header

**Parlay Workspace**

Supporting copy: *Review your selected props before running Court Context analysis.*

Live count via existing summary (`N legs selected` / `N legs · MATCHUP`).

---

## Selected Leg UX

Each card: player, Over/Under + line, market, sportsbook, optional matchup, odds, snapshot label, Same player / Same game when IDs group, **Remove**.

---

## Historical Snapshot UX

Workspace-only labels:

| snapshotKind | Copy |
| --- | --- |
| `decision_close` | **Decision Close** |
| `live_current` | **Current** |

Not Opening. Not 3-Hour Pre-Tip. Explorer/MM board copy was not rewritten.

---

## Structural Summary

Reuse of E2 ID helpers, plus counts:

- `4 legs`
- `2 same-game legs`
- `2 same-player legs`
- badges: Same game / Same player

Not correlation. Same team is not shown (`CanonicalParlayOffer` has no team id).

---

## Logical Conflict Reuse

**Skipped in E3.**

Certified Over/Under impossibility lives inside `interpretXrayParlay`, which requires full `XRayLegInterpretation` (form, market coverage, Why This Could Fail). Wiring that would connect analysis. `detectStructuralDependencies` is OCR-name based, not offer-id based.

Over 27.5 vs Under 27.5 remain **two selectable distinct offers**. Conflict presentation waits for a source-neutral helper extracted from XRay, not a parallel engine.

---

## Remove / Clear Synchronization

Remove uses `offerIdentity`. Store update is visible on both routes.

Example: remove Jokic PTS in Workspace → Explorer no longer shows **Added** on that exact PTS offer; Jokic REB stays selected.

**Clear Parlay**: no confirm modal. Both surfaces empty.

---

## Add More Props Loop

**Add More Props** client-navigates to the remembered Explorer href (filters preserved when still in memory).

Expected loop works because the store outlives page unmount:

Explorer → Workspace → Explorer → add another leg → Workspace.

---

## Empty Workspace

Direct `/parlay-workspace` with no memory: not an error, not a redirect to XRay, no fixtures.

Copy: *Your parlay is empty. Explore props to add your first leg.*  
CTA: **Explore Props**

---

## Hard Refresh Behavior

Workspace with legs → hard reload → empty Workspace.

Does not crash, invent fixtures, reconstruct wagers, or read the URL for legs.

---

## Future XRay Entry Boundary

Same container can later accept canonical offers from confirmed XRay legs. E3 does not map OCR → Workspace and does not import XRay session/analysis.

---

## Analysis Boundary

No Analyze button. No disabled fake control. No fabricated results. Copy mentions analysis only as a future review purpose.

---

## Desktop

Main column: stacked leg cards.  
Rail: parlay summary, structural facts, Add More Props, Clear Parlay. Court Context tokens (off-white, teal, mint, white cards). Not a bet-slip aesthetic.

---

## Mobile

~390px: header + stacked cards + actions **after** the list (not a fixed bar covering the last card). Remove / Add More Props / Clear are 44px-class targets. No squeezed table.

---

## Accessibility

- `h1` Parlay Workspace
- Remove labels include player + side/line + market
- Clear Parlay labeled
- Add More Props / Explore Props are links
- Structural facts are text, not color-only
- Summary uses `aria-live="polite"`
- Overlay Escape/Done retained on Explorer tray

---

## Analytics Privacy

No new Umami events. No player/line/odds/book/game/parlay payloads.

---

## Entitlements

No new Pro gate. Same BettingAppShell / onboarding context as Explorer. Free/Pro **not finalized**.

---

## Performance

Opening Workspace does not fetch, analyze, or refetch the board. It reads the memory store. Returning to Explorer uses existing App Router page fetch behavior (board may refetch as it already does on mount). No caching refactor.

---

## Tests

`lib/parlay/__tests__/selection-store.test.ts` (11) + `parlay-workspace-page-contract.test.ts` (3):

- empty Workspace / hard-refresh empty
- one-leg identity handoff (`decision_close`, book, line, side, odds, source, offerIdentity)
- 4 / 8 / 12-leg uniqueness
- Workspace → Explorer → Workspace + add another market
- remove one same-player market
- clear all
- defensive dedupe
- no discovery board / no Analyze / no providers / no storage APIs
- primary nav unchanged

---

## E1 Regression

```
npx vitest run lib/parlay/__tests__/adapt-props-explorer-offer.test.ts
```

**21 passed.**

---

## E2 Regression

```
npx vitest run lib/parlay/__tests__/selection.test.ts lib/parlay/__tests__/props-explorer-parlay-selection-page-contract.test.ts
```

**22 passed** (16 selection + 6 page-contract). Duplicate / book / line / side / same-player / Save / Compare / Paper assertions remain. Tray now also exposes **Open Workspace** (intentional E3 entry).

---

## XRay Regression

```
npx vitest run lib/parlay-xray --exclude lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts
```

| | |
| --- | --- |
| RUN | `lib/parlay-xray` excluding Docker postgres persistence |
| PASSED | **36 files, 235 tests** |
| EXCLUDED/SKIPPED | `extraction/__tests__/postgres-persistence.test.ts` (16 tests) |
| WHY | Same pre-existing Docker daemon gap as E1/E2. Not claimed as 251. |

XRay analysis semantics unchanged.

---

## Modeling Freeze

No edits to 70/30, PTS C, REB C, Model D, WOWY, Context Engine research definitions, or prospective shadow protocol.

**MODEL_TUNING: FROZEN**

---

## Files Changed

- `lib/parlay/selection.ts` — container, dedupe, snapshot labels, structure counts (add/remove logic unchanged)
- `lib/parlay/selection-store.ts` — new in-memory store
- `lib/parlay/use-parlay-selection.ts` — new client hook
- `lib/parlay/index.ts` — exports
- `lib/parlay/__tests__/selection-store.test.ts` — new
- `lib/parlay/__tests__/parlay-workspace-page-contract.test.ts` — new
- `lib/parlay/__tests__/props-explorer-parlay-selection-page-contract.test.ts` — Open Workspace allowed; nav still frozen
- `app/betting/props-explorer/page.tsx` — uses shared store
- `components/betting/PropsExplorerParlayTray.tsx` — Open Workspace
- `components/betting/betting-shell-paths.ts` — header chrome for `/parlay-workspace`
- `app/parlay-workspace/layout.tsx` — new
- `app/parlay-workspace/page.tsx` — new
- `app/parlay-workspace/ParlayWorkspaceClient.tsx` — new
- `components/parlay-workspace/ParlayWorkspaceView.tsx` — new
- `reports/product/parlay-workspace-foundation.md` — this report
- `notes/learning-log/2026-09-16/step-14p-e3-parlay-workspace-foundation.mdx`

Not changed: `PRIMARY_NAV`, XRay analysis, modeling, Terraform, schema.

---

## Schema Changes

**NONE.** Persistence was not required. If a later step needs saved parlays, that is a new decision — not E3.

---

## Remaining Gaps

- Court Context analysis not connected (intentional).
- XRay → Workspace adapter not implemented (intentional).
- Logical Over/Under conflict not shown (XRay helper is interpretation-coupled).
- Workspace not in primary navigation (intentional).
- Hard reload still clears selection (intentional).
- E2 ~390px viewport still **NOT_RUN**.
- No saved parlays, share, payout, EV, or entitlements.

---

## Recommended Next Step

**STOP after E3.**

After review: smallest E4 should map `CanonicalParlaySelection` into the existing XRay analysis path (no new math, no persistence, no nav item) **or** wait if the Workspace review UX needs a visual pass first.

---

## Verification Checklist

1. Add legs on Props Explorer → **Open Workspace** → confirm identical player/side/line/book/Decision Close.
2. Remove one same-player market in Workspace → back to Explorer → only that offer loses **Added**.
3. **Add More Props**, add another offer, return to Workspace — both remain.
4. Visit `/parlay-workspace` with no selection → empty copy, not an error.
5. Hard reload Workspace → empty, no crash.
6. Confirm primary nav has no Workspace item and no Analyze control.
7. `npx vitest run lib/parlay/__tests__/adapt-props-explorer-offer.test.ts lib/parlay/__tests__/selection.test.ts lib/parlay/__tests__/props-explorer-parlay-selection-page-contract.test.ts lib/parlay/__tests__/selection-store.test.ts lib/parlay/__tests__/parlay-workspace-page-contract.test.ts`

---

## Step Verdict

**GREEN — Props Explorer selections hand off to a dedicated transient Parlay Workspace with exact canonical identity preserved and no analysis/persistence coupling**

ARCHITECTURE: **HYBRID**  
PROPS_EXPLORER: **KEEP**  
ADD_TO_PARLAY: **CERTIFICATION_PRESERVED**  
PARLAY_SELECTION_TRAY: **CERTIFICATION_PRESERVED**  
PARLAY_WORKSPACE: **FOUNDATION_CERTIFIED**  
WORKSPACE_STATE: **TRANSIENT_IN_MEMORY**  
PROPS_WORKSPACE_SYNC: **CERTIFIED**  
PARLAY_ANALYSIS: **NOT_CONNECTED**  
XRAY_WORKSPACE_HANDOFF: **NOT_IMPLEMENTED**  
PARLAY_PERSISTENCE: **NOT_IMPLEMENTED**  
PRIMARY_NAV: **UNCHANGED**  
FREE_PRO_ENTITLEMENTS: **NOT_FINALIZED**  
XRAY_ANALYSIS_PIPELINE: **UNCHANGED**  
MODEL_TUNING: **FROZEN**  
REAL_OPENAI_CALLS_THIS_STEP: **0**  
REAL_BDL_CALLS_THIS_STEP: **0**  
SCHEMA_MIGRATION: **NONE**
