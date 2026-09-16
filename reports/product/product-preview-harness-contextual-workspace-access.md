# STEP 14P.E8.5 — Product Preview Harness + Contextual Workspace Access

Generated: 2026-09-16  
Status: **GREEN — deterministic preview access now exists for Props Explorer, Parlay XRay, and Parlay Workspace, while active parlays receive contextual header access without changing normal product semantics**

---

## Executive Result

Internal `/admin/product-preview` is the shared preview hub. It deep-links the certified X3F LAL @ OKC / game `18447934` / April 2, 2026 fixture into the existing Props Explorer, Parlay XRay `?preview=replay`, and an isolated Workspace `?preview=historical` client. Public extraction stays disabled. Live Workspace visits remain empty unless the in-memory store already has legs. The header shows **Parlay · n** only from that live store.

| Decision | Value |
| --- | --- |
| PRODUCT_PREVIEW_HUB | **CERTIFIED** |
| PROPS_PREVIEW | **CERTIFIED** |
| XRAY_PREVIEW | **CERTIFIED** |
| WORKSPACE_PREVIEW | **CERTIFIED** |
| PREVIEW_FIXTURE_ISOLATION | **CERTIFIED** |
| CONTEXTUAL_WORKSPACE_HEADER_ACCESS | **CERTIFIED** |
| PERMANENT_WORKSPACE_NAV | **NOT_ADDED** |
| PUBLIC_EXTRACTION | **DISABLED** |
| CURRENT_LIVE_ANALYSIS | **NOT_IMPLEMENTED** |
| PARLAY_PERSISTENCE | **NOT_IMPLEMENTED** |
| ENTITLEMENTS | **UNCHANGED** |
| PRICING | **UNCHANGED** |
| CHECKOUT | **DISABLED** |
| MODEL_TUNING | **FROZEN** |
| REAL_OPENAI_CALLS_THIS_STEP | **0** |
| REAL_BDL_CALLS_THIS_STEP | **0** |
| SCHEMA_MIGRATION | **NONE** |
| NEXT_RECOMMENDED_STEP | **FIRST_RUN_ONBOARDING** |

E9 first-run onboarding already exists in this branch. This step does not start or change it.

---

## Existing Preview Infrastructure Audit

### REUSABLE

- Admin HTML protection: `isAdminHtmlPath` (`/admin` prefix), session middleware, `requireAdminPage` + `ADMIN_EMAILS` allowlist, `robots: { index: false }` (Model Lab pattern).
- XRay certified replay: `/parlay-xray?preview=replay` + `buildHistoricalReplayReviewPreview()` + X3F ground truth.
- Props historical board: `propsExplorerHref({ date, gameId })` already serves Decision Close for past ET dates and labels “Historical closing line”.
- Workspace historical analysis: `runWorkspaceHistoricalAnalysis` + injectable X3F deps.
- Transient selection store: `useParlaySelection` / `selection-store.ts` (no localStorage).
- Empty Workspace already readiness-gates “Import with XRay”.

### MISSING (before this step)

- No admin product-preview hub.
- Workspace had no isolated `?preview=historical` seed (direct `/parlay-workspace` empty).
- XRay `preview=replay` was blocked in production by `isXrayDesignPreviewEnabled`.
- Header had no contextual live-parlay entry.

### INCONSISTENT

- XRay design flags (`1` / `partial` / `analysis`) remain **dev-only**; certified **replay** is now allowed in production as a fixture, not as public extraction.
- Model Lab preview is experiment-status UI; this hub is product-surface fixtures. Reused admin auth, not Model Lab chrome.

---

## Preview Hub

Route: `/admin/product-preview`  
Guard: `requireAdminPage` (unauthenticated → `/login?next=%2Fadmin%2Fproduct-preview`; non-allowlisted → Forbidden).  
Not in `PRIMARY_NAV`. `robots: { index: false, follow: false }`.

Cards:

1. Props Explorer Preview → Open Props Preview
2. Parlay XRay Preview → Open XRay Preview
3. Parlay Workspace Preview → Open Workspace Preview

Helper: “Full Props → Workspace flow” is a deep-link to the Props preview href (no orchestration).

---

## Shared Fixture Strategy

One module: `lib/parlay/preview-fixture.ts`.

