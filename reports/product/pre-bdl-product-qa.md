# STEP 14P.E10 — Pre-BDL Product QA + Launch Readiness

## Executive Result

Court Context’s research loop is coherent without live BDL: Props → Workspace, historical game research, WOWY, entitlements, onboarding, and the admin preview harness all work as certified. E10 did not add features. It closed launch-trust P1s: stale NBAEdge / Start Winning copy, landing demo 404s, injury overclaims on landing and auth, env-var jargon in briefing empty states, and a public XRay upload path that looked available while extraction is kill-switched.

Remaining launch-critical work is provider-side (BDL canaries, live analysis, public extraction, checkout). No code P0 remains.

**Verdict: GREEN**

## Route / Surface Inventory

| ROUTE | ROLE | AUTH | READINESS | DATA MODE | WORKING? | USER-FACING ISSUE? | ACTION |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | Public landing | Public | Ready | Sample illustration | Yes | Brand/overclaim P1s | **FIXED** |
| `/login` `/signup` | Auth | Public | Ready | Marketing | Yes | Injuries overclaim | **FIXED** |
| `/billing` | Account | Session | Checkout disabled | n/a | Yes | “Back to betting” | **FIXED** (label) |
| `/wowy` | Research | Public HTML | Ready | Historical 2023–25 pin | Yes | “Impact” title P2 | Leave |
| `/teams` `/teams/[id]` | Research | Public HTML | Ready | Pin 2025–26 | Yes | Disabled spread/ML P2 | Leave |
| `/betting` | Dashboard | Session | Offseason freeze | Replay / empty slate | Yes | None blocking | Leave |
| `/betting/props-explorer` | Discovery | Session | Historical + freeze | Current vs historical badge | Yes | “Current market” on frozen date P2 | Leave |
| `/betting/players/[id]` | Player research | Session | Historical | Pin 2025 | Yes | Different tab model than game explorer P2 | Leave |
| `/betting/games/[id]` | Game research | Session | Historical Final certified | Historical / unavailable live | Yes | Fake `demo-*` from landing | **FIXED** (no longer linked) |
| `/parlay-xray` | Import | Public HTML | Public extraction DISABLED | Idle honesty | Yes | Looked fully uploadable | **FIXED** |
| `/parlay-xray?preview=replay` | Internal preview | Admin/dev | Preview only | Fixture | Yes | Dev preview links in non-prod | Leave |
| `/parlay-workspace` | Shared destination | Public HTML | Historical analysis | Live store / preview isolated | Yes | Empty state honest | Leave |
| `/betting/saved` `/betting/paper` `/betting/profile` | Account tools | Session | Ready | User data | Not fully re-walked | — | Leave |
| `/betting/bet-slip-analyzer` | Parked | Session | Redirect | n/a | Redirects to XRay | None | Leave |
| `/admin/product-preview` | Internal | Admin | Certified | Fixture | Yes | None | Leave |
| `/admin/model-lab` | Internal | Admin | Frozen artifacts | n/a | Not re-run | Not customer | Leave |
| `/ops` | Internal health | Session | Ops | n/a | Not customer | Leave | Leave |
| `/research/*` | Internal research | Public? | Research-only | n/a | Not marketed | Leave | Leave |

## Navigation

Desktop primary nav: Dashboard, Teams, WOWY, Parlay XRay, Props Explorer, Saved, Paper, Profile. All resolve. Workspace is **not** a permanent item; `Parlay · n` is contextual from the live store. Account menu includes How Court Context works, Profile, Billing, Sign out. Mobile uses hamburger + optional parlay count badge. No duplicate primary Workspace entry added.

## Landing

Was **OVERCLAIMED / STALE** (NBAEdge footer, NBA Analytics title, Start Winning Now, injuries, demo-1 404s, “View Full Terminal”, “live odds and analysis”).

Now **ACCURATE** for a research product: Court Context metadata, Explore Court Context, sample matchups labeled illustration-only, CTAs to `/betting` and `/betting/props-explorer`.

