# Historical Explorer v2 — Step 12A audit and design

Status: **design only**. No serving tables, no UI/API behavior changes, no Market Movement edits.

Date: 2026-09-10 (ET)

Machine-readable: `reports/product/historical-explorer-v2-audit-and-design.json`

**Step verdict:** `GREEN — Historical Explorer v2 design is implementation-ready`

Do **not** begin 12B automatically.

---

## Safety / Scope

| Guard | Result |
| --- | --- |
| Step 12A writes | reports + learning log only |
| Schema / migrations / serving tables | none |
| Explorer UI / API behavior | unchanged |
| Market Movement | unchanged |
| Game-odds Market Movement UI | not started |
| Role Check / Opportunity / WOWY / possessions | not started |
| Live ingestion | not activated |
| S3 mutation | none |
| Database writes | none (read-only SQL + visual QA) |
| Production flags | observed `DATA_MODE=replay`, offseason freeze banner on product pages |
| BDL from 12A jobs | **0** (no archive/backfill scripts) |

**Existing-product caveat (not introduced by 12A):** `GET /api/betting/games/:id/matchup-analysis` still calls `fetchLineupsFromBallDontLie` (60s cache) with **no `DATA_MODE` gate**. Visual QA of `/betting/games/21682743` exercised that live path. v2 must stop using live BDL for historical finals. 12A did not modify it.

Postgres size (read-only): **339.59 MB** (`356,084,883` bytes). Mid-330s after Market Movement; this is the current frozen DB.

---

## Current Historical Explorer

There is **no nav item, route, or product name “Historical Explorer.”** Historical browsing is split across several surfaces.

Primary nav (`components/betting/primary-nav.ts`): Dashboard, Teams, Props Explorer, Saved, Paper, Profile.

### Surfaces

| Surface | Route | Auth | Role today |
| --- | --- | --- | --- |
| Dashboard / slate | `/betting?date=YYYY-MM-DD` | session | Date prev/next. Game cards → `/betting/games/:id`. **Season-pinned slate** (`getGamesForDate`). |
| Betting game / matchup | `/betting/games/[gameId]` | session + `/api/betting/games/...` | Court Context matchup page. Live-first even when `Final`. |
| Public box score | `/games/[gameId]` | public | Header + two-team box from `analytics.player_game_logs`. Zinc/admin visual. |
| Props Explorer | `/betting/props-explorer` | session | Historical **closing lines**. Calendar slate **unpins season**. Not a game-research page. **Do not modify MM.** |
| Teams | `/teams/[teamId]?season=` | public shell | Court Context team research. Switcher = **pin + next year only**. Games → `/games/:id`. |
| Public player | `/players/[playerId]` | public | **BBRef** stats path, not BDL analytics. |
| Betting player | `/betting/players/[playerId]` | session | Pin-season trends / game log. Game log links → `/games/:id`. |
| Saved | `/betting/saved` | session | Bookmarks to Explorer / game / player. Not game-history favorites. |

### Betting game hierarchy (visual, 2025 Final `21682743` PHI @ BOS)

Client: `GameDetailsPageClient` → `MatchupPageLayout`.

Server/client split: thin server page; three client fetches (`details`, `matchup-analysis`, `player-props`).

Sticky sections: **AI Projection → Odds & sentiment → Matchup → Players → Injuries**.

Observed on a completed 2025 playoff game:

- Header: time, Final, records, “View props”
- AI Projection Summary (offseason: briefing unavailable)
- Odds & line movement (DraftKings close + `analytics.game_odds_history` chart — **not** certified Market Movement)
- **Projected starters** (not archive starters). BDL live lineup path rendered names with **0 starts / 0.0 PPG / 0.0 MPG**
- Team comparison (ORTG/DRTG/pace from **active pin**)
- Player props CTA → Props Explorer
- Injuries: **“Injury status not current”** (frozen feed)

**No box score** on this page.

### Public `/games/:id` hierarchy (visual)

1. “Matchup Analysis” defensive ranks — **empty** on 2025 and 2023 games (queries legacy `team_game_stats` / `games`, not `analytics.*`)
2. Box Score heading, teams, date, final
3. Two team tables: Player, MIN, PTS, REB, AST, STL, BLK
4. Player names link to `/players/:id` (BBRef page, not betting player)

