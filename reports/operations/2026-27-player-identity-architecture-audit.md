# 2026–27 Player Identity Architecture Audit — Step 13R.1

**Step verdict:** `GREEN — provider-neutral player identity design is ready for controlled implementation`

**Date:** 2026-09-10  
**Mode:** read/audit only. No BDL HTTP, no DDL, no DML, no bridges, no fuzzy matching, no ingestion changes.

Companion inventory: `reports/operations/2026-27-class-c-certified-set.json`

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| BDL HTTP | none |
| DB migration / writes | none (SELECT / `information_schema` / `pg_catalog` only) |
| Provider bridge creation | none |
| Fuzzy/name mapping | none (name rules documented, not executed as bridges) |
| Production ingestion | unchanged; freeze not thawed |
| Historical Explorer | unchanged |
| Market Movement | unchanged |
| Existing `analytics.players.player_id` values | not modified |

---

## Current Player Schema

Live `analytics.players` (not the original SQL snapshot):

| Column | Type | Null | Role |
| --- | --- | --- | --- |
| `player_id` | `text` | NOT NULL | **PK**. Every value is a BALLDONTLIE player id stored as text. |
| `full_name` | `text` | NOT NULL | Display |
| `first_name` / `last_name` | `text` | yes | Display |
| `position` / `height` / `weight` | `text` | yes | Display |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | Audit |
| `player_entity_id` | `uuid` | yes (nullable in DDL) | Optional FK → `analytics.player_entities` |

**Constraints**

- PK: `players_pkey` on `player_id`
- FK: `analytics_players_player_entity_id_fkey` → `player_entities(player_entity_id)` ON DELETE SET NULL
- No unique constraint on `full_name`
- No NBA / BBRef / slug columns on this table

**Indexes:** PK, `analytics_players_full_name_idx`, `analytics_players_player_entity_id_idx`

**Live counts:** 5,534 rows. All numeric (`^[0-9]+$`). All have `player_entity_id`. Every `player_id` equals that entity’s `player_provider_ids` row where `provider='balldontlie'`.

Provider-specific identity is **not** a column on `analytics.players`. It lives in `analytics.player_provider_ids`. Teams are **not** stored on the player row; membership is `analytics.player_team_stints`.

---

## BDL Coupling Root Cause

`analytics.players.player_id` is BDL-coupled because it **is** the BDL id:

1. Transform copied `raw.players.id` (integer BDL id) into `analytics.players.player_id` (text).
2. Product tables FK that PK (`REFERENCES analytics.players(player_id)`).
3. Code and Lambdas treat the same string as both “Court Context player” and “BALLDONTLIE player”.
4. Therefore a person **cannot** get a product row (PGL, props, injuries, Advanced, starters, role, season averages) without a real BDL id already in `analytics.players`.

This is encoded in `lib/roster/canonical-gap-repair.ts` as `ANALYTICS_PLAYER_ID_IS_BDL_COUPLED = true`. Class C repairs are `blocked_by_schema` by design: inserting an NBA id, UUID, or invented numeric into `player_id` would either collide with BDL’s namespace or fabricate a provider id.

**Invariant for 2026–27:** a Court Context person may exist without a BDL mapping. That already holds on `player_entities` + NBA-only bridges. It does **not** yet hold on product FKs.

---

## Dependency Inventory

### Formal FKs to `analytics.players(player_id)`

| Table | Rows (live) | Grain | Risk |
| --- | --- | --- | --- |
| `player_game_logs` | 138,296 | `game_id + player_id` | HIGH (history) |
| `player_game_advanced` | 104,756 | `game_id + player_id` | HIGH (history) |
| `player_role_profile` | 1,723 | `player_id + season` | HIGH (history) |
| `game_starters` | 13,200 | `game_id + team_id + player_id` | HIGH (history) |
| `player_season_averages` | 1,785 | player + season | MEDIUM |
| `player_prop_current` | 25,812 | market grain | MEDIUM (13E) |
| `player_prop_history` | 93,246 | snapshot | MEDIUM |
| `player_prop_lines` | 7,168 | line grain | MEDIUM |
| `player_prop_movement_summary` | 1,611 | summary | MEDIUM |
| `player_injury_status_current` | 150 | `player_id` PK | MEDIUM |
| `player_injury_status_history` | 4,801 | history | MEDIUM |
| `player_team_stints.player_id` | 2,670 (81 NULL) | nullable after 1cC | LOW |

