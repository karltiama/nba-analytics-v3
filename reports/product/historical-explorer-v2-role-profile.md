# Historical Explorer v2 — Step 12F Role Profile

**Step verdict:** `GREEN — Historical Explorer Role Profile is ship-ready and ready for the next roadmap step`

**Product classification:** `SHIP_READY`

**Date:** 2026-09-10  
**Scope:** historical season Role Profile serving + separate Context UI. No Timeline, Plays, injury, Opportunity, WOWY, Market Movement, Starting Five, or live Role Profile.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| BDL HTTP | **0** (read-only S3 Season Average pages) |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Provider acquisition | none |
| Plays / Timeline / injury | none |
| Market Movement / Starting Five | unchanged |
| Live Role Profile | not added |
| Team Matchup Profile | not built |

---

## Season Average Source Audit

Certified targeted archive (Step 9C): **7,888 records / 8.78 MB**, regular season **2023–2025**.

Player allowlist used:

- playtype: isolation, prballhandler, prrollman
- tracking: drives, passing
- shooting: by_zone

Team archive (isolation / possessions / by_zone_opponent) was **not** materialized. 12F is player Role Profile only.

Envelope on S3 is `{ request, fetchedAt, hasMore, body: { data: [...] } }`. Extractor unwraps `body.data`.

Grain: `(season, season_type, player_id, category, type)`. Duplicates **0**.

---

## Selected Role Fields

| Concept | Archive field | Scale | Served as |
| --- | --- | --- | --- |
| Isolation frequency | `poss_pct` | 0–1 share | `isolation_poss_pct` |
| Isolation efficiency | `ppp` | points/poss | `isolation_ppp` |
| PnR BH | `poss_pct` / `ppp` | same | `pnr_ball_handler_*` |
| PnR roll | `poss_pct` / `ppp` | same | `pnr_roll_man_*` |
| Drives | `drives` | per game | `drives_per_game` |
| Drive points | `drive_pts` | per game | `drive_points_per_game` |
| Passes | `passes_made` | per game | `passes_per_game` |
| Potential AST | `potential_ast` | per game | `potential_assists_per_game` |
| Rim | `restricted_area_fga` / `_fg_pct` | FGA/g, 0–1 FG% | `restricted_area_*` |
| Paint | `in_the_paint_(non-ra)_*` | same | `paint_non_ra_*` |
| Midrange | `mid-range_*` | same | `midrange_*` |
| Corner 3 | `corner_3_*` (combined) | same | `corner_three_*` |
| Above break 3 | `above_the_break_3_*` | same | `above_break_three_*` |

**Not served:** playtype `gp` (qualifying games), left/right corner split, backcourt, percentiles, extra tracking, unsupported categories.

`poss_pct` shares a comparable offensive-possession denominator, so Isolation / BH / Roll can be shown together. They still omit spot-up/transition, so **no derived primary-role label**.

---

## Serving Schema

`analytics.player_role_profile`

- PK `(player_id, season)`
- FK to `analytics.players`
- All metric columns nullable
- No names, no team_id, no jsonb, no playtype gp
- RLS **false**; grants owner/`postgres` only; **no anon**
- No extra indexes (~1.7k rows)

---

## Candidate / Coverage Counts

Player archive rows ingested: **7,618** (= 7,888 − 270 team records).

| Season | Profiles | Iso | PnR BH | Roll | Drives | Passing | Zone |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023 | 572 | 234 | 282 | 240 | 572 | 572 | 572 |
| 2024 | 569 | 261 | 308 | 270 | 569 | 569 | 569 |
| 2025 | 582 | 267 | 319 | 268 | 582 | 582 | 582 |
| **Total** | **1,723** | | | | | | |

Vs certified log targets (595 / 587 / 603): tracking+zone ≈ **96%**; playtype ≈ **39–53%**. Matches 9C.

**Inclusion policy:** one row if the player has **at least one** approved category. Partial profiles (drives+zone, no isolation) are valid.

---

## Identity Audit

| Check | Result |
| --- | --- |
| Mapped to `analytics.players` | **1,723** |
| Unmapped | **0** |
| Unsupported season | **0** |
| Category conflicts | **0** |
| Name matching | none |

---

## Backfill Result

First execute: **1,723 inserts**.  
SGA 2025: isolation **0.28**, PnR BH **0.36**, drives **25.8** — matches Step 9B.

---

## Null / Qualification Semantics

Missing isolation/PnR is omitted in UI, not shown as `0%`. Explicit source zeros (e.g. 0.0 FGA) still display. Playtype `gp` is not served.

---

## Storage Delta

| | Bytes |
| --- | ---: |
| DB before first execute | 384,986,259 |
| DB after | 385,510,547 |
| DB delta | **524,288** (~0.5 MB) |
| Table heap | 450,560 |
| Indexes | 90,112 |
| Total relation | **540,672** (~0.52 MB) |

Well under the 12A **&lt; 4 MB** budget. No raw JSON copied.

---

## Idempotency

Second execute: **written = 0** (`IS DISTINCT FROM` UPSERT).

---

## Historical Contract Integration

Box players now carry:

- `advanced | null` (this game)
- `roleProfile | null` (this season)

`availability.roleProfile` is true when at least one box player has a serving row for the **game season**. One batched query: `WHERE season = $1 AND player_id = ANY($2)`. 2026 live path still hardcodes `roleProfile: false`.

