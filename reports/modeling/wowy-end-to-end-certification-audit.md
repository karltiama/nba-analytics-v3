# Court Context WOWY End-to-End Certification Audit

**Audit ID:** STEP 14C.W  
**Date:** 2026-09-15  
**Mode:** READ ONLY (no code, schema, model, UI, or data changes)  
**Calculation version inspected:** `game-level-wowy-v1`  
**Data version inspected:** `analytics.player_game_logs+analytics.games+analytics.team_game_stats`

---

## Executive Verdict

Court Context currently ships **game-level participation WOWY**, not possession on/off and not five-man lineup WOWY. The core classifier and aggregator are trustworthy for that narrower contract: canonical player IDs, same-`team_id` night-of membership, verified DNP = minutes token `"00"`, missing rows = unknown (not without), stints kept separate, per-game = total ÷ games, per-minute = total stat ÷ total minutes.

Live serving data reproduces the documented Jokić / Murray 2024 DEN regular-season split (58 with / 12 without, 28.4 vs 35.3 PTS) and the player-themselves team split (70 / 12, team PTS 122.6 vs 109.8). Frozen PTS C / REB C artifacts were not mutated. Projection models do not consume WOWY.

The product is **not** certified as a general “role/lineup context engine.” UI sample labels, opponent-points polarity, insufficient-sample hero cards, and teammate-picker counts that ignore season type / subject-played filters are the reasons this audit is YELLOW rather than GREEN.

**OVERALL: YELLOW**

**USER_FACING_RESEARCH: YELLOW**

**MODEL_FEATURE_SOURCE: NOT_IMPLEMENTED**

**MODEL_INTEGRATION = NOT_IMPLEMENTED**

**WOWY_TELEMETRY = NOT_IMPLEMENTED**

---

## System Discovered

What exists today:

| Claimed concept | Implemented? |
|---|---|
| Game-level WITH / WITHOUT (both played vs verified DNP) | YES |
| Team with/without the selected player (no teammate) | YES |
| Subject box with/without a teammate | YES |
| On-court / off-court (shared minutes or possessions) | NO |
| Five-man lineup reconstruction | NO (placeholder copy only) |
| Usage, true shooting, assist rate, rebound rate, ORtg, pace | NO |
| Starters | NO |
| Injury / live availability | NO (DNP is explicitly not injury) |
| Role-change narrative engine | NO |
| Player page / Props / game page / Historical Explorer / Context Check | NO |
| Projection / frozen-model features | NO (adapter exists, unused) |
| Entitlement gate on `/wowy` | NO (key exists, page ungated) |

The user-facing promise, in the page’s own words: *game-level participation, not shared-court possessions.*

---

## Architecture Map

```
SOURCE
  analytics.player_game_logs          (appearance, counting stats, team_id, season)
  analytics.games                     (status=Final, start_time, scores)
  analytics.team_game_stats           (team PTS/REB/AST/3PM/FGA/FTA + points_allowed)
  analytics.players                   (player_id, player_entity_id, full_name)
  analytics.player_provider_ids       (NBA id for headshots only)
  analytics.player_identity_unresolved (fail-closed quarantine)
  analytics.teams                     (abbreviation / full_name)
       ↓
TRANSFORMATION (in-process, not materialized)
  classifyWowyAppearance   lib/wowy/appearance.ts
  classifyWowyGame(s)      lib/wowy/eligibility.ts
  summarizeWowyPair        lib/wowy/aggregate.ts
  summarizeWowyBeforeCutoff lib/wowy/model-adapter.ts  (API only; unused by models)
       ↓
DATABASE / CACHE / MATERIALIZATION
  No WOWY table.
  GET /api/wowy/pair and /model-pair wrap loaders in next/unstable_cache
    key = calculationVersion|dataVersion|player|teammate|team|season|seasonType|dates|cutoff
    revalidate = 3600s
  Unused optional index SQL: db/schemas/MIGRATION_wowy_query_indexes.sql (not applied)
       ↓
DOMAIN SERVICE
  lib/wowy/queries.ts  (identity, stints, teammates, pair load, summarize)
       ↓
API / SERVER ACTION
  GET /api/wowy/pair
  GET /api/wowy/model-pair   (requires cutoffStartTime)
  GET /api/wowy/players?q=
  GET /api/wowy/context?playerId&season&teamId
  No server actions. Page is a client explorer.
       ↓
PRODUCT UI
  /wowy  →  app/wowy/{page,layout,WowyExplorer,WowyResults}.tsx
  Nav: components/betting/primary-nav.ts  (“WOWY”)
       ↓
MODEL FEATURE INPUTS
  None in production. Future contract only:
    reports/modeling/model-lab/WOWY_ARTIFACT_CONTRACT.md
```

`lib/betting`, `lib/model-lab`, Context Check, Props Explorer, and frozen shadow PTS C / REB C do **not** import `lib/wowy`.

---

