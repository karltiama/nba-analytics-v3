# Historical Explorer v2 — Step 12G Timeline read model

**Step verdict:** `GREEN — Historical Timeline read model is certified and ready for UI`

**Product classification:** `READ_MODEL_CERTIFIED` (no Timeline UI in this step)

**Date:** 2026-09-10  
**Scope:** certified 2025 Plays archive → quality gates + compact `analytics.game_flow` + `getHistoricalGameTimeline`. No Timeline UI, possessions, WOWY, Role Profile changes, Advanced changes, or Market Movement changes.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| BDL HTTP | **0** |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Plays archive | **read-only** S3 GetObject |
| Provider acquisition | none |
| Live PBP ingestion | unchanged |
| Possession reconstruction | **not started** |
| WOWY | **not started** |
| Role Profile / Advanced / Starting Five / Market Movement | unchanged serving |
| Timeline UI | **not built** |
| Raw 642k events in Postgres | **not stored** |

12G is historical 2025 Timeline infrastructure only.

---

## Plays Source Certification

Reused GOAT 9D / 9E / closeout and 12A. No reacquisition.

| Fact | Value |
| --- | --- |
| Authoritative 2025 games | 1,322 |
| Canonical S3 objects | 1,322 |
| Events | **642,354** |
| Avg / min / max events | ~485.9 / 399 / 644 |
| Zero-event / failed games | 0 / 0 |
| Duplicate `(game_id, order)` | 0 |
| Order gaps / null orders | 0 / 0 |
| Participant IDs mapped | 579 / 579 |
| Periods | 1–6 |
| OT games | 60 |
| Null-team events | 8,260 (admin; left null) |
| Shot coordinates | S3-only; **not** in Timeline v1 |

Canonical key:

`raw/source=balldontlie/league=nba/season=2025/entity=plays/game_id={id}.json`

---

## Timeline vs Score vs Rotation Quality

These are independent flags. There is **no** `game_valid`.

| Gate | Question | Serving columns |
| --- | --- | --- |
| Timeline | Can we display chronology without a misleading full PBP? | `timeline_available`, `stream_class`, `quality_code` |
| Score | Does last Plays running score equal `analytics.games`? | `score_reconciled`, `plays_final_*` |
| Rotation | Did certified rotation reconstruction succeed? | `rotation_available`, `rotation_failure_class` |
| Possession | Not implemented | — |

Official header score / winner / status remain `analytics.games`. Plays never overwrite the header.

---

## Timeline Eligibility Policy

Fail-closed on **truncated** streams; do **not** auto-reject every score mismatch.

A stream is **truncated** when any of:

1. no events, or order is malformed (null / duplicate / gap)
2. official combined score ≥ 80 **and** Plays last combined / official < **0.70**
3. official combined ≥ 80 **and** max period < 4
4. no `End Game` **and** combined deficit ≥ **20**

Otherwise, if the chronology looks complete (normal event count, period 4+, typically `End Game`):

- `timeline_available = true`
- `score_reconciled` may still be false
- 12H **must** banner score mismatches and must **not** treat Plays running score as the official final

Certified result:

- **1,319 / 1,322** Timeline available
- **3** truncated → Timeline hidden, events not returned
- **1,302 / 1,322** score exact (unchanged from 9E)
- **17** chronology-usable score mismatches (`quality_code = SCORE_MISMATCH`)

---

## Score-Mismatch Classification

Certified 20 IDs unchanged. No source edits.

### B — truncated (Timeline **false**) — 3

| Game | Plays | Official | Events | Why |
| --- | --- | --- | --- | --- |
| `18446876` | 44–35 | 98–79 | 425 | last combined 79 / 177 = 45% |
| `18447389` | 28–38 | 109–118 | 477 | last combined 66 / 227 = 29% |
| `18447390` | 12–8 | 112–101 | 497 | last combined 20 / 213 = 9% |

These still have ~400–500 rows (not empty objects). Last running score is not a full game. Returning a “full” PBP would be misleading, so Timeline is hidden.

### A — chronology-usable (Timeline **true**, score flag) — 17

Examples:

- `18446874` 121–110 vs 121–111 (1 pt)
- `18446941` 114–148 vs 115–148 (1 pt)
- `18446885` 108–114 vs 115–116
- `18446886` 87–92 vs 113–114 (**large residual**; still full-length + `End Game`)
- `18447741` 103–80 vs 121–110 (large residual)
- `18447742` 101–74 vs 122–92 (large residual)

**12H rule:** if `score_reconciled = false`, show a scoped note and do not plot lead / run / period scoring as official. Chronology (subs, fouls, shots) may still be useful.

