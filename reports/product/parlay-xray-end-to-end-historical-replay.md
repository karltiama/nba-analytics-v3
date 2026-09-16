# STEP 14P.X3F — Parlay XRay End-to-End Historical Replay Certification

## Executive Result

The historical XRay pipeline now runs as one explicit Confirm-gated orchestrator: confirmed legs → canonical resolution → historical market match → cutoff context → leg interpretation → parlay interpretation → labeled results UI.

Path A is deterministic and $0. Path B did not make a provider extraction call (no committed cached v2.1 screenshot; OCR/confirm was certified with the locked fixture). Public extraction remains disabled. Ordinary `/parlay-xray` Confirm still does not invent a date or run live analysis.

**Verdict: GREEN.**

## Certified Pipeline

```
screenshot / OCR fixture
  → ExtractedParlayLeg[]          (what XRay read)
  → user review / edit
  → Confirm                       (explicit boundary)
  → CanonicalParlayLegResolution[]
  → HistoricalParlayLegMatch[]
  → XRayLegContext[]              (cutoff-safe)
  → XRayLegInterpretation[]
  → XRayParlayInterpretation
  → XRay results UI + Historical Replay banner
```

Entry point: `runHistoricalXrayReplay(confirmedLegs, explicitReplayContext, deps)`.

Missing context on that call fails closed (`HISTORICAL_REPLAY_CONTEXT_REQUIRED` / `INCOMPLETE`). Public Confirm cannot supply it.

## Replay Fixture

Primary case: LAL @ OKC, game `18447934`, ET slate **April 2, 2026**, tip/cutoff `2026-04-03T01:30:00.000Z`, season `2025`. Coverage window is inside 2026-04-02 → 2026-05-02.

| Leg | Confirmed market | DK 3-Hour | Decision Close | Expected match |
|---|---|---|---|---|
| Ajay Mitchell Over 12.5 PTS | DraftKings | 11.5 (-130) | 12.5 (-107) | EXACT (close) |
| Ajay Mitchell Over 2.5 AST | DraftKings | 2.5 (-147) | 2.5 (-161) | EXACT |
| Luguentz Dort Over 8.5 PTS | DraftKings | 6.5 (-117) | 7.5 (-103) | PARTIAL / different line |
| Luka Doncic Over 30.5 PTS | DraftKings | 31.5 (-108) | 30.5 (-120) | EXACT (close) |

This exercises exact match, a partial/review line, two Ajay markets, shared game/team/opponent, 3-Hour → Close movement, form/role packets, missing WOWY/projection/availability, and parlay-level Why This Could Fail. No final outcomes.

## Ground Truth

Locked from `analytics.player_prop_market_movement` + `games` + `players` **before** interpretation ran. See `lib/parlay-xray/e2e/ground-truth.ts`.

Not defined after seeing XRay copy:

- extracted / confirmed / canonical identities
- games, markets, sides, lines, book `draftkings`
- 3-Hour and Close rows
- cutoff `2026-04-03T01:30:00.000Z`
- known gaps: WOWY, projection, availability

## Input / Extraction Boundary

Path A uses a historical canonical fixture (no screenshot provider).

Path B screenshot provider was **not** called. There is no committed cached v2.1 slip in-repo. The OCR layer is represented by `rawSnippet` (example: `Luka Doncik O 30.5 PTS`). Client `SCREENSHOT_EXTRACTION_AVAILABLE = false`. Kill switch restored to `PARLAY_XRAY_EXTRACTION_ENABLED=false`.

## Confirmation Boundary

Upload → Extract → Review → Confirm → Results is labeled in the stage list.

- Public `CONFIRM_LEGS` only locks legs. It does not analyze and does not invent a historical date.
- Historical replay Confirm runs only when `historicalReplay` is already on state (`?preview=replay` operator/dev harness).
- Browser: Confirm stayed disabled until the Luka OCR typo was edited; then **Confirm historical replay** launched analysis.

## Canonical Resolution

Confirmed names resolve conservatively:

- `Ajay Mitchell` → `1028037477`
- `Luguentz Dort` → `666541`
- `Luka Doncic` → `132`
- OCR `Luka Doncik` → `NEEDS_CONFIRMATION` (fuzzy), `playerId` null until the confirmed spelling is used.