## Brand / Copy

Preferred identity applied on public chrome: **Court Context / More than the trend.** Hero and auth panel use research framing. Removed casino/winning-pick language on landing and login. In-app Header subtitle still says “Betting Dashboard” (P2).

## First Run

E9 recertified. Existing Founding Pro (`onboardingCompletedAt=2026-04-03`) is not force-blocked. Checklist omits XRay. Help/Tour remains in the account menu. Preview Analyze does not write the live store.

## Dashboard

Purpose is clear under offseason freeze. Empty slate: Explore Props / Open Workspace. Checklist optional. Recent form strip uses historical L5 vs season — not a tonight pick. No dead primary actions.

## Props Explorer

Date selector, filters, books, empty freeze copy are honest. `No prop data is available for Today` + freeze explanation. Decision Close / 3-Hour Pre-Tip language remains on Compare (certified). Preview fixture still labeled historical.

## Market Movement

Player Compare contract remains **3-Hour Pre-Tip → Decision Close**. Historical game lines use certified First Observed / sportsbook lines on Final pages. Not conflated with Opening in the audited copy. Free vs Pro module behavior unchanged (E8).

## Parlay Flows

FLOW A (Props → Add → Workspace → Analyze): certified E8.5/E9; empty Workspace points to Props; screenshot import not advertised.

FLOW B (XRay replay → OCR → Confirm → Workspace): certified preview harness. Public extract path no longer looks live.

Canonical identity, no auto-analysis, Why This Could Fail on analyzed historical parlays — unchanged.

## XRay

Public: banner + no dropzone while `SCREENSHOT_EXTRACTION_AVAILABLE = false`. Next action: Props Explorer.

Preview/replay: Upload → Review → Confirm → Workspace preserved. No Results-as-owner on public idle. Kill switch unchanged.

## Workspace

EMPTY: what / why / next (Explore Props; import not available). SELECTED/ANALYZED: certified historical path. PREVIEW: isolated. HARD RELOAD of empty store is understandable.

## Player Research

`/betting/players/434` loads identity, season pin, Trends / Matchup / Game Log, prop sidebar. Certified Starting Five → Box → Season Role → Timeline → Lines lives on **historical game** pages, not this player tab set. Do not reorder here.

## Game Research

Historical Final `18447934` shows Starting Five, Season Role — 2025–26, Game chronology, Sportsbook lines. No injury module on that tape. Unknown `demo-1` shows Game not found + Back to Dashboard.

## WOWY

Game-level participation copy is accurate. DNP not labeled injury. Explicitly not possession-level / five-man / projection adjustment. Season switcher 2025/2024/2023 is **INTENTIONAL_PIN**.

## Team Pages

Directory + Celtics 2025–26 page work. Upcoming empty is honest. 2026–27 season switch exists without flipping the production pin. Spread / Money line controls disabled without explanation (P2).

## Auth / Account

Login/signup: Google + email, Court Context chrome. Injuries overclaim **FIXED**. Existing session not hijacked. Billing reachable from account menu.

## Entitlements

Runtime still uses `lib/entitlements/capabilities.ts`. Public XRay honesty now matches E8 deny. No plan unlock of NOT_READY / INTERNAL / PROVIDER_BLOCKED.

## Billing

`$10/month` unchanged. Founding Pro session showed Manage billing, not a live checkout start. WOWY not sold as Pro-exclusive. Saved parlays / live analysis / extraction explicitly not included.

## Date / Season Audit

| Location | Value | Class |
| --- | --- | --- |
| `PINNED_ANALYTICS_SEASON` | `2025` | **INTENTIONAL_PIN** |
| WOWY `SEASONS` | 2025/2024/2023 | **INTENTIONAL_PIN** |
| Team page “Current Season — 2025–26” | pin | **INTENTIONAL_PIN** |
| X3F preview 2026-04-02 | fixture | **HISTORICAL_FIXTURE** |
| Landing demo 4/4/2026 rows | sample | **HISTORICAL_FIXTURE** (now labeled) |
| Dashboard date 2026-09-16 | calendar today | **LIVE_READY** empty freeze |
| Onboarding cutoff 2026-09-16 | eligibility | **INTENTIONAL_PIN** |

