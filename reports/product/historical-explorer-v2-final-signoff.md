# Historical Explorer v2 — Step 12I Final Signoff

**Step verdict:** `GREEN — Historical Explorer v2 is complete and ship-ready`

**Product classification:** `SHIP_READY`

**Date:** 2026-09-10  
**Scope:** Product polish, coverage UX, sticky-nav audit, small Umami telemetry, Free/Pro audit, full-page QA, and signoff. No new major feature.

STOP after this step. Do not start 2026–27 live activation, possession/WOWY, or game-odds Market Movement UI.

12H remains approved: `GREEN — Historical Timeline v1 is ship-ready`.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| BDL HTTP for historical Finals | **0** (details Final contract never calls `fetchLineupsFromBallDontLie`; Timeline S3-only) |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Historical serving backfills | **none** |
| S3 writes | **none** |
| New provider acquisition | **none** |
| Schema expansion | **none** |
| Possession engine | **not started** |
| WOWY | **not started** |
| Injury-as-of | **not started** |
| Live PBP | **unchanged** |
| Game-odds Market Movement UI | **not started** |
| Live ingestion activation | **not started** |
| Global redesign / nav overhaul | **not done** |

Certified 12G Timeline counts remain:

| Fact | Value |
| --- | --- |
| Plays objects | **1,322** |
| Timeline available | **1,319** |
| Truncated / hidden | **3** (`18446876`, `18447389`, `18447390`) |
| Score reconciled | **1,302** |
| Chronology-usable mismatches | **17** |

Availability is still `availability.*` flags, never `season === 2025`.

---

## Complete Historical Experience Audit

Reviewed as **one page**, not isolated cards. Canonical surface: `/betting/games/:id` in Final view.

| Region | Role on Finals | Judgment |
| --- | --- | --- |
| Overview | Date, **Final** status, official score, season label, coverage line | Immediate “completed game” identity |
| Starting Five | Certified 5+5 only; lives in Overview, **not** a sticky pill | Correct prominence when present; correctly absent otherwise |
| Players | Box Score \| Advanced (`this game`) | Primary research table |
| Context | Season Role (`this season`) | Distinct from Advanced; stays a separate section |
| Timeline | Key Events default, Full PBP optional | Present only when `availability.timeline` |
| Lines | Last, labeled closing/stored; crowd sentiment **hidden** | Does not look like a live betting desk |

The page reads as completed-game research. Later Lines do not overwrite the Final/Starting Five/Players hierarchy.

---

## Historical vs Live Separation

Finals do **not** foreground:

- Projected starters
- Injury modules
- AI Projection Summary
- Crowd Market Sentiment
- Current-looking Open / Current chart captions

Live/upcoming (`21717855`, Scheduled) still shows Projected starters, AI Projection, Odds & sentiment, Matchup, Injuries. No historical Advanced / Season Role / Timeline. No `Completed game` coverage line. `historical_game_viewed` does not fire (`isFinalView` early return).

A user understands within seconds: this is research about a completed game.

Upcoming/live pages were **not** redesigned.

---

## Information Hierarchy

Sticky order on Finals (available sections only):

1. **Players** (Box \| Advanced)
2. **Context** (when Role Profile is available)
3. **Timeline** (when certified)
4. **Lines** (when stored odds exist)

Starting Five stays in Overview. Coverage metadata sits under sticky nav.

Odds/AI were demoted or gated:

- AI Projection: Finals only skip the fetch and never render the purple block
- Sentiment: `showSentiment && !isFinalView`
- Lines: last, “Sportsbook lines” / “Closing or stored…” / chart captions **First stored** / **Stored close**

No new odds features.

---

## Coverage UX

One restrained present-only line. Absent modules are **omitted**, not listed as errors.

| Pattern | Line |
| --- | --- |
| 2023 / 2024 (`15905067`) | `Completed game · Box · Advanced · Season Role` |
| 2025 full (`18447937`) | `Completed game · Starting Five · Box · Advanced · Season Role · Timeline` |
| 2025 starter anomaly (`18447931`) | Starting Five omitted; Timeline still listed |
| 2025 truncated (`18447390`) | Timeline omitted; Starting Five still listed |

Older seasons do not imply Timeline/Starting Five “failed.”

---

## Terminology / Copy

Canonical product language is in use:

| Term | Meaning |
| --- | --- |
| Final | Official result |
| Starting Five | Historical starter designation |
| Advanced | This game |
| Season Role | This season |
| Timeline | Historical chronology |
| Key Events | Not “Clutch” |
| Full Play-by-Play | Normalized historical events |
| 3-Hour Pre-Tip | Not used on Final modules |

Removed/avoided on historical modules: Projected, Current, Tonight, Open, Live.

Season Role copy kept: **“This season, not this game. Advanced above is game-level performance.”**

Timeline subtitle: **“Play-by-play order. Official final stays in the header.”** Score pair appended only on mismatch.

No `SCORE_MISMATCH`, `STARTER_ANOMALY`, `blocked_by_schema`, or rotation failure codes in product UI.

Repetition reduced: Starting Five columns use team abbr only; Season Role no longer repeats the selected player as a second heading.

---

## Visual Consistency

Incremental alignment only (shared `glass-card`, `rounded-xl`, `px-3 py-2` headers, `text-sm` titles, `text-xs` / `text-[10px]` secondary).

- No global font/color rewrite
- Line-movement SVG uses `viewBox` + `width="100%"` + overflow clip
- Timeline body `min-h-[6rem]` so lazy load does not collapse the card
- Details skeleton is generic stacked cards (no purple AI-looking first block)

---

## Mobile QA

Viewport **390px** on `18447937`:

| Check | Result |
| --- | --- |
| Horizontal overflow from Historical Explorer modules | **None** (`scrollWidth === clientWidth === 390`) |
| Sticky nav | Players / Context / Timeline / Lines usable |
| Box / Advanced toggle | Usable |
| Timeline Key / Full toggle | Usable |
| Season Role `<select>` | Full width, usable |
| Coverage line | Wraps as secondary text; not a giant explainer |
| Header username | Hidden below `sm` (localized overflow fix) |

Pre-existing Next.js **dev** hydration overlay on betting chrome can still intercept clicks in development. It is not a Historical Explorer module defect and was not rewritten here.

---

## Desktop QA

Normal desktop width: research-article rhythm — Overview (score + optional Starting Five) → Players → Context → Timeline → stored Lines. No live-first sidebar of injuries/AI. Whitespace between `space-y-4` sections is consistent with the rest of the matchup shell.

---

## Loading / Expected Absence

| State | Behavior |
| --- | --- |
| Cold Final | Header and details contract render first; Timeline is lazy |
| Timeline loading | Card reserved (`min-h-[6rem]`); does not destroy layout |
| Live skeleton | Generic; no AI-purple identity on Finals |
| Optional modules | Gated on availability before mount; they do not flash then vanish |
| 2023 | No starters, no Timeline — normal |
| 2024 | Same coverage pattern as 2023 (no starters, no Timeline) |
| 2025 anomaly `18447931` | No Starting Five; Timeline still available |
| 2025 truncated `18447390` | No Timeline; other modules continue |
| Player without Advanced | Row stays; metrics `—` |
| Missing playtype qualification | Role Profile still useful from other categories |

---

## Quality Warning UX

The only prominent quality warning is Timeline score mismatch:

> Play-by-play scoring differs from the official final. Event order is preserved; the final score above remains authoritative.

Lead-change / flow summary stays hidden on mismatch (no unsafe flow). Truncated games hide Timeline entirely rather than warning about pipeline internals.

---

## Advanced / Role / Timeline Clarity

**Advanced:** No arbitrary low-sample cutoff. MIN and Poss remain visible; raw values retained. Understandable in full-page context next to Box. No confidence system added.

**Season Role:** Still a separate Context section. On `15905067`, Tatum’s game USG (Advanced) and season isolation frequency (Role) cannot reasonably be confused. Sections were **not** merged.

**Timeline:** Key Events remains the default noise reduction. Full PBP is optional. Mismatch banner is amber note, not alarm. Period headings unchanged. Timeline does not dominate 2023/2024 pages (absent) or truncated 2025 (absent).

**Player identity:** Starting Five, Box, and Advanced use `playerResearchHref`. Context is an in-page selector (explicit selection), not a second player-page architecture.

---

## Analytics Instrumentation

Umami-compatible `trackEvent`. IDs and capability flags only.

| Event | When | Dedupe | Properties |
| --- | --- | --- | --- |
| `historical_game_viewed` | Final layout resolves | Once per `game_id` | `game_id`, `season`, `starters_available`, `advanced_available`, `role_profile_available`, `timeline_available` |
| `historical_player_opened` | Season Role `<select>` **change** | Per explicit interaction | `game_id`, `season`, `surface=season_role` |
| `historical_timeline_opened` | Sticky/scroll makes Timeline the active section | Once per `game_id` | `game_id`, `mode` (`key` on first open) |

