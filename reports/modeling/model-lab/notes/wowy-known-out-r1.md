---
experiment_id: wowy-known-out-r1
version: player-projection-wowy-known-out-r1
updated: 2026-09-16
---

# WOWY known-Out residual r1

## Decision
Inconclusive. Adding declared WOWY features to a matched ridge residual did not clear the paired ΔMAE bar versus the same residual without WOWY. Twelve evaluation dates; previously inspected 2025 development window. Not a production candidate.

## Why
Frozen split: train 394 (ET 2026-03-10–04-06), eval 231 (12 dates, 2026-04-07–05-05). Hash `b1db16cbbb9b324bc7fdb7a25e7692e0a4b18421205f3788453d7cd31c9b3dc4`. 16 of 625 reported-Out teammates still played; those rows were kept. Eligible 399 → 625 is **+226**; the 210 figure is the history-stale/raw-fresh diagnostic only.

## Out of scope
CatBoost. WITH scenarios. Frozen C retraining. Shadow activation. Browser verification of `/admin/model-lab` is recorded separately from adapter tests (page loaded 2026-09-16).

## Follow-up
Prospective known-Out testing after injuries-only collection, not another pass on this eval window.
