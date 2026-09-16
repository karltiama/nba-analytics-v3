# Court Context launch readiness — 2026-09-16

Read-only reconciliation. No code, flags, schedules, or schema were changed.

Evidence is from routes, serving code, env defaults, Terraform/ops reports dated 2026-09-11…16, product reports, and tests. Filenames were not treated as completion.

---

# Executive Status

**Overall: AT RISK**

The repository is not a greenfield. A real authenticated research product exists: Props Explorer, player/game research, teams, billing, paper/saved, and a statistical projection ladder. Historical 2025–26 player-game logs and archived prop markets are in Postgres. Game-status sync is the only live ingestion path.

It does **not** currently satisfy the stated soft-launch bar.

| Soft-launch requirement | Met? | Evidence |
|---|---|---|
| Reliable core data | **Partial** | Serving pin `PINNED_ANALYTICS_SEASON='2025'` (`lib/season.ts`). Only `nba-game-status-sync-schedule` is ENABLED. Nightly/props/odds/injuries/boxscore DISABLED. Freeze triad `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`. |
| Understandable projection methodology | **No** | Users see “Court Context statistical projection” (`app/betting/props-explorer/page.tsx`). No public methodology page. Model Lab still labels production as DNP-inclusive 70/30 while serving defaults to Track B.1. |
| Working prop browsing/research | **Yes (historical)** | `/betting/props-explorer` + live EV APIs. Offseason empty copy is honest (`lib/betting/props-explorer-empty.ts`). Prior UI audit verified a 2026-04-04 slate. |
| Working prop sharing | **No** | No share button, OG card, clipboard export, or PNG for props. |
| Functional X-Ray MVP | **No for a public user** | Route and UI exist. `SCREENSHOT_EXTRACTION_AVAILABLE = false`. `PARLAY_XRAY_EXTRACTION_ENABLED` defaults false. Confirm copy: “Live analysis is not connected yet.” Historical replay is certified internally, not the public Confirm path. |
| Presentable landing/dashboard | **Partial** | Dashboard/Explorer redesigned. Landing uses static `demo-*` cards, sample props, footer **NBAEdge**, CTA **Start Winning Now**, metadata title **NBA Analytics**. |
| Mobile usability | **Partial** | Explorer has drawers/bottom sheet. Game detail and player research still pre-redesign neon (2026-09-13 frontend audit). No app-wide `error.tsx` / `loading.tsx`. |
| Preseason-relevant content | **Weak** | No `/preseason` route. Team pages have roster continuity. No countdown, takeaways, or Context Check preseason join. |
| Production health | **Partial** | `package.json` has `build` / `lint` / `test`. No `.github/` CI. No `typecheck` script. Freeze is intentional, not an outage. |
| No misleading AI/model claims | **At risk** | X-Ray and WOWY sit in primary nav. Extraction is off. WOWY is ungated research. Hero copy lists injuries. Landing previews look live. |

**Why not BLOCKED:** Core historical research works. Offseason freeze is a chosen safety posture, not a crashed platform. The path to a credible soft launch is a small honesty + sharing + X-Ray Confirm slice, not a rebuild.

**Why not ON TRACK:** Primary nav advertises two headline tools (X-Ray, WOWY) that are not launch-ready as marketed. Sharing is missing. Injuries access was denied (HTTP 401) on 2026-09-16. Opening-night-adjacent data (props, injuries, 2026 box tape) is not collecting.

---

# What Is Actually Done

These are live in the product or certified as working on historical data.

