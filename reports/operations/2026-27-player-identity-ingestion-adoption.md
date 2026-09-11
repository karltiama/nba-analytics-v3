# 2026–27 Player Identity Ingestion Adoption — Step 13R.3

**Step verdict:** `GREEN — provider-neutral identity is safely adopted across ingestion adapters`

**Date:** 2026-09-10  
**Depends on:** 13R.2 `reports/operations/2026-27-player-identity-canonical-resolver.md` (approved)  
**Architecture (unchanged):** `player_entities` = person · `player_provider_ids` = bridges · `analytics.players` = BDL serving projection

---

## Safety / Scope

13R.3 is adapter adoption only. Confirmed:

| Gate | Result |
| --- | --- |
| BDL HTTP | **0** (fixture tests + SQL counts only) |
| `live_ingestion_enabled` | `false` |
| EventBridge / Scheduler | remain DISABLED (`ingestion_schedule_state` follows the flag) |
| Lambda runtime | `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1` |
| Props / odds / injury thaw | none |
| GOAT-dependent canary | none |
| Advanced / Plays live automation | none |
| Product FK migration | none |
| URL / slug migration | none |
| Class C `analytics.players` inserts | **none** (still 5,534) |
| Class D bridges | **none** |
| Historical serving-row rewrite | none |
| Live feed writes | none (code paths only; no execute of ingest jobs) |

No 13E. No 3-Hour Pre-Tip / Current / Close / Market Movement live writes. No possessions / WOWY.

---

## Adapter Inventory

| Ingestion family | Previous coupling | 13R.3 class | Why |
| --- | --- | --- | --- |
| Injuries Lambda (`lambda/injuries-snapshot`) | Analytics transform required `provider_player_id IN analytics.players` | **ADOPT NOW** | Same BDL serving FK; resolver only changes who is eligible |
| Injury leave-report SQL (`lib/injuries/leave-report-sql.ts`) | Historical `EXISTS analytics.players` | **DEFER** | Would rewrite as-of leave-report history, out of scope |
| Player props Lambda | Wrote BDL `player_id` into analytics current tables with **no** serving check | **ADOPT NOW** | Filter analytics writes; raw snapshots keep all rows |
| `scripts/transform-raw-player-props-to-analytics.ts` / `-to-lines.ts` | `IN analytics.players` | **ADOPT NOW** | Same serving FK; batch gate + quarantine |
| Nightly box / `upsertAnalyticsPlayer` | Owned BDL projection **creation** from attested BDL payload ids | **PARTIAL / owner kept** | Must not skip real BDL upserts; this is the certified projection-creation path |
| Generic PGL helper (`lib/identity/box-identity.ts`) | Assumed provider id = serving id | **ADOPT NOW** | Gate before PGL write; no fake serving row |
| Advanced materialize | `SELECT player_id FROM analytics.players` then throw whole job on unmapped players | **ADOPT NOW** | Filter non-serving first; games/season mismatch still throw |
| Role Profile materialize | Full `analytics.players` set | **ADOPT NOW** | Serving-only materialize; skip/quarantine otherwise |
| Lineups / starters materialize | `player_id = any(...)` then whole-run mismatch if any unmapped | **ADOPT NOW** | Per-game 5+5 fail-closed on identity; other games continue |
| Plays participant enrichment | `analytics.players` **or** BDL bridge counted as mapped | **ADOPT NOW (helper + serving-only map)** | Chronology ≠ serving link |
| BBRef boxscore (`resolvePlayerId` by name) | Name match vs `public.players` | **DEFER** | No certified `bbref` bridges (`bbref` count = 0). Names are not identity |
| Product URL helper `resolveAnalyticsPlayerId` | Name join for `/players/...` | **DEFER** | URL boundary: no canonical ids in public routes |
| Betting read paths / Explorer / MM | FK to serving `player_id` | **DEFER** | Product FK meaning unchanged |

---

## Adoption Strategy

Preferred boundary (one per family, no per-transform identity logic):

```text
provider payload
  → collect unique provider player IDs
  → batch canonical resolver (2 SQL lookups max)
  → compatibility decision (serving | not_serving_yet | fail_closed)
  → existing serving transform
```