Confirmed 2025 (`18447937` SAS @ LAC, 118–99) and 2023 Finals (`15905067` DAL @ BOS, 88–106) both render box scores from analytics logs.

### Search / filter / selectors

- Dashboard: team search, sort, favorites, close matchups, **day stepper only** (no season control, no min date)
- Team: season chips **2025–26 / 2026–27** only
- Player betting: “Season 2025” chip; empty copy: “No {activeSeason} season stats yet. Prior-season numbers are not shown here.”
- Props Explorer: date stepper + game dropdown; historical uses `scope=explorer&picker=calendar`

### Entitlements

Game/box pages are **not** gated on `advanced_history`. That feature key exists as future copy only. Betting HTML requires login. Public `/games` does not.

### Saved / favorites

Saved Research bookmarks **props**, with links to game + player + Explorer. No “favorite historical game” object.

---

## Current Data Sources

| Section | Source | Grain | Limitation |
| --- | --- | --- | --- |
| Game header (public + betting) | `analytics.games` + `analytics.teams` | game | Complete 2023–2025 finals; 2026 = 1,200 schedule rows, 0 finals |
| Box score | `analytics.player_game_logs` | player-game | Complete 2023–2025; no `started` flag (`NULL::boolean as started` in player games query) |
| Team box / four factors on team page | `analytics.team_game_stats` | team-game | Complete 2023–2025 (2,638 / 2,642 / 2,644) |
| Public “Matchup Analysis” ranks | **legacy** `team_game_stats` JOIN `games` | season | Empty in UI; wrong schema |
| Dashboard slate | `getGamesForDate` → `analytics.games` **AND season = pin** | ET date ∩ 2025 | Hides 2023–2024 dates |
| Props Explorer game list | `getGamesForCalendarDate` | ET date, no pin | Can list 2023 Finals; props empty (expected) |
| Projected starters | Live BDL `/nba/v1/lineups` **or** minutes heuristic on pin-season logs | not game-true | Not the 2025 lineup archive |
| Team ratings / pace on matchup | `getAllTeamRatings` / `getPaceAnalysis` **pin only** | team-season | Wrong season if the game is not 2025 |
| Line movement on matchup | `analytics.game_odds_history` | poll timeline | Not MM v1 |
| Player MM | `analytics.player_prop_market_movement` | 21,132 rows / **121 games** | Props Explorer only |
| Game MM | `analytics.game_odds_market_movement` | 945 rows / 107 games Mar 9–22 | **No UI** |
| Injuries | `player_injury_status_current` + `_history` | current + snapshots | History **2026-03-10 → 2026-05-06** only (4,801 rows / 57 days / 380 players). Frozen = not authoritative |
| Box-score season averages | `analytics.player_season_averages` (1,785) | player-season | **Not** GOAT playtype/tracking archive |
| Advanced | S3 `advanced_stats_v2` | player-game, 104,756 | **No serving table** |
| Lineups 2025 | S3 only | player-game listed | **No `analytics.game_starters`** |
| Season Averages (playtype/tracking/zone) | S3 targeted, 7,888 records / ~8.78 MB | player/team-season | **No serving table** |
| Plays 2025 | S3, 642,354 events | event | **No serving table** |
| Stints / roster | team pages | season roster | Not game starting five |

Product Next.js routes **do not** import `S3Storage`. S3 is scripts + prune. Explorer pages are Postgres-only today (plus the live BDL lineup fetch).

---

## Multi-Season Readiness

Read-only inventory:

| Season | Games | Finals | Player-log rows | Distinct log games |
| --- | ---: | ---: | ---: | ---: |
| 2023 | 1,319 | 1,319 | 46,090 | 1,319 |
| 2024 | 1,321 | 1,321 | 46,150 | 1,321 |
| 2025 | 1,323 | 1,322 | 46,056 | 1,322 |
| 2026 | 1,200 | 0 | 0 | — |

2025 game count includes local-only `21681993` (excluded from lineup/plays archives).

### Parameterized vs hardcoded

