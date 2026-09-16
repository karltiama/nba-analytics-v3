# STEP 14P.E9 — First-Run Onboarding + Contextual Product Guidance

## Executive Result

The existing E9 onboarding stack was audited, not rebuilt. Gaps closed in this recert pass were preview-harness isolation (no auto-open, no live checklist/analytics pollution) and readiness-honest XRay guidance (Upload → Review → Confirm → Workspace only on certified replay preview). New users still get a short, skippable, destination-changing flow. Existing accounts are not force-blocked. Public extraction stays disabled.

**Verdict: GREEN**

**ONBOARDING: CERTIFIED**

## Existing E9 Audit

Inventory on this branch before recert edits:

| Surface | Classification | Notes |
| --- | --- | --- |
| Route / gate (`OnboardingGate` + `OnboardingModal`) | **IMPLEMENTED** | Welcome → intent → guidance. Bottom sheet on mobile, 28rem card on desktop. |
| Onboarding state (`cc_onboarding_v2`) | **IMPLEMENTED** | completed, skipped, primaryIntent, guidanceLevel, dismissedCoachmarks, checklist, replay, existing-user prompt flags. |
| Persistence | **IMPLEMENTED** | Profile `onboarding_completed_at` + mapped `user_settings` CHECK enums. No new columns. |
| New-user eligibility | **IMPLEMENTED** | `createdAt >= 2026-09-16T00:00:00.000Z` and no completion timestamp. |
| Existing-user behavior | **IMPLEMENTED** | `existing_user_prompt` never auto-opens. Dismissible “New: personalize Court Context”. |
| Questions | **IMPLEMENTED** | Primary intent + guidance density only. |
| Answer values | **IMPLEMENTED** | `research_props` / `analyze_parlay` / `research_players_games` / `explore`; `getting_started` / `stats_researcher` / `advanced`. |
| Routing | **IMPLEMENTED** | Real destinations only. Analyze → Workspace while extraction is kill-switched. |
| Coachmarks | **IMPLEMENTED** | Props 3, Workspace intro + Analyze, Why this could fail. |
| Checklist | **IMPLEMENTED** | Four generic actions. No Try Parlay XRay. Dismissible. Does not gate. |
| Tour / help replay | **IMPLEMENTED** | Account menu **How Court Context works**. Replay clears dismissed coachmarks only. |
| Readiness checks | **IMPLEMENTED** | `evaluateCapability(..., XRAY_EXTRACTION)` + `SCREENSHOT_EXTRACTION_AVAILABLE`. |
| Analytics | **IMPLEMENTED** | Category-only events. |
| Tests | **IMPLEMENTED** | Contract + page-contract suites. |
| Schema assumptions | **IMPLEMENTED** | Maps onto existing `find_edges` / `track_picks` / `learn` and `novice` / `intermediate` / `advanced`. |
| Sportsbook question | **UNNECESSARY** | Not asked. `SPORTSBOOK_OPTIONS` remains for Profile only. |
| Preview harness integration | **PARTIAL → IMPLEMENTED** | Recert: no auto-open on `/admin` or `?preview=`; checklist/analytics no-op; hub QA copy; `xray-flow` on replay only. |
| Public XRay coachmarks | **CONFLICTING → IMPLEMENTED** | Recert: public XRay sequence is empty; replay preview may show Upload → Review → Confirm → Workspace. |
| Permanent Workspace nav | **UNNECESSARY** | Not added. Contextual `Parlay · n` from E8.5 only. |

## Reused Infrastructure

- Betting shell `OnboardingGate` / `OnboardingModal` (Header stays outside the `useSearchParams` Suspense boundary)
- `profiles.onboarding_completed_at` and existing `user_settings` columns
- Radix Dialog
- E8 `evaluateCapability` + `SCREENSHOT_EXTRACTION_AVAILABLE`
- E8.5 `/admin/product-preview` hub and isolated Workspace/XRay fixtures
- `trackEvent` / Umami category events
- Profile `SPORTSBOOK_OPTIONS` list (not an onboarding question)

No second onboarding system.

## Onboarding Eligibility

| Eligibility | Rule | Auto-open |
| --- | --- | --- |
| `new_user` | Authenticated, `createdAt >= 2026-09-16`, no `onboardingCompletedAt`, no local complete | Yes, except billing, profile, `/admin`, preview flags |
| `guest_first_visit` | Unauthenticated, no local complete | Yes (skippable; POST 401 is allowed) |
| `existing_user_prompt` | Older account, no completion | No. Dismissible dashboard prompt only |
| `completed` | Profile timestamp or local complete | Never |