Not fired: default Role player render, live 2026 pages, Key↔Full tab switches (same game), per-event Timeline impressions, hovers, stat clicks.

Privacy: no player names, user names, emails, account IDs, box arrays, PBP, or odds payloads.

Blocked/missing `window.umami` is a no-op (does not throw).

---

## Free / Pro Audit

**Actual behavior:** Historical game, Box, Starting Five, Advanced, Season Role, and Timeline are behind **betting auth only** (`requireBettingAuth`). They are **not** gated on `advanced_history`.

`advanced_history` exists as a reserved feature key and upgrade copy (“Unlock expanded historical exploration when that surface ships”) but **no route calls `requireEntitlement(..., 'advanced_history')`**.

12A recommendation stands: **no new paywall for Historical Explorer MVP.** 12I invents none.

**Later packaging (recommendation only):** keep Box + Starting Five + official Final on Free; consider Founding Pro for Advanced / Season Role / Timeline if those become the paid research depth. Do not gate the ability to open a historical game.

---

## Optional Market Context — decision only

**Do not** make Historical Explorer depend on sparse market coverage.

| Surface | Coverage |
| --- | --- |
| Prop Market Movement v1 rows | **121** games |
| Game Opening Snapshot | **107** games, limited March window |

**Recommendation:** leave **Props Explorer** as the canonical market-history experience. Historical Explorer v2.1 may add an **optional** Market Context module later, only when a given game actually has certified rows. Not a v2 completeness requirement.

---

## Performance

Approximate Next dev route times from this signoff session (compile inflate called out):

| Surface | Typical after compile | Notes |
| --- | --- | --- |
| 2023 Final details `15905067` | **~490–800ms** | First hit 2.5s (compile 1.9s) |
| 2025 Final details `18447937` | **~360–940ms** | Header appears with details contract |
| 2026 Scheduled details `21717855` | **~740–900ms** | Live path unchanged |
| 2025 Timeline cold (first compile) | **2.8s** | compile 1.3s + render 910ms |
| 2025 Timeline subsequent | **~210–900ms** | `18447931` 765ms; `18446874` 901ms |
| 2025 Timeline warm | **~180–260ms** | render **56–67ms** |

Warm Timeline cache is acceptable. **No architecture change.**

---

## Browser Regression Matrix

| Fixture | Expected | Observed |
| --- | --- | --- |
| `15905067` 2023 | Final 88–106, Box, Advanced, Season Role, no Starting Five, no Timeline | Pass. Coverage without starters/Timeline. DAL @ BOS. |
| `18447937` 2025 normal | Starting Five 5+5, Box, Advanced, Season Role, Timeline | Pass. SAS 118 @ LAC 99. Nav Players/Context/Timeline/Lines. |
| `18447931` 2025 starter anomaly | No Starting Five; Timeline still available | Pass. |
| `18446874` 2025 score mismatch | Timeline warning; no unsafe flow summary | Pass. No pipeline jargon. No `Open:` on Finals. |
| `18447390` 2025 truncated | No Timeline; other modules continue | Pass. Starting Five still on. |
| `21717855` 2026 Scheduled | Live unchanged; Projected starters; no historical Advanced/Role/Timeline | Pass. Nav AI / Odds & sentiment / Matchup / Players. |

---

## Tests / Results

`npx vitest run` on Historical Explorer + no-live-BDL + navigation + MM present (shared `LineMovementChart` captions):

**18 files, 133 passed.**

Includes: 12B multi-season / historical-final, details-final-mode (BDL never called on Finals), dashboard slate, matchup-analysis-final, 12D/E Advanced, 12F Role Profile, 12G/H Timeline (+ API/S3/UI), historical explorer analytics, `trackEvent`, `market-movement-present`, `market-movement-events`.

No Historical Explorer regressions. MM present suite still green after SVG/caption polish.

---

## Files Changed

