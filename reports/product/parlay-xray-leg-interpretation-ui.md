# STEP 14P.X3D — Parlay XRay Leg Interpretation + Results UI

Date: 2026-09-15
Status: GREEN
Cost this step: $0
Real provider calls: 0

## Executive Result

A pure `interpretXrayLeg(XRayLegContext)` layer now turns a certified X3C packet into a deterministic `XRayLegInterpretation` with structured evidence, no numeric confidence, and no LLM. The first production results UI is wired through `?preview=analysis` as a labeled Historical Replay of the Ajay Mitchell packet. Public Confirm still does not assemble context or interpret legs. Extraction flags were not changed.

## Existing UI Audit

Inspected `/parlay-xray` and reused:

| Piece | Reuse |
| --- | --- |
| Upload dropzone + extract CTA | Unchanged. Extract stays user-initiated and is hidden on historical replay. |
| Extracted-leg editor, checkmark accept, Confirm | Unchanged. Confirm still only sets `confirmed`. |
| `PlayerHeadshot` + `MatchupLine` / `TeamLogo` | Reused on interpretation cards. |
| Mint / Court Context tokens (`#063f46`, `#55ddb1`, `#DCE9EA`, `#f7f9f7`) | Reused. |
| Amber “Why this could fail” treatment | Reused as the per-leg signature section. |
| Fictional `XrayAnalysisPanel` (`?preview=1`) | Kept for layout review. Hidden when interpretations exist. Strongest/weakest cards are not shown on analysis preview. |
| `?preview=partial` | Unchanged. |
| Analysis placeholder copy | Remains for the unconfirmed public path. |

Not redesigned: upload grid, stage list, extracted-leg panel.

## Interpretation Contract

`XRayLegInterpretation` in `lib/parlay-xray/interpretation/types.ts`:

- identity, marketPosition, recentForm, role, matchup
- supportingContext[], counterContext[], uncertainties[], whyItCouldFail[]
- dataAvailability, summaryState, summarySentence

Each evidence item has `code`, `category`, `title`, `detail`.

`interpretXrayLeg` consumes only an already-built `XRayLegContext`. It does not query Postgres, call providers, or know about screenshot extraction.

## Deterministic Rules

1. Same packet → same interpretation (JSON equality). No `Date.now()`, network, RNG, or LLM.
2. Zero prior games (`sampleCount <= 0`) → `LIMITED_DATA`, even if a market number comparison exists.
3. Sample 1–4 with no support and no counters → `LIMITED_DATA`.
4. Counters only → `COUNTERSIGNALS_PRESENT`.
5. Support and counters → `MIXED_CONTEXT`.
6. Support only → `SUPPORTIVE_CONTEXT`.
7. Otherwise with a usable sample → `NEUTRAL_CONTEXT`.

Sample bands (not forecasts): 0 `ZERO`, 1–4 `SMALL_SAMPLE`, 5–9 `PARTIAL_SAMPLE`, 10+ `WINDOW_AVAILABLE`. Ten games are not treated as conclusive.

## Market Position

Bettor-side comparison of requested line vs Decision Close:

| Side | requested < close | requested = close | requested > close |
| --- | --- | --- | --- |
| Over | `BETTER_NUMBER_THAN_CLOSE` | `SAME_AS_CLOSE` | `WORSE_NUMBER_THAN_CLOSE` |
| Under | `WORSE_NUMBER_THAN_CLOSE` | `SAME_AS_CLOSE` | `BETTER_NUMBER_THAN_CLOSE` |

Missing close → `UNKNOWN`. Movement is described as a number obtained, not as sharp/public money. Odds are reported as a price change only. Historical 3-hour is labeled **3-Hour Pre-Tip**, never Opening or Live.

## Recent Form

Uses X3C pregame windows only. Exposes season / last-5 / last-10 averages and raw above/below counts. Line reads: `ABOVE_MORE_OFTEN_THAN_BELOW`, `BELOW_MORE_OFTEN_THAN_ABOVE`, `EVEN_SPLIT`, `LIMITED_SAMPLE`. Counts are never converted to tonight’s probability.

