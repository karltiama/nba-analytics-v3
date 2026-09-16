# STEP 14P.E7 — Parlay Product Polish + UI QA

## Executive Result

XRay now presents as **import + verify**, Workspace as **review + analyze**, and Props Explorer as **discover + add**. The certified hybrid architecture is unchanged. Why This Could Fail leads Workspace results. Mobile Props goes to Workspace in one hop via a sticky **Review Parlay** control.

**Verdict: GREEN** — a normal user can tell the three surfaces apart, and the converged workflow is ready for entitlement implementation.

## Copy Audit

Inventory of visible product copy (not the whole site). Classification is for launch-facing language only.

| Surface | Copy | Class |
| --- | --- | --- |
| XRay hero `Upload your slip.` | Import, not prediction | **ACCURATE** |
| XRay subhead: verify read, then Court Context; XRay is not finished analysis | Role split | **ACCURATE** |
| XRay `Upload → Review → Confirm → Workspace` | Matches real flow | **ACCURATE** |
| XRay StageList `Results` | Removed from product stages | was **MISLEADING** |
| XRay idle strongest/riskiest | Replaced by `What XRay does` | was **MISLEADING** |
| XRay `Extract screenshot` / `Reading your screenshot…` | Import verbs | **ACCURATE** |
| XRay Confirm / `Review in Workspace` | Trust boundary + destination | **ACCURATE** |
| XRay quota `{n} of {limit} screenshot reads remaining today` | Remaining reads, not Free 3 / Pro 10 plan policy | **ACCURATE** (safety remaining, not marketed as plan) |
| XRay design-preview `XrayAnalysisPanel` strongest/riskiest | Behind `?preview=` + amber banner | **REDUNDANT** for product; kept as **dev fixture** |
| Workspace `Review how your selected legs connect…` | Research tone | **ACCURATE** |
| Workspace `Analyze with Court Context` / `Building Court Context analysis…` | Explicit analyze | **ACCURATE** |
| Workspace `Historical Court Context analysis for the selected Decision Close offers.` | Historical, Decision Close | **ACCURATE** |
| Workspace `Imported from Parlay XRay` / `Built from Props Explorer` | Provenance, not a second analyzer | **ACCURATE** |
| Workspace MULTI_GAME: one-game support | Plain language | **ACCURATE** (was **TOO_TECHNICAL**) |
| Workspace LIVE_CURRENT: not enabled yet | Honest unavailable | **ACCURATE** |
| Props `Add to Parlay` / `+ Parlay` | Discover → select | **ACCURATE** |
| Props mobile `Review Parlay` | Direct Workspace | **ACCURATE** (was extra hop) |
| Props desktop `Open Workspace` | Tray destination | **ACCURATE** |
| Billing `$10/month` | Unchanged planning price | **ACCURATE** |
| Billing: no locks / win calls; WOWY stays on WOWY; saved parlays / live / alerts not yet | Honesty | **ACCURATE** (was **STALE** / **MISLEADING**) |
| Billing bullets: best book, best line/price, 3-Hour→Close, AI briefing as context | Current gated Compare/MM/AI, not the E6 parlay matrix | **ACCURATE** vs current gates; **STALE** vs future Free/Pro matrix (deferred to E8) |
| `UPGRADE_COPY.wowy` | No longer “unlock with Founding Pro” | **ACCURATE** |
| `UPGRADE_COPY.line_shopping_detail` “strongest line” | Compare CTA, not parlay win-call | **ACCURATE** in shopping sense; still **TOO_TECHNICAL** / salesy for Court Context |

No broad site rewrite.

## Product Role Clarity

| Surface | Role shown to the user |
| --- | --- |
| **Props Explorer** | DISCOVER exact offers → Add to Parlay |
| **Parlay XRay** | IMPORT a screenshot → Review → Confirm |
| **Parlay Workspace** | REVIEW the canonical slip → Analyze with Court Context |

Primary nav is unchanged (no Workspace item). Workspace is entered from Props or XRay only.

## XRay Before / After

**Before (E6):** Hero implied XRay analyzes the parlay. StageList included Results. Idle chrome showed strongest/riskiest placeholders. Confirm still handed off, but the page looked like the finished analyzer.