- `lib/betting/historical-final.ts` — coverage line + sticky nav IDs
- `lib/betting/__tests__/historical-final.test.ts`
- `lib/product-analytics/track-event.ts`
- `lib/product-analytics/historical-explorer-events.ts` *(new)*
- `lib/product-analytics/__tests__/historical-explorer-events.test.ts` *(new)*
- `lib/product-analytics/EVENTS.md`
- `components/betting/MatchupPageLayout.tsx`
- `components/betting/HistoricalFinalRoleProfile.tsx`
- `components/betting/HistoricalFinalTimeline.tsx`
- `components/betting/HistoricalStartingFive.tsx`
- `components/betting/LineMovementChart.tsx`
- `components/betting/Header.tsx` — hide username below `sm`
- `app/betting/games/[gameId]/components/BettingGameDetailsPageSkeleton.tsx`
- `reports/product/historical-explorer-v2-final-signoff.md`
- `reports/product/historical-explorer-v2-final-signoff.json`
- `notes/learning-log/2026-09-10/historical-explorer-v2-final-signoff.mdx`

---

## Remaining Non-Blocking Follow-Ups

1. **Dev hydration overlay** on `BettingAppShell` / Header (offseason banner / theme). Broader chrome; can intercept clicks in Next dev. Not a Historical Explorer module bug. Separate work.
2. **Explicit History navigation** — not justified for MVP (see naming).
3. **Free/Pro packaging** of Advanced / Role / Timeline — later; do not gate opening a historical game.
4. **Optional Market Context** on Finals — only if a game has certified MM rows; Props Explorer stays canonical.
5. Global overflow on **non-Final** pages if any remains after the SVG/username fixes.

---

## Historical Explorer Product Classification

### Multi-season history
**Ready.** Dashboard date → Final research for 2023–2025.

### Final correctness
**Ready.** Authoritative `analytics.games` score in the header.

### Starting Five
**Ready.** Certified 5+5 only; anomalies hide the module without live fallback.

### Box Score
**Ready.**

### Advanced
**Ready.** Game-level; low-sample values remain with MIN/Poss.

### Season Role
**Ready.** Season-level; copy and placement distinguish from Advanced.

### Timeline
**Ready.** 2025 certified games; Key Events default; independent quality gates.

### Responsive experience
**Ready** for Historical Explorer modules at 390px and desktop.

### Expected data gaps
**Ready.** Present-only coverage; absence feels normal.

### Analytics
**Ready.** Three events, privacy-safe, once-per-boundary.

**Classification:** `SHIP_READY`

---

## Naming / Navigation Recommendation

**Option A — keep it implicit.**

There is still no product named “Historical Explorer” in the UI. Users reach it by Dashboard date → Final game. That is the correct MVP. Do **not** add a History item or rename another surface in this step.

Revisit an explicit History entry later if discovery of older seasons becomes a support problem.

---

## Ranked Next Roadmap Options

| Rank | Option | Why |
| --- | --- | --- |
| **1** | **A. 2026–27 live activation readiness** | Season proximity, launch risk, and the gap between a deep historical research product and unproven current-season refresh |
| **2** | **D. Team Matchup Profile** | User-visible research depth; does not unblock opening night |
| **3** | **C. Game-odds Market Movement UI** | Sparse Opening Snapshot (~107 games); Props Explorer already owns market history |
| **4** | **B. Possession engine / WOWY R&D** | Highest technical interest, lowest launch necessity; Historical Explorer + prop MM already differentiate research |

---

## Recommended Next Major Phase

**2026–27 live activation readiness** — daily/current data feeds, Market Movement live snapshots, injuries, lineups, operational monitoring.

Reason: Historical Explorer v2 and Props Market Movement already provide significant product depth. The greater launch risk is whether Court Context reliably refreshes and serves **current-season** data once games begin.

Do **not** implement activation in 12I. Possession/WOWY should wait.

---

## Verification Checklist

1. Open `/betting/games/15905067` — coverage has no Starting Five/Timeline; Context copy says this season vs this game.
2. Open `/betting/games/18447937` at ~390px — no horizontal scroll from Explorer modules; sticky nav reaches Timeline.
3. Open `/betting/games/18447931` — no Starting Five, Timeline still present.
4. Open `/betting/games/18446874` — mismatch note, no flow summary, no pipeline codes.
5. Open `/betting/games/18447390` — no Timeline nav/section.
6. Open `/betting/games/21717855` — Projected starters + AI; no `Completed game`; no historical_game_viewed.
7. Confirm Umami (or the helper tests): viewed once per Final, player_opened only on Role select change, timeline_opened once per game.

---

## Step Verdict

`GREEN — Historical Explorer v2 is complete and ship-ready`