Uncertain count this run: **0** (the 17 non-truncated mismatches had `End Game` and ratio ≥ 0.70).

---

## Rotation-Failure Handling

Certified 36 failures preserved. Classes: 27 `MISSING_PARTICIPANT`, 5 `BOTH_OFF_COURT`, 4 `BOTH_ON_COURT`. No heuristic repair.

Starter anomalies `18447931` / `18447988`: Timeline **true**, rotation **false** (`STARTER_ANOMALY`).

A game may be `timelineAvailable = true` and `rotationContextAvailable = false`. Verified on `18446930`.

---

## Normalized Event Contract

Server/domain only. React does not parse provider JSON.

Canonical identity: **`game_id + order`**. Clock / wallclock / description are not uniqueness keys. Same-clock events keep `order`.

| Field | Source |
| --- | --- |
| `order` | provider `order` |
| `period` / `periodLabel` | provider `period` → Q1–Q4, OT, 2OT, … |
| `clock` / `clockSecondsRemaining` | display + parsed seconds |
| `category` | conservative map (below) |
| `rawType` | exact provider type (newlines preserved) |
| `description` | `text` |
| `teamId` | nested `team.id` or `team_id`; **null allowed** |
| `primaryPlayerId` / `secondaryPlayerId` | `participants[0]` / `[1]` |
| `primaryPlayerName` / `secondaryPlayerName` | join `analytics.players` at read time |
| `scoreHome` / `scoreAway` | running Plays scores; null if missing (not invented) |
| `scoreValue` | provider `score_value` |
| `scoringPlay` | provider flag |
| `substitutionPlayerIds` | participants when category = substitution |
| `leadChange` / `becameTied` | derived from `order` + running scores |

**Not included:** shot coordinates, wallclock, possession id, IN/OUT direction, sportsbook data.

Substitution v1: **“Substitution — players from participants / text”**. Provider type has no IN/OUT label. Direction is **not** inferred from on-court state. Rotation-certified “A in for B” is deferred to a later module that already passed rotation quality.

---

## Event Type Mapping

137 exact provider strings → 12 product categories.

Priority: substitution / jump ball / period / review / timeout / rebound / turnover / free throw / foul, then `shooting_play`+`scoring_play` for **scoring** vs **shot_missed**, else **other**.

Unknown types do not crash; they become `other`. `rawType` is kept.

Free throws stay `free_throw` even when `scoring_play` is true (more specific). Shot makes/misses are **not** typed from the 50+ “Jump Shot …” strings alone.

---

## Clock / Period Semantics

- Chronology = `order` only. No clock sort.
- Display parser accepts `M:SS`, `MM:SS`, optional fractional seconds, and sub-minute `SS.s` (e.g. `5.3`). Unparsed clocks stay as display text.
- Period helper does **not** assume max period = 5. Period 6 → `2OT`. Verified on `18446819` (period_count 6, overtime_count 2).

---

## Score Progression

Running scores come from event `home_score` / `away_score` when present. Missing intermediates are not manufactured.

Official final is always `analytics.games`.

For truncated games, lead / tie / largest-lead / scoring-run fields are **null** (fail closed). Period point arrays are still stored as stream-derived diagnostics and must not be shown as a complete Timeline.

---

## Lead / Tie / Period Summary

Processed in `order`. Opening **0–0 is not a counted tie** and is not a lead change.

- **Tie:** running score becomes equal after it was not equal.
- **Lead change:** leader switches from home to away or away to home. Taking the lead from a tie is **not** a lead change.
- **Largest leads:** max home−away and away−home over scored snapshots. Not inferred from the official final.
- **Period points:** last running score in period *p* minus last score of period *p−1*. Not forced to official totals.
- **Scoring run:** consecutive points by one team before the opponent scores (score-sequence, **not** a possession run). Free throws count when they move the score.

`18447937` (SAS @ LAC, official 118–99): Plays 99–118 exact; period points 25+19+34+21 / 33+35+19+31; lead changes 2; ties 1.

---

## Game Flow Serving Schema

`analytics.game_flow`

- Grain: `game_id` (FK `analytics.games`)
- One row per 2025 archive game
- No names, no jsonb, no raw events
- RLS **false**; grants owner/`postgres` only; **no anon**
- PK only; no extra indexes

---

## Backfill / Certification

```
npx tsx scripts/apply-game-flow-schema.ts
npx tsx scripts/ingestion/materialize-game-flow-2025.ts --dry-run
npx tsx scripts/ingestion/materialize-game-flow-2025.ts --execute --i-understand-production-write
```