---

## Context UI Architecture

Separate **Context** section. Not inside Box Score | Advanced.

Heading: **Season Role — {2023–24 / 2024–25 / 2025–26}**  
Copy: **This season, not this game.**

---

## Player Selection

Compact `<select>` grouped away/home. Default: first certified starter (away then home) when Starting Five is shown; otherwise first box player in existing away-then-home order. Not labeled player of the game.

Observed: 2023 Finals → Luka (first away box). 2025 SAS @ LAC → Luke Kornet (first listed SAS starter).

---

## Primary Actions

Frequency (`poss_pct` → **25.9%**) + PPP (**1.04**). Unavailable playtypes omitted.

---

## Drives / Passing

Drives / Drive pts / Passes / Potential AST, each **n / game**.

---

## Shot Profile

Rim / Paint / Midrange / Corner 3 / Above Break 3: FGA/g + FG% + share bar derived from stored FGA (not a shot chart). Share is also in text for a11y.

---

## Advanced vs Role Separation

Players: **This game — Box Score or Advanced. Not season role.**  
Context: **This season, not this game.**

Tatum 2023 Finals: game USG **28.4%** vs season isolation **25.9%** / PnR BH **22.2%**. Distinct numbers, distinct labels.

---

## 2023 Verification

`15905067` DAL 88 @ BOS 106

- Box default
- Advanced still Tatum **28.4% USG**
- Context **Season Role — 2023–24**
- No Starting Five
- No live BDL

---

## 2024 Verification

Same certified Finals fixture (`15905067`, season 2023–24). Role season label is **2023–24**, not game-night 2024-06-17.

---

## 2025 Verification

`18447937` SAS 118 @ LAC 99

- Starting Five **5+5**
- Box / Advanced intact
- Context **Season Role — 2025–26**
- Starter Luke Kornet: **PnR Roll Man 19.4% / 1.57 PPP**; isolation/BH omitted (not 0%)

---

## 2026 Regression

`21717855` Scheduled

- Live AI / Odds / **Projected starters**
- No Context nav
- No Season Role
- No historical Advanced toggle

---

## Responsive / Accessibility

Desktop: editorial panel, not a spreadsheet.  
~390px: stacked playtype cards, 2×2 creation, shot rows with labels + bars. Player `<select>` keyboard accessible. PPP explained via `<abbr>`. Missing values omitted or “unavailable for this player.”

---

## Tests Added

- `lib/archive/__tests__/player-role-profile.test.ts`
- `lib/betting/__tests__/historical-role-profile-format.test.ts`
- `lib/betting/__tests__/historical-role-profile.test.ts`
- `lib/betting/__tests__/player-role-profile-schema.test.ts`
- details Final: Role attach + batch `ANY($2)` + 2026 false

---

## Test Results

Role Profile + details + Advanced UI + historical Final: **40 passed**.  
Regression (Final / seasons / Starting Five / no-live-BDL / slate / MM): **78 passed**.

---

## Browser Verification

Exercised 2023 Finals (Box default, Advanced 28.4% USG, Tatum season isolation 25.9%), 2025 Starting Five + Kornet roll-man-only playtype, 2026 live unchanged, mobile 390px Context panel.

Unrelated Next overlay (`1 Issue`) appeared; not caused by 12F.

---

## Files Changed

**Added**

- `db/schemas/MIGRATION_player_role_profile.sql`
- `scripts/apply-player-role-profile-schema.ts`
- `scripts/ingestion/materialize-player-role-profile.ts`
- `lib/archive/player-role-profile.ts`
- `lib/betting/historical-role-profile.ts`
- `lib/betting/historical-role-profile-format.ts`
- `components/betting/HistoricalFinalRoleProfile.tsx`
- tests listed above
- `reports/trial/player-role-profile-materialize.json`

**Modified**

- `lib/betting/historical-final.ts`
- `lib/betting/historical-final-server.ts`
- `app/api/betting/games/[gameId]/details/route.ts`
- `components/betting/MatchupPageLayout.tsx`
- `lib/betting/__tests__/details-final-mode.test.ts`
- `lib/betting/__tests__/historical-final.test.ts`

---

## Remaining Follow-Ups

- Team Matchup Profile (opponent zone) later
- Optional primary-role label only if more playtypes are archived
- Timeline / Plays still unstarted
- Dashboard Next overlay is a separate bug

---

## Product Classification

**SHIP_READY** — season Role Profile is clearly distinct from this-game Advanced across 2023–2025 Finals.

---

## Recommendation for Next Step

Next roadmap phase owns **Timeline / Plays**. Do **not** fold Plays into Context. Keep Role Profile as season context.

**STOP. Do not start Timeline in this step.**

---

## Verification Checklist

1. `/betting/games/15905067` Box default; Advanced Tatum **28.4%** USG; Context **Season Role — 2023–24**.
2. Same page: Tatum season isolation **25.9%**, not the game USG.
3. `/betting/games/18447937` Starting Five 5+5 + Context; Kornet roll man without fake 0% isolation.
4. `/betting/games/21717855` Projected Starters; **no** Season Role.
5. Mobile ~390px: stacked Role cards, usable player select.
6. Missing playtype omitted, not `0%`.
7. PPP is `1.04`, not a percent.

---

## Step Verdict

**GREEN — Historical Explorer Role Profile is ship-ready and ready for the next roadmap step**