### Same `player_id` meaning, **no** FK to `analytics.players`

| Table / store | Rows | Notes |
| --- | --- | --- |
| `player_prop_market_movement` | 21,132 | PK includes `player_id`; **0 unmapped** to `analytics.players` |
| `analytics.player_props_current` | 0 | legacy integer `player_id`; unused |
| `raw.player_prop_snapshots_v2` | — | BDL `player_id` |
| `raw.player_injuries.provider_player_id` | — | BDL integer |
| `raw.player_game_stats.player_id` | — | BDL integer |
| `raw.season_averages.player_id` | — | BDL integer |
| `paper.bets.player_id` | 47 | user paper slips |
| `public.user_saved_props.player_id` | 1 | saved research |
| `research.prop_decision_lines` | — | research |

### Already entity-keyed (do not rewrite)

| Object | Status |
| --- | --- |
| `analytics.player_entities` | 5,615 canonical people |
| `analytics.player_provider_ids` | 6,168 bridges |
| `analytics.player_team_stints.player_entity_id` | NOT NULL in practice; 81 stints have `player_id` NULL |
| `analytics.team_roster_current` | roster UI uses entity; BDL href only when `player_id` present |

### Product / API / URL / cache / tests / scripts

| Surface | How it uses `player_id` |
| --- | --- |
| `/betting/players/[playerId]` | BDL `analytics.players.player_id` via `resolveAnalyticsPlayerId` |
| `/players/[playerId]` | **Different namespace:** `public.players` / BBRef (NBA ids / slugs) |
| `/api/players/[playerId]/*` | analytics or BBRef depending on route |
| `/api/betting/players/[playerId]/*` | analytics BDL id |
| Trending strip, matchup cards, paper bets, research journey | href `/betting/players/${player_id}` |
| Team roster | `rosterPlayerHref` returns **null** for NBA-only (Class C have no player page) |
| Historical Explorer / Timeline | names join `analytics.players` by BDL id |
| Market Movement server | `SELECT full_name FROM analytics.players WHERE player_id = $1` |
| Injuries matchup | join `analytics.players` |
| Injuries Lambda | skip rows whose BDL id is not in `analytics.players` |
| Props Lambda | writes BDL `player_id` into FK tables — insert fails if unmapped |
| Lineups / Plays / Advanced / starters materializers | match `provider player.id == analytics.players.player_id` (no name guessing) |
| `lib/roster/identity-resolver.ts` | NBA → (legacy `provider_id_map`) → BDL → analytics |
| Tests | assert FKs to `analytics.players`; roster href uses BDL ids |

**Blast radius:** every historical and betting serving table except roster/stints still requires a BDL PK. Class C can appear on a team roster and nowhere else.

---

## Provider ID Inventory

Do **not** infer missing ids from names. Completeness below is from stored rows only.

| System | Where | Completeness | Uniqueness |
| --- | --- | --- | --- |
| BALLDONTLIE | `player_provider_ids` `provider='balldontlie'` | 5,534 / 5,615 entities (100% of `analytics.players`) | Unique `(provider, provider_player_id)`. 1:1 with `analytics.players.player_id`. |
| NBA / public PLAYER_ID | `player_provider_ids` `provider='nba'` | 634 entities (553 also have BDL + **81 NBA-only**) | Unique per provider id. 634 distinct entities. |
| Basketball Reference | `public.bbref_player_game_stats.player_id` → `public.players` | 17,875 stat rows; **not** in `player_provider_ids` | Separate graph. `public.players` = 584 (577 numeric NBA-like, 7 non-numeric / slug-like). Overlap with analytics BDL PK: **1** coincident string. |
| Legacy `public.provider_id_map` | `entity_type='player'` | nba 644, balldontlie 577 | Incomplete parallel map. Not canonical. |
| `raw.players` | BDL dump | 5,534 | Same population as analytics players |
| Slugs | not an analytics identity | 7 non-numeric `public.players` ids only | Not a Court Context key |
| Strava / other | none | — | excluded |

Entity coverage:

| Pattern | Count |
| --- | --- |
| BDL + NBA | 553 |
| BDL only | 4,981 |
| NBA only (Class C) | **81** |
| Neither | 0 |

`is_primary`: all 5,534 BDL maps are primary; all 81 NBA-only maps are primary; dual-mapped NBA rows are non-primary.

**Missing constraint:** no `UNIQUE (player_entity_id, provider)`. Live data has no duplicates; the constraint should still be added in 13R.2 so one person cannot receive two NBA or two BDL ids.

---

## Class C Re-Audit

Certified set = entities with an NBA map and **no** BDL map. Count **81**. Matches prior reports (`player-entity-backfill-apply.json` `class_c_unresolved_from_queue: 81`, live-activation watchlist).

| Field | All 81 |
| --- | --- |
| Known NBA/public identity | **yes** (`provider='nba'`) |
| `analytics.players` row | **absent** |
| Local BDL id | **absent** |
| 2026 stint | **present**, `player_id` NULL |
| Canonical entity | **present** (`uuid` v5 from `nba:{id}`) |

Class D remains **7** (Keaton Wallace, Brandon Williams, Dru Smith, Gary Trent Jr., Jaylin Williams, Jameer Nelson Jr., Micah Potter). Intentionally untouched.

**Surfaces that cannot represent Class C safely today**

- Player pages `/betting/players/...` (no BDL id → no href)
- Box / PGL, Advanced, Starting Five, Role Profile, season averages
- Player props current/history/lines, Market Movement
- Injury current/history
- Timeline player-name enrichment (join on BDL id)
- Props Explorer / trending / paper links that require `analytics.players`

**Surfaces that already can**

- Team roster (`team_roster_current`) as entity-only rows with no player link

Do not resolve them in 13R.1.

---

## Candidate Architectures

### Option A — Internal Court Context id + provider bridges

Concept: `player_entities.player_entity_id` + `player_provider_ids`.

**Already exists** (Phase 2.T.2D.1cB/1cC) and is populated. Class C already live here without fake BDL ids.

| Axis | Assessment |
| --- | --- |
| Migration risk | Low if product FKs stay on BDL projection |
| FK churn | Deferred; stints already cut over |
| URL stability | Keep BDL URLs; entity routes later |
| Historical compatibility | Historical tables stay BDL-keyed |
| Ingestion | One resolver: provider id → entity → optional BDL projection |
| Multi-provider | Native |
| Rookie onboarding | NBA-only entity; BDL bridge when provider attests |
| Rollback | Additive tables already shipped |

### Option B — Surrogate on `analytics.players` while migrating FKs

Add UUID PK, demote `player_id` to `bdl_player_id` nullable, rewrite 12 FK tables.

| Axis | Assessment |
| --- | --- |
| Migration risk | High; big-bang or long dual-write |
| FK churn | Every historical table |
| URL stability | Requires redirect layer immediately |
| Rollback | Hard |

Rejected as first move.

### Option C — Least-disruptive use of the existing schema

Treat **Option A tables as canonical**. Treat `analytics.players` as the **BDL serving projection** (not the person). Do not put NBA ids or sentinels into `player_id`. Do not namespace-hack (`nba:1643412`) into the BDL PK (Lambdas and FKs assume numeric BDL text).

This is Option A without a second identity system.

---

## Recommended Architecture

**Option C: existing `player_entities` is canonical. `analytics.players` remains the BDL projection. Product FKs stay on BDL ids until a later dual-read phase. Class C stay entity-only until a real BDL id appears.**

Do not create a parallel `analytics.players.id`. Do not fabricate BDL ids.

---

## Canonical Player Model

```
analytics.player_entities
  player_entity_id uuid PK   -- already uuid v5 for NBA-origin, random/uuid for BDL-origin backfill
  display_name, first_name, last_name, position
  created_at, updated_at
```

No provider ids on this row.

`analytics.players` = optional 1:1 BDL projection:

- `player_id` = BDL id (unchanged meaning)
- `player_entity_id` = link to canonical person
- Class C: **no row**

---

## Provider Bridge Model

Existing `analytics.player_provider_ids`:

| Field | Rule |
| --- | --- |
| `player_entity_id` | FK to canonical person |
| `provider` | `'balldontlie'` \| `'nba'` (extend later: `'bbref'` only with attested ids) |
| `provider_player_id` | provider-native string |
| `is_primary` | display hint only; not identity |
| Unique | live: `(provider, provider_player_id)` |
| Add in 13R.2 | `UNIQUE (player_entity_id, provider)` |

Missing BDL ⇒ no `balldontlie` row. Never a sentinel.

Quarantine (new, 13R.2 DDL only when authorized):

```
analytics.player_identity_unresolved
  unresolved_id uuid PK
  provider text
  provider_player_id text
  status text  -- unmapped | conflict | stale_candidate
  observed_at, payload jsonb
  UNIQUE (provider, provider_player_id)
```

---

## Ingestion Resolution Rules

Single shared resolver. No per-pipeline mapping tables.

| Encounter | Action |
| --- | --- |
| Known `(provider, provider_player_id)` | resolve entity. If BDL projection exists, use `analytics.players.player_id` for FK writes. |
| Unknown BDL id (provider-attested payload) | **quarantine**. Do not auto-insert `analytics.players` until a certified policy (creating a BDL-attested entity is not fabrication; it is still deferred so 13E cannot silently grow the PK). |
| NBA-known, no BDL | entity + NBA bridge only. Skip FK writes. Roster/stints OK. |
| Conflicting maps (same provider id → two entities, or two ids of one provider on one entity) | fail closed → quarantine. No auto-merge. |
| Name-only match | human review / search. **Not** a bridge. |

Class D stay quarantined / skipped.

---

## Name Matching

`normalizePersonName` already folds suffixes, diacritics, punctuation, spaced initials. Allowed for:

- roster search
- manual review queues
- Level-2 **display** hints

Forbidden as an authoritative key. Duplicate names (Jaylin Williams, etc.) are Class D. Name changes require a new observation + manual bridge, not a rename of `provider_player_id`.

`resolveAnalyticsPlayerId` currently falls back to `public.players.full_name = analytics.players.full_name`. That is a URL compatibility hack and **must not** become a write-path bridge.

---

## Historical Compatibility

| Corpus | Rows | Strategy |
| --- | --- | --- |
| PGL 2023 / 2024 / 2025 | 46,090 / 46,150 / 46,056 | keep BDL `player_id`; meaning unchanged |
| Advanced | 104,756 | same |
| Role Profile | 1,723 | same |
| Starters | 13,200 | same |
| Market Movement | 21,132 | same; all ids already in `analytics.players` |
| Timeline enrichment | join `analytics.players` | same |
| `game_flow` | 1,322 | game-level; no player PK |

No historical provider id may be rewritten. Dual-read later: `player_entity_id` via the existing `players.player_entity_id` join.

---

## URL Compatibility

| Route | Identity |
| --- | --- |
| `/betting/players/[playerId]` | BDL `analytics.players.player_id` |
| `/players/[playerId]` | BBRef / `public.players` (NBA ids) |

Two public namespaces already exist. **Do not break betting BDL URLs.** Initial migration:

1. Preserve `/betting/players/{bdlId}` indefinitely.
2. Optional later: `/betting/players/e/{playerEntityId}` + 302 from BDL when mapped.
3. Class C have no betting player URL until a BDL id exists **or** an entity route ships.

---

## Props Impact

Desired 13E path:

`BDL prop player id` → `player_provider_ids (balldontlie)` → `player_entity_id` → current market row keyed by **existing** `analytics.players.player_id` when the projection exists.

Unmapped rookie (Class C or brand-new BDL id not in `analytics.players`):

- do not insert into FK tables (would fail or pollute)
- write quarantine + metrics
- remainder of the board persists

Today the Lambda writes BDL ids directly; FK to `analytics.players` means one unmapped id can fail a batch. 13E must isolate before write. Not implemented here.

---

## Postgame Impact

| Pipeline | Today | Target |
| --- | --- | --- |
| Basic box / PGL | require analytics BDL PK | same resolver; skip/quarantine unknown |
| Advanced | same | same |
| Starting Five | lineups `player.id` == BDL PK | same |
| Plays | S3 enrichment matches BDL PK | same resolver; names from entity when needed |
| Season Role | FK to players | same |