## WOWY Product Contract

Two split modes, one classifier.

### Mode `subject` (default; no teammate)

**Question:** How did **this team’s box** look in games the selected player appeared versus games that player had a verified DNP roster row?

| Metric (UI) | Definition | Unit | Numerator | Denominator |
|---|---|---|---|---|
| PTS / game | Mean team points | points/game | sum(`team_game_stats.team_points`, else game score) | WITH or WITHOUT game count with non-null value |
| Opp PTS / game | Mean opponent points | points/game | sum(`points_allowed`, else opponent score) | same |
| REB / AST / 3PM / FGA / 3PA / FTA | Mean team counting stats | count/game | sum of `team_game_stats` columns | same |
| MIN | Not shown (null in this mode) | — | — | — |
| Per-minute | Disabled in UI | — | — | — |

- **Sample unit:** Final games, selected `team_id` + `season` + `seasonType`.
- **WITH:** subject appearance class = `played`.
- **WITHOUT:** subject appearance class = `dnp` (minutes token `"00"`).
- **Missing subject log:** game never enters the load (query is from the subject’s PGL rows).
- **Minimum sample:** policy `game-level-wowy-support-v1`: both sides ≥ 2 else `insufficient`; both sides ≥ 8 else `low_support`.
- **Starter/bench:** ignored.
- **Garbage time / OT:** included (whole-game box).
- **Possessions:** not used.

### Mode `teammate`

**Question:** How did **the subject’s box** look in games both players played on the same team versus games the subject played and the teammate had minutes `"00"`?

| Metric (UI) | Definition | Unit | Numerator | Denominator |
|---|---|---|---|---|
| PTS / REB / AST / 3PM / FGA / 3PA / FTA / MIN per game | Mean of subject box | count or minutes / game | sum of subject PGL column | games with a finite value |
| Per minute (optional view) | `total stat / total minutes` where minutes > 0 | count per minute | sum of stat | `validMinutesForRates` |
| Opp PTS | Hidden | — | — | — |

- **WITH:** subject `played` AND teammate same `team_id` AND teammate `played`.
- **WITHOUT:** subject `played` AND teammate same `team_id` AND teammate `verified_dnp`.
- **Not WITH and not WITHOUT:** excluded (unknown membership, different team, malformed minutes, subject DNP, incomplete game, season-type mismatch, date/cutoff).

### Appearance classes (shared with minutes-projection-eval)

Inspected on 2023–2025 logs:

- `"00"` → DNP / inactive roster row. **Not an injury label.**
- `"0"` / `"0.0"` → played, 0 minutes.
- numeric > 0 → played.
- null / non-numeric → malformed → excluded.
- Current warehouse: **0** `MM:SS` colon tokens; minutes are integer-like strings plus `"00"`.

### What the product does **not** promise (and must not be read as promising)

- Shared-court minutes or possessions.
- “Usage +X% without X”.
- Causal absence effects.
- Lineup combinations (explicit “Coming later”).

---

## Source Data Provenance

| Dataset | Role | Seasons in warehouse | Coverage vs Final games | Authoritative? |
|---|---|---|---|---|
| `analytics.player_game_logs` | Appearance + player box | 2023, 2024, 2025 (~46k rows/season) | Box tape for those seasons | Derived from provider box; WOWY treats it as source of truth |
| `analytics.games` | Final filter, tipoff, scores | 2023–2025 | 1319 / 1321 / 1322 Final games | Authoritative for status/scores |
| `analytics.team_game_stats` | Team box in subject mode | 2023–2025 | **Exact 2 rows per Final game** (2638 / 2642 / 2644) | Derived: `scripts/compute-team-stats.ts` sums PGL + opponent |
| `analytics.players` | Identity | 5534 players, **0** missing `player_entity_id` | — | Canonical analytics id (BDL-origin `player_id`) |
| `analytics.player_identity_unresolved` | Quarantine | **0** open UNRESOLVED/CONFLICT | — | Fail-closed |
| `analytics.player_team_stints` | **Not used** | — | — | Explicitly avoided (`inferred_pgl` ≠ trade date) |
| Play-by-play / substitutions | **Not used** | — | — | — |
| Injuries | **Not used** | — | — | — |
| Advanced V2 / possessions | **Not used** | — | — | — |

DNP token volume: 2023 17,865 `"00"`; 2024 17,885; 2025 17,344. `"0"` minutes: 57 / 111 / 42.

Anomalous `"00"` rows with box activity: **2 rows, same `game_id` 18447756**. Classifier still treats them as DNP (`minutes_00_dnp_with_anomalous_box`). Negligible.

No 2026 WOWY box tape. Page methodology states this.

Team PTS fallback: if `team_game_stats` is missing, eligibility uses `games.home_score` / `away_score` for PTS and Opp PTS only. REB/AST/shot attempts stay null. With current 2023–2025 TGS completeness this mixed-denominator path should not fire for Final games.

