# STEP 14P.X3B — Parlay XRay Historical Replay Matching

Date: 2026-09-15
Status: GREEN
Cost this step: $0
Real provider calls: 0

## Executive Result

Canonical XRay legs can be matched conservatively to stored **3-Hour Pre-Tip → Decision Close** player-prop rows in `analytics.player_prop_market_movement`. Different lines and missing books are partial, not silent exact matches. The matcher does not grade the bet and does not read outcomes. Extraction stayed disabled.

## Historical Sources Reused

| Asset | Use |
| --- | --- |
| `analytics.player_prop_market_movement` | Serving table. Grain `(game_id, player_id, prop_type, vendor)`. |
| `playerMarketMovementSql()` | Certified indexed lookup. |
| `PLAYER_PROP_REFERENCE_KIND` | `3_hour_pre_tip` |
| `PLAYER_PROP_COMPARISON_KIND` | `decision_close` |
| `PLAYER_PROP_V1_VENDORS` | betmgm, fanduel, draftkings, caesars |
| `isPlayerPropV1PropType` | Allowlist; RA is canonical in X3A but **not** stored in MM |
| X3A `CanonicalParlayLegResolution` | Identity already resolved; replay does not fuzzy-match names |

Not used: `player_prop_movement_summary`, `player_prop_history`, live `player_prop_lines`, box scores, `player_game_logs`, game-odds `opening_snapshot`.

## Coverage Audit

Read-only product query (2026-09-15):

| Metric | Value |
| --- | ---: |
| Rows | 21,132 |
| Distinct games | 121 |
| Distinct players | 274 |
| Books | 4 |
| Markets | 7 |
| 3-hour lines present | 21,132 |
| Decision-close lines present | 21,132 |
| Reference timestamp range | 2026-04-02 → 2026-05-02 UTC |

Books: BetMGM 6,856; FanDuel 6,466; DraftKings 4,184; Caesars 3,626.

Markets: points 4,716; rebounds 4,180; threes 3,397; assists 2,777; PRA 2,237; PR 2,116; PA 1,709.

This is **not** full-season coverage. `rebounds_assists` is not in the MM allowlist. Game-odds certified window (2026-03-09–03-22) is a separate dataset and was not used.

## Replay Input Contract

`HistoricalParlayLegReplayInput`: explicit `historicalDate`, canonical player id, game id, market, side, line, optional book, plus `playerResolved` / `gameResolved`. Built from X3A via `replayInputFromResolution`. Does not infer today.

## Replay Match Contract

`HistoricalParlayLegMatch`: status `MATCHED` \| `PARTIAL_MATCH` \| `NEEDS_CONFIRMATION` \| `NO_MATCH`; `lineQuality`; `exactness` flags; requested line/side; 3-hour and decision-close snapshots; available books. No numeric confidence. No good/bad copy.

## Game / Player Matching

Requires X3A `RESOLVED` player and game. Unresolved player → `NO_MATCH`. Unresolved game → `NEEDS_CONFIRMATION` (no nearest-game pick). Lookup key: `game_id + player_id + prop_type` (+ vendor when known).

## Market Matching

Uses X3A canonical ids only. MM allowlist: points, rebounds, assists, threes, PR, PA, PRA. Unsupported / RA → `NO_MATCH` / `UNSUPPORTED_MARKET`, never points.

## Exact Line Matching

Requested line vs `reference_line` and `comparison_line` (`LINE_UNCHANGED_EPSILON`). Equal to either snapshot → `EXACT_LINE_MATCH`. Otherwise `MARKET_MATCH_DIFFERENT_LINE` even if the same player/market/book exists.

## Sportsbook Matching

Known book found → `bookExact`. Known book missing → `PARTIAL_MATCH` / `BOOK_UNAVAILABLE` with alternatives listed; not treated as exact. Unknown book → `PARTIAL_MATCH` / `BOOK_UNKNOWN`; consensus is not stored and is not substituted as an exact book.

## Snapshot Matching

Always labeled **3-Hour Pre-Tip** (`3_hour_pre_tip`) and **Decision Close** (`decision_close`). Presence is reported independently. Close is never copied into a missing 3-hour snapshot, and 3-hour is never copied into missing close.

## As-Of Safety

Matching uses only MM market columns (ids, vendor, lines, odds, snapshot timestamps). Caller date is required context, not a nearest-time search. `live_current` is unused.

## Outcome-Leakage Prevention

SQL forbid-list: `player_game_logs`, `home_score`, `away_score`, outcome views, box scores, hit/miss. Tests prove those tokens throw. Smoke lookup uses `playerMarketMovementSql()` only. Matching works from in-memory MM rows with no stat tables present.