- **Auth / billing:** `/login`, `/signup`, session gate on `/betting`, `/billing`, `/admin`, `/ops` (`lib/supabase/middleware.ts`). Stripe Founding Pro entitlements (`lib/entitlements/types.ts`).
- **Dashboard / slate:** `/betting` with date URL, freeze-aware empty states.
- **Props Explorer:** `/betting/props-explorer` — discover, inspect, player/market/game panels, Save / Compare / Paper / Add to Parlay. Serving: `app/api/betting/props-explorer/route.ts` → `lib/betting/props-explorer-serving.ts`.
- **Player and game research:** `/betting/players/[playerId]`, `/betting/games/[gameId]` (content still mixed visual systems).
- **Teams:** `/teams`, `/teams/[teamId]` roster continuity / offseason roster-change story.
- **Production projection ladder:** Track B.1 mean + calibration + market anchor + EV + confidence tier (see Data / Modeling).
- **Game-status sync:** EventBridge Scheduler **ENABLED**, BDL `/v1/games`, season `STATUS_SYNC_TARGET_SEASON=2026`.
- **Prune safety gates:** fail-closed unless `PRUNE_ENABLED=1` and live triad (`lib/prune/env-gate.ts`). Vercel cron registered; mutations gated off in freeze.
- **Player-prop ingest + S3 archive code:** implemented, schedules/ESM off.
- **Game-level WOWY explorer:** `/wowy` + APIs; descriptive WITH/WITHOUT on played vs verified DNP; honest possession disclaimer.
- **Model Lab (admin):** `/admin/model-lab` reads frozen experiment artifacts; does not change serving.
- **Context Check studio:** `/admin/content/context-check`, `robots: noindex`, web + Instagram *preview* cards.
- **X-Ray library (not public E2E):** upload UI, extract API, quotas, resolution, historical replay orchestrator, interpretation, results UI. Certified on a locked April 2, 2026 slip (`reports/product/parlay-xray-end-to-end-historical-replay.md`).
- **Paper / saved / profile.**

---

# What Is Research Only

Do not promote. Do not market as live models.

| Area | Status | Evidence |
|---|---|---|
| Played-only Track A | Benchmark only | DNP `"00"` filtered; different from production DNP-inclusive windows |
| Conditional EWM minutes (Benchmark B) | Frozen **candidate** | `player-projection-v1-minutes-role-r1`. Not served |
| Usage / rate | **Rejected** | Decision **KEEP MINUTES CANDIDATE ONLY** (`player-projection-v1-usage-rate-results.md`) |
| Learned C / D (CatBoost) | Historical confirmation | PTS/REB **C** nominated for *prospective shadow only*. AST/3PM none. Not production certified |
| Shadow PTS C / REB C | Implemented, **not deployed** | `shadow_create=false`, `SHADOW_SCORING_STATUS='DISABLED'` |
| WOWY r1 features | Not trained as a serving model | `MODEL_FEATURE_SOURCE: NOT_IMPLEMENTED` |
| WOWY known-Out residual r1 | **Inconclusive** | Eligible N=625; `decision.label=inconclusive` |
| Owls closing-odds / player-prop / public-betting archives | S3 research tapes | `.env.example`: do not set `OWLS_API_KEY` until trial |
| Kalshi / Polymarket | Classified prediction-market; excluded from sportsbook consensus | `lib/betting/market-movement-backfill.ts` |
| Context Engine contract | Spec + types | `lib/context-engine/contract.ts` — not a prediction endpoint |
| Prospective 2026–27 shadow holdout | **Not started** | Model Lab: `prospectiveEvaluation.started: false` |

Opponent / pace / rest / home-away projection experiments: **not started** (`reports/modeling/player-projection-v1-roadmap.md`).

---

# What Is UI / Mock Only

| Surface | What users would think | What it actually is |
|---|---|---|
| Landing featured games | Live slate | `DEMO_GAMES` ids `demo-1`… (`components/landing/FeaturedGames.tsx`). `GameCard` links to `/betting/games/[id]` → demo 404s |
| Landing props table / trending strip | Live board | Sample rows (`LandingPropsTablePreview.tsx`, `LandingTrendingPlayerStripPreview.tsx`) |
| Landing hero prop | Live Tatum 27.5 | Hardcoded (`LandingHeroPlayerCard.tsx`) |
| X-Ray `?preview=` | Real analysis | Dev-only fixtures; disabled in production (`isXrayDesignPreviewEnabled`) |
| X-Ray `XrayAnalysisPanel` insight grid | Product truth | Design preview; real certified path is `XrayResultsPanel` |
| WOWY “Top 5 lineup combinations” | Lineup model | “Coming later” placeholder (`app/wowy/WowyResults.tsx`) |
| Context Check Instagram/web cards | Publishable posts | Mock candidates + manual generator + synthetic samples (`lib/content/context-check/`) |
| Player matchup `FutureOddsPlaceholderCard` | Odds | Honest “coming soon” |
| Landing footer / metadata | Court Context | **NBAEdge** / **NBA Analytics Edge** / title **NBA Analytics** |

---

# What Is Partially Implemented