Logged-in Founding Pro (`onboardingCompletedAt=2026-04-03`) opened `/betting` with full dashboard access and no modal.

## Welcome

Copy: “Welcome to Court Context” / understand context behind props, parlays, players, and games — then make your own decision. Two paths: research a player prop, or review a parlay you assembled. Not a picks service.

## Primary Intent

What are you here to do?

| Choice | Destination |
| --- | --- |
| Research player props | `/betting/props-explorer` |
| Analyze a parlay | `/parlay-workspace` while public extraction is disabled |
| Research players and games | `/teams` |
| Explore Court Context | `/betting` |

No placeholder routes. Analyze copy names Workspace, not a fake XRay upload.

## Guidance Level

How do you usually research NBA props?

| Answer | Mode | Coachmarks |
| --- | --- | --- |
| I'm just getting started | GUIDED | Props 3 + Workspace intro/analyze + Why this could fail |
| I check stats and trends | GUIDED essentials | Add to Parlay + Analyze + Why this could fail |
| I compare lines and deeper analytics | MINIMAL | No automatic multi-step coachmarks; Help remains |

Does not change entitlements, analysis, model output, or basketball truth.

## Sportsbook Preference Decision

**SKIPPED_NOT_USEFUL.** Court Context does not immediately and safely consume a preferred book (would risk hiding books or silently substituting lines). `SPORTSBOOK_OPTIONS` stays on Profile. E9 modal does not collect it.

## Skip Behavior

**Skip for now** is always visible in the footer (44px target). Escape also skips. Skip marks onboarding complete with null intent/guidance and routes to `/betting`. No punishment. Does not re-open on refresh. Overlay click is blocked so skip is explicit, not accidental.

## First Destination Routing

`destinationForIntent` is the single router. Skip and Explore go to the dashboard. Analyze-a-parlay does **not** go to `/parlay-xray` while `isPublicXrayExtractionReady()` is false.

## Public XRay Readiness Behavior

`isPublicXrayExtractionReady()` = `evaluateCapability(..., 'XRAY_EXTRACTION', { xrayExtractionEnabled: SCREENSHOT_EXTRACTION_AVAILABLE })`.

- PUBLIC_EXTRACTION remains DISABLED.
- Pro cannot override the kill switch.
- Product map: “Screenshot reading is not available yet.”
- Workspace empty copy: “Screenshot import is not available yet.”
- Checklist omits XRay.
- Public XRay coachmark sequence is empty.
- Certified replay preview (`?preview=replay`) may show `xray-flow` for internal QA only. Confirm stays disabled until OCR correction. Copy states this preview does not enable public screenshot reading.

## Props Explorer Guidance

Coachmarks: Find an offer → Compare books (**3-Hour Pre-Tip → Decision Close**) → Add to Parlay. Browser-verified on Props Preview after tour replay. Bottom/right callout, not a spotlight overlay. Does not explain every control.

## XRay Guidance

Public: **BLOCKED_BY_READINESS** — no automatic Results stage, no “XRay owns analysis.”

Replay preview: Upload → Review → Confirm → Workspace. Browser-verified. Confirm remains the trust boundary. Analysis is described as a Workspace step.

## Workspace Guidance

`workspace-intro` (“This is your Parlay Workspace”) then `workspace-analyze` (“Analyze with Court Context”). Analysis does not auto-run. Source provenance stays secondary. Browser-verified on `/parlay-workspace?preview=historical`. Live `/parlay-workspace` stayed empty after preview Analyze (no store contamination).

## First Analysis Guidance

`data-coachmark="why-fail"` on **Why this parlay could fail**. Copy: counter-signals, shared dependencies, line movement, missing information — not reasons a wager could work. No probability, risk score, or lock language. Browser-verified after preview Analyze.

## Getting Started Checklist

Dashboard card: Explore a prop, Compare market movement, Add a prop to a parlay, Analyze a parlay. Optional. Dismissible. No Try Parlay XRay. Completion IDs: `explore_prop`, `compare_opened`, `parlay_leg_added`, `workspace_analyzed`. No player/line/book payload. Preview Analyze/Add does not complete live items.

## Help / Tour Replay

Account menu **How Court Context works** (guest and signed-in). Concise product map:

- Props Explorer — Discover and compare props.
- Parlay Workspace — Review and analyze the parlay as a whole.
- Players & Games — Research deeper basketball context.
- Parlay XRay — Import a slip you have already built. Screenshot reading is not available yet.

**Take a quick tour** sets `replay: true` and clears dismissed coachmarks. Does **not** reset `primaryIntent`, `guidanceLevel`, or `onboardingCompleted`. No extra primary nav item.