---

## Identity Safety

Pair and context loads resolve `analytics.players.player_id` (text). They join PGL on that id, never on display name.

Fail-closed:

1. `player_entity_id` must be non-null.
2. No open `player_identity_unresolved` row for `provider='balldontlie'` + that id.

NBA provider id is **display-only** (CDN headshot). Search uses `full_name ILIKE` to **discover** players, then all calculation joins stay on `player_id`. Duplicate names can both appear in the picker; they cannot be silently merged in the split.

**No name-based join in WITH/WITHOUT classification.**

Rookies / unresolved identities: 422 `ambiguous_identity` or 404 `not_found`. Not zero-filled.

`player_id` is BDL-origin because that is the analytics canonical key after ingest, not because WOWY bypasses entity resolution.

---

## Team / Roster Stints

`teamId` is **required** on pair queries. Distinct game-log `team_id` values are never pooled.

Stint options come from Final PGL `team_id` grouped min/max `game_date`. Flags: `verifiedTradeDates: false`, `evidence: 'game_log_team_id'`. UI copy: “Not a verified trade date.”

Live Luka Dončić (`player_id=132`) 2024:

| Stint | team_id | Coverage | Self-mode WITH / WITHOUT (regular) |
|---|---|---|---|
| DAL | 7 | 2024-10-24 → 2025-01-31, 49 Final logs | 22 / 27 (0 excluded) |
| LAL | 14 | 2025-02-04 → 2025-04-30, 40 Final logs | 28 / 7 (5 playoff `season_type_mismatch`) |

A “without teammate X” split cannot cross a trade boundary unless the user picks a stint that never contained both players; those games classify as `teammate_different_team` or never share a row.

`analytics.player_team_stints` is not consulted. That is correct given `inferred_pgl` observation dates.

---

## WITH / WITHOUT Definition

**Actual definition (teammate mode):**

- WITH = both have PGL rows, same `team_id`, both appearance `played`, game Final with scores and parseable `start_time`, season-type/date/cutoff filters pass.
- WITHOUT = subject `played`, teammate row present, same `team_id`, teammate minutes token `"00"`.
- Missing teammate row = **unknown**, excluded. Absence is never inferred.

**Actual definition (subject mode):**

- WITH = subject `played` (including `"0"`).
- WITHOUT = subject `"00"`.
- Stats are **team** box, not player box.

### Edge cases vs implementation

| Case | Classification |
|---|---|
| Dressed / DNP (`"00"`) | WITHOUT (if same-team row exists) |
| Played 2 minutes | WITH (played) |
| Left injured after playing | WITH for the whole game (game-level) |
| Came off bench / started | No distinction |
| Inactive with roster row `"00"` | WITHOUT |
| Not on roster (no PGL row) | Excluded unknown; **not** WITHOUT |
| Traded, other team that night | Excluded `teammate_different_team` |
| Garbage time only | WITH if minutes > 0 (or `"0"`) |
| OT only | WITH; OT is inside the box |
| Subject DNP in teammate mode | Excluded `subject_did_not_play` |

UI terminology “in the box” means **box-score appearance**, not shared floor. Methodology is explicit. Insights still use “in the box,” which a user can misread as on-court.

---

## Game-Level vs On-Court Semantics

Court Context implements **A. game-level WITH/WITHOUT** only.

It does **not** implement B (on-court/off-court) or C (lineup-based).

Page, types header, methodology, and lineup placeholder all state this. Do not equate:

- “Jokić averaged 28.4 points in games Murray played”

with

- “Jokić scored X per 36 while Murray was off the court.”

Those are different products. Only the first exists.

---

## Lineup Reconstruction

**NOT_IMPLEMENTED.**

No starting-five seed, substitution stream, 5-on-court invariant, or period-clock reconstruction. The “Top 5 lineup combinations” block is copy-only.

---

## Minutes / Possessions

**Minutes:** parsed from PGL `minutes` via `parseFloat` of the token. Not reconstructed from play-by-play. Team 48×5=240 court-minute invariant does **not** apply and is not checked.

**Possessions: NOT_IMPLEMENTED.** No per-100 metrics. Do not certify possession-normalized WOWY.

Per-minute rates (teammate mode only) are `sum(stat) / sum(minutes>0)`. If all minutes are 0, counting averages are retained and per-minute is null (`countingRetainedDespiteIneligibleRates`).

`parseFloat("0:00")` would be `0` with token `"0:00"` (not `"00"`). That latent path is unused: **0 colon tokens** in current PGL.

---

## Stat Aggregation

Counting stats are **sums then divide by game count with a finite value**, not mean-of-game-rates.

Subject mode reads team columns; teammate mode reads subject columns. Keys are not mixed except the documented PTS/Opp PTS score fallback when TGS is absent.

No usage, TS%, assist%, rebound%, touches, or rating stats exist to mix.

---

## Rate Aggregation

