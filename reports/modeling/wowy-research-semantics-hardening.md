# STEP 14C.W.1 — WOWY Research Semantics Hardening

**Date:** 2026-09-15  
**Source audit:** `reports/modeling/wowy-end-to-end-certification-audit.md`

## Executive Result

Game-level WOWY research copy, picker counts, URL/selector/summary sync, same-player API behavior, Opp PTS polarity, and insufficient-sample presentation now describe the **same sample the classifier uses**. Certified Jokić/Murray and Jokić self-mode math is unchanged. Models were not touched.

**Step verdict: GREEN**

**USER_FACING_RESEARCH: GREEN**

**MODEL_FEATURE_SOURCE: NOT_IMPLEMENTED**

---

## Scope / Safety

Changed presentation, picker SQL filters, pair-query parsing, and explorer state lifecycle only.

Did **not** change: appearance classes, `"00"` / `"0"` semantics, missing-row = unknown, required `teamId`, identity/quarantine, per-game or per-minute aggregation, ET cutoff, model adapter scenario, frozen PTS C / REB C, lineup placeholder, or any warehouse/backfill.

---

## Certified Math Preserved

`scripts/verify-wowy-examples.ts` and live `/api/wowy/pair`:

| Query | WITH | WITHOUT | PTS |
|---|---:|---:|---|
| Jokić / Murray 2024 DEN regular | 58 | 12 | 28.4 / 35.3 |
| Jokić self-mode 2024 DEN regular | 70 | 12 | team 122.6 / 109.8 |
| Jokić / Murray 2024 DEN playoffs | 14 | 0 | insufficient |
| Luka DAL 2024 regular | 22 | 27 | stint isolated |
| Luka LAL 2024 regular | 28 | 7 | stint isolated |

Opp PTS arithmetic delta remains **+3.1** (presentation polarity only).

---

## Teammate Picker Alignment

`loadWowyTeammates` now requires `seasonType` and counts only complete Final games where:

- ET basketball date matches regular vs playoffs (same postseason floors as `WOWY_POSTSEASON_START_ET`)
- subject appearance is played (`"0"` / `"0.0"` / minutes > 0; never `"00"`)
- teammate same `team_id`
- WITH = teammate played; WITHOUT = teammate minutes `"00"`

Live Jokić / Murray 2024 DEN:

- regular picker **58 with · 12 verified DNP** = pair 58 / 12 (was 72 / 15)
- playoffs picker **14 with · 0 verified DNP** = pair 14 / 0

Labels: `"[N] with · [M] verified DNP"` — not “together”.

JS `teammatePickerCountsFromGames` uses the pair classifier for fixtures; SQL mirrors those buckets for the bounded teammate list.

---

## URL / Selector / Summary Synchronization

`resolveWowyExplorerSelection` + `wowySummaryMatchesSelection`:

- If a teammate is requested, pair fetch waits until context options load.
- The select only shows Player B when B is in the loaded options.
- Results render only when `summary.query.teammatePlayerId` and `summary.mode` match that selection.
- Invalid teammate after season-type/stint change is cleared, then self-mode is fetched, and the URL drops `teammate`.

Live playoffs deep-link `teammate=335` kept Murray in the URL **and** rendered teammate-mode 14 / 0 (not team self-mode 107 PTS).

---

## Same-Player API Behavior

Explicit `teammatePlayerId === subjectPlayerId` → **422** `{ code: "same_player" }`.

Omitted teammate parameter remains self-mode 200.

---

## Opp PTS Semantic Polarity

Arithmetic `with − without` unchanged.

`wowyDiffPolarity('oppPts', delta)`: positive → **unfavorable**, negative → **favorable**. Hero cards use coral vs teal **and** the text “Unfavorable (higher opponent scoring)”. Insights: “Opp PTS higher when Jokic appeared” with “Higher opponent scoring is unfavorable”.

Live self-mode: Opp PTS **+3.1** with that unfavorable label (no longer a green “up”).

---

## Insufficient Sample Presentation

`wowyShowsComparisonHero('insufficient') === false`.

Playoffs Jokić / Murray: banner **Insufficient sample**, panel **Not a comparable WITH / WITHOUT split**, no hero diffs, no comparison bars. Drill-down still lists the 14 appeared games.

---

## Low-Support Presentation

Comparisons stay visible. Sample banner adds a **Low support** heading plus the existing policy sentence. Insights still emit stat rows. No confidence intervals.

---

## Sample Date Coverage

Sample bar now shows both sides, e.g. regular Murray:

- Appeared 2024-10-24 → 2025-04-13
- Verified DNP 2024-11-02 → 2025-04-09

---

## Copy / Terminology

- WITH/WITHOUT cards have distinct blurbs (`When [player] played` vs `When [player] had a verified DNP`).
- “in the box” removed from explorer/results/insights.
- Methodology uses “verified DNP roster row in historical player game logs”; no `inferred_pgl`.
- Missing-row rule is in methodology and the insufficient panel.
- Grammar: insufficient hold copy no longer uses “Denver Nuggets does”.

