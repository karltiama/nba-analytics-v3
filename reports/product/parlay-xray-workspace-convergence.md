# STEP 14P.E5 — Parlay XRay → Parlay Workspace Source Convergence

Generated: 2026-09-16  
Status: **GREEN — XRay and Props Explorer now converge on the same transient Parlay Workspace and shared Court Context analysis while preserving source-specific confirmation semantics**

---

## Executive Result

Parlay Workspace is now the shared post-confirm review/analysis destination for:

1. Props Explorer canonical offers  
2. Confirmed Parlay XRay legs after canonical resolution  

Confirm remains the XRay boundary. Workspace never receives OCR-only legs. Analysis does not run on handoff. Duplicate identity is `wagerIdentity`, not source. The certified X3F four-leg parlay produces the same basketball analysis from both sources.

| Decision | Value |
| --- | --- |
| Architecture | **HYBRID** |
| PARLAY_WORKSPACE | **SHARED_DESTINATION_CERTIFIED** |
| PROPS_WORKSPACE_FLOW | **CERTIFICATION_PRESERVED** |
| XRAY_WORKSPACE_HANDOFF | **CERTIFIED** |
| XRAY_CONFIRM_BOUNDARY | **CERTIFICATION_PRESERVED** |
| CROSS_SOURCE_CANONICAL_IDENTITY | **CERTIFIED** |
| XRAY_PROPS_ANALYSIS_PARITY | **CERTIFIED** (X3F) |
| CURRENT_LIVE_ANALYSIS | **NOT_IMPLEMENTED** |
| SAME_DATE_MULTI_GAME | **NOT_SUPPORTED** |
| MULTI_DATE | **NOT_SUPPORTED** |
| PUBLIC_EXTRACTION | **DISABLED** |
| PARLAY_PERSISTENCE | **NOT_IMPLEMENTED** |
| MEASURED_CORRELATION | **NOT_IMPLEMENTED** |
| NUMERIC_CONFIDENCE | **NONE** |
| FREE_PRO_ENTITLEMENTS | **NOT_FINALIZED** |
| MODEL_TUNING | **FROZEN** |
| REAL_OPENAI_CALLS_THIS_STEP | **0** |
| REAL_BDL_CALLS_THIS_STEP | **0** |
| SCHEMA_MIGRATION | **NONE** |
| MANUAL_VIEWPORT | **PASSED** (~390px) |

---

## Existing XRay Post-Confirm Audit

| Point | Where |
| --- | --- |
| **BEFORE CONFIRM** | Extracted/edited `ExtractedParlayLeg[]`. `confirmed=false`. Analysis idle. Public extraction remains disabled. |
| **AFTER CONFIRM** | `CONFIRM_LEGS` requires detected legs and zero `needs_confirmation` / `unresolved` extraction fields. Sets `confirmed=true`. Does **not** invent a historical date. If `historicalReplay` is already on state, `replayStage=resolving`. |
| **CANONICALIZATION POINT** | `resolveCanonicalParlayLegs` — still owned by XRay. Fuzzy player/game resolution happens here, not in Workspace. |
| **ANALYSIS POINT** | E4 Workspace: `runWorkspaceHistoricalAnalysis` after explicit Analyze. XRay in-page `runHistoricalXrayReplay` is no longer the product post-confirm path. |
| **RESULT RENDER POINT** | Product: `ParlayWorkspaceView` + shared `XrayResultsPanel`. Dev: `preview=analysis` still renders results on `/parlay-xray`. |

Cleanest handoff: **after Confirm**, after XRay canonical resolution, into the existing transient selection store as `CanonicalParlayOffer` rows with `source=xray`.

---

## Confirmation Boundary

Preserved.

Upload → extract → review/edit → **Confirm** → canonical parlay → Workspace.

Never: upload → auto-workspace → auto-analysis.

Blocked handoffs:

- `confirmed=false` → `NOT_CONFIRMED`
- extraction `needs_confirmation` → `NEEDS_CONFIRMATION`
- extraction unresolved → `UNRESOLVED`
- accepted OCR typo that is not canonically `FULLY_RESOLVED` (e.g. “Luka Doncik”) → `UNRESOLVED`
- no resolution catalog → `NO_CATALOG` (public Confirm does not invent X3F identity)

---

## Handoff Point

**Chosen:** Confirmed XRay legs → `handoffConfirmedXrayParlay` (resolve + adapt) → `importConfirmedXrayLegsToStore` → `/parlay-workspace`.

**Navigation decision:** After a **successful** Confirm with explicit `historicalReplay.gameId`, the client auto-navigates to Workspace. Confirm stays the only confirmation step. `Review in Workspace` remains visible as the keyboard-reachable CTA and retry path (dynamic import of the certified catalog can lag Confirm by a beat).