## Data Mode Audit

Preview `?preview=historical|replay` labeled. Public XRay no longer masquerades as live import. Landing samples labeled illustration. Workspace preview does not fill the live store.

## Loading States

Game details skeleton then Game not found. Billing “Loading billing…”. Props table then freeze empty. No infinite spinner observed on audited routes.

## Empty States

Dashboard, Props, Workspace, WOWY (search first), Teams rankings, Game not found — each answers what / why / next without implementation jargon after E10 copy fixes.

## Error States

Unauthorized HTML redirects to login (middleware). Entitlement 403 remains structured. Briefing missing-key copy no longer names `OPENAI_API_KEY`. Game missing: Game not found.

## Mobile QA

~390px: landing hero readable; Explore / Sign In 44px; sample matchups labeled. Logo slightly clipped (P2). Props explorer filters usable; table horizontally scrollable. Workspace empty + hamburger OK. XRay honesty banner readable.

## Desktop QA

Landing compact, not a marketing deck. Dashboard checklist does not dominate. No second Workspace nav item. Duplicate “Court Context / Betting Dashboard” header remains (P2).

## Accessibility

Auth fields labeled. Skip/onboarding still 44px (E9). XRay public dropzone removed so there is no unlabeled dead file input. Remaining: team disabled spread/ML without `aria-description` (P2).

## Console QA

Next.js issues overlay present in local dev (non-blocking). No hydration failure observed on audited routes. Provider hostnames not in `performance` resource list.

## Network QA

No `api.balldontlie.io` / `api.openai.com` resource entries during landing, dashboard, Props today, XRay public, Workspace empty, historical game, billing, preview hub. Preview hub copy: no provider call.

## Performance Smoke

No launch-blocking N+1 or render loop observed. Preview fixtures do not fetch live providers. Not benchmarked.

## Broken / Dead UI

| Item | Class | Disposition |
| --- | --- | --- |
| Landing View matchup → `/betting/games/demo-1` | P1 | **FIXED** |
| Public XRay Choose file while kill-switched | P1 | **FIXED** |
| Start Winning / NBAEdge / injuries | P1 | **FIXED** |
| Team Spread / ML disabled | P2 | Backlog |
| Dev XRay layout preview links | P2 | Non-prod only |

## Preview Harness

`/admin/product-preview` still admin-gated, deterministic, labeled, extraction/checkout/live analysis not enabled.

## Analytics Privacy

Onboarding/product events remain category/generic ids. No player/line/odds/OCR/analysis payloads in `lib/product-analytics`.

## Security / Privacy Smoke

No `NEXT_PUBLIC_*` BDL/OpenAI keys. User-facing copy no longer names `OPENAI_API_KEY`. Admin preview still `require-admin`. Extraction kill switch unchanged. Not a pentest.

## P0 Issues

None open.

## P1 Issues

All found P1s fixed this step:

1. Landing/auth overclaim (winning CTA, injuries, NBAEdge, NBA Analytics title)
2. Landing demo game 404s
3. Public XRay looked available
4. Briefing empty states leaked env-var names

## P2 Backlog

1. Header subtitle “Betting Dashboard”
2. WOWY H1 “WOWY Impact”
3. Team trends Spread/ML disabled without explanation
4. Landing sample cards still visually resemble a live slate
5. 390px landing logo clip
6. Player page tabs ≠ game-page certified explorer (different surface)
7. Non-prod XRay `?preview=` layout links
8. Props “Current market” badge on frozen dates

## Launch Blocker Matrix

