# STEP 14P.X2C.1b — Parlay XRay v2 targeted browser re-test

Date: 2026-09-15
Status: YELLOW
Operator: KrazyKarlHD (authenticated `/parlay-xray`)
Kill switch: temporarily true for the session, restored **false** afterward

## Executive Result

Four unique `gpt-4o-mini` / `detail=low` / `xray-extract-v2` extractions ran through the real upload → Extract screenshot UI. Replay of the last image was a cache hit with **zero** additional provider calls. Full XRay analysis did not run.

The X2C F1 box-score failure is fixed in the live path. Same-player markets no longer collapse to points, but Giannis Over 8.5 Rebounds was still read as Assists. Side (Under) and missing-field UNKNOWN behavior held.

## Safety

| Check | Result |
| --- | --- |
| Kill switch during test | `PARLAY_XRAY_EXTRACTION_ENABLED=true` (local `.env` only) |
| Kill switch after test | `false` (verified `quota.enabled: false`) |
| Cooldown | temporarily `0` for sequential unique images, then removed |
| Model / detail | gpt-4o-mini / low (unchanged) |
| Public extraction | still not a product default |
| NEXT_PUBLIC XRay key | absent |
| Full analysis / Explorer | not started |
| Unique paid calls | **4** |
| Replay provider calls | **0** |

## Cases

### F1 — box score (X2C critical failure)

Image: `F1-box-score-nonslip.png` (1024×768, 21953 bytes)

- Result: `NO_LEGS_FOUND`
- UI: **0 legs**, empty panel, notice *This image doesn't clearly appear to be a betting slip.*
- Quota: 9 → **8** remaining
- Completion tokens: 43 (empty refused payload)
- Estimated cost: **$0.000661**
- Verdict: **PASS** — no invented Overs

### A2 — same-player multi-market

Image: `A2-clean-3.png` (1024×860, 23788 bytes)

Expected: Giannis Over 27.5 Points; Giannis Over 8.5 Rebounds; Bam Over 5.5 Rebounds

Got:

| Leg | Result |
| --- | --- |
| Giannis Over 27.5 Points −113 | correct |
| Giannis Over 8.5 **Assists** −132 | **wrong market** (expected Rebounds; not a points copy) |
| Bam Over 5.5 Rebounds −110 | correct |

Quota: 8 → **7**. Cost: **$0.001041**. Verdict: **PARTIAL** — points carry-over is gone; rebounds still confused with assists.

### A3 — Over + Under

Image: `A3-clean-5.png` (1024×1180, 30984 bytes)

- 5 legs, all resolved
- Coby White **Under 13.5 Points −115** preserved (X2C side-identity target)
- Jokic OCR still `Jockic` (name quality, not side)
- Quota: 7 → **6**. Cost: **$0.001256**
- Verdict: **PASS** for side identity

### D2 — missing matchup / missing odds

Image: `D2-missing-fields.png` (1024×780, 17839 bytes)

- 3 legs
- Matchup shown as unavailable on all three (not invented)
- Giannis odds shown as **—** (not invented)
- Combined odds unavailable
- Quota: 6 → **5**. Cost: **$0.001011**
- Verdict: **PASS** for missing-field UNKNOWN

### D2 replay

Same file, Extract again. Quota stayed **5 of 10**. Usage row: `cache_hit=true`, `provider_attempted=false`. Cost null.

## Provider accounting

| Attempt | Version | Provider | Cache | Cost |
| --- | --- | --- | --- | --- |
| F1 | xray-extract-v2 / xray-legs-v2 | yes | no | $0.000661 |
| A2 | v2 | yes | no | $0.001041 |
| A3 | v2 | yes | no | $0.001256 |
| D2 | v2 | yes | no | $0.001011 |
| D2 replay | v2 | no | yes | $0 |

**REAL_PROVIDER_CALLS: 4**  
**Estimated total: $0.003969**  
Mean unique-call cost ≈ $0.000992

## UI / product contract

- Extract still requires an explicit click
- Confirm was not used; analysis panel stayed *Analysis unavailable*
- Non-slip showed no fictional leg cards
- v1 cache was not reused (all usage rows are v2)

## Remaining issue

A2 second Giannis market: visible **Rebounds** returned **Assists**. This is not the X2C points-copy failure, but field identity is still incomplete for abbreviated/nearby market labels (`REB` vs `AST`). Do not treat v2 as fully certified for same-player multi-market.

## Cleanup

- `PARLAY_XRAY_EXTRACTION_ENABLED=false`
- `PARLAY_XRAY_COOLDOWN_SECONDS` removed
- Next.js restarted so the running server reloaded the kill switch
- CORS temp screenshot server stopped
- Synthetic images remained local-only under `%TEMP%\parlay-xray-x2c`

## Step Verdict

YELLOW — F1 refusal, Under preservation, and missing-field UNKNOWN passed live; same-player market identity still misread Rebounds as Assists

PAID_EXTRACTION: DISABLED (restored)  
PUBLIC_EXTRACTION: DISABLED  
REAL_PROVIDER_CALLS_THIS_STEP: 4  
EXTRACTION_VERSION: xray-extract-v2  
FULL_XRAY_ANALYSIS: NOT_IMPLEMENTED  
CANONICAL_LEG_RESOLUTION: NOT_STARTED  
PARLAY_EXPLORER: NOT_IMPLEMENTED
