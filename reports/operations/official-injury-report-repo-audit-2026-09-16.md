# Official injury-report tape — repository reconnaissance

Date: **2026-09-16**  
Mode: **read-only**. No production, schema, Terraform, Lambda, S3, PDF download, parser, join, or model changes.  
Scope: what already exists to support the path in `reports/operations/official-injury-report-path-2026-09-16.md`.

This audit does **not** certify live row counts except where a prior ops report already recorded them. Schema and code are the source of truth here.

---

## 1. Game identity

### Schema

`analytics.games` in `db/schemas/analytics_schema.sql`:

| Column | Type | Notes |
| --- | --- | --- |
| `game_id` | `text` PK | BDL game id as text (`scripts/transform-raw-to-analytics.ts` `sid(g.id)`). |
| `season` | `text` NOT NULL | Start-year (`'2023'`, `'2024'`, `'2025'`). |
| `start_time` | `timestamptz` | Nullable. Canonical UTC (`lib/games/canonical-start-time.ts`). |
| `status` | `text` | Raw-ish product string; WOWY requires exact `'Final'`. |
| `home_team_id` / `away_team_id` | `text` FK → `analytics.teams` | Required; `home ≠ away`. |
| `home_score` / `away_score` | `integer` | Nullable; WOWY requires both non-null for a complete Final. |
| `venue` | `text` | Unused for this path. |

Indexes: PK; `(season, start_time)`.

**There is no `game_date` column on `analytics.games`.** Date lives on:

- `analytics.player_game_logs.game_date` (`date`) — added in `db/schemas/analytics_schema_migration.sql`; copied from `raw.games.date` in the transform.
- `raw.games.date` (`date`) and `raw.games.datetime` (`timestamptz`) in `db/schemas/raw_schema.sql`.

Legacy parallel table `public.games` (`db/schemas/games.sql`) has the same grain; product WOWY uses **analytics**.

### Identifiers

- Primary: `analytics.games.game_id` (BDL).
- No unique constraint on `(home_team_id, away_team_id, start_time)` or on an ET calendar date.
- Known-Out already treats **unique Final team-night on an America/New_York date** as the join when `game_id` is missing (`lib/wowy/known-out-association.ts` `uniqueGameForTeamEtDate`). Collisions exclude.

### Timestamps / timezone

- Persist UTC only. Comment in `lib/games/canonical-start-time.ts`: do not store Eastern as a canonical column.
- Transform fallback if `datetime` is null: `new Date(g.date + 'T00:00:00Z')` (`scripts/transform-raw-to-analytics.ts`) — midnight UTC, **not** tip. Status-sync later uses `canonicalStartTimeUtc`.
- Basketball date for WOWY cutoff is **`etCalendarDate(start_time)`** (`lib/wowy/calendar.ts`, `Intl` `America/New_York`, `en-CA` `YYYY-MM-DD`).
- `player_game_logs.game_date` is BDL `raw.games.date`, **not** guaranteed equal to ET basketball date. `scripts/scrape-basketball-reference.ts` already warns PGL `game_date` can be off by one vs ET.

**For official reports:** join games with `start_time` → ET date + tip, not `game_date` alone.

### Home / away

`home_team_id` / `away_team_id`. Official matchup is `AWAY@HOME` (samples: `NOP@BKN`, `GSW@BOS`, `LAL@DEN`). Deterministic **if** both abbreviations resolve uniquely and at most one Final that night for that pair.

### Status / Final

`lib/betting/normalize-game-status.ts`: Scheduled / In Progress / Final / Postponed / Canceled / Unknown. Future games often store a **tip clock string in `status`**. WOWY completeness (`lib/wowy/eligibility.ts` `isCompleteFinalGame`) requires `status === 'Final'` plus non-null `start_time`, `home_score`, `away_score`. Protected history seasons: `2023`, `2024`, `2025` (`lib/games/status-sync.ts`).

### Files inspected

`db/schemas/analytics_schema.sql`, `db/schemas/analytics_schema_migration.sql`, `db/schemas/raw_schema.sql`, `db/schemas/games.sql`, `scripts/transform-raw-to-analytics.ts`, `lib/games/canonical-start-time.ts`, `lib/games/status-sync.ts`, `lib/betting/normalize-game-status.ts`, `lib/wowy/calendar.ts`, `lib/wowy/eligibility.ts`, `lib/wowy/known-out-association.ts`.

