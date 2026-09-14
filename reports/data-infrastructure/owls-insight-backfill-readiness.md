# Owls Insight historical NBA player-prop backfill readiness

Status as of 2026-09-14: **PHASE 0 complete. No trial started. No live Owls requests made.**

Preparation only. The 3-day trial window must be spent on acquisition, not development.

## API contract

Sources (documentation only):

- https://owlsinsight.com/docs
- https://owlsinsight.com/terms (effective 2026-08-24)
- `owls-insight-ts` README (npm)
- `owls-insight` Python SDK README (PyPI)

Base URL: `https://api.owlsinsight.com`  
Auth: `Authorization: Bearer <api key>`  
Default timeout (SDK): 30s

### Confirmed endpoints (do not invent others)

| Path | Role | Pagination | Notes |
| --- | --- | --- | --- |
| `GET /api/v1/history/coverage` | Date range per sport/dataset | n/a | See how far history goes before querying. |
| `GET /api/v1/history/games` | Archived games | limit default 50 max 100, offset | At least one of sport, season, team, startDate. `gameType`: regular, playoff, allstar, preseason, playin. |
| `GET /api/v1/history/props` | Prop **snapshots** for one `eventId` | limit default 1000 max 5000, offset | Optional playerName, propType, book, startTime, endTime. `opening=true` = first recorded snapshot per player/prop/book. |
| `GET /api/v1/history/player-props` | Historical **closing** player-prop lines (backfill archive) | limit default 50 max 100, offset | NBA from 2022-23. Books: draftkings, caesars, betmgm, espnbet. At least one of eventId, player, startDate. |

Primary Court Context acquisition path: **`/history/player-props`** (documented closing tape with opening + closing lines).  
Game identity path: **`/history/games`**.  
Optional later snapshot tape: **`/history/props`** (more books, snapshots, not labeled closing unless the payload proves it).

Pagination rule (docs): page one event at a time with limit/offset; stop when a page is shorter than limit. Do **not** fan out one event across books in parallel.

### Rate limits (docs)

| Tier | REST req/month | req/min | concurrent | History in flight |
| --- | --- | --- | --- | --- |
| Bench | 10,000 | 20 | 1 | Not included |
| Rookie | 75,000 | 120 | 5 | Not included |
| MVP | 300,000 | 400 | 15 | 3 |
| Hall of Fame | Unlimited | 1,000 | 20 | 4 |

History over cap → `429` with `Retry-After: 2` and `code: "HISTORY_CONCURRENCY"`.  
History `503` + `Retry-After` → query too expensive or archive busy; narrow filters or smaller limit.

Headers: `X-RateLimit-Remaining-Minute`, `X-RateLimit-Remaining-Month`, `X-RateLimit-Reset-Minute`, `X-RateLimit-Reset-Month`.

This client defaults to **2** historical in-flight requests and hard-caps at **4**.

## Historical coverage

Confirmed from docs:

- NBA games archive backfilled from **2016-17**.
- Historical closing player props: **NBA from 2022-23**, 2.6M+ lines, DraftKings / Caesars / BetMGM / ESPN BET. Book mix varies by season. Dataset lags the current slate.

Needs live probe:

- Exact coverage completeness for 2023-24, 2024-25, 2025-26 regular season vs playoffs.
- Whether Owls `season=2023-24` matches Court Context `season=2023`.
- Observed rows/game and pages/game.

## Prop mapping

| Court Context | Owls `propType` | Status |
| --- | --- | --- |
| PTS | `points` | SUPPORTED |
| REB | `rebounds` | SUPPORTED |
| AST | `assists` | SUPPORTED |
| 3PM | `threes_made` (alias `threes`) | NEEDS LIVE PROBE — both values are documented |
| PRA | `pts_rebs_asts` (alias `points_rebounds_assists`) | SUPPORTED as a distinct sportsbook market |
| PA | `pts_asts` (alias `points_assists`) | SUPPORTED as a distinct sportsbook market |
| PR | `pts_rebs` (alias `points_rebounds`) | SUPPORTED as a distinct sportsbook market |
| RA | `rebs_asts` (alias `assists_rebounds`) | SUPPORTED as a distinct sportsbook market |

Do **not** fabricate combo lines by summing component markets.