| Run | Written | Notes |
| --- | --- | --- |
| dry-run | 0 | 1,322 candidates, 0 missing official, 0 read errors |
| execute 1 | **1,322** | guarded UPSERT |
| execute 2 | **0** | `IS DISTINCT FROM` idempotent |

Source: canonical S3 only. `DATA_MODE=replay` required. No BDL client.

---

## S3 Runtime Read Strategy

`readCanonicalPlaysObject(store, gameId)` in `lib/archive/plays-2025-read.ts`.

- One GetObject per game
- Server-only (`S3Storage`). Not imported from client components.
- Missing object → unavailable
- `truncated: true` / malformed envelope → safe failure
- Details route does **not** load events; it only reads `game_flow` flags

`getHistoricalGameTimeline(gameId)` returns `{ available, quality, gameFlow, events, officialHomeScore, officialAwayScore }`. Truncated / unavailable games return `events: []`.

---

## Cache Recommendation

2025 Plays objects are immutable (~400–650 events, ~0.4 MB JSON).

Implemented: process LRU, **48** games.

For 12H: wrap `getHistoricalGameTimeline` with Next `unstable_cache` (gameId key, long TTL / `revalidate: false`). Do **not** copy events into Postgres to avoid measuring S3.

Cold read (GetObject + parse + normalize + name join): **~400–560 ms** on sampled games. Truncated / 2023 / 2024 skip S3 (**~50 ms**).

---

## Historical Contract Integration

`availability.timeline` and `availability.rotationContext` come from `analytics.game_flow`, **not** `season === 2025`.

| Season | Timeline |
| --- | --- |
| 2023 (`15905067`) | false (expected absence, not an error) |
| 2024 (`18444564`) | false |
| 2025 | true only when `timeline_available` |
| 2026 live | false (hardcoded live path) |

No Timeline section is rendered. Starting Five / Box / Advanced / Season Role / Market Movement paths unchanged.

---

## Timeline Coverage

| Metric | Count | Denominator |
| --- | --- | --- |
| Plays objects | 1,322 | 1,322 |
| Timeline available | **1,319** | 1,322 |
| Score reconciled | **1,302** | 1,322 |
| Truncated (hidden) | **3** | 1,322 |
| Score-mismatch but Timeline on | **17** | 20 mismatches |

---

## Rotation Context Coverage

| Metric | Count | Denominator |
| --- | --- | --- |
| Starter-eligible | 1,320 | 1,322 − 2 anomalies |
| Rotation available | **1,284** | 1,322 serving rows (also false on 2 anomalies) |
| Rotation failures | 36 | 1,320 |
| Starter anomalies | 2 | 1,322 |

1284 / 1320 = **97.27%**, matching 9E. Timeline does not require rotation success.

---

## Storage Delta

| | Heap | Indexes | Total relation |
| --- | --- | --- | --- |
| Empty table | 8,192 | 8,192 | 16,384 |
| After execute | 360,448 | 57,344 | **417,792** (~0.40 MB) |
| DB size delta (first execute) | | | **393,216** bytes |

Well under the 12A **< 5 MB** estimate. 1,322 rows. No event JSON.

---

## Performance

| Path | Measurement |
| --- | --- |
| Full archive scan (1,322 GetObject + normalize, concurrency 8) | ~21–22 s |
| One-game GetObject + normalize (no names) | **124–152 ms** |
| `getHistoricalGameTimeline` good game (S3 + names) | **~400–560 ms** |
| Unavailable / truncated (Postgres flags only) | **~50–56 ms** |

---

## Tests Added

- `lib/betting/__tests__/historical-timeline.test.ts` — categories, clock/period, order, lead/tie/runs, quality gates, certified lists, key-event filters
- `lib/betting/__tests__/historical-timeline-s3.test.ts` — key construction, missing/malformed, mocked one-game read, truncated hides events
- `lib/betting/__tests__/game-flow-schema.test.ts` — compact schema + idempotent backfill contract
- `details-final-mode` / `historical-final` — `availability.timeline` + `rotationContext` from serving, not season

---

## Test Results

```
vitest historical-timeline / s3 / game-flow-schema / historical-final / details-final-mode
42 passed

vitest historical-advanced / role-profile / advanced-ui / final-seasons / starting-five-ui / matchup-analysis-final
18 passed
```

---

## Real-Data Verification