---

## 2. Team identity

### Schema

`analytics.teams` (`db/schemas/analytics_schema.sql`):

| Column | Type |
| --- | --- |
| `team_id` | `text` PK (BDL team id as text; live DEN is `'8'`, not the sequential fixture ids in tests) |
| `abbreviation` | `text` NOT NULL, **unique** (`analytics_teams_abbreviation_key`) |
| `full_name` | `text` NOT NULL |
| `name`, `city`, `conference`, `division` | display |

Canonical abbreviations used in UI: ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS (`lib/nba/team-logos.ts` `NBA_TEAM_LOGOS` / `NBA_TEAM_NAMES`). Clippers display name: **LA Clippers**.

### Historical / alias handling

**Not in the database.** Unique `abbreviation` means one current code per team. Aliases exist only in code:

| Location | What it maps |
| --- | --- |
| `lib/nba/team-logos.ts` `NBA_TEAM_ALIASES` | BRK→BKN, CHO/CHH→CHA, PHO→PHX, GS→GSW, NO→NOP, NY→NYK, SA→SAS, UTAH→UTA, WSH→WAS |
| `lib/providers/owls-insight/mapping.ts` `TEAM_ALIASES` / `normalizeTeamKey` | city, nickname, “LA Clippers”, “Los Angeles Lakers”, … → canonical abbr |
| `lib/parlay-xray/resolution/team.ts` | matchup split on `vs` / `@`; reuses Owls `normalizeTeamKey` |

No team-abbreviation history table. 2023–26 has no SuperSonics / Bobcats rename. Official PDF samples used canonical tricodes (`NOP@BKN`, not `NO@BRK`). That is **not** proof every historical PDF uses the same tokens.

### Can `NOP@BKN` resolve deterministically?

**Usually yes, not by schema guarantee.**

1. Split `AWAY@HOME`.
2. Map each token (and `Team` full name) through `normalizeTeamKey` / unique `analytics.teams.abbreviation`.
3. Look up `analytics.games` where `away_team_id` / `home_team_id` match, ET date from `start_time` matches `Game Date`, optionally tip matches `Game Time`.

Failure modes: alias not in the map; two Finals same pair/night (no unique constraint); `NOT YET SUBMITTED` team block with no players; PDF `Team` string vs `full_name` drift (`LA Clippers` vs `Los Angeles Clippers` — Owls map covers this, DB unique abbr does not store both).

### Files inspected

`db/schemas/analytics_schema.sql`, `lib/nba/team-logos.ts`, `lib/teams/team-directory.ts`, `lib/teams/__tests__/team-directory.test.ts`, `lib/providers/owls-insight/mapping.ts`, `lib/parlay-xray/resolution/team.ts`.

---

## 3. Player identity

### Serving row: `analytics.players`

`db/schemas/analytics_schema.sql` + entity column in `db/schemas/analytics_player_entities.sql`.

| Column | Role |
| --- | --- |
| `player_id` | PK. **This is the BDL player id as text** (`reports/operations/2026-27-player-identity-architecture-audit.md`). |
| `full_name`, `first_name`, `last_name` | Display. **No unique on `full_name`.** |
| `player_entity_id` | Optional FK → `analytics.player_entities`. Audit recorded all 5,534 serving rows had one. |

Product FKs (PGL, injuries, props, …) require this BDL `player_id`. A person can exist as an entity **without** a serving row (Class C: 81 NBA-only 2026 rookies, `reports/operations/2026-27-class-c-certified-set.json`).

### Canonical person + bridges

`analytics.player_entities` (`player_entity_id` uuid, `display_name`, `first_name`, `last_name`).

`analytics.player_provider_ids`:

- Unique `(provider, provider_player_id)`
- Unique `(player_entity_id, provider)` (`db/schemas/MIGRATION_player_identity_canonical.sql`)
- `provider` check: `'balldontlie' | 'nba' | 'bbref'`

WOWY lookup: `analytics.players` LEFT JOIN `player_provider_ids` where `provider = 'nba'` (`lib/wowy/queries.ts` `resolveWowyPlayerIdentity`).

### Resolver policy

`lib/identity/player-identity-resolve.ts`: **provider id → entity → optional BDL projection. Names are never an authoritative ingest fallback.** Fail closed on unresolved/conflict.

