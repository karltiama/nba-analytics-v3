# STEP 14P.X2C.1 — Parlay XRay Extraction Refusal + Field-Identity Hardening

Date: 2026-09-15
Status: GREEN
Cost this step: $0
Real provider calls: 0

## Executive Result

Extraction v2 is a contract/prompt/mapping hardening only. The kill switch stayed off. No OpenAI request was made. Document-type refusal now prevents a box score from becoming SUCCESS with invented Over legs. Market, side, and line are evidence-gated per leg. Dedupe identity includes `xray-extract-v2` / `xray-legs-v2`, so X2B/X2C v1 cache cannot be reused.

## X2C Failures Addressed

| X2C failure | v2 control |
| --- | --- |
| F1 box score → SUCCESS + 4 invented Overs | `document_type=NOT_BET_SLIP` → empty `NO_LEGS_FOUND`; stats-only BET_SLIP also refused |
| Same-player market copied as points | Per-leg `market_evidence` wins; unevidenced `points` is not defaulted |
| Visible Over returned as Under | Side requires Over/Under evidence; conflict → needs_confirmation, not a confident wrong side |
| Confident wrong fields instead of UNKNOWN | Known status requires visible evidence; missing/cropped fields stay unknown / needs_confirmation |

## Previous Contract Weaknesses

Before this step the path was:

image → prompt (“extract visible betting legs”) → structured JSON (`image_quality`, `sportsbook`, `legs[]`) → `mapVisionOutput` → `resultFromLegs` → UI.

Weaknesses:

- No document/slip identity field. A box score was a valid SUCCESS if the model emitted legs.
- The provider was not forced to distinguish a betting slip from sports data.
- Fields were not tied to independent visible evidence. High confidence made a guessed Over/points `known`.
- Market could carry across same-player legs because nothing required per-leg market text.
- Side could be inferred (stat value, neighbor, convention) because `over`/`under` was accepted from the model alone.
- `resultFromLegs` chose SUCCESS whenever every mapped leg was resolved — including fabricated ones.

## Document-Type Contract

Internal provider field `document_type`:

- `BET_SLIP` — explicit wagering/bet-slip evidence is visible
- `NOT_BET_SLIP` — sports content exists, but it is not a bet slip
- `UNCERTAIN` — might be a slip, but evidence is insufficient

Unsupported enum values fail Zod parse → `PROVIDER_UNAVAILABLE`, legs `[]`.

This field is not added to the public `ExtractedParlayLeg[]` UI contract.

## Non-Slip Refusal

Prompt rule: player statistics are not betting lines. `29 PTS` / `6 REB` / `8 AST` must never become Over 29 Points unless the image shows wagering side/line.

Deterministic mapping:

- `NOT_BET_SLIP` → `legs=[]`, `NO_LEGS_FOUND`, user message *This image doesn't clearly appear to be a betting slip.*
- `UNCERTAIN` → same empty refusal (no usable confirmed legs)
- `BET_SLIP` without visible wagering cues (Over/Under/odds/parlay/ticket language) → same refusal, even if the model invented Overs from box-score totals

## Evidence Anchoring

Internal per-leg strings (not shown in UI, not sent to Umami, not stored as OCR):

- `wager_evidence`
- `player_evidence`, `market_evidence`, `side_evidence`, `line_evidence`, `odds_evidence`

Purpose: force the model to quote what is visible versus what it is inferring. `known` is withheld when evidence is missing.

## Market Identity Rules

Market is decided per leg. Evidence text such as Rebounds wins over a copied `prop_kind: points`. If market text is missing and the model defaulted to points, market is `unknown` — never a silent points default.

## Side / Line Rules

- Visible Over → Over. Visible Under → Under.
- Absent/unreadable side → `unknown`. The model’s guessed side is ignored without Over/Under evidence.
- Line is taken only from the visible wager (`line_evidence`). Box-score totals, averages, and projections are not lines.
- Missing/cropped odds, sportsbook, matchup, or line stay `unknown` / `needs_confirmation`.

## Uncertainty Policy

No numeric confidence scores were added. Semantic states remain `known` | `unknown` | `needs_confirmation`. The prompt and mapper prefer UNKNOWN / NEEDS_CONFIRMATION over a confident guess.

## Deterministic Mapping Guards

- `NOT_BET_SLIP` / `UNCERTAIN` cannot become SUCCESS with legs
- Invented legs on a refused document are dropped
- Stats-only “BET_SLIP” without wagering cues is refused
- Promo-only labels (BOOST, PROFIT BOOST, SPECIAL, PROMO, POPULAR, TRENDING) are dropped
- Malformed / unsupported `document_type` → existing `PROVIDER_UNAVAILABLE`, no fake legs
- No second model, retry, or high-detail fallback

## Version Bump

| Key | v1 | v2 |
| --- | --- | --- |
| `extractionVersion` | `xray-extract-v1` | `xray-extract-v2` |
| `schemaVersion` | `xray-legs-v1` | `xray-legs-v2` |

