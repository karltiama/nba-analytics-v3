# Historical Explorer v2 — Step 12B multi-season historical base

Date: 2026-09-10 (ET)

Machine-readable: `reports/product/historical-explorer-v2-multiseason-base.json`

Source of truth preserved: `reports/product/historical-explorer-v2-audit-and-design.md` (Step 12A).

**Step verdict:** `GREEN — multi-season historical base is correct and ready for certified starters`

Do **not** begin Step 12C automatically.

---

## Safety / Scope

| Guard | Result |
| --- | --- |
| BDL HTTP caused by this implementation | **0** (no new BDL clients; Finals skip `fetchLineupsFromBallDontLie` and skip `matchup-analysis`) |
| `DATA_MODE` | observed product still `replay` (offseason banner on QA pages) |
| `OFFSEASON_MODE` / `CRON_DRY_RUN` | not flipped; no cron jobs run |
| S3 writes | none |
| Serving-table migrations | none |
| `analytics.game_starters` | **not created** |
| Lineup / Advanced / Season Average backfill | none |
| Plays / PBP / timeline | none |
| Market Movement | unchanged (regression tests passed) |
| Role Check / Opportunity / WOWY | none |
| History nav item | none |
| New `/history` route | none |
| Public `/games/:id` | unchanged |
| New analytics events | none (`historical_game_viewed` still reserved) |

Upcoming/live pages may still call the **pre-existing** BDL lineup path. That is not a 12B introduction.

---

## Historical Dashboard Fix

**Defect:** `/betting?date=2024-06-17` used `getGamesForDate` (pinned to the active analytics season) and returned **No games** while Final `15905067` existed.

**Fix:** Dashboard `?date=` (non-explorer) uses `loadDashboardGamesForEtDate`:

- ET date **strictly before today ET** → `getGamesForCalendarDate` (unpinned)
- today / future → `getGamesForDate` (season pin retained so 2026 placeholder schedule does not leak onto the live slate)

Explorer calendar path is unchanged.

**Certification (browser, logged in):** `/betting?date=2024-06-17`

- Heading: Games for Mon, Jun 17, 2024
- **1 game:** DAL @ BOS, FINAL, **88 – 106**
- False “No games” is gone
- View matchup href: `/betting/games/:id` (`gameDetailHref`)

Historical Dashboard skips pin-season ratings, defensive ranks, and per-team L5 form so 2025 ORTG/W-L is not painted onto 2023/2024 cards. Odds batch still runs.

**Remaining Dashboard chrome (not blocking 12B):** the trending-player strip and “Betting Model Insights” widgets on `/betting` are still pin-season even on a historical date. Game cards themselves are calendar-correct.

---

## Season Resolution

Authoritative `gameSeason` is `analytics.games.season` for the requested `game_id`.

It is returned on Final details as `gameSeason` and `game.season`, and drives Court Context player links (`season=`).

Do **not** use `getAnalyticsSeason()` / `PINNED_ANALYTICS_SEASON` for historical Final rendering.

| Fixture | DB season | UI season label (QA) |
| --- | --- | --- |
| `15905067` DAL @ BOS | `2023` | 2023–24 |
| `18444564` IND @ OKC | `2024` | 2024–25 |
| `18447937` SAS @ LAC | `2025` | 2025–26 |
| `21682743` PHI @ BOS | `2025` | 2025–26 |

---

## Final-Game Mode

Distinction is **authoritative game status** (`isFinalStatus` / `isHistoricalFinalView`), not calendar date.

| Mode | `viewMode` | Surface |
| --- | --- | --- |
| Final | `final` | Overview + box primary; live research modules hidden |
| Upcoming / live | `live` | Existing AI → Odds → Matchup → Players → Injuries |

Client: if `viewMode === 'final'`, **do not** fetch `matchup-analysis` or `player-props`.

---

## Live-Lineup Removal on Finals

Dual guard:

1. **Server:** `getMatchupAnalysis` returns empty lineups **before** `unstable_cache(fetchLineupsFromBallDontLie)` when status is Final.
2. **Client:** Final details skip the matchup-analysis HTTP hop entirely.

Projected starters / 0.0 PPG placeholders are **not rendered** in Final mode. No fabricated historical starters. 12C owns Starting five.

---

## Final Header

From `analytics.games` (not Plays, not player-log sums):

- Away / home abbreviations
- ET date
- Final status
- Official scores
- Season chip (`formatNbaSeasonLabel(gameSeason)`)

QA `15905067`: `2024-06-17` · Final · 2023–24 · DAL **88** @ BOS **106**.

---

## Box Score Integration

Existing Postgres: `analytics.player_game_logs` JOIN `analytics.players`.

Columns: MIN, PTS, REB, AST, STL, BLK.

