# Historical Explorer v2 — Step 12E Advanced UI

**Step verdict:** `GREEN — Historical Explorer Advanced game context is ship-ready and ready for Role Profile work`

**Product classification:** `SHIP_READY`

**Date:** 2026-09-10  
**Scope:** presentation only. No DB writes, no migrations, no backfill, no S3, no new API route, no Role Profile, no Timeline, no Market Movement / Starting Five changes.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| BDL HTTP | **0** (Final still skips matchup-analysis / live lineups) |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Database writes | none |
| Migrations / Advanced backfill | none |
| S3 reads for UI | none — uses attached `player.advanced` |
| API expansion | none |
| Role / Season Averages / Plays | none |
| Market Movement / Starting Five | unchanged |
| Live-game Advanced | not added |

---

## Existing Player UI Audit

Authenticated `/betting/games/:id` Final (browser, 2025 SAS @ LAC):

- Sticky header: date, Final, season, scores
- Section nav: Starting Five · Box score · Lines
- Starting Five 5+5 above players
- Box score: away left / home right tables, player links, MIN/PTS/REB/AST/STL/BLK
- Desktop: two-column tables; extra columns already used `overflow-x-auto`
- Mobile: stacked `grid-cols-1`
- Box Score was the only player view; no existing Advanced toggle
- Lines section already used Radix tabs (Spread / Total)

12E reuses that tab convention for **Box Score | Advanced**.

---

## Advanced Presentation Architecture

`availability.advanced === true` (contract, not season) shows a Players section with:

- Heading **Players**
- Copy: **This game — Box Score or Advanced. Not season role.**
- Radix tabs: Box Score (default) · Advanced
- Same away/home grouping and player order as the box
- Desktop: compact primary table (MIN, USG%, TS%, eFG%, ORtg, DRtg, Net) + **More**
- Mobile (~390px): per-player cards, 3×2 metric grid, MIN · poss in the header

No second giant table under the box. Switch is local React state — **no extra fetch**.

---

## Box / Advanced Interaction

- Default: **Box Score** selected
- Advanced is optional
- Toggle does not leave the page or change player-link semantics
- When `availability.advanced` is false (2026 live): original **Box score** heading only; no Advanced tab

---

## Metric Hierarchy

**Primary:** USG% · TS% · eFG% · ORtg · DRtg · Net  
**Secondary (More):** AST% · REB% · TOV Ratio · PIE · Poss · Pace  

Pace is not a headline metric.

---

## Metric Formatting

Shared `lib/betting/historical-advanced-format.ts`:

| Input | Display |
| --- | --- |
| `0.284` | **28.4%** |
| `1.5` | **150.0%** (not clamped) |
| Net `18.7` / `-5.2` | **+18.7** / **-5.2** |
| `null` / NaN / all-null row | **—** |
| Turnover `5.3` | **5.3** (not a percent) |
| Possessions | integer |
| Pace / ratings | 1 decimal |

Zeros are real archived values (`0.0%` / `0.0`), distinct from missing **—**.

---

## Low-Sample Handling

No minutes/possessions eligibility cutoff. No “invalid” badge.

Minutes stay visible; possessions shown on mobile headers and in More. Tiny samples (Pritchard 1 MIN / 3 poss / **150.0% TS**) remain raw.

Decision: existing UI had no subdued sample-size badge; exposing MIN + Poss is enough for v1.

---

## Null Handling

~75–76% PGL coverage. Players without Advanced stay on the roster with **—**. Wembanyama / Omier on 2025 Final verified. All-null serving rows format as **—**, not a row of zeros.

---

## Metric Definitions

`<abbr title>` plus `aria-label` with full name + one-line help. Copy is explicitly **this game**, not season role.

---

## 2023 Verification

`15905067` DAL 88 @ BOS 106, season **2023–24**

- Advanced available
- **No Starting Five**
- Box default; Advanced toggle works
- Tatum: **28.4% USG**, 56.3% TS, 47.9% eFG, ORtg 122.4, Net **+18.7**
- Pritchard: **150.0% TS / eFG** on 1 MIN / 3 poss
- No BDL lineup path

---

## 2024 Verification