| Pattern | Used? |
|---|---|
| Mean of per-game averages of a rate (average of averages) | NO |
| Total makes / total attempts for FG% | N/A (FG% not computed) |
| Per-game = total / N games | YES |
| Per-minute = total / total minutes | YES |
| Per-36 / per-100 | NO |

Percentage diffs are `(with − without) / |without|` and are **omitted** when `|without|` is below `WOWY_PERCENT_DIFF_MIN_ABS` (0.5 counting, 1.0 minutes, 0.01 per-minute). UI hero cards show **absolute** per-game diffs, not those percents.

---

## Sample Size / Reliability

Returned on every summary:

- `with.gameCount` / `without.gameCount`
- `with.totalMinutes` / `without.totalMinutes` (teammate mode shown in UI)
- `dateCoverage.first/last` (**WITH side only** in the sample bar)
- `gameIds` + full `classifiedGames`
- `support.tier` + policy copy
- exclusion tallies

Tiers: `<2` either side → insufficient; `<8` → low_support; else adequate. **Not a statistical confidence interval.** Recency, lineup stability, and data-completeness are not scored.

Zero-sample WITHOUT renders `—` for diffs (playoffs Jokić: 14 / 0). Insights correctly “hold the split.” Hero metric cards still render the WITH averages. That violates the policy sentence: *“comparison is not shown as a numeric split.”*

---

## Temporal Windows

UI windows: season `2023` | `2024` | `2025`, season type `regular` | `playoffs` (`all` is parseable but not in the season-type select). Optional `dateFrom` / `dateTo` / `cutoffStartTime` exist on the API; **the explorer does not expose cutoff** and always loads the full selected season type.

Postseason floor (ET date ≥): 2023 → 2024-04-16; 2024 → 2025-04-15; 2025 → 2026-04-14. Matches minutes-eval.

The research page is **retrospective**. It includes later games in the same season. That is correct for `/wowy` as labeled. It is **not** pre-game context.

Model adapter cutoff: usable prior iff `start_time < cutoff` **and** ET calendar date is strictly earlier (same-night excluded). Unit-tested.

---

## Leakage Audit

| Risk | Research page `/wowy` | `summarizeWowyBeforeCutoff` | Frozen / learned projections |
|---|---|---|---|
| Full-season aggregates on earlier games | Yes, by design; not labeled “as-of” because the page is retrospective | Prevented by cutoff | N/A (WOWY unused) |
| Future lineup / injury | Not used | Not used | — |
| Target-game box choosing scenario | N/A | Scenario stays `unknown`; target participation is not an input | — |
| Current roster applied retroactively | No; night-of `team_id` | Same | — |
| Materialized WOWY without as-of | No WOWY table | — | — |

`reliability.leakSafe` uses ISO string `< cutoff` and does **not** re-check the ET-date rule. Classification already dropped same-ET-date games, so a WITH/WITHOUT row that passed classification is still before cutoff. The flag is slightly weaker than the classifier. Unused in production models.

**No P0 leakage into projections**, because there is no model consumer.

If a future caller feeds `/wowy` page summaries (no cutoff) into a pre-game model, that would be P0. The adapter comments forbid that.

---

## Model Integration

**MODEL_INTEGRATION = NOT_IMPLEMENTED**

`GET /api/wowy/model-pair` and `summarizeWowyBeforeCutoff` exist as a historically safe **future** interface:

- requires `cutoffStartTime`
- never auto-selects WITH vs WITHOUT from the target box
- `WOWY_SCENARIO_UNKNOWN` unless a later caller supplies timestamped availability
- notes: do not sum diffs across multiple absent teammates; do not feed frozen PTS C / REB C

No feature in `reports/modeling/shadow-pts-reb-c-r1/feature_order.json` is WOWY. `lib/model-lab` has no WOWY import. `reports/modeling/model-lab/WOWY_ARTIFACT_CONTRACT.md` is a **future experiment** template, not a live artifact.

---

## Frozen Model Safety

GREEN.

WOWY did not create a new candidate model and does not write shadow manifests, hashes, or `.cbm` objects. Page methodology: “This page does not change production projections and does not feed frozen PTS C / REB C models.” Tests assert WOWY files do not import `player-projection-learned-features` / `player-prop-model` / `collection-asof`.

---

## Missing Data / Fallbacks

| Situation | Behavior |
|---|---|
| Player not in `analytics.players` | 404, not 0 |
| Quarantined / missing entity | 422 `ambiguous_identity` |
| Same player as teammate in API parse | Silently treated as **no teammate** (self-mode). Loader `same_player` 422 is unreachable via the public query parser |
| Missing teammate PGL row | Excluded unknown; not WITHOUT 0 |
| Null counting stat | Omitted from that stat’s mean; UI `—` |
| Insufficient sample | Insights hold; chart hidden; **hero cards still show WITH values** |
| DB error | 500 generic `"Failed to load WOWY pair."` |
| Empty eligible split | UI `empty` state with exclusion counts |