`preview=analysis` already has interpretations loaded and **does not** auto-navigate (DEV_FIXTURE_ONLY).

---

## Shared Workspace State Contract

One container. No `XRayWorkspaceState` / `PropsWorkspaceState`.

```
CanonicalParlaySelection {
  sourceContext: 'props_explorer' | 'xray' | 'mixed'
  legs: SelectedParlayLeg[]  // CanonicalParlayOffer + optional xrayProvenance
}
```

Empty selection still reports `sourceContext: 'props_explorer'` (no legs yet). Mixed after XRay import + Add More Props.

Lifetime unchanged: `TRANSIENT_IN_MEMORY`. Client navigations preserved. Hard reload / direct `/parlay-workspace` empty. No localStorage, sessionStorage, cookies, URL-encoded parlay, or DB.

---

## XRay Provenance

XRay-origin offers:

- `source = xray`
- `sourceProvenance = xray_confirmed`
- optional `xrayProvenance.ocrSnippet` / `confirmedPlayerName`

OCR text is **not** canonical identity. Player/game/market/side/line/book on the offer are.

Props Explorer offers are not given fake OCR fields.

---

## Canonical Identity Parity

Same wager, excluding source:

`Ajay Mitchell · Over 12.5 Points · DraftKings · game 18447934`

XRay confirmed canonical leg and Props Explorer canonical offer share `wagerIdentity`. `offerIdentity` still includes source + snapshot for provenance.

Regression: `lib/parlay/__tests__/xray-workspace-handoff.test.ts`.

---

## Historical Context Handoff

Explicit `historicalReplay` (`gameId` + `cutoffAt`) → `snapshotKind = decision_close`, `snapshotAt = cutoffAt`.

No explicit replay → `live_current`. Workspace does not infer date/game from OCR, clock, or matchup display.

Workspace Analyze still only injects certified X3F deps. Other `decision_close` games remain `OUTSIDE_COVERAGE`.

---

## Public XRay Safety

Public Confirm does not attach `historicalReplay`. Client handoff requires that explicit game id, so an ordinary current slip cannot become a historical replay.

Without catalog, `handoffConfirmedXrayParlay` returns `NO_CATALOG` and does not populate the store.

---

## Live / Current Boundary

XRay-origin legs without certified replay context are `live_current`. Workspace copy:

> Current-season Court Context analysis is not enabled yet.

They are not routed into historical matching.

---

## Same-Game Boundary

Unchanged from E4.

| Shape | Workspace |
| --- | --- |
| SAME_GAME | Review + Analyze if X3F Decision Close |
| SAME_DATE_MULTI_GAME | Reviewable; Analyze blocked |
| MULTI_DATE | Reviewable; Analyze blocked |

Concrete reason: **Historical analysis currently supports one game at a time. This parlay includes multiple games, so Court Context cannot run yet.** Unsupported legs are not dropped.

---

## XRay Existing Results Path

| Surface | Classification |
| --- | --- |
| Extraction / review / Confirm / Edit | **KEEP_XRAY_SPECIFIC** |
| `XrayResultsPanel` in Workspace after Analyze | **SHARED_IN_WORKSPACE** |
| `/parlay-xray?preview=analysis` in-page results | **DEV_FIXTURE_ONLY** |
| `/parlay-xray?preview=replay` confirm fixture | **DEV_FIXTURE_ONLY** (product handoff after Confirm) |
| `XrayAnalysisPanel` (unconfirmed / design preview) | **KEEP_XRAY_SPECIFIC** |

No destructive cleanup. Certified replay harnesses remain.

---

## Workspace Source UX

Restrained provenance only:

- Imported from Parlay XRay
- Built from Props Explorer
- Combined from Parlay XRay and Props Explorer
- Edited after import (when the current fingerprint differs from the import fingerprint)

Does not change analysis.

---

## OCR / Confirmed Provenance

Shown only when the screenshot snippet does not contain the confirmed player name.

Example: Screenshot read `Luka Doncik O 30.5 PTS` · Confirmed `Luka Doncic`.

Ajay (unchanged OCR) has no OCR block. Props-origin legs have none.

---

## Cross-Source Editing

Remove is allowed. The Workspace parlay may then differ from the imported screenshot. The original extraction record is not mutated. Analysis uses the current selection only.

---

## Add More Props After XRay

Supported. The store is source-neutral. Adding a distinct Props Explorer offer after XRay import sets `sourceContext = mixed`.

---

## Cross-Source Duplicate Handling

Duplicates key on **`wagerIdentity`**, not source.

| Case | Result |
| --- | --- |
| XRay DK Jokic 27.5 Over + Props DK Jokic 27.5 Over | Duplicate (one leg) |
| XRay DK Jokic 27.5 Over + Props FD Jokic 28.5 Over | Distinct |
| Over vs Under | Distinct |