Source: `X3F_GROUND_TRUTH_LEGS` (LAL @ OKC, game `18447934`, April 2, 2026, four canonical legs). Workspace preview legs are built with `adaptPropsExplorerOffer` so wager/offer identity stays the certified adapter output. No duplicate ground-truth tables.

---

## Props Explorer Preview

Href: `/betting/props-explorer?date=2026-04-02&game_id=18447934`

Uses the existing Props Explorer. Historical banner: “Last pre-tip closing lines… Not a live sportsbook board.” Add to Parlay unchanged. Browser: LAL @ OKC selected, historical mode labeled, Doncic DraftKings Add to Parlay succeeded.

---

## XRay Preview

Href: `/parlay-xray?preview=replay`

Certified replay now loads in production **only for `replay`**. `analysis` / `1` / `partial` stay non-production. Confirm stays disabled on `Luka Doncik`. Successful Confirm still hands off through `handoffConfirmedXrayParlay` → live store → `/parlay-workspace`. No OpenAI. Browser: Historical Replay banner, Confirm disabled, OCR typo visible.

---

## Workspace Preview

Href: `/parlay-workspace?preview=historical`

`ParlayWorkspaceEntry` switches on `preview=historical` to `ParlayWorkspacePreviewClient`, which holds legs in React state and calls `runWorkspaceHistoricalAnalysis`. Browser: four Decision Close legs, Analyze produced Historical Analysis dated April 2, 2026 · LAL @ OKC.

Normal `/parlay-workspace` still uses `ParlayWorkspaceClient` + live store.

---

## Preview Isolation

Workspace preview **does not** call `replaceParlaySelectionLegs` / `importConfirmedXrayLegsToStore`. It does not write localStorage or sessionStorage.

Chosen header behavior: **header always reflects the live transient store**, never preview-local legs. Opening `?preview=historical` with an empty live store does **not** show Parlay · 4.

---

## Historical Analysis Preview

Same `runWorkspaceHistoricalAnalysis` + `buildX3fReplayContext` / `buildX3fReplayDeps` as the certified Workspace path. No fake interpreter.

---

## Preview Labeling

| Surface | Label |
| --- | --- |
| Hub | Internal · Preview · not indexed |
| Props | Existing historical closing-line copy |
| XRay | Historical Replay — April 2, 2026 · LAL @ OKC |
| Workspace preview | Historical Preview — certified historical fixture |

---

## Contextual Header Access

Copy: **Parlay · n** (`contextualWorkspaceNavLabel`).  
Absent at 0 legs.

- Desktop: text link `Parlay · n` (`hidden md:inline-flex`)
- Mobile: compact count badge + conditional hamburger item
- Accessible name: `Open Parlay Workspace, n leg(s)`

Not in `PRIMARY_NAV`.

---

## Header State Source

`useParlaySelection()` → `getParlaySelectionLegs()`. Same E3/E5 store. Count is canonical Workspace selection, not XRay extraction count or fixture length.

---

## Props → Header Behavior

Add to Parlay updates the store; header badge appeared immediately as `Open Parlay Workspace, 1 leg` on Props Explorer (verified). Tray still shows Review Parlay.

---

## XRay → Header Behavior

Confirm still `importConfirmedXrayLegsToStore`. Header then reads that store. Tests cover import → count 4.

---

## Remove / Clear Behavior

Remove/clear go through `replaceParlaySelectionLegs`. Tests: 4 → 3 on remove, clear → hidden.

---

## Preview vs Normal State

Preview Workspace is isolated. Header stays on live state. Hard reload / full document navigation still clears the live store (unchanged E3 contract).

---

## Empty Workspace Direct Entry

Unchanged empty copy: Explore Props; “Screenshot import is not available yet.” Import with XRay remains gated by `isPublicXrayExtractionReady()` (false).

---

## Mobile Header

Compact numeric badge + hamburger “Parlay · n”. Verified badge after Add to Parlay.

---

## Desktop Header

Secondary `Parlay · n` next to account controls, not a slip button, not primary nav. Covered by contract tests; desktop width not re-shot after the 390px hub check.

---

## Admin Protection

Reuse: session-protected `/admin/*` + `requireAdminPage` / `ADMIN_EMAILS`. No new auth system. Hub not in public nav. Signed-in allowlisted account opened the hub in local verification.

---

## Readiness Separation

Hub copy: “Preview available: yes (historical fixtures). Product ready (public XRay extraction): no.”  
`SCREENSHOT_EXTRACTION_AVAILABLE` remains `false`. Entitlement matrix untouched.