Silent zero-fill of unknown membership was not found in the classifier. Good.

---

## Rookies / Trades / Edge Cases

- Rookie / &lt;5 games: works; almost always `insufficient` / `low_support`.
- Midseason trade: explicit stint picker (Luka DAL vs LAL verified live).
- Two-way with no PGL row on a night: unknown, not without.
- Teammate pair with 0 shared played games: picker can list `0 together / N verified DNP` (e.g. DaRon Holmes II on 2024 DEN). Split will be insufficient if WITH &lt; 2.
- Playoffs Jokić / Murray: API **14 WITH / 0 WITHOUT**, `insufficient`. Murray had no verified DNP in that playoff sample.

---

## UI Surface Inventory

**Only `/wowy`.**

| Surface | Exists? |
|---|---|
| `/wowy` explorer | YES |
| Player page | NO |
| Matchup tab | NO |
| Props Explorer | NO WOWY import |
| Game page | Drill-down links **out** to game detail; game pages do not consume WOWY |
| Historical Explorer | NO |
| Context Check | Separate content studio; no WOWY import |

### `/wowy`

- **Route:** `app/wowy/page.tsx` inside `BettingAppShell`
- **Components:** `WowyExplorer`, `WowyResults`, `PlayerHeadshot`
- **APIs:** `/api/wowy/players`, `/api/wowy/context`, `/api/wowy/pair`
- **Loading:** “Loading comparison…”
- **Empty:** “No eligible with/without games” + exclusion counts
- **Error:** red text, generic message
- **Unavailable:** 422 identity
- **Unauthorized:** `UnauthorizedPanel` if 401 — APIs never send 401 (dead path)
- **Entitlement:** ungated; `FEATURE_KEYS` includes `wowy` with stale copy “when that surface ships”
- **Mobile:** CSS `grid-cols-1` / `grid-cols-2`; filter grid wraps; game-log table `overflow-x-auto`. 390px device emulation was not available in this audit session; layout is responsive by construction.

---

## UI ↔ Data Contract

**Aligned**

- “Verified DNP (minutes = 00)” = classifier `dnp`.
- “Not labeled as injury” = true.
- Subject-mode team PTS 122.6 / 109.8 = raw TGS averages.
- Teammate-mode 58 / 12 and 28.4 / 35.3 = raw PGL averages.
- Chart hidden when `insufficient`.

**Drift (do not ignore)**

1. **Teammate picker counts ≠ classified sample.** `loadWowyTeammates` counts all Final games in the season (no regular/playoff split) and DNP rows even when the subject also DNP’d. Live Jokić / Murray 2024: picker **72 together / 15 verified DNP**; regular-season classifier **58 / 12**.
2. **Sample bar date range is WITH-only.** Jokić self-mode showed `2024-10-24 → 2025-04-13` even though WITHOUT coverage is different.
3. **Opp PTS +3.1 is green / “up” / “Opp PTS with Jokic.”** Higher opponent scoring is treated like a good counting-stat increase.
4. **Insufficient policy vs hero cards.** Playoffs Jokić 14 / 0 still shows `107.0 with · — without` on metric cards while insights say not to show a split.
5. **Deep-link / select desync (observed).** Opening playoffs with `teammate=335` settled on **subject-mode** team averages (107.0 team PTS, “With Nikola Jokic”) while the teammate control displayed “Jamal Murray · 72 together / 15 verified DNP” and `history.replaceState` dropped `teammate` from the URL. The numbers match self-mode playoffs, not Murray WOWY (which would be ~26.2 PTS and “With Jamal Murray”).
6. **Both With and Without cards share the truncated blurb** “In these games, … averaged…”.
7. **`teammatePlayerId` equal to subject** is parsed as self-mode (200) instead of 422 `same_player`.

---

## Player Integration

WOWY is a standalone research page. It is not embedded on player profiles. Headshots use NBA CDN ids; calculation does not.

---

## Props Integration

**NOT_IMPLEMENTED.** WOWY does not sit beside hit rates and is not a betting recommendation. Offseason banner on the shell is unrelated.

---

## Game Integration

Game IDs in the drill-down link to existing game detail. Context is the classified game’s `team_id` / opponent / ET date — not “current roster.” No WOWY module on the game page.

---

## Historical Integration

**NOT_IMPLEMENTED** on Historical Explorer. `/wowy` itself is a retrospective historical tool and should be labeled that way (it is: season picker + Final games + no as-of control).

Certified Historical Explorer section order was not touched (this audit made no UI changes).

---

## Context Check Integration

**NOT_IMPLEMENTED.** Context Check remains claim → missing context → interpretation → verdict in `lib/content/context-check`. WOWY is not evidence in that pipeline.

---

## API Validation

Parameterized SQL (`$1`…`$4`). ILIKE search strips `%` / `_`.

