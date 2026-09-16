# WOWY r1 — what it can contribute now

**Coverage:** 2023 and 2024 have no injury tape. Season 2025 (2025–26) includes March–May 2026. Missing `game_id` is a schema gap; unique Final team-nights in that window have 0 ET-date collisions.

**Known-Out subset:** **399** player-games (36 dates, 106 games, 172 players, 184 pairs) where the primary prior-minutes teammate has a fresh explicit Out before T−60, unambiguous team membership, and WOWY support. Not trained. 315/322 team-games with some listed Out is not this subset.

**Decision:** exploratory known-Out chronological ablation **could** run as development evidence (date-clustered 247 / 152). It was **not** trained. WITH and three-season evaluation stay closed. Frozen C, shadow, and ingestion flags were not changed.

**Next step (collection, not this slice):** injuries-only activation after a BDL injuries probe — not shadow scoring. Details: `prospective-integration.md` and `known-out-feasibility.md`.

**UI:** Model Lab adapter tests passed. Browser verification of `/admin/model-lab` did not occur.

---

## 1. Inspected WOWY implementation

Game-level participation WOWY (`game-level-wowy-v1`) lives in `lib/wowy/`. Parlay XRay `lib/parlay-xray/context/wowy.ts` is still a stub. This experiment reuses the shared calculator; it does not fork classification.

| Topic | Finding | Path |
| --- | --- | --- |
| With / without | Subject played + same `team_id`; teammate played vs verified `"00"` DNP | `lib/wowy/eligibility.ts` (`classifyWowyGame`) |
| Played / DNP / unknown | `"00"` = verified DNP (not injury); `"0"` = played; missing teammate row = unknown, never inferred absence | `lib/wowy/appearance.ts` |
| Trades / stints | `teamId` required; `player_team_stints` not used as trade dates | `lib/wowy/types.ts` `WowyPairQuery`; `WowyTeamStintOption.verifiedTradeDates: false` |
| Sample floors | <2 / <8 games per side → insufficient / low_support | `lib/wowy/policy.ts` |
| ET-date cutoff | Prior must be before tip **and** earlier America/New_York date | `lib/wowy/cutoff.ts`; model path `lib/wowy/model-adapter.ts` `summarizeWowyBeforeCutoff` |
| Pregame availability | Not an input to WOWY v1. Default scenario `unknown` | `lib/wowy/model-adapter.ts` `WOWY_SCENARIO_UNKNOWN` |
| Tests | 10 files under `lib/wowy/__tests__/` plus this experiment’s `candidate-features.test.ts` | — |
| Coverage report | No dedicated coverage file; notes on every `WowyPairSummary` | `lib/wowy/aggregate.ts` `WowyCoverageNotes` |
| Box seasons | 2023–2025 only | product contract `reports/product/game-level-wowy-v1.md` |

Certified historical example (reconstructed DNP, not pregame): Jokić with/without Murray 2024 DEN regular, 58 / 12 games, 28.4 / 35.3 PTS (`reports/product/game-level-wowy-v1.md`).

## 2. Two uses

| Use | Question | Allowed evidence |
| --- | --- | --- |
| Historical scenario | What happened to A in previous games B missed? | Prior-game `"00"` DNP, labeled `reconstructed_historical` |
| Pregame prediction | Using information available before this game, what should we predict for A? | Timestamped availability strictly before cutoff |

`buildWowyCandidateFeatures` never reads the target box to pick with vs without. Tests mutate target outcomes and realized teammate participation and assert features + scenario are unchanged.

## 3. Candidate features

`lib/wowy/candidate-features.ts` + `lib/wowy/availability-gate.ts`.

- Teammates ranked by **prior minutes on this stint**, not by historical WOWY gap.
- Primary only for diffs (`primary_teammate_only`). Secondaries set `wowy_overlap_flag`; diffs are not summed.
- Allowlist: with/without minutes, FGA/3PA/FTA/PTS/REB/AST, per-minute rates, diffs, games/minutes, recency, unknown/excluded counts, support flags, scenario flags.
- Insufficient support → diffs **null**, not zero.
- Unknown availability → `wowy_scenario_without` null, `predictive_eligible` 0.

## 4. Availability (corrected)

Inspected `analytics.player_injury_status_history` (read-only):

- 2023 / 2024: **0** rows.
- 2025: **4,801** rows, 2026-03-10 → 2026-05-06. No `Available` status. `game_id` column absent; unique team-ET Final join has **0** collisions.
- Conservative known-Out player-game audit: **399** eligible (`known-out-subset.json`). Exclusions include stale 2,300, only post-cutoff obs 1,959, no pre-cutoff obs 1,378, non-Out latest status 837, insufficient WOWY 126.
- 315/322 is not the usable subset.

Verdict: `exploratory_known_out_only_not_trained`.

## 5. Experiment registration

Spec written **before** training (`experiment-spec.md`): hypothesis, allowlist, dates, eligibility, 6-config budget (seed 20260914, not run), matched ablation, pre-specified slices.

Model Lab: `wowy-r1` in `lib/model-lab/registry.ts`, adapter `lib/model-lab/adapters/wowy-r1.ts`, notes `reports/modeling/model-lab/notes/wowy-r1.md`. Status **partial**. Metrics empty. Decision **exploratory known-Out subset; not trained**. Adapter tests passed; the Model Lab page was not opened in a browser.

Hypothetical outputs in `hypothetical-scenarios.json` are labeled and not scored.

## 6. What remains untested

- Whether WOWY features improve PTS or REB MAE vs frozen C on identical predictive-eligible rows.
- WITH (teammate available) as an observed_pregame choice.
- Overlapping absences beyond the bounded primary-teammate flag.
- Possession / shared-court WOWY (out of scope; game-level only).

## 7. Next step

Do **not** unpause shadow scoring. Optional later research: train the 399-row known-Out matched ablation as development evidence. Independent ops: injuries-only collection if `/nba/v1/player_injuries` is entitled (`prospective-integration.md`). Do not require the provider to emit Available. Coordinate `/parlay-xray` compile failures with that feature’s owner.