## Multiple Candidate Handling

PK is one row per book. Duplicate book rows → `NEEDS_CONFIRMATION`. Multiple books with unknown/missing requested book → `PARTIAL_MATCH` with the full alternative list (no first-row pick as exact).

## Exact vs Partial Match

`MATCHED` = player + game + market + book + line exact. Line mismatch or book mismatch → `PARTIAL_MATCH` with flags. Missing market → `NO_MATCH`.

## Different-Line Case

Requested 29.5 vs stored DK Jokic-style points 27.5/28.5 → `PARTIAL_MATCH` / `MARKET_MATCH_DIFFERENT_LINE`. Requested 27.5 against that row is exact at 3-hour even if close moved to 28.5.

## Book-Fallback Case

Requested FanDuel when only DraftKings/Caesars exist → `PARTIAL_MATCH` / `BOOK_UNAVAILABLE`. Alternatives listed. `matchedVendor` null.

## Snapshot-Absence Case

Rebounds fixture: 3-hour 12.5 present, close null → close `available: false`, not backfilled. Inverse close-only fixture: 3-hour stays unavailable.

## Real Historical DB Smoke Test

Read-only product query: 21,132 MM rows. Matcher loaded one stored `(game, player, prop, vendor)` via the certified SQL and returned `MATCHED` / `EXACT_LINE_MATCH` / kinds `3_hour_pre_tip` + `decision_close`. No writes. No OpenAI.

## Example Historical Match

Safe stored example (no outcome, no final points):

Canonical request: **Ajay Mitchell / points / Over / 11.5 / DraftKings / game `18447934`**

| Snapshot | Kind | Line | Over odds | Timestamp |
| --- | --- | ---: | ---: | --- |
| 3-Hour Pre-Tip | `3_hour_pre_tip` | 11.5 | -130 | 2026-04-02T22:30:00.000Z |
| Decision Close | `decision_close` | 12.5 | -107 | 2026-04-03T01:15:29.542Z |

If the requested line is **11.5**, this is an exact 3-hour line match with a later close of 12.5. If the requested line is **12.5**, that is exact at close. If the requested line is **13.5**, that is `MARKET_MATCH_DIFFERENT_LINE`. This report does not say whether the prop hit.

## Performance / Index Use

Lookup is `WHERE game_id=$1 AND player_id=$2 AND prop_type=$3 AND vendor = ANY($4)` on PK `(game_id, player_id, prop_type, vendor)`. Extra index `(player_id, game_id)` exists but is not required for this path. Corpus is not loaded into memory.

## Tests

`npx vitest run lib/parlay-xray` — **153 passed** (baseline 138). Includes in-memory 8–12-leg matrix, SQL leakage tests, and product DB smoke.

## Database / Provider Safety

Read-only. `.env` `PARLAY_XRAY_EXTRACTION_ENABLED=false`. No OpenAI, no BDL, no writes, no schema apply.

## Files Changed

- `lib/parlay-xray/replay/types.ts`
- `lib/parlay-xray/replay/match.ts`
- `lib/parlay-xray/replay/sql.ts`
- `lib/parlay-xray/replay/load.ts`
- `lib/parlay-xray/replay/index.ts`
- `lib/parlay-xray/replay/__tests__/*`
- `scripts/ops/run-parlay-xray-replay-coverage.ts`
- `reports/product/parlay-xray-historical-replay-matching.md`

Extraction and X3A resolution were not modified. No client barrel export.

## Schema Changes

**NONE**

## Remaining Risks

- Historical MM covers 121 games (2026-04-02–2026-05-02), not the full season.
- `rebounds_assists` cannot match MM rows.
- Unknown book never becomes an exact book match (by design).
- Replay is not wired to a public API or analysis layer.

## Recommended Next Step

X3C — replay analysis design (consume snapshots, still no bet-grading unless separately specified). Do not start it here. Do not enable public extraction.

## Verification Checklist

1. `.env` still has `PARLAY_XRAY_EXTRACTION_ENABLED=false`.
2. Vitest `lib/parlay-xray` is 153 passed.
3. Requested 29.5 vs stored 27.5/28.5 is not `MATCHED`.
4. Missing FanDuel is `PARTIAL_MATCH`, not a silent DraftKings exact.
5. Unresolved game does not pick the nearest game.
6. Replay SQL has no `player_game_logs` / scores.
7. Do not start X3C, analysis, or public extraction.

## Step Verdict

GREEN — historical XRay legs can be matched conservatively to stored pre-tip market history and are ready for replay analysis design
