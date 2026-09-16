# STEP 14P.X2C.3 — Parlay XRay Same-Player Market Identity Hardening

Date: 2026-09-15
Status: GREEN
Cost this step: $0
Real provider calls: 0

## Executive Result

Market identity is now resolved from **this leg only**. `REB` cannot become known Assists. Model/evidence mismatches cannot stay `known`. Extraction version is **`xray-extract-v2.1`** so the live A2 cache cannot be reused. Kill switch stayed off.

## Real Failure Being Addressed

Browser v2 retest: Giannis Over 27.5 Points correct; **Giannis Over 8.5 Rebounds returned as Assists**; Bam Rebounds correct.

## Failure Path Audit

Saved usage/dedupe artifacts store mapped `ExtractedParlayLeg[]` only. Provider `market_evidence` strings are not persisted (privacy). From that, plus the mapper:

| Class | Determinate? |
| --- | --- |
| F. Mapper carry-over across same-player legs | **No.** `mapVisionOutput` maps each `legs[i]` in isolation. |
| E. Shared/default market | **No.** Unevidenced points already went `unknown`; Assists was `known`. |
| C. Alias map treating REB as AST | **No**, if evidence actually contained Rebounds/REB (`\bast\b` does not match `rebounds`). |
| A/B. Provider `prop_kind` and/or `market_evidence` cited Assists/AST | **Yes, remaining live cause.** A `known` Assists result required this-leg visible text (or model+evidence) to resolve as assists with high confidence. |

Failure class: **A (provider extraction) with likely B (evidence string also naming AST/Assists)**. Not mapper cross-leg contamination. v2.1 now rejects that as known Assists when this-leg snippet/evidence says Rebounds.

## Leg-Local Market Contract

`resolveLegMarket` reads only `prop_kind`, `market_evidence`, and `raw_snippet` on the same leg. It never inspects other legs, player identity, or prior market.

## Evidence Consistency Guard

- Unique `market_evidence` kind is the market. If `prop_kind` disagrees → **needs_confirmation** of the evidence kind (never known wrong market).
- If `market_evidence` and this-leg `raw_snippet` name **different** markets → **unknown**.
- If neither field names a market → **unknown** (no model guess, including assists).
- Example: `prop_kind=assists`, evidence=`Rebounds`, snippet=`Over 8.5 Rebounds` → rebounds / needs_confirmation, not known assists.

## Market Alias Normalization

Explicit singles: points/pts/player points; rebounds/reb/rebs/player rebounds; assists/ast/asts/player assists; 3PM / 3-pointers made / threes. Combos PRA/PR/PA/RA unchanged. Bare `3` in a line is not threes. Unknown labels are not mapped to points.

## Same-Player Regression Matrix

Covered: Points+Rebounds (and reverse), Rebounds+Assists (and reverse), Points+Rebounds+Assists, Rebounds+Rebounds, 3PM+Assists.

## Evidence Mismatch Tests

Assists+evidence Rebounds, Rebounds+evidence Assists, Points+evidence REB, AST evidence vs Rebounds snippet, ambiguous `Over 8.5` with no market word.

## Result / Uncertainty Behavior

Wrong known market is not forced to SUCCESS. Mismatch → `NEEDS_CONFIRMATION` or `PARTIAL`. Conservative partial is preferred.

## Versioning / Cache Isolation

JSON schema shape unchanged (`xray-legs-v2`). **Mapping semantics changed**, so:

`xray-extract-v2` → **`xray-extract-v2.1`**

Dedupe identity includes extraction version. Memory test: v2 cache is not reused for v2.1. Live A2 wrong-Assists cache cannot satisfy the next paid retest.

## Preserved V2 Safety Behavior

Box-score refusal, stats-only refusal, Over/Under evidence, missing-field UNKNOWN, promo filter, one provider attempt, screenshot privacy. Jokic/Jockic OCR is unchanged (canonical identity is not this step).

## Tests

`npx vitest run lib/parlay-xray` — **98 passed** (baseline 82). No OpenAI.

## Files Changed

- `lib/parlay-xray/extraction/market-identity.ts` (new)
- `lib/parlay-xray/extraction/map-legs.ts`
- `lib/parlay-xray/extraction/prompt.ts`
- `lib/parlay-xray/extraction/config.ts`
- `lib/parlay-xray/extraction/__tests__/market-identity.test.ts` (new)
- `lib/parlay-xray/extraction/__tests__/document-contract.test.ts`
- `lib/parlay-xray/extraction/__tests__/pipeline-guardrails.test.ts`
- `lib/parlay-xray/extraction/__tests__/fixtures.ts`
- `lib/parlay-xray/extraction/__tests__/image.test.ts`
- `lib/parlay-xray/extraction/__tests__/postgres-persistence.test.ts`
- `.env.example`
- `reports/product/parlay-xray-same-player-market-hardening.md`

## Remaining Risks

If the model quotes **AST/Assists in both** `market_evidence` and `raw_snippet` while the pixels say Rebounds, the mapper still cannot OCR-correct it. That requires the tiny paid retest.

## Recommended Paid Re-Test

Next separately authorized step, 2–3 unique calls, `xray-extract-v2.1`:

1. Same-player Points + Rebounds (the Giannis A2 class)
2. Same-player Rebounds + Assists
3. Optional clean single-market control

Do not rerun the 12-call corpus. Do not enable public extraction.

## Verification Checklist

1. `.env` still has `PARLAY_XRAY_EXTRACTION_ENABLED=false`.
2. `npx vitest run lib/parlay-xray` — 98 passed.
3. Default extraction version is `xray-extract-v2.1`.
4. Do not run a paid screenshot until a later step.
5. Next paid step must miss v2 cache.

## Step Verdict

GREEN — same-player market identity is hardened and ready for a tiny real-world paid re-test
