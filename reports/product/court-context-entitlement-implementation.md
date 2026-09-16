# STEP 14P.E8 — Court Context Free / Pro Entitlement Implementation

## Executive Result

Court Context now has one capability registry (`lib/entitlements/capabilities.ts`) that separates **readiness** from **plan access**. The old `featuresFor(isPro)` map that flipped every key with Pro is gone.

Free keeps the complete Props → Add to Parlay → Workspace → Analyze loop, including Why This Could Fail and missing-data warnings. Pro still receives the three **available** depth modules: line shopping, 3-Hour/per-book Market Movement, and AI briefings. Not-ready, provider-blocked, internal, and kill-switched capabilities deny **both** plans with no upgrade CTA.

**Verdict: GREEN**

## E6 Matrix Source

Authoritative input: `reports/product/parlay-product-acceptance-entitlement-architecture.md`.

Extracted classifications implemented:

| Capability | E6 class | Implemented |
| --- | --- | --- |
| Props browse / filters / selected book-line | FREE | FREE / AVAILABLE |
| Compare panel open | BOTH | BOTH / AVAILABLE |
| MM close consensus | FREE | `MARKET_MOVEMENT_BASIC` FREE |
| MM 3-Hour + per-book | PRO | `MARKET_MOVEMENT_DEEP` PRO |
| Deeper expanded history | NOT_READY | `ADVANCED_HISTORY` NOT_READY |
| Add to Parlay / Workspace / Layer A / Why This Could Fail / Layer B one-line | FREE | FREE, several NEVER_PAYWALL |
| Layer C advanced context | NOT_READY | `PARLAY_ADVANCED_CONTEXT` |
| XRay upload UI | BOTH public | `XRAY_UPLOAD_UI` |
| XRay extraction | BOTH when enabled; kill-switched | `XRAY_EXTRACTION` DISABLED unless runtime flag |
| OCR / Confirm | NEVER_PAYWALL | NEVER_PAYWALL |
| Workspace handoff | FREE | FREE |
| Player/game standard pages | FREE | FREE |
| Player/game advanced modules | NOT_READY | NOT_READY |
| Historical WOWY page | FREE (do not claw back) | `WOWY_BASIC` FREE, public |
| Injury-conditioned WOWY | NOT_READY | `WOWY_ADVANCED` |
| Saved props / Paper | FREE | FREE |
| Saved parlays / alerts | NOT_READY | NOT_READY |
| AI briefing | PRO | PRO / AVAILABLE |
| Live analysis / persistence / correlation | NOT_READY | NOT_READY |
| PTS C / REB C | INTERNAL | INTERNAL_RESEARCH |
| Availability context | BLOCKED_BY_PROVIDER | PROVIDER_BLOCKED |

No UNRESOLVED capability was invented as a gate.

## Existing Entitlement Audit

Pre-change inventory:

| File / module | Capability | Free | Pro | Server | Client | Matched E6? | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `resolve.ts` `featuresFor` | All FEATURE_KEYS | all false | all true | yes | via features blob | **NO** (WOWY, alerts, history) | Replace with registry |
| `sanitize-prop-market.ts` | shopping + full MM | stripped | full | **SERVER_ENFORCED** | upgrade UI | YES (available Pro) | Keep, via `hasFeature` |
| `market-preview.ts` | free range copy | counts/range | n/a | n/a | presentation | YES | Keep |
| AI slate + matchup APIs | `ai_briefing` | 403 | allowed | **SERVER_ENFORCED** | upgrade link | YES | Pass `decision` |
| `/wowy` | historical WOWY | public | public | none | none | YES product; NO features map | Grant Free `wowy` |
| Workspace / parlay | analysis | ungated | ungated | none | none | YES | Do not add paywall |
| XRay extract/quota | kill switch + daily 3/10 | disabled | disabled | kill switch first; `isPro` only for safety cap | quota label | YES if quotas ≠ policy | Keep; comment safety |
| `UPGRADE_COPY` alerts/history | not-ready | — | copy said Unlock Pro | — | unused CTAs | **NO** | Not-available copy |
| Billing page | marketing | — | shopping/AI; WOWY honesty from E7 | checkout env | — | Partial | Align Free core vs Pro depth |
| `getBillingAvailability` | checkout | disabled in production | same | yes | — | YES freeze | Unchanged |