| Game | Role | Result |
| --- | --- | --- |
| `18447937` SAS @ LAC | normal regulation Final | Timeline yes, score exact, rotation yes, 467 events, last category `period` |
| `18446819` | OT (period 6) | Timeline yes, overtime_count 2, 595 events |
| `18446930` | rotation failure | Timeline yes, rotation `MISSING_PARTICIPANT` |
| `18447931` / `18447988` | starter anomaly | Timeline yes, rotation `STARTER_ANOMALY` |
| `18447390` | truncated mismatch | Timeline **false**, events `[]`, official 112–101 preserved |
| `18446874` | 1-pt mismatch | Timeline yes, `SCORE_MISMATCH` |
| `15905067` / `18444564` | 2023 / 2024 | Timeline false, official scores still from `analytics.games` |

No coordinates in the normalized payload. First event on sampled games: `jump_ball`.

---

## Source Immutability

After second execute, counts unchanged vs first serving snapshot:

| Table | Count |
| --- | --- |
| `analytics.games` | 5,163 |
| `player_game_logs` | 138,296 |
| `game_starters` | 13,200 |
| `player_game_advanced` | 104,756 |
| `player_role_profile` | 1,723 |
| `player_prop_market_movement` | 21,132 |
| `game_odds_market_movement` | 945 |
| `game_flow` | **1,322** (only new serving table) |

No writes to Plays S3. Materialize uses GetObject only (`putJson` absent from the script).

---

## Files Changed

- `lib/betting/historical-timeline.ts` — domain contract, quality, normalize, flow
- `lib/betting/historical-timeline-server.ts` — S3 + names + process cache
- `lib/archive/plays-2025-read.ts` — one-game canonical read
- `lib/betting/historical-final.ts` — `timeline` / `rotationContext` booleans
- `lib/betting/historical-final-server.ts` — flags from `game_flow`
- `app/api/betting/games/[gameId]/details/route.ts` — live path `rotationContext: false`
- `db/schemas/MIGRATION_game_flow.sql`
- `scripts/apply-game-flow-schema.ts`
- `scripts/ingestion/materialize-game-flow-2025.ts`
- tests listed above
- `reports/product/historical-explorer-v2-timeline-read-model.md` / `.json`
- `reports/trial/game-flow-2025-materialize.json`

---

## Risks / Open Questions

1. Three truncated games still have ~400+ events; last running score is unusable. Hiding Timeline is correct; do not “repair” trailing scores.
2. Three large-residual mismatches (`18446886`, `18447741`, `18447742`) are Timeline-on. 12H should hide lead/run charts unless `score_reconciled`.
3. Period-point arrays on truncated rows can disagree with last running score (stream noise). Do not display them when Timeline is off.
4. Substitution IN/OUT remains unlabeled. Do not ship “X in for Y” from rotation state until a rotation module is explicitly scoped.
5. Clock parser covers observed `M:SS` / `SS.s` forms; exotic strings stay as raw display.
6. Details payload does not include events (intentional). 12H needs a server loader or internal route — not a browser S3 client.

---

## Recommendation for Step 12H

Build **Timeline UI only**. Do not start possessions or WOWY.

### Presentation

- 2025 only, gated by `availability.timeline === true` (hide, don’t error, on 2023/2024 and truncated 2025).
- New **Timeline** section/tab on the historical Final page.
- **Default: Key Events** using the existing deterministic filters (`isKeyTimelineEvent`): period boundaries, lead changes, ties, scoring in the last 5:00 of Q4/OT. **Do not label this “Clutch”** (NBA.com clutch is last 5:00 *and* within 5; deferred).
- **Secondary: Full Play-by-Play** — the normalized `events` list, filterable by period / scoring / substitutions.
- Header score stays official. If `score_reconciled === false`, one scoped note: play-by-play scoring does not match the official final; hide lead/run summary or mark it Plays-derived.
- Substitution copy: use `description` / participant names. Do not invent IN/OUT.
- No stint charts, no on-court diagrams, no Market Movement overlay.

Certified rotation (`availability.rotationContext`) can support a **later** rotation module. Keep 12H focused on chronology.

---

## Verification Checklist

1. Confirm `/betting/games/18447937` still shows Starting Five, Box, Advanced, Season Role — **no Timeline UI**.
2. Confirm `/betting/games/15905067` (2023) and a 2026 live game are visually unchanged.
3. Spot-check details JSON: 2025 good game has `availability.timeline === true`; 2023 has `false`.
4. Re-run `npx tsx scripts/ingestion/materialize-game-flow-2025.ts --execute --i-understand-production-write` and expect **written: 0**.
5. Confirm `analytics.game_flow` has 1,322 rows and `timeline_available` count 1,319.
6. Confirm truncated `18447390` returns no events from `getHistoricalGameTimeline`.
7. Confirm no BDL HTTP and no Plays S3 writes.

---

## Step Verdict

`GREEN — Historical Timeline read model is certified and ready for UI`

**STOP.** Do not automatically start Step 12H.