---

## Unknown Participation Mapping

Dead reason `teammate_unknown_participation` is no longer counted.

`unknownParticipationCount` = excluded `malformed_teammate_minutes` only.

`unknownMembershipCount` still covers missing/ambiguous membership.

---

## Entitlement / Dead State Cleanup

- `UPGRADE_COPY.wowy.detail` no longer says “when that surface ships.” **No gating added.** `/wowy` remains ungated.
- Removed WOWY-only `UnauthorizedPanel` / 401 branch. APIs still do not return 401. Shared `UnauthorizedPanel` on other betting pages is unchanged.

---

## Accessibility / Mobile

- Support/insufficient states are text banners (`role="status"`), not color-only.
- Opp PTS meaning is labeled in text as well as color.
- Form labels preserved; teammate select disabled until options load (prevents a false selected name).
- Filters still `grid-cols-1` below `md`; metric cards `grid-cols-2`. Device-metrics 390px emulation was not used this session; layout is the existing responsive grid, not a redesign.

---

## Tests Added

`npx vitest run lib/wowy` — **10 files, 46 tests, all passed.**

| ID | Coverage |
|---|---|
| A–C | `picker-counts.test.ts` regular vs playoffs, subject-played, pair-bucket match |
| D–E | `explorer-selection.test.ts` no self-mode fetch while teammate pending; invalid teammate cleared |
| F | `page-contract.test.ts` explicit same-player parse reject |
| G–H | `insights.test.ts` Opp PTS polarity |
| I–J | insufficient hides comparison hero; low-support stays visible |
| K | `aggregate.test.ts` malformed minutes → `unknownParticipationCount` |

---

## Live Verification

Local `/wowy` + APIs:

1. Jokić / Murray regular: picker **58 with · 12 verified DNP**, results 58 / 12, 28.4 / 35.3, URL keeps `teammate=335`.
2. Jokić / Murray playoffs: picker **14 with · 0**, teammate-mode insufficient, no comparison heroes, URL keeps teammate.
3. Jokić self-mode: 70 / 12, 122.6 / 109.8, Opp PTS +3.1 labeled unfavorable.
4. Same-player API 422.

---

## Raw Warehouse Verification

Verify script still matches 2024 DEN regular Jokić/Murray 58 / 12 and 28.4 / 35.3. Luka DAL/LAL stints unchanged.

---

## Frozen Model Safety

No WOWY import in `lib/betting` or Model Lab. No shadow PTS C / REB C files changed. No training run. Adapter still unused.

**MODEL_FEATURE_SOURCE = NOT_IMPLEMENTED**

---

## Files Changed

- `lib/wowy/queries.ts` — season-typed picker SQL
- `lib/wowy/parse-query.ts` — reject same-player
- `lib/wowy/aggregate.ts` — participation count mapping
- `lib/wowy/insights.ts` — polarity + copy
- `lib/wowy/policy.ts` — `wowyShowsComparisonHero`
- `lib/wowy/explorer-selection.ts` — **new**
- `lib/wowy/picker-counts.ts` — **new**
- `lib/wowy/index.ts` — exports
- `lib/wowy/__tests__/*` — regressions
- `app/api/wowy/{pair,model-pair,context}/route.ts`
- `app/wowy/WowyExplorer.tsx`, `WowyResults.tsx`
- `lib/entitlements/types.ts` — copy only

Classifier `eligibility.ts` / `appearance.ts` / `cutoff.ts` / `model-adapter.ts` were not rewritten.

---

## Remaining Limitations

Unchanged product scope: game-level only, 2023–2025 Final boxes, no possessions/lineups/usage, no WOWY on player/props/game/Historical Explorer/Context Check, research page is retrospective, 1-hour `unstable_cache`, page ungated, optional index SQL still unapplied.

Picker SQL is a bounded join that mirrors appearance + season-type + complete-Final rules; it does not re-run the full in-memory classifier per teammate (by design).

---

## Recommended Next Step

No further WOWY semantics work is required for the current research page. Do **not** start model integration, lineup WOWY, or Parlay Builder from this step.

---

## Verification Checklist

1. Open `/wowy?subject=246&season=2024&teamId=8&seasonType=regular&teammate=335` — picker **58 with · 12 verified DNP**, results 58 / 12.
2. Switch season type to Playoffs — picker **14 with · 0**, insufficient panel, no hero diffs, URL still has `teammate=335`.
3. Clear teammate — 70 / 12 team split, Opp PTS +3.1 labeled unfavorable.
4. `GET /api/wowy/pair?...&teammatePlayerId=246` (same as subject) → 422.
5. `npx tsx scripts/verify-wowy-examples.ts` still 58 / 12 and 28.4 / 35.3.
6. Confirm no model/shadow artifact diffs.

---

## Step Verdict

**GREEN — WOWY game-level research semantics now match the certified classifier and the surface is ready for its current research scope**