| Location | Behavior |
| --- | --- |
| `PINNED_ANALYTICS_SEASON` | `'2025'` |
| Dashboard `/api/betting/games?date=` | **Hard pin** — visual QA: **Jun 17, 2024 → “No games”** while `15905067` exists |
| Props Explorer historical | **Unpinned calendar** — same date lists **DAL @ BOS** |
| Team switcher | **2025 + 2026 only** (`listTeamPageSeasonChoices`) |
| `?season=2023` on team page | Resolver would accept it; **UI does not offer it** |
| Matchup ratings / projected heuristic | `getAnalyticsSeason()` |
| Public box score query | **Game id only** — 2023–2025 work |
| Betting player games | Explicit pin season |
| Cache keys | BDL lineups `['bdl-lineups', gameId]` — not season, but live HTTP |

**2026** is a schedule placeholder (0 finals). Explorer v2 should expose **2023–2025 completed seasons** and treat 2026 as empty/upcoming, not as history.

Hidden cross-season bug class: opening a 2023 game on `/betting/games/:id` still attaches **2025** ORTG/pace and **projected** (or live BDL) starters.

---

## User Story

Simplest compelling flow (authenticated Court Context):

**Season → date/game → Game Research page**

Example:

1. Dashboard date (or team 2025–26 schedule) → **Knicks @ Celtics, April 18, 2026** (or any Final)
2. Game Research answers, in order:
   - What was the final?
   - Who started? (2025 only)
   - Who produced? (box)
   - How efficient / usage-heavy was that night? (compact Advanced)
   - What is this player’s **season** role? (labeled season context)
3. Click player → betting player page **scoped to that game’s season**

Do **not** dump GOAT into one warehouse page. Do **not** make Props Explorer the game-history surface.

Canonical URL: **`/betting/games/:gameId`** for signed-in research. When `status` is Final, the page becomes historical research (not a live betting ticket). Public `/games/:id` stays a thin unauthenticated box score until a later redirect — **not** a v2 prerequisite redesign.

Entry: fix Dashboard historical dates (same calendar helper Explorer already uses). No new top-level “Historical Explorer” nav item in MVP.

---

## Proposed Information Hierarchy

Reuse the existing sticky section nav, remapped for Finals:

| Tab / section | Contents | When |
| --- | --- | --- |
| **Overview** | Game header (teams, date, final, venue/status). Starting five if certified. Key performances (top PTS/REB/AST from logs). | Always |
| **Players** | Full box score (existing PGL columns + FG/3P/FT if we already store them; public page currently shows a subset). | Always |
| **Context** | Compact Advanced (this game). Season Role Profile (explicitly season-grain). Team season/matchup profile. | Hide module if missing |
| **Timeline** | 2025 Key Events; full PBP expand. | v2.1 |

Do not ship seven stacked giant cards. Odds/AI/Injuries stay on **upcoming/live** games; on Finals they collapse or drop below Context so they do not dominate historical research.

Recommended Overview order:

1. **A. Game Header**
2. **B. Starting Five** (2025 certified only)
3. **C. Box / key lines** (then full table on Players)
4. **D. Advanced** (this game)
5. **E. Role Profile** (season)
6. **F. Market Context** — v2.1, optional card
7. **G. Timeline** — v2.1

---

## Starting Five

Archive: 1,322 games / 28,833 listed rows / **1,320 / 1,322** valid 5+5. Anomalies **`18447931`**, **`18447988`** (team `10`, four starters).

**Display**

- Two columns: away / home. Five names each.
- Show lineup `position` plus `analytics.players` name.
- Link to `/betting/players/:id?season=<game.season>&from=explorer&game_id=`
- Label: **Starting five** (not “projected”, not “active roster”).
- Do **not** imply inactive / DNP / active bench.

**Listed non-starters:** do **not** serve in MVP. They are not a clean bench; the endpoint cannot certify DNP vs inactive. Optional later expand “Listed on lineup sheet” with that disclaimer.

**Anomalies:** hide the module. Copy: “Starting five is not certified for this game.” Not a system error.

**Serving:** **Option A — `analytics.game_starters`**

- Grain: `game_id + team_id + player_id`
- Only `starter = true`
- Exclude (or flag and omit from default query) the two anomaly games
- ~13,220 rows, position + maybe sort order
- Do **not** create in 12A

Option B (S3 at request) adds latency and AWS coupling to every game page. Option C (embed flag on PGL) widens a 138k-row table for ~13k facts and still needs 2023/2024 null handling. A compact starters table is the right serving object for ~13k rows and future live ingestion.