| Input | Result |
|---|---|
| Missing subject/season/team | 400 |
| Bad season / seasonType / dates | 400 |
| Unknown player | 404 |
| `246' OR 1=1` | 404 (not SQL injection) |
| Model-pair without cutoff | 400 |
| Equal subject/teammate in query string | 200 self-mode (parser drops teammate) |
| Auth / entitlement | None |

Responses do not include stack traces or SQL. 500s are generic. `classifiedGames` in the pair JSON is large (~subject season rows) but not secret.

---

## Query Performance

Pair SQL is bounded: one subject `player_id` + `season` + `team_id`, LEFT JOIN teammate PGL + TGS. Typical ~80–100 subject rows. Optional `(player_id, season, team_id)` index is **not** applied; existing `(player_id, season)` is expected to suffice.

Credible risks (not blocking today):

- Teammate picker: join all same-team PGL for the subject’s Final games, `LIMIT 80` after group — heavier than the pair query (observed context ~140–670ms locally).
- `loadWowyModelPair` loads the pair summary **and** the game list again.
- `unstable_cache` 1 hour: fine in offseason; would lag same-day Finals if used in-season.
- Pair payload includes every classified game (including excluded).

No N+1 per game in the classifier (single query then in-memory).

---

## Cache / Materialization

Cache key includes calculation version, data version, subject, teammate, team, season, seasonType, dateFrom, dateTo, cutoff. Model-pair prefixes `model|`.

No season-wide materialized WOWY fact table, so values cannot bleed across players except via a **wrong cache key** (not found) or a **UI fetch that omits teammate** (observed hydration issue above).

Invalidation is time-based (3600s), not data-version hash of the warehouse.

---

## Raw Data Spot Checks

Traced against `analytics.player_game_logs` + `games` + `team_game_stats` and `scripts/verify-wowy-examples.ts` / live `/api/wowy/pair`.

| Case | Result | Match? |
|---|---|---|
| A. Jokić (246) + Murray (335), 2024 DEN regular | 58 / 12, PTS 28.4 / 35.3; unknown membership 0; 14 playoff + 12 subject-DNP excluded | YES vs warehouse |
| B. Murray missed meaningful games | 12 verified `"00"` WITH Jokić played | YES |
| C. Small / zero WITHOUT | Playoffs 14 / 0, insufficient | YES (API). UI mixed with self-mode copy in one walkthrough |
| D. Traded player | Luka DAL vs LAL stints isolated; DAL 22/27, LAL 28/7 regular | YES |
| E. New / unused teammate | Holmes picker 0 together / 96 DNP | Picker exists; pair not re-run in UI |
| F. Final historical games only | Non-Final excluded as `incomplete_game` | YES |
| G. Overtime | Whole-game box; no separate OT flag; OT games included if Final | YES by construction |

Self-mode Jokić 2024 DEN regular: 70 played / 12 `"00"`, team PTS 122.6 / 109.8 — matches TGS averages.

---

## Invariant Checks

| Invariant | Status |
|---|---|
| WITH + WITHOUT do not include different-team nights | Held (excluded) |
| Minutes not negative | Held (parse / appearance) |
| Possessions | N/A |
| Sample games ≤ eligible Final logs on that stint | Held in Luka DAL (22+27=49) |
| Player cannot be WITH themselves in teammate mode | Parser collapses to self-mode rather than error |
| Reversed roles keep membership rules | Same-team + played/DNP; metrics differ by design |
| Duplicate game_ids in a bucket | Load is one PGL row per subject game; not additionally de-duped |
| No future games in as-of adapter | Unit-tested cutoff |
| Missing row ≠ DNP | Unit-tested |

---

## Tests

`npx vitest run lib/wowy` — **8 files, 34 tests, all passed** (2026-09-15).

| Category | Present? | Notes |
|---|---|---|
| Unit appearance / cutoff | YES | Includes ET same-date exclusion |
| Classification | YES | WITH, DNP, missing row, trade, stint, subject DNP, `"0"` played, incomplete, malformed, playoffs vs regular, self-mode |
| Aggregation / rates | YES | Per-game vs per-minute; % diff floor; unknown tally |
| Insights copy | YES | No “causes” / “injured”; insufficient holds stat insights |
| Model adapter leakage | YES | Target/future excluded; mutating target box does not change history; scenario unknown |
| Appearance drift vs minutes-eval | YES | Token cases |
| Page contract (string) | YES | Route, nav, “not shared-court possessions” |
| Adapter isolation from frozen models | YES | Source grep |
| SQL/repository against live DB | NO in CI (`verify-wowy-examples.ts` is a manual script; it passed locally) | |
| API route tests | NO (probed live instead) | |
| Component / Playwright | NO | |
| Identity quarantine | NO automated | |
| Trade-boundary DB test | NO (live SQL in this audit) | |
| Overtime / malformed provider sequences | NO (no PBP) | |
| UI picker vs classifier counts | NO | |
| Opp PTS polarity | NO | |