Game identity uses the explicit replay date `2026-04-02` plus LAL/OKC matchup → `18447934`.

## Historical Matching

Observed statuses match ground truth: MATCHED / MATCHED / PARTIAL_MATCH (`DIFFERENT_LINE`) / MATCHED. Requested book stayed DraftKings. Dort 8.5 was not silently treated as an exact 7.5 close. 3-Hour and Decision Close snapshots were present on every leg.

## Context Assembly

Packets use cutoff `2026-04-03T01:30:00.000Z`. Path A injectable sources are pre-tip only (March 2026 priors, season `2025`). Target-game and future sentinel rows (99/50 points) do not change the finished object.

Inspected on every leg: prior-season-eligible logs, last 5/10, line-relative counts, minutes/role, matchup fields, missing WOWY, missing historical projection, missing historical availability. No target-game stats.

## Leg Interpretation

Displayed statements come from the packet (form vs line, market vs close, sample, coverage gaps). No probability, no final result, no bet recommendation.

## Parlay Interpretation

Structural only: SHARED_GAME (4), SHARED_GAME_ENVIRONMENT (4, both teams), SHARED_PLAYER (Ajay ×2), SHARED_TEAM (OKC ×3), SHARED_OPPONENT (LAL ×3). Summary state `DEPENDENCY_CONCENTRATION`. The word “correlation” is not used as a measured coefficient; coverage copy still notes measured correlation is not available.

## Why This Could Fail

Manual review of the parlay list (all specific / packet-traceable):

- 4 legs share the same game environment (including both teams)
- 2 legs depend on Ajay Mitchell
- OKC offensive environment on 3 legs
- Historical availability missing on all 4
- 3 of 4 legs have a form counter-signal
- 1 line worse than Decision Close (Dort Over 8.5 vs close 7.5)
- 1 partial historical sportsbook match
- 1 small recent-form sample (Dort, 3 prior games)

No generic filler. Cross-leg concentration and missing-context risks are both present.

## Data Coverage

WOWY / projection / availability render as limitations (`have: 0`), not errors. Dort is marked for review (partial market + limited sample) without dropping the other three legs.

## Partial-Leg Behavior

3 MATCHED + 1 PARTIAL. Dort remains in interpretations and in `reviewNeeded` (`PARTIAL_MARKET_MATCH`, `LIMITED_SAMPLE`, `MISSING_CONTEXT`, `COUNTERSIGNALS_PRESENT`). Not silently dropped.

## Outcome / Future Leakage

Hard gate passed. Finished objects contain no final player stat, hit/miss, game score, or wager result. Injecting target-game and future sentinel logs does not change interpretations or the parlay object.

## Browser UX Acceptance

`/parlay-xray?preview=analysis` — finished 4-leg Historical Replay (April 2, 2026 · LAL @ OKC · game 18447934). Leg jump nav, Why This Could Fail, data-coverage cards, 3-Hour → Close, OCR vs confirmed Luka.

`/parlay-xray?preview=replay` — extract/review first; Confirm disabled on the Doncik typo; edit to Doncic; Confirm launches analysis; OCR snippet preserved. During resolve, stage copy is “Resolving confirmed legs…”, not a single unlabeled spinner. Historical review no longer shows the live-analysis placeholder (“strongest/riskiest”).

Public `/parlay-xray` Confirm still does not analyze.

## Mobile Acceptance

390px viewport: `scrollWidth === 390`, no horizontal overflow. Dependency groups, leg nav, market movement, Why This Could Fail, and coverage cards stacked.

## 1 / 8 / 12 Leg Sanity

Deterministic fixture-only contract: interpretation count, parlay `legCount`, and unique render keys hold for 1, 8, and 12. This does not certify OCR quality for 12-leg screenshots.

## Performance

Path A (in-memory deps, `performance.now()`):

| Stage | ms |
|---|---|
| Canonical resolution | 17.91 |
| Historical matching | 0.95 |
| Context assembly | 2.32 |
| Interpretation | 2.86 |
| Total | 24.1 |