12B may **stop live BDL lineup fetch on historical Finals** before 12C materializes starters (show empty/hide rather than 0.0 PPG live names).

---

## Advanced Context

S3 rows: 2023 34,843 · 2024 35,103 · 2025 34,810 · **104,756** total. Provider keys from market-intelligence scan.

### Explorer-useful (this game, compact)

| Field | Why |
| --- | --- |
| `usage_percentage` | Role/volume that night |
| `true_shooting_percentage` | Efficiency |
| `effective_field_goal_percentage` | Shot quality |
| `offensive_rating` | On-court offense |
| `defensive_rating` | On-court defense |
| `net_rating` | Combined |
| `pace` | Environment |
| `possessions` | Sample size / hide low-poss outliers |
| `assist_percentage` | Creation |
| `rebound_percentage` | Board role |
| `turnover_ratio` | Care of ball (actual field name, not a invented TOV%) |
| `pie` | One-number impact |

Minutes: **not** in the Advanced key list — use `player_game_logs.minutes`. Prefer `usage_percentage` over `estimated_usage_percentage` unless the official field is null (then omit, do not silently swap without a label).

Show 4–6 chips on Overview (USG, TS%, eFG%, NET) and the rest on Context. Do not dump the 80+ key schema.

### Role Check later

`assist_ratio`, `assist_to_turnover`, `four_factors_*`, `pct_assisted_*` / `pct_unassisted_*`, `pct_pts_*`, `touches`, `passes`, paint/fast-break points.

### Research-only / do not serve

`switches_on`, `matchup_minutes`, entire `matchup_*` block, hustle box-out/deflection clusters, speed/distance until characterized for product.

---

## Role Profile / Season Averages

Targeted S3 archive is **season-grain**. UI must say **“2025–26 season role”** (or the game’s season), never “in this game.”

Player (Explorer Context, behind expand):

- Isolation / PnR ball handler / roll man: `poss_pct`, `ppp` (hide if player did not qualify — ~40–53% playtype coverage)
- Drives / passing volume (~96% of log players)
- `by_zone` shot profile (~96%)

Team (same tab, matchup column):

- Opponent `by_zone_opponent`
- Team isolation
- Team possessions / style

`gp` on play types is **qualifying games**, not season GP — do not label it as games played.

Shared later with Role Check: a wide **`analytics.player_role_profile`** (`player_id + season`) plus a small **`analytics.team_role_profile`** (`team_id + season`) is the right shared abstraction. Do **not** duplicate pipelines. Do **not** create them in 12A. Normalized category rows match raw S3 but make product queries worse. S3 on demand is wrong for a chip row on every player in a box.

Postgres already has box-score `player_season_averages` — keep that separate; do not overload it with Synergy/tracking.

---

## Plays / Timeline

2025 only. 642,354 events. Score exact **1,302 / 1,322**. Rotation GOOD **1,284**.

### Separate gates

**Timeline eligible** — game has a usable chronological Plays object. Do **not** drop a game from timeline solely because rotation reconstruction failed.

**Score-exact subset (1,302)** — default Key Events may treat Plays scores as aligned with `analytics.games`. Header always uses official `analytics.games` scores.

**Score-mismatch list (20)** — still timeline-eligible with a scoped note (“Play-by-play scoring does not match the official final”). Do not use Plays to overwrite the header. IDs:

`18446874`, `18446876`, `18446885`, `18446886`, `18446941`, `18447009`, `18447024`, `18447157`, `18447188`, `18447236`, `18447292`, `18447388`, `18447389`, `18447390`, `18447432`, `18447741`, `18447742`, `18447470`, `18447953`, `21709227`

**Rotation-context eligible (1,284)** — required for on-court / WOWY later, **not** for v2 Key Events. Failure IDs (36):

`18446876`, `18446886`, `18446930`, `18446957`, `18446964`, `18446979`, `18446994`, `18447007`, `18447009`, `18447019`, `18447074`, `18447087`, `18447330`, `18447390`, `18447432`, `18447480`, `18447498`, `18447684`, `18447700`, `18447720`, `18447721`, `18447738`, `18447741`, `18447742`, `18447743`, `18447752`, `18447761`, `18447799`, `18447802`, `18447817`, `18447827`, `18447831`, `18447844`, `18447908`, `18447928`, `18448017`