Grouped by **game-night `pgl.team_id`** vs the game’s home/away IDs. Rows that match neither side are dropped (traded-player safety). Never infer current roster team.

Component: `HistoricalFinalBoxScore` (Court Context styling). Public `/games/:id` left in place as the proof path; logic is not copied from Zinc.

If logs are missing: header still renders; scoped “Box score is not available” state. Page does not 404.

Player links: `/betting/players/:id?from=explorer&date=&game_id=&season=` (canonical Court Context). No new player page. No public `/players/:id` from this box.

---

## Odds / AI / Injury Behavior

### Odds (decision)

Keep **stored** `game_odds_current` / `game_odds_history` as **secondary** when present.

- Not relabeled as certified Opening Snapshot Market Movement.
- Final section copy: “Closing or stored sportsbook lines for this game. Not certified Opening Snapshot Market Movement.”
- Nav: **Lines** (not live “Odds & sentiment”) when the section is shown.
- If no stored lines/movement: omit the Odds section and sidebar Lines chrome.

12B is **not** game-odds Market Movement.

### AI (decision)

**Hidden** on Finals. No `ai-projection-summary` POST. Fundamentally pre-game/live. No new historical AI feature.

### Injuries (decision)

**Omitted** on Finals. Empty arrays; injury snapshot not rendered. Frozen “not current” copy is not shown. No injury-as-of.

---

## Historical API / Server Contract

**No** `GET /api/history/game/:gameId`.

Smallest clean contract: extend existing `GET /api/betting/games/:gameId/details`.

Final payload includes:

- Overview: identity, teams, `gameSeason`, date, status, official scores
- `boxScore` (team-grouped logs + `available`)
- `availability` flags
- `viewMode: 'final'`

Server helper: `lib/betting/historical-final-server.ts` (`loadHistoricalFinalBox`).

---

## Availability Semantics

Flags mean **product-module-ready**, not “archive exists on S3.”

12B: **all false** for 2023, 2024, **and 2025**:

```json
{ "starters": false, "advanced": false, "roleProfile": false, "timeline": false }
```

2025 lineup archives must not auto-enable `starters` until 12C certifies serving.

---

## Multi-Season Verification

| Season | Game | Header | Box logs (DB) | Browser |
| --- | --- | --- | --- | --- |
| 2023 | `15905067` DAL 88 @ BOS 106 | 2023–24, Final, official scores | 30 | Box + Luka / Tatum; no projected starters |
| 2024 | `18444564` IND 91 @ OKC 103 | 2024–25, Final | 30 | Box; no 2025 lineup module |
| 2025 | `18447937` SAS 118 @ LAC 99 | 2025–26, Final | 36 | Box; **no Starting five** (12C) |
| 2025 regression | `21682743` PHI 109 @ BOS 100 | Final overview + box | 30 | No AI / projected starters / 0.0 PPG / “not current” injuries |

Pin-season ratings/pace/rankings are **omitted** on Finals (null stats). Correct absence rather than wrong-season ORTG.

---

## Upcoming/Live Regression

`/betting/games/21717855` (2026 Scheduled, BOS @ DET):

- Nav: AI Projection → Odds & sentiment → Matchup → Players → Injuries
- AI Projection Summary present
- Projected starters present (analytics PPG, not Final box)
- No historical box score
- Records, not official final scores

Season pin for **today/future** Dashboard dates retained (`gamePicker: season`).

---

## Query Performance

### Historical Dashboard date

Typical: **2** top-level reads

1. `getGamesForCalendarDate` (one slate query)
2. `getGamesOdds` (batched by game ids)

No per-team `getTeamRecentForm`. No `getAllTeamRatings` / defensive ranks.

### Historical Final page

Typical: **4** top-level reads on details (plus the initial game SELECT = **4–5 SQL**)

1. Game row (`analytics.games` + teams)
2. One boxed `player_game_logs` query for the game (not per-player)
3. `getLineMovement` (usually one `game_odds_history` query)
4. `getGameOdds` (one `game_odds_current` query)

No matchup-analysis, no BDL lineups, no current injuries, no pin ratings, no N player queries.

Client: **1** details fetch (no matchup-analysis / player-props).

---

## Tests Added

| File | Covers |
| --- | --- |
| `lib/betting/__tests__/slate-date.test.ts` | Historical dates unpin; today/future stay pinned |
| `lib/betting/__tests__/slate-date-loader.test.ts` | 2024-06-17 uses calendar loader; future uses `getGamesForDate` |
| `lib/betting/__tests__/dashboard-historical-slate.test.ts` | API returns `15905067`; skips pin ratings |
| `lib/betting/__tests__/historical-final.test.ts` | Status-based Final; box grouping; skip live matchup-analysis |
| `lib/betting/__tests__/historical-final-seasons.test.ts` | 2023/2024/2025 season + official scores |
| `lib/betting/__tests__/matchup-analysis-final.test.ts` | **`fetchLineupsFromBallDontLie` not called on Final**; still called for Scheduled |
| `lib/betting/__tests__/details-final-mode.test.ts` | Details `gameSeason` from row; official scores; box groups; no ratings/BDL; live path still loads ratings |
| `lib/betting/__tests__/research-journey.test.ts` | Player href includes `season=` |