## Preview Harness Integration

`/admin/product-preview` includes **Onboarding guidance QA**. Internal testers replay Help → tour, then open Props / XRay / Workspace preview cards.

Isolation:

- `shouldAutoOpenOnboarding` is false on `/admin/*` and `?preview=`
- `completeChecklistItem` no-ops when `shouldSuppressProductPreviewAnalytics`
- `coachmark_seen` is not sent on preview
- Props hub href includes `&preview=historical`
- Live header `Parlay · n` reads the live store only

Browser: preview Analyze did not add `compare_opened`; live Workspace stayed empty; header never showed `Parlay · n` from the 4-leg fixture.

## Persistence

| Store | Fields |
| --- | --- |
| Server | `onboarding_completed_at`; `primary_goal` / `experience_level` mapped from intent/guidance |
| Client | `cc_onboarding_v2` |

Odds/paper defaults may still be written so the existing API contract stays valid; they are not asked in the UI.

**SCHEMA_MIGRATION = NONE.**

Local `completed: false` can coexist with a profile timestamp (this Founding Pro account). Eligibility honors the profile timestamp, so the modal does not return.

## Existing User Behavior

**NOT_FORCE_BLOCKED.** Session `KrazyKarlHD` / `onboardingCompletedAt=2026-04-03` used Dashboard, Props, Workspace, and XRay without a forced modal. Optional Help map and dismissible existing-user prompt remain available. `/betting?onboard=1` does not hijack completed or existing-prompt users.

## Redirect Safety

| Case | Result |
| --- | --- |
| New user → onboarding → destination | Contract + gate `router.push(destinationForIntent)` |
| Skip → `/betting` | Implemented; Escape = skip |
| Completed user | `shouldAutoOpenOnboarding` false |
| Existing account | `existing_user_prompt` / `completed` never auto-open |
| Refresh | Completion timestamp / local complete prevents loop |
| Logout/login | Profile `onboarding_completed_at` persists |
| Preview routes | Auto-open suppressed |

No redirect loop observed on `/betting`, preview Workspace, preview XRay, or live Workspace.

## Dashboard First Run

Not redesigned. Empty slate still offers **Explore Props** and **Open Workspace**. Checklist is optional and compact. Disabled XRay is not an actionable first-run CTA.

## Mobile QA

Emulated **390px**:

- Welcome/questions/Skip: code + tests (bottom sheet, 44px targets). This signed-in account is already completed, so the modal did not open (correct).
- Coachmarks: bottom-sheet readable on Props and XRay preview.
- Checklist: readable on dashboard; Skip/dismiss 44px.
- Replayable Help: account menu → How Court Context works.
- Next.js issues badge can overlap **Got it** in local dev; that overlay is not production chrome.
- Coachmark sheet can sit over the lower filter row on Props; it does not use a spotlight that traps the target.

## Desktop QA

- Modal: compact 28rem Court Context card (not a marketing deck).
- Coachmarks: bottom-right, did not cover Analyze with Court Context.
- Checklist: optional “3 of 4 done” card; does not dominate the slate.
- Help: unobtrusive account-menu item.

## Accessibility

- Semantic buttons / `role="listbox"` + `role="option"` for answers.
- Skip always in the footer; Escape skips the modal (explicit complete).
- Coachmarks: `role="dialog"` `aria-modal="false"`, Got it, Escape dismisses, no focus trap.
- Overlay click does not silently dismiss onboarding.
- `motion-reduce:animate-none` on overlay and content.

## Analytics Privacy

Events: `onboarding_started`, `onboarding_skipped`, `onboarding_completed`, `coachmark_seen`, `checklist_item_completed`, `tour_replayed`.

Properties: `surface`, `primary_intent` category, `guidance_level` category, generic `coachmark_id` / `item_id`. No player, line, odds, parlay contents, or analysis text.

Preview interactions do not emit `coachmark_seen` or `checklist_item_completed`.

## Tests

| Suite | PASSED | FAILED | EXCLUDED | WHY |
| --- | --- | --- | --- | --- |
| `lib/onboarding` | 19 | 0 | 0 | Contract, page contract, preview isolation |
| `lib/parlay/__tests__/product-preview-harness.test.ts` | 8 | 0 | 0 | Hub QA copy, isolation, header |
| `lib/entitlements` | 43 | 0 | 0 | Unchanged matrix; XRay kill switch |
| `lib/auth` + workspace/XRay page-contract + middleware | 47 | 0 | 0 | Auth/account + UI contracts |
| `lib/parlay-xray` postgres persistence (prior full run) | — | — | 16 | Docker/Postgres not running |
| Prior combined E9 recert run | **437** | 0 (1 suite throw in beforeAll) | **16** | `postgres-persistence.test.ts` needs Docker |