Classes: 27 `MISSING_PARTICIPANT`, 5 `BOTH_OFF_COURT`, 4 `BOTH_ON_COURT`. Do not repair.

### Timeline UX (v2.1)

Default **Key Events**: period start/end, scoring that changes the lead or a 6+ run, substitutions of listed starters, last 2:00 of Q4/OT. Not 500 raw rows.

**Full play-by-play** behind expand/filter (period, scoring only, substitutions).

Shot-coordinate sentinels (~20.9%): no shot chart in MVP/v2.1 unless we explicitly drop sentinels.

### Derived without possessions

Straightforward from Plays: largest lead, lead changes, ties, scoring runs, quarter scoring, clutch score path, substitution list, event timeline.

Possession-dependent (out of scope): five-man stints, WOWY, true PPP, lineup net rating from reconstructed states.

---

## Market Context

Props MM v1 is **SHIP_READY** on Props Explorer. Coverage: **121 games**, 2025 window, 3-Hour Pre-Tip → Close.

Game Opening Snapshot: **107 games, Mar 9–22 2026 only**.

**Recommendation: v2.1**, not MVP.

- Do not layout-depend on MM.
- If shown: one optional “Market context” card linking to existing Props Explorer + `MarketMovementSection` for that player-game when a v1 row exists.
- Do not build game-odds MM UI in Explorer.
- Empty: hide the card.

---

## Injury Context

Current matchup page already refuses frozen rows (“Injury status not current”). History is a **57-day 2026** slice, not 2023–2025 as-of.

**Do not include injury state in Explorer v2.** Do not present snapshots as “status at tip.” Opportunity Check stays separate. Leave-report / as-of model remains a later step.

---

## Coverage Metadata

One **header coverage line**, not a badge on every card.

Examples:

- 2023–24 / 2024–25: `Box score · Season role · Advanced` (no starters, no timeline)
- 2025–26: `Box score · Starting five · Season role · Advanced` + `Timeline` when v2.1
- Market: never in the header as if season-wide; only on the optional card (“Available for this game”)

2026 schedule games: upcoming layout, not historical modules.

---

## Empty-State Strategy

| Case | Behavior |
| --- | --- |
| 2023/2024 no lineup | **Hide** Starting five |
| No Plays | **Hide** Timeline |
| Advanced row missing | Hide chips; no error |
| Playtype non-qualifier | Hide that role row; keep drives/zone if present |
| No MM | Hide market card |
| Injury uncertain | Hide (v2 omits injuries) |
| Dashboard date with no games in **unpinned** query | “No games on this date” (true empty) |
| Today’s pin-filtered empty on a date that has other-season games | **Bug** — 12B must stop this |

Optional modules never look like 500s.

---

## Serving Architecture

| Object | Decision | Why Postgres vs S3 |
| --- | --- | --- |
| Box / games / team stats | **Existing PG** | Already compact serving |
| `analytics.game_starters` | **New, 12C** | ~13k rows; every historical 2025 game; live ingest later |
| Compact Advanced (`game_id+player_id`, ~12 metrics) | **New, 12D** | 104k rows, hot path; S3 per player in a box is N+1 latency |
| `player_role_profile` / `team_role_profile` | **New, 12F** | ~1.8k + 90 rows; shared with Role Check |
| Plays full events | **S3 only** | 642k events; no cross-game SQL in v2 |
| Compact `game_flow` summary | **Optional 12G** | ~1,322 rows of derived Key Event indexes; full PBP still S3 |
| MM | **Existing PG** | Reuse; do not copy |

**Do not** copy raw Advanced or raw Plays JSON into Postgres.

---

## API Architecture

Current: no `/api/history/*`. Betting game uses three endpoints. Public box is RSC `getGameBoxScoreFromAnalytics`.

Recommended smallest future contract (implement in 12B, **existing tables only**):

`GET /api/history/game/:gameId`

- `overview` (game, teams, scores, season, venue/status)
- `playerPerformances` (PGL box)
- `availability`: `{ starters, advanced, roleProfile, timeline, market }` all false until later steps flip them
- `coverage` labels

Heavier, later:

- `GET /api/history/game/:gameId/advanced`
- `GET /api/history/game/:gameId/timeline`
- Role can ride the main payload once the table is tiny

Keep `/api/betting/games/:id/details` for **live/upcoming** odds+AI. Do not keep stuffing history into it.

