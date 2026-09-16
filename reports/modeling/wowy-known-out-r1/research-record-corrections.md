# WOWY known-Out r1 research-record corrections

Preserved: cohort hash `b1db16cbbb9b324bc7fdb7a25e7692e0a4b18421205f3788453d7cd31c9b3dc4`, freeze split, residual metrics, Model Lab decision **inconclusive**. No retrain. No re-evaluation on the frozen eval dates.

## 399 → 625 is +226, not +210

`625 − 399 = 226`. The `210` figure is a diagnostic: rows whose **history change-row** was stale and whose **raw last-observed** pull was still eligible. It is not the net eligibility change.

Exclusive terminal movement (same 7,083 source):

| Terminal | History audit | Last-observed freeze | Δ |
| --- | ---: | ---: | ---: |
| observation_stale | 2,300 | 2,155 | −145 |
| status_not_explicit_out | 837 | 755 | −82 |
| insufficient_wowy_support | 126 | 127 | +1 |
| no_precutoff (incl. post-cutoff diagnostic 1,959) | 3,337 | 3,337 | 0 |
| no_primary_teammate | 84 | 84 | 0 |
| eligible | 399 | 625 | **+226** |

Identity: `-145 + -82 + 1 + 226 = 0`.

Among the 625 freeze-eligible rows, 210 have a stale history timestamp and a fresh raw observation. The remaining **16** of the +226 had a **fresh history timestamp** but became eligible only after switching last-observed status/membership (history latest change was not an explicit Out, or a one-row support-threshold shift). Cross-flows: 65 rows entered the raw-stale terminal from other history buckets, so stale only fell by 145 even though 210 stale history rows were recovered.

## Inner 127 vs final 394

Training ET dates: 28 (2026-03-10–04-06). Inner chrono split uses the last 30% of those dates (`floor(28 × 0.7) = 19` inner-train dates; 9 inner-val dates; **127 rows**). Lambda was selected on that inner holdout (`selected: true`, grid {0.3,1,3,10,30}, inner N ≥ 40).

`fitAndApply` then fits ridge on **all 394 training rows** with the selected λ and train-only medians. Eval 231 was not used for λ or preprocessing.

This matches the declared procedure. No discrepancy. Not refit.

## Decision

Unchanged: **inconclusive**. About 12 evaluation dates. Previously inspected development window.
