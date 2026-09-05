# Phase 2.T.2D.1cA — Canonical Player Identity Decoupling

**Status:** design / audit only (no schema or data migration applied)  
**Date:** 2026-09-04  
**Does not:** create 81 rookies, migrate IDs, seed 2026 stints, touch TeamRoster UI, or change Production config

---

## 1. Evidence of BDL coupling

| Fact | Evidence |
|---|---|
| `analytics.players.player_id` copied from `raw.players.id` | `scripts/transform-raw-to-analytics.ts` upserts `sid(r.id)` from `raw.players` |
| Row counts align | ~5534 analytics players ≈ ~5534 raw players |
| BDL provider maps point at analytics PKs | 577/577 `balldontlie.provider_id` ∈ `analytics.players` |
| `balldontlie.internal_id` is **not** the analytics PK | 0 rows where `provider_id = internal_id` for BDL; 1 accidental overlap |
| NBA maps use NBA id as both provider + internal | 644/644 `nba` rows have `provider_id = internal_id` |
| Roster identity chain | NBA → `internal_id` (NBA) → BDL `provider_id` → `analytics.players` (`lib/roster/identity-resolver.ts`) |
| Stints require analytics FK | `analytics.player_team_stints.player_id` → `analytics.players(player_id)` NOT NULL |
| Class C blocked | 81 NBA-only 2026 roster players cannot enter stints without fabricating BDL ids |

**Conclusion:** `analytics.players.player_id` is structurally a **BDL analytics identifier**, not a provider-agnostic person key.

---

## 2. Consumer classification

### Requires BDL ID (stats / odds / BDL ingest)

| Area | References |
|---|---|
| Game logs | `analytics.player_game_logs.player_id` FK; transform from `raw.player_game_stats`; `lib/players/analytics-queries.ts`, `lib/betting/queries.ts`, `lib/analytics/games-queries.ts` |
| Season averages | `analytics.player_season_averages.player_id` FK |
| Props (analytics) | `player_prop_lines`, `player_prop_current/history/movement_summary` FKs to `analytics.players` |
| Props (raw/current) | `raw.player_prop_snapshots.bdl_player_id` integer; `analytics.player_props_current.player_id` **integer** (numeric BDL assumption) |
| Injuries (analytics) | `player_injury_status_current/history` FK |
| Ingestion | `scripts/transform-raw-to-analytics.ts`, `lambda/nightly-bdl-updater`, archive/BDL seed scripts |
| API numeric casts | `app/api/betting/players/[playerId]/props/route.ts` (`parseInt`); `saved-props` `Number(row.player_id)` |

### Merely needs canonical person identity (roster / membership)

| Area | References |
|---|---|
| Roster stints | `analytics.player_team_stints`, view `analytics.team_roster_current` |
| NBA roster snapshots | `raw.nba_roster_snapshots` (nba ids today) |
| Roster scripts | `scripts/roster/*`, `lib/roster/*` |
| Future TeamRoster UI | currently PGL-inferred (`app/teams/[teamId]/components/TeamRoster.tsx`) — should move to entity-based roster |

### Provider-agnostic already / mixed

| Area | Notes |
|---|---|
| `provider_id_map` | Multi-provider by design, but player `internal_id` is NBA-coupled in practice |
| `public.players` | NBA-seeded PKs from `seed_players_nba.py` (NBA ids) — parallel universe from analytics |
| Name display joins | Many routes only need `full_name` via join; identity key still BDL |

### Unclear / risky

| Area | Risk |
|---|---|
| Research mats | `research_*` store `player_id text` without FK — assume BDL today |
| Paper bets | `paper_schema.player_id text` — assume analytics/BDL |
| `markets.player_id` | FK to **public** `players` (NBA-ish), not analytics |
| Dual public/analytics worlds | `resolveAnalyticsPlayerId` bridges public→analytics by name or BDL map |

---

## 3. Current `provider_id_map` semantics

**Schema** (`db/schemas/provider_id_map.sql`):

- PK: `(entity_type, provider, provider_id)`
- Index: `(entity_type, internal_id)` — **not unique**
- `internal_id` comment: “canonical id” — aspirational, not enforced

**Player reality (live DB):**

| Provider | Rows | `provider_id` | `internal_id` |
|---|---|---|---|
| `nba` | 644 | NBA PLAYER_ID | **same NBA id** (644/644) |
| `balldontlie` | 577 | BDL / analytics id | **NBA id** (shared), almost never analytics id |

**Resolver contract today:**

```text
NBA provider_id → nba.internal_id → balldontlie rows(internal_id) → analytics.players(provider_id)
```

**Conflicts already visible:** 7 `internal_id`s with multiple BDL provider ids (Class D / ambiguous).

**Also used for:** `entity_type='team'|'game'` with different internal meanings (analytics team ids, etc.).

### Can it be safely reused as entity registry?

**Recommendation: B — introduce a separate entity + mapping layer.**

Do **not** repurpose `internal_id` to UUID entities in-place because:

1. Player `internal_id` is already NBA-id-coupled (644/644).
2. Non-unique `(entity_type, internal_id)` allows multi-BDL conflicts by design.
3. Team/game rows share the table; semantic rewrite risks collateral breakage.
4. Existing code (resolver, backfills, Wilson/Pippen repair) hard-codes NBA↔BDL via `internal_id`.
5. Changing PK/uniqueness mid-flight is a destructive migration, not a thin add-on.

Keep `provider_id_map` as a **legacy bridge** during transition; optionally sync into the new table.

---

## 4. Recommended canonical schema (additive)

### `analytics.player_entities`

```text
player_entity_id   uuid PRIMARY KEY DEFAULT gen_random_uuid()
display_name       text NOT NULL
first_name         text NULL
last_name          text NULL
position           text NULL
created_at         timestamptz NOT NULL DEFAULT now()
updated_at         timestamptz NOT NULL DEFAULT now()
```

Person/entity registry. **No provider id stored here.**

### `analytics.player_provider_ids`

```text
player_entity_id     uuid NOT NULL REFERENCES analytics.player_entities(player_entity_id)
provider             text NOT NULL   -- 'nba' | 'balldontlie' | ...
provider_player_id   text NOT NULL
is_primary           boolean NOT NULL DEFAULT false  -- optional hint only
metadata             jsonb NULL      -- provenance: source script, confidence, season
created_at           timestamptz NOT NULL DEFAULT now()
updated_at           timestamptz NOT NULL DEFAULT now()

PRIMARY KEY / UNIQUE (provider, provider_player_id)
UNIQUE optional soft: at most one balldontlie per entity (enforce in app + partial unique if desired)
INDEX (player_entity_id)
```

**Invariant:** one `(provider, provider_player_id)` → exactly one entity.  
**Non-invariant:** entity may have 0..1 BDL ids; 1 NBA id typical for rostered players.

### Keep `analytics.players` as BDL-backed analytics mirror

No PK rewrite. Optional later column:

```text
analytics.players.player_entity_id uuid NULL REFERENCES analytics.player_entities(...)
```

Backfilled when BDL↔entity known.

---

## 5. Recommended `player_team_stints` migration (not executed)

Current:

```text
player_id text NOT NULL → analytics.players
```

Target compatibility:

```text
player_entity_id uuid NULL → analytics.player_entities   -- become NOT NULL after backfill
player_id        text NULL → analytics.players           -- BDL analytics id when known
```

**Steps (1cC):**

1. Add nullable `player_entity_id`.
2. Backfill from BDL `player_id` → entity (via `player_provider_ids` where provider=`balldontlie`).
3. Relax `player_id` to NULL (drop NOT NULL; keep FK when non-null).
4. Enforce CHECK: `player_entity_id IS NOT NULL` (after backfill) and `(player_id IS NULL OR player_entity_id IS NOT NULL)`.
5. Open-stint uniqueness moves to `(player_entity_id, season)` where `observed_to IS NULL`.
6. Identity uniqueness: `(player_entity_id, team_id, season, observed_from)`.
7. Update `team_roster_current` to key off `player_entity_id` (+ optional BDL `player_id`).

**NBA-only rookie stint:**

| Column | Value |
|---|---|
| `player_entity_id` | UUID |
| `player_id` | NULL |
| `source_player_id` | NBA PLAYER_ID |
| `source` | `nba_stats` |

**Feasibility:** High. 697 season-2025 stints all have BDL `player_id` today → deterministic entity backfill. No need to rewrite PGL/props.

---

## 6. Rookie lifecycle

### Day 1 (NBA.com only)

1. Insert `player_entities` (display name, position…).
2. Insert `player_provider_ids` (`nba`, NBA id).
3. **No** `analytics.players` row. **No** fake BDL id.
4. Open stint: `player_entity_id` set, `player_id` NULL.

### Later (BDL appears)

1. Resolve BDL candidate fail-closed (unique name+context / official map).
2. If BDL id unbound → attach `player_provider_ids (balldontlie, bdl_id)` to **same** entity.
3. Promote/ensure `analytics.players` row with `player_id = bdl_id` (+ optional `player_entity_id`).
4. Optionally backfill `player_team_stints.player_id` where entity matches and currently NULL.
5. Stats/props start joining once BDL row exists — **roster history unchanged**.

### Conflict

If BDL id already bound to another entity → **manual queue**, no auto-merge.

---

## 7. Historical 2025–26 compatibility

Existing assets to preserve:

- 697 stints (514 open / 183 closed), 87 multi-team, Wilson/Pippen distinct, no multi-open

Backfill algorithm:

```text
FOR each stint with player_id = BDL_ID:
  entity = entity_for_provider('balldontlie', BDL_ID)
  IF missing: create entity from analytics.players row + attach nba map if known
  SET stint.player_entity_id = entity
```

Deterministic order: sort by `stint_id`. Idempotent: skip if `player_entity_id` already set and matches.

---

