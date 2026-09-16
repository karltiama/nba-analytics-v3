# STEP 14P.X3A — Parlay XRay Canonical Leg Resolution

Date: 2026-09-15
Status: GREEN
Cost this step: $0
Real provider calls: 0

## Executive Result

A conservative, catalog-injected canonical resolver maps `ExtractedParlayLeg` → Court Context player / team / game / market / side / line / sportsbook **without rewriting OCR**. Ambiguity stays `NEEDS_CONFIRMATION` or `UNRESOLVED`. No schema migration. Extraction stayed disabled.

## Existing Identity Infrastructure Reused

| Area | Reused |
| --- | --- |
| Player names | `normalizePersonName` (`lib/roster/normalize-player-name.ts`). Existing `resolvePlayerName` is DB/ILIKE; X3A uses a pure catalog so tests stay offline and last-name typos are not auto-matched. |
| Player IDs | Catalog rows are `analytics.players.player_id` + optional `player_entity_id` / NBA bridge. `lib/identity/resolvePlayerIdentity` remains the provider-id path and is **not** used for OCR names. |
| Teams | `TEAM_ALIASES` / `normalizeTeamKey` (`lib/providers/owls-insight/mapping.ts`) |
| Games | `analytics.games` shape via `start_time` + home/away abbr; ET date via `formatEtYmd`. **Not** `getNextGameForPlayer`. |
| Markets | `canonicalizePropType` + XRay kinds (`points` … `points_rebounds_assists`) |
| Side / line | `parsePropSide`, `parseLineValue` |
| Sportsbooks | `normalizeVendor` / `PLAYER_PROP_V1_VENDORS` |

No second player registry.

## Resolution Contract

`CanonicalParlayLegResolution` in `lib/parlay-xray/resolution/types.ts`:

- `originalLeg` (cloned, never mutated)
- `playerResolution` / `teamResolution` / `opponentResolution` / `gameResolution` / `marketResolution` / `sideResolution` / `lineResolution` / `sportsbookResolution`
- statuses: `RESOLVED` \| `NEEDS_CONFIRMATION` \| `UNRESOLVED`
- `coreResolved` / `fullyResolved` / `overallStatus` (`CORE_RESOLVED` vs `FULLY_RESOLVED`)

No numeric confidence scores.

## Original OCR Preservation

`resolveCanonicalParlayLeg` clones the leg. `playerDisplayName` `"Jockic"` stays `"Jockic"` on both the input and `originalLeg`. Canonical `"Nikola Jokic"` appears only on `playerResolution.candidates`.

## Player Resolution

Order: exact normalized full name → exact first+last → unique exact last name → initials (never auto-resolved) → strict last-name Levenshtein (distance ≤ 1, last name length ≥ 5) as **candidates only**.

Two or more hits → `NEEDS_CONFIRMATION` with all candidates. Zero hits → `UNRESOLVED`. Popularity is not used.

## Fuzzy / Alias Safety

Fuzzy never auto-resolves. Unique `Jockic` → `NEEDS_CONFIRMATION` + Nikola Jokic candidate. `J. Williams` → Jalen + Jaylin, no pick.

## Team Resolution

Known aliases (LAL / Lakers / Los Angeles Lakers, MIN / Minnesota Timberwolves, …). Unknown tokens (`XYZ`) stay unresolved. Missing team does not block core resolution.

## Game Resolution

Requires an explicit date (`eventDate` / `slateDate` / `asOfDate` / extracted `gameDate`) **and** two teams (abbrs or matchup). Unique stored game → `RESOLVED`. Multiple → `NEEDS_CONFIRMATION`. Missing date or no row → `UNRESOLVED`. Never “current game.”

## Historical / Current Context

Same function for current slate and historical replay: caller supplies the date. Resolver only matches `analytics.games`-shaped rows. No live fetch. No analysis.

## Market Canonicalization

Maps to existing Court Context ids: `points`, `rebounds`, `assists`, `threes`, `points_rebounds`, `points_assists`, `rebounds_assists`, `points_rebounds_assists`.

PTS/REB/AST/3PM/Threes/PR/PA/RA/PRA covered. Unknown labels are not coerced to points. `other` / blocks → `UNSUPPORTED_MARKET`.

## Side / Line Normalization

Over/Under → `over`/`under`. Missing side is unresolved (not inferred). Lines stay the extracted finite number (27.5 stays 27.5). Odds are preserved on the original leg and are not identity evidence.

