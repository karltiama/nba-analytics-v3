# Court Context Post-Redesign UI/UX + Frontend Audit

**Step:** 14A.6 — Post-Redesign Product UI/UX + Frontend Code Audit  
**Date:** 2026-09-13  
**Mode:** Read-only. No product, token, or infrastructure changes.

## Executive Verdict

The redesign is real, coherent, and already working on the surfaces that define first impression: landing, auth, dashboard, game cards, Props Explorer, Market Movement, teams, billing, and profile.

It has **not** been carried through the two core research destinations users open after a game card: **Final / upcoming game detail** and **player research**. Those pages still render the pre-redesign neon/dark system under (or beside) the new Court Context chrome. That split is the main product-quality problem. It is a presentation-alignment problem, not an information-architecture rewrite.

**YELLOW — the redesign is strong but a small number of frontend issues should be resolved before feature expansion**

Do not start another visual redesign of landing, GameCard, Props Explorer, or Market Movement. Do not start WOWY. The highest-value next move is to put game detail and player research on the same visual system the rest of the product now uses, without changing certified research hierarchy.

## Audit Scope

Inspected the current App Router, shared chrome, design tokens, and live local app (`http://localhost:3000`) as source of truth. Historical reports were not treated as current UI.

Included: landing, authenticated shell, dashboard, GameCard, upcoming/Final game detail (code + one Final game), Props Explorer, Market Movement, player research, teams, billing, auth, Context Check studio, Paper/Saved/Profile routes, empty/error/loading handling, mobile 390px, accessibility, frontend architecture, CSS health.

Not included: backend/data logic changes, entitlement rule changes, infrastructure, WOWY design, implementation.

Offseason constraint: 2026-09-13 has no live slate. Dashboard, cards, Final Explorer, and Props Explorer were verified on `2026-04-04` (WAS @ MIA, SAS @ DEN, DET @ PHI). A live upcoming-game page could not be screenshot; upcoming structure is from `MatchupPageLayout` code.

## Current Route / Surface Inventory

User-facing App Router pages as of this audit:

| Surface | Route | Shell | Visual system today |
|---|---|---|---|
| Landing | `/` | Marketing header | New editorial |
| Sign in | `/login` | Auth split layout | New editorial |
| Sign up | `/signup` | Auth split layout | New editorial |
| Auth callback | `/auth/callback` | — | — |
| Dashboard / slate | `/betting` | BettingAppShell + Header | New editorial |
| Upcoming / Final game | `/betting/games/[gameId]` | Shell + Header, then MatchupPageLayout | **Old neon/dark content** |
| Props Explorer | `/betting/props-explorer` | Shell + Header | New editorial |
| Saved | `/betting/saved` | Shell + Header | New editorial |
| Paper | `/betting/paper` | Shell + Header | New editorial |
| Profile | `/betting/profile` | Shell + Header | New editorial |
| Player research (canonical) | `/betting/players/[playerId]` | Shell banner only; **own neon mini-header** | **Old neon/dark** |
| Bet-slip analyzer | `/betting/bet-slip-analyzer` | Shell + Header | Stub, leftover dark copy |
| Internal SQL research | `/betting/research` | Shell + Header | Leftover dark |
| Teams directory | `/teams` | BettingAppShell + Header | New editorial |
| Team research | `/teams/[teamId]` | Same | New editorial |
| Team schedule | `/teams/[teamId]/schedule` | Same | Mixed / older zinc in places |
| Billing | `/billing` | Shell + Header | New editorial |
| Billing success / cancel | `/billing/success`, `/billing/cancel` | Same | New editorial |
| Context Check studio | `/admin/content/context-check` | Isolated, `robots: noindex` | Intentional dark studio |
| Ops health | `/ops` | Isolated, noindex | Internal dark |
| Public game proof | `/games/[gameId]` | No product shell | Legacy zinc |
| Public BBRef player | `/players/[playerId]` | No product shell | Legacy zinc |
| Internal backtests | `/research/backtests`, `/research/points-proxy-strategies` | No product shell | Internal dark |

Loading / empty / error / not-found:

- No `app/not-found.tsx`, `error.tsx`, `global-error.tsx`, or route-level `loading.tsx`.
- Dashboard: GameCard skeletons, insights skeletons, empty-slate copy, `UnauthorizedPanel`.
- Game detail: `BettingGameDetailsPageSkeleton`; not-found is a leftover neon card.
- Props Explorer: table skeleton + `propsExplorerEmptyCopy`.
- Player not-found: leftover NBA Analytics neon header.

Context Check is **not** integrated into player / prop / game research. It exists only as an internal studio.

Paper and Profile are in **primary nav**, not only account menus.

## Current Design System

The live product look is **not** the Tailwind/CSS-variable theme. It is a hard-coded editorial palette repeated in class strings.

