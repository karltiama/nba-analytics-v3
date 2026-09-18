# ACTIVE PROSPECTIVE EXPERIMENTS — DO NOT MODIFY CASUALLY

Two frozen research windows are live for Context Projection:

## PTS

- Model: `prod-pts-context-role-form-joint-v1`
- SHA: `36f68abdab110ea13e78ac03d573aa3718b9ae7bb8b9bbd8a0d5983d83df478a`
- Window: `prod-pts-context-v1-first500`
- Required N: **500** PRIMARY_ELIGIBLE predictions
- Features: `role.fga_delta`, `form.points_delta` only
- Population: DNP-inclusive production Track B.1
- Storage: `analytics.prospective_shadow_predictions`
- Authority: **NO** production integration

## MIN

- Model: `aux-min-context-role-avail-joint-v1`
- SHA: `7354e0a8f9a8a15ade3c5f77e95b45b009661f49abfdcfea2c1e9edc3a4b1904`
- Window: `aux-min-role-avail-joint-v1-first750`
- Required N: **750** finalized PLAYED primary observations
- Features: `role.minutes_delta`, `injury.expected_missing_minutes`, `injury.rotation_players_out_count`
- Completeness: COMPLETE only for primary joint
- Population: PLAYED-only scoring (DNP diagnostic)
- Storage: `analytics.prospective_min_shadow_predictions`
- Path: `DEFER_PROPS_EXPLORER` — no MIN→PTS

## Competition universe (Phase 19B freeze)

Amendment `prospective-game-universe-v1`:

- **PRESEASON primary = NO**
- **Play-In / Playoffs / Finals = YES**
- Regular season includes unlabeled NBA Cup games
- Classifier: `lib/context-projection/game-universe.ts`

## DO NOT MODIFY without explicitly invalidating/versioning the experiment

- PTS / MIN model coefficients, alpha, feature lists
- Window IDs or required N
- Certified Role / Form / Availability semantics used by these features
- Snapshot policy (`LATEST_ELIGIBLE_AT_OR_BEFORE_T_MINUS_60`)
- Ordering / first-N PLAYED accounting for MIN

## Runtime

Collector: `lambda/context-prospective-shadow` + `lib/context-projection/collection-worker.ts`  
Ops status (no MAE): `npm run ops:context-projection-prospective-status`

Fail closed on SHA / baseline / window mismatches. Never write primary rows with a substituted artifact.
