# 2026–27 Court Context product surface UI audit (Step 14A.1)

**Date:** 2026-09-11  
**Step:** 14A.1 — audit + visual system + implementation sequence  
**Step verdict:** `GREEN — Court Context has a coherent production UI direction and implementation plan`

No page rewrites. No theme apply. No ingestion, Terraform, schema, or backend changes. Status-sync remains `OPERATIONALLY_SIGNED_OFF`.

---

## Product Design Goal

Shift Court Context from a technically impressive analytics application toward a **polished, coherent sports intelligence product**.

The product should feel like:

**sports publication + analytics product**

not:

**admin dashboard + betting app**

Desired feel: premium sports editorial; analytical without looking like a finance terminal; personable; modern; confident; spacious; readable; useful on mobile.

Avoid: generic SaaS dashboards; cards inside cards; neon sports-betting / casino; giant gradients; arbitrary glassmorphism; every statistic competing; obvious AI-generated component styling.

**Locked product language (already in repo, currently unused on public chrome):**

- Name: **Court Context**
- Tagline: **More than the trend.**
- Positioning: *Don't just follow the trend. Understand the context behind it.*

Public chrome today still says **NBAEdge** / **NBA Analytics**. That split is the primary brand defect. 14A.2 should unify on Court Context. This is not an open naming decision.

---

## Current Surface Inventory

Auth gate: `proxy.ts` → `lib/supabase/middleware.ts`. Session-required HTML: `/betting*`, `/ops*`, `/billing*`. `/teams*` uses the betting shell but is public.

| Surface | Route | Auth | Classification |
|---|---|---|---|
| Landing | `/` | Public | **REDESIGN** |
| Login / Signup | `/login`, `/signup` | Public | **POLISH** |
| Slate dashboard | `/betting` | Session | **POLISH** |
| Game card | `GameCard` on dashboard + landing | — | **REDESIGN** (component internals; keep the component) |
| Game detail (upcoming/live) | `/betting/games/[gameId]` | Session | **POLISH** |
| Game detail (Final / HE v2) | `/betting/games/[gameId]` | Session | **KEEP** |
| Public box score | `/games/[gameId]` | Public | **DEFER** |
| Props Explorer | `/betting/props-explorer` | Session | **POLISH** |
| Market Movement | inside Props Explorer market panel | Session | **KEEP** (light polish) |
| Player research | `/betting/players/[playerId]` | Session | **POLISH** |
| Legacy player | `/players/[playerId]` | Public | **DEFER** |
| Teams directory / profile / schedule | `/teams`, `/teams/[id]`, `.../schedule` | Public + shell | **POLISH** |
| Saved | `/betting/saved` | Session | **POLISH** |
| Paper | `/betting/paper` | Session | **DEFER** (useful, not launch-critical chrome) |
| Profile | `/betting/profile` | Session | **POLISH** |
| Billing | `/billing`, success, cancel | Session | **POLISH** |
| Onboarding modal | `?onboard=1` | Session | **POLISH** (copy) |
| Context Check Studio | `/admin/content/context-check` | No middleware gate; `noindex` | **KEEP** studio / **DEFER** public |
| Ops | `/ops` | Session | **DEFER** |
| Research labs | `/research/backtests`, `/research/points-proxy-strategies` | Public | **DEFER** |
| Bet-slip analyzer | `/betting/bet-slip-analyzer` | Session | **DEFER** (stub / moved) |

**Preserve (do not break IA):** Historical Explorer v2 Final hierarchy, Market Movement v1 presentation, existing game routes, Props Explorer research journey, date-driven navigation, analytics events.

---

## Brand / Visual Direction

### What exists