| Area | What works | What does not |
|---|---|---|
| BDL ingestion | `/v1/games` status-sync | Injuries 401; odds historically 401; nightly/props/boxscore disabled |
| Historical player-game data | ~138k analytics logs, product pin 2025 | Nightly `/v1/stats` off; 2026 box tape not accumulating |
| Player props + S3 archive | Code, IAM, staged Lambda archive flag | Schedulers/ESM DISABLED; freeze no-ops workers |
| Injuries pipeline | Collector logic, tests, membership design | Credential 401; schema missing; Lambda frozen; schedule DISABLED |
| Closing lines | Owls historical tape; prune materialize path | Live BDL odds snapshots off; product closing lines need live prune flags |
| X-Ray | Upload, review UI, lib pipeline, historical replay, error copy | Public extraction kill-switched; Confirm does not run live analysis; no share |
| Parlay tray | Add/remove legs, same-player/game labels, soft cap 12 | No persist, no Analyze, no target odds, no ranking |
| Preseason | Roster added/departed/returning on team pages | No dedicated page, rotations, takeaways, countdown |
| Landing / chrome | New editorial on landing, dashboard, Explorer, teams, billing | Game + player research still neon; brand split |
| Entitlements | Pro gates line shopping, market movement, AI briefing | `wowy` listed as Pro copy; `/wowy` is public. `alerts` / `advanced_history` “when that surface ships” |
| Shadow / context snapshots | Protocol + Lambda package | Schema unapplied; `shadow_create=false` |

---

# What Is Not Started

- Public **prop sharing** (card, OG, clipboard, PNG)
- **X-Ray share result**
- **Parlay Builder** as a preference-driven product (target odds, risk, suggestions, ranking)
- Dedicated **preseason** page, projected rotations, role/rookie watch surfaces, takeaways, countdown
- Context Check **database discovery**, persistence, public publish, PNG export
- **Roster Check** / **Performance Check** as social products
- **Coming Soon** social toolkit
- **Game prediction / winner model** (no `*game*model*` implementation; pace is labeled “not a game prediction”)
- Kalshi / Polymarket **product path**
- Opponent / pace / rest / home-away **projection experiments**
- App-wide `error.tsx` / `loading.tsx`
- GitHub Actions CI

---

# Launch Blockers

Maximum five. Ordered by how hard they fail a *credible* soft launch, not by engineering size.

1. **Public Parlay X-Ray is in primary nav but is not a working user pipeline.** Route `/parlay-xray` is public (cookie refresh only; not session-gated). Client `SCREENSHOT_EXTRACTION_AVAILABLE = false`. Server default `PARLAY_XRAY_EXTRACTION_ENABLED=false`. After Confirm: “Legs locked. Live analysis is not connected yet.” (`components/parlay-xray/ParlayXrayView.tsx`). Shipping this as-is is a broken flagship.

2. **Prop sharing does not exist.** Discover → inspect → projection works. Share is absent (no `share`/`og:image`/`toPng` product path). Soft-launch bar requires it.

3. **Landing honesty.** Static demo matchup cards with `id: 'demo-*'` link into authenticated game routes. Sample props table includes a “model” column. Footer still **NBAEdge**. CTA **Start Winning Now**. Hero lists injuries while injuries collection is blocked. Root metadata is still **NBA Analytics**.

4. **BDL injuries entitlement denied (2026-09-16).** Probe `GET …/player_injuries?per_page=1` → HTTP **401**, non-JSON (`reports/operations/bdl-injuries-entitlement-probe.json`). Blocks live injury context, preseason availability stories, WOWY prospective tape, and injuries-only activation. Code is not the first fix.

5. **No user-facing methodology, and internal labels disagree with serving.** Production serving default is `EV_RANKING_TRACK` → `trackB_calibrated` (Track B.1 + cal + anchor). Model Lab `PRODUCTION_CONTROL` still describes `computeProjection` 70/30 as “current production control.” Users cannot explain what the number is. Easy to over-claim “model/AI.”

---

# P0 Before Soft Launch

Ordered by dependency. Do not start later items until earlier ones are decided.

