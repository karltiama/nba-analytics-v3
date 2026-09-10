# Historical Explorer v2 — Step 12H Timeline UI

**Step verdict:** `GREEN — Historical Timeline v1 is ship-ready`

**Product classification:** `SHIP_READY`

**Date:** 2026-09-10  
**Scope:** 2025 historical Final → Timeline section → Key Events default + Full Play-by-Play secondary. Certified Step 12G read model only. No possessions, WOWY, rotation charts, Market Movement overlays, or live PBP.

STOP after this step.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| BDL HTTP | **0** |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| DB mutations | **none** |
| S3 writes | **none** |
| Raw Plays in Postgres | **none** |
| Possession / WOWY / shot map | **not started** |
| Lineup/stint / rotation charts | **not added** |
| Market Movement overlay | **not added** |
| Injury Timeline | **not added** |
| Live PBP ingestion | **unchanged** |
| Analytics instrumentation | **not added** |
| Global page redesign | **not done** |

Certified 12G counts preserved:

| Fact | Value |
| --- | --- |
| Plays objects | **1,322** |
| Timeline available | **1,319** |
| Truncated / hidden | **3** (`18446876`, `18447389`, `18447390`) |
| Score reconciled | **1,302** |
| Chronology-usable score mismatches | **17** |
| Rotation quality | independent |
| Official Final | always `analytics.games` |
| Chronology | always `order`, not clock |
| 2023 / 2024 / 2026 historical Timeline | **none** |

Availability is `availability.timeline` only. Never `season === 2025`.

---

## Timeline Placement

Historical Final hierarchy is now:

1. **Overview** — Final header + Starting Five when certified
2. **Players** — Box Score \| Advanced
3. **Context** — Season Role
4. **Timeline** — Game chronology (own section, `id="section-timeline"`)
5. **Lines** — stored sportsbook lines when present

Timeline is **not** inside Advanced or Context.

Sticky nav adds **Timeline** only when `shouldShowHistoricalTimeline(availability)` is true (`availability.timeline === true`). Truncated, 2023, 2024, and 2026 pages have no Timeline nav item and no Timeline region.

---

## Lazy Loading / Cache

Initial Final details payload does **not** include `events` or `keyEvents` (asserted in `details-final-mode`).

One-game reads reuse `getHistoricalGameTimeline` via:

`GET /api/betting/games/[gameId]/timeline`

Auth: `requireBettingAuth` (same as details).

Fetch starts when the section intersects the viewport (`rootMargin: 240px`) **or** when sticky nav `activeSection === 'section-timeline'`.

On unexpected read failure the route returns **200** with `{ available: false, error: 'TIMELINE_UNAVAILABLE', events: [], keyEvents: [] }` so the rest of the Final page is unaffected. No aggressive retry.

Immutable cache:

- Next `unstable_cache` keyed `['historical-timeline-v1', gameId]`, `{ revalidate: false }`
- Existing process LRU (max 48) remains as an in-runtime helper
- No Redis / distributed cache

Observed route times (dev, after compile):

| Game | Timeline GET |
| --- | --- |
| `18447937` (cold compile) | 2.8s (compile 1.3s + render 910ms) |
| `18446819` | 1104ms |
| `18446930` | 845ms |
| `18447931` | 765ms |
| `18446874` | 901ms |
| truncated / 2023 / 2024 / 2026 | **no Timeline request** |

---

## Key Events

Default view: **Key Events** (`HISTORICAL_TIMELINE_VIEW_DEFAULT = 'key'`). Full PBP is not the initial view.

Classification uses certified `isKeyTimelineEvent` on the server (`toHistoricalTimelinePayload`). React does not reimplement it.

Includes: period boundaries, lead changes, ties, late-Q4 scoring, OT scoring.

Does **not** use the word Clutch. No importance score. No arbitrary cap.

Typical Key Event vs total event counts (real games, browser + prior 12G reads):

| Game | Full events | Key Events | Notes |
| --- | --- | --- | --- |
| `18447937` | 467 | **18** | regulation |
| `18446819` | 595 | **65** | 2OT (all OT scoring is key) |
| `18446930` | 521 | **40** | rotation failure; Timeline still on |
| `18447931` | 489 | **18** | starter anomaly |
| `18446874` | 464 | **38** | usable score mismatch |
| `18447390` | 0 | 0 | truncated; hidden |

Regulation Key Events are typically a short editorial list (~4% of PBP). 2OT is denser because every OT score is key.