One resolver module. No new mapping table per pipeline.

---

## Injury Impact

Latest board only (no injury-as-of).

Today: Lambda already **skips** BDL ids not in `analytics.players` — Class C injuries never land. Keep skip; add quarantine observability so skips are visible. Do not fail the whole board on one unmapped row.

---

## Migration Strategy

Do **not** execute these phases in 13R.1.

| Phase | Work |
| --- | --- |
| **1** | Constraints + resolver + quarantine around **existing** entities (13R.2) |
| **2** | Deterministic backfill is **done** for BDL (5,534). Do not invent NBA maps for the 4,981 BDL-only entities. |
| **3** | Dual-read helper: `resolvePlayer({ provider, id })` used by new ingest only |
| **4** | Move **new** 2026 serving (optional) to entity keys; historical tables stay BDL |
| **5** | Rookie onboarding: NBA entity already exists; attach BDL bridge only when BDL attests the id |
| **6** | Drop unsafe “PK is always BDL” assumptions in code comments/resolvers — after dual-read proves out |

No big-bang FK rewrite. Historical Explorer stays on BDL keys throughout.

---

## Risk Matrix

| Dependent | Risk | Why |
| --- | --- | --- |
| `player_entities` / `player_provider_ids` | LOW | already canonical |
| Stints / team roster | LOW | entity-keyed; `player_id` nullable |
| Injury Lambda skip list | LOW | already fail-closed skip |
| Props current/history/lines | MEDIUM | FK; 13E needs quarantine |
| Market Movement | MEDIUM | no FK but BDL-keyed; Explorer must stay stable |
| PGL / Advanced / Role / Starters | HIGH | historical meaning of `player_id` |
| `/betting/players/[id]` | HIGH | public BDL URLs |
| `/players/[id]` BBRef | HIGH | different namespace; do not conflate |
| `resolveAnalyticsPlayerId` name join | HIGH | duplicate-name hazard if used for writes |
| `public.provider_id_map` | MEDIUM | stale parallel map |
| Paper bets / saved props | MEDIUM | stored BDL ids |
| Class D (7) | HIGH | must stay untouched |

---

## Storage / Indexing

| Object | Rows | Storage |
| --- | --- | --- |
| Canonical players | 5,615 | trivial |
| Bridges | 6,168 | trivial |
| Class C extra | 81 entities + 81 NBA maps + 81 stints | already stored |
| Quarantine | empty until 13E/postgame | trivial |

**Required constraints (13R.2):**

- PK `player_entities.player_entity_id` (exists)
- `UNIQUE (provider, provider_player_id)` (exists)
- `UNIQUE (player_entity_id, provider)` (**add**)
- PK on quarantine `(provider, provider_player_id)` if that table is added

No speculative indexes.

---

## Identity Observability

Future report (do not build yet):

| Bucket | Definition |
| --- | --- |
| New provider player ids | seen in ingest, not in `player_provider_ids` |
| Unmapped | quarantine `unmapped` |
| Conflicting | quarantine `conflict` |
| Resolved | bridge exists |
| Stale candidates | quarantine older than N days with no replay |
| Class C watchlist | NBA map, no BDL map (81) |
| Class D | certified 7 |

Must be visible **before** product surfaces drop players.

---

## Recommended 13R.2

**13R.2 — lock existing `player_entities` as canonical identity: add `UNIQUE (player_entity_id, provider)`, a shared ingest resolver, and an unresolved-identity quarantine — without migrating product FKs, changing URLs, fabricating BDL ids, or onboarding Class C into `analytics.players`.**

Not in 13R.2: props/odds/Advanced/Plays automation, schedule thaw, schema rewrite of historical tables.

---

## Verification Checklist

1. Confirm 13R.1 made no DB writes and no BDL HTTP.
2. Confirm `analytics.players.player_id` still equals BDL maps (5,534 = 5,534).
3. Confirm Class C = 81 NBA-only entities, 0 analytics player rows.
4. Confirm Class D = 7 untouched.
5. Confirm Historical Explorer and Market Movement were not modified.
6. Confirm 13R.2 is not started automatically.
7. Do not thaw `live_ingestion_enabled`.

---

## Step Verdict

`GREEN — provider-neutral player identity design is ready for controlled implementation`
