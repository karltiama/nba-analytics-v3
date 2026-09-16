# STEP 14P.E4 — Parlay Workspace Historical Court Context Analysis

Generated: 2026-09-16  
Status: **GREEN — Workspace runs the shared historical pipeline behind explicit Analyze; X3F parity certified; no live analysis or persistence**

---

## Executive Result

**GREEN — Parlay Workspace safely runs certified historical Court Context analysis through the shared XRay pipeline with explicit Analyze and no semantic duplication.**

A same-game Decision Close selection can be analyzed only after **Analyze with Court Context**. The path is:

`CanonicalParlayOffer[]` → ID mapper (`toCanonicalParlayLegResolution`) → `runHistoricalCanonicalParlayAnalysis` (match → assemble → interpret) → existing result panels.

XRay still uses `runHistoricalXrayReplay` (fuzzy resolve then the same mid-pipeline). For the locked X3F parlay, Workspace and XRay match statuses, requested lines, Why This Could Fail codes, and dependency kinds match.

Live/`live_current` does not fall back to historical matching. Multi-game selections are blocked. Other games than X3F LAL @ OKC (18447934) are fail-closed as outside E4 injectable coverage. Hard reload still empties the Workspace. No schema, providers, nav item, or modeling changes.

| Decision | Value |
| --- | --- |
| Architecture | **HYBRID** |
| PROPS_EXPLORER | **KEEP** |
| PARLAY_WORKSPACE | **HISTORICAL_ANALYSIS_CERTIFIED** |
| WORKSPACE_ANALYZE | **CERTIFIED** |
| SHARED_ANALYSIS_PIPELINE | **CERTIFIED** |
| XRAY_WORKSPACE_ANALYSIS_PARITY | **CERTIFIED** (X3F) |
| DECISION_CLOSE_SEMANTICS | **CERTIFICATION_PRESERVED** |
| OUTCOME_LEAKAGE | **NONE_DETECTED** |
| CURRENT_LIVE_ANALYSIS | **NOT_IMPLEMENTED** |
| XRAY_WORKSPACE_HANDOFF | **NOT_IMPLEMENTED** |
| MEASURED_CORRELATION | **NOT_IMPLEMENTED** |
| NUMERIC_CONFIDENCE | **NONE** |
| PARLAY_PERSISTENCE | **NOT_IMPLEMENTED** |
| PRIMARY_NAV | **UNCHANGED** |
| MANUAL_VIEWPORT | **NOT_RUN** |
| MODEL_TUNING | **FROZEN** |
| REAL_OPENAI_CALLS_THIS_STEP | **0** |
| REAL_BDL_CALLS_THIS_STEP | **0** |
| SCHEMA_MIGRATION | **NONE** |

---

## Existing XRay Orchestration Audit

Certified entry: `runHistoricalXrayReplay(ExtractedParlayLeg[], HistoricalXrayReplayContext, deps)` in `lib/parlay-xray/e2e/run.ts`.

Pipeline:

1. `resolveCanonicalParlayLegs` — **name/fuzzy** player + matchup game  
2. `matchHistoricalParlayLeg` — MM rows scoped to **one** `context.gameId`  
3. `assembleXrayLegContext` — cutoff-safe packet  
4. `interpretXrayLeg` → `interpretXrayParlay`

Context type is singular: `gameId`, `historicalDate`, `cutoffAt`. Session Confirm does **not** invent a date. Production XRay still does not run this path; non-prod client hard-wires X3F.

**SUPPORTED:** same-game historical replay with explicit context + injectable deps; interpretation without screenshot extraction; E1 ID mapper.

**NOT SUPPORTED:** same-date multi-game orchestration; multi-date; live analysis; analysis API; public Confirm inventing history.

**REQUIRES ADAPTER:** skip step 1 for Workspace IDs; enforce same-game + `decision_close`; inject certified deps (E4: X3F fixture only).

---

## Supported Historical Selection Shapes