Quarantine: `analytics.player_identity_unresolved` (`INJURY` is an allowed `source_context`). Audit: 0 rows as of the prospective handoff.

Legacy `public.provider_id_map` (`db/schemas/provider_id_map.sql`) is a separate older map. Do not treat it as the 13R canonical bridge.

### Alias / name-normalization (not a table)

No player-alias table. Pure functions:

| Module | Behavior | Risk |
| --- | --- | --- |
| `lib/roster/normalize-player-name.ts` | Diacritics, lower, **drop Jr/Sr/II/III/IV**, drop punctuation | Collides Gary Payton vs Gary Payton II if suffixes stripped |
| `lib/providers/owls-insight/mapping.ts` `normalizePersonName` / `matchOwlsPlayer` | Same suffix strip; used for **Owls name-only props**, not identity bridges |
| `lib/parlay-xray/resolution/player.ts` `resolvePlayerIdentityFromName` | Exact full name, first+last, last-only, initials, Levenshtein; returns NEEDS_CONFIRMATION on ambiguity | OCR helper, **not** certified for injury ingest |

Suffix handling is therefore **strip-and-hope**, not a stored alias graph.

### Duplicate names

No uniqueness on names. XRay explicitly returns `AMBIGUOUS_FULL_NAME` / `AMBIGUOUS_LAST_NAME`. Two “J. Williams” / Jr. collisions are expected. Ingest identity forbids using names as bridges.

### Files inspected

`db/schemas/analytics_schema.sql`, `db/schemas/analytics_player_entities.sql`, `db/schemas/MIGRATION_player_identity_canonical.sql`, `db/schemas/provider_id_map.sql`, `lib/identity/player-identity.ts`, `lib/identity/player-identity-resolve.ts`, `lib/identity/player-identity-quarantine.ts`, `lib/wowy/queries.ts`, `lib/roster/normalize-player-name.ts`, `lib/parlay-xray/resolution/player.ts`, `lib/parlay-xray/resolution/names.ts`, `reports/operations/2026-27-player-identity-architecture-audit.md`, `lib/identity/__tests__/player-identity-class-c.test.ts`.

---

## 4. Historical player-team membership

### Tables that exist

| Object | Grain | Dated? | Usable as name universe? |
| --- | --- | --- | --- |
| `analytics.player_game_logs` | `(game_id, player_id)` | `game_date` + join to `games.start_time`; `team_id` that night | Only players **who have a box/inactive row** |
| `analytics.player_team_stints` | entity + team + season + `observed_from` | Observation dates, **not trade timestamps** | Partial; 2023–24 `source='inferred_pgl'` (game-derived) |
| `analytics.team_roster_current` | view of **open** stints | No as-of | Current/open only; callers must filter `season` |
| `raw.nba_roster_snapshots` | `(snapshot_date, season_label, nba_team_id, nba_player_id)` | Yes (`snapshot_date`, `snapshot_at`) | **Has `player_name` + `nba_player_id` + `team_abbreviation`** |
| `public.player_team_rosters` | `(player_id, season)` | Season flag only | Legacy public schema; not WOWY |
| Transactions table | **none found** | — | — |

Stint comments: `db/schemas/analytics_roster_stints.sql`. Product WOWY **does not use stints** to manufacture DNP (`lib/wowy/eligibility.ts`, `reports/product/game-level-wowy-v1.md`). 2023–2024 stints 100% `inferred_pgl`; 2025 mixed `inferred_pgl` / `nba_stats`.

`raw.nba_roster_snapshots` is populated by `scripts/roster/refresh-current-rosters.ts` / `populate-stints-2025-26.ts` (2025–26 / 2026–27 oriented). This audit did not re-query snapshot date coverage; **do not assume 2023–24 daily NBA.com rosters exist**.

No NBA transaction / waiver feed.

### CRITICAL: PGL roster is not a valid exclusive universe

Path Phase 4 suggested resolving `player_name_raw + team_id + game_date` against **that game’s PGL roster**. That is **not valid as the only candidate set**.

WOWY already encodes the hole:

- Verified WITHOUT requires a **present** PGL row with `minutes = '00'` (`lib/wowy/appearance.ts`, `eligibility.ts`).
- **Missing teammate row = unknown**, not Out. Explicit note: “Absence is not inferred. Roster stints are not used to manufacture DNP.”
- `"00"` ≈ 53k DNP/inactive roster rows on 2023–2025 Finals — those absences **do** appear. Two-way / G League / not-listed players **do not** (`game-level-wowy-v1.md` remaining limitations).
- Class C NBA-only people have **no** `analytics.players` / PGL row at all, but can appear on an official report (G League Two-Way names in the 2025-12-06 PDF).
- An official **Out** is often exactly the player with **no** or **`"00"`** box row. Using “appeared in that game” drops the Out population you care about; using “any PGL row that night including `00`” still drops the missing-row class.

Known-Out r1 even retained **16** reported-Out teammates who later **played** (`reports/modeling/wowy-known-out-r1/player-projection-wowy-known-out-r1-results.md`). Pregame name resolution must not require the eventual box.

### Candidate universes (options only — not a design)

| ID | Universe | Includes Out with no box row? | Limitations |
| --- | --- | --- | --- |
| U1 | Same-game PGL, played only (`minutes` ≠ `'00'`) | **No** | Worst. Drops DNP and missing-row Outs. |
| U2 | Same-game PGL, any row including `'00'` | Only if BDL wrote an inactive row | Same hole WOWY already calls unknown. Not exclusive. |
| U3 | All PGL rows for `team_id` in a date window / season | Sometimes (if they played another night) | Misses never-dressed two-ways; trades leak across window; `inferred_pgl` circular. |
| U4 | `player_team_stints` open on `game_date` (`observed_from` ≤ date ≤ `observed_to` or open) | Only if stint exists | 2023–24 stints are PGL-inferred → same hole. Dates ≠ trades. |
| U5 | `raw.nba_roster_snapshots` nearest `snapshot_date` ≤ game date, same team | Yes, if a snapshot exists that day/team | Coverage likely thin before 2025–26. Name is NBA.com spelling. Strongest **dated** name+id source if present. |
| U6 | `analytics.players` / `player_entities` names, scoped by U4/U5 team | Yes if the person is in serving/entity tables | Collisions; suffix strip; Class C may be entity-only (NBA id, no BDL PGL). |
| U7 | League-wide name match | Yes | Forbidden as ingest bridge; high collision. Owls/XRay analogs are fail-closed / confirmation. |
| U8 | Official report `Team` + season entity roster (open stints + recent PGL + snapshots), then unique name | Intended direction | Still a **composition**; must measure unique-hit vs quarantine. Not implemented. |

**Recommendation for later (not this slice):** treat U5 + U4(`nba_stats` only) + U2 as **layered candidates**, require **unique** match after `normalizePersonName` **without** silently dropping suffixes until collision-tested, quarantine the rest. Do not implement here.

### Files inspected

`db/schemas/analytics_schema.sql`, `db/schemas/analytics_schema_migration.sql`, `db/schemas/analytics_roster_stints.sql`, `db/schemas/player_team_rosters.sql`, `lib/wowy/appearance.ts`, `lib/wowy/eligibility.ts`, `lib/wowy/queries.ts`, `reports/product/game-level-wowy-v1.md`, `scripts/roster/refresh-current-rosters.ts`, `docs/roster-canonical-identity-design.md`, `reports/modeling/wowy-known-out-r1/player-projection-wowy-known-out-r1-results.md`.

---

## 5. Existing WOWY

### Sample source

`/wowy` → `lib/wowy/queries.ts`: subject’s `analytics.player_game_logs` for `player_id + season + team_id`, join `analytics.games`, **LEFT JOIN** teammate PGL on same `game_id`. Seasons in UI: `2025`, `2024`, `2023` (`app/wowy/WowyExplorer.tsx`). Box tape: those seasons only; no 2026 WOWY PGL.

Calculation version `game-level-wowy-v1`. APIs: `app/api/wowy/pair`, `model-pair`, `players`, `context`.

### `"00"` DNP

`lib/wowy/appearance.ts`: token `"00"` = DNP/inactive **roster row**, not injury. `"0"` / `"0.0"` = played zero minutes. Missing row ≠ DNP.

### WITH / WITHOUT (page)

`lib/wowy/eligibility.ts`:

- Subject must **play**.
- WITH: teammate same `team_id`, appearance class `played`.
- WITHOUT: teammate same `team_id`, class `dnp` (`"00"`).
- Unknown: missing row, other team, malformed minutes.
- Complete Final only.