## Contradictions Found

1. **All-keys-with-`isPro`:** WOWY, alerts, and advanced_history flipped true for Pro even though E6 says WOWY is public Free and the others are not ready.
2. **Upgrade copy for unshipped modules** implied Pro could buy alerts/history.
3. HTTP 403 always sent `planRequired: founding_pro`, so a not-ready deny looked like an upgrade.

Those three are closed. Remaining `isPro` uses are billing display and XRay **safety** caps (see Direct Plan Checks Remaining).

## Capability Registry

`lib/entitlements/capabilities.ts`

- `CAPABILITY_REGISTRY` — readiness + planAccess + neverPaywall/public
- `evaluateCapability(plan, capability, runtime?)` → `{ capability, readiness, access, reason, showUpgrade }`
- `evaluateFeature` maps existing `FEATURE_KEYS` onto the registry
- `featureFlagsForPlan` fills `ResolvedEntitlement.features` so API blobs stay compatible

Decision order: kill switch → auth (if provided) → internal/provider/not-ready → plan.

## Readiness vs Plan Access

`showUpgrade` is true **only** when readiness is AVAILABLE and planAccess is PRO and the user is Free.

Pro + NOT_READY / PROVIDER_BLOCKED / INTERNAL / KILL_SWITCH → deny, `showUpgrade: false`.

## Free Core Workflow

Certified ungated (auth still required for `/betting/*`):

Props browse → Add to Parlay → Workspace review → Analyze (when eligibility READY) → structural notes → Why This Could Fail → Layer B one-line → coverage/missing-data.

No new Workspace or Explorer paywall was added.

**FREE_CORE_WORKFLOW: CERTIFIED**

## Pro Capabilities

Available and gated (server + client upgrade module):

- Exact best-book / line-price (`LINE_SHOPPING_DETAIL`)
- 3-Hour Pre-Tip → Decision Close per-book (`MARKET_MOVEMENT_DEEP`)
- AI slate/matchup briefing (`AI_BRIEFING`)

Not sold: live analysis, saved parlays, alerts, WOWY exclusive, XRay 3 vs 10 as plan policy, PTS C/REB C.

**PRO_CAPABILITIES: CERTIFIED**

## Never-Paywall Capabilities

Registry `neverPaywall: true`:

- `PARLAY_STRUCTURAL_ANALYSIS`
- `PARLAY_WHY_THIS_COULD_FAIL`
- `XRAY_CORRECTION`
- `XRAY_CONFIRM`

Also Free/available (not monetized): wager identity, Decision Close labeling, coverage gaps, Workspace shell, WOWY page.

**NEVER_PAYWALL_SAFETY_INFO: CERTIFIED**

## Not-Ready Capabilities

Live analysis, measured correlation, parlay persistence, saved parlays, alerts, advanced history, Layer C, advanced WOWY, advanced player/game modules, public XRay extraction.

Free and Pro both denied. HTTP uses `FEATURE_NOT_AVAILABLE` when `showUpgrade` is false.

## Internal Research Capabilities

`PTS_C_REB_C` → `INTERNAL_ONLY` even for Pro.

## Safety Quotas vs Product Limits

`dailyLimitForPlan` remains Free 3 / Pro 10 / global 100 / cooldown / 1 in-flight as **technical guardrails**. Comment states they are not launched plan policy. Billing copy does not mention 3/10/100.

**XRAY_SAFETY_QUOTAS: TECHNICAL_DEFAULTS_NOT_PLAN_POLICY**

## XRay Entitlement Boundary