Shared modules:

- `gateIngestIdentities` / `filterRowsByServingIdentity` (in-memory)
- `gateIngestIdentitiesFromDb` / `loadPartialIdentityIndex` (scripts)
- `classifyFromSqlRows` (Lambdas that cannot import `lib/`)

Lambdas copy SQL + classifier; drift tests pin them to `lib/identity`.

---

## Shared Resolution Policy

| Compatibility | Adapter behavior |
| --- | --- |
| `serving` | Write existing serving-table rows using `analyticsPlayerId` (still the BDL id) |
| `not_serving_yet` | Do **not** fabricate a BDL id or insert `analytics.players`. Skip the affected serving row. Quarantine `UNRESOLVED`. Continue safe rows |
| `fail_closed` (unresolved) | Skip + quarantine `UNRESOLVED`. Continue safe rows |
| `fail_closed` (conflict) | Skip + quarantine `CONFLICT`. Do not pick a winner, merge by name, or overwrite a bridge |

Canonical entity exists ≠ `analytics.players` row. Class C stays unpromoted.

Diagnostics (no raw payloads, no secrets): `identity_resolved` · `identity_not_serving` · `identity_unresolved` · `identity_conflict`.

Accounting on every gate: input / unique / resolverLookups / serving / notServingYet / unresolved / conflicts / output / quarantined / skipped.

---

## Batch Resolution

| Family | Unique IDs (fixture) | Resolver DB queries | Batch? | N+1 removed? |
| --- | --- | --- | --- | --- |
| Shared gate (tests) | 10 mixed | **0** (in-memory index); `resolverLookups=1` | yes | n/a (never N+1) |
| Injuries Lambda | unique ids in pull | **2** (bridges `ANY` + projections `ANY`) | yes | Replaced set-membership vs `analytics.players` with canonical 2-query boundary. Quarantine upserts are per unresolved id (not identity lookup) |
| Props Lambda | unique ids in game | **1–2** | yes | Previously **zero** identity checks (unsafe writes). Batch added; no per-prop DB identity query |
| Props transform scripts | distinct snapshot ids | **2** then `ANY(serving)` | yes | Replaced correlated `IN (SELECT player_id FROM analytics.players)` |
| Advanced materialize | unique archive player ids | **2** | yes | **Yes** — removed `SELECT player_id FROM analytics.players` (full table) |
| Role materialize | unique archive player ids | **2** | yes | **Yes** — same full-table scan removed |
| Starters materialize | unique starter ids across inventory | **2** once per run | yes | Previous `player_id = any` was already batched; now canonical. Identity fail is **per game**, not per player query |
| Plays | unique participant ids | archive script: **1** serving existence query | yes | Bridge-without-projection no longer counts as mapped |
| Nightly BDL upsert | attested payload ids | 0 resolver (owner path) | n/a | Projection creation remains owned; not a skip-gate |

No cache layer.

---

## Injury Adoption

`lambda/injuries-snapshot/index.ts` + `lib/injuries/injury-identity.ts`.

- Raw pull storage unchanged (all provider rows).
- Analytics board: batch classify BDL ids → serving rows enter `planInjuryIngest`.
- Known serving BDL player: process normally.
- Canonical / no projection: skip + quarantine `INJURY`.
- Unknown / conflict: skip + quarantine; board continues.
- Completeness still uses pull row counts, not identity skips.
- Leave-report **as-of history not implemented**. Feed **not activated**.

---

## Props Adoption

`lambda/player-props-snapshot` worker + transform scripts.

```text
BDL prop player id → resolver → serving process market
                 → not_serving_yet / fail_closed skip+quarantine PLAYER_PROP
```

Raw `player_prop_snapshots_v2` still stores the full fetch. Analytics `player_props_current` / preferred-vendor current only receive serving rows. One unresolved player does not fail the slate (`completeGameRun` still success).

No live props polling. No 13E. No 3-Hour Pre-Tip / Current / Close / Market Movement live writes.

---

## Box / Stats Adoption

**Owned creation path (unchanged, documented):** `nightly-bdl-updater` / `transform-raw-to-analytics` `upsertAnalyticsPlayer` from **attested BDL payload ids**.

