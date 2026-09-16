# STEP 14P.X2C.4 — Parlay XRay V2.1 Real-World Market Re-Test

Date: 2026-09-15
Status: GREEN
Operator user: `xray-retest-x2c4-operator`
Kill switch: process-only enable during the 3 unique calls; `.env` stayed `false`

## Executive Result

Frozen candidate `xray-extract-v2.1` / `gpt-4o-mini` / `detail=low` / one attempt passed the prior same-player failure class.

Giannis Over 8.5 Rebounds is **known rebounds**, not known assists. Same-player Rebounds + Assists stayed distinct. The clean 4-leg control did not regress. Replay of R1 was a cache hit with **zero** extra provider calls.

**QUALITY_GATE:** V2_1_MARKET_IDENTITY_CERTIFIED

## Safety / Spend

| Check | Result |
| --- | --- |
| Public/deployed extraction | disabled |
| `.env` `PARLAY_XRAY_EXTRACTION_ENABLED` | `false` before, during (Next), and after |
| Operator enable | this process only; cooldown 0; Pro limit 10 |
| Unique provider calls | **3** (cap 3, not exceeded) |
| Replay provider calls | **0** |
| Retries | none |
| Prompt / schema / model / detail | unchanged during testing |
| Estimated spend | **$0.003256** |
| Config after exit | `enabled: false`, version `xray-extract-v2.1` |

Quota HTTP without cookies: `AUTH_REQUIRED`. Config load from `.env`: `enabled: false`. Next restart was not required because `.env` was never flipped.

## Extraction Version

- EXTRACTION_VERSION: `xray-extract-v2.1`
- SCHEMA_VERSION: `xray-legs-v2`
- MODEL: `gpt-4o-mini`
- DETAIL: `low`
- MAX PROVIDER ATTEMPTS PER IMAGE: 1
- First unique call of each screenshot was **not** a cache hit (v2 cache did not satisfy v2.1)

## Real Test Corpus

Sportsbook-style slips in the same FanDuel/DraftKings visual language as the prior browser failure. Not live logged-in account captures. No username, balance, account number, payment, or location text. A wager was not placed. Images were local-only under `%TEMP%\parlay-xray-x2c4` and deleted after scoring. Not committed. Not uploaded to Supabase Storage or S3.

R1 is the exact prior A2 class (1024×860, **23788 bytes**, same layout as `A2-clean-3.png`).

## Ground Truth

Recorded from pixels **before** any provider call.

### R1 — Points + Rebounds (prior failure)

| Player | Market | Side | Line | Odds | Book | Matchup |
| --- | --- | --- | ---: | ---: | --- | --- |
| Giannis Antetokounmpo | points | Over | 27.5 | -113 | FanDuel | MIL vs MIA |
| Giannis Antetokounmpo | rebounds | Over | 8.5 | -132 | FanDuel | MIL vs MIA |
| Bam Adebayo | rebounds | Over | 5.5 | -110 | FanDuel | MIA vs MIL |

Hard rule: Rebounds must not become known Assists.

### R2 — Rebounds + Assists

| Player | Market | Side | Line | Odds | Book | Matchup |
| --- | --- | --- | ---: | ---: | --- | --- |
| Giannis Antetokounmpo | rebounds | Over | 8.5 | -132 | FanDuel | MIL vs MIA |
| Giannis Antetokounmpo | assists | Over | 6.5 | -110 | FanDuel | MIL vs MIA |
| Bam Adebayo | rebounds | Over | 5.5 | -110 | FanDuel | MIA vs MIL |

### R3 — Clean points control

| Player | Market | Side | Line | Odds | Book | Matchup |
| --- | --- | --- | ---: | ---: | --- | --- |
| Nikola Jokic | points | Over | 27.5 | -103 | DraftKings | DEN vs OKC |
| Shai Gilgeous-Alexander | points | Over | 32.5 | -109 | DraftKings | OKC vs DEN |
| Jalen Brunson | points | Over | 27.5 | -109 | DraftKings | NYK vs CLE |
| Donovan Mitchell | points | Over | 25.5 | -119 | DraftKings | CLE vs NYK |

No fields were expected unknown.

## R1 — Prior Points/Rebounds Failure Class

Result: **SUCCESS**. 3/3 legs. Quota 0 → 1.

| Leg | Provider `prop_kind` | `market_evidence` | Mapped market | Status | Class |
| --- | --- | --- | --- | --- | --- |
| Giannis Points | points | Points | points | known | CORRECT_KNOWN |
| Giannis Rebounds | rebounds | Rebounds | rebounds | known | CORRECT_KNOWN |
| Bam Rebounds | rebounds | Rebounds | rebounds | known | CORRECT_KNOWN |

Giannis Rebounds raw_snippet (operator debug, not telemetry): `Giannis Antetokounmpo - Over 8.5 Rebounds`

**NOT** known Assists.

## R2 — Rebounds/Assists Same-Player Case

Result: **SUCCESS**. 3/3 legs. Quota 1 → 2.