1. **Decide the launch promise.** Either: (a) historical-research + honest offseason product, or (b) screenshot X-Ray as the flagship. Do not keep both in primary nav if only (a) is true.
2. **Honesty pass (copy + landing).** Court Context naming; kill NBAEdge / Start Winning / demo 404s; label sample previews; stop implying live injuries; short public methodology for Track B.1 (not Track A, not learned C, not WOWY).
3. **Nav alignment.** Hide or relabel Parlay XRay and WOWY until their public contract matches. WOWY can stay if labeled game-level research. X-Ray cannot stay as “upload a slip” while Confirm does nothing.
4. **Prop sharing MVP from real Explorer rows.** One card, real projection/line/odds, copy link or download. No Instagram pipeline required.
5. **Smallest public X-Ray (only if it remains a launch pillar).** Enable gated extraction + Confirm → existing resolve/interpret/`XrayResultsPanel`. Structural shared-game/player + Why This Could Fail. No win %, no measured correlation, no share. Kill switch stays fail-closed.
6. **Injuries access (ops, not a feature branch).** Re-run the same entitlement probe to HTTP 200 before applying injury SQL or `injuries-only.tfvars.example`. Do not freeze-all (that would disable status-sync).

Do **not** thaw props/odds/nightly as a P0 for a mid-September soft launch. Empty live boards with honest freeze copy are safer than half-live markets.

---

# P1 Immediately After Launch

- Wire Confirm live-context assembly (as-of cutoff) once injuries + props polling exist.
- Game detail + player research onto the same editorial system (trust cliff after GameCard).
- Context Check: one real-data candidate → human review → export (still not auto-post).
- Team-page preseason pack: roster changes + returning + “no completed games” already exist; add takeaways copy from real continuity, not a new app.
- Flip `PLAYER_PROP_ARCHIVE_REQUIRED_FOR_PRUNE` before thawing destructive prune.
- Props S3 polling on when the first 2026–27 slates matter (status-sync watchpoint ~2026-10-19…23).
- App-wide empty/error/loading; CI (`vitest` + `next build` on push).

---

# P2 Regular Season

- Thaw nightly BDL stats + box accumulation for 2026–27; flip `CURRENT_ANALYTICS_SEASON` only after averages are seeded.
- Live odds snapshots if entitlement allows `/v2/odds`.
- Prospective shadow collection for frozen PTS C / REB C (still not serving).
- Opponent / pace / rest experiments on the v1 roadmap.
- Market movement live (already Pro-gated historically).
- Alerts entitlement surface.

---

# Data / Modeling Status

## Production (what users are served)

**Track A is not the primary served projection.**

Path:

```
getPlayerPropModelInputs()          # last 10 Final logs, DNP-inclusive + season
computeProjection = 0.7*L10 + 0.3*season
Track B.1: stability-weighted L5 blend (cap 0.45) + dynamic σ
calibrateProbability(..., 'trackB') # artifacts v1-fit-2026-03-25
anchorToMarket                      # BASE_ANCHOR_BUDGET=0.08
EV = p * decimalOdds - 1
resolveEvTrack() default = trackB_calibrated
```

Code: `lib/betting/player-prop-model.ts`, `lib/betting/player-prop-ev-row.ts`, `lib/betting/ev-selection-policy.ts`, `lib/betting/track-b1-policy.ts`.

| Piece | Production? | Notes |
|---|---|---|
| Formula | **Track B.1** on DNP-inclusive 70/30 base | Track A still computed as parallel fields |
| Probability | Yes | Normal CDF, \|z\| cap 3, clip [0.03, 0.97], then cal + anchor. UI “Est. P” is post-anchor |
| Calibration | Yes | Linear per-prop; not a new model |
| Confidence tier | Yes | Heuristic (combo → low; sample / minutes CV / stat CV). Not ML uncertainty |
| EV | Yes | From selected-track anchored p |
| Learned C/D | **No** | |
| EWM minutes | **No** | |
| Usage/rate | **No** (rejected) | |
| WOWY | **No** | |
| Shadow | **No** | Not deployed, not running |

APIs: `/api/betting/props-explorer`, `/api/betting/players/[playerId]/props?with_ev=1`, bet-slip analyze.

## Research (do not promote)

- Minutes candidate: EWM α=0.25, clip 0.85–1.15, only if \|L5min−L10min\|/L10 ≥ 0.25, never 3PM.
- Usage: failed promote bar vs minutes candidate.
- Learned r1: C nominated for PTS and REB shadow; D not preferred over C for PTS; AST/3PM none.
- WOWY known-Out residual: inconclusive.
- Shadow protocol: ready as code; schema/TF/scoring off; injuries feed blocked.

## Data infrastructure classifications