`getGamesForDate` season-pin tests in `season-scoping.test.ts` remain valid (Dashboard historical is a different helper).

---

## Test Results

```
npx vitest run
  historical-final, historical-final-seasons, slate-date, slate-date-loader,
  matchup-analysis-final, details-final-mode, dashboard-historical-slate,
  research-journey, season-scoping,
  market-movement, market-movement-present, market-movement-server,
  market-movement-backfill, market-movement-schema, prop-market-serving
```

**15 files, 123 tests, all passed.**

Touched-file typecheck: `MatchupPageLayout` fragment + games-route ratings typing fixed. Remaining `tsc` noise is unrelated repo files.

Lint on touched files: no errors (Tailwind class-style warnings only).

---

## Manual Verification

| Check | Result |
| --- | --- |
| `/betting?date=2024-06-17` no false empty slate | **Pass** — DAL @ BOS 88–106 |
| Click path remains `/betting/games/:id` | **Pass** (`gameDetailHref`) |
| `/betting/games/15905067` header + box | **Pass** |
| No projected starters / live lineup UI | **Pass** |
| No 2025 ratings/lineup on 2023 Final | **Pass** (season chip 2023–24; ratings omitted) |
| `/betting/games/18447937` Final + box, no starters | **Pass** |
| `/betting/games/21682743` no longer live-first | **Pass** |
| Upcoming `21717855` still live-first | **Pass** |
| Player identity | **Pass** — `/betting/players/:id?...&season=2023` |

---

## Files Changed

### New

- `lib/betting/slate-date.ts`
- `lib/betting/historical-final.ts`
- `lib/betting/historical-final-server.ts`
- `components/betting/HistoricalFinalBoxScore.tsx`
- tests listed above
- this report + JSON + learning log

### Edited

- `app/api/betting/games/route.ts`
- `app/api/betting/games/[gameId]/details/route.ts`
- `app/betting/games/[gameId]/GameDetailsPageClient.tsx`
- `components/betting/MatchupPageLayout.tsx`
- `lib/betting/queries.ts` (`getMatchupAnalysis` Final early-return)
- `lib/betting/research-journey.ts` (`season` query param)
- `components/betting/GameCard.tsx` (optional `season`)

Public `/games/:id` not modified.

---

## Remaining Historical Gaps

- **12C:** certified Starting five (`analytics.game_starters` + archive backfill). Do not read lineup S3 at runtime in 12B.
- Advanced / Role / Season Average serving (later steps).
- Plays / Timeline (v2.1).
- Injury-as-of (not reliable enough).
- Historical AI analysis (not started).
- Certified Opening Snapshot game-odds MM UI (not 12B).
- Team season switcher still **2025–26 / 2026–27 only** (12B §25 — not expanded).
- Dashboard trending strip / model insights still pin-season on historical dates.
- Betting player page itself may still be pin-season internally; 12B only passes `season=` on the href.
- Optional later: merge details game SELECT with box helper to drop the extra payload helper path; consolidate public `/games/:id`.

---

## Recommendation for Step 12C

Proceed with compact **certified starter serving**:

1. Keep the Final `viewMode` contract; **never** re-enable `fetchLineupsFromBallDontLie` on Finals.
2. Materialize `analytics.game_starters` from the lineup archive (not live HTTP).
3. Flip `availability.starters` only after runtime serving is certified — still **false** if the archive row is missing.
4. UI: **Starting five** (not Projected starters) on Finals only when `availability.starters === true`.
5. Do not start Advanced/Role/Plays in the same step.

---

## Verification Checklist

1. Open `/betting?date=2024-06-17` — DAL @ BOS appears; not “No games.”
2. Open `/betting/games/15905067` — 88–106 Final, 2023–24, box by team.
3. Confirm no Projected starters / 0.0 PPG / AI primary / injury-as-of.
4. Open `/betting/games/18444564` and `/betting/games/18447937` — season chips match DB; box loads; no Starting five yet.
5. Open `/betting/games/21682743` — no longer looks like an upcoming game.
6. Open a 2026 Scheduled game — live-first modules still present.
7. Confirm no 12C starter table/backfill was started.

---

## Step Verdict

`GREEN — multi-season historical base is correct and ready for certified starters`