## Sportsbook Resolution

DraftKings / FanDuel / BetMGM / Caesars (+ DK/FD aliases). Unknown books unresolved. Missing book does not block core resolution.

## Core vs Full Resolution

**CORE_RESOLVED:** player + market + side + line all `RESOLVED`.  
**FULLY_RESOLVED:** core + game `RESOLVED`.  
Sportsbook/team gaps do not hide a core miss.

## Confirmation Boundary

Ambiguous player/game returns structured `candidates`. The unique fuzzy candidate is listed, not selected (`value` remains null until `RESOLVED`). No review UI in this step.

## Leakage Safety

Catalog SQL does not select `home_score`, `away_score`, or `player_game_logs`. Resolver does not use outcomes, box stats, future roster, or transactions. Player matching is name-only (no current-team popularity).

## Jockic Test

Extracted `"Jockic"` → `NEEDS_CONFIRMATION`, candidate Nikola Jokic (`203999`). Original string unchanged. Threshold was not loosened to auto-resolve this typo.

## Ambiguity Tests

Exact unique match; unique last name; Jockic typo; `J. Williams` initials; common surname `Williams`; no player found.

## Game Tests

A date+matchup unique; B player-only / no date → game unresolved; C invalid matchup → `NO_GAME`; D historical `asOfDate` 2025-04-01; E nonexistent date; duplicate same-day matchup → `NEEDS_CONFIRMATION`.

## Market Tests

Points/PTS, Rebounds/REB, Assists/AST, 3PM/Threes/3-Pointers Made, PR/PA/RA/PRA. Unknown ≠ points.

## Database / Provider Safety

Read-only loader with injected query. No writes. No OpenAI. No BDL. Tests use in-memory catalogs shaped like Court Context rows (no live network for resolution). `.env` kill switch unchanged (`false`).

## Tests

`npx vitest run lib/parlay-xray` — **138 passed** (baseline 98).

## Files Changed

- `lib/parlay-xray/resolution/types.ts`
- `lib/parlay-xray/resolution/names.ts`
- `lib/parlay-xray/resolution/player.ts`
- `lib/parlay-xray/resolution/team.ts`
- `lib/parlay-xray/resolution/game.ts`
- `lib/parlay-xray/resolution/market.ts`
- `lib/parlay-xray/resolution/sportsbook.ts`
- `lib/parlay-xray/resolution/resolve-leg.ts`
- `lib/parlay-xray/resolution/load-catalog.ts`
- `lib/parlay-xray/resolution/index.ts`
- `lib/parlay-xray/resolution/__tests__/fixtures.ts`
- `lib/parlay-xray/resolution/__tests__/player.test.ts`
- `lib/parlay-xray/resolution/__tests__/market.test.ts`
- `lib/parlay-xray/resolution/__tests__/game.test.ts`
- `lib/parlay-xray/resolution/__tests__/resolve-leg.test.ts`
- `lib/parlay-xray/resolution/__tests__/safety.test.ts`
- `reports/product/parlay-xray-canonical-leg-resolution.md`

Not wired into the client barrel (stays server-side). No extract/quota/AWS changes. No UI redesign.

## Schema Changes

**NONE.** Loader reads existing `analytics.players`, `analytics.teams`, `analytics.games`, `analytics.player_provider_ids`.

## Remaining Risks

- OCR typos remain confirmation, not silent canonical rewrite.
- Initials and shared surnames require a future review UI before analysis.
- Game resolution needs a caller-supplied date/slate; slips without a date stay core-only.
- Catalog must be loaded server-side in a later API step; this step ships the service only.

## Recommended Next Step

Historical replay matching: given a resolved core leg + as-of slate, attach the stored game and freeze identity before any analysis. Do not start it in this step. Do not enable public extraction.

## Verification Checklist

1. `.env` still has `PARLAY_XRAY_EXTRACTION_ENABLED=false`.
2. `npx vitest run lib/parlay-xray` is 138 passed.
3. `"Jockic"` is still the extracted display text after resolve.
4. `J. Williams` is not auto-assigned a single player.
5. A player-only leg does not invent a current game.
6. No SQL migration was applied.
7. Do not start historical replay, analysis, or public extraction.

## Step Verdict

GREEN — canonical XRay leg resolution is implemented conservatively and ready for historical replay matching