## Archive format

Bucket: `nba-analytics-data-260029269390` (env `NBA_DATA_BUCKET`). Versioned. No lifecycle expiration.

Provider prefix (never mix with BallDontLie / recovered dumps):

```
raw/source=owls_insight/league=nba/season={ccStartYear}/entity=historical_player_props/
  game_date={YYYY-MM-DD}/provider_game_id={eventId}/page={NNNN}.json.gz
```

Fixture writes use `source=owls_insight_fixture` and never the production prefix.

Protected (refused):

- `raw/source=existing_ingestion/`
- `raw/source=balldontlie/.../opening_player_props`
- `raw/source=balldontlie/.../player_prop_snapshots`
- `entity=player_props_raw_v2`

Envelope (`owls_historical_player_props.v1`):

```json
{
  "schema": "owls_historical_player_props.v1",
  "provider": "owls_insight",
  "backfill_run_id": "owls-2026-09-14-probe",
  "requested_at": "2026-09-14T16:00:00.000Z",
  "archived_at": "2026-09-14T16:00:00.000Z",
  "request": { "method": "GET", "path": "/api/v1/history/player-props", "query": {} },
  "response_metadata": { "status": 200, "headers": {}, "durationMs": 120 },
  "row_count": 8,
  "checksum": "sha256-of-payload",
  "page_index": 1,
  "offset": 0,
  "limit": 100,
  "provider_game_id": "...",
  "season": "2023",
  "game_date": "2023-12-25",
  "fixture": false,
  "payload": {}
}
```

Execution order: **provider response → gzip archive → checksum verify → checkpoint ARCHIVED → normalize/map**. Normalization failure must not discard raw.

Existing Apr–May 2026 BDL/internal tape is **not** deduplicated against Owls. Overlap is for later provider comparison.

## Backfill manifest

Canonical game universe is `analytics.games` with `status = 'Final'`.

Frozen counts (queried 2026-09-14):

| Season (CC start year) | NBA year | Regular Final | Play-in | Playoff | Total Final | Earliest | Latest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2023 | 2023-24 | 1231 | 6 | 82 | 1319 | 2023-10-24T23:30:00Z | 2024-06-18T00:30:00Z |
| 2024 | 2024-25 | 1231 | 6 | 84 | 1321 | 2024-10-22T23:30:00Z | 2025-06-23T00:00:00Z |
| 2025 | 2025-26 | 1231 | 6 | 85 | 1322 | 2025-10-21T23:30:00Z | 2026-06-14T00:30:00Z |

2025 has one non-Final dirty row (`21681993`, ISO timestamp stored as status) and is excluded.

Play-in windows (ET, matching Court Context `POSTSEASON_START_ET`): 2023 `2024-04-16`–`2024-04-19`; 2024 `2025-04-15`–`2025-04-18`; 2025 `2026-04-14`–`2026-04-17`.

Manifest fields: `court_context_game_id`, `season`, `start_time`, `home_team`, `away_team`.

## Checkpoint / resume

Persistent JSON at `data/owls-insight/runs/<run_id>/checkpoint.json` (gitignored).

Per unit: `PENDING | FETCHING | ARCHIVED | NORMALIZED | FAILED | SKIPPED`.

`--resume` is default for execute/fixture. If S3 already has a verified object for the same request/page, it is not fetched again.

## Identity mapping

Games: Owls → `analytics.games` via normalized home/away aliases + season + start time (±18h). Unique postponed/rescheduled match within 72h is allowed. Ambiguous sets are never auto-chosen. Home/away reversed is UNMATCHED with a diagnostic.

Players: provider id bridge if present; otherwise unique normalized name (Jr/Sr/II/III, punctuation, accents, hyphens). Duplicate names stay AMBIGUOUS unless team context uniquely resolves. Raw provider name/id are kept on every normalized row.

## Open / close vs snapshot semantics

Do not force Owls into the BDL `snapshot_at` model.

| Endpoint | Documented meaning | Normalized `snapshot_type` |
| --- | --- | --- |
| `/history/player-props` | Historical **closing** player-prop lines; dataset described as having **opening and closing** lines | `closing_archive` |
| `/history/props` | Snapshots for an archived game | `archived_snapshot` |
| `/history/props?opening=true` | First recorded snapshot per player/prop/book | `opening_filter` |