1. Kill switch / `SCREENSHOT_EXTRACTION_AVAILABLE = false` → `KILL_SWITCH` for both plans.
2. Auth required for the extract API.
3. When enabled, planAccess is BOTH (metered by safety caps, not a Pro-only feature).
4. Pro does not bypass the kill switch (`evaluateCapability(PRO, 'XRAY_EXTRACTION')` denies).
5. Pipeline still returns `EXTRACTION_DISABLED` before provider.

**PUBLIC_EXTRACTION: DISABLED**

## Props Explorer

Browse, filters, selected offer, Add to Parlay, Save, Paper: Free. Compare opens for both. Server still sanitizes best-book and full MM for Free; client upgrade modules remain for those AVAILABLE Pro slices only.

## Parlay Workspace

No plan branch in analysis logic. Workspace remains usable. Why This Could Fail stays Free.

## Market Movement

- Basic close consensus: Free (`detail: 'summary'`)
- 3-Hour + per-book: Pro (`detail: 'full'`)
- Terminology: 3-Hour Pre-Tip → Decision Close / Close. Not Opening.

## WOWY

`WOWY_BASIC` allowed for anonymous and Free. `features.wowy` is now **true** on Free. Advanced/injury WOWY remains NOT_READY. Billing states WOWY stays on `/wowy` for everyone.

## Player / Game Research

Standard pages Free. Distinct advanced modules NOT_READY (no new page gates, none existed).

## Save / Paper

Remain Free for authenticated betting users. Saved parlays NOT_READY. No schema change.

## Authentication Boundary

`authenticated: false` → `AUTH_REQUIRED` and `showUpgrade: false` for non-public capabilities. Public: landing, XRay HTML, WOWY page. `/betting/*` still redirects to login (pre-existing). Upgrade links are not used as a substitute for sign-in.

## Server Enforcement

| Capability | Class |
| --- | --- |
| Line shopping / deep MM | SERVER_ENFORCED (`sanitizePropMarketResearch`) |
| AI briefing | SERVER_ENFORCED (`requireEntitlement`) |
| XRay extract | SERVER_ENFORCED (kill switch in pipeline; auth on route) |
| Workspace analysis | NOT_APPLICABLE (Free / never-paywall) |
| WOWY page | NOT_APPLICABLE (public Free) |

## Client / Server Parity

Tests assert `evaluateFeature` deny ≡ sanitized empty shopping/books for Free, allow ≡ books kept for Pro; `featureFlagsForPlan` matches `ResolvedEntitlement.features`; WOWY Free true; alerts Pro false.

**CLIENT_SERVER_PARITY: CERTIFIED**

## Billing Page

`$10/month` unchanged. Lists actual Pro depth (best book, best price, 3-Hour/per-book, AI as context). Names Free Court Context loop including Why this parlay could fail. Does not sell live analysis, saved parlays, alerts, extraction quotas, or WOWY exclusive.

## Checkout

`getBillingAvailability`: production still `checkoutEnabled: false`. Live keys never enable checkout. Tests: `lib/billing` 59 passed.

**CHECKOUT: UNCHANGED_DISABLED**
**PRICING: UNCHANGED**

## Upgrade UX

Existing module-level `FoundingProUpgradeLink` on Compare shopping, Market Movement summary, and AI briefing panels. Routes to `/billing`, not Checkout. No new modals. Core Free workflow has no upgrade maze.

## Direct Plan Checks Removed

- `FEATURE_KEYS.map((key) => [key, isPro])` all-true-if-Pro map
- `requireEntitlement` reading `entitlement.features[feature]` without readiness
- Unconditional `planRequired: founding_pro` on every 403

## Direct Plan Checks Remaining

| Location | Why it remains |
| --- | --- |
| `resolveEntitlementFromRow` / `isPro` on `ResolvedEntitlement` | Plan snapshot for billing + `evaluateFeature({ isPro })` |
| `app/api/billing/status` `isPro` | Plan display, not a product module |
| `lib/billing/status-copy.ts` / checkout / success page | Stripe/account UX |
| `dailyLimitForPlan(config, isPro)` extract + quota routes | **Safety quota**, labeled as such |
| `sanitize` response `entitlement.isPro` | Existing API contract for Compare UI |