No provider calls. If this is later wired to live SQL, loaders are per player/market and would be N+1-shaped (Ajay’s two markets would reload the same player sources). Not rewritten this step.

## Provider Calls / Cost

Path A: 0. Path B: 0 (no new extraction; no cache replay). `providerAttempted` not applicable. Quota unchanged.

## Privacy

No new PII logging. Screenshot path unused. OCR snippets stay on the client fixture.

## Database Safety

Analysis path is read-only. No schema change. No migration applied.

## Tests

Baseline was 238. Now **251 passed** (`npx vitest run lib/parlay-xray`).

New coverage: 4-leg replay, OCR vs confirmed vs canonical, correction-before-canonicalization, 3+1 partial, outcome/future leakage, determinism, 1/8/12 contract, historical labeling, Confirm-without-replay still does not analyze, edits preserve historical replay context.

## Evidence Matrix

| Stage | Expected | Observed |
|---|---|---|
| Extraction/input | legs available | 4 OCR/confirmed fixture legs |
| Confirmation | explicit boundary | public Confirm locks only; historical Confirm required |
| Canonical resolution | conservative | Ajay/Dort/Luka ids; Doncik needs confirmation |
| Historical matching | exact/partial preserved | 3 MATCHED + 1 PARTIAL, DK only |
| Context cutoff | pre-tip only | cutoff packet; sentinels ignored |
| Leg interpretation | deterministic | packet-traceable, no probability |
| Parlay dependencies | structural only | game/player/team/opponent |
| Why this could fail | factual | 9 specific items |
| Outcome leakage | none | none detected |
| Historical label | visible | April 2, 2026 · LAL @ OKC · game 18447934 |
| Provider calls | <=2 | 0 |
| Public extraction | disabled | disabled |

## Files Changed

- `lib/parlay-xray/e2e/*` (ground truth, fixture, orchestrator, preview, scale, tests)
- `lib/parlay-xray/session.ts`, `copy.ts`
- `lib/parlay-xray/interpretation/preview.ts`, `interpretation/index.ts`
- `app/parlay-xray/ParlayXrayClient.tsx`
- `components/parlay-xray/ParlayXrayView.tsx`, `ExtractedLegsPanel.tsx`, `XrayResultsPanel.tsx`
- `lib/parlay-xray/__tests__/session.test.ts`, `page-contract.test.ts`
- `scripts/ops/discover-x3f-coverage.ts`, `discover-x3f-legs.ts`, `run-parlay-xray-x3f-replay.ts`, `dump-x3f-observed.ts`
- Local kill switch restored: `PARLAY_XRAY_EXTRACTION_ENABLED=false`

## Schema Changes

NONE

## Remaining Product Gaps

- Public Confirm does not run live/current-season analysis (intentional)
- Public/paid extraction still disabled
- No real screenshot Path B this step
- Form/role on the operator preview uses cutoff-safe injectable priors, not a live DB snapshot in the UI bundle
- No numeric confidence, win probability, EV, or measured correlation
- Parlay Explorer not implemented
- Live SQL wiring would be N+1 unless batched later

## Recommended Next Step

Plan current/live-season integration for Confirm **without** enabling public extraction and without starting Parlay Explorer. Live Confirm must still refuse analysis unless real current context is valid.

## Verification Checklist

1. `.env` has `PARLAY_XRAY_EXTRACTION_ENABLED=false` (restart Next if it was previously true).
2. Open `/parlay-xray` — Extract is not a public auto-path; Confirm does not analyze.
3. Open `/parlay-xray?preview=replay` — Luka shows OCR `Doncik`; Confirm is disabled until edited.
4. Change player to `Luka Doncic`, Confirm historical replay, wait for results.
5. Open `/parlay-xray?preview=analysis` — Historical Replay banner (April 2, 2026 / LAL @ OKC / 18447934).
6. Confirm Why This Parlay Could Fail lists shared game/player/team and missing WOWY/projection/availability.
7. Resize to ~390px and confirm no horizontal overflow.
8. Run `npx vitest run lib/parlay-xray` (251 passed).

## Step Verdict

GREEN — Parlay XRay is certified end-to-end for historical replay and ready for current/live integration planning.
