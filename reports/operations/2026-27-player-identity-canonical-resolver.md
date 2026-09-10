# 2026–27 Player Identity Canonical Resolver — Step 13R.2

**Step verdict:** `GREEN — canonical player identity resolver is ready for ingestion adoption`

**Date:** 2026-09-10  
**Architecture (13R.1, unchanged):** `player_entities` = person · `player_provider_ids` = bridges · `analytics.players` = BDL serving projection

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| BDL HTTP | **0** |
| `live_ingestion_enabled` | `false` (tfvars) |
| Props / odds / injury activation | none |
| Advanced / Plays automation | none |
| Provider backfill | none |
| Class C `analytics.players` rows | **not created** (still 5,534 players) |
| Fake BDL IDs | none |
| Class D resolution | none (NBA ids 0 maps → unresolved) |
| Product FK migration | none |
| URL migration | none |
| Historical Explorer / Market Movement | unchanged (regression tests passed) |

Identity infrastructure only.

---

## Existing Canonical Identity

Live after 13R.2:

| Object | Count |
| --- | --- |
| `player_entities` | 5,615 |
| `player_provider_ids` BDL | 5,534 |
| `player_provider_ids` NBA | 634 |
| `analytics.players` | **5,534** (unchanged) |
| Class C NBA-only entities | **81** |

---

## Constraint Audit

**Before DDL (dry-run):**

| Check | Count |
| --- | --- |
| Same entity + same provider twice | **0** |
| Same `(provider, provider_player_id)` → multiple entities | **0** |
| Null / blank provider | **0** |
| Null / blank provider_player_id | **0** |
| Distinct provider values | `balldontlie`, `nba` |
| Multiple `analytics.players` per entity | **0** |

No STOP/YELLOW. Constraints applied.

**After:**

| Constraint | Status |
| --- | --- |
| `analytics_player_provider_ids_uniq` `(provider, provider_player_id)` | already existed |
| `analytics_player_provider_ids_entity_provider_uniq` `(player_entity_id, provider)` | **added** |
| `analytics_player_provider_ids_provider_chk` `balldontlie\|nba\|bbref` | **added** |
| No table PK on `player_provider_ids` | natural keys above |

---

## Migration

Single file: `db/schemas/MIGRATION_player_identity_canonical.sql`  
Applied via `scripts/ops/apply-player-identity-canonical-migration.ts`.

Also mirrored IF NOT EXISTS unique onto `db/schemas/analytics_player_entities.sql` so schema-only reruns stay consistent.

No product FK SQL. No `analytics.players` PK change.

---

## Shared Resolver

`lib/identity/player-identity-resolve.ts`

`resolvePlayerIdentity(provider, providerPlayerId, index)` →

- `resolved` + `playerEntityId` + `analyticsPlayerId: string | null`
- `unresolved`
- `conflict` + `candidateEntityIds`

Names are not consulted. Empty ids → unresolved (no throw).

| Case | Result |
| --- | --- |
| Known BDL | entity + analytics id |
| Known NBA, no BDL projection | entity + `analyticsPlayerId=null` |
| Known BBRef | entity if bridge exists; else unresolved (no BBRef rows live) |
| Unknown | unresolved |
| Duplicate provider id in index | conflict |

---

## Batch Resolver

`resolvePlayerIdentities(provider, ids[], index)`  
SQL helper `resolvePlayerIdentitiesFromDb`: one `WHERE provider=$1 AND provider_player_id=ANY($2)` plus one projection lookup. Existing unique index on `(provider, provider_player_id)`.

---

## Analytics Compatibility Helper

`requireAnalyticsPlayerId(resolution)`

| Input | Output |
| --- | --- |
| resolved + analytics id | `{ status: 'serving', analyticsPlayerId }` |
| resolved, no projection | `{ status: 'not_serving_yet', playerEntityId }` |
| unresolved / conflict | `{ status: 'fail_closed', reason }` |

Canonical existence ≠ BDL serving. Class C is `not_serving_yet`.

---

## Unresolved Quarantine

`analytics.player_identity_unresolved`

Natural key: `(provider, provider_player_id, source_context)`  
Statuses: `UNRESOLVED` | `CONFLICT` | `RESOLVED`  
Sources: `BOX_SCORE` `PLAYER_PROP` `INJURY` `ADVANCED` `LINEUP` `PLAYS` `SEASON_AVERAGE` `OTHER`

Repeat observations increment `occurrence_count` and `last_seen_at`; `first_seen_at` stays. Resolved rows are never deleted. No seed of Class C (quarantine = ingest observations only). Live row count: **0**.

---

## Conflict Handling

