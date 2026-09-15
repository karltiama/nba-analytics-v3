# Model Lab — register an experiment

Version-controlled workbench for Court Context projection research. The UI reads this registry and typed adapters. It does not train, deploy, or edit production.

## Add the next experiment

1. Produce structured artifacts (prefer JSON). See `WOWY_ARTIFACT_CONTRACT.md` if the experiment is WOWY.
2. Add a notes file under `reports/modeling/model-lab/notes/<id>.md` using the template below.
3. Add a `RegistryEntry` in `lib/model-lab/registry.ts` (id, adapter name, artifact paths). Do not hardcode model letters in the page.
4. If the artifact shape is new, add `lib/model-lab/adapters/<name>.ts` and register it in `lib/model-lab/catalog.ts`.
5. Commit the JSON summaries, notes, and registry row. Do **not** commit `rows.jsonl`, `predictions.jsonl`, or `.cbm` binaries.

## Notes file template

```md
---
experiment_id: your-id
version: your-version-string
updated: YYYY-MM-DD
---

# Title

## Decision
One-line recorded decision.

## Why
What evidence was in-scope (which split).

## Out of scope
What this run did not authorize.

## Follow-up
What to try next.
```

Edit notes in git. There is no in-browser editor in v1.

## Editing workflow

1. Branch.
2. Change only the notes markdown and/or registry entry.
3. Open `/admin/model-lab` locally (session + `ADMIN_EMAILS`).
4. Confirm the history card shows the new decision text.
5. Commit.

`ADMIN_EMAILS` is fail-closed. Unset or empty admits nobody.
