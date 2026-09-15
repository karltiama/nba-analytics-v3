# Prospective shadow protocol — PTS C / REB C r1

Version: `player-projection-shadow-pts-reb-c-r1`. Written before live results exist.

Production projections remain unchanged. Historical CatBoost grids are frozen. 2025 is not used to refit or reselect.

## Frozen artifacts

- Models: `c_points.cbm`, `c_rebounds.cbm` (feature set C only).
- Feature spec: `player-projection-learned-features-r1`.
- Feature order: `FEATURE_C_ALLOWLIST` (must match CatBoost `feature_names_`).
- Bundle: `reports/modeling/shadow-pts-reb-c-r1/` with `manifest.json`.
- A/B controls: frozen played-only Track A (70/30) and conditional EWM minutes (never on 3PM). Evaluated on the same eligible played games as C.

## Generation

- Target: 60 minutes before **that game’s** scheduled tipoff.
- Mixed tipoffs are handled per game. A 5-minute lookahead window (`due`) is not a shared daily batch.

## Amendment r1.1 (timing; before prospective observations)

The original protocol named T−60 and a 15-minute due lookahead, but it did **not** define scheduler interval, allowable execution latency, or which late rows enter primary evaluation. Those rules are now explicit. They do **not** change frozen models, feature order, or the on-time definition.

| Item | Rule |
| --- | --- |
| Feature cutoff | `scheduled_tipoff − 60 minutes` (unchanged) |
| Scheduler interval | 5 minutes (`rate(5 minutes)`) |
| Due window | `[cutoff − 5 minutes, cutoff]` |
| Allowable execution latency | 90 seconds to **start** a due cycle (ops SLA only) |
| On-time | `generated_at <= intended_cutoff_at` (unchanged). Late is never rewritten to on-time. |
| Primary evaluation | `on_time` rows only. Late / failed / missing are coverage, not primary MAE. |
| Evaluation window start | First **scheduled** regular-season tipoff in `analytics.games` for season 2026 with ET date ≥ `YYYY-10-15` (same floor as `historicalSeasonWindow.servingMinDate`). Captured in `analytics.shadow_window_anchors`. Tipoff revisions append a new revision; previous snapshots stay. The window does **not** start at the first successful prediction. |

If a cycle starts after cutoff, generate anyway and store `delivery=late`. Do not skip late storage.

- Candidates come from last observed team appearances before cutoff, never from the eventual box.
- C features still exclude the target America/New_York basketball date.
- Live source observations must have `observed_at <= intended cutoff`.
- Unresolved identities and insufficient history are explicit eligibility classes, not silent zeros.
- Delivery: `on_time` (generated_at ≤ cutoff), `late`, `failed`, `missing`. Late generations keep the real clock. The first logical snapshot wins; retries do not overwrite.

## Evaluation window

- Primary: first 60 calendar days beginning with the first regular-season game.
- No model, feature, or configuration changes and no promotion decisions during that window.
- Operational monitoring may run continuously. Performance monitoring must not trigger retuning.
- Any material model or feature change starts a **new protocol version** and a new prospective cohort.

## Metrics

Report MAE, RMSE, signed bias, paired differences with game-date clustered bootstrap, and pregame slices (minutes-change, minutes volume, limited history).

Nomination carry-forward (does not imply prospective success):

- PTS C and REB C only.
- ΔMAE vs B ≤ −0.01 with grouped 95% CI entirely below zero.
- Historical nomination ≠ prospective success.

Also report prediction **delivery coverage** over the intended pregame population, including eventual DNPs, missing predictions, and unknown participation. Conditional-on-playing accuracy is separate. A missed prediction is not a zero outcome.

## Production mismatch

Played-only research A/B/C are not the current production season-average / DNP-inclusive inputs. A production rollout must address that mismatch separately. This protocol does not switch shadow scoring onto production season averages and does not put CatBoost on the Next.js request path.

## Settlement

Completed-game settlement writes a separate immutable record (`played` / `DNP` / `postponed` / `cancelled` / `unresolved`). Original predictions are never altered.