Tests are stronger than “restate implementation” on membership, cutoff, and missing-row semantics. They do **not** catch picker/season-type drift or Opp PTS coloring.

---

## Build / Typecheck

- WOWY unit tests: green.
- Live verify script: green.
- `package.json` has `test` / `lint` / `build`; **no dedicated typecheck script.** Repo-wide `tsc` was not used as a WOWY gate (unrelated TS debt should not block this audit).
- Dev server served `/wowy` and `/api/wowy/pair` with 200s during the walkthrough.

---

## Mobile / Accessibility

- Form controls have visible `<label>` / `name` in the a11y tree (Player, Season, Team stint, Season type, Teammate).
- Headshots use `alt=""` (decorative); initials fallback is `aria-hidden`.
- Comparison bars are divs, not a data table or `meter`.
- Insights / sample banner are readable text.
- Theme toggle and primary nav are in the shell, not WOWY-specific.
- ~390px screenshot was not captured (device metrics override blocked). CSS: filters stack to one column below `md`; metric cards stay two-up (`grid-cols-2`).

YELLOW for a11y polish, not a blocker for research use.

---

## Product Language

Mostly plain: With / Without, games, verified DNP, not injury, not causal, not possessions.

Avoidable internals still visible: `minutes = 00`, `inferred_pgl` in methodology, `game_id` in the drill-down, “in the box” (box-score jargon).

No “causes,” “guarantees,” “will increase,” “proven,” or “always” in the explorer/results (page-contract test plus live insights).

Grammar nit: “Denver Nuggets does not yet have enough…”

---

## Security

- No provider credentials in WOWY responses.
- Parameterized SQL.
- Generic 500s.
- Search is unauthenticated player-name lookup (same class as other public research APIs).
- Entitlement key unused; page is public like `/teams` by product choice.

---

## Known Limitations

These are actual, not inferred:

1. Game-level only — not on-court, not lineups, not possessions.
2. Box coverage is 2023–2025 Final games only; no 2026 tape.
3. Verified WITHOUT requires a `"00"` roster row; two-way / G-League holes stay unknown.
4. Stints are game-log `team_id`, not certified trade timestamps.
5. DNP is not injury; live availability is not an input.
6. No usage / rate / role-change engine.
7. No WOWY on player, prop, game, Historical Explorer, or Context Check surfaces.
8. Research page is retrospective (no as-of control in the UI).
9. Support policy is a sample floor, not a confidence model.
10. `/wowy` is ungated; entitlement copy is stale.
11. Teammate picker sample counts are not the same query as the split.
12. Optional DB index not applied (queries still bounded).

---

## Certification Matrix

| Area | Grade |
|---|---|
| source coverage | GREEN |
| identity | GREEN |
| roster/team stints | GREEN |
| WITH/WITHOUT classification | GREEN |
| lineup reconstruction | NOT_IMPLEMENTED |
| minutes | GREEN (box minutes) |
| possessions | NOT_IMPLEMENTED |
| stat aggregation | GREEN |
| rate aggregation | GREEN |
| sample handling | YELLOW |
| reliability | YELLOW (disclosure only; adequate for raw research) |
| temporal/as-of safety | GREEN for adapter; YELLOW for page (retrospective by design) |
| model leakage | GREEN (no consumer) |
| model integration | NOT_IMPLEMENTED |
| frozen-model safety | GREEN |
| API contract | YELLOW (same-player parse; otherwise sound) |
| UI contract | YELLOW |
| player integration | NOT_IMPLEMENTED |
| prop integration | NOT_IMPLEMENTED |
| game integration | NOT_IMPLEMENTED (outbound links only) |
| Historical Explorer integration | NOT_IMPLEMENTED |
| Context Check integration | NOT_IMPLEMENTED |
| mobile | YELLOW |
| accessibility | YELLOW |
| performance | GREEN for current volume |
| testing | YELLOW |
| production readiness | YELLOW for `/wowy` research; NOT_IMPLEMENTED as a model feature |

---

## P0–P3 Findings

### P0

None found in classifier math, identity joins, stint isolation, or production model leakage.

### P1

1. **Teammate dropdown counts ≠ WITH/WITHOUT sample** (72/15 vs 58/12 for Jokić/Murray 2024; picker ignores season type and subject-played).
2. **Opp PTS polarity** treats higher opponent scoring as a green “up” / “with Jokic” insight.
3. **Insufficient-sample policy vs hero cards:** 14/0 still shows WITH team averages as a split.
4. **Explorer can show a selected teammate while rendering subject-mode results** after deep-link / `replaceState` (observed playoffs Jokić + Murray control vs team PTS 107.0).

### P2

5. Sample bar uses WITH date range only.
6. Identical truncated blurb on With and Without cards.
7. `unknownParticipationCount` looks for an exclude reason that is never emitted.
8. `loadWowyModelPair` double-loads games.
9. Equal subject/teammate query becomes self-mode instead of 422.
10. Headshot `alt=""`, comparison bars not exposed as a table.
11. 1-hour cache has no warehouse-hash invalidation (low risk in offseason).