| Leg | Provider `prop_kind` | `market_evidence` | Mapped market | Status | Class |
| --- | --- | --- | --- | --- | --- |
| Giannis Rebounds | rebounds | Rebounds | rebounds | known | CORRECT_KNOWN |
| Giannis Assists | assists | Assists | assists | known | CORRECT_KNOWN |
| Bam Rebounds | rebounds | Rebounds | rebounds | known | CORRECT_KNOWN |

No cross-leg carry-over. No default-to-points.

## R3 — Clean Control

Result: **SUCCESS**. 4/4 legs. Quota 2 → 3.

All four points markets CORRECT_KNOWN. All Overs preserved. Exact lines. No new hallucinations.

## Market Identity Results

| Test | Expected Markets | Returned Markets | Status | Wrong Known? | Cost | Latency |
| --- | --- | --- | --- | --- | ---: | ---: |
| R1 | points, rebounds, rebounds | points, rebounds, rebounds | SUCCESS | no | $0.001051 | 6968 ms |
| R2 | rebounds, assists, rebounds | rebounds, assists, rebounds | SUCCESS | no | $0.001051 | 5112 ms |
| R3 | points × 4 | points × 4 | SUCCESS | no | $0.001154 | 5836 ms |
| R1 replay | (cache) | (cache) | SUCCESS | no | $0 | 0 ms |

WRONG_KNOWN count: **0**

## Evidence Consistency

For every tested market, `prop_kind`, `market_evidence`, `raw_snippet`, and mapped market agreed.

The v2.1 deterministic mismatch guard **did not need to fire**. The provider quoted the correct market word on each leg (`Points` / `Rebounds` / `Assists`). This is the provider-correct path, not a mapper downgrade of a wrong known market.

## Side / Line Regression

Visible Over stayed Over on all 10 unique legs. Lines were exact (27.5 / 8.5 / 5.5 / 6.5 / 32.5 / 25.5). No missing-field invention on this corpus (all fields were visible).

## Provider Failure vs Mapper Guard

This sample did **not** reproduce the v2 provider hallucination (assists evidence on a Rebounds row). v2.1 extracted Rebounds as Rebounds at the provider layer. Mapper identity stayed leg-local. Distinction: remaining OCR risk is still possible if both evidence and snippet name the wrong market; it did not occur on these three calls.

## Cost / Latency

| Call | Prompt | Completion | Total | Cost | Latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| R1 | 4354 | 664 | 5018 | $0.001051 | 6968 ms |
| R2 | 4354 | 664 | 5018 | $0.001051 | 5112 ms |
| R3 | 4354 | 835 | 5189 | $0.001154 | 5836 ms |

**REAL_PROVIDER_CALLS: 3**  
**Estimated total: $0.003256**

## Quota Accounting

Operator Pro limit 10. Unique calls consumed **exactly one slot each** (remaining 9 → 8 → 7). R1 replay: `cache_hit=true`, `provider_attempted=false`, quota stayed **3 used**.

## Privacy / Cleanup

- Temporary PNGs and local `results.json` deleted (`%TEMP%\parlay-xray-x2c4` gone)
- Zero image files in the git workspace
- Usage rows store hash/dims/tokens, not image blobs (existing guardrail)
- Operator debug of evidence stayed in-process / local TEMP; not sent to Umami
- Umami extract properties remain surface-only (no OCR / evidence strings)
- This run did not go through the browser, so no Umami extract events were fired

## Post-Test Kill Switch

`.env` still `PARLAY_XRAY_EXTRACTION_ENABLED=false`. Process overrides died with the operator process. Config reload: `enabled: false`.

## Tests

`npx vitest run lib/parlay-xray` — **98 passed**. Tests were not altered to excuse a provider failure.

## Quality Gate

**V2_1_MARKET_IDENTITY_CERTIFIED**

- same-player Points + Rebounds passed
- same-player Rebounds + Assists passed
- no WRONG_KNOWN market
- clean control did not regress
- no duplicate provider calls

## Remaining Risks

- Corpus is sportsbook-style synthetic UI, not a live logged-in book. Layout/abbrev variants (REB vs Rebounds) can still fail.
- If the model quotes Assists in **both** evidence and snippet on a Rebounds pixel, the mapper cannot OCR-correct it.
- Jokic spelling / canonical player identity is still out of scope.
- Box-score refusal was not re-run in this 3-call cap (preserved in v2.1 tests).

## Recommended Next Step

X3A — Canonical Leg Resolution.

Do **not** start X3A in this step. Do not enable public extraction.

## Verification Checklist

1. `.env` still has `PARLAY_XRAY_EXTRACTION_ENABLED=false`.
2. Unique provider calls were 3, not more.
3. R1 Giannis Rebounds is known rebounds, not known assists.
4. R2 Rebounds and Assists did not swap.
5. R1 replay did not bill a fourth call.
6. Temp screenshots are deleted and not in git.
7. Do not start X3A or public enablement from this report.

## Step Verdict

GREEN — v2.1 passed real-world same-player market validation and is ready for canonical leg resolution