## Role Context

Prior-game, season, last-5, and last-10 minutes. A ≥5 minute gap vs season is `ABOVE` / `BELOW`. For Overs, minutes below season is a counter; for Unders, minutes above season is a counter. No invented role labels (Alpha, usage monster). No injury inference.

## Matchup Context

Renders packet pace / points / points allowed with labels. No “easy matchup” or “smash spot” language. No new speculative metrics.

## Supporting Context

Built only from explicit conditions, including:

- `MARKET_BETTER_NUMBER_THAN_CLOSE`
- season average on the helpful side of the line (`FORM_STD_ABOVE_LINE` / `FORM_STD_BELOW_LINE`)
- majority of the recent window finishing on the helpful side of the line

## Counter Context

Built only from explicit conditions, including worse-than-close number, majority against the requested side, and material minutes against the side. Copy stays factual (“Below this line in 7 of the previous 10 games”), not “this is a bad bet.”

## Uncertainties

First-class coverage gaps: missing 3-hour or close, partial / unmatched book, even split, small/zero sample, no as-of-safe WOWY, no archived projection, no historical availability, postgame-only starters.

## Why This Could Fail

Per-leg list from packet-backed counters and coverage gaps. No generic “anything can happen.” Ajay Over 11.5 includes the 4-of-10 below-line note and the missing availability snapshot.

## Summary State

Copy map: Supportive context / Mixed context / Countersignals present / Limited data / Neutral context.

Forbidden: STRONG BET, WEAK BET, BEST BET, HIGH/LOW CONFIDENCE, LOCK, FADE.

Ajay sentence is deterministic from the first supporting detail (captured 11.5 below the 12.5 Decision Close).

## Over / Under Symmetry

Explicit tests: Over 11.5 vs close 12.5 and Under 12.5 vs close 11.5 are both better numbers. Worse-than-close and same-as-close are covered on Overs; marketPositionKind covers both sides.

## Combo Markets

Identity and form keep `points_rebounds`, `points_assists`, `rebounds_assists`, `points_rebounds_assists`. A combo with unavailable historical market still reports player-form when the packet has it.

## Historical Replay Labeling

`?preview=analysis` sets `historicalReplay` (`April 3, 2026`, game `18447934`, cutoff `2026-04-03T01:30:00.000Z`) and `designPreview: false`. Banner: **Historical Replay** — not a live September 2026 recommendation. Fictional `?preview=1` banner remains separate.

## Results UI

`XrayResultsPanel` hierarchy: XRay summary → factual parlay counts → per-leg cards (identity, summary badge + sentence, Market / Form / Role / Matchup / Data Coverage) → 3-Hour Pre-Tip → Decision Close → form / minutes / matchup → supporting / counter → WOWY / Projection / Availability gap cards → Why this could fail → data limitations.

Missing sources use restrained slate styling, not error red.

## Multi-Leg Support

Component takes `XRayLegInterpretation[]`. `summarizeInterpretations` reports leg count, full-context count, limited count, market matches, and partial matches. No strongest/weakest ranking. No parlay score, win probability, EV, or overall pick.

## Mobile / Responsive

Leg cards, indicators, and market snapshots stack (`grid-cols-1` / `sm` / `lg`). Names and values use `min-w-0` and wrap. Browser-checked at 1280, 768, and 390: `scrollWidth === clientWidth` at 768 and 390. Long player/market names wrap; 3-Hour Pre-Tip / Decision Close stack on small screens.

## Accessibility

Semantic `h2` / `h3` / `h4`. Summary and coverage use text labels, not color alone. Existing upload/extract/confirm controls remain keyboard reachable. Historical Replay uses `role="status"`.

## Ajay Mitchell Example

Packet: Over 11.5, DraftKings, game 18447934.