**After:** Hero is upload/import. Stages are Upload / Review / Confirm / Workspace. Idle body is process-only (`What XRay does`). Confirm remains the trust boundary. Successful historical replay Confirm still auto-navigates to Workspace; **Review in Workspace** remains the retry CTA.

## XRay Stage Model

Product StageList:

1. **Upload.** Waiting for a screenshot / Screenshot selected.
2. **Review.** Extraction status (`Reading your screenshot…` while pending).
3. **Confirm.** Required before Workspace; after Confirm, points at Workspace (or live-unavailable honesty).
4. **Workspace.** Destination for examining the slip as a whole.

`Results.` is not a product stage. `XrayResultsPanel` still exists for Workspace (and for local `?preview=analysis` / historical replay assembly). Design-preview links stay labeled “Local layout review”.

**XRAY_STAGE_MODEL: CERTIFIED**

## XRay Idle State

Product idle no longer mounts `XrayAnalysisPanel`. It shows:

- What XRay reads: player, market, side, line, sportsbook
- Analysis runs in Workspace after Confirm, not on this page

No fake strongest/riskiest/best-bet/confidence placeholders.

`XrayAnalysisPanel` (including strongest/riskiest cards) remains **design-preview only**, behind the amber “fictional layout data” banner.

## Workspace Before / After

**Before:** Subcopy was weaker; results opened on coverage grids; empty state was Explorer-only.

**After:** Header: “Review how your selected legs connect before making your own decision.” Empty: Explore Props + Import with XRay. Selected: legs + structural badges + Analyze CTA + restrained provenance. Results eyebrow: Historical Analysis. Actions: Edit Parlay / Add More Props / Clear Parlay.

## Workspace Results Hierarchy

Presentation-only reorder in `XrayParlaySummary` (shared Workspace results component). Logic unchanged.

1. Parlay summary (sentence + state chip)
2. **Why this parlay could fail**
3. Shared context (same player / game / team — identity, not measured correlation)
4. Supporting parlay context / legs needing review
5. Data coverage (“What we could verify…”)
6. Leg context (Market / Recent form / Role / Matchup / limitations)

Contract test: `Why this parlay could fail` appears before `Data coverage` in source order.

**WHY_THIS_COULD_FAIL_HIERARCHY: CERTIFIED**

## Why This Could Fail Placement

Parlay-level block sits immediately after the summary header. White card, teal type, no `AlertTriangle`, no red/casino treatment. Subcopy: “Not a prediction.” Missing availability/WOWY/projection still appear as factual gaps. No numeric risk score. No “this parlay will lose.”

Leg-level “Why this could fail” remains inside each leg card after Market/Form/Role/Matchup — supporting, not the page lead.

## Data Coverage Placement

Moved to the bottom of the parlay summary stack. Title: **Data coverage**. Subtitle explains missing WOWY / projection / availability does not mean the rest of the read is broken. Counts still visible (including 0/1). Not paywalled. Not hidden.

## Leg Analysis Density

No accordion refactor. Each leg already groups:

- Market (3-Hour Pre-Tip → Decision Close)
- Recent form
- Role (minutes vs season; formerly labeled Minutes)
- Matchup
- WOWY / Projection / Availability
- Why this could fail
- Data limitations

Indicator row: Market, Recent form, Role, Matchup, Data coverage.

## Props Mobile Flow

**Chosen design:** drop the mobile View Parlay overlay. Below `xl`, a sticky bar shows `{n} legs · Review Parlay` and is a `Link` to `/parlay-workspace`. Remove/clear remain on desktop tray and in Workspace.

**Why this is better:** E6’s extra hop (Add → overlay → Open Workspace) is gone. Selection management that needed the overlay (remove/clear) is still available where review actually happens. Smallest change: no tray rebuild.

Fixed a leftover `setParlayDrawerOpen` after removing drawer state (it crashed Props Explorer on load).

**PROPS_MOBILE_FLOW: CLEAR**

## Props Desktop Flow

Unchanged: floating tray, Open Workspace, remove, clear. Not redesigned from the mobile finding.

**PROPS_DESKTOP_FLOW: CLEAR**

## CTA Vocabulary

Canonical verbs used in product UI:

