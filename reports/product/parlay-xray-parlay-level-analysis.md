# STEP 14P.X3E — Parlay XRay Parlay-Level Context + Dependency Analysis

Date: 2026-09-15
Status: GREEN
Cost this step: $0
Real provider calls: 0

## Executive Result

A pure `interpretXrayParlay(XRayLegInterpretation[])` layer now produces `XRayParlayInterpretation`: coverage counts, structural dependency groups, shared missing-data gaps, review-needed flags, and a parlay-level “Why this parlay could fail” list. No numeric score, no win probability, no measured correlation. The Historical Replay preview (`?preview=analysis`) is a 4-leg slip on certified game `18447934`. Confirm still does not run analysis. Extraction was not enabled.

## Existing Inputs

Parlay analysis reads only certified X3D `XRayLegInterpretation` fields:

| Input | Used |
| --- | --- |
| playerDisplayName, market, side, line | Identity, duplicates, conflicts |
| gameId, teamAbbr, opponentAbbr | SHARED_GAME / TEAM / OPPONENT |
| marketPosition.kind | Portfolio counts |
| recentForm.lineRead / sampleBand | Form aggregation, LIMITED_SAMPLE |
| role.minutesVsSeason | SHARED_ROLE_ASSUMPTION |
| counterContext / dataAvailability | Countersignals and gaps |
| X3A playerId / X3B snapshots / box scores | Not queried |

No new database queries.

## Parlay Interpretation Contract

`XRayParlayInterpretation` in `lib/parlay-xray/interpretation/parlay-types.ts`:

- `legCount`, `contextCoverage`, `dependencyGroups[]`, `sharedAssumptions[]`
- `supportingContext[]`, `crossLegUncertainties[]`, `whyThisParlayCouldFail[]`
- `reviewNeeded[]`, `marketPositionCounts`, `formCounts`, `dataQuality`
- `summaryState`, `summarySentence`

Entry: `interpretXrayParlay(legs)`.

## Context Coverage

Factual counts: total legs, identity resolved vs needs confirmation, market matches, exact vs partial books, recent-form availability, last-10 windows, WOWY / projection / availability have/of.

Not combined into a score.

## Structural Dependency Model

Kinds: `SHARED_PLAYER`, `SHARED_GAME`, `SHARED_TEAM`, `SHARED_OPPONENT`, `SHARED_GAME_ENVIRONMENT`, `SHARED_ROLE_ASSUMPTION`, plus duplicate / opposite-side / logical-conflict kinds.

Copy uses “depend on” / “share.” Never “correlation coefficient,” “positively correlated,” or implied joint probability.

## Same-Player Dependencies

Two or more legs with the same normalized player name → `SHARED_PLAYER`. Why-fail example: two Ajay Mitchell legs (points and assists).

## Same-Game Dependencies

Two or more legs with the same `gameId` → `SHARED_GAME`. If that group includes more than one `teamAbbr`, also `SHARED_GAME_ENVIRONMENT`. Opposing-team legs are not auto-classified as conflicting.

## Same-Team Dependencies