| Shape | E4 |
| --- | --- |
| 1+ Decision Close legs, **same game**, game = X3F `18447934` | READY → Analyze |
| Partial MM match (Dort 8.5 vs close 7.5) | Allowed; retained |
| Empty Workspace | No Analyze |
| `live_current` | UNAVAILABLE |
| Multiple `gameId`s | UNAVAILABLE |
| Other historical game/date | UNAVAILABLE (no SQL deps) |

---

## Same-Game / Same-Date / Multi-Date Support

| | |
| --- | --- |
| SAME_GAME | **SUPPORTED** (certified orchestrator) |
| SAME_DATE_MULTI_GAME | **NOT_SUPPORTED** — enforced (`MULTI_GAME`) |
| MULTI_DATE | **NOT_SUPPORTED** — not modeled; different games already blocked |

Do not treat this as a universal parlay context.

---

## Workspace Analysis Eligibility

`evaluateWorkspaceAnalysisEligibility`:

- canonical player id, game id, market, side, line, sportsbook required  
- snapshot **must** be `decision_close`  
- `live_current` → *Current-season Court Context analysis is not enabled yet.*  
- missing identity → fail closed (no nearest-game inference)  
- game must be the injectable X3F game  

States: **READY** / **UNAVAILABLE** (with concrete codes). No numeric confidence.

---

## Historical Coverage Boundary

Documented XRay matching audit window: **2026-04-02 → 2026-05-02**.

E4 **runtime deps** are the certified X3F in-memory fixture (LAL @ OKC, `18447934`, cutoff `2026-04-03T01:30:00.000Z`). Other games in that window are **not** analyzed and show:

*Historical Court Context analysis is not available for one or more selected offers.*

SQL loaders exist in XRay but are N+1-shaped and were **not** wired here (no schema, no provider calls).

---

## Shared Analysis Entry Point

`runHistoricalCanonicalParlayAnalysis(resolutions, context, deps)`

XRay: `runHistoricalXrayReplay` = fuzzy resolve + this function.  
Workspace: E1 resolutions + this function.

No `WorkspaceAnalysisEngine`.

---

## Workspace Adapter

`runWorkspaceHistoricalAnalysis`:

1. Eligibility  
2. `toCanonicalParlayLegResolution` (IDs, no `resolvePlayerIdentityFromName`)  
3. Team/opponent **only** from replay `targetGame` + prior-log `teamId` (IDs, not names) so SHARED_TEAM/SHARED_GAME_ENVIRONMENT can fire  
4. Shared match/assemble/interpret  

---

## Canonical Identity Preservation

Player id, game id, market, side, line, book, odds, snapshot, `offerIdentity` are unchanged. No second identity pass.

---

## Decision Close / 3-Hour Boundary

Ajay selected **12.5** Decision Close. Analysis may show 3-Hour **11.5** → Close **12.5**. Requested line stays **12.5**. Opening is unused.

---

## Explicit Analyze Boundary

Copy: **Analyze with Court Context**.

Not run on add, Workspace open, or remove. Client has no analyze `useEffect`. Empty Workspace has no Analyze.

---

## Historical Matching

Same `matchHistoricalParlayLeg` as XRay. X3F: 3 MATCHED + 1 PARTIAL (Dort). Partial is kept.

---

## Context Assembly

`assembleXrayLegContext` only. No Workspace-local form/role/matchup/MM.

---

## Leg Interpretation

`interpretXrayLeg`. Same packet → same read as XRay.

---

## Parlay Interpretation

`interpretXrayParlay`. SHARED_GAME / SHARED_PLAYER / SHARED_TEAM / logical conflict helpers unchanged. Not correlation.

---

## Why This Could Fail

Reused from certified parlay/leg evidence (shared player/game/team, partial market, WOWY/projection/availability gaps, form, worse-than-close). No recommendations.

---

## Data Coverage

Existing `XrayParlaySummary` coverage rows, including WOWY/projection/availability as limitations (`X3F_KNOWN_GAPS`).

---

## Partial Match Behavior

Dort remains visible and review-needed. 3 exact + 1 partial still produces 4 interpretations.

---

## Outcome Leakage

