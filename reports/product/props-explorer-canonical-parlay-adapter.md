# STEP 14P.E1 — Props Explorer Canonical Parlay Offer Adapter

Generated: 2026-09-16  
Status: **adapter certified — no Parlay Workspace, no Add to Parlay UI**

---

## Executive Result

**GREEN — Props Explorer offers can deterministically become shared canonical parlay legs with exact book/line/side/snapshot semantics.**

A user-selected Explorer row becomes an unambiguous canonical offer **without** fuzzy identity work, provider calls, reconstructed lines, sportsbook substitution, or 3-Hour replacement.

The adapter does **not** run XRay name matching. It uses the row’s canonical player id and game id, existing `canonicalizeXrayMarket` / `canonicalizeSportsbook`, and serving `marketContext` / `sourceTable` for snapshot kind.

| Decision | Value |
| --- | --- |
| Architecture | **HYBRID** |
| PROPS_EXPLORER | **KEEP** |
| PARLAY_WORKSPACE | **NOT_IMPLEMENTED** |
| ADD_TO_PARLAY | **NOT_IMPLEMENTED** |
| CANONICAL_PARLAY_FROM_PROP_ROW | **CERTIFIED** |
| DECISION_CLOSE_SEMANTICS | **CERTIFIED** |
| XRAY_ANALYSIS_PIPELINE | **UNCHANGED** |
| SHARED_ANALYSIS_PARITY | **CERTIFIED** |
| MODEL_TUNING | **FROZEN** |
| REAL_OPENAI_CALLS_THIS_STEP | **0** |
| REAL_BDL_CALLS_THIS_STEP | **0** |
| PARLAY_PERSISTENCE | **NOT_IMPLEMENTED** |
| SCHEMA_MIGRATION | **NONE** |

---

## Shared Type Audit

Inspected:

| Contract | Role | Reuse decision |
| --- | --- | --- |
| `ExtractedParlayLeg` | XRay screenshot/confirm fields (`XrayField`, OCR `rawSnippet`) | **Too XRay-specific** as the source type. Adapter fills one only as a bridge, with no OCR fields |
| `CanonicalParlayLegResolution` | Shared downstream identity (player/game/market/side/line/book) | **Reuse as pipeline entry.** Built from IDs, not `resolvePlayerIdentityFromName` |
| `XRayParlay.source` | `'screenshot'` only | Do not force onto Explorer legs |
| `PLAYER_PROP_COMPARISON_KIND` | `'decision_close'` | **Reuse** as historical offer snapshot kind |
| `'live_current'` | Existing comparison-kind sibling | **Reuse** for live Explorer rows |
| `PLAYER_PROP_REFERENCE_KIND` | `'3_hour_pre_tip'` | **Not** an offer snapshot. Compare/MM only |
| `canonicalizeXrayMarket` | Reuses `canonicalizePropType` + XRay allowlist | **Reuse — no new alias table** |
| `canonicalizeSportsbook` | Reuses `normalizeVendor` + v1 allowlist | **Reuse** |
| `parsePropSide` / `parseLineValue` | Exact side/line parse | **Reuse** |

No `PropsParlayLeg` type was added. The source-neutral type is `CanonicalParlayOffer`. Mapping to `CanonicalParlayLegResolution` is explicit and optional.

XRay `resolveCanonicalParlayLeg` is **unchanged**. Explorer offers must not enter that function for player/game identity (it fuzzy-matches names).

---

## Props Explorer Source Offer Contract

`PropsExplorerOfferInput` is the selected board offer, not a saved parlay:

- `playerId`, `gameId`, `propType`, `side`, `lineValue`, `sportsbook`
- `oddsAmerican` (metadata)
- `snapshotAt` (optional timestamp)
- `marketContext`: `historical` \| `live`
- `sourceTable`: `research.prop_decision_lines` \| `analytics.player_props_current`

Extra keys such as `threeHourLine` are ignored.

This is **not** persistence.

---

## Player Identity

Explorer rows already carry analytics `playerId`. The adapter:

- requires a non-empty canonical id
- does **not** fuzzy-match `playerName`
- does **not** call X3A / `resolvePlayerIdentityFromName`

Missing/blank id → `MISSING_PLAYER_ID`.

Typo display name `"Jockic"` with id `203999` still resolves to Jokic’s id. Catalog lookup is **id-only** enrichment (`entityId` / display name) when provided.

---

## Game Identity

Explorer rows carry `gameId`. The adapter uses that id only.

It does **not** derive a game from player name, date, or matchup string.

Missing/blank id → `MISSING_GAME_ID`.

---

## Market Canonicalization

Reuses `canonicalizeXrayMarket` (which calls `canonicalizePropType` plus XRay local aliases).