| Item | Classification |
|---|---|
| BallDontLie ingestion | **PARTIAL** |
| Historical player-game data | **PARTIAL** (corpus yes; refresh off) |
| Player prop ingestion | **READY BUT DISABLED** |
| Raw S3 prop archival | **READY BUT DISABLED** |
| Prune/archive safety | **PRODUCTION READY** (gates); destructive path idle |
| Schedules / workers | **PARTIAL** (only game-status live) |
| Injury pipeline | **BLOCKED** (401 + missing schema + frozen) |
| Closing odds archive | **RESEARCH ONLY** (Owls) + **READY BUT DISABLED** (live BDL odds) |
| Owls player-prop archive | **RESEARCH ONLY** |
| Public betting archive | **RESEARCH ONLY** (unsafe as timed model input) |
| Proprietary / live snapshot collector | **BLOCKED** |

---

# Feature Status Matrix

| Feature | Status | Production Ready? | Priority | Blocker |
|---|---|---|---|---|
| Projection | **DONE** (Track B.1 ladder) | Yes as a statistical projection; not as an ML model | P0 (explain, don’t replace) | Methodology copy; Model Lab 70/30 vs served B.1 |
| Prop experience | **NEAR DONE** | Yes for historical research | P0 | Offseason empty live date is expected; freeze copy is honest |
| Prop sharing | **NOT STARTED** | No | P0 | No share/OG/export implementation |
| X-Ray | **PARTIAL** | No (public E2E) | P0 if flagship; else P1 and hide from nav | Extraction default off; Confirm does not analyze; no share |
| Preseason | **PARTIAL** | No as a product | P1 | No dedicated surface; injuries blocked for availability stories |
| Context Check | **DESIGN ONLY** (studio + mocks) | No | P1 | Discovery TODO; no PNG export; no `context_checks` table |
| WOWY | **RESEARCH ONLY** (UI live as labeled splits) | No as a model | P2 (UI P1 if labeled) | No possession/lineups; known-Out inconclusive; injuries 401 for prospective |
| Parlay Builder | **PARTIAL** (selection tray only) | No | P2 | Spec leftover; no target odds / risk / suggestions |
| Live snapshot collector | **BLOCKED** | No | P2 | Schema unapplied; injuries 401; freeze |
| Kalshi / Polymarket | **RESEARCH ONLY** | No | P3 | Intentionally out of sportsbook path |
| Game model | **NOT STARTED** | No | P3 | No implementation; do not invent one for launch |

---

# Recommended Next 7 Days

Work blocks, not fantasy one-day epics. No implementation in this audit.

### Day 1 — Launch contract + honesty

- Write the one-sentence launch promise (historical research vs X-Ray flagship).
- Inventory every user-visible claim: landing hero, footer, metadata, primary nav, Explorer column titles, X-Ray page description, WOWY copy, injury mentions.
- Decide: keep X-Ray in nav only if Days 4–6 will connect Confirm.

### Day 2 — Landing / brand (small, user-visible)

- Court Context naming (title, footer).
- Replace or unlink `demo-*` GameCards (historical real games or non-clickable samples).
- Mark props/trending previews as samples.
- Soften “Start Winning Now.” Keep “Offseason Improvements In Progress” (already honest).

### Day 3 — Methodology (short public note)

- One screen: DNP-inclusive L10/season base, L5 stability blend, probability is calibrated and market-anchored, confidence is heuristic, not CatBoost/WOWY/AI.
- Align Model Lab production blurb with `resolveEvTrack()` so internal and external stories match.

### Days 4–5 — One of: prop share **or** X-Ray Confirm (not both at full depth)

**If launch needs sharing (bar says yes):** share card from an Explorer row (projection, line, book, Est. P labeled). Copy image or URL. No OG site-wide redesign.

**If launch needs X-Ray as flagship:** smallest MVP:

1. Auth (optional but recommended) + upload + explicit Extract.
2. `PARLAY_XRAY_EXTRACTION_ENABLED` only after guardrail SQL + dedicated key + quotas (already built).
3. Confirm → existing `runHistoricalXrayReplay`-style interpret **or** live context lookup with an explicit as-of; fail closed if cutoff missing.
4. `XrayResultsPanel` + Why This Could Fail. No win %, no share, no preview insight grid as truth.

Do not spend these days on Parlay Builder, WOWY residual, or shadow Terraform.

### Day 6 — Preseason without a new app

