# WOWY artifact contract

Registered experiment: `wowy-r1` (`reports/modeling/wowy-r1/`, adapter `lib/model-lab/adapters/wowy-r1.ts`).

The WOWY calculator is `lib/wowy/`. Model Lab does not reimplement classification. Frozen PTS C / REB C stay on their own registry row.

Commit JSON. Do not commit large row dumps or model binaries.

## Required: `results.json`

```json
{
  "version": "wowy-<id>",
  "feature_spec_version": "string",
  "dataset_sha256": "hex or null",
  "historical_validity_class": "reconstructed_historical",
  "eligibility": "plain-language row universe",
  "periods": { "train": "2023", "validation": "2024", "test": "2025", "prospective": null },
  "n": { "train": 0, "validation": 0, "test": 0 },
  "targets": [
    { "id": "points", "label": "Points", "units": "points", "derived": false }
  ],
  "feature_groups": [
    { "id": "wowy", "label": "With or without you", "description": "..." }
  ],
  "models": [
    { "id": "baseline", "label": "…", "feature_group_id": "track_a", "role": "baseline" },
    { "id": "wowy_v1", "label": "…", "feature_group_id": "wowy", "role": "candidate" }
  ],
  "note": {
    "validation": "Used for selection.",
    "test": "Previously inspected historical confirmation. Not an untouched holdout."
  },
  "results": {
    "validation|points": {
      "metrics": {
        "baseline": { "mae": 0, "rmse": 0, "bias": 0, "coverage": 1, "n": 0, "nFinite": 0 },
        "wowy_v1": { "mae": 0, "rmse": 0, "bias": 0, "coverage": 1, "n": 0, "nFinite": 0 }
      },
      "paired_deltas": [
        {
          "left_model_id": "baseline",
          "right_model_id": "wowy_v1",
          "delta": 0,
          "ci_low": 0,
          "ci_high": 0,
          "n": 0,
          "n_groups": 0,
          "iterations": 400,
          "left_mae": 0,
          "right_mae": 0,
          "source": "paired_observations"
        }
      ]
    }
  }
}
```

Keys may be camelCase (`ciLow`) or snake_case (`ci_low`); a WOWY adapter should accept the shape it writes.

## Optional: `slices.json`

Families Model Lab already displays: `limited_history`, `minutes_change`, `minutes_volume`. Additional families are allowed as strings.

Paired CIs on a slice must be computed from that slice’s paired rows. Do not subtract separate confidence intervals.

## Optional row explorer

`rows.jsonl` + predictions, gitignored, server-side pagination only. If absent, Model Lab shows an explicit unavailable state and keeps aggregate comparison.

Each row should include `player_id`, `game_id`, `basketball_date` or `start_time`, `split`, actuals, baseline prediction, learned/candidate prediction, and any input features you want inspectable. Label reconstructed historical features as such.

## Decision notes

`reports/modeling/model-lab/notes/<id>.md` plus a registry row in `lib/model-lab/registry.ts`.

## What not to send to the browser

Full `rows.jsonl`, `predictions.jsonl`, or `.cbm` / other model binaries.