| Surface | Verb |
| --- | --- |
| Props row | **Add to Parlay** (`+ Parlay` compact) |
| Props mobile sticky | **Review Parlay** |
| Props desktop tray | **Open Workspace** |
| XRay extract | **Extract screenshot** |
| XRay OCR check | **Mark {name} as reviewed** |
| XRay trust boundary | **Confirm** / Confirm historical replay |
| XRay after Confirm | **Review in Workspace** |
| Workspace ready | **Analyze with Court Context** |
| Workspace loading | **Building Court Context analysis…** |
| Workspace results | **Edit Parlay** / **Add More Props** |

Avoided as synonyms for those actions: Run, Scan, Score, Check, Evaluate.

## Source Provenance

`Built from Props Explorer` and `Imported from Parlay XRay` remain `text-xs` under the Workspace header. OCR provenance (`Screenshot read` / `Confirmed`) only when the snippet differs. `Edited after import` still appears after an XRay-origin mutation. Same analysis component either way.

## Historical / Live Copy

Preserved: **Decision Close**, **3-Hour Pre-Tip → Decision Close**, never Opening. Workspace results: “Historical Court Context analysis for the selected Decision Close offers.” XRay replay banner: “Historical Replay — {date}. This is not current-season intelligence.” Replay fixture labeled “not a live slip.”

Live: `Current-season Court Context analysis is not enabled yet.` No “Coming soon!”. No fake historical fallback.

## Same-Game Limitation UX

MULTI_GAME message: **Historical Court Context analysis currently supports parlays from one game.** No SAME_GAME / fixture jargon.

## Billing / Founding Pro Copy

Unchanged: `$10/month`, checkout plumbing, Stripe products.

Changed:

- Framing: deeper research; does not sell locks or win calls
- Movement labeled 3-Hour Pre-Tip to Decision Close
- AI as supporting context, not picks
- WOWY stays on the WOWY page
- Saved parlays, live analysis, and alerts are **not** part of Founding Pro yet
- Removed “Stop checking multiple sportsbooks” / Start Winning style claims

Observed on `/billing` (signed-in Founding Pro): price, honesty footer, **Manage billing** only (no new Upgrade/checkout enablement). Stripe test-mode notice unchanged.

**BILLING_COPY: POLISHED**

## Entitlement Conflicts — Deferred

E7 did **not** change gating. Existing implementation still contradicts the E6 matrix.

| File | Conflict |
| --- | --- |
| `lib/entitlements/resolve.ts` | `featuresFor(isPro)` flips **every** `FEATURE_KEYS` with Pro |
| `lib/entitlements/types.ts` | Keys: `line_shopping_detail`, `market_movement`, `ai_briefing`, `advanced_history`, `wowy`, `alerts` |
| `lib/entitlements/sanitize-prop-market.ts` | Free sanitizes shopping / full MM |
| `lib/entitlements/http.ts` + `queries.ts` `requireEntitlement` | Server deny for gated keys |
| Props Explorer Compare / market APIs | `line_shopping_detail` + `market_movement` |
| AI slate/game briefing APIs | `ai_briefing` |
| `wowy` / `alerts` / `advanced_history` | Keys exist; WOWY page is public; alerts/history not shipped |
| XRay extract | Auth + `isPro` only for **safety quota**, not a feature key |
| Workspace Analyze | **No** entitlement check |

E8 should implement the E6 matrix, not this all-keys map.

**ENTITLEMENT_RUNTIME_CHANGES: NONE**
**ENTITLEMENT_IMPLEMENTATION: NOT_STARTED**

## Safety Quota Copy

Visible remaining-reads label uses the runtime used/limit pair. It does **not** say Free 3 / Pro 10 / Global 100 as launched plan policy. Guardrail values in `lib/parlay-xray/extraction/config.ts` were not changed.

**SAFETY_QUOTAS: TECHNICAL_DEFAULTS_NOT_PLAN_POLICY**

## Trust / Safety Language

Removed/avoided on product XRay/Workspace/billing: guaranteed, lock, will hit, best bet, instant winning, Start Winning. Why This Could Fail is factual and non-sensational. Design-preview still contains strongest/riskiest **inside the preview fixture only**.

## Mobile QA

Local `localhost:3000`, ~390 CSS px (device metrics). Signed-in.