Two or more distinct players with the same `teamAbbr` → `SHARED_TEAM` (“same team's offensive environment”).

## Logical Conflict Handling

Same player, same market, same game, Over A and Under B: both can hit only if `A < result < B`. If `A >= B`, emit `LOGICAL_CONFLICT`. Over 27.5 / Under 30.5 is opposite-side only, not impossible.

## Duplicate / Near-Duplicate Legs

Exact same player/market/side/line → `DUPLICATE_LEG` (not merged). Same player/market/side with a different line → `NEAR_DUPLICATE_LEG`. Opposite side → `OPPOSITE_SIDE_SAME_MARKET`, then conflict check.

## Shared Missing Context

If WOWY, projection, or availability is 0/N, emit a parlay-level uncertainty. Availability also appears in why-fail (“unavailable for all N legs”).

## Counter-Signal Aggregation

Count legs with at least one FORM `counterContext` item. Two or more → why-fail. Market worse-than-close is counted separately.

## Supporting Context

Canonical identity coverage, last-10 form windows, and captured lines equal to or better than Decision Close. Not labeled as why the parlay will win.

## Why This Parlay Could Fail

Signature list from shared player/game/team/role, logical conflicts, duplicates, shared availability gap, form countersignals, worse-than-close counts, partial books, and small samples. Every item has a reason code and leg indexes.

## Review-Needed Flags

Per leg, unordered: `NEEDS_IDENTITY_CONFIRMATION`, `PARTIAL_MARKET_MATCH`, `LIMITED_SAMPLE`, `MISSING_CONTEXT`, `COUNTERSIGNALS_PRESENT`. No strongest/weakest ranking.

`MISSING_CONTEXT` is identity/game/form unavailability — not the historical WOWY gap that applies to every replay leg.

## Data Quality

`have/of` for canonical, market (exact + partial), recent form, role, WOWY, projection, availability.

## Historical Fixture

`buildHistoricalParlayContexts()`:

1. Ajay Mitchell Points Over 11.5 — certified X3C packet
2. Ajay Mitchell Assists Over 3.5 — cloned shape; same player/game/role minutes
3. Luguentz Dort Points Over 9.5 — cloned shape; same team/game; partial book; 3-game sample
4. Nikola Jokić Rebounds Over 12.5 — cloned shape; same game, opposing team; worse than close; form below more often

Legs 2–4 are demonstration packets, not newly assembled from Postgres, and include no outcomes. Cutoff `2026-04-03T01:30:00.000Z`, game `18447934`.

## Parlay Summary UI

Top of results: Parlay XRay heading, restrained summary state, coverage counts, better/same/worse/unknown close counts.

## Dependency UI

“Shared context” stacked cards with kind labels (Same player / Same game / Same team). Explicitly not measured correlations.

## Failure Analysis UI

Amber “Why this parlay could fail” is separate from each leg’s own section.

## Data Coverage UI

“Data coverage” `have/of` rows. Zeros use slate, not error red.

## Mobile / Accessibility

Cards stack; leg chips wrap; review flags are text labels. Semantic `h2`/`h3`. Browser-checked at ~1280 and 390 widths after implementation.

## Outcome-Leakage Boundary

Interpreter does not read final points, hit/miss, or game results. Adding `finalPoints` / `hit` beside unchanged interpretations does not change output. No assemble/sql/fetch/`Date.now()`.

## Privacy

No new Umami events. Results UI still does not send player names, lines, odds, or dependency text.

## Tests

`npx vitest run lib/parlay-xray` → **238 passed**.

Matrix: independent legs, same player, same game, same team, duplicate, near-duplicate, overlapping opposite side, true conflict, partial market, shared gaps, mixed market position, review flags, determinism, unused outcome keys, 4-leg fixture.

## Files Changed

- `lib/parlay-xray/interpretation/parlay-types.ts`
- `lib/parlay-xray/interpretation/parlay.ts`
- `lib/parlay-xray/interpretation/parlay-fixture.ts`
- `lib/parlay-xray/interpretation/preview.ts`
- `lib/parlay-xray/interpretation/display.ts`
- `lib/parlay-xray/interpretation/index.ts`
- `lib/parlay-xray/interpretation/__tests__/parlay.test.ts`
- `lib/parlay-xray/__tests__/page-contract.test.ts`
- `components/parlay-xray/XrayParlaySummary.tsx`
- `components/parlay-xray/XrayResultsPanel.tsx`
- `reports/product/parlay-xray-parlay-level-analysis.md`

## Schema Changes

NONE.

## Remaining Gaps

- Live Confirm still does not assemble X3C or interpret X3D/X3E.
- Measured historical correlation is not implemented (by design).
- Legs 2–4 in the preview are structural clones, not separately certified X3C assemblies.
- Parlay Explorer is not started.
- Public extraction remains disabled.

## Recommended Next Step

End-to-end historical replay validation: run a real multi-leg slip through X3A → X3B → X3C → X3D → X3E without enabling public extraction.

## Verification Checklist

1. Open `/parlay-xray?preview=analysis` and confirm Historical Replay (April 3, 2026 / game 18447934).
2. Confirm 4 legs, shared-game and same-player groups, no “correlation” language.
3. Confirm Why this parlay could fail is separate from per-leg why-fail.
4. Confirm Data coverage shows WOWY / Projection / Availability 0/4 without error red.
5. Confirm Dort is in Legs needing review (partial market / limited sample).
6. Confirm no parlay score, win probability, or strongest/weakest ranking.
7. Confirm Confirm on a normal slip still does not attach interpretation.

## Step Verdict

GREEN — deterministic parlay-level XRay context and dependency analysis are implemented and ready for end-to-end historical replay validation