Same Final fixture as 12B/12D (`15905067` is the certified 2023-season Finals game dated 2024-06-17). UI path is identical to other non-starter Finals. Contract tests cover `18444564` availability true.

---

## 2025 Verification

`18447937` SAS 118 @ LAC 99

- Starting Five **5+5** remains above Players
- Box Score intact
- Kawhi: **20.8% USG**, **75.0% TS**, ORtg 105.9, DRtg 115.4, Net **-9.5**
- Null Advanced (Wembanyama) → **—**
- Advanced complements Starting Five; does not replace it

---

## 2026 / Live Regression

`21717855` Scheduled

- Live header, AI Projection, **Projected starters**
- `availability.advanced` false
- No “This game — Advanced” copy or historical Advanced tab

---

## Responsive QA

| Viewport | Result |
| --- | --- |
| Desktop | Two-team tables, 6 primary metrics, More for secondary |
| ~390px | Stacked cards, 3×2 grid, no 12-column horizontal scroll |

---

## Accessibility

- Tablist: Box Score / Advanced with selected state
- Metric abbreviations have accessible names + help
- Net is signed text, not color-only
- Missing values are **—**
- More/Less uses `aria-expanded`
- Player links unchanged

---

## Tests Added

- `lib/betting/__tests__/historical-advanced-format.test.ts` — 0.284→28.4%, 1.5→150.0%, signed net, null/NaN, TOV not %, all-null vs zero
- `lib/betting/__tests__/historical-advanced-ui.test.ts` — box default, contract availability, 2026 false, null player remains, Advanced-only Len not added, team grouping

---

## Test Results

- 12E format + UI + details Final: **3 files, 19 passed**
- Regression (historical Final / seasons / Starting Five UI / no-live-BDL Final / slate / Market Movement): **9 files, 65 passed**
- Combined unique suites above: **all green**

---

## Browser Verification

Exercised Box default → Advanced switch, Tatum 28.4%, Pritchard 150%, Kawhi + Starting Five, Wembanyama dashes, 2026 live unchanged, mobile cards + More (TOV Ratio 18.4 not percent).

An unrelated Next.js overlay (`BettingInsights` export on `/betting`) appeared during QA; it is **not** caused by 12E and was dismissed to inspect the game page.

---

## Files Changed

**Added**

- `lib/betting/historical-advanced-format.ts`
- `components/betting/HistoricalFinalAdvancedStats.tsx`
- `lib/betting/__tests__/historical-advanced-format.test.ts`
- `lib/betting/__tests__/historical-advanced-ui.test.ts`

**Modified**

- `lib/betting/historical-advanced.ts` — `shouldShowHistoricalAdvanced`, default view constants
- `components/betting/HistoricalFinalBoxScore.tsx` — Box / Advanced switch
- `components/betting/MatchupPageLayout.tsx` — pass `availability`; nav label Players when Advanced is on
- `lib/betting/__tests__/details-final-mode.test.ts`

---

## Remaining Follow-Ups

- Optional later: subdued low-sample cue if a Court Context badge pattern appears
- Dashboard `BettingInsights` export overlay is a separate bug
- Role Profile (12F) is still unstarted

---

## Product Classification

**SHIP_READY** — clear game-level Advanced across 2023–2025 Finals; 2026 live untouched.

---

## Recommendation for Step 12F

Start **season Role Profile** as a separate Context module. Do not fold isolation / PnR / zone into this Box | Advanced switch. Keep Advanced labeled **this game**.

**STOP. Do not start 12F in this step.**

---

## Verification Checklist

1. `/betting/games/15905067` opens on Box Score; Advanced shows Tatum **28.4%** USG.
2. Same game: no Starting Five; Pritchard TS **150.0%**.
3. `/betting/games/18447937` Starting Five 5+5 + Advanced Kawhi **20.8%** USG.
4. `/betting/games/21717855` has Projected Starters and **no** historical Advanced tab.
5. Mobile ~390px: cards, not a 12-column spreadsheet.
6. Players with `advanced: null` still listed with **—**.
7. Market Movement / date nav / Final scores unchanged.

---

## Step Verdict

**GREEN — Historical Explorer Advanced game context is ship-ready and ready for Role Profile work**