Covered: `points` / `PTS`, `rebounds` / `REB`, `assists` / `AST`, `threes` / `3PM`, `PRA` → `points_rebounds_assists`.

Unknown or non-XRay markets (`turnovers`, `steals`, `First Basket`) → `UNSUPPORTED_MARKET`. Never coerced to points.

---

## Side / Line Preservation

- Side: `parsePropSide` only. No default Over. Missing/invalid → `MISSING_SIDE`.
- Line: `parseLineValue` of the **selected** `lineValue` only. Not consensus, not another book, not 3-Hour, not a second-source Decision Close.

DraftKings 27.5 stays 27.5.

---

## Sportsbook Canonicalization

Reuses `canonicalizeSportsbook` → `normalizeVendor` + v1 vendors: `draftkings`, `fanduel`, `betmgm`, `caesars`.

Empty → `MISSING_SPORTSBOOK`.  
`bet365` / `betrivers` → `UNSUPPORTED_VENDOR`.  
No UI-style guessing.

---

## Odds Metadata

Selected American odds are copied onto the offer. Null/non-finite → `null`.

Odds are **not** used to resolve player, game, market, side, or line. Changing odds does not change `wagerIdentity`.

No implied-probability conversion in this step.

---

## Snapshot Semantics

| Explorer serving | Snapshot kind |
| --- | --- |
| `marketContext: historical` or `research.prop_decision_lines` | `decision_close` |
| `marketContext: live` or `analytics.player_props_current` | `live_current` |
| neither present | `MISSING_SNAPSHOT_SEMANTICS` |

Never `opening`. Never `3_hour_pre_tip`.

UI copy “Historical closing line” / MM “Close” is **not** rewritten in this step. Internal snapshot identity is certified `decision_close`.

---

## Decision Close vs 3-Hour Boundary

Ajay Mitchell X3F fixture: board Decision Close **12.5**, Compare 3-Hour **11.5**.

Adapter input includes red-herring `threeHourLine: 11.5`. Output line is **12.5**, snapshot kind **`decision_close`**.

3-Hour remains comparison context for later analysis. It does not become the selected wager.

---

## Live Current Boundary

Live fixture with `marketContext: 'live'` / `analytics.player_props_current` → `live_current`.

No live provider integration. The distinction is structural only.

Same player/game/market/side/line/book with different snapshot kinds share `wagerIdentity` and differ on `offerIdentity`.

---

## Canonical Leg Output

`CanonicalParlayOffer`:

- `source: 'props_explorer'`
- `sourceProvenance: 'selected_canonical_offer'`
- canonical `playerId`, optional display name
- canonical `gameId`
- canonical `market`
- exact `side`, `line`
- canonical `sportsbook` `{ vendor, displayName }`
- `oddsAmerican` metadata
- `snapshotKind`, `snapshotAt`
- `wagerIdentity`, `offerIdentity`

`toCanonicalParlayLegResolution` produces `FULLY_RESOLVED` `CanonicalParlayLegResolution` for the existing XRay context/interpretation entry. `originalLeg.rawSnippet` is always `null`.

No analysis is attached.

---

## Source Provenance

| Path | Provenance |
| --- | --- |
| XRay | screenshot / confirmed correction (`ExtractedParlayLeg` + OCR snippet) |
| Props Explorer | `selected_canonical_offer` |

Downstream basketball analysis uses wager fields, not how the leg was created.

---

## Failure Contract

Fail closed. No partial canonical legs.

| Code | When |
| --- | --- |
| `MISSING_PLAYER_ID` | blank / null player id |
| `MISSING_GAME_ID` | blank / null game id |
| `UNSUPPORTED_MARKET` | unknown or non-XRay market |
| `MISSING_SIDE` | missing or not over/under |
| `INVALID_LINE` | missing / non-numeric line |
| `MISSING_SPORTSBOOK` | blank book |
| `UNSUPPORTED_VENDOR` | not a v1 canonical vendor |
| `MISSING_SNAPSHOT_SEMANTICS` | no live/historical serving signal |

---

## Canonical Offer Identity

Not persisted. Not a DB key.

- **`wagerIdentity`**: `playerId|gameId|market|side|line|sportsbookVendor`  
  Shared with XRay resolved legs (duplicate / parity).
- **`offerIdentity`**: `props_explorer|{snapshotKind}|{wagerIdentity}`  
  Distinguishes historical Decision Close vs live_current for the same numbers.

---

## XRay Compatibility

`toCanonicalParlayLegResolution` is assignment-compatible with `CanonicalParlayLegResolution`.

Jokic Over 27.5 DraftKings on `game-den-okc-2026-03-17`:

- XRay `resolveCanonicalParlayLeg` (name + matchup)
- Explorer adapter (ids)

→ **same `wagerIdentity`**. Explorer source provenance differs. No OCR snippet on the Explorer mapping.

---

## XRay / Props Parity

Ajay Mitchell Over 11.5 DraftKings: Explorer offer mapped to resolution, identity assembled into the certified X3C context packet.

`interpretXrayLeg` returns the same `marketPosition.kind`, `closeLine`, and `summaryState` as the XRay packet. Source provenance does not change basketball interpretation.

---

## Tests

`lib/parlay/__tests__/adapt-props-explorer-offer.test.ts` — **21 passed**, covering:

- valid historical → `decision_close`
- valid live fixture → `live_current`
- missing player / game
- unsupported market
- missing side
- invalid line
- unsupported vendor
- Decision Close preserved
- 3-Hour does not replace selected close
- DK 27.5 vs FD 28.5
- Over vs Under
- snapshot provenance
- same-player multi-market
- determinism
- odds ignored for identity
- missing snapshot semantics
- id-only player resolution (no fuzzy names)
- XRay wager-identity parity
- shared interpretation parity

Props Explorer serving tests still pass (6).

---

## XRay Regression

`lib/parlay-xray` unit/e2e tests (excluding Docker Postgres harness): **235 passed**.

Certified baseline 251 = those 235 + 16 `postgres-persistence` tests, which require a local Docker daemon and were not executed here. No XRay source files were modified.

`XRAY_ANALYSIS_PIPELINE: UNCHANGED`

---

## Modeling Freeze

No edits under `lib/model-lab`, `lib/wowy`, `lib/context-engine`, or production 70/30 / PTS C / REB C / Model D paths.

`MODEL_TUNING: FROZEN`

---

## Files Changed

- `lib/parlay/adapt-props-explorer-offer.ts` (new)
- `lib/parlay/index.ts` (new)
- `lib/parlay/__tests__/adapt-props-explorer-offer.test.ts` (new)
- `reports/product/props-explorer-canonical-parlay-adapter.md` (this report)
- `notes/learning-log/2026-09-16/step-14p-e1-canonical-parlay-adapter.mdx`

Not changed: Props Explorer UI, navigation, XRay analysis, entitlements, modeling, Terraform, schema.

---

## Schema Changes

**NONE.** Adapter is in-memory only. Persistence was not required.

---

## Remaining Gaps

- No Add to Parlay control (intentional).
- No Parlay Workspace route/state (intentional).
- Explorer/MM user-facing labels still say “Historical closing line” / “Close”; adapter internals use `decision_close`.
- Mapped resolution leaves team/opponent unresolved unless a later join is added; wager identity does not need them.
- `entityId` is catalog enrichment only.
- v1-only books; Explorer chips for BetRivers/Fanatics cannot become certified legs yet.
- Steals/blocks on the Explorer board fail closed against the XRay market allowlist.

---

## Recommended Next Step

**STEP 14P.E2 (review first):** smallest Add to Parlay on an Explorer row that calls `adaptPropsExplorerOffer` and fail-closes in UI on adapter errors. Still no workspace route, no persistence, no nav rename, no XRay analysis changes.

---

## Verification Checklist

1. Confirm `/betting/props-explorer` row actions are still Save / Compare / Paper only.
2. Confirm primary nav is unchanged and `/parlay-workspace` does not exist.
3. `npx vitest run lib/parlay/__tests__/adapt-props-explorer-offer.test.ts`
4. Confirm a historical fixture snapshot kind is `decision_close`, not Opening or 3-Hour.
5. Confirm Ajay 12.5 + `threeHourLine: 11.5` still adapts to **12.5**.
6. Confirm no OpenAI/BDL/schema/modeling files in the diff.

---

## Step Verdict

**GREEN — Props Explorer offers can deterministically become shared canonical parlay legs with exact book/line/side/snapshot semantics**

```
ARCHITECTURE: HYBRID
PROPS_EXPLORER: KEEP
PARLAY_WORKSPACE: NOT_IMPLEMENTED
ADD_TO_PARLAY: NOT_IMPLEMENTED
CANONICAL_PARLAY_FROM_PROP_ROW: CERTIFIED
DECISION_CLOSE_SEMANTICS: CERTIFIED
XRAY_ANALYSIS_PIPELINE: UNCHANGED
SHARED_ANALYSIS_PARITY: CERTIFIED
MODEL_TUNING: FROZEN
REAL_OPENAI_CALLS_THIS_STEP: 0
REAL_BDL_CALLS_THIS_STEP: 0
PARLAY_PERSISTENCE: NOT_IMPLEMENTED
SCHEMA_MIGRATION: NONE
```
