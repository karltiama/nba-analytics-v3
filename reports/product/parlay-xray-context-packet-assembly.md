# STEP 14P.X3C — Parlay XRay Historical Context Packet Assembly

Date: 2026-09-15
Status: GREEN
Cost this step: $0
Real provider calls: 0

## Executive Result

A reusable factual `XRayLegContext` packet can be assembled from a certified X3A resolution, an X3B historical match, and an explicit `contextCutoffAt`. Player form, role minutes, and team/matchup counting stats use only games with `start_time < cutoff` and `game_id <> target`. WOWY, archived projections, and injury/availability fail closed as `UNAVAILABLE` with explicit reasons. The packet does not grade the bet, include the target box, or emit Over/Under language.

## Source Audit

| Source | Used in X3C | Notes |
| --- | --- | --- |
| X3A `CanonicalParlayLegResolution` | Yes | Identity only; cloned original leg; not mutated |
| X3B `HistoricalParlayLegMatch` | Yes | Market section copied factually |
| `analytics.player_game_logs` + `analytics.games.start_time` | Yes | Prior played games; no scores |
| `analytics.team_game_stats` + `games.start_time` | Yes | Pace / points / points allowed as-of |
| `analytics.player_prop_market_movement` | Via X3B only | Not re-queried by form/matchup |
| `analytics.player_season_averages` | No | End-of-season / future-including |
| `analytics.team_season_averages` | No | Same |
| Public `/wowy` | No | Retrospective, no as-of control |
| `summarizeWowyBeforeCutoff` | Not wired | Cutoff-safe but needs a teammate pair the slip does not provide |
| `analytics.prediction_snapshots` | Read if present | Product DB relation missing → empty |
| `analytics.prediction_settlements` | No | Contains `actual_pts` |
| `raw.player_injuries` / `injury_pull_runs` | No | BDL provider ids; not a canonical XRay mapping |
| `analytics.game_starters` | No | Post-tip confirmed |

## As-Of Safety Classification

| Candidate | Class | Why |
| --- | --- | --- |
| Player game logs joined to `games.start_time` | **AS_OF_SAFE** | `start_time < cutoff` and target `game_id` excluded |
| Team game stats joined to `games.start_time` | **AS_OF_SAFE** | Same predicates; pace/points_allowed are prior-game rows |
| X3B 3-hour / decision-close snapshots | **AS_OF_SAFE** | Certified pre-tip market kinds; outcomes not read |
| `player_season_averages` / `team_season_averages` | **RETROSPECTIVE_ONLY** | Not as-of; unused |
| Public `/wowy` | **RETROSPECTIVE_ONLY** | Unused |
| WOWY model adapter | **AS_OF_SAFE** if teammate + cutoff supplied | Not used; no slip teammate |
| `prediction_snapshots` | **AS_OF_SAFE** when `generated_at < cutoff` | No product rows; table missing |
| Frozen PTS C / REB C recomputed today | **RETROSPECTIVE_ONLY** | Not recomputed |
| `raw.player_injuries` | **LIMITED** provenance | Provider id tape exists Mar–May 2026; not mapped for XRay |
| `analytics.game_starters` | **RETROSPECTIVE_ONLY** | Postgame confirmed |
| Minutes `"00"` as injury | **UNAVAILABLE** | Certified DNP token, not injury |

## Context Contract

`XRayLegContext` in `lib/parlay-xray/context/types.ts`:

- `identity`, `market`, `playerForm`, `role`, `matchup`, `wowy`, `projection`, `availability`, `dataQuality`
- Section statuses: `AVAILABLE` \| `LIMITED` \| `UNAVAILABLE` \| `NEEDS_CONFIRMATION`
- No numeric confidence. Missing sections use `{ status, reason }` rather than silent null.

Entry point: `assembleXrayLegContext({ resolution, match, contextCutoffAt, season, playerTeamId, opponentTeamId, sources })`.

## Context Cutoff

Required ISO timestamp `contextCutoffAt`. Prefer the target game’s scheduled tip (`analytics.games.start_time`). Parsed to UTC. Empty/invalid cutoff → identity `NEEDS_CONFIRMATION` / `MISSING_CONTEXT_CUTOFF` and no history windows. `Date.now()` is not used.

History rows must satisfy both:

1. `start_time < contextCutoffAt`
2. `game_id <> targetGameId`