## Regression

| Area | Result |
| --- | --- |
| Onboarding tests | PASSED |
| Auth/account tests | PASSED |
| Entitlement tests | PASSED |
| Admin preview harness tests | PASSED |
| Parlay workspace page contract | PASSED |
| Parlay XRay page contract | PASSED |
| Postgres persistence | EXCLUDED — Docker/Postgres not running |
| Product architecture / canonical identity | UNCHANGED |
| Props → Workspace / XRay Confirm → Workspace | UNCHANGED |
| Preview fixture isolation | PRESERVED |
| Contextual Parlay · n | PRESERVED; preview did not contaminate |
| Permanent Workspace nav | NOT_ADDED |

## Entitlement Freeze

No matrix edits. Onboarding only **reads** XRay readiness. No answer unlocks Pro, not-ready, internal, or provider-blocked capabilities. No upgrade prompts during onboarding.

## Preview / Header Freeze

- PRODUCT PREVIEW HUB: CERTIFIED
- PREVIEW_FIXTURE_ISOLATION: CERTIFIED
- CONTEXTUAL_WORKSPACE_HEADER_ACCESS: CERTIFIED
- PERMANENT_WORKSPACE_NAV: NOT_ADDED
- Preview Analyze did not write the live selection store

## Files Changed

Recert / certify (this step):

- `lib/onboarding/contract.ts` — preview auto-open block; `xray-flow`; `coachmarksForSurface(..., previewFlag)`
- `lib/onboarding/copy.ts` — analyze dest + `xray-flow` copy
- `lib/onboarding/progress.ts` — preview checklist no-op
- `lib/onboarding/__tests__/contract.test.ts`, `page-contract.test.ts`
- `components/betting/OnboardingGate.tsx` — pass `preview` search param
- `components/betting/OnboardingModal.tsx` — `motion-reduce`
- `components/onboarding/GuidanceHost.tsx` — previewFlag; skip preview analytics
- `components/betting/BettingAppShell.tsx` — GuidanceHost beside gate
- `components/parlay-xray/ParlayXrayView.tsx` — `data-coachmark="xray-flow"`
- `components/admin/product-preview/ProductPreviewHub.tsx` — Onboarding guidance QA
- `lib/parlay/preview-fixture.ts` — Props href `&preview=historical`
- `lib/parlay/__tests__/product-preview-harness.test.ts`
- This report + `notes/learning-log/2026-09-16/e9-first-run-onboarding-certify.mdx`

Existing E9 surfaces reused (not rebuilt): `OnboardingModal`, `storage.ts`, `GettingStartedChecklist`, `ProductTourDialog`, `CoachmarkCallout`, dashboard checklist/prompt, Props/Workspace `data-coachmark` hooks, `POST /api/user/onboarding`.

## Schema Changes

**SCHEMA_MIGRATION: NONE.**

## Remaining Gaps

- Guest/new-user modal was unit-tested; this browser session was an already-completed existing account (correctly not blocked).
- Local `cc_onboarding_v2.completed` can be false while `profiles.onboarding_completed_at` is set. Eligibility uses the profile timestamp.
- Landing CTA still says “Start Winning Now” (out of scope).
- Public XRay coachmarks remain blocked until extraction is intentionally enabled.
- Mobile coachmark sheet can overlap lower filters; local Next.js issues badge can cover Got it in development.

## Recommended Next Step

**PRE_BDL_PRODUCT_QA** — walk the certified Props → Workspace → historical analysis loop (and preview hub) as a product QA pass before any BDL/live-data work. Landing conversion polish remains optional and must not enable checkout.

## Verification Checklist

1. New/guest visit: welcome → intent → guidance → destination; Skip goes to dashboard and does not return.
2. Existing signed-in account: product usable; no forced modal.
3. Analyze a parlay lands on Workspace; Help map says screenshot reading is not available.
4. Guided/replay Props shows Find an offer / Compare / Add to Parlay; 3-Hour Pre-Tip → Decision Close preserved.
5. Replay Help → tour, then `/admin/product-preview` cards: coachmarks appear; live checklist and `Parlay · n` do not change from preview Analyze.
6. Checklist has no Try Parlay XRay; dismiss does not lock features.
7. `$10`, checkout disabled, public extraction disabled remain true.

## Step Verdict

GREEN — the existing E9 implementation now provides short, skippable, readiness-aware onboarding with useful routing and contextual guidance without disrupting existing users
