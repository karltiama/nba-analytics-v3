# STEP 14P.E9 — First-Run Onboarding + Contextual Product Guidance

## Executive Result

Existing E9 onboarding was audited, not rebuilt. Public XRay honesty from the later product-QA pass is preserved. The only recert gaps closed were preview-harness isolation: guided coachmarks can appear on certified preview routes without live onboarding completion, preview dismiss/tour/analytics do not write production onboarding state, and sequential dismiss computes the next mark in-session.

New users still get a short, skippable, destination-changing flow. Existing accounts are not force-blocked. Public extraction stays disabled.

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
| Analytics | **IMPLEMENTED** | Category-only events. Preview suppressed. |
| Tests | **IMPLEMENTED** | Contract + page-contract suites. |
| Schema assumptions | **IMPLEMENTED** | Maps onto existing `find_edges` / `track_picks` / `learn` and `novice` / `intermediate` / `advanced`. |
| Sportsbook question | **UNNECESSARY** | Not asked. `SPORTSBOOK_OPTIONS` remains for Profile only. |
| Preview harness integration | **PARTIAL → IMPLEMENTED** | Recert: preview shows guided coachmarks without live `completed`; dismiss/tour stay session-local; no live checklist/analytics. |
| Public XRay coachmarks | **IMPLEMENTED** | Public sequence empty. Replay preview may show Upload → Review → Confirm → Workspace. Public page no longer shows a dropzone. |
| Permanent Workspace nav | **UNNECESSARY** | Not added. Contextual `Parlay · n` from E8.5 only. |

No second onboarding system was created.

## Reused Infrastructure

- Betting shell `OnboardingGate` / `OnboardingModal` (Header stays outside the `useSearchParams` Suspense boundary)
- `profiles.onboarding_completed_at` and existing `user_settings` columns
- Radix Dialog
- E8 `evaluateCapability` + `SCREENSHOT_EXTRACTION_AVAILABLE`
- E8.5 `/admin/product-preview` hub and isolated Workspace/XRay fixtures
- `trackEvent` / Umami category events
- Profile `SPORTSBOOK_OPTIONS` list (not an onboarding question)

## Onboarding Eligibility

| Eligibility | Rule | Auto-open |
| --- | --- | --- |
| `new_user` | Authenticated, `createdAt >= 2026-09-16`, no `onboardingCompletedAt`, no local complete | Yes, except billing, profile, `/admin`, preview flags |
| `guest_first_visit` | Unauthenticated, no local complete | Yes (skippable; POST 401 is allowed) |
| `existing_user_prompt` | Older account, no completion | No. Dismissible dashboard prompt only |
| `completed` | Profile timestamp or local complete | Never |

Logged-in Founding Pro (`KrazyKarlHD`, `onboardingCompletedAt=2026-04-03`) opened `/betting` with full dashboard access and no modal.

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
- Public `/parlay-xray` shows the honesty banner, hides the dropzone, and does not auto-open `xray-flow`.
- Certified replay preview (`?preview=replay`) may show `xray-flow` for internal QA only. Confirm stays disabled until OCR correction. Copy states this preview does not enable public screenshot reading.

## Props Explorer Guidance

Coachmarks: Find an offer → Compare books (**3-Hour Pre-Tip → Decision Close**) → Add to Parlay. Browser-verified on Props Preview (`?preview=historical`) without requiring live onboarding completion. Bottom/right callout, not a spotlight overlay. Does not explain every control.

## XRay Guidance

Public: **BLOCKED_BY_READINESS** — no dropzone, no automatic Results stage, no “XRay owns analysis.”

Replay preview: Upload → Review → Confirm → Workspace. Browser-verified after fixture hydrate. Confirm remains the trust boundary. Analysis is described as a Workspace step.

## Workspace Guidance

`workspace-intro` (“This is your Parlay Workspace”) then `workspace-analyze` (“Analyze with Court Context”). Analysis does not auto-run. Source provenance stays secondary. Browser-verified on `/parlay-workspace?preview=historical`. Live dashboard header never showed `Parlay · n` from the 4-leg fixture.

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

**Take a quick tour** sets `replay: true` and clears dismissed coachmarks. Does **not** reset `primaryIntent`, `guidanceLevel`, or `onboardingCompleted`. Preview routes no-op that write. No extra primary nav item.

## Preview Harness Integration

`/admin/product-preview` includes **Onboarding guidance QA**. Internal testers open Props / XRay / Workspace preview cards; guided coachmarks appear without a live completed profile.

Isolation:

- `shouldAutoOpenOnboarding` is false on `/admin/*` and `?preview=`
- `completeChecklistItem` no-ops when `shouldSuppressProductPreviewAnalytics`
- `requestTourReplay` no-ops on preview routes
- `coachmark_seen` / `tour_replayed` are not sent on preview
- Preview coachmark dismissals stay in `GuidanceHost` session state
- Props hub href includes `&preview=historical`
- Live header `Parlay · n` reads the live store only

Browser: preview Analyze did not add `Parlay · n` on `/betting`; public XRay stayed non-uploadable; replay preview still hydrates the certified fixture.

## Persistence

| Store | Fields |
| --- | --- |
| Server | `onboarding_completed_at`; `primary_goal` / `experience_level` mapped from intent/guidance |
| Client | `cc_onboarding_v2` |

Odds/paper defaults may still be written so the existing API contract stays valid; they are not asked in the UI.

