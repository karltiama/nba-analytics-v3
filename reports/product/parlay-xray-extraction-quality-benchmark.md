# STEP 14P.X2C — Parlay XRay Controlled Extraction Quality Benchmark

## Executive Result

Twelve unique paid extractions ran in a local operator process (`gpt-4o-mini`, detail `low`). Readable slips are strong. The no-slip box-score control was converted into four invented Over legs. Same-player second markets were sometimes labeled `points`. Production/public extraction stayed **disabled**.

## Safety / Spend

- `.env` `PARLAY_XRAY_EXTRACTION_ENABLED=false` was never flipped for Next.js / production.
- Benchmark process-only overrides: enabled true, `PARLAY_XRAY_PRO_DAILY_LIMIT=20`, cooldown 0. Documented operator-only; restored by process exit.
- Unique provider calls: **12**. Replay: **0** additional.
- Total estimated spend: **$0.009745**
- Hard cap 12 was not exceeded. No retries.

## Benchmark Corpus

Twelve synthetic fixtures in `%TEMP%\parlay-xray-x2c` (deleted after scoring). Lines drawn from Court Context `analytics.player_prop_history` on 2026-03-17 where possible. No private user screenshots. Not committed.

| ID | Category | What was on the image |
| --- | --- | --- |
| A1 | CLEAN | DK 4-leg points |
| A2 | CLEAN | FanDuel 3-leg, two Giannis props |
| A3 | CLEAN | DK 5-leg including Under + threes |
| B1 | COMPRESSED | JPEG q18 of A1 layout |
| B2 | COMPRESSED | 480px JPEG of A2 |
| C1 | DARK | A1 layout, smaller type |
| C2 | LOW CONTRAST | 3-leg, generic “NBA PARLAY” header |
| D1 | CROPPED | A1 with 4th card cut after the name |
| D2 | MISSING FIELDS | No book header, no matchups, last odds blank |
| E1 | COMPLEX | SGP +50% banner + same-game Jokic/SGA |
| E2 | COMPLEX | “BOOSTED BETS” header + mixed FD legs |
| F1 | NON-SLIP | FINAL box score, explicit “no betting lines” |

## Ground Truth Contract

Expected fields live in `scripts/ops/run-parlay-xray-quality-benchmark.ts`. Canonical player IDs are not required. UNKNOWN is preferred to guessing. Core exact = player + market + side + line. Full exact also requires visible odds / sportsbook / matchup.

## Extraction Configuration

`gpt-4o-mini` · `detail=low` · one attempt · no high-detail fallback · no retries.

## Screenshot Results

11/12 intent-correct for slip-vs-non-slip. API returned SUCCESS/PARTIAL for all 12; F1 should have been `NO_LEGS_FOUND` and was `SUCCESS`.

D1 `PARTIAL` is correct (cropped 4th leg). D2 `SUCCESS` with unknown sportsbook/odds/matchup is acceptable.

## Leg Detection

Non-control expected legs: **38**. Automated core-leg matches: **34/38 (89%)**. Recall of expected players: **37/38** after counting A3 `Jockic` as Jokic (OCR typo). Extra incomplete D1 Mitchell row is the cropped name, not a new invented player.

## Field Accuracy

On readable slips, player/line/odds/matchup are generally exact. Failures:

- **Market:** A2 Giannis 8.5 Rebounds extracted as `points`. E1 Jokic 10.5 Assists extracted as `points`. Same-player second prop leans toward points.
- **Side:** B1 Jokic Over 27.5 extracted as **Under**.
- **Name:** A3 `Nikola Jockic` typo; rest of the leg correct.
- **Sportsbook:** Present when branded; C2/D2 correctly unknown.
- **Canonical IDs:** unknown on every leg (correct).

## Uncertainty / Needs Confirmation

D2 left missing odds/sportsbook/matchup unknown (correct). D1 4th leg: name known, market `other`, side/line/odds unknown (better than inventing 25.5). C2 sportsbook unknown (correct). The model rarely used `needs_confirmation`; it is more often confidently wrong on market/side than uncertain.

## Hallucination Review

**F1 is a serious failure.** Box-score totals were turned into Over legs (Jokic Over 29 Points, Gordon Over 6 Rebounds, SGA Over 31 Points, Holmgren Over 8 Rebounds). Promo banners on E1/E2 did **not** become legs.

## No-Slip Control

**Failed.** Expected `NO_LEGS_FOUND`. Observed `SUCCESS` with 4 hallucinated legs.

## Dedupe Replay

A1 resubmitted immediately: `cacheHit=true`, `providerAttempted=false`, quota stayed **12**. No regression.

## Cost Per Extraction

Provider tokens + existing estimator (not file size). Prompt tokens were 3365 on every call.

| | USD | ms |
| --- | ---: | ---: |
| min | 0.000745 | 3005 |
| median | 0.000806 | 3956 |
| mean | 0.000812 | 3970 |
| p90 | 0.000855 | 5275 |
| max | 0.000934 | 6569 |

## Total Benchmark Spend

**$0.009745** across 12 unique paid calls. Replay: $0.

## Latency

See table above. Not optimized in this step.