| Field | Interpretation |
| --- | --- |
| Market | `BETTER_NUMBER_THAN_CLOSE` (11.5 vs Decision Close 12.5; 3-Hour 11.5 −130 → Close 12.5 −107) |
| Form | Season 14.0 PPG / 53; last 10 13.5; 6 above · 4 below 11.5 |
| Role | Last game 36.0 vs season 26.2 MPG |
| WOWY / projection / availability | Explicitly unavailable |
| Summary | `SUPPORTIVE_CONTEXT` |
| Why it could fail | Below 11.5 in 4 of previous 10; no historical availability snapshot |
| Outcome | Not shown |

## Leakage Boundary

X3D reads only `XRayLegContext`. Adding `finalPoints` / `hit` beside the packet does not change output. Interpreter source has no assemble/sql/pg/fetch/`Date.now()`. No new queries.

## Privacy / Analytics

No new Umami events for interpretation. Existing extract events still send `surface` + `result_category` only. Results UI does not call `trackEvent` with player, line, odds, or evidence text.

## Tests

`npx vitest run lib/parlay-xray` → **222 passed**.

Coverage: Ajay fixture, Over/Under better-number, worse, same, missing close, partial book, form matrix, combo vs unavailable market, data gaps, determinism, unused outcome keys, parlay summary counts, session Confirm-does-not-interpret, historical preview not marked fictional, page contract for `?preview=analysis` / Historical Replay / no confidence copy.

## Files Changed

- `lib/parlay-xray/interpretation/types.ts`
- `lib/parlay-xray/interpretation/interpret.ts`
- `lib/parlay-xray/interpretation/ajay-context.ts`
- `lib/parlay-xray/interpretation/preview.ts`
- `lib/parlay-xray/interpretation/display.ts`
- `lib/parlay-xray/interpretation/index.ts`
- `lib/parlay-xray/interpretation/__tests__/interpret.test.ts`
- `lib/parlay-xray/interpretation/__tests__/display.test.ts`
- `lib/parlay-xray/copy.ts` (`preview=analysis`)
- `lib/parlay-xray/session.ts`
- `lib/parlay-xray/__tests__/session.test.ts`
- `lib/parlay-xray/__tests__/page-contract.test.ts`
- `components/parlay-xray/UploadDropzone.tsx`
- `components/parlay-xray/XrayResultsPanel.tsx`
- `components/parlay-xray/ParlayXrayView.tsx`
- `app/parlay-xray/ParlayXrayClient.tsx`
- `reports/product/parlay-xray-leg-interpretation-ui.md`

## Schema Changes

NONE. No persistence. No migration proposed.

## Remaining Gaps

- Live-season context is not connected to Confirm.
- Public/paid extraction remain product-disabled at the XRay client contract (`SCREENSHOT_EXTRACTION_AVAILABLE = false`). This step did not flip kill switches.
- Full parlay correlation / dependency analysis is not implemented.
- Parlay Explorer is not implemented.
- Archived projection, as-of-safe WOWY, and historical availability still fail closed when X3C says unavailable.

## Recommended Next Step

Parlay-level analysis design: combine `XRayLegInterpretation[]` into a factual slip summary (shared games, overlapping markets) without win probability or Explorer.

## Verification Checklist

1. Open `/parlay-xray?preview=analysis` in development and confirm the Historical Replay banner (April 3, 2026 / game 18447934).
2. Confirm Ajay Over 11.5 shows 11.5 (−130) → 12.5 (−107) labeled 3-Hour Pre-Tip / Decision Close.
3. Confirm season 14.0, last 10 13.5, 6 above · 4 below, minutes 36.0 vs 26.2.
4. Confirm WOWY / Projection / Availability cards are visible gaps, not errors.
5. Confirm Why this could fail mentions 4 of 10 below 11.5 and missing availability.
6. Confirm no confidence %, lock copy, or final points.
7. Press Confirm on a normal extracted slip and confirm analysis stays empty.

## Step Verdict

GREEN — deterministic XRay leg interpretation and historical results UI are ready for parlay-level analysis design