Auth: same session as other betting APIs. Public `/games` can keep using RSC until a public subset is decided.

---

## S3 Access Strategy

`lib/aws/s3.ts` (`S3Storage`) is used by **scripts and prune**, not `app/` product routes. `.env.example` documents `NBA_DATA_BUCKET` + AWS for prune verification. Vercel product runtime is **not** currently an Explorer S3 reader.

Rule for v2:

- **Hot path** (header, box, starters, advanced chips, role chips) → Postgres
- **Cold path** (full PBP) → server-side S3 GetObject **one object per game**, cache (ISR/Redis/unstable_cache by `game_id`), never from the browser
- Do not add a new S3 abstraction in 12A–12F
- 12G may add a thin `readPlaysGameObject(gameId)` next to existing archive helpers

Prefer materializing compact Advanced/role/starters over on-demand S3 for those.

---

## Postgres Storage Estimates

Current DB **339.59 MB**. `player_game_logs` ~35 MB; MM ~12 MB.

| Proposed object | Rows (order) | Approx heap + indexes | Notes |
| --- | --- | ---: | --- |
| `game_starters` | ~13,220 | **< 2 MB** | Yes PG |
| Compact Advanced | 104,756 × ~12 floats + 3 keys | **~20–30 MB** | Yes PG; still << raw Advanced dump |
| `player_role_profile` | ~1,785 | **< 3 MB** | Opinionated wide row |
| `team_role_profile` | ~90 | **< 1 MB** | |
| `game_flow` summaries | 1,322 | **< 5 MB** | JSONB key-events optional |
| Raw Plays in PG | 642,354 | **Do not** | Tens–hundreds of MB + indexes |

Any proposal copying hundreds of MB of raw provider JSON into Postgres is rejected.

---

## Free / Pro Recommendation

**No new paywall in v2 MVP.** Goal is a clearly useful historical game page.

| Free | Later Pro (`advanced_history` already reserved) |
| --- | --- |
| Multi-season nav, header, box, starting five | Compact Advanced, Role Profile depth, Timeline filters, MM card |

Do not gate the box score. Do not implement entitlements in 12A–12C.

---

## Historical Explorer v2 MVP

Firm set (obvious upgrade over today):

1. **Multi-season 2023–2025 navigation** (Dashboard unpinned historical dates; team chips 2023–2025; 2026 remains placeholder)
2. **Game header / official final** on `/betting/games/:id` when Final
3. **Starting five when certified** (after 12C serving)
4. **Box score / player performance** from existing logs (missing on the betting game page today)
5. **Selected Advanced** (after 12D/12E)
6. **Selected season Role Profile**, clearly labeled (after 12F)

Also in MVP engineering (not a seventh feature): **stop live BDL lineup fetch on historical Finals**; season-scope matchup analytics to **the game’s season**.

Not in MVP: Timeline, MM card, injuries, shot charts, WOWY, listed non-starters, public `/games` visual redesign, new nav label.

---

## v2.1 Follow-Ups

7. Market Movement contextual card / link (121 games only)
8. 2025 Key Events timeline + optional full PBP (S3 + compact flow)
9. Optional public `/games` → betting game redirect for signed-in users
10. Game-odds MM remains **out** until a dedicated game-odds step

---

## Recommended First Implementation Slice

### 12B — Multi-season correctness + base historical game contract

Unlocks 2023–2025 without new tables.

- Dashboard historical `date=` uses the same unpinned calendar query as Props Explorer (`getGamesForCalendarDate`) for dates before today ET
- Team season choices: 2023, 2024, 2025, plus 2026 placeholder
- `GET /api/history/game/:gameId` from **existing** `analytics.games` + `player_game_logs` + availability flags (all optional modules false)
- Final games on `/betting/games/:id`: Overview + Players (box); do not show 0.0 PPG live BDL “projected starters” as if they were that night’s five
- Season-scope ratings/pace from **game.season**, or hide team comparison on historical if pin-only code remains
- Player links from the new box → `/betting/players/:id` with `season=` of the game
- Tests for pin vs calendar; no schema

This is the dependency that prevents 12C–12F from painting 2025 context onto 2023 games.

---

## Controlled Implementation Sequence

