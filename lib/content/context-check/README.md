# Context Check Architecture

Inputs:

- future automatic database discovery
- manual creation

Both normalize into:

`ContextCheckData`

Consumers:

- `ContextCheckCard`
- social preview
- future published page
- future Performance Check

This v1 ships presentation, the canonical model, an admin studio, and mock/manual preview only.

Public auto-publishing is intentionally **not** part of v1.

Intended future workflow:

```text
Database
   ↓
Candidate detection
   ↓
Suggested Context Check
   ↓
Human review
   ↓
Publish
```

Not:

```text
Database → Social Media
```

```text
Database / Manual Input / Future Discovery Engine
                    ↓
             ContextCheckData
                    ↓
          ContextCheckCard
                    ↓
        Web / Social Preview
```

## Snapshot rule

When a Context Check is later published, freeze the statistics as a snapshot.
Historical posts must not change because later games were added to the database.

## Persistence (not built)

A future `context_checks` table may store:

- id, player_id, game_id, market_type, direction, line
- headline_json, samples_json, line_context_json, role_context_json
- verdict, verdict_text
- data_as_of, created_at, published_at

Do not create that table in this phase.

## Discovery (not wired to production)

`findContextCheckCandidates()` exists as a source interface. v1 uses
`MockContextCheckDiscovery`. Do not query `analytics.*` or `raw.*` from this
module until a dedicated read-only path is confirmed safe and isolated from
ingestion.

## Safety

This feature must not touch ingestion jobs, schema, migrations, identity
resolution, or serving write paths.
