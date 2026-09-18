# Phase 19 — Context Projection Prospective Collection Operations

## Runtime audit (actual, not inferred from manifests)

| Experiment | Before Phase 19 | After Phase 19 (this env) |
| --- | --- | --- |
| PTS | **NOT_ACTIVATED** — library + window freeze only; no scheduler | **NOT_ACTIVATED** — collector implemented; AWS schedule still DISABLED / writes OFF |
| MIN | **NOT_ACTIVATED** — arm script set metadata `2026-09-18T16:05:48Z` but did **not** invoke `buildProspectiveMinShadowRecord` on a live path | Same: code path exists; no live EventBridge ENABLED yet |

```text
PTS_COLLECTION_RUNTIME_STATUS = NOT_ACTIVATED
MIN_COLLECTION_RUNTIME_STATUS = NOT_ACTIVATED

PTS_CURRENT_N = 0 / 500
MIN_FINALIZED_PRIMARY_N = 0 / 750
```

No upcoming tips in the next 7 days (offseason). Zero live cohort rows — no historical backfill.

## Execution graph (repo architecture)

```text
schedule / data refresh
  (nightly-bdl-updater, injuries-snapshot, game-status-sync)
        ↓
context-prospective-shadow Lambda  [NEW — rate(5m) when ENABLED]
        ↓
pregame context materialization
  (Role/Form from PGL; Availability via injury tables → team-injury-context-v2)
        ↓
canonical T−60 eligibility (inclusive ≤ cutoff)
        ├── PTS: buildProspectiveShadowRecord → prospective_shadow_predictions
        └── MIN: buildProspectiveMinShadowRecord → prospective_min_shadow_predictions

game status = Final + PGL
        ↓
settle cycle (same Lambda)
        ├── PTS: insertProspectiveShadowOutcome (DNP-inclusive)
        └── MIN: resolveMinOutcomeAndRecompute (PLAYED primary; DNP diagnostic)
```

CatBoost `shadow-projection` remains a **separate** system (`prediction_snapshots`). Not overloaded.

## What “armed” meant vs operational

MIN arm at `2026-09-18T16:05:48Z` applied schema + wrote status JSON. It did **not** schedule collection. Phase 19 adds the missing runtime:

| Piece | Path |
| --- | --- |
| Worker | `lib/context-projection/collection-worker.ts` |
| Candidates | `lib/context-projection/collection-candidates.ts` |
| Status (no MAE) | `lib/context-projection/status.ts` + `npm run ops:context-projection-prospective-status` |
| Lambda | `lambda/context-prospective-shadow/index.ts` |
| Schedule | `infra/context-prospective-shadow.tf` (fail-closed defaults) |
| Lock note | `lib/context-projection/artifacts/ACTIVE_PROSPECTIVE_EXPERIMENTS.md` |

## Activation (deployment — not done in this workload)

1. `npm run build:context-prospective-shadow-lambda`
2. Terraform: `context_prospective_create=true`, `context_prospective_enable_schedule=true`, `context_prospective_execution_enabled=true`, `live_ingestion_enabled=true`
3. Lambda env: `CONTEXT_PTS_SHADOW_WRITES=1`, `CONTEXT_MIN_SHADOW_WRITES=1`, `CONTEXT_PROSPECTIVE_WINDOW_OPENED_AT=2026-09-18T16:05:48Z`, `DATA_MODE=live_api`
4. Expected state after enable, before first slate: **ARMED** → then **COLLECTING**

## Gates

All required operational gates: **PASS** (see JSON).  
`RUNTIME_COLLECTION_GATE=PASS` = invokable collector + settle implemented; schedule ENABLE is an explicit deploy step.

## Frozen identity

```text
PTS_MODEL_SHA = 36f68abd...
PTS_WINDOW = prod-pts-context-v1-first500

MIN_MODEL_SHA = 7354e0a8...
MIN_WINDOW = aux-min-role-avail-joint-v1-first750
```

## Next

```text
PTS NEXT = CONTINUE_PROSPECTIVE_PTS_SHADOW_COLLECTION
MIN NEXT = CONTINUE_AUXILIARY_MIN_PROSPECTIVE_COLLECTION
```

Independent certification when each reaches READY_FOR_READOUT. No MAE readout in this phase.

## Safety checklist

All expected **NO** items confirmed (no refit, no N change, no backfill, no synthetic live rows, no running MAE, no Props Explorer / MIN→PTS / production authority).