| Layer | Today |
|---|---|
| Product chrome | NBA Analytics + Zap icon, cyan→purple gradient, lime pulse dot (`Header.tsx`) |
| Landing | NBAEdge + Activity icon, gradient-mesh, neon glow, “Dominate the Books…” |
| Context Check cards | **Court Context** / Context Check / **More than the trend.** |
| Instagram cards | Dark green `#041512`, mint `#7EF0D0`, gold `#F3C57A`, Archivo Black + Manrope |
| Logo assets | **None** in `public/` (starter SVGs only). No favicon. Team “logos” are abbreviation tiles. |
| Theme | Tailwind v4 CSS-first in `app/globals.css`. Forced `html.dark`. Light tokens unused in practice. |

### Direction (locked for 14A.2+)

Court Context is a **dark, warm, editorial** product. Ink and paper, not neon terminal.

- One brand name everywhere: **Court Context**
- Wordmark, not a Zap/Activity glyph-as-logo. Until a mark exists, typeset the name; do not invent a gradient square.
- Accent from the Context Check Instagram palette (mint + warm gold), **desaturated** for UI. Drop magenta, neon lime, cyan glow, `gradient-mesh`, `neon-text-*` shadows, and `glass-card` blur as default chrome.
- `glass-card` / `neon-glow-*` remain in CSS until 14A.2 replaces them; new work must not add more neon utilities.
- Photography (player stills) where Context Check already does; stats never compete with identity.

---

## Typography

**Do not load five typefaces in production.** Context Check currently loads Archivo Black, Manrope, League Spartan, Inter, and Barlow Condensed for Instagram experiments (`instagram-fonts.ts`). Product document fonts are Geist + Geist Mono. That is **seven** families.

Lock the default Instagram pair as the product system (already the default variant, even though `instagram-type.ts` says none is “locked” yet):

| Role | Family | Use |
|---|---|---|
| **Display** | **Archivo Black** | Page titles and rare editorial headings only (landing H1, game matchup title, Context Check claim). Not nav, not table headers, not buttons. |
| **UI / body** | **Manrope** | Navigation, controls, prose, labels, most numbers. |
| **Numeric** | Manrope `tabular-nums` + slightly tighter tracking | Scores, lines, deltas, stat values. **No third family.** Geist Mono is retired from product chrome. Charts may inherit UI font. |

Studio may keep alternate Instagram variants internally. Public product loads **two** Google families.

Hierarchy (proposed):

| Step | Size | Weight | Family |
|---|---|---|---|
| Display H1 | 36–48 desktop / 28–32 mobile | 400 (Archivo Black is already black) | Display |
| Page H1 | 24–28 | 700 | UI |
| Section H2 | 16–18 | 600 | UI |
| Body | 14–16 | 500 | UI |
| Meta / labels | 12 | 600, uppercase tracking only for true kicker labels | UI |
| Dense table | 12–13 | 500, `tabular-nums` | UI |

Do not use 9–10px as a default. Current GameCard `text-[9px]` / `text-[10px]` is a readability defect.

---

## Color System

Extend `app/globals.css` `@theme` tokens. **Do not hardcode hex in pages.** Map existing `--neon-*` away over 14A.2; do not keep magenta/lime as semantic product color.

### Semantic tokens (proposed)

| Token | Role | Proposed dark value | Notes |
|---|---|---|---|
| `--background` | Page | `#0B100F` | Warm ink, not blue-black `#0a0a0f` |
| `--surface` / `--card` | Elevated | `#141C1A` | Solid, not frosted glass |
| `--foreground` | Primary text | `#F3F1EA` | Paper |
| `--text-secondary` | Secondary | `#B7B3A8` | Records, times |
| `--muted-foreground` | Muted | `#8A877C` | Must remain ≥4.5:1 on background for 12px+ |
| `--border` | Border | `rgba(243,241,234,0.10)` | Hairline |
| `--brand` | Brand accent | `#5EE0C4` | Desaturated cousin of IG `#7EF0D0` |
| `--positive` | Up / cover / over (when meaning is gain) | `#8BCF8A` | Not neon lime `#39ff14` |
| `--negative` | Down / miss | `#E06B6B` | Replace `#ff4757` neon |
| `--warning` | Caution / mixed | `#E0B25A` | From IG `#F3C57A` |
| `--info` | Informational | `#7AA8C4` | Quiet slate-blue; not cyan glow |
| `--market-up` | Line/price moved toward Over / plus | `--positive` | Market Movement emphasis |
| `--market-down` | Toward Under / minus | `--negative` | |
| `--market-quiet` | Quiet class | `--muted-foreground` | |