| ISSUE | SEVERITY | SURFACE | BLOCKS PRE-BDL? | BLOCKS SOFT LAUNCH? | PROVIDER-DEPENDENT? | FIXED? |
| --- | --- | --- | --- | --- | --- | --- |
| Stale landing/auth claims | P1 | Landing/auth | No after fix | Yes if unfixed | No | **YES** |
| Demo 404s | P1 | Landing | No after fix | Yes if unfixed | No | **YES** |
| Public XRay fake availability | P1 | XRay | No after fix | Yes if unfixed | No | **YES** |
| No BDL live tape | — | Data | No | Yes for live slate | **YES** | No — **PROVIDER BLOCKER** |
| Public extraction off | — | XRay | No | Intentional | **YES** (plus product flag) | Leave |
| Live analysis off | — | Workspace | No | Intentional | **YES** | Leave |
| Checkout disabled | — | Billing | No | Intentional | Stripe | Leave |
| Header “Betting Dashboard” | P2 | Chrome | No | No | No | Backlog |

## Leave-It-Alone List

Canonical wager identity, Props adapter, Add to Parlay, Workspace architecture, XRay Confirm, shared historical analyzer, Decision Close, Why This Could Fail, entitlements, onboarding architecture, preview isolation, model freeze — **preserved**.

## Tests / Regression

| Suite | PASSED | FAILED | EXCLUDED | WHY |
| --- | --- | --- | --- | --- |
| Combined E10 run (`onboarding` `parlay` `parlay-xray` `entitlements` `billing` `landing` `auth` `middleware`) | **494** | 0 tests | **16** | `postgres-persistence.test.ts` Docker/Postgres not running (suite throw in `beforeAll`) |
| `lib/landing` honesty | 2 | 0 | 0 | New |
| `lib/parlay-xray` page-contract | included | 0 | 0 | Honesty asserts added |

## Files Changed (this step)

- `app/layout.tsx`, `app/page.tsx`
- `components/landing/LandingHero.tsx`, `FeaturedGames.tsx`, `LandingPropsTablePreview.tsx`, `LandingTrendingPlayerStripPreview.tsx`
- `components/betting/GameCard.tsx`
- `components/auth/AuthSplitLayout.tsx`
- `app/parlay-xray/page.tsx`, `components/parlay-xray/ParlayXrayView.tsx`
- `app/billing/page.tsx`
- `app/betting/page.tsx`, `app/api/betting/ai-slate-insights/route.ts`
- `components/betting/PropsExplorerGameContextPanel.tsx`, `MatchupPageLayout.tsx`
- `lib/landing/__tests__/page-contract.test.ts`
- `lib/parlay-xray/__tests__/page-contract.test.ts`
- This report + `notes/learning-log/2026-09-16/e10-pre-bdl-product-qa.mdx`

## Schema Changes

**SCHEMA_MIGRATION: NONE**

## Provider Calls

REAL_BDL_CALLS_THIS_STEP: **0**  
REAL_OPENAI_CALLS_THIS_STEP: **0**  
(Extract API unit tests mock providers; browser resource log had no BDL/OpenAI hosts.)

## Remaining Provider Blockers

- BDL live ingest / canaries for a current slate
- Public screenshot extraction (product flag + provider)
- Current-season Workspace analysis
- Injury collection
- Checkout / Stripe live

## Recommended Next Step

**BDL_ACCESS_AND_CANARIES** — only after this honesty pass. Do not treat BDL as a way to paper over product copy.

## Verification Checklist

1. `/` title Court Context; CTA Explore Court Context; sample matchups do not 404.
2. `/login` does not mention injuries.
3. `/parlay-xray` (no preview) has no file picker; links to Props Explorer.
4. `/parlay-xray?preview=replay` still shows Upload → Review → Confirm → Workspace.
5. `/betting/props-explorer` today explains freeze empty; historical preview still labeled.
6. `/billing` is $10/month, checkout not newly enabled.
7. Existing signed-in user is not force-onboarded.

## Step Verdict

GREEN — Court Context has no known pre-BDL product blockers; remaining launch-critical work requires provider access