Default `maxOutputTokens` is 1400 only to fit the larger JSON object. Model remains `gpt-4o-mini`, detail remains `low`, attempts remain 1.

## Dedupe Version Isolation

Dedupe identity is `userId:imageHash:extractionVersion:schemaVersion:model`.

Memory + Postgres tests confirm `xray-extract-v1` cache is not reused for `xray-extract-v2`. Paid X2B/X2C rows stay in the table but cannot satisfy a v2 lookup.

## UI Behavior

Unchanged flow: upload → Extract screenshot → review/edit → Confirm (Confirm still does not run analysis).

`NO_LEGS_FOUND` with empty legs shows the existing empty-leg panel plus the restrained extract notice. No fictional leg cards. Provider internals (`document_type`, evidence strings) are not rendered.

## Regression Tests

- Box score with invented Overs → `NO_LEGS_FOUND`, `legs.length = 0`
- Stats-only misclassified BET_SLIP → same refusal
- Same player Over 27.5 Points + Over 7.5 Rebounds → distinct markets
- Visible Over / Under preserved; absent side → unknown
- Missing odds/sportsbook/matchup/line → unknown / PARTIAL
- Promo banners are not legs
- Complete slip → SUCCESS
- Uncertain fields → PARTIAL or NEEDS_CONFIRMATION
- UNCERTAIN document → empty non-success
- Malformed document_type → PROVIDER_UNAVAILABLE

## Benchmark Metric Cleanup

X2C F1 reported Expected=0, Detected=0, Hallucinations=4 while four invented legs were returned. `detected` was matched-expected count, not returned count.

Future rows distinguish:

- `returnedLegCount`
- `matchedExpectedLegCount` (`detected` kept as an alias)
- `unmatchedReturnedLegCount`
- `hallucinatedLegCount`

A3 (name mismatch) and D1 (extra returned leg) had the same vocabulary split. The paid corpus was **not** re-run.

## Privacy

Umami still receives only `surface` + `result_category`. Evidence strings, player names, odds, lines, and full slips are not logged on the extract completion path.

## Cost / Provider Call Behavior

Still one image → at most one provider attempt. No classifier call, retry, or high-detail fallback. This step: 0 provider calls.

## Tests

```
npx vitest run lib/parlay-xray
```

Baseline: 68 passed  
This step: **82 passed** (12 files)

No provider requests during tests.

## Files Changed

- `lib/parlay-xray/extraction/schema.ts`
- `lib/parlay-xray/extraction/prompt.ts`
- `lib/parlay-xray/extraction/map-legs.ts`
- `lib/parlay-xray/extraction/document-contract.ts` (new)
- `lib/parlay-xray/extraction/pipeline.ts`
- `lib/parlay-xray/extraction/config.ts`
- `lib/parlay-xray/extraction/copy.ts`
- `lib/parlay-xray/extraction/store.ts`
- `lib/parlay-xray/extraction/postgres-store.ts`
- `lib/parlay-xray/extraction/index.ts`
- `lib/parlay-xray/extraction/__tests__/fixtures.ts`
- `lib/parlay-xray/extraction/__tests__/document-contract.test.ts` (new)
- `lib/parlay-xray/extraction/__tests__/map-legs.test.ts`
- `lib/parlay-xray/extraction/__tests__/pipeline-guardrails.test.ts`
- `lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts`
- `lib/parlay-xray/extraction/__tests__/image.test.ts`
- `lib/parlay-xray/__tests__/page-contract.test.ts`
- `scripts/ops/run-parlay-xray-quality-benchmark.ts`
- `.env.example`
- `reports/product/parlay-xray-extraction-hardening-v2.md`
- `notes/learning-log/2026-09-15/parlay-xray-extraction-hardening-v2.mdx`

## Remaining Risks

A model can still claim `BET_SLIP` and fabricate Over/Under text in `side_evidence` / `raw_snippet`. Guards stop stats-only images and non-slip classifications; they cannot OCR-verify a lying evidence string. Side/market identity still depends on the model quoting the correct fragment. No paid validation of the new prompt has been run.

## Recommended Targeted Re-Test

Next separately authorized step, keep extraction off in `.env` and enable only in-process:

1. F1 box-score control (must be `NO_LEGS_FOUND`, 0 legs)
2. Same-player multi-market slip (points vs rebounds)
3. One Over and one Under slip
4. One cropped/missing-odds slip (UNKNOWN, not hallucinated)

Cap unique paid calls small (≤4). Do not rerun the full 12-call X2C corpus until those four pass.

## Verification Checklist

1. Confirm `.env` still has `PARLAY_XRAY_EXTRACTION_ENABLED=false`.
2. Confirm no OpenAI usage appeared for this step.
3. `npx vitest run lib/parlay-xray` — 82 passed.
4. Open `/parlay-xray`: upload + Extract screenshot + Confirm still do not run analysis (extraction remains disabled).
5. Do not rerun X2C or enable public extraction.
6. Next paid step must use `xray-extract-v2` (v1 cache must miss).

## Step Verdict

GREEN — extraction v2 contract/prompt hardening is implemented and ready for a small paid targeted re-test