**Primary button:** brand on ink (`bg-brand text-background`), not cyan-on-black glow.

**Do not** use color alone for FAV / CLOSE / In Progress. Pair with label.

Light mode: **P3**. Product is dark-first. Header theme toggle exists but root layout forces `.dark`; do not invest in light until tokens are stable.

---

## Layout System

| Rule | Today | Proposed |
|---|---|---|
| Product max width | `max-w-[1800px]` (terminal-wide) | **1200px** for editorial pages; **1280px** dashboard; **1440px** only for Props Explorer table |
| Desktop gutter | `px-4 sm:px-6 lg:px-8` | Keep 24–32px desktop |
| Mobile gutter | 16px | **16px**; never 8px content against edge |
| Section rhythm | `space-y-6` + stacked cards | **32–48px** between major sections; 16–24px inside |
| Card density | High; nested chips | One elevation; no card-in-card |
| Table density | Sticky thead, many columns | Horizontal scroll OK; hide advanced columns by default (already partly true) |
| Sticky nav | Header `sticky top-0 z-50` + glass | Solid surface, 64px, no blur. Matchup section pills stay sticky under header. |
| Dashboard aside | XL `w-80` AI panel | Keep, but secondary. Games are primary. |

Breathing room is a launch requirement. The 1800px grid is the main “finance terminal” tell.

---

## Component System

There is **no** shared Button/Card/Badge/EmptyState. shadcn is only `tabs`, `table`, `skeleton`. Do **not** duplicate components for new styling. Extend existing files.

| Proposed primitive | Existing equivalent | Action |
|---|---|---|
| `PageHeader` | Ad hoc H1s; Header wordmark | New thin primitive in 14A.2, or standardize classes |
| `SectionHeader` | `LandingSectionHeader`; matchup `<h2>`s | Extend `LandingSectionHeader` or matchup pattern — one |
| `Metric` / `MetricGroup` | `PlayerHeader` `QuickStat`; Historical `MetricAbbr` | Unify on one `Metric` |
| `GameCard` | `components/betting/GameCard.tsx` | Restyle in place (14A.3) |
| `PlayerRow` | Props table rows; `TrendingPlayerStrip` cards | Do not create a second row type |
| `ContextPanel` | Context Check card sections; player matchup cards | Slot for 14B / future WOWY — do not fake data |
| `VerdictBadge` | Context Check `VERDICT_*` maps | Reuse for 14B; not on dashboard yet |
| `MarketMovementIndicator` | `MarketMovementSection` + `SnapshotColumn` | Keep; visual polish only |
| `DataAvailabilityBadge` | `formatHistoricalCoverageLine` | Keep present-only labels |
| `EmptyState` | **Missing** — inline copy | Add one primitive in 14A.2 |
| `UpgradeTeaser` | `FoundingProUpgradeLink` + `UPGRADE_COPY` | Keep API; restyle CTA |

Buttons, tabs, cards, tables: restyle via tokens + existing files (`components/ui/tabs.tsx`, `table.tsx`, GameCard, FoundingProUpgradeLink). No parallel design-system package.

---

## Dashboard Audit

**Route:** `/betting` (`app/betting/page.tsx`)  
**Classification:** **POLISH**

Actual stack: FilterBar (date/search/sort/favorites/close) → TrendingPlayerStrip (“Recent form”) → games grid → BettingInsights widgets → aside AIInsightPanel.

Strengths: date-driven slate is the right product home; GameCard → matchup / props journey is clear; skeletons exist.

Gaps:

- No page `h1`. Nav says “Dashboard”; the page starts at filters.
- **Recent form** and **AI Insights** compete with **Today's Games**.
- Final cards still show full odds + pace + weakness + implied bar.
- Empty copy is thin: “No games scheduled for today”.
- Offseason banner in `BettingAppShell` still talks like infrastructure (“scheduler-driven updates are paused”) after status-sync is live. Product copy should not describe AWS. Historical 2025 pin is still the public season — say that in human language.
- `max-w-[1800px]` + 3-column cards = dense terminal.

Target hierarchy: **Games first**, one contextual strip, AI briefing as supporting.

---

## Game Card Audit

**File:** `components/betting/GameCard.tsx`  
**Classification:** **REDESIGN** (visual hierarchy; keep routes and dual CTAs)

A card should answer: *What game is this? What state is it in? Why should I open it?*

Today it answers those **and** spread, total, ML, pace, defensive weakness, implied win %, FAV, CLOSE, dual research CTAs.

| Element | Keep? |
|---|---|
| Away @ Home identity | **Yes** — promote to hero |
| Status + time or Final score | **Yes** — second line |
| One primary CTA (matchup) | **Yes** |
| View props | **Yes**, secondary |
| Consensus spread/total **or** one context chip | **One**, not both plus extras |
| Full 3-col odds grid | Upcoming: collapse or one row. Final: hide. |
| Pace + weakness chips | Off the card; belong on game page |
| Implied-prob bar | Off the card |
| `CLOSE` badge | **Rename.** Collides with Market Movement **Close**. Use “Tight” / “Pick’em” if kept. |
| Abbr tiles as logos | OK until real marks exist; stop calling them logos in UI |
| Lime left border | Drop; use status color sparingly |

Upcoming card: matchup, tip, status, **one** market or context reason, open.  
Final card: matchup, **score**, Final, open (props optional).

---

## Game Page Audit

**Canonical:** `/betting/games/[gameId]` → `MatchupPageLayout.tsx`  
**Legacy:** `/games/[gameId]` zinc box — **DEFER**

### Upcoming / live — **POLISH**

Current sticky pills: AI Projection → Odds & sentiment → Matchup → Players → Injuries.

Desired conceptual structure:

1. Game identity  
2. Primary context  
3. Betting / market  
4. Player context  
5. Research details  

Today AI Projection leads. That is briefing-first, not context-first. 14A.4 should restack **without** deleting certified modules: identity/status sticky remains; Matchup (starters + team) moves up; Odds next; players; injuries; AI briefing as supporting, not the first pill.

Do not invent analysis. Reorder and restyle.

### Final — **KEEP**

Certified Historical Explorer v2 (`historicalFinalNavIds` / signoff):

1. Official result (sticky scores + season)  
2. Starting Five (overview, not a pill)  
3. Players — Box, then Advanced (“this game, not season role”)  
4. Context — Season Role  
5. Timeline — chronology / PBP  
6. Lines — first stored → stored close  

Do **not** redesign this IA. 14A.4 is type, spacing, tokens, and sticky-pill contrast only. Market Movement on Finals stays deferred (Props Explorer remains canonical).

---

## Props / Market Movement Audit

**Props Explorer:** **POLISH**  
**Market Movement:** **KEEP** (+ light polish)

Certified arc is already product language:

```text
3-Hour Pre-Tip
   ↓
Movement (Δ)
   ↓
Close
```

UI labels (`MM_PRO_SUBTITLE`, `SnapshotColumn`, row `3-Hour` / `Close`) already communicate Reference → Movement → Close **without** internal words (`3_hour_pre_tip`, `decision_close`, `reference`, `comparison`). **Do not rename toward “Reference.”**

Free users see **Market Consensus** (Close only) + upgrade. That is the right tease.

Polish only:

- Surface `3-Hour Pre-Tip → Close` once as a visible subtitle (computed `presented.subtitle` is unused).
- Rename GameCard `CLOSE` so “Close” means market close.
- Props aside currently leads with **AI Projection** above Market Movement. Movement is the differentiator — it should sit at the top of the market panel (panel already has MM at the bottom; 14A.5 should promote it visually, not change serving).
- Filter stack + default table remain tool-dense; keep advanced metrics collapsed.

Empty copy in `propsExplorerEmptyCopy()` is already better than “No data.” Reuse that tone elsewhere.

---

## Context Check Placement

**Studio:** `/admin/content/context-check` — **KEEP** as internal; **do not redesign admin in 14A.**

Canonical model (already implemented on the card):

`claim → missing context → interpretation → verdict`

(The Claim → Zoom Out / Line or Role → Context Verdict.)

**Public product placement (not implemented):**

| Option | Fit |
|---|---|
| Dashboard module | Weak — slate is games, not claims |
| Game-page module | Good secondary — one featured check per game |
| **Player / prop module** | **Strongest** — a claim is usually a prop line |
| Editorial / social only | Correct for distribution; insufficient as the only home |

**Recommend:** ship Context Check first on **player/prop research** (Props Explorer player panel + betting player page), reuse `ContextCheckCard`, then optionally a game-page featured check. Social remains the distribution format (`ContextCheckInstagramCard`). Not a dashboard widget. Not 14A — **14B**.

Do not fabricate checks. Studio + mocks stay until a real feed exists.

---

## Landing / Onboarding Audit

**Landing `/`:** **REDESIGN** (voice + brand; keep preview sections as optional proof)

A first-time visitor cannot currently answer:

1. What is Court Context? — they see **NBAEdge**  
2. Who is it for? — “dominate the books” implies bettors only  
3. What is different? — “data-driven terminal / lightspeed” is generic  
4. What can I explore now? — Featured games / props previews help, but CTAs are “Start Winning Now”

Hero copy to replace:

- Out: “Dominate the Books with Data-Driven Precision”
- In: Court Context + **More than the trend.** + *Don't just follow the trend. Understand the context behind it.*

Feature cards today (Live Trend Analysis / Advanced Statistical Models / Injury & Rotation Intel) overclaim vs frozen families and GOAT-inactive. Landing must not promise live injuries, live props refresh, or paid endpoints. Show what is actually SHIP_READY: historical Finals, Market Movement, props research, the 2025 pin.

**Onboarding modal:** “Set up your workspace” / Find edges / Track picks — SaaS, not editorial. 14C rewrite.

**Offseason banners** (landing + `BettingAppShell`): rewrite as product season language, not ingestion-freeze language. Do not flip app `LIVE_INGESTION_ENABLED`.

---

## Navigation

**Today (`PRIMARY_NAV`):** Dashboard, Teams, Props Explorer, Saved, Paper, Profile.

Too many tools at the top. Profile is account, not a product concept. Paper/Saved are workflows.

**Recommended primary (implement in 14A.2, not now):**

| Primary | Route | Rationale |
|---|---|---|
| **Games** | `/betting` | Slate + matchup + historical Finals |
| **Props** | `/betting/props-explorer` | Research differentiator + Market Movement |
| **Teams** | `/teams` | Directory already exists; “Research” as a fourth label is empty until Context Check / WOWY ship |

**Account menu (secondary):** Saved, Paper, Profile, Billing, Sign out.

Wordmark: **Court Context**. Drop subtitle “Betting Dashboard”.

Player page mini-header (“NBA Analytics / Player Analysis”) should use the shared Header (today `shouldShowLayoutHeader` excludes `/betting/players/*`).

Ops, admin, `/research/*` stay out of primary nav.

---

## Free / Pro Presentation

Plans: **Free** vs **Founding Pro** (`$10/month` concept). Gating is concentrated: best book, Market Movement history, AI briefing. Historical Explorer Finals are **not** paywalled. That is the correct philosophy.

Free should keep demonstrating Court Context: slate, matchup, box, role, timeline, Close consensus.