---

## Full Play-by-Play

Renders the normalized event contract only: period, clock, description, team when present, server-enriched player names, running score when present, normalized category for restrained styling.

Canonical `order` is preserved. The list is **not** re-sorted by clock.

Same-clock example on `18447937`: `4:59` free throws 1 of 2 then 2 of 2; `6:57` three substitutions in source order; `40.6` layup then and-1 FT.

Raw provider JSON (`coordinate_x`, `pages`, etc.) is not in the payload.

Administrative / null-team / null-player events stay unlabeled. No “Unknown Player”. No fake home/away assignment.

---

## Game-Flow Summary

Shown only when `timelineAvailable && scoreReconciled`. Four compact stats from certified `game_flow` (no client recompute):

- Lead changes
- Ties
- Largest lead
- **Largest unanswered run** (not possession run / momentum)

Period-score strip omitted to keep the section restrained.

`18447937`: Lead changes 2 · Ties 1 · Largest lead LAC 3 · SAS 26 · Largest unanswered run LAC 7 · SAS 11.

---

## Score-Mismatch UX

Usable A-class mismatch `18446874`:

- Timeline visible (38 Key Events)
- Warning text: *Play-by-play scoring differs from the official final. Event order is preserved; the final score above remains authoritative.*
- Copy does not say corrupt/broken
- Derived summaries **hidden** (no lead-change / tie / largest-lead / run strip)
- Header / subtitle keep official `analytics.games` scores (`111–121` away–home). Last PBP score does not overwrite the Final header.

---

## Truncated UX

`18447390` (and the other two certified truncated IDs): `availability.timeline === false`.

Preferred behavior used: **Timeline hidden entirely**. No nav item, no region, no S3 fallback, no incomplete stream.

Unavailable copy exists for unexpected read errors: *Play-by-play timeline unavailable for this game.*

---

## Substitution Semantics

Provider substitutions are not labeled IN/OUT.

UI uses `formatSubstitutionCopy`: **Substitution — Player A / Player B**.

Observed on `18447937` Full PBP: `Substitution — Dylan Harper / Luke Kornet` (and siblings at the same clock). Provider “enters the game for” text is ignored.

No rotation charts.

---

## Responsive / Accessibility

**Desktop:** editorial vertical timeline fits the existing Final column. Scoring gets slight emphasis; period rows are stronger; categories are text labels, not color-only.

**~390px:** Timeline section itself does **not** overflow (`section` 358px inside 390px client). Clocks ~52px, descriptions `break-word`, Key Events / Full PBP tabs ~162px each and remain usable, period `h3` headings stay clear. Full PBP vertical length is acceptable.

Page-level ~40px overflow on mobile is **pre-existing** (header account chip + stored-odds SVG), not the Timeline list. Not fixed in 12H.

A11y:

- Tabs expose `aria-selected`
- Period headings are `h3`
- Category text accompanies color markers (`aria-hidden` dots)
- Mismatch warning is real text (`role="note"`)
- Loading / error use `role="status"`
- Isolated loading does not block header, Starting Five, Box, Advanced, or Season Role

---

## Performance

Lazy one-game S3 read + name join is the cost. Details payload stays small.

Repeat hits for the same `game_id` in-process use the LRU; Next `unstable_cache` is the immutable HTTP-layer cache. First-game compile in `next dev` inflated the first sample (2.8s); subsequent games were 765–1104ms.

No Redis. No 642k-event Postgres table.

---

## Real-Game Verification

| Fixture | Result |
| --- | --- |
| `18447937` regulation | Timeline on; Key Events default (18); Full PBP 467; official SAS 118 @ LAC 99 authoritative |
| `18446819` 2OT | Q1–Q4, **OT**, **2OT** headings; 65 Key Events; official HOU 124 @ OKC 125 |
| `18446930` rotation failure | Timeline on (40 Key Events); **no** rotation UI |
| `18447931` starter anomaly | Starting Five hidden; Timeline on (18 Key Events) |
| `18446874` usable mismatch | Timeline on; warning on; derived summaries off; official score stays |
| `18447390` truncated | No Timeline section / nav / fetch |
| `15905067` 2023 | No Timeline; Box / Context remain |
| `18444564` 2024 | No Timeline; Box / Context remain |
| `21717855` 2026 scheduled | No historical Timeline; live Matchup / AI Projection / odds unchanged |