Conflict is a **status**, not a second table. Escalate UNRESOLVED→CONFLICT; never demote CONFLICT; RESOLVED stays RESOLVED on later observes. Resolver does not pick a winner. Other payload ids still resolve independently (batch is per-id).

---

## Class C Certification

Still **81**. Representative Kingston Flemings (`nba` `1643412`):

- entity `9a69c18b-8d96-51c0-ae42-d4da42faea7f`
- NBA bridge present
- BDL bridge **null**
- `analytics.players` **null**
- resolver: canonical + `analyticsPlayerId=null`
- compatibility: `not_serving_yet`

No fake BDL ids.

---

## Class D Behavior

All 7 Class D NBA ids have **0** `player_provider_ids` rows. Resolver returns `unresolved` / `fail_closed`. No bridges created. No winners.

---

## Historical Compatibility

`analytics.players` still 5,534. Wilson BDL `56677722` still present. No rewrites of PGL / Advanced / Role / starters / Market Movement / Timeline. Historical Explorer and Market Movement tests passed without source changes.

---

## Future Props / Injury / Advanced / Plays Integration

Not implemented. Contract:

1. Resolve provider player id through this module only.
2. `serving` → write existing BDL FK tables.
3. `not_serving_yet` / `fail_closed` → quarantine + skip that row; remainder of payload continues.
4. Do not name-match. Do not copy NBA ids into `analytics.players.player_id`.

---

## Observability

`playerIdentityDiagnostic({ resolution, sourceContext })` logs provider, source, status, providerPlayerId, entity if resolved. No names, no raw payloads.

CLI: `npx tsx scripts/ops/2026-player-identity-quarantine-report.ts`

---

## Storage / Performance

| Item | Size / cost |
| --- | --- |
| Unique `(entity, provider)` | btree on 6,168 rows (~trivial; bridges table ~1 MB) |
| Quarantine table | 0 rows |
| Resolver | unique `(provider, provider_player_id)` lookup |
| Batch | one `ANY()` query + projection IN list |
| Cache | none |

---

## Tests Added

| File | Coverage |
| --- | --- |
| `player-identity-resolve.test.ts` | BDL, NBA-null, unknown, BBRef, conflict, no name fallback, batch, Class D, Wilson/Pippen |
| `player-identity-quarantine.test.ts` | first/repeat/source key/conflict/resolve/retain |
| `player-identity-constraints.test.ts` | unique contracts + multi-provider OK |
| `player-identity-class-c.test.ts` | 81 set + Flemings + no NBA-as-BDL |
| `player-identity-schema.test.ts` | migration additive / no product FKs |

---

## Test Results

`npx vitest run lib/identity/__tests__` + Historical Explorer / Advanced / Role / Starting Five schema / Market Movement:

**13 files, 87 tests, all passed.**

---

## Files Changed

- `db/schemas/MIGRATION_player_identity_canonical.sql`
- `db/schemas/analytics_player_entities.sql` (unique IF NOT EXISTS)
- `lib/identity/*` (resolver, quarantine, store, tests)
- `scripts/ops/apply-player-identity-canonical-migration.ts`
- `scripts/ops/2026-player-identity-quarantine-report.ts`

Not changed: product FKs, player pages/URLs, ingest Lambdas, Explorer, Market Movement.

---

## Remaining Risks

- Roster `entity-roster-resolve` still has a **name fallback**; ingest must use `lib/identity`, not that helper.
- `resolveAnalyticsPlayerId` still name-joins for URLs (read path only).
- Class C still cannot land on BDL-FK product tables until ingest adopts skip/quarantine.
- BBRef is allowed in CHECK but has **no** bridges yet → unresolved until attested.
- Quarantine is empty until adapters call upsert.

---

## Recommendation for 13R.3

**A — integrate the canonical resolver into live ingestion adapters while keeping analytics FKs unchanged.**

Use `requireAnalyticsPlayerId`: write serving rows only; quarantine/skip `not_serving_yet` and `fail_closed`. Do not dual-key historical serving tables yet (option B).

Do not start 13R.3 automatically.

---

## Verification Checklist

1. `live_ingestion_enabled=false`; no BDL HTTP this step.
2. Unique `(player_entity_id, provider)` exists; pre-audit was 0 dups.
3. Class C still 81; `analytics.players` still 5,534.
4. Flemings resolves NBA-only with `not_serving_yet`.
5. Class D still unresolved; no new bridges.
6. Explorer / MM tests green; no URL changes.
7. Quarantine has 0 seeded rows; no anon GRANT.
8. Do not thaw ingestion or migrate product FKs.

---

## Step Verdict

`GREEN — canonical player identity resolver is ready for ingestion adoption`