---

## Analytics Isolation

`shouldSuppressProductPreviewAnalytics` skips `parlay_xray_viewed` and `parlay_xray_open_workspace` on replay/design preview flags. Workspace preview Analyze does not call `trackEvent`. No `add_to_parlay` product event existed to suppress. Documented in `EVENTS.md`.

---

## Accessibility

Hub: `h1` Product Preview, `h2` per card, labeled CTAs, status as text. Header: aria-label includes leg count; `aria-live="polite"` on desktop link.

---

## Tests

Added `lib/parlay/__tests__/product-preview-harness.test.ts` (hub links, isolated seed, identities, header 0/1/4, Props add / XRay import / remove / clear, replay OCR Confirm disabled). Updated XRay page-contract (replay allowed in production), Workspace page-contract (Entry), middleware admin path.

---

## Regression

| Suite | Result | Why |
| --- | --- | --- |
| `lib/parlay/__tests__` | **PASSED** | including new harness |
| `lib/parlay-xray` unit/page contracts | **PASSED** | replay production flag updated |
| `lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts` | **EXCLUDED** | Docker daemon not running (pre-existing harness skip/fail) |
| `lib/onboarding/__tests__` | **PASSED** | |
| `lib/entitlements/__tests__` | **PASSED** | |
| `lib/supabase/__tests__/middleware.test.ts` | **PASSED** | |
| `lib/auth/__tests__/require-admin.test.ts` | **PASSED** | |
| `lib/product-analytics/__tests__/track-event.test.ts` | **PASSED** | |

E1–E8 certifications preserved: canonical identity, XRay Confirm, historical analysis, entitlements, public extraction disabled.

---

## Files Changed

- `lib/parlay/preview-fixture.ts` (new)
- `lib/parlay/index.ts`
- `lib/parlay/__tests__/product-preview-harness.test.ts` (new)
- `lib/parlay/__tests__/parlay-workspace-page-contract.test.ts`
- `lib/parlay-xray/copy.ts`
- `lib/parlay-xray/__tests__/page-contract.test.ts`
- `app/admin/product-preview/page.tsx` (new)
- `components/admin/product-preview/ProductPreviewHub.tsx` (new)
- `app/parlay-workspace/page.tsx`
- `app/parlay-workspace/ParlayWorkspaceEntry.tsx` (new)
- `app/parlay-workspace/ParlayWorkspacePreviewClient.tsx` (new)
- `components/parlay-workspace/ParlayWorkspaceView.tsx`
- `app/parlay-xray/ParlayXrayClient.tsx`
- `components/betting/Header.tsx`
- `lib/auth/require-admin.ts` (comment)
- `lib/supabase/__tests__/middleware.test.ts`
- `lib/product-analytics/EVENTS.md`
- `reports/product/product-preview-harness-contextual-workspace-access.md` (this file)

---

## Schema Changes

**SCHEMA_MIGRATION = NONE**

---

## Remaining Gaps

- `?preview=replay` is a known URL, not admin-gated; it is a fixture, not public extraction.
- Props preview relies on existing historical labeling rather than an extra “Internal Preview” chip.
- Desktop `Parlay · n` was contract-tested; live click verification was on the mobile badge.
- First-run onboarding (E9) already exists; this step does not extend it.

---

## Recommended Next Step

**FIRST_RUN_ONBOARDING** (per step contract). If E9 is already certified on this branch, do not re-open it here.

---

## Verification Checklist

1. Open `/admin/product-preview` as an allowlisted admin; confirm three cards and readiness copy.
2. Open Props Preview → LAL @ OKC historical board → Add to Parlay (supported book) → header count updates.
3. Open XRay Preview → `Luka Doncik` → Confirm disabled until corrected → Confirm hands off to live Workspace.
4. Open Workspace Preview → four seeded legs → Analyze with Court Context → Historical Analysis. Header must **not** show Parlay · 4 unless the live store also has four legs.
5. Visit `/parlay-workspace` with no live selection → empty. Hard reload still clears live selection.
6. Confirm Workspace is absent from primary nav.
7. At ~390px, hub cards stack and CTAs remain tappable.

---

## Step Verdict

**GREEN — deterministic preview access now exists for Props Explorer, Parlay XRay, and Parlay Workspace, while active parlays receive contextual header access without changing normal product semantics**