Workspace path: injecting X3F target-game and future sentinel logs does not change interpretations. JSON has no hit/miss/final score. Cutoff assembly unchanged.

**OUTCOME_LEAKAGE: NONE_DETECTED**

---

## XRay / Workspace Parity

Identical X3F canonical parlay:

- match statuses  
- requested lines  
- leg Why-This-Could-Fail codes  
- parlay Why-This-Could-Fail codes  
- dependency kinds  

Presentation: Workspace eyebrow **Historical Analysis** vs XRay **Parlay XRay**. OCR identity layers remain XRay-only (`rawSnippet` null on Explorer offers).

---

## Result Component Reuse

| Component | Class | E4 |
| --- | --- | --- |
| `interpretXrayLeg` / `interpretXrayParlay` | SOURCE_NEUTRAL | reuse |
| Why This Could Fail data | SOURCE_NEUTRAL | reuse |
| `XrayParlaySummary` / `XrayResultsPanel` | XRAY_BRANDED_BUT_REUSABLE | reuse + optional `eyebrow` |
| Extraction/OCR UI | XRAY_SPECIFIC | unused |

---

## Results UX

After Analyze: results replace the review list. Header notes historical Decision Close + slate label. **Edit selection** returns to cards without changing the stored result until the fingerprint changes. Add More Props / Clear remain.

---

## Analysis Invalidation

Fingerprint = sorted `offerIdentity`s. Remove / add / clear that changes the fingerprint **clears** the stored result. Stale results are not shown.

---

## Current/Live Boundary

`live_current` → UNAVAILABLE. No historical matching fallback.

---

## Mobile / Manual Viewport

**MANUAL_VIEWPORT = NOT_RUN** — no local app server. Contract tests are not visual acceptance.

---

## Accessibility

Analyze is a labeled button (`aria-busy` while running). Empty has no Analyze. Live region announces running/count. Result headings come from the shared panel (including Why this could fail text + icon). Edit selection / Add More Props / Clear are keyboard links/buttons. Remove remains labeled.

---

## Performance

Stage clocks: adapter/`resolveMs`, `matchMs`, `contextMs`, `interpretMs`, `totalMs`.

Unit tests use deterministic `nowMs = 0`. Prior X3F in-memory ops timing was ~24ms total. SQL loaders were **not** attached; known N+1 if later wired per player/market.

---

## Entitlements

No new Pro gate or paid quota. Fixture analysis is local JS, not a billed provider.

---

## Analytics Privacy

No new Umami events. No player/line/odds/book payloads.

---

## Tests

`lib/parlay/__tests__/workspace-analysis.test.ts` (12): empty cannot analyze; no auto result on store load; X3F READY; live_current blocked; outside coverage blocked; multi-game blocked; Decision Close 12.5 vs 3-Hour 11.5; Dort partial; XRay parity; leakage; fingerprint invalidation; clear invalidation.

Page contract: Analyze copy present; no `useEffect` auto-run; no discovery board.

---

## E1/E2/E3 Regression

| Suite | Passed |
| --- | --- |
| E1 adapter | **21** |
| E2 selection + page-contract | **22** |
| E3 store + workspace page-contract | **14** |
| E4 workspace-analysis | **12** |
| **Parlay total this run** | **69** |

Add to Parlay, tray, duplicate rules, Save/Compare/Paper, and in-memory Workspace handoff remain.

---

## XRay Regression

| | |
| --- | --- |
| RUN | `lib/parlay-xray` excluding Docker postgres |
| PASSED | **36 files, 235 tests** |
| EXCLUDED | `extraction/__tests__/postgres-persistence.test.ts` (16) |
| WHY | Docker daemon unavailable (same as E1–E3). Not claimed as 251. |

`runHistoricalXrayReplay` still owns OCR resolve. Historical semantics unchanged.

---

## Modeling Freeze

No edits to 70/30, PTS C, REB C, Model D, WOWY, Context Engine research, or prospective shadow.

---

## Files Changed