This is **realized participation**, not pregame availability.

### Known-Out experiment

Code: `lib/wowy/availability-gate.ts`, `known-out-association.ts`, `candidate-features.ts`, `scripts/freeze-wowy-known-out-cohort.ts`, `scripts/audit-wowy-r1-known-out.ts`.

- WITHOUT statuses: `'Out'`, `'Out For Season'` only.
- Observations: `PregameAvailabilityObservation` (`playerId`, `teamId`, `status`, `snapshotAt`, optional `gameId`).
- Never reads target box to choose scenario (`model-adapter.ts`).
- Game link: unique team-ET Final night when `game_id` missing.
- Result: N=625 eligible, **inconclusive** (`reports/modeling/wowy-known-out-r1/`).

`analytics.wowy_research_inputs` (`db/schemas/MIGRATION_wowy_research_inputs.sql`) is **PREPARED ONLY, not applied**.

### 48-hour / T−60

Already in code:

| Constant | Value | File |
| --- | --- | --- |
| `WOWY_R1_PREDICTION_CUTOFF_MINUTES_BEFORE_TIP` | 60 | `lib/wowy/known-out-association.ts` |
| `WOWY_R1_OBS_FRESHNESS_MAX_HOURS` | 48 | same (covers ~42h gap on Mar–May BDL tape) |
| Prior-game cutoff | ET date **strictly before** tip’s ET date | `lib/wowy/cutoff.ts` `isUsableWowyPrior` |

`selectKnownOutObservation` / `selectObservedPregameScenario` require `snapshotAt < cutoff`. Post-cutoff → `observation_on_or_after_cutoff`.

### Files inspected

`app/wowy/WowyExplorer.tsx`, `lib/wowy/queries.ts`, `appearance.ts`, `eligibility.ts`, `aggregate.ts`, `types.ts`, `cutoff.ts`, `calendar.ts`, `availability-gate.ts`, `known-out-association.ts`, `model-adapter.ts`, `candidate-features.ts`, `db/schemas/MIGRATION_wowy_research_inputs.sql`, `scripts/freeze-wowy-known-out-cohort.ts`, `reports/product/game-level-wowy-v1.md`, `reports/modeling/wowy-r1/known-out-feasibility.md`, `reports/modeling/wowy-known-out-r1/player-projection-wowy-known-out-r1-results.md`.

---

## 6. Injury data

### Applied schema (BDL-shaped)

`db/schemas/raw_injury_schema.sql`:

- `raw.injury_pull_runs`: `pull_run_id`, `pulled_at`, `provider` default `'balldontlie'`, row counts, `status`, `metadata`, `completed_at`.
- `raw.player_injuries`: `provider_player_id` **integer** (BDL), `provider_team_id`, `status`, `description`, `return_date_raw`, `raw_payload`, `created_at`. **No `game_id`.** Append-only.

`db/schemas/analytics_injury_schema.sql`:

- `player_injury_status_current`: PK `player_id` (BDL serving). `snapshot_at` = observation time.
- `player_injury_status_history`: change rows only (`status`, `description`, `return_date_raw`, `team_id`). `snapshot_at` on change, **not** last-observed.
- View `team_injury_summary_current`.

### Unapplied (do not assume in DB)

`db/schemas/MIGRATION_context_collection_snapshots.sql` (header: PREPARED ONLY): `source_published_at`, `raw.injury_pull_membership`, history `observed_at` / `game_id` / `game_link_provenance`. Known-Out freeze recorded **membership table absent**.

### Ingestion

`lambda/injuries-snapshot/index.ts`: `GET /nba/v1/player_injuries`. Frozen unless `DATA_MODE=live_api` and not offseason/dry-run. Identity via BDL provider ids (`lib/injuries/injury-identity.ts`). Leave-report `RemovedFromReport`, not Available (`lib/injuries/leave-report.ts`). Schedule **DISABLED**. Entitlement probe 2026-09-16: HTTP **401** (`reports/operations/bdl-injuries-entitlement-probe.json`).

`snapshot_at` / usable observation = **pull `created_at`**, not provider `updated_at` (BDL has none). Canary: `reports/operations/2026-27-injuries-game-odds-canary.md`.

### Mar–May 2026 coverage (prior reports, not re-queried)