Product module decisions go through `evaluateCapability` / `hasFeature`.

## Analytics Privacy

No new entitlement telemetry. Existing MM upgrade click still sends `surface` only.

## Tests

`lib/entitlements/__tests__`: **42 passed** (including new `capabilities.test.ts` 11).

`lib/billing`: **59 passed**.

## Parlay Regression

`lib/parlay/__tests__`: **86 passed**. Identity, Workspace, historical analysis, Why This Could Fail logic, source convergence unchanged.

## XRay Regression

`lib/parlay-xray` excluding postgres: **235 passed**.

`postgres-persistence.test.ts`: **16 EXCLUDED** — Docker daemon not running (same E7 precedent). Not claimed passed.

Extraction v2.1, Confirm, handoff, public extraction disabled preserved.

## Modeling Freeze

MODEL_TUNING FROZEN. SHADOW_SCORING DISABLED. No OpenAI/BDL calls. PTS C/REB C remain INTERNAL_ONLY.

## Files Changed

- `lib/entitlements/capabilities.ts` (new)
- `lib/entitlements/index.ts` (new)
- `lib/entitlements/resolve.ts`
- `lib/entitlements/queries.ts`
- `lib/entitlements/http.ts`
- `lib/entitlements/types.ts`
- `lib/entitlements/sanitize-prop-market.ts`
- `lib/entitlements/__tests__/capabilities.test.ts` (new)
- `lib/entitlements/__tests__/resolve.test.ts`
- `lib/entitlements/__tests__/queries.test.ts`
- `lib/entitlements/__tests__/copy.test.ts`
- `app/api/betting/ai-slate-insights/route.ts`
- `app/api/betting/games/[gameId]/ai-projection-summary/route.ts`
- `app/api/parlay-xray/extract/route.ts` (comment)
- `app/billing/page.tsx`
- `lib/parlay-xray/extraction/config.ts` (safety-quota comment)
- `reports/product/court-context-entitlement-implementation.md`
- `notes/learning-log/2026-09-16/court-context-entitlement-implementation.mdx`

## Schema Changes

**SCHEMA_MIGRATION: NONE** — reused `public.user_entitlements`.

## Remaining Gaps

- Public XRay extraction still disabled (intentional).
- Checkout still disabled in production (intentional).
- Live analysis still not implemented (intentional).
- Compare still uses module upgrade chrome rather than the new `evaluateCapability` helper in the React tree; server sanitize is authoritative and parity-tested.
- XRay remaining-reads label still shows `{n} of {limit}` from safety caps (not marketed as plan policy).

## Recommended Next Step

**FIRST_RUN_CONVERSION_POLISH** — teach the hybrid loop on first use without enabling checkout, extraction, or live analysis.

## Verification Checklist

1. Free (or logged-out features map): `wowy` true; `line_shopping_detail` / `market_movement` / `ai_briefing` false; `alerts` / `advanced_history` false.
2. Pro: shopping + deep MM + AI true; `alerts` still false; live analysis evaluateCapability deny without upgrade.
3. Props → Add to Parlay → Workspace → Analyze still has Why This Could Fail (no new paywall).
4. Compare Free: close consensus + upgrade for 3-Hour/best book; Pro: full MM.
5. `/billing`: $10/month; no 3/10/100; no live analysis as a current benefit; checkout not newly enabled.
6. Extract kill switch still default off; Pro cannot evaluate XRAY_EXTRACTION as allow.
7. `npx vitest run lib/entitlements lib/billing lib/parlay/__tests__ lib/parlay-xray --exclude lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts`

## Step Verdict

GREEN — Court Context now has one centralized Free / Pro entitlement system that preserves a complete Free value loop, gates only approved available capabilities, and keeps readiness/safety separate from plan access