**FLOW A:** Historical Props `date=2026-04-02&game_id=18447934` → Add to Parlay (Ajay Over 12.5 Points, Decision Close) → sticky **Review Parlay** → Workspace → **Analyze with Court Context** → results. Loading copy: Building Court Context analysis…. Results: Historical Analysis, Why this parlay could fail before Data coverage, Edit Parlay / Add More Props reachable. No overlay hop. Dev Next.js issues badge can sit on the sticky bar in development; production would not show it.

**FLOW B:** `/parlay-xray?preview=replay` → Historical Replay banner → OCR check on Luka Doncik → Confirm historical replay. Confirm boundary held. If OCR name is marked reviewed without editing to the catalog name, handoff fail-closes with: edit OCR names, then open Workspace. **Review in Workspace** remains. Auto-nav still runs on **successful** canonicalization (unchanged client). Successful path was previously certified in E5/E6 tests; this session’s live click used “as reviewed” on the typo, which is supposed to fail identity.

Idle XRay: no Results stage; What XRay does; no strongest/riskiest.

No production sticky-CTA collision besides the Next.js overlay. No horizontal overflow observed in the 390-wide column.

## Desktop QA

Billing and Workspace inspected at desktop. Props desktop tray still **Open Workspace**. Workspace max width remains existing `max-w-[1800px]`; not redesigned. Duplicate “Parlay summary” (results heading + aside facts) is useful, not a second analyzer. Design-preview links are `text-xs` and local-only.

## Accessibility

- Analyze / Review Parlay / Open Workspace / Confirm are real buttons/links (keyboard).
- Remove actions: `Remove {player} {side} {market} from parlay`.
- Clear: `Clear parlay`.
- OCR check: `Mark {name} as reviewed` (no longer collides with Confirm).
- Why This Could Fail and coverage use headings + text, not color alone.
- Remaining: betting shell **h1 Court Context** plus page **h1** (XRay/Workspace) — pre-existing shell pattern, not newly introduced.
- Focus after XRay → Workspace uses App Router `router.push`; not re-tuned.

## Empty / Error / Unavailable States

| State | What happened | What to do |
| --- | --- | --- |
| XRay empty | Waiting for a screenshot | Upload |
| XRay unresolved handoff | Confirmed legs could not be resolved to Workspace identity | Edit OCR names, then Workspace |
| Workspace empty | Your parlay is empty | Explore Props / Import with XRay |
| MULTI_GAME | One-game historical support | Change selection |
| LIVE_CURRENT | Current-season analysis not enabled | Honest; no fake fallback |
| Missing context | Coverage 0/n + Why This Could Fail items | Visible, not paywalled |

## Loading States

| Stage | Copy |
| --- | --- |
| Extract | Reading your screenshot… / Reading screenshot… |
| Confirm → identity | Resolving confirmed legs… |
| Workspace Analyze | Building Court Context analysis… |

None imply a final score or winner.

## Analytics

No broad analytics change. Existing funnel events remain:

- Props add (selection store; no new wager payload)
- `parlay_xray_open_workspace` (`surface`, `action` only)
- `parlay_workspace_analysis_started` (`surface`, `source`, `action`)

No wager contents transmitted. No event rewires in E7.

## Tests

Updated/added contract coverage:

- XRay: no product `Results.` stage; no idle strongest/riskiest; hero Upload your slip; Confirm/Workspace stages; fail-before-coverage
- Workspace: role copy, Edit Parlay, loading copy, MULTI_GAME / LIVE_CURRENT messages, Review Parlay + Open Workspace
- Props: Review Parlay, no View Parlay overlay, no leftover `parlayDrawerOpen`, Save/Compare/Paper preserved
- Billing: no WOWY exclusive; no locks; checkout still via `/billing`
- Handoff: MULTI_GAME message assertion updated to the new sentence (eligibility code unchanged)

## Regression

| Suite | RUN | PASSED | EXCLUDED | WHY |
| --- | --- | --- | --- | --- |
| `lib/parlay/__tests__` | 86 | 86 | 0 | — |
| `lib/parlay-xray` (excl. postgres) | 235 | 235 | — | — |
| `lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts` | 16 | 0 | **16** | Docker daemon not running; dedicated local Postgres unavailable |
| `lib/entitlements/__tests__/copy.test.ts` | 3 | 3 | 0 | Billing copy contract |