| Store | Recorded fact |
| --- | --- |
| History | 4,801 change rows, **2026-03-10 → 2026-05-06**; seasons 2023/2024 empty |
| Current | 150 rows (stale board): Out 121, Questionable 22, Out For Season 3, Doubtful 2, Probable 2; **no Available** |
| Raw | `injury_pull_runs` 181; `player_injuries` ~24k last-observed rows |
| Game id | none on applied history |
| Fetch timestamps | `created_at` / `snapshot_at` (Court Context clock) |
| Status / reason | provider `status` + `description` |

Sources: `reports/modeling/wowy-r1/known-out-feasibility.md`, `reports/operations/court-context-prospective-activation-handoff.md`, `reports/operations/2026-27-injuries-game-odds-canary.md`.

This is a **cross-check corpus**, not the official-report tape. New source should not reuse these tables as the raw PDF archive.

### Files inspected

`db/schemas/raw_injury_schema.sql`, `db/schemas/analytics_injury_schema.sql`, `db/schemas/MIGRATION_context_collection_snapshots.sql`, `lambda/injuries-snapshot/index.ts`, `lambda/injuries-snapshot/README.md`, `lib/injuries/injury-identity.ts`, `lib/injuries/leave-report.ts`, listed ops/modeling reports.

---

## 7. Archive infrastructure

### Convention

Hive-style keys under `raw/`:

`raw/source={provider}/league=nba/season={YYYY}/entity={entity}/…`

Implemented for:

- BDL: `lib/archive/trial-archive-plan.ts` `rawEntityPrefix` → `raw/source=balldontlie/league=nba/season=${season}/entity=${entity}` (JSON pages, cursor resume: `lib/archive/resumable-s3-archive.ts`).
- Owls: `lib/providers/owls-insight/archive.ts` — gzip JSON envelope, SHA-256 of canonical payload, skip-if-checksum-match, protected prefixes, `game_date=` + `provider_game_id=` + `page=NNNN.json.gz`.

Generic client: `lib/aws/s3.ts` `S3Storage` (JSON put/get/head/list; skip-if-exists).

### Checksum / envelope

Owls pattern is the closest **historical file archive**:

- Envelope holds raw payload + request + timestamps + checksum (`lib/providers/owls-insight/archive.ts` `checksumCanonical`, `buildOwlsArchiveKey`).
- Empty provider history is archived, not skipped (Owls trial).

BDL archive envelopes are API page JSON, not arbitrary binaries.

**There is no `source=nba_official` helper.** Path proposal `raw/source=nba_official/.../entity=injury_report_pdf/` does not exist. PDFs are binaries; reusing Owls `json.gz` blindly would be a new envelope type (e.g. base64 or sibling `.pdf` + `.json` metadata). Reuse: S3Storage + hive prefix + checksum + empty-403 objects. Do **not** reuse BDL injuries Lambda or `raw.player_injuries` integer PK.

Season partitioning: start-year `2023|2024|2025` matches WOWY pin (`lib/season.ts` `PINNED_ANALYTICS_SEASON='2025'`).

### Files inspected

`lib/aws/s3.ts`, `lib/archive/trial-archive-plan.ts`, `lib/archive/resumable-s3-archive.ts`, `lib/providers/owls-insight/archive.ts`, `lib/providers/owls-insight/contract.ts`, `reports/operations/owl-final-trial-audit.md`.

---

## 8. Existing PDF / tooling

| Tool | Status |
| --- | --- |
| Production Node PDF library | **None** in root `package.json` (no pdf-parse / pdfjs / pdf-lib). |
| `pypdf` | Used only in `tmp/injury-report-samples/*.py`; **not** a repo dependency. User-local install. |
| Python | `scripts/python-requirements.txt`: `nba_api`, pydantic, psycopg, requests. **No PDF extra.** Modeling reqs: catboost/numpy/pandas only. |
| Playwright | Root `package.json` `playwright` — browser tests, not PDF table extract. |
| Tabula / Java | Not in repo. |

Probe cache (not a feed): `tmp/injury-report-samples/` PDFs + `characterization.json`.

### Test conventions

- Vitest: `lib/wowy/__tests__/*`, `lib/identity/__tests__/*`, `lib/injuries/__tests__/*`, Owls archive tests.
- Ops evidence: JSON+MD under `reports/operations/` (HEAD/GET probes, no secrets).
- Identity: fail-closed unit tests; Class C certified JSON fixture.