Observed redesigned tokens (from components, not `globals.css`):

| Role | Value used in redesigned UI |
|---|---|
| Page background | `#f7f9f7` (hero also `#F9FBFC`) |
| Primary text / ink | `#063f46` / `#063F46` / `#053F46` |
| Secondary text | `#4a6366`, `#72869A`, `#8aa0a3` |
| Brand mint | `#55ddb1` |
| Brand teal action | `#075B5C` |
| Surfaces | white cards, `#F8FBFA` wells |
| Borders | `#DCE9EA`, sometimes `#d7e2de` / `#e6ecee` |
| Radius | `rounded-2xl` cards, `rounded-xl` controls, `rounded-lg` buttons |
| Shadows | light `shadow-sm`; landing hero card `shadow-[0_18px_40px_rgba(6,63,70,0.08)]` |
| Positive / negative | `#20B95A`, red/amber Tailwind |
| Odds accent | `#168DD8` on GameCard totals |

Typography:

- Root fonts are Geist Sans + Geist Mono (`app/layout.tsx`). No Archivo Black / Manrope on product pages. Those faces appear only as Context Check Instagram type options.
- Display: landing/auth `font-extrabold tracking-tighter` Geist at 5xl–8xl.
- UI/body: 13–16px, `tracking-tight` headings.
- Numeric: `font-mono` + `tabular-nums` on research tables and Market Movement; GameCard percents use `tabular-nums` without mono.
- Labels: 10–11px uppercase tracking is common.

How it is implemented:

- Redesigned surfaces: local Tailwind hex classes. No shared `Button`, `Card`, or semantic product tokens.
- Unrestyled surfaces: `bg-background`, `glass-card`, `gradient-mesh`, `#00d4ff`, `text-white`.
- `html` is `class="dark"` from root layout. `BettingAppShell` also defaults `isDarkMode` to `true`, so CSS variables stay on the old neon dark theme even while cards are painted light with hex.

Consistency: **strong inside the new family, broken at the boundary with leftover neon pages.** Intentional editorial one-offs (landing watermark titles, Tatum hero) are fine.

## Brand Consistency

| Finding | Class |
|---|---|
| Wordmark **Court Context** + logo `/brand/court-context-logo.png` on marketing header, app Header, auth | A, working |
| Canonical tagline **More than the trend.** appears on Context Check cards (`footerTagline`), not on landing/auth | A, missing in public chrome |
| Auth panel uses **More than numbers.** | A, near-tagline drift |
| Document title / Open Graph: **NBA Analytics** (`app/layout.tsx`) | A, real user-facing |
| Landing footer: **NBAEdge** / **NBA Analytics Edge** | A, real user-facing |
| Player mini-header: neon **NBA Analytics** + Zap icon | A, real user-facing |
| Header subtitle **Betting Dashboard** on every shell page, including Props, Teams, Billing | A, naming |
| Internal AWS/ops copy, package name `nba-analytics-v3`, SQL comments | C, leave |
| Context Check studio isolation | B, intentional |

Do not do a blind string replace. Fix public chrome, metadata, footer, and the player mini-header. Leave internal identifiers.

## Typography

**KEEP** the new display/UI pairing on landing, auth, dashboard, and Props Explorer. Hierarchy is clear. Display type is used for marketing headlines, not for table UI.

Flag:

- Header steals the only `h1` on dashboard (`Court Context`). Page title is an `h2` (“Today's Games”).
- Many 10px / 11px metadata lines. Acceptable on desktop; tight on mobile.
- Player Trends tab: selected tab is effectively invisible (white/cyan treatment on a light page). That is contrast, not a font-family problem.
- Final game labels such as “This game — Box Score or Advanced. Not season role.” render as light muted text on the light shell background and are hard to read.
- No reduced-motion support for `slide-up`, `fade-in`, `pulse-dot`.

## Global Shell / Navigation

`BettingAppShell` + `Header` + `PRIMARY_NAV`.

Desktop nav: Dashboard, Teams, Props Explorer, Saved, Paper, Profile.

What works:

- Hierarchy is understandable.
- Core research (Dashboard, Props, Teams) is one click away.
- Mobile hamburger exists and is labeled.
- Account menu separates sign-in / profile / billing / sign-out.
- Sticky header + backdrop is solid.

Problems (polish, not a nav redesign):

- **Overloaded:** Paper and Profile do not need to sit in primary nav. Profile is already in the account menu. Paper is a secondary workflow.
- **No active state.** `NavLink` never compares `pathname`.
- **Theme toggle is a false control.** It toggles `html.dark` but redesigned pages ignore CSS variables. Sun icon shows because dark mode defaults on. On mobile it occupies scarce header space.
- **Subtitle always says “Betting Dashboard”**, even on Teams and Billing.
- **Player routes hide the product Header** (`shouldShowLayoutHeader` excludes `/betting/players/*`) and substitute the old NBA Analytics bar.
- Double `h1`: shell “Court Context” plus page `h1` on Props/Teams/Billing.
- Sticky collision on game detail: app header `sticky top-0 z-50` plus matchup bar `sticky top-0 z-10`. Section scroll uses a 160px offset because of this.

Do not add a bottom nav. The hamburger is enough.

## Landing Page

Within ~10 seconds a visitor can understand: basketball analytics product, deeper than raw numbers, player/prop/matchup research, Court Context by name.

**KEEP the layout and hero.** It already feels like a publication + product.

What works:

- Hero: “See the game in context.”
- Tatum imagery is editorial-forward.
- Sample GameCards reuse the real component.
- Props table and trending strip previews show the actual product language.
- Auth CTAs are obvious.

Polish / mismatches:

- Primary CTA **Start Winning Now** is sportsbook voice. It also launches `?onboard=1`.
- **View Full Terminal** is internal/dev language.
- Footer **NBAEdge**.
- Featured GameCards use `id: 'demo-1'|'demo-2'|'demo-3'`. **View matchup** goes to `/betting/games/demo-1` and renders **Game not found** (verified live).
- Landing trending STAT tabs look like filters (`aria-hidden` spans) and are not interactive.
- Featured Prop card looks live (Tatum 27.5 OVER) and is decorative.
- Tagline “More than the trend.” is absent.
- Mobile: watermark section titles can clip (`Today's Matchups` lost the “To” at 390px). Hero pillars become three cramped columns.

Do not wholesale rewrite the landing.

## Dashboard

Does it answer “What NBA games matter today, and where should I start researching?”

**On a slate date, yes.** On 2026-04-04 the page was immediately scannable: date, three Final cards, matchup, score, odds, two CTAs. Offseason today (2026-09-13) correctly shows “No games scheduled for today” plus a Recent form strip and insight widgets.

What works:

- Date nav + filters in one bar.
- Game prominence is the main column.
- Recent form strip is a good “start here” module.
- Empty-today copy is honest.
- Offseason banner is clear, if long.

Polish:

- No page-level heading such as “Games” independent of the Header h1.
- Insights heading still says **Betting Model Insights**.
- AI Insights rail is empty in freeze, which is honest, but it still occupies a full desktop column.
- Recent form is L5 vs season, not “tonight’s slate.” The strip already says that; keep it.
- Dead **Filters** icon button in `FilterBar` (no `onClick`).
- Theme toggle and “Betting Dashboard” subtitle undermine the otherwise calm page.

**KEEP** dashboard structure. Do not restyle it again.

## Game Cards

Live component: `components/betting/GameCard.tsx`.

On 2026-04-04 a user can understand WAS vs MIA in a few seconds: time, FINAL, score, city/nickname split, logos, FAV, spread/total/ML, implied bar, View matchup / View props.

**Classification: KEEP**

Polish only:

- Final cards still show pre-game implied % (WAS 1% / MIA 100% from +10000 ML). That reads like a live win probability.
- Extreme stored MLs (+10000 / -100000) are displayed as if they were a normal market.
- “NBA >” fallback when there is no status/close badge is a weak label.
- Cards get tall on mobile (stacked CTAs). Acceptable.

Do not redesign the card.

## Upcoming Game Detail

Certified live nav in code: AI Projection → Odds & sentiment → Matchup → Players → Injuries, plus View props.

Visual: the same leftover neon `glass-card` / cyan system as Final, because both modes share `MatchupPageLayout` (~1,550 lines).

Could not screenshot a live upcoming game (no scheduled slate). From code:

- Page will sit on the light shell with dark inner cards — same split as Final.
- AI briefing still mentions `OPENAI_API_KEY` to users when unavailable.
- Error/not-found is the old neon card with “Back to Betting.”

Feel: the **structure** is a research page; the **paint** is the old product. Do not change section sequence. Presentation-align only.

## Final / Historical Game Detail

Certified hierarchy in the page body:

Starting Five → Box / Advanced → Season Role → Timeline → Lines

Verified live on WAS @ MIA (`/betting/games/18447947`):

- Coverage line: “Completed game · Starting Five · Box · Advanced · Season Role · Timeline”
- Sticky subnav labels: Players, Context, Timeline, Lines, View props
- Starting Five copy correctly says historical designated starters, not projected
- Box/Advanced tabs exist; Advanced has a mobile list alternative (`lg:hidden`)
- Season Role is this-season, not this-game, and says so
- Lines copy: “Closing or stored sportsbook lines… Not certified Opening Snapshot Market Movement”

**Do not change that sequence.**

**Classification: POLISH (visual alignment), not REDESIGN**

Problems are presentation and sticky UX:

- Dark glass modules on the light Court Context shell
- Light-on-light helper text around Box/Advanced
- Sticky matchup bar fights the product header
- Subnav says “Context” for Season Role and “Players” for Box/Advanced — acceptable shorthand, not an IA bug
- “At a glance” rail is `hidden lg:flex` — OK
- Final pages **do** feel different from upcoming in content; they do **not** feel like the same visual product as the dashboard you just came from

## Props Explorer

`/betting/props-explorer` is restyled and feels like a **research board**, not a betting slip.

Verified on 2026-04-04:

- Honest historical badge: “Last pre-tip closing lines… Not a live sportsbook board.”
- Value column **UNAVAILABLE** on historical rows
- Paper **Add** is disabled for historical (`disabled` + title)
- Compare opens shopping + Market Movement in the new palette
- Player names, lines, books, odds are scannable

**Classification: KEEP**, with density polish.

Issues:

- Table is wide (Save / Compare / Paper plus many columns). Horizontal overflow is the intended research-table pattern, not an IA problem. On 390px it will require horizontal scroll.
- Book chips are DK/FD/BetMGM/Caesars/BetRivers/Fanatics; rows still include betparx / betway. Filters do not explain extra books.
- AI Projection sidebar on a historical date is a large empty well.
- Dual `h1` with Header.

Visual density, not information architecture.

## Market Movement

Semantics are intact: **3-Hour Pre-Tip → Close**. User-facing labels are `3-Hour` / `Close`. Internal `reference` stays in code/types. Free title is **Market Consensus**.

Live Pro panel on De'Aaron Fox assists:

- 3-Hour Pre-Tip 5.5 → +0.5 → Close 6
- “3-Hour 5.5 · Close 5.5–6.5 · 4 books”
- Median disclaimer
- Per-book Quiet / Line+Price with 3-Hour and Close quotes

**Classification: KEEP**

Polish: the arc sits below shopping in a sticky sidebar, so it is easy to miss until you scroll. Do not expose “Reference.” Do not redesign the module.

## Player Experience

Canonical product player page: `/betting/players/[playerId]`.

This is the weakest redesigned-product surface.

Verified on De'Aaron Fox:

- Offseason mint banner (new shell)
- Neon **NBA Analytics** mini-header with Zap + pulse + “PLAYER PROFILE”
- Dark identity card, cyan/purple tabs
- **Trends tab label missing** (white on light)
- Light trend chart mixed with dark stat tiles
- Prop sidebar still neon
- Duplicate “Betting Dashboard” back links

Content that already exists and should be kept:

- Identity, team link, season averages, minutes via game log
- Trends / Matchup / Game Log
- Return bar into Explorer / slate / game
- Prop line hit-rate tools

`/players/[playerId]` is a separate BBRef/zinc page. Not Court Context chrome.

**Classification: POLISH (bring onto current visual system). Not a research-IA redesign.**

Future WOWY fit (record only, do not implement):

1. Player Matchup tab, beside vs-opponent history and recent form
2. Final Season Role module (role-shift is the narrative hook)
3. Injury “with / without minutes” splits already on upcoming matchup — closest existing cousin
4. Context Check role-change cards (editorial, not the live research tool)

Do not put WOWY on the dashboard.

## Context Check

Status: **internal studio only**. `/admin/content/context-check`, `robots: noindex`, mock candidates, no publishing.

Canonical card model is already claim → missing context → interpretation → verdict (`view-model.ts`). Footer already uses Court Context + **More than the trend.**

Visually it is the old neon studio. **That isolation is correct.** Do not paint it with product chrome until it is a product surface.

Product integration: **DEFER**. It does not belong in the next slice. When it lands, player/prop/game research are the natural homes, not the dashboard rail.

## Auth / Billing / Upgrade

Auth split layout **KEEP**. Same Court Context personality as the landing hero. Forms are labeled. Google + password. Tagline drift (“More than numbers.”) is the only brand nit.

Billing **KEEP**. Founding Pro at $10/month, calm bullets, Manage billing, Stripe test-mode notice. Feels like the same product. “Back to betting” is slightly old language.

Upgrade CTAs (`FoundingProUpgradeLink`) route to `/billing` and use the new teal button. Entitlement copy for Market Movement and AI briefing is research-toned, not casino.

Onboarding modal is still neon glass (`OnboardingModal`). First-run from “Start Winning Now” will dump a new user from the new landing into the old modal. That is a real coherence miss.

## Mobile

Checked at ~390px (landing + dashboard). Code also has 375-class stacking (`flex-col sm:flex-row`) on cards and filters.

Landing 390:

- Hero stacks; Tatum featured card moves below copy — good
- Three pillar columns are cramped
- Section watermark titles clip
- Header Sign In / Get Started remain usable

Dashboard 390:

- Hamburger present; desktop links hidden — good
- Offseason banner consumes a lot of vertical space
- Filter chips wrap; Yesterday/Today/Tomorrow hide as designed
- GameCard remains readable; odds row is tight; CTAs will stack
- Theme toggle + account + menu is a lot of header chrome
- Trending strip horizontal scroll is legitimate

Expected issues (code, not fully screenshot at every width):

- Props Explorer and box tables: `overflow-x-auto`
- Game detail sticky header + matchup bar collision is worse on small screens
- Player page tabs already fail at desktop contrast; mobile will be worse

No bottom navigation.

## Loading / Empty / Error States

| State | Handling | Quality |
|---|---|---|
| Dashboard games loading | `GameCardSkeleton` in new palette | Good |
| No games | Honest empty card | Good |
| Insights loading | New-palette skeletons | Good |
| Auth 401 | `UnauthorizedPanel` | Good |
| Fetch error | Inline red card + Retry | Adequate |
| Props empty | `propsExplorerEmptyCopy` distinguishes freeze vs historical | Good |
| Props loading | Table skeleton | Good |
| Game not found | Neon glass “Game not found” | Poor, leftover |
| Player not found | Neon NBA Analytics header | Poor |
| Team not found | New-palette message | Fine |
| Route 404 | No `not-found.tsx` | Missing |
| Runtime error | No `error.tsx` | Missing |
| Offseason AI | Honest freeze copy | Good, except OPENAI_API_KEY leak on upcoming |

No shared `EmptyState` / `ErrorState`. Skeletons exist but `components/ui/skeleton.tsx` defaults to `bg-white/5` (dark leftover); redesigned callers override.

## Accessibility

P0

- Player Trends selected tab not perceivable (contrast).
- Final helper text / some matchup labels: light muted on light page.

P1

- Header `h1` steals page title; dashboard has no unique `h1`.
- Theme toggle and Filters button are icon-only; Filters is also non-functional.
- Logo `alt=""` is OK next to visible “Court Context”; player mini-header is a link named “NBA Analytics Player Analysis”.
- No `prefers-reduced-motion`.
- Document title never says Court Context.
- Color-only importance dots in AI insights (`getImportanceDot`).

P2

- Many 10px captions.
- Header nav has no `aria-current`.
- Form selects in Props Explorer have aria-labels (good).
- Tables generally use real `<table>` markup (good).
- Focus rings exist on some header menus (`focus-visible:ring-[#55ddb1]/40`), not globally.

Did not manufacture extra issues. Keyboard paths were not exhaustively walked beyond snapshots.

## Frontend Component Architecture

Debt that actually affects velocity/consistency:

- **Two visual systems in one app.** New hex palette vs `glass-card` / neon. Every new feature will pick the wrong one unless game/player are aligned.
- **`MatchupPageLayout.tsx` is a giant coupled page** (~1,550 lines): upcoming + Final, AI, odds, injuries, historical modules, analytics events.
- **Hard-coded hex repeated** across Header, GameCard, FilterBar, Props, billing, teams (`#063f46` family appears in dozens of files). Fine for now; tokenize after alignment, not before.
- **Duplicate player stacks:** `app/betting/players/*` vs `app/players/*` (BBRef). Canonical product path is betting.
- Dead / leftover UI: `PlayerCard.tsx` (neon, unused by dashboard strip), `UpcomingGames.tsx` (glass, unused by team page), `DateNav` component chrome (helpers still used), bet-slip analyzer stub, `/betting/research`.
- No shared page shell primitive; each page repeats `max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8`.
- `BettingAppShell` is a client island wrapping all `/betting`, `/teams`, `/billing` — necessary for header/onboarding, expensive as a default.

Do not refactor for cleanliness. Align the two remaining neon product pages first.

## CSS / Design Token Health

| Finding | Category |
|---|---|
| New palette as hex in components | SAFE TO LEAVE until game/player aligned, then CLEANUP |
| `globals.css` neon CSS variables + `.dark` still driving `html.dark` | CAUSING CURRENT UI INCONSISTENCY (theme toggle / leftover pages) |
| `glass-card`, `gradient-mesh`, `neon-text-*` | CAUSING CURRENT UI INCONSISTENCY on game/player/onboarding |
| Duplicate ink hex (`#063f46` vs `#063F46` vs `#053F46`) | CLEANUP |
| `components/ui/*` shadcn tokens still map to neon dark | SAFE TO LEAVE for unused primitives; CAUSING issues where Tabs are used on player page |
| No `!important` found | — |
| Inline `style={{}}` mostly charts, animation delay, team colors | SAFE TO LEAVE |
| Light `:root` tokens unused because `html` is always dark | CLEANUP later |

Do not do a theme rewrite as the next step. The new look is already coherent where it was applied.

## Responsive Code Health

Legitimate:

- GameCard stacked CTAs, city/nickname split
- FilterBar wrapping
- Historical Advanced desktop table + mobile list
- Trending strip `overflow-x-auto` + snap
- Auth brand panel `hidden lg:flex`

Fragile / leftover:

- Matchup sticky `top-0` vs header `h-16`
- Landing watermark type that clips at 390
- Props table min-width implied by column count
- Player page has no mobile-specific tab restyle; it just breaks
- `hidden lg:flex` glance rail is fine

## Frontend Performance

Credible, not speculative:

- Entire betting/teams/billing trees are client (`layout.tsx` `'use client'` + `BettingAppShell`).
- `MatchupPageLayout` is a large client module with IntersectionObserver, AI POST, charts.
- Dashboard is a client page fetching games/insights/slate AI.
- Images: raw `<img>` for logo, Tatum, NBA CDN headshots. `next.config.ts` has **no** `images` remote config, so Next Image is unused on purpose for CDN heads.
- `slide-up` per GameCard with staggered delay — minor.
- No heavy chart library; sparklines/charts are custom SVG.

Do not micro-optimize. Client-shell weight matters only after visual alignment.

## Image / Asset Handling

- Brand mark: local PNG, used consistently on new chrome.
- Team logos: local SVGs via `TeamLogo` with fallback initials. Editorial enough.
- Player headshots: `cdn.nba.com/headshots/...` on trending strip and landing preview; `onError` not always handled on landing imgs; Context Check has fallback initials.
- Hero: local `/landing/hero-tatum.png`, `/landing/hero-court-right.png`. Strong.
- Player research header: initials fallback, optional `headshotUrl` (often empty → “DF”).
- Broken landing GameCard navigation is a link problem, not an image problem.

Do not add image providers.

## Product Copy

Meaningful issues only:

- **Start Winning Now**
- **View Full Terminal**
- **Betting Dashboard** (global subtitle)
- **Betting Model Insights**
- **NBAEdge** / **NBA Analytics** in title, footer, player header
- **Back to Betting**
- Paper page exposes `PAPER_SETTLE_CRON_SECRET` / `CRON_SECRET` and “No auth in v1”
- Upcoming AI empty: “Add OPENAI_API_KEY on the server…”
- Onboarding: “Set up your workspace” (tool language)
- Market Movement and historical Explorer disclaimers are **good** — keep them

## Free / Pro Presentation

Presentation is calm where restyled.

- Billing page is not paywall-spammy.
- Market Movement Free vs Pro is structured (consensus vs 3-Hour arc) without casino chrome.
- AI briefing upgrade uses `UPGRADE_COPY`.
- WOWY / alerts / advanced_history upgrade strings exist in `lib/entitlements/types.ts` as **when that surface ships**. They must not be shown as live product features. No public teaser of WOWY was found on dashboard/landing.

Do not change entitlement rules.

## Functional UX Findings

| Item | Issue |
|---|---|
| Landing GameCard CTAs | Look live; `demo-*` IDs 404 |
| FilterBar Filters icon | Looks like a control; no handler |
| Theme toggle | Looks like it restyles the product; it does not |
| Landing STAT tabs | Look like filters; they are not |
| Header nav | No current-page indication |
| Paper Add on historical | Disabled correctly; low-opacity still looks almost active |
| Bet-slip analyzer | Route exists; feature is a parked stub |
| Player Trends tab | Selected state not visible, so Matchup/Game Log look like the only tabs |

These matter more than aesthetic nits.

## Code / UI Mismatches

High priority:

1. **Landing sample games are wired like real games** (`FeaturedGames` → `GameCard` → `/betting/games/demo-1`) → Game not found.
2. **Theme toggle implies a second theme** that redesigned UI does not implement.
3. **Player / game pages look like a different product** than the dashboard that linked to them.
4. **Featured Prop / landing rows look live** while labeled as samples only in small type.
5. **Final GameCard implied %** reads as current probability.
6. **Onboarding modal** is the old product.
7. **`FutureOddsPlaceholderCard`**: “Odds integration coming soon” on a player page that already has a prop-line sidebar.
8. **Paper cron-secret copy** on a user-facing page.
9. **html.dark + light hex** means `body` computed background is still `rgb(10, 10, 15)` even when the shell paints mint.

## Product Maturity Grades

| Area | Grade | Why |
|---|---|---|
| Brand consistency | C | Court Context on new chrome; NBA Analytics/NBAEdge still in title, footer, player header |
| Visual system | B | New family is coherent; two systems coexist |
| Landing experience | B | Strong story; CTA/footer/demo-link polish |
| Dashboard | B+ | Clear slate + research start; empty/offseason handled |
| Game discovery | A- | GameCard is the redesign’s best product object |
| Game detail | C | Certified research is there; looks like the old app |
| Historical Explorer | B | Hierarchy and copy are right; paint is wrong |
| Props Explorer | A- | Research tool, honest historical mode |
| Market Movement | A- | Arc is understandable; KEEP |
| Player experience | C- | Research depth exists; branding/contrast fail |
| Mobile | B- | Shell and cards work; tables/headers/clipping remain |
| Accessibility | C | Contrast and h1 ownership issues on core pages |
| Empty/error states | C+ | Dashboard/props good; global 404/error and game/player errors leftover |
| Frontend architecture | C | Giant matchup page + dual theme + hex sprawl |
| Production polish | C+ | First-run and research click-through still break the spell |

## KEEP / POLISH / REDESIGN / DEFER Matrix

| Surface | Verdict |
|---|---|
| Landing hero / layout | KEEP |
| Landing copy, footer, demo links | POLISH |
| Auth | KEEP |
| App Header / shell | POLISH (nav weight, subtitle, theme toggle, active states) |
| Dashboard structure | KEEP |
| GameCard | KEEP |
| Upcoming game IA | KEEP |
| Upcoming game presentation | POLISH |
| Final / Historical Explorer IA | KEEP |
| Final presentation | POLISH |
| Props Explorer | KEEP |
| Market Movement | KEEP |
| Player research IA | KEEP |
| Player presentation + chrome | POLISH |
| Teams directory / team page | KEEP |
| Billing / Founding Pro | KEEP |
| Saved / Profile | KEEP |
| Paper (nav + cron copy) | POLISH |
| Onboarding modal | POLISH |
| Context Check studio | KEEP isolated / DEFER product integration |
| WOWY | DEFER |
| Public `/games`, `/players` | DEFER (legacy proof paths) |
| Bet-slip analyzer | DEFER |
| Token/theme rewrite | DEFER until game+player aligned |
| Bottom navigation | DEFER (not justified) |
| Global EmptyState system | DEFER (only after 404/error pages if needed) |

REDESIGN is unused on purpose. Nothing here has a broken structure that requires a new layout.

## P0–P3 Findings

**P0 — launch/usage blocker**

- None for logged-in slate browsing on restyled pages. Player Trends tab contrast is the closest P0 on a core research page.

**P1 — before a major public push**

1. Align **game detail** (upcoming + Final) to the current Court Context visual system without changing certified section order.
2. Align **player research** to the same system; restore the shared Header; kill NBA Analytics mini-header.
3. Stop landing **View matchup** from hitting `demo-*` 404s (unlink, or point sample CTAs at `/betting` / `/signup`).
4. Remove or disable the **theme toggle** until a real second theme exists.
5. Replace **Start Winning Now** / **View Full Terminal** / footer **NBAEdge** / metadata **NBA Analytics**.
6. Restyle or replace **OnboardingModal** so first-run matches landing.
7. Fix Filters dead control; don’t ship icon buttons that do nothing.

**P2 — worthwhile polish**

- Header subtitle and primary-nav weight (Paper/Profile).
- Nav active states; page `h1` ownership.
- GameCard Final implied-% labeling.
- Props table mobile scroll affordance; book-chip vs extra books.
- Market Movement visibility in the compare sidebar.
- Landing watermark clipping; decorative STAT tabs.
- Game/player not-found into the new palette.
- Paper cron-secret copy.
- `html.dark` default vs light shell.

**P3 — defer**

- Token extraction of hex → CSS variables.
- Shared EmptyState primitive.
- Context Check product integration.
- WOWY.
- Deleting leftover `/games` and `/players` proof routes.
- Bet-slip analyzer revival.
- Reducing client-shell hydration.

## LEAVE IT ALONE

Leave these alone unless a P1 slice must touch them:

- Landing hero composition, Tatum treatment, Court Context wordmark
- GameCard structure and CTA pair (View matchup / View props)
- Dashboard date bar + game grid + Recent form strip
- Props Explorer as a research table (historical closing-line honesty included)
- Market Movement semantics and 3-Hour → Close presentation
- Historical Explorer module order and certified copy (Starting Five, Box/Advanced, Season Role, Timeline, Lines)
- Teams directory and team snapshot page
- Auth split layout
- Billing / Founding Pro page tone
- Context Check studio remaining visually isolated
- Entitlement rules, MM reference-point logic, ingestion, backend

The redesign is not an invitation to restyle these again.

## Recommended Development Slices

1. **Game + player presentation alignment** — LARGE  
   Why now: the click from a good GameCard into research currently leaves Court Context.  
   Scope: paint `MatchupPageLayout` + historical modules + player page/header/tabs onto existing hex/shell; keep certified IA.  
   Impact: research feels like the product users just trusted.  
   Dependencies: none.  
   Not included: WOWY, Context Check, token rewrite, IA changes, data work.

2. **First-run / public chrome honesty** — SMALL  
   Why now: landing is the strongest page and then lies (NBAEdge, Start Winning, demo 404, neon onboarding).  
   Scope: CTA/footer/title, demo GameCard links, onboarding modal paint, theme toggle removal.  
   Impact: first 30 seconds match the product.  
   Not included: landing layout rewrite.

3. **Shell / nav polish** — SMALL  
   Why now: Header is the one chrome every restyled page shares.  
   Scope: subtitle, active states, Paper/Profile demotion, player routes use shared Header, Filters button.  
   Not included: new IA, bottom nav.

4. **Empty/error hardening** — SMALL  
   Why now: game/player not-found still look like 2024 neon.  
   Scope: those two states + optional `not-found.tsx` in the new palette.  
   Not included: a design-system EmptyState rewrite.

5. **Context Check integration or WOWY foundation** — LARGE, later  
   Why not now: both need the research surfaces to already look like Court Context. Integrating either onto neon pages would paint twice.

Rank: 1 → 2 → 3 → 4 → 5.

## Recommended Next Step

**STEP 14A.7 — Align game detail and player research to the current Court Context visual system.**

Narrow prompt for the next session:

- Paint only `/betting/games/[gameId]` (`MatchupPageLayout` + historical modules + not-found/skeleton) and `/betting/players/[playerId]` (shared Header, drop NBA Analytics mini-header, tabs/cards/sidebar) onto the existing editorial palette used by Header / GameCard / Props Explorer.
- Do **not** change Historical Explorer order, Market Movement semantics, entitlement rules, landing layout, GameCard structure, or Context Check.
- Do **not** introduce new CSS frameworks or a theme rewrite. Reuse the current hex language.
- Verify WAS @ MIA Final, a player opened from that box, and mobile 390px click-through from dashboard → matchup → player.

That is the highest-value controlled step. It is presentation alignment, not a redesign.

## Tests / Build

- `npm test` (vitest): **193 files, 1,461 tests passed** (14.42s). Not treated as UI proof.
- `npx tsc --noEmit`: **fails** with existing errors in tests/ops/postgame/entitlements/injuries/teams (e.g. `ProcessEnv` `NODE_ENV`, `lib/postgame/worker.ts`, `lib/ops/aws-ingestion-status.ts`). These are **pre-existing** and not UI-audit findings. Do not “fix tsc” as part of a visual slice unless a touched file is in the list.
- `next build` was not run; tsc already fails.
- Dev overlay sometimes showed “1 issue” / “3 issues” in screenshots; not diagnosed as product bugs (Next.js runtime overlay).

## Files Inspected

Primary:

- `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `app/login/*`, `app/signup/*`, `app/betting/layout.tsx`, `app/betting/page.tsx`, `app/betting/games/[gameId]/*`, `app/betting/props-explorer/page.tsx`, `app/betting/players/[playerId]/*`, `app/betting/paper/page.tsx`, `app/betting/saved/page.tsx`, `app/billing/*`, `app/teams/**`, `app/admin/content/context-check/page.tsx`, `app/ops/page.tsx`, `app/games/[gameId]/page.tsx`, `app/players/[playerId]/page.tsx`, `proxy.ts`
- `components/betting/Header.tsx`, `BettingAppShell.tsx`, `primary-nav.ts`, `betting-shell-paths.ts`, `GameCard.tsx`, `FilterBar.tsx`, `MatchupPageLayout.tsx`, historical Final modules, `market-movement/MarketMovementSection.tsx`, `OnboardingModal.tsx`, `FoundingProUpgradeLink.tsx`, landing/*, `auth/AuthSplitLayout.tsx`, Context Check studio/card, `nba/TeamLogo.tsx`
- `lib/betting/market-movement-present.ts`, `historical-final.ts`, `props-explorer-empty.ts`, `lib/entitlements/types.ts`, `lib/content/context-check/view-model.ts`
- Live: `/`, `/betting`, `/betting?date=2026-04-04`, `/betting/games/18447947`, `/betting/props-explorer?date=2026-04-04` (Compare / MM), `/betting/players/161`, `/login`, `/billing`, `/teams`, `/teams/mia`, `/admin/content/context-check`, `/betting/games/demo-1`, 390px landing + dashboard

## Audit Limitations

- No live upcoming game on the calendar; upcoming presentation inferred from the shared layout.
- Keyboard-only and screen-reader passes were snapshot-based, not a full WCAG audit.
- Contrast was judged visually, not with a meter.
- Did not run `next build`.
- Did not inspect production CDN; local `next dev` only.
- Next.js issues overlay was not treated as product evidence.

## Final Verdict

YELLOW — the redesign is strong but a small number of frontend issues should be resolved before feature expansion