## Identity Context

Forwards X3A player, game, market, side, line, sportsbook, abbreviations, historical date, and cutoff. `originalLeg` is cloned so X3A is not mutated.

## Market Context

X3B status is preserved: `MATCHED` → `AVAILABLE`, `PARTIAL_MATCH` → `LIMITED`, `NEEDS_CONFIRMATION` unchanged, `NO_MATCH` → `UNAVAILABLE`.

Factual fields: requested/matched book, requested line, 3-Hour Pre-Tip line/odds/timestamp, Decision Close line/odds/timestamp, `lineDeltaCloseMinusThreeHour`, `lineDeltaThreeHourMinusRequested`, American odds delta for the requested side, snapshot availability flags.

Not written: “moved in his favor”, “sharp money”, implied probability.

## Player Form

Played games only (`minutes > 0`). Components:

- Season-to-date average for the canonical market (same `season` as the request)
- Last 5 / last 10 prior played games (current + previous season may appear in the last-N window; still before cutoff)
- Line-relative counts vs the requested line on the last-10 sample: above / below / equal

Statuses: 0 games `UNAVAILABLE` / `NO_PRIOR_GAMES`; 1–9 `LIMITED` / `SMALL_PRIOR_SAMPLE`; 10+ `AVAILABLE`.

## Line-Relative History

Counts only. Example from the Ajay packet: last 10 prior games, 6 above 11.5, 4 below, 0 equal. Not converted to a hit rate or tonight probability.

## Role Context

Prior-game minutes, season-to-date minutes average, last-5 / last-10 minutes, played-game count. Starters: `UNAVAILABLE` / `STARTERS_POSTGAME_CONFIRMED`. Target-game minutes are not used.

## Matchup Context

Opponent abbreviation from X3A. Team ids mapped from the stored game’s home/away ids (not abbreviation strings). Prior-season-to-date:

- player team pace
- opponent pace
- opponent points allowed
- player team points

Missing stats → `LIMITED` / `MISSING_TEAM_STATS` or `SMALL_PRIOR_SAMPLE`. No positional-defense invention. `team_season_averages` unused.

## WOWY Context

Always `UNAVAILABLE` / `NO_AS_OF_SAFE_WOWY_SOURCE`.

The certified cutoff adapter exists (`summarizeWowyBeforeCutoff`) but requires an explicit teammate pair. X3C does not invent teammates or call `/wowy`. This is fail-closed success, not a silent retrospective read.

## Projection Context

Reads `analytics.prediction_snapshots` only when `generated_at < cutoff` and `intended_cutoff_at < cutoff` for the same player/game. Product DB does not have the relation; loader treats that as empty. Result: `UNAVAILABLE` / `NO_ARCHIVED_PREGAME_PROJECTION`. Frozen PTS/REB models were not rerun. Settlements (`actual_pts`) are not read.

## Availability / Injury Context

Always `UNAVAILABLE` / `NO_HISTORICAL_INJURY_SNAPSHOT`. No reconstruction from target minutes or `"00"` DNP rows. The 2026 BDL injury tape is not wired (provider player ids, no certified XRay mapping).

## Starters / Lineup Provenance

`analytics.game_starters` is post-tip confirmed in existing modeling notes. Excluded from pregame XRay context. Role minutes come only from prior played games.

## Data Quality

Boolean/count flags, not a score: player/game resolved, market exact/partial, same-book, exact line, 3-hour/close presence, prior sample sizes, last-5/last-10 counts, and each section’s status.

## Combo Markets

Form computes PR / PA / RA / PRA from log components. X3B market coverage is independent. Tested: RA market `UNSUPPORTED_MARKET` while player-form RA remains `AVAILABLE` from rebounds+assists.

## Leakage Prevention

Assembler filters injected target and future rows. SQL uses strict `< cutoff` and `game_id <> $3`. Forbidden tokens include `home_score`, `away_score`, `actual_pts`, `prediction_settlements`, season-average tables, `game_starters`.

## Target-Game Exclusion Test

`lib/parlay-xray/context/__tests__/leakage.test.ts`: inserting or mutating a 99-point target-game log does not change form/role/matchup. Team target-game pace/points are ignored.

## Future-Game Exclusion Test

Same file: inserting or mutating a later game does not change the packet. Future team games are ignored.