A later parser should follow **held-out PDF fixtures + vitest/python unit tests**, not ad hoc `tmp/` scripts as production.

### Files inspected

`package.json`, `lambda/injuries-snapshot/package.json`, `scripts/python-requirements.txt`, `scripts/modeling/requirements-modeling.txt`, `tmp/injury-report-samples/` (presence only), `lib/wowy/__tests__/`.

---

## What can be reused

- `analytics.games.start_time` + `etCalendarDate` + home/away ids for game join.
- Unique `analytics.teams.abbreviation` plus `normalizeTeamKey` / `NBA_TEAM_ALIASES` for `AWAY@HOME` and team names.
- `player_entities` + `player_provider_ids` (`nba`) once a name uniquely maps; quarantine `source_context='INJURY'`.
- WOWY T−60 / 48h / unique team-ET night / Out-only WITHOUT gate (`availability-gate`, `known-out-association`).
- `"00"` vs missing-row semantics (do not conflate with official Out).
- S3 hive prefix, skip-if-exists, Owls-style checksum envelope **as a pattern**.
- BDL Mar–May 2026 raw/history as **overlap audit** after parse.
- Name normalizers as **candidates**, not as silent bridges.
- Vitest + `reports/operations/*.json` probe style.

## What is missing

- Official PDF archive source, envelope for binaries, HEAD inventory.
- Parser / PDF library in the repo.
- `game_date` on `analytics.games`; ET date must be derived.
- Unique game-night constraint; must detect collisions.
- Player alias table; suffix-safe name keys.
- Dated membership that covers 2023–24 Outs without PGL rows (roster snapshots not shown to exist for those seasons).
- `game_id` / last-observed / Available on the applied injury schema.
- Applied `wowy_research_inputs` / `injury_pull_membership`.
- Any code that reads official referee PDFs.

---

## Player-identity options (summary)

Do **not** resolve official names exclusively against players who appeared in that game.

Measure later, in order of honesty:

1. Unique `(normalized name, team, ET date)` against **U5 snapshots** if dates exist.
2. Else unique against **U4 `nba_stats` stints** as-of date.
3. Else unique against **U2 same-game PGL including `"00"`** — accept this only as a **subset**, and count how many official Outs have no row.
4. Fail closed / quarantine (Jr collisions, two-ways, Class C).

Do not league-fuzzy-match. Do not strip suffixes until a collision audit says it is safe. Do not write `player_provider_ids` from names.

---

## Risks / unknowns

- `raw.games.date` vs ET basketball date off-by-one.
- Two games same team-night (play-in / reschedule) — known-Out had 0 in Mar–May 2026 only.
- PDF tricode / Clippers name drift vs unique `abbreviation`.
- Roster snapshot coverage for 2023–24 unknown without a DB count.
- Suffix stripping merges distinct people.
- Class C / G League names on PDFs with no serving `player_id`.
- BDL 401 and freeze: live injuries worker stays off; unrelated to PDF archive.
- Legal/retention of bulk NBA static PDFs (path F10) — not a code question.

---

## Smallest next slice

Unchanged from the path doc, and this audit does not unlock a parser:

**HEAD-only existence inventory** of official PDF URLs for `2023-10-23` … `2026-06-14` (hourly + 15-minute tokens). Write `reports/operations/official-injury-report-existence-inventory.json` + a short MD of 200-counts by season and time token.

No downloads, no S3, no schema, no parser, no joins. That closes F1–F3. Identity candidate-universe **counts** (how many official Outs lack a same-game PGL row) come **after** a certified parse, not now.

---

## Verification checklist (for the reader)

1. Confirm `analytics.games` has no `game_date` column in `db/schemas/analytics_schema.sql`.
2. Confirm WOWY missing PGL row is `unknown`, not WITHOUT (`lib/wowy/eligibility.ts`).
3. Confirm identity ingest rejects name-only bridges (`lib/identity/player-identity-resolve.ts` header).
4. Confirm injury history has no `game_id` in the **applied** SQL.
5. Confirm no PDF library in root `package.json`.
6. Confirm `MIGRATION_context_collection_snapshots.sql` and `MIGRATION_wowy_research_inputs.sql` say PREPARED ONLY.
7. Do not treat `tmp/injury-report-samples/` as production.