- `lib/parlay-xray/e2e/run.ts` — shared `runHistoricalCanonicalParlayAnalysis`; XRay calls it after resolve  
- `lib/parlay-xray/e2e/index.ts` — export  
- `lib/parlay/workspace-analysis.ts` — eligibility, fingerprint, adapter, runner  
- `lib/parlay/selection-store.ts` — analysis record + invalidation  
- `lib/parlay/use-parlay-selection.ts` — expose analysis  
- `lib/parlay/index.ts` — exports  
- `lib/parlay/__tests__/workspace-analysis.test.ts`  
- `lib/parlay/__tests__/parlay-workspace-page-contract.test.ts`  
- `components/parlay-xray/XrayParlaySummary.tsx` / `XrayResultsPanel.tsx` — optional `eyebrow`  
- `components/parlay-workspace/ParlayWorkspaceView.tsx`  
- `app/parlay-workspace/ParlayWorkspaceClient.tsx`  
- `reports/product/parlay-workspace-historical-analysis.md`  
- `notes/learning-log/2026-09-16/step-14p-e4-workspace-historical-analysis.mdx`

---

## Schema Changes

**NONE.**

---

## Remaining Gaps

- Live/current analysis not implemented (intentional).  
- XRay → Workspace handoff not implemented (intentional).  
- Same-date multi-game / multi-date not supported.  
- Historical games other than X3F are unavailable until SQL deps are batched.  
- Manual ~390px viewport still NOT_RUN.  
- No persistence, sharing, nav item, entitlements.

---

## Recommended Next Step

**STOP after E4.**

After review: either a visual/mobile pass on Analyze/results, or a later read-only deps loader for the 2026-04-02–2026-05-02 window (still no live analysis, no XRay screenshot handoff, no persistence).

---

## Verification Checklist

1. Empty `/parlay-workspace` → Explore Props, no Analyze.  
2. Add X3F-like Decision Close legs → Open Workspace → Analyze is explicit, not auto.  
3. Ajay Over 12.5 stays 12.5; 3-Hour 11.5 only in comparison.  
4. Dort 8.5 remains a visible partial.  
5. Remove a leg after results → analysis disappears; Analyze required again.  
6. `live_current` or a second game → unavailable copy, no historical run.  
7. `npx vitest run lib/parlay/__tests__/adapt-props-explorer-offer.test.ts lib/parlay/__tests__/selection.test.ts lib/parlay/__tests__/props-explorer-parlay-selection-page-contract.test.ts lib/parlay/__tests__/selection-store.test.ts lib/parlay/__tests__/parlay-workspace-page-contract.test.ts lib/parlay/__tests__/workspace-analysis.test.ts`

---

## Step Verdict

**GREEN — Parlay Workspace safely runs certified historical Court Context analysis through the shared XRay pipeline with explicit Analyze and no semantic duplication**

ARCHITECTURE: **HYBRID**  
PROPS_EXPLORER: **KEEP**  
PARLAY_WORKSPACE: **HISTORICAL_ANALYSIS_CERTIFIED**  
WORKSPACE_ANALYZE: **CERTIFIED**  
SHARED_ANALYSIS_PIPELINE: **CERTIFIED**  
XRAY_WORKSPACE_ANALYSIS_PARITY: **CERTIFIED**  
DECISION_CLOSE_SEMANTICS: **CERTIFICATION_PRESERVED**  
OUTCOME_LEAKAGE: **NONE_DETECTED**  
CURRENT_LIVE_ANALYSIS: **NOT_IMPLEMENTED**  
XRAY_WORKSPACE_HANDOFF: **NOT_IMPLEMENTED**  
MEASURED_CORRELATION: **NOT_IMPLEMENTED**  
NUMERIC_CONFIDENCE: **NONE**  
PARLAY_PERSISTENCE: **NOT_IMPLEMENTED**  
FREE_PRO_ENTITLEMENTS: **NOT_FINALIZED**  
MODEL_TUNING: **FROZEN**  
REAL_OPENAI_CALLS_THIS_STEP: **0**  
REAL_BDL_CALLS_THIS_STEP: **0**  
SCHEMA_MIGRATION: **NONE**  
MANUAL_VIEWPORT: **NOT_RUN**