**SCHEMA_MIGRATION = NONE.**

Local `completed: false` can coexist with a profile timestamp (this Founding Pro account). Eligibility honors the profile timestamp, so the modal does not return.

## Existing User Behavior

**NOT_FORCE_BLOCKED.** Session `KrazyKarlHD` used Dashboard, Props Preview, Workspace Preview, and XRay without a forced modal. Optional Help map remains in the account menu. `/betting?onboard=1` does not hijack completed or existing-prompt users.

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

No redirect loop observed on `/betting`, preview Workspace, preview XRay, or public XRay.

## Dashboard First Run

Not redesigned. Empty slate still offers **Explore Props** and **Open Workspace**. Checklist is optional and compact. Disabled XRay is not an actionable first-run CTA.

## Mobile QA

Emulated **390px**:

- Welcome/questions/Skip: code + tests (bottom sheet, 44px targets). This signed-in account is already completed, so the modal did not open (correct).
- Coachmarks: bottom-sheet readable on Props and XRay preview.
- Replayable Help: account menu → How Court Context works (desktop verified; same dialog is a bottom sheet on small screens).
- Next.js issues badge can overlap **Got it** in local dev; that overlay is not production chrome.
- Coachmark sheet can sit over the lower filter row on Props; it does not use a spotlight that traps the target.

## Desktop QA

- Modal: compact 28rem Court Context card (not a marketing deck).
- Coachmarks: bottom-right, did not cover Analyze with Court Context.
- Checklist: optional card; does not dominate the slate for this completed account (not shown).
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

Preview interactions do not emit `coachmark_seen`, `checklist_item_completed`, or `tour_replayed`.

## Tests

| Suite | PASSED | FAILED | EXCLUDED | WHY |
| --- | --- | --- | --- | --- |
| `lib/onboarding` | 20 | 0 | 0 | Contract, page contract, preview isolation |
| `lib/parlay/__tests__/product-preview-harness.test.ts` | 8 | 0 | 0 | Hub QA copy, isolation, header |
| Workspace + XRay page-contract | 8 | 0 | 0 | UI contracts unchanged |
| `lib/entitlements` + `lib/auth` + middleware + betting shell/dashboard | 84 | 0 | 0 | Unchanged matrix; auth fail-closed |
| Combined targeted recert (onboarding + entitlements + auth + preview + parlay contracts) | **148** | 0 | 0 | First post-edit run |
| `lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts` | 0 | 0 | **16** | Docker daemon not running; suite throws in `beforeAll` |

## Regression

| Area | Result |
| --- | --- |
| Onboarding tests | PASSED |
| Auth/account tests | PASSED |
| Dashboard / betting-shell tests | PASSED |
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
- Preview Analyze did not write a `Parlay · n` header on `/betting`

## Files Changed

Recert / certify (this step):

- `components/onboarding/GuidanceHost.tsx` — preview-session coachmarks; synchronous next-mark on dismiss
- `lib/onboarding/storage.ts` — `requestTourReplay` no-op on preview flags
- `components/onboarding/ProductTourDialog.tsx` — suppress `tour_replayed` on preview
- `components/admin/product-preview/ProductPreviewHub.tsx` — Onboarding guidance QA copy
- `lib/onboarding/__tests__/contract.test.ts`, `page-contract.test.ts`
- This report + `notes/learning-log/2026-09-16/e9-first-run-onboarding-certify.mdx`

Existing E9 surfaces reused (not rebuilt): `OnboardingModal`, `OnboardingGate`, `GettingStartedChecklist`, `CoachmarkCallout`, dashboard checklist/prompt, Props/Workspace `data-coachmark` hooks, `POST /api/user/onboarding`, `lib/onboarding/contract.ts`, `lib/onboarding/copy.ts`, `lib/onboarding/progress.ts`.

## Schema Changes

**SCHEMA_MIGRATION: NONE.**

## Remaining Gaps

- Guest/new-user modal was unit-tested; this browser session was an already-completed existing account (correctly not blocked).
- Local `cc_onboarding_v2.completed` can be false while `profiles.onboarding_completed_at` is set. Eligibility uses the profile timestamp.
- Replay preview still flashes the public “not available” shell for a moment before the certified fixture hydrates.
- Public XRay coachmarks remain blocked until extraction is intentionally enabled.
- Mobile coachmark sheet can overlap lower filters; local Next.js issues badge can cover Got it in development.

## Recommended Next Step

**LANDING_CONVERSION_POLISH** — first-run onboarding is certified. Pre-BDL product QA already landed on this branch. Remaining work is optional landing/sample-card polish, not extraction, checkout, or modeling.

## Verification Checklist

1. New/guest visit: welcome → intent → guidance → destination; Skip goes to dashboard and does not return.
2. Existing signed-in account: product usable; no forced modal.
3. Analyze a parlay lands on Workspace; Help map says screenshot reading is not available.
4. Guided/replay Props shows Find an offer / Compare / Add to Parlay; 3-Hour Pre-Tip → Decision Close preserved.
5. `/admin/product-preview` cards show coachmarks without completing live checklist or changing `Parlay · n`.
6. Checklist has no Try Parlay XRay; dismiss does not lock features.
7. `$10`, checkout disabled, public extraction disabled remain true.

## Step Verdict

GREEN — the existing E9 implementation now provides short, skippable, readiness-aware onboarding with useful routing and contextual guidance without disrupting existing users