Pro copy should stay **deeper research + time savings** (`Stop checking multiple sportsbooks manually.` is close). Avoid locking basic usefulness.

Do not redesign pricing. 14A.5 / billing polish: `FoundingProUpgradeLink` without cyan gradient glow; `UPGRADE_COPY` unchanged in meaning.

WOWY / advanced_history / alerts upgrade strings exist for “when that surface ships” — keep them from appearing as live features.

---

## Loading / Empty / Error States

| State | Today | Direction |
|---|---|---|
| No games today | “No games scheduled for today” + check another date | Add *why* (offseason / that ET date has no 2025 slate games) and date nav affordance |
| No historical data | Coverage line omits missing modules (good) | Keep present-only; never “module failed” |
| No market movement | `MM_EMPTY_*` — good | Keep |
| Provider unavailable | “Error loading data: {error}” | Human + Retry; no stack traces |
| Subscription-limited | `UPGRADE_COPY` + Close consensus | Keep pattern |
| Loading | Skeletons on dashboard, props, game details | Keep; no bounce |
| Errors | No `app/error.tsx` / `not-found.tsx` | Add thin Next boundaries in 14A.2 |
| Auth | `UnauthorizedPanel` | Keep |

Add a shared `EmptyState` (title, detail, optional action). Avoid blank `glass-card` and generic “No data yet” (`MatchupPageLayout` L1271).

---

## Mobile

Social traffic will land on phones. Highest-traffic surfaces: landing, dashboard/cards, game detail, props table.

**Top blockers (do not rebuild every table in 14A):**

1. **GameCard** — 3-col odds + chips + dual CTA overflow; `text-[9px]`.
2. **Props Explorer table** — many columns; `overflow-x-auto` is required; default columns must stay few.
3. **Header** — wordmark + six links collapse to hamburger; hamburger is fine; six items is not.
4. **Matchup sticky pills** — horizontal chip row; keep, improve contrast/scroll affordance.
5. **Player page** — extra mini-header + prop sidebar; sidebar should stack below on small screens (verify in 14A.4/5).
6. **No bottom tab bar** — acceptable if primary is three links + account. Do not add a fourth chrome layer yet.
7. Landing hero `text-5xl` / `text-7xl` + glow — reduce; avoid `overflow-hidden` clipping CTAs.

---

## Accessibility

No P0 blocker that requires a giant rewrite. P1 issues for 14A.2–.3:

- 9–11px labels fail readable type.
- `neon-text-*` text-shadow reduces contrast.
- Lime `#39ff14` and cyan on dark are used as the only status cue.
- `muted-foreground` `#8888a0` on `#0a0a0f` is borderline for small text.
- Decorative `pulse-dot` on the logo is motion without meaning.
- Semantic headings skip (dashboard has `h2` without `h1`; Header uses `h1` for the brand).
- Focus rings exist on the mobile menu (`focus-visible:ring`); not consistent on GameCard CTAs (they are links — good) vs div-cards.
- Tables: Props Explorer uses `<table>`; keep semantics; add captions where missing.
- Theme toggle vs forced `html.dark` is confusing.

Keyboard: dropdowns use Radix. Do not replace with click-only divs.

---

## Animation

Use restraint. Allowed: tab indicator, expand/collapse, skeleton pulse, short fade on route/section (150–200ms).

Remove as default: `pulse-dot` on logo, `card-hover` translateY on every card, staggered `slide-up` per GameCard (`animationDelay: index * 50ms`), `gradient-mesh` hover blurs, neon glow on buttons.

Sports data must not bounce or float.

---

## Page Priority Matrix