## 8. Future NBA + BDL `/players/active` reconciliation

```text
NBA CommonTeamRoster observation
BDL /players/active observation
        ↓
provider rows in player_provider_ids (nba / balldontlie)
        ↓
resolve → player_entity_id (fail closed on conflict)
        ↓
player_team_stints keyed by player_entity_id
        ↓
optional analytics.players (BDL) for stats joins
```

BDL remains best stats/props source; **membership no longer waits on BDL**.

---

## 9. Compatibility strategy (no destructive rewrite)

| Layer | During transition |
|---|---|
| Stats / props / injuries | Keep querying `analytics.players.player_id` (BDL) |
| Roster / stints / team roster UI | Move to `player_entity_id` |
| Join path | `stint.player_entity_id` → `player_provider_ids(balldontlie)` → `analytics.players` **LEFT JOIN** |
| Legacy `provider_id_map` | Read-only sync source into `player_provider_ids`; stop writing new semantics there eventually |
| APIs using `parseInt(playerId)` | Remain BDL-only until entity-aware routes added |

---

## 10. Blast radius (estimated)

| Module / table | Impact | When |
|---|---|---|
| New entity tables | Add only | 1cB |
| `provider_id_map` | Read for backfill; no semantic change | 1cB |
| `analytics.players` | Optional nullable `player_entity_id` | 1cB |
| `player_team_stints` + view | Additive column → NULL legacy id → query cutover | 1cC |
| `lib/roster/*` + roster scripts | Entity-aware resolve/seed | 1cC |
| TeamRoster UI | Switch from PGL to entity stints | **after** 1cC (later phase) |
| PGL / PSA / props / injuries FKs | **Untouched** | — |
| Betting APIs with numeric BDL | Untouched until entity routes | — |
| Research / paper | Low urgency; document assumption | later |
| Production season pin | Untouched | — |

---

## 11. Staged plan

### 2.T.2D.1cB — Infrastructure + backfill existing players

- Create `player_entities` + `player_provider_ids`
- Backfill one entity per existing `analytics.players` row
- Attach `balldontlie` provider id (= analytics PK)
- Attach `nba` provider id from `provider_id_map` when unique/safe
- Fail-closed queue for multi-BDL / ambiguous maps (do not merge)
- Optional: `analytics.players.player_entity_id` backfill
- Tests for veteran dual-map, conflict, idempotent backfill
- **Still do not** create the 81 rookies here unless explicitly approved after dry-run

### 2.T.2D.1cC — Stints + rookies + re-probe

- Add `player_entity_id` to stints; backfill 2025 history
- Allow NULL BDL `player_id` on stints
- Onboard 81 NBA-only entities + nba provider maps (no BDL)
- Re-probe 2026 roster against entity resolver
- Target ≥95% entity-resolvable roster observations (ambiguous remain queued)

### 2.T.2D.2 — Apply 2026 roster seed

- Seed open 2026 stints by `player_entity_id`
- Skip unresolved/ambiguous entities
- Still no Production season flip unless separately approved

**Sequence adjustment:** Keep as proposed. Do **not** collapse 1cB+1cC — stint nullability is the riskier DDL and should follow a clean entity backfill.

---

## 12. Tests to require at implementation

1. Veteran NBA+BDL → one entity  
2. NBA-only rookie → entity, no BDL map, no `analytics.players`  
3. Later BDL attach → same `player_entity_id`  
4. Provider conflict → fail closed / queue  
5. 2025 stint entity backfill deterministic + idempotent  
6. BDL stats still queryable by legacy `player_id`  
7. Roster stint can exist with `player_id` NULL  
8. No fabricated BDL ids in any write path  
9. `team_roster_current` can mix BDL-backed and NBA-only entities  
10. Open-stint uniqueness is per entity/season, not per missing BDL id  

---

## 13. Key risks

| Risk | Mitigation |
|---|---|
| Accidental merge of two people | Fail closed; never auto-merge entities with conflicting provider ids |
| Dual open stints during uniqueness cutover | Migrate unique index in same transaction as backfill completion |
| UI/API still assume BDL everywhere | Explicit roster vs stats ID documentation; LEFT JOIN pattern |
| `provider_id_map` drift vs new table | Single writer policy; sync job or deprecate writes |
| Numeric `parseInt` routes | Leave BDL-only until entity URLs designed |
| Scope creep into full UUID rewrite of PGL | Explicitly out of scope |

---

## 14. Recommendation

**Proceed** with **2.T.2D.1cB** as designed (additive entity registry + separate provider map; preserve BDL `analytics.players`).

**Do not** begin 2.T.2D.2 or onboard the 81 rookies until 1cB(+1cC) lands and re-probe clears a safe threshold.

---

## 15. Scope confirmation (this phase)

| Action | Done? |
|---|---|
| Create 2026 stints | No |
| Create 81 rookie entities | No |
| Broad player-ID migration | No |
| TeamRoster UI changes | No |
| Production config changes | No |
| DDL applied | No |