`isOfferSelected` uses the same wager key so Explorer shows Added for a wager already imported from XRay.

---

## Analysis Invalidation

Unchanged from E4: add / remove / clear / change selection invalidates the stored result. Analyze is required again. Source does not matter.

Handoff does **not** write an analysis record.

---

## XRay / Props Analysis Parity

Certified X3F four-leg parlay:

- Path A: confirmed XRay → Workspace Analyze  
- Path B: Props canonical offers → Workspace Analyze  
- Path C: `runHistoricalXrayReplay` (direct)

Match statuses, requested lines, Why This Could Fail codes, parlay failure codes, context coverage, and data-quality fields match. Source provenance may differ.

---

## Outcome Leakage

Target-game and future sentinel logs still do not change interpretations on either source path. No final stats / hit / miss / final score / postgame copy in the analysis JSON.

---

## Extraction Freeze

Unchanged: `xray-extract-v2.1` / `xray-legs-v2`, prompt, model, quotas, kill switch, dedupe. No OpenAI or BDL calls in this step.

`PUBLIC_EXTRACTION: DISABLED`

---

## State Lifetime

`TRANSIENT_IN_MEMORY`.

Direct `/parlay-workspace` with no prior client state: empty.  
Hard refresh after XRay handoff: empty. Intentional. Do not reconstruct from XRay.

---

## Mobile / Manual Viewport

Ran against local `next dev` at **390×844**.

**B. XRay `preview=replay`:** Confirm disabled until Luka OCR is edited (not merely accepted). After `Luka Doncik` → `Luka Doncic` → Confirm → auto-nav to Workspace. Source label, OCR correction on Luka, Analyze reachable. Analyze produced Historical Analysis + Why this could fail / Why this parlay could fail. No horizontal overflow. Add More Props / Edit selection / Remove labeled.

**A. Props Explorer historical `2026-04-02` LAL @ OKC:** Add to Parlay, Open Workspace (client Link), `Built from Props Explorer`, Analyze reachable, no overflow. Hard `browser_navigate` to `/parlay-workspace` emptied state (documented transient behavior). Full-document reload is not a client navigation.

---

## Accessibility

- `Review in Workspace` is a real button after Confirm  
- Workspace `aria-label="Parlay source"`  
- OCR correction is text, not color-only  
- Remove buttons: `Remove {player} {side} {line} {market} from parlay`  
- Analyze disabled/busy via `aria-busy`  
- Unavailable reasons are list text (not color-only)  
- Confirm remains disabled until extraction confirmation is complete  

---

## Analytics Privacy

New generic events only:

- `parlay_xray_open_workspace` — `surface=parlay_xray`, `action=open_workspace`
- `parlay_workspace_analysis_started` — `surface=parlay_workspace`, `source=xray|props_explorer|mixed`, `action=analysis_started`

No OCR, player, market, line, book, odds, full parlay, or analysis text.

---

## Entitlements

Unchanged. No new paywall. XRay quotas unchanged. Workspace Analyze remains existing/dev behavior (certified X3F injectable path).

---

## Tests

`lib/parlay/__tests__`: **86 passed** (7 files).

E5 matrix coverage in `xray-workspace-handoff.test.ts` (17 cases): unconfirmed / needs confirmation / accepted OCR typo / confirmed handoff / identity / no replay → live_current / no catalog / same-game READY / multi-game blocked / no auto-analysis / source + OCR labels / Ajay identity parity / cross-source duplicate + book + line / mixed Add More Props / remove after import / invalidation / X3F 4-leg parity / leakage / hard-reset empty.

---

## E1–E4 Regression

`npx vitest run lib/parlay/__tests__` → **86 passed**.

| Suite | File | Result |
| --- | --- | --- |
| E1 adapter | `adapt-props-explorer-offer.test.ts` | passed |
| E2 tray/selection | `selection.test.ts` + Props Explorer page contract | passed |
| E3 store/workspace | `selection-store.test.ts` + workspace page contract | passed |
| E4 historical Analyze | `workspace-analysis.test.ts` | passed |

No E1–E4 regressions observed.

---

## XRay Regression

`npx vitest run lib/parlay-xray --exclude lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts`

| | |
| --- | --- |
| RUN | 235 |
| PASSED | **235** |
| EXCLUDED | **16** |
| WHY | `postgres-persistence.test.ts` needs dedicated Docker Postgres. Without Docker the suite fail-closes at `beforeAll` (`docker info`). Same environment precedent as prior XRay reports. Do not claim 251. |

Preserved: extraction v2.1, confirmation, canonical resolution, historical replay, leakage safety, interpretation, parlay analysis. Product client no longer auto-runs `runHistoricalXrayReplay` after Confirm; `preview=analysis` still loads fixture results in-page.

---

## Modeling Freeze