Combined (postgres excluded): **324 passed**. Do not treat the 16 Docker/Postgres tests as passed.

Precedent: E5 parlay 86 passed; XRay 235 passed / 16 excluded. Held.

## Architecture Freeze

No changes to:

- `CanonicalParlayOffer` / `wagerIdentity` / `offerIdentity`
- E1 adapter semantics
- XRay extraction schema / v2.1 / confirm rules
- Decision Close semantics
- Historical matching / context assembly / interpretation / Why This Could Fail **logic**
- Context Engine research contracts

UI-only: `evaluateWorkspaceAnalysisEligibility` **messages** for MULTI_GAME (and existing LIVE_CURRENT copy). Codes unchanged.

## Files Changed

- `components/parlay-xray/ParlayXrayView.tsx`
- `components/parlay-xray/XrayParlaySummary.tsx`
- `components/parlay-xray/XrayResultsPanel.tsx`
- `components/parlay-xray/XrayAnalysisPanel.tsx`
- `components/parlay-xray/ExtractedLegsPanel.tsx`
- `app/parlay-xray/ParlayXrayClient.tsx`
- `lib/parlay-xray/copy.ts`
- `lib/parlay-xray/extraction/copy.ts`
- `components/parlay-workspace/ParlayWorkspaceView.tsx`
- `lib/parlay/workspace-analysis.ts` (user-facing messages only)
- `components/betting/PropsExplorerParlayTray.tsx`
- `app/betting/props-explorer/page.tsx`
- `app/billing/page.tsx`
- `lib/entitlements/types.ts` (`UPGRADE_COPY.wowy` only)
- `lib/parlay-xray/__tests__/page-contract.test.ts`
- `lib/parlay/__tests__/parlay-workspace-page-contract.test.ts`
- `lib/parlay/__tests__/props-explorer-parlay-selection-page-contract.test.ts`
- `lib/parlay/__tests__/xray-workspace-handoff.test.ts`
- `lib/entitlements/__tests__/copy.test.ts`
- `reports/product/parlay-product-polish-ui-qa.md`
- `notes/learning-log/2026-09-16/parlay-product-polish-ui-qa.mdx`

## Schema Changes

**SCHEMA_MIGRATION: NONE**

## Remaining Gaps

- Entitlement runtime still the pre-parlay all-keys `isPro` map (E8).
- Billing bullets still describe current Compare/MM/AI gates, not the E6 parlay Free/Pro matrix.
- Design-preview `?preview=1` / `analysis` still shows strongest/riskiest chrome (bannered, non-product).
- Dual `h1` (shell + page) unchanged.
- Public extraction still kill-switched; live analysis still unavailable; parlays still not persisted.
- Dev Next.js issues overlay can cover the mobile sticky CTA locally.

## Recommended Next Step

**ENTITLEMENT_IMPLEMENTATION** — implement the E6 Free/Pro matrix on top of this hierarchy. Do not enable checkout, public extraction, live analysis, or persistence in that step unless separately scoped.

## Verification Checklist

1. Props Explorer historical LAL @ OKC: Add to Parlay → mobile sticky **Review Parlay** lands on Workspace (no View Parlay sheet).
2. Workspace: Analyze with Court Context → **Why this parlay could fail** appears before Data coverage; Historical / Decision Close labeled.
3. XRay idle: stages Upload/Review/Confirm/Workspace; no Results; no strongest/riskiest.
4. XRay `?preview=replay`: correct OCR (Doncik → Doncic) → Confirm → auto-nav or Review in Workspace; analysis still explicit in Workspace.
5. `/billing`: $10/month; no locks; WOWY not sold as Pro exclusive; checkout not newly enabled.
6. Confirm extraction kill switch still off; no OpenAI/BDL calls from these UI paths.
7. Run `npx vitest run lib/parlay/__tests__ lib/parlay-xray lib/entitlements/__tests__/copy.test.ts --exclude lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts`.

## Step Verdict

GREEN — XRay, Props Explorer, and Parlay Workspace now communicate distinct roles clearly and the converged workflow is ready for entitlement implementation