That path is what will create a BDL serving projection **later**, when BallDontLie attests a real id for a Class C person. 13R.3 does **not** create that row from a canonical entity.

**Generic PGL / box helper:** `selectBoxRowsForPgl` / `BOX_SCORE`. If a BDL bridge exists but `analytics.players` does not: `not_serving_yet` → skip PGL write, quarantine, continue. No fake serving row.

Nightly remains **PARTIAL** because it must keep creating serving rows for real BDL ids (the owner). It must not be converted into a skip-gate that would block attested BDL upserts.

---

## Advanced Adoption

`scripts/ingestion/materialize-player-game-advanced.ts` collects unique candidate ids → `loadPartialIdentityIndex` (2 queries) → `selectArchiveRowsForServing('ADVANCED')` → existing `auditAdvancedIdentity` / `assertIdentityOrThrow` on **serving** rows only.

Non-serving identities no longer fail the whole job. Unmapped **games** and season mismatch still throw. `analytics.player_game_advanced` FK semantics unchanged. Quarantine persisted only on `--execute` (dry-run accounts, does not write).

---

## Lineup / Starter Adoption

`certifyStarterGame` 5+5 rules preserved.

**Starter identity rule:** if any starter on a game is `not_serving_yet` / unresolved / conflict, that game’s certification is `canonical_identity_unresolved`. Do **not** emit 4 starters. Other games continue. Identity issue recorded (`identityFailedGames` + quarantine `LINEUP` on execute).

Missing `player.id` in archive remains `unknown_identity` (existing rule). No fabricated starter ids.

---

## Plays Adoption

Helper: `playParticipantServingLink` + `TIMELINE_IDENTITY_FALLBACK`.

**Contract for later UI:**

- Event `order` / clock / score chronology may remain certified even when a participant cannot attach to `analytics.players`.
- Serving player link: omit. Do not fabricate a player id. Do not put a canonical entity id in `/players/...`.
- Display name: provider text or omitted.
- Do not invalidate the whole Plays object for one unresolved participant.

Archive map query now counts **serving** `analytics.players` only (BDL bridge without projection is not “mapped”). No possessions / WOWY.

---

## Season Average Adoption

`materialize-player-role-profile.ts` uses `SEASON_AVERAGE` gate before `auditRoleIdentity`. Serving → materialize. `not_serving_yet` / conflict → skip/quarantine. `analytics.player_role_profile` PK/FK unchanged.

---

## BBRef / Non-BDL Audit

`bbref` provider is allowed on `player_provider_ids` but live bridge count is **0**. Boxscore scraper still resolves by **name** against `public.players`. Marked **DEFERRED**. Comment added; no automatic BBRef matching. Names remain diagnostic only.

---

## Class C Behavior

Representative **Kingston Flemings** NBA `1643412`:

- NBA bridge resolves; canonical entity exists
- `analyticsPlayerId = null`
- compatibility `not_serving_yet`
- BDL guess of the NBA id → unresolved (no fabricated BDL id)
- Adapter: skip serving row, quarantine by source, remainder of payload continues
- No `analytics.players` insert

Live after 13R.3: Class C = **81**. `analytics.players` = **5,534**.

---

## Class D Behavior

Class D remains the certified **7** NBA identities with **0** bridges. Fixture `1630811`: `fail_closed` / `identity_unresolved`. No automatic bridge, no name fallback. Neighboring serving rows continue. None of the 7 were mapped.

---

## Quarantine Integration

Table: `analytics.player_identity_unresolved`.

- Written only when an adopted adapter **encounters** a non-serving / conflict id.
- Class C **not** seeded (still 81 people, 0 quarantine rows in production).
- Idempotent upsert: preserve `first_seen_at`, bump `last_seen_at` + `occurrence_count`, escalate CONFLICT, never demote RESOLVED.
- Source contexts used: `INJURY`, `PLAYER_PROP`, `BOX_SCORE`, `ADVANCED`, `LINEUP`, `PLAYS`, `SEASON_AVERAGE`.
- Production quarantine count after this step: **0**. Tests are in-memory / no leftover production rows.

---

## Failure Isolation