## Quota Accounting

Namespaced operator user `xray-bench-x2c-operator` (not a real auth UUID).

- Before: user 0, global 1 (X2B)
- After unique 12: user 12, global 13
- Replay: user 12, no extra global
- Process Pro limit 20 so 12 unique could run in one UTC day without changing production defaults (option B, already supported by env parse; Next.js `.env` unchanged)

## Screenshot Privacy

`storage.objects` = 0. No `bytea`. No Git images. Temp PNGs/JPEGs removed after the report. Usage rows store hash/dimensions/tokens only.

## Cost Projections

**EXTRACTION-ONLY**, mean $0.000812 / unique call. Not pricing.

| Unique extractions / month | Estimated extraction $ |
| ---: | ---: |
| 100 | 0.08 |
| 1,000 | 0.81 |
| 10,000 | 8.12 |

Does not include analysis, AWS, Supabase, BDL, or other models.

## Free / Pro Safety-Default Assessment

From extraction cost only: **VERY CONSERVATIVE**.

- Free 3/day ≈ $0.07/user/month extraction
- Pro 10/day ≈ $0.24/user/month extraction

Do not treat as product policy. Analysis cost is still unknown.

## Quality Gate

**CURRENT_EXTRACTOR_NEEDS_PROMPT_SCHEMA_POLISH**

Readable branded slips are good enough to map. The extractor is not yet a safe foundation for unsupervised downstream matching because:

1. Non-slip sports content is rewritten as Overs.
2. A second prop for the same player is sometimes forced to `points`.
3. JPEG compression flipped one Over to Under.

Low detail was **not** the main limiter (B2 480px JPEG was 3/3 core exact). Model is capable; prompt/schema must refuse non-slips and keep market identity.

## Tests

`npx vitest run lib/parlay-xray` → **68 passed**. No test edits.

## Files Created / Temporary Files Removed

Created:

- `scripts/ops/generate-parlay-xray-benchmark-corpus.ps1`
- `scripts/ops/run-parlay-xray-quality-benchmark.ts`
- this report
- learning log

Removed after scoring: `%TEMP%\parlay-xray-x2c\*.png`, `*.jpg` (and results JSON).

## Remaining Risks

- F1-style hallucination on box scores / social graphics
- Same-player multi-market confusion
- Corpus is synthetic, not phone photos of live books
- Operator Pro-limit override must never be copied to production

## Recommended Next Step

**Do not start X3A.** Prompt/schema polish: fail closed on non-slip images; keep market kind when two legs share a player. Re-run a small paid set only under a later authorization. Public extraction stays off.

## Verification Checklist

1. `.env` still `PARLAY_XRAY_EXTRACTION_ENABLED=false`.
2. Unique provider calls = 12; replay unpaid.
3. F1 documented as no-slip hallucination.
4. `npx vitest run lib/parlay-xray` → 68.
5. Temp screenshots deleted.
6. Do not enable public extraction.
7. Do not start analysis or X3A.

## Evidence table

| ID | Difficulty | Expected legs | Detected | Core exact | Full exact | Unknown appropriate | Hallucinations | Cost | Latency | Result |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| A1 | CLEAN | 4 | 4 | 4 | 4 | 0 | 0 | 0.000855 | 5275 | SUCCESS |
| A2 | CLEAN | 3 | 3 | 2 | 2 | 0 | 0 | 0.000788 | 4036 | SUCCESS |
| A3 | CLEAN | 5 | 4* | 4 | 4 | 0 | 1† | 0.000934 | 6569 | SUCCESS |
| B1 | COMPRESSED | 4 | 4 | 3 | 3 | 0 | 0 | 0.000852 | 3966 | SUCCESS |
| B2 | COMPRESSED | 3 | 3 | 3 | 3 | 0 | 0 | 0.000765 | 3299 | SUCCESS |
| C1 | DARK | 4 | 4 | 4 | 4 | 0 | 0 | 0.000834 | 4098 | SUCCESS |
| C2 | LOW CONTRAST | 3 | 3 | 3 | 3 | 3 | 0 | 0.000766 | 3005 | SUCCESS |
| D1 | CROPPED | 3 | 3 | 3 | 3 | 0 | 1‡ | 0.000825 | 4015 | PARTIAL |
| D2 | MISSING FIELDS | 3 | 3 | 3 | 3 | 7 | 0 | 0.000745 | 3094 | SUCCESS |
| E1 | COMPLEX | 3 | 3 | 2 | 2 | 0 | 0 | 0.000778 | 3204 | SUCCESS |
| E2 | COMPLEX | 3 | 3 | 3 | 3 | 0 | 0 | 0.000761 | 3136 | SUCCESS |
| F1 | NON-SLIP | 0 | 0 | 0 | 0 | 0 | 4 | 0.000842 | 3945 | SUCCESS (wrong) |

\* A3 Jokic OCR’d as `Jockic`. † leftover unmatched row from that typo. ‡ cropped Mitchell name with unknown market/line (manual: appropriate partial, not a invented line).

## Step Verdict

**YELLOW** — extraction works but prompt/schema/detail-mode quality must improve before building downstream analysis