| Surface | Current quality | User importance | Work | Priority |
|---|---|---|---|---|
| Global shell / theme / type | Poor (wrong brand, neon) | Critical | REDESIGN tokens + chrome | **P0** |
| Landing | Poor (NBAEdge / sportsbook voice) | Critical first-time | REDESIGN voice + layout | **P0** (execute 14C after tokens) |
| Dashboard | Fair | Critical | POLISH | **P0** |
| Game cards | Fair structure, poor hierarchy | Critical | REDESIGN internals | **P0** |
| Game detail — Final | Strong (SHIP_READY) | High | KEEP + token polish | **P1** |
| Game detail — Upcoming | Fair, long | High | POLISH order + density | **P1** |
| Props Explorer | Strong tool | High | POLISH density | **P1** |
| Market Movement | Strong differentiator | High | KEEP + subtitle/hierarchy polish | **P1** |
| Player (betting) | Fair | High | POLISH context-first header | **P1** |
| Empty / error / loading | Uneven | High | POLISH + `EmptyState` | **P1** |
| Mobile (cards, nav, tables) | Weak on core pages | Critical | POLISH blockers | **P0–P1** |
| Auth | Fair | Medium | POLISH brand | **P2** |
| Billing / upgrade chrome | Fair copy, neon CTA | Medium | POLISH | **P2** |
| Teams | Fair | Medium | POLISH | **P2** |
| Saved | Fair | Medium | POLISH | **P2** |
| Paper | Fair | Lower | DEFER | **P3** |
| Context Check Studio | Coherent internal | Low public | KEEP / DEFER public | **P3** (14B) |
| Public `/games`, `/players` | Legacy zinc | Low | DEFER | **P3** |
| Ops / research labs / bet-slip stub | Out of product | None | DEFER | **P3** |

---

## Production Design System

Implementation spec for 14A.2. Prefer extending `app/globals.css` `@theme` + existing components. No one-off page palettes.

### Typography

- Display: Archivo Black via `next/font`, `--font-display`
- UI: Manrope, `--font-sans`
- Numeric: `tabular-nums` on UI font
- Load only these two on the document

### Colors

Semantic tokens in the Color System table. Replace `--primary: #00d4ff` with `--brand`. Deprecate `--neon-magenta` / `--neon-lime` from product classes.

### Spacing

Scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Section y = 32–48. Card pad = 16–20.

### Radius

`--radius: 0.5rem` (8px). Cards 8–12px. Pills full. No 2xl glow tiles.

### Borders

1px `--border`. No 4px neon left bars as the primary identity (GameCard `border-l-4` lime/orange).

### Surfaces

Page `--background`; card `--card` solid. Sticky header same as card, no `backdrop-filter`. Reserve translucent overlays for dropdowns only.

### Numeric styles

`tabular-nums`, UI font, weight 600 for scores/lines. Deltas use `--market-up` / `--market-down` plus a textual sign (`+1.5`), not color alone.

### Icons

Lucide is fine. One size step in chrome (20px header, 16px inline). Stop using Zap as the mark.

### Buttons

- Primary: brand fill, ink label, 44px min height on mobile  
- Secondary: border + transparent  
- Ghost: text  
- Upgrade: secondary or primary, **not** a third neon gradient (`FoundingProUpgradeLink`)

### Tabs

Existing `components/ui/tabs.tsx` — underline or quiet pill, not neon fill. Matchup sticky pills share the same pattern.

### Cards

One surface, one border, optional hairline divider. Footer actions as text links or buttons, not a second nested card.

### Tables

`components/ui/table.tsx` + Props Explorer table. Sticky first column optional later. Default: identity + line + movement; advanced behind toggle.

### States

`EmptyState`, skeleton (keep), inline error with Retry, `UnauthorizedPanel` keep. Hover 120ms color only; no lift.

---

## WOWY Future Placement

WOWY is **not** in 14A. Do not fake data. Do not build a possession engine.

Natural slots when a later track ships:

| Slot | Why |
|---|---|
| Betting player **Matchup** tab / context cards | Role shift vs opponent |
| Props Explorer **player panel** | Claim-adjacent “with / without” |
| Historical Final **Season Role** (`HistoricalFinalRoleProfile`) | Game-level on/off once possessions exist |
| Game-page player drawer / Players section | Same panel as player page, not a new IA |