### P3

12. Entitlement copy still says WOWY “when that surface ships.”
13. Dead 401 UI path.
14. “Denver Nuggets does…” grammar.
15. Methodology mentions `inferred_pgl` (accurate, jargony).

Do not treat lineup-not-implemented or possessions-not-implemented as defects of this slice; they are scoped out.

---

## LEAVE IT ALONE

Do **not** refactor these just because another WOWY design exists:

- `classifyWowyAppearance` / `"00"` vs `"0"` semantics aligned with minutes-eval.
- Missing teammate row = unknown, never inferred DNP.
- Required `teamId`; night-of `team_id` membership; no `player_team_stints` as trade dates.
- Fail-closed identity (`player_entity_id` + quarantine).
- Per-game = sum/count and per-minute = total/total minutes.
- ET basketball-date cutoff in `lib/wowy/cutoff.ts`.
- Model adapter refusing to infer a scenario from the target box.
- Isolation from frozen PTS C / REB C.
- Explicit “not possessions / not causal / not injury” methodology.
- Lineup placeholder that refuses to compute five-man stints from this grain.
- Unused index migration staying unused until an ops review.

---

## User-Facing Research Readiness

**YELLOW**

Safe to use `/wowy` as a **descriptive game-level research page** if the reader understands: Final box participation, verified `"00"` DNP, one team stint, 2023–2025, not on-court.

Not safe to treat picker counts, Opp PTS color, insufficient hero cards, or a desynced teammate select as gospel. Do not publish “role change” or “usage without X” narratives from this surface — those metrics are not implemented.

---

## Modeling Feature Readiness

**NOT_IMPLEMENTED** as a live feature source.

The unused adapter is a reasonable **starting point** (cutoff, unknown scenario, no pairwise summing) but is not wired, not as-of tested against production feature rows, and must not be pointed at the ungated page summarizer.

Do not add WOWY to frozen baseline comparison until a separate model-feature certification.

---

## Recommended Next Step

**UI semantics polish**

One action: make the explorer’s labels, picker counts, insufficient-sample cards, Opp PTS polarity, and teammate/URL/summary sync describe the classifier that already works. Do not rebuild WOWY, do not start lineup reconstruction, do not start Parlay Builder, do not train a WOWY model.

---

## Files Inspected

- `lib/wowy/types.ts`, `appearance.ts`, `calendar.ts`, `cutoff.ts`, `eligibility.ts`, `aggregate.ts`, `policy.ts`, `insights.ts`, `parse-query.ts`, `cache.ts`, `queries.ts`, `model-adapter.ts`, `index.ts`
- `lib/wowy/__tests__/*` (8 files)
- `app/wowy/page.tsx`, `layout.tsx`, `WowyExplorer.tsx`, `WowyResults.tsx`
- `app/api/wowy/{pair,model-pair,players,context}/route.ts`
- `components/betting/primary-nav.ts`, `betting-shell-paths.ts`
- `components/nba/PlayerHeadshot.tsx`
- `lib/entitlements/types.ts`
- `scripts/verify-wowy-examples.ts`, `scripts/compute-team-stats.ts`
- `db/schemas/MIGRATION_wowy_query_indexes.sql`
- `reports/product/game-level-wowy-v1.md`
- `reports/modeling/model-lab/WOWY_ARTIFACT_CONTRACT.md`
- `reports/modeling/shadow-pts-reb-c-r1/{manifest.json,feature_order.json}`
- Live warehouse via `analytics.player_game_logs`, `games`, `team_game_stats`, `players`, `player_identity_unresolved`
- Live `/wowy` and `/api/wowy/*` on local Next dev server

---

## Audit Limitations

- Read-only; no new invariant tests were added.
- 390px device metrics override was blocked; mobile grade is CSS + a11y tree, not a true phone screenshot.
- One UI walkthrough showed teammate-select vs summary desync; not reproduced across a matrix of browsers.
- OT was certified only as “included in the box,” not by reconstructing an OT game’s clock.
- Colon-minutes and mixed TGS fallbacks were certified as currently unused, not as future-proof parsers.
- Repo-wide TypeScript was not used as a WOWY pass/fail signal.

---

## Final Verdict

**YELLOW — WOWY is fundamentally sound but specific issues should be resolved before relying on it more broadly**

The classifier, identity path, stint isolation, and Jokić/Murray (and Luka stint) warehouse traces match the documented game-level contract. Lineups, possessions, props, Context Check, and model features are out of scope / not implemented. User-facing research is usable with caveats; modeling must not consume this until a later, as-of-safe feature certification.

**USER_FACING_RESEARCH: YELLOW**

**MODEL_FEATURE_SOURCE: NOT_IMPLEMENTED**