| Payload | Result |
| --- | --- |
| 9 serving + 1 `not_serving_yet` / unresolved | 9 output rows, 1 skip/quarantine, job succeeds |
| Valid rows + 1 conflict | conflict skipped, neighbors continue |
| Starting Five with 1 unsafe starter | **game** certification unavailable; not a silent 4-pack; other games OK |
| Plays with 1 unresolved participant | chronology kept; serving link omitted |

Whole-job failure remains only where certified (Advanced unmapped **games** / season mismatch; starter **game** 5+5).

---

## Diagnostics / Accounting

Events: `identity_resolved` · `identity_not_serving` · `identity_unresolved` · `identity_conflict`.

Fields: provider, `source_context`, `provider_player_id`, `player_entity_id` when resolved.

Gate accounting: `inputIds`, `uniqueProviderIds`, `resolverLookups`, `serving`, `notServingYet`, `unresolved`, `conflicts`, `outputRows`, `quarantined`, `skipped`.

Materialize reports include `canonical` accounting + `resolverQueryCount`. No dashboards (13G later).

---

## Query / Performance

- Partial index: `WHERE provider=$1 AND provider_player_id=ANY($2)` + projections by entity UUID list.
- Advanced/Role: full `analytics.players` scan **removed**.
- Transformation overhead: in-memory map lookup per row after one batch.
- No new cache.

---

## Historical Regression

Fixture regressions (no network, no GOAT):

Historical Explorer / Advanced / Season Role / Starting Five / Timeline / Market Movement / identity / injury-identity.

**20 files, 156 tests, all passed.** No user-facing serving behavior change. Product FKs still BDL serving ids.

---

## Ingestion Readiness Matrix

| Ingestion family | Identity state | Notes |
| --- | --- | --- |
| Injuries | **IDENTITY_READY** | Lambda + shared gate; leave-report history deferred |
| Player props | **IDENTITY_READY** | Analytics writes gated; raw may retain unmapped ids; live poll off |
| Box stats | **PARTIAL** | PGL helper ready; nightly/transform still **owns** BDL `analytics.players` creation |
| Advanced | **IDENTITY_READY** | Non-serving skipped; game/season audit still fail-closed |
| Lineups / starters | **IDENTITY_READY** | Game-level 5+5 still required; identity fail ≠ emit 4 |
| Plays | **IDENTITY_READY** | Serving link optional; chronology independent |
| Season Averages | **IDENTITY_READY** | Role Profile FK unchanged |
| BBRef | **DEFERRED** | Name matching; 0 `bbref` bridges |

---

## Tests Added

| File | Coverage |
| --- | --- |
| `lib/identity/__tests__/ingest-identity-gate.test.ts` | mixed 9+1, Flemings, Class D, conflict, starters, Plays, no names |
| `lib/identity/__tests__/classify-sql-rows.test.ts` | Lambda classifier ≡ gate; Class C; conflict |
| `lib/identity/__tests__/adapter-adoption.test.ts` | box/props/advanced/role/starters/plays/BBRef defer |
| `lib/identity/__tests__/identity-ingest-copy-drift.test.ts` | Lambda copies; injuries no longer `IN analytics.players` |
| `lib/injuries/__tests__/injury-identity.test.ts` | serving vs skip |
| `lib/archive/__tests__/game-starters-from-lineups.test.ts` | `canonical_identity_unresolved` does not emit 4 |

---

## Test Results

```text
npx vitest run lib/identity lib/injuries/__tests__/injury-identity.test.ts
  lib/archive/__tests__/game-starters-from-lineups.test.ts
  lib/archive/__tests__/player-game-advanced.test.ts
  lib/archive/__tests__/player-role-profile.test.ts
  lib/betting/__tests__/historical-advanced.test.ts
  lib/betting/__tests__/historical-role-profile.test.ts
  lib/betting/__tests__/historical-timeline.test.ts
  lib/betting/__tests__/historical-final.test.ts
  lib/betting/__tests__/market-movement.test.ts
  lib/betting/__tests__/market-movement-present.test.ts
  lib/betting/__tests__/game-starters-schema.test.ts
```

**20 files · 156 tests · passed.** BDL HTTP: 0.