Do not add empty WOWY chrome. Entitlement copy already mentions WOWY “when that surface ships” — keep it from looking live.

---

## Implementation Slices

Do **not** execute these in 14A.1.

### 14A.2 — Global shell + typography + theme

Tokens in `globals.css`; Archivo Black + Manrope; wordmark Court Context; primary nav Games / Props / Teams; solid header; `EmptyState`; metadata title; drop neon chrome defaults; rewrite offseason banner copy only (no backend flags).

### 14A.3 — Dashboard + game cards

Games-first dashboard; restyle `GameCard` hierarchy; empty-slate language; mobile card blockers.

### 14A.4 — Game detail

Upcoming restack toward identity → context → market → players; Final **token polish only** (preserve HE v2). Unify player page into shared header.

### 14A.5 — Props + Market Movement

Density, promote Pre-Tip → Close visually, upgrade CTA restyle, player header context-first (raw stats remain). No serving/API changes.

### 14B — Context Check completion

Product + social alignment; place on player/prop surfaces; still no fake feed.

### 14C — Onboarding / landing

First-time clarity: Court Context, tagline, honest SHIP_READY proof, CTAs to Games / Props.

Adjust only if 14A.2 reveals token constraints. Landing is P0 quality but **follows** tokens so 14C does not restyle twice.

---

## Files Reviewed

- `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- `app/login`, `app/signup`, `app/billing/page.tsx`
- `app/betting/page.tsx`, `layout.tsx`, `games/[gameId]`, `players/[playerId]`, `props-explorer/page.tsx`
- `app/games/[gameId]/page.tsx`, `app/players/[playerId]/page.tsx`
- `app/teams/**`, `app/admin/content/context-check/page.tsx`
- `components/betting/Header.tsx`, `BettingAppShell.tsx`, `primary-nav.ts`, `GameCard.tsx`, `MatchupPageLayout.tsx`, `FoundingProUpgradeLink.tsx`, `UnauthorizedPanel.tsx`
- `components/betting/market-movement/MarketMovementSection.tsx`
- `components/betting/HistoricalFinal*.tsx`, `HistoricalStartingFive.tsx`
- `components/content/context-check/*`, `instagram-fonts.ts`, `instagram-type.ts`
- `components/landing/*`, `components/ui/{tabs,table,skeleton}.tsx`
- `lib/entitlements/types.ts`, `lib/betting/market-movement-present.ts`, `lib/betting/historical-final.ts`, `lib/betting/props-explorer-empty.ts`, `lib/content/context-check/view-model.ts`
- `reports/product/historical-explorer-v2-final-signoff.md`, Market Movement v1 product reports

Backend, Terraform, and ingestion files were not modified and were not in scope.

---

## Recommended Next Step

**14A.2 — Global shell + typography + theme.**

Do not start dashboard restyle, Context Check rewrite, landing rewrite, or WOWY until tokens and Court Context chrome exist. Otherwise every page will be painted twice.

---

## Verification Checklist

1. Confirm no AWS / Terraform / ingestion / schema diff in this step.
2. Confirm Historical Explorer Final section order is still the certified KEEP list.
3. Confirm Market Movement labels remain `3-Hour Pre-Tip` → `Close`, not “Reference.”
4. Confirm product name lock: Court Context + “More than the trend.”
5. Confirm 14A.2 is the only recommended next slice — not 14A.3+ executed now.
6. When 14A.2 starts: load only Archivo Black + Manrope on the document.

---

## Step Verdict

**GREEN — Court Context has a coherent production UI direction and implementation plan**

Information architecture of certified product (Historical Explorer, Market Movement, Props Explorer, game routes) does **not** need a deeper IA redesign. The defect is visual system, brand split, density, and first-time language. That is a sequenced polish/redesign of chrome and hierarchy — not a RED product-structure rewrite.