- Use team roster-change / returning panels as the preseason surface.
- Do not build `/preseason`, countdown, or Context Check publish.
- If injuries 401 is still denied, do not promise injury watch.

### Day 7 — Ops gate only

- Re-run BDL injuries entitlement probe. Stop if still 401.
- Do not apply injury SQL or enable `injuries_execution_enabled` until 200.
- Confirm status-sync still ENABLED. Do not apply freeze-all tfvars.
- Optional: add CI workflow planning (implement later); do not boil the ocean.

---

# What NOT To Work On Yet

Distractions that look like progress and delay a credible launch:

- Promoting learned C/D or EWM minutes into production
- WOWY as a projection feature or lineup product
- Known-Out residual follow-ups until a usable injury tape exists
- Shadow Lambda enable / schema apply (blocked on injuries + not needed to launch)
- Thawing props/odds/nightly “to look live” before archive-required-for-prune and entitlement are real
- Parlay Builder (target odds, correlation model, Analyze CTA)
- Kalshi / Polymarket productization
- Game winner / cover model
- Usage/rate re-run
- Context Check auto-publish or Instagram PNG renderer
- Another visual redesign of landing, Explorer, or GameCard
- Neon→editorial rewrite of game/player pages *before* honesty + share + X-Ray decision
- Owls live collectors

---

# Top 3 Next Actions

1. **Honesty + launch contract:** Court Context naming, demo/sample labeling, methodology, and nav that matches what a user can actually finish today.
2. **Ship prop sharing from real Explorer data** (the only missing step in discover → inspect → understand → share).
3. **Either connect X-Ray Confirm to the already-certified interpretation/results UI under a fail-closed extraction gate, or remove X-Ray from the launch nav.** Do not leave a public upload page that stops at “live analysis is not connected yet.”

---

## Appendix — route inventory (current)

| Route | Role | Auth |
|---|---|---|
| `/` | Marketing landing | Public |
| `/login`, `/signup` | Auth | Public |
| `/betting` | Dashboard | Session |
| `/betting/props-explorer` | Prop board | Session |
| `/betting/players/[playerId]` | Player research | Session |
| `/betting/games/[gameId]` | Matchup | Session |
| `/betting/saved`, `/paper`, `/profile` | Account tools | Session |
| `/betting/bet-slip-analyzer` | Redirect → `/parlay-xray` | Session (legacy) |
| `/parlay-xray` | X-Ray | Public (cookie refresh) |
| `/wowy` | Game-level WOWY | Public |
| `/teams`, `/teams/[teamId]` | Team / roster | Public shell |
| `/billing` | Founding Pro | Session |
| `/admin/model-lab` | Research workbench | Admin allowlist |
| `/admin/content/context-check` | Editorial studio | Admin, noindex |
| `/ops` | Internal health | Session |
| `/players/[playerId]`, `/games/[gameId]` | Legacy public | Public |
| `/research/*` | Internal | Public/internal |

## Appendix — flags that matter

| Flag | Default / posture | Effect |
|---|---|---|
| `EV_RANKING_TRACK` | unset → `trackB_calibrated` | Primary projection/EV |
| `PARLAY_XRAY_EXTRACTION_ENABLED` | false | No vision calls |
| `SCREENSHOT_EXTRACTION_AVAILABLE` | hardcoded false | Client Extract CTA contract |
| `DATA_MODE` / `OFFSEASON_MODE` / `CRON_DRY_RUN` | freeze `replay` / `1` / `1` on Lambdas | Workers no-op |
| `live_ingestion_enabled` | TF default false; live account true for status-sync | Master ingest |
| `*_execution_enabled` | only game-status true in prod | Family schedules |
| `PRUNE_ENABLED` | must be 1 for deletes | Fail-closed |
| `PLAYER_PROP_S3_ARCHIVE_ENABLED` | TF default false | Per-run archive |
| `shadow_create` / `shadow_execution_enabled` | false | Shadow not running |
| `OWLS_API_KEY` | unset | Research only |

Audit date: 2026-09-16. Sources include `reports/operations/court-context-prospective-activation-handoff.md`, `reports/operations/bdl-injuries-entitlement-probe.json`, `reports/product/parlay-xray-end-to-end-historical-replay.md`, `reports/product/2026-27-post-redesign-ui-ux-frontend-audit.md`, and the serving/UI files cited above.