Dev-only Next overlay on historical pages points at **pre-existing** `Header.tsx` hydration, not Timeline.

---

## Tests Added

`lib/betting/__tests__/historical-timeline-ui.test.ts`

- Availability: flag true visible; 2023/2024/2026/truncated hidden via `timeline: false`
- Mode: Key Events default
- Key Events: period, tie, lead change, late-Q4, OT; ordinary event omitted from Key, present in Full
- Ordering: same-clock canonical `order`; OT / 2OT labels
- Score mismatch: warning copy; summaries hidden when unsafe
- Substitution: no invented IN/OUT
- Isolated error copy

`lib/betting/__tests__/historical-timeline-api.test.ts`

- Auth required
- Normalized payload + `keyEvents`; no raw JSON
- Isolated 200 on throw
- Cache key / `revalidate: false` / no BDL / no S3 writes

`details-final-mode.test.ts` — details body has no `events` / `keyEvents`.

---

## Test Results

```
Test Files  20 passed (20)
     Tests  129 passed (129)
```

Suites: timeline UI/API/domain/S3, details-final-mode, historical-final + seasons, Starting Five, Advanced, Season Role, matchup-analysis-final, research-journey, market-movement-present, dashboard-historical-slate, game-starters-schema, game-flow-schema, player-role-profile.

Unrelated repo-wide noise not chased. Expected stderr on the isolated S3-throw API test.

---

## Files Changed

- `lib/betting/historical-timeline-format.ts` — presentation helpers, Key Event payload, mismatch/unavailable copy, substitution copy, game-flow summary
- `app/api/betting/games/[gameId]/timeline/route.ts` — lazy auth’d read + `unstable_cache`
- `lib/betting/historical-timeline-server.ts` — cache policy comment (`next-unstable-cache-plus-process-lru`)
- `components/betting/HistoricalFinalTimeline.tsx` — Timeline section UI
- `components/betting/MatchupPageLayout.tsx` — sticky nav + section after Context
- `lib/betting/__tests__/historical-timeline-ui.test.ts`
- `lib/betting/__tests__/historical-timeline-api.test.ts`
- `lib/betting/__tests__/details-final-mode.test.ts`
- `lib/betting/__tests__/game-flow-schema.test.ts`
- `reports/product/historical-explorer-v2-timeline-ui.md`
- `notes/learning-log/2026-09-10/historical-explorer-v2-timeline-ui.mdx`

---

## Remaining Follow-Ups

Non-blocking:

- Measure warm `unstable_cache` hit latency in production (dev first-compile inflated)
- Pre-existing Header hydration overlay
- Pre-existing mobile overflow from header username + odds SVG (not Timeline)
- Product-analytics events for Timeline (explicitly out of 12H)
- Optional period-score strip if we later want it on reconciled games only

Do **not** start possessions, WOWY, or live PBP as a silent follow-up.

---

## Product Classification

`SHIP_READY`

Timeline is clear and reliable for its certified scope: eligible 2025 Finals only, Key Events default, quality-safe mismatch/truncated behavior, official score remains `analytics.games`.

---

## Recommended Next Roadmap Step

**Historical Explorer polish / signoff** — not possession-engine R&D, and not 2026–27 live activation.

The historical Final now has Starting Five, Box, Advanced, Season Role, and Timeline. That is a complete reading product. Possession / WOWY is a new analytics engine with independent quality risk; live PBP is a different ingestion problem and the platform is in offseason freeze. Stop feature expansion, polish the Explorer (hydration, mobile header/odds overflow, cache/perf, copy QA), then sign off before deeper analytics.

Do not implement that next step in this PR.

---

## Verification Checklist

1. Open `/betting/games/18447937` — Timeline in sticky nav after Context; Key Events default; official 118–99 stays in the header.
2. Switch to Full Play-by-Play — ~467 events, same-clock order preserved, substitutions read “Substitution — A / B”.
3. Open `/betting/games/18446819` — OT and 2OT headings present.
4. Open `/betting/games/18446874` — mismatch warning visible; lead/tie/run summary hidden.
5. Open `/betting/games/18447390` and a 2023/2024 Final — no Timeline nav or section.
6. Open `/betting/games/21717855` — live Matchup/AI/odds unchanged; no historical Timeline.
7. Confirm header, Starting Five, Box, Advanced, and Season Role still render while Timeline is loading.

---

## Step Verdict

`GREEN — Historical Timeline v1 is ship-ready`