## Real Historical Context Example

Read-only product dump, Ajay Mitchell / Points / Over 11.5 / DraftKings / game `18447934`. Cutoff = stored tip `2026-04-03T01:30:00.000Z`. No final points, no hit/miss, no final score.

| Section | Factual packet |
| --- | --- |
| Identity | Ajay Mitchell `1028037477`, OKC vs DEN, points Over 11.5, draftkings |
| Market | MATCHED / EXACT_LINE_MATCH. 3-hour 11.5 (-130) at 2026-04-02T22:30Z. Close 12.5 (-107) at 2026-04-03T01:15:29Z. Line delta close−3h = +1.0 |
| Player form | STD 53 GP, 14.0 PPG. Last 5: 11.8. Last 10: 13.5. Last 10 vs 11.5: 6 above, 4 below, 0 equal |
| Role | Prior game 36 minutes. STD 26.2 MPG (53). Last 5: 25. Last 10: 26.2. Starters unavailable |
| Matchup | OKC team id 21, DEN team id 14. OKC prior pace 101.9 (76). DEN prior pace 100.3 (76). DEN points allowed 114.7 (76). OKC team points 118.6 (76) |
| WOWY | UNAVAILABLE / `NO_AS_OF_SAFE_WOWY_SOURCE` |
| Projection | UNAVAILABLE / `NO_ARCHIVED_PREGAME_PROJECTION` |
| Availability | UNAVAILABLE / `NO_HISTORICAL_INJURY_SNAPSHOT` |

Role `gamesPlayed` 102 counts loaded played games across the current and previous season windows; season-to-date remains 53.

## Performance

Constrained lookups:

- Player logs: `player_id` + `start_time < cutoff` + `game_id <> target` + season `IN (season, season-1)`
- Team stats: `team_id = ANY(home, away)` + same time/game/season predicates
- Projections: `player_id + game_id` + `generated_at < cutoff`, limit 5

Indexes relied on: `player_game_logs` PK `(game_id, player_id)`, `analytics_player_game_logs_player_season_idx`, `games` PK, `team_game_stats` PK `(team_id, game_id)`, `analytics_tgs_team_season_idx`. Full player-career or full-season tables are not loaded into the assembler.

## Database / Provider Safety

Read-only. No writes. No schema apply. No OpenAI. No BDL. No quota/AWS/Terraform changes. Extraction v2.1, X3A, and X3B were not modified in this step. Context is not exported from the client barrel `lib/parlay-xray/index.ts`.

## Tests

`npx vitest run lib/parlay-xray` — **204 passed** (baseline 153).

Includes player-form matrix (10+, 5–9, 1–4, 0, combo, target/future exclusion), matchup matrix, X3B market distinctions, WOWY/projection/availability fail-closed, SQL outcome/cutoff guards, and product DB smoke for game `18447934`.

## Files Changed

- `lib/parlay-xray/context/*` (types, cutoff, assemble, identity, market, player-form, role, matchup, wowy, projection, availability, data-quality, stats, sql, load, index)
- `lib/parlay-xray/context/__tests__/*`
- `scripts/ops/run-parlay-xray-x3c-example.ts`
- `reports/product/parlay-xray-context-packet-assembly.md`

## Schema Changes

**NONE**

## Remaining Gaps

- No archived pregame projection row for this replay game (table absent on product).
- No XRay-safe injury/availability mapping.
- WOWY unused until a teammate condition is an explicit input.
- Last-N form may include previous-season games; STD does not.
- Matchup pace is stored `team_game_stats.pace`, not a newly certified possession model.

## Recommended Next Step

STEP 14P.X3D: interpretation/UI design on top of this factual packet (strongest/weakest, favorable/mixed labels). Do not enable public extraction. Do not start Parlay Explorer.

## Verification Checklist

1. `npx vitest run lib/parlay-xray` → 204 passed.
2. Confirm extraction, resolution, and replay modules were not required for this step.
3. `npx tsx scripts/ops/run-parlay-xray-x3c-example.ts` prints the Ajay packet with no final points.
4. Packet WOWY / projection / availability remain `UNAVAILABLE` with reasons.
5. Confirm legs / XRay analysis UI was not added.

## Step Verdict

**GREEN** — factual XRay context packets are assembled with certified as-of safety and are ready for interpretation design.