| Step | Work | Reviewable alone |
| --- | --- | --- |
| **12B** | Multi-season nav + `/api/history/game/:id` + Final overview/box on betting game page; stop historical live BDL lineups | Yes — existing PG only |
| **12C** | `game_starters` migration + backfill from S3 + Starting five UI + anomaly hide | Yes |
| **12D** | Compact Advanced serving table + backfill (selected fields only) | Yes — no UI required |
| **12E** | Advanced chips/context UI + empty hide | Yes |
| **12F** | Role profile serving + season-labeled UI (shared contract for future Role Check) | Yes |
| **12G** | Timeline read model: S3 per-game + optional `game_flow`; quality flags | Yes — no UI |
| **12H** | Key Events + full PBP expand | Yes |
| **12I** | Optional MM card + coverage-line polish + events | Yes — no MM math changes |

Each step stays offseason/replay; no live ingestion; no WOWY.

---

## UI Direction

Incrementally apply Court Context on the **betting game page** (hierarchy, type, whitespace, one editorial header). Do not require a global redesign or a zinc `/games` restyle to ship 12B.

Avoid admin-dashboard density: four sections, not seven always-on cards.

---

## Analytics Recommendation

Do **not** instrument in 12A. Later (12I), reuse `trackEvent` / Umami no-op helper:

| Event | When |
| --- | --- |
| `historical_game_viewed` | History contract rendered for a Final (`game_id`, `season`) |
| `historical_player_opened` | Player link from history box/starters (`game_id` only, no names) |
| `historical_timeline_opened` | User opens Timeline / full PBP (v2.1) |

No extra taxonomy. No PII.

---

## Risks / Open Questions

Ranked:

1. **Season hardcoding** — Dashboard empty on 2023–2024; matchup analytics pin-scoped. **12B.**
2. **Mixing season-level Role with game performance** — labeling failure. **12F copy.**
3. **Live BDL lineup fetch on game pages** — HTTP + fake 0.0 PPG starters. **12B hide / 12C replace.**
4. **Explorer density** — live odds/AI on a Final bury the box. **12B layout.**
5. **Dual URLs** (`/games` vs `/betting/games`) — box exists on the worse visual. Canonical = betting page; public box remains. Resolved in this design.
6. **S3 latency** if someone serves Advanced/Plays live. Mitigate by compact PG + one-object PBP.
7. **Starter coverage 2025-only** — hide, don’t fake 2023 fives from minutes.
8. **Plays quality** — 20 score mismatches / 36 rotation fails; separate gates.
9. **Advanced schema breadth** — stick to the compact list.
10. **MM coverage gaps** — v2.1 optional card only.
11. **Duplicated Role Check logic** — one `player_role_profile` later.
12. **Injury as-of** — omit.

Open question (non-blocking): whether 12B adds a History nav item. **Recommend no** until Dashboard dates work.

---

## What 12A did not do

- Did not call BDL from archive/backfill jobs
- Did not change Production flags, schemas, serving tables, Explorer UI, or Explorer API behavior
- Did not materialize Advanced, lineups, Season Averages, or Plays into Postgres
- Did not build possessions/WOWY/Opportunity/Role Check
- Did not extend Market Movement
- Did not start 12B

Visual QA used the existing local app (including the pre-existing lineup HTTP path).

---

## Verification Checklist

1. Confirm Dashboard `/betting?date=2024-06-17` still shows **No games** (pin bug; 12A did not fix it).
2. Confirm `/games/15905067` still shows DAL @ BOS box (88–106).
3. Confirm `/betting/props-explorer?date=2024-06-17` game dropdown includes **DAL @ BOS** and empty closing-line copy.
4. Confirm `/betting/games/:finalId` still shows live-first sections + projected starters (12A did not change it).
5. Confirm team page `/teams/2` chips are only **2025–26 / 2026–27**.
6. Confirm `analytics.game_starters` / Advanced / role serving tables still **do not exist**.
7. Read this report’s MVP vs v2.1 split before approving **12B only**.

---

## Step Verdict

**GREEN — Historical Explorer v2 design is implementation-ready**

Direction is determinate: reuse `/betting/games/:id` for Finals, fix multi-season access first, compact PG for starters/Advanced/role, S3 for Plays, MM and timeline in v2.1. Serving choices are made (Option A starters; no raw 642k-event table). First slice is 12B.

STOP. Do not begin implementation automatically.