`opening_line` / `closing_line` are populated **only** when those fields exist on the provider payload. A generic `line` is never renamed to closing.

Exact JSON keys are **NEEDS LIVE PROBE**. Fixtures are labeled `FIXTURE_SYNTHETIC`.

## Dry-run plan

```
npm run plan:owls-prop-backfill -- --season 2024
npm run plan:owls-prop-backfill -- --season 2023
npm run plan:owls-prop-backfill -- --season 2025
npm run plan:owls-prop-backfill -- --from 2025-01-15 --to 2025-01-15
npm run plan:owls-prop-backfill -- --game-id 1037995
```

No API calls. No API key required.

## Live probe plan

**Do not run until the trial is activated.**

Phase 1 games:

1. `1037995` — 2023-12-25 LAL vs BOS (Christmas)
2. `15905067` — 2024-06-18 BOS vs DAL (2023-24 Finals)
3. `18444564` — 2025-06-23 OKC vs IND (2024-25 Finals)
4. `18447233` — 2025-12-25 OKC vs SAS (Christmas)
5. `21716138` — 2026-06-14 SAS vs NYK (2025-26 Finals)

```
npm run backfill:owls-props -- --game-id 1037995 --phase 1 --execute --yes --run-id owls-2026-09-15-probe
```

`--execute` is mandatory for network. `OWLS_API_KEY` is required. `--yes` is required. Concurrency default 2.

Verify on each probe: game exists, props exist, books exist, PTS/REB/AST/3PM/PRA/PA/PR/RA, lines, prices, opening/closing semantics, game mapping, player mapping, raw archive.

## Trial stop conditions

Automatically stop before bulk if: poor event match rate, poor player match rate, missing core props, absent prices, shallower history than documented, repeated 429/503, pagination anomaly, archive checksum failure. Bulk requires explicit approval (`--phase 2` and a passing Phase 1 report).

## Phase plan

| Phase | What | Auto-advance? |
| --- | --- | --- |
| 0 | Code + fixtures + planning | n/a (current) |
| 1 | 3–5 game live probe | No |
| 2 | One NBA week | No |
| 3 | One NBA month | No |
| 4 | One complete season | No |
| 5 | Remaining target seasons | No |

Each phase writes a validation report (games/players/props/books/coverage/opening/closing/prices/API/S3).

## Reconciliation

```
npm run reconcile:owls-prop-backfill -- --run-id owls-2026-09-15-probe
```

Compares checkpoint units to S3 objects. Non-zero exit if required raw data is missing or checksums mismatch. No Owls calls.

## Storage estimate

Fixture-based only until probe. Gzip envelope for the 8-row synthetic player-props page is small (typically a few KB). Object counts = games × pages/game + game-list pages. Pages/game is **unknown until live probe**. Do not drop raw payloads to save S3.

## Trial-time estimate

Unknown until live probe observes seconds/game.

Theoretical (docs, not observed): MVP 3 history in-flight / we use 2; 400 req/min; ~1320 Final games/season. If 1 player-props page/game plus ~14 game-list pages: ~1.3k history requests/season. If 10 pages/game: ~13k. Monthly MVP quota 300k is enough for three seasons at those sizes. Runtime still unknown.

## Retention / terms question

See `reports/data-infrastructure/owls-insight-retention-question.md`. Do not contact Owls automatically.

Documented terms (no legal conclusion beyond the text):

- §7: no share/resell/redistribute/sublicense of API data without prior written consent.
- §7: no competing product that replicates core Owls functionality.
- §6.3: cancelling a trial ends API access immediately.
- §9: odds data is aggregated from public sources; Owls does not claim ownership of underlying sportsbook odds; use is subject to the Terms.
- §10: informational/analytical/research use.
- Retention after trial/subscription ends is **not** explicitly granted in the published Terms.

## Commands

```
npm run plan:owls-prop-backfill -- --season 2024
npm run backfill:owls-props -- --fixture --game-id 1037995
npm run backfill:owls-props -- --game-id 1037995 --execute --yes
npm run reconcile:owls-prop-backfill -- --run-id ...
npm run normalize:owls-props -- --run-id ...
```

Normalize and reconcile never call Owls.