Live SQL (read-only): `analytics.players=5534`, Class C=81, quarantine=0, `bbref` bridges=0.

---

## Files Changed

Identity boundary:

- `lib/identity/ingest-identity-gate.ts`, `apply-ingest-gate.ts`, `classify-sql-rows.ts`, `player-identity-store.ts`, `index.ts`
- `lib/identity/injury` via `lib/injuries/injury-identity.ts`
- `lib/identity/prop-identity.ts`, `box-identity.ts`, `archive-identity.ts`, `plays-identity.ts`, `bbref-identity.ts`

Adapters:

- `lambda/injuries-snapshot/index.ts`, `identity-sql.ts`, `classify-sql-rows.ts`, `tsconfig.json`
- `lambda/player-props-snapshot/worker.ts`, `src/prop-identity-boundary.ts`, `src/identity-sql.ts`, `src/classify-sql-rows.ts`
- `lambda/shared/identity-sql.ts`, `lambda/shared/classify-sql-rows.ts`
- `lambda/nightly-bdl-updater/index.ts` (owner-path comment only)
- `lambda/boxscore-scraper/index.ts` (DEFER comment only)
- `scripts/ingestion/materialize-player-game-advanced.ts`
- `scripts/ingestion/materialize-player-role-profile.ts`
- `scripts/ingestion/materialize-game-starters-2025.ts`
- `scripts/transform-raw-player-props-to-analytics.ts`
- `scripts/transform-raw-player-props-to-lines.ts`
- `scripts/transform-raw-to-analytics.ts` (owner-path comment)
- `scripts/archive/backfill-plays-2025.ts` (serving-only participant map)
- `lib/archive/game-starters-from-lineups.ts` (`canonical_identity_unresolved`)

Not changed: product FK SQL, player URLs, leave-report history, Class C/D data, schedules, live flags.

---

## Remaining Risks

- BBRef still name-matches; unsafe to auto-bridge.
- `resolveAnalyticsPlayerId` (URL read path) still has a name join — **not** ingest; still deferred.
- Roster `entity-roster-resolve` name fallback must not be used by ingest (ingest uses `lib/identity` only).
- Nightly will create an `analytics.players` row when BDL attests a new id — that is the **owned** promotion path, not Class C auto-promote from `player_entities`.
- Injury leave-report SQL still filters `EXISTS analytics.players` (historical).
- Props **raw** tables may still contain unmapped provider ids; only analytics serving writes are gated.
- Lambda identity SQL/classifier can drift if copies are edited independently (drift tests exist).
- Quarantine upserts in Lambdas are per unresolved id after the batch classify (not identity N+1, but not a single multi-row insert).

---

## Recommended Next Step

**13G.1 — Operational ingestion observability.**

13R.3 now emits structured identity accounting and can write quarantine on encounter, but production quarantine is still 0 and there is no operator view of skip / `not_serving_yet` / conflict rates. That is the missing piece before any thaw.

13F.1 (postgame orchestration audit) is the wrong next slice while `live_ingestion_enabled=false` and feeds remain frozen — orchestration design would outrun observable skip behavior.

Do **not** start 13G.1 automatically. Do not start 13E, FK migration, or live ingestion.

---

## Verification Checklist

1. Confirm `live_ingestion_enabled=false` and no ingest job was executed.
2. Confirm `analytics.players` is still 5,534 and Class C is still 81.
3. Confirm production `player_identity_unresolved` is 0 (no Class C seed).
4. Run the vitest set above; expect pass with no network.
5. Spot-check: Flemings NBA id → `not_serving_yet`; no fake BDL id; mixed 9+1 keeps 9.
6. Spot-check: one unresolved starter → `canonical_identity_unresolved`, not 4 starters.
7. Spot-check: no `/players/` or betting URL changes; no product FK migrations.

---

## What this step did not do

No BDL HTTP · no GOAT canary · no live props/odds/injuries · no schedule thaw · no analytics season flip · no product FK migration · no canonical-ID URL migration · no Class C promotion · no Class D mapping · no possession engine · no WOWY.

---

## Step Verdict

`GREEN — provider-neutral identity is safely adopted across ingestion adapters`