This step did not edit Context Engine, WOWY research definitions, 70/30, PTS C, REB C, Model D, or prospective shadow protocol. Pre-existing dirty `lib/model-lab` / `lib/wowy` files in the working tree were not part of E5.

`MODEL_TUNING: FROZEN`

---

## Files Changed

**Added**

- `lib/parlay/adapt-xray-confirmed.ts`
- `lib/parlay/__tests__/xray-workspace-handoff.test.ts`
- `reports/product/parlay-xray-workspace-convergence.md`

**Updated**

- `lib/parlay/adapt-props-explorer-offer.ts` — `source=xray` provenance union  
- `lib/parlay/selection.ts` — wagerIdentity dedupe, mixed source, source labels  
- `lib/parlay/selection-store.ts` — XRay import fingerprint, no analysis on import  
- `lib/parlay/workspace-analysis.ts` — OCR passthrough, concrete multi-game copy  
- `lib/parlay/index.ts`, `lib/parlay/use-parlay-selection.ts`  
- `app/parlay-xray/ParlayXrayClient.tsx` — post-Confirm handoff  
- `app/parlay-workspace/ParlayWorkspaceClient.tsx` — source analytics  
- `components/parlay-xray/ParlayXrayView.tsx`, `ExtractedLegsPanel.tsx`  
- `components/parlay-workspace/ParlayWorkspaceView.tsx`  
- `lib/product-analytics/track-event.ts`, `parlay-xray-events.ts`, `EVENTS.md`  
- `lib/parlay/__tests__/parlay-workspace-page-contract.test.ts`  
- `lib/parlay-xray/__tests__/page-contract.test.ts`

---

## Schema Changes

`SCHEMA_MIGRATION = NONE`

Source convergence did not require persistence. Stopped at the in-memory store.

---

## Remaining Gaps

- Public `/parlay-xray` Confirm still cannot populate Workspace without an explicit certified catalog/replay context (correct fail-closed).  
- `CURRENT_LIVE_ANALYSIS` remains unimplemented.  
- SAME_DATE_MULTI_GAME / MULTI_DATE remain unsupported for Analyze.  
- Parlay persistence / sharing / primary-nav Workspace item remain unimplemented.  
- `preview=analysis` is still a second in-page results surface for local fixtures only.

---

## Recommended Next Step

**STOP after STEP 14P.E5.** Do not enable live/current analysis, public extraction, persistence, sharing, or a primary nav item in this step.

A later step can attach live analysis behind the same Workspace Analyze boundary, without reopening extraction or modeling.

---

## Verification Checklist

1. `/parlay-xray?preview=replay` — Confirm stays disabled until the Luka OCR typo is **edited** to Doncic (accept-as-shown is not enough).  
2. After Confirm, Workspace opens with four Decision Close legs and **does not** show results until Analyze.  
3. Workspace source reads “Imported from Parlay XRay”; Luka shows screenshot-read vs confirmed.  
4. Analyze with Court Context returns the shared historical panel (Why this could fail readable).  
5. Props Explorer historical LAL @ OKC → Add to Parlay → Open Workspace → “Built from Props Explorer”.  
6. Adding the same DK Ajay 12.5 after an XRay import does not create a second leg.  
7. Hard refresh of `/parlay-workspace` is empty.

---

## Step Verdict

**GREEN — XRay and Props Explorer now converge on the same transient Parlay Workspace and shared Court Context analysis while preserving source-specific confirmation semantics**

ARCHITECTURE: **HYBRID**  
PARLAY_WORKSPACE: **SHARED_DESTINATION_CERTIFIED**  
PROPS_WORKSPACE_FLOW: **CERTIFICATION_PRESERVED**  
XRAY_WORKSPACE_HANDOFF: **CERTIFIED**  
XRAY_CONFIRM_BOUNDARY: **CERTIFICATION_PRESERVED**  
CROSS_SOURCE_CANONICAL_IDENTITY: **CERTIFIED**  
XRAY_PROPS_ANALYSIS_PARITY: **CERTIFIED**  
CURRENT_LIVE_ANALYSIS: **NOT_IMPLEMENTED**  
SAME_DATE_MULTI_GAME: **NOT_SUPPORTED**  
MULTI_DATE: **NOT_SUPPORTED**  
PUBLIC_EXTRACTION: **DISABLED**  
PARLAY_PERSISTENCE: **NOT_IMPLEMENTED**  
MEASURED_CORRELATION: **NOT_IMPLEMENTED**  
NUMERIC_CONFIDENCE: **NONE**  
FREE_PRO_ENTITLEMENTS: **NOT_FINALIZED**  
MODEL_TUNING: **FROZEN**  
REAL_OPENAI_CALLS_THIS_STEP: **0**  
REAL_BDL_CALLS_THIS_STEP: **0**  
SCHEMA_MIGRATION: **NONE**  
MANUAL_VIEWPORT: **PASSED**
