# Official NBA injury reports — path to an as-of tape

Date: **2026-09-16**  
Status: **recommendation + remaining findings**  
Scope: how to get a usable pregame injury tape for WOWY. No collector, schema, Terraform, or BDL thaw in this slice.

Evidence: live HEAD/GET of `ak-static.cms.nba.com/referee/injury/` PDFs, text/layout extracts in `tmp/injury-report-samples/`, WOWY r1 gates, BDL injuries 401 probe, existing `raw.player_injuries` (Mar–May 2026 only).

---

## Decision

**Use the NBA Official Injury Report PDFs as the historical and prospective source.** Do not wait on BallDontLie `/player_injuries`, and do not treat the current BDL board as an as-of archive.

Proceed in this order: **existence inventory → raw PDF archive → parser certification → identity/game join → WOWY as-of reconstruction.** Stop after any phase that fails its gate. Do not wire `/wowy`, Model Lab, or live UI until join + as-of reconstruction are certified.

BDL injuries stay a separate live-board question (currently HTTP 401). Unlocking them does not replace this tape.

---

## What we already know

### Product need

Shipped `/wowy` is game-level played vs `"00"` DNP. It does not use injuries.

Injury-conditioned WOWY (`WOWY_ADVANCED`, known-Out r1) needs a timestamped observation **strictly before T−60**, not older than **48 hours**, with explicit **Out** (WITHOUT) and, if we ever certify WITH, explicit **Available**. Questionable / Doubtful / Probable stay unknown. Missing row ≠ healthy. Box-score DNP is not a pregame observation.

Current injury history cannot do that:

| Season | Injury tape | Problem |
| --- | --- | --- |
| 2023–24 | none | three-season eval closed |
| 2024–25 | none | same |
| 2025–26 | 2026-03-10 → 2026-05-06 BDL only | fetch time, no `game_id`, no `Available`, N=625 known-Out, inconclusive |
| Live | collection off | BDL 401 on 2026-09-16 |

Target window that overlaps WOWY box logs:

**2023-10-23 → 2026-06-14** (day before 2023–24 opening night through 2025–26 Finals). Not 2021–22 / 2022–23 (no Court Context WOWY PGL). Not preseason.

### Source

Public PDFs:

`https://ak-static.cms.nba.com/referee/injury/Injury-Report_{YYYY-MM-DD}_{time}.pdf`

| When | Filename time token | Example |
| --- | --- | --- |
| Through ~2025-12-19 | hourly `HHAM` / `HHPM` | `Injury-Report_2025-12-06_05PM.pdf` |
| From ~2025-12-22 | 15-minute `HH_MMAM` / `HH_MMPM` | `Injury-Report_2026-03-18_05_30PM.pdf` |

The file hour is **30 minutes behind the title**. `11AM` is the 11:30 AM report. 2026 hourly `05PM` returns **403**; `05_30PM` returns **200**.

### Fields on the page

Seven columns, stable across 2023 opening night, 2024 opening night, 2025-12-06, 2026-03-18, 2026-04-08:

| Column | Example | Role |
| --- | --- | --- |
| Game Date | `12/06/2025` | game join |
| Game Time | `07:00 (ET)` | tip → T−60 |
| Matchup | `NOP@BKN` | game join via `analytics.teams.abbreviation` |
| Team | `New Orleans Pelicans` | team-night |
| Player Name | `Dickinson, Hunter` | **no player id** |
| Current Status | `Out`, `Questionable`, `Doubtful`, `Probable`, `Available` | WOWY scenario |
| Reason | `Injury/Illness - Right Calf; Strain` | keep raw |

Non-player rows that must not be coerced into a status: **`NOT YET SUBMITTED`**. Other non-medical Out reasons seen: G League Two-Way / On Assignment, Rest, League Suspension, Concussion Protocol, Trade.

### Timestamps

**Report-level only.** Title `Injury Report: 12/06/25 05:30 PM` is `snapshot_at` for every row in that file. There is no per-player `updated_at`.

Game Time is tip, not filing time.

Same-day proof (2025-12-06):

| | 11:30 AM | 5:30 PM |
| --- | ---: | ---: |
| Yves Missi | Questionable | **Available** |
| Noah Clowney | Probable | **Available** |
| Herbert Jones | Out | Out |
| `NOT YET SUBMITTED` teams | 16 | 5 |
| `Available` rows | 0 | 10 |

`Available` appeared in 2024–26 samples; the 2023-10-24 5:30 PM sample had none. Do not assume WITH is certifiable for 2023–24.

### Parse reality

This is a **table PDF**, not an API. Naive text split is wrong (`Butler III, Jimmy` → `III,`; reasons wrap). Game Date / Time / Matchup / Team print only on the first row of a group and must be forward-filled. Layout extract can read a page bottom-to-top.

A production parser has to be certified against labeled pages, not “it extracted some names.”

---

## Best way to proceed

Archive first, like Owls. Normalize later. Do not write Postgres from the first successful parse.

### Phase 0 — freeze and isolation (now)

Keep production freeze. Do not enable `injuries-snapshot`, do not apply injury membership SQL for this source, do not retrain known-Out, do not change `/wowy` copy.

Treat BDL Mar–May 2026 as a **cross-check corpus**, not the backfill.

### Phase 1 — existence inventory (findings we still need)

**Goal:** know which snapshots exist before downloading tens of thousands of PDFs.

HEAD-only crawl of the target window with both filename families:

- Legacy hourly: `08AM`, `09AM`, `11AM`, `01PM`, `05PM`, plus any other hour that returns 200 on a probe day
- 15-minute from 2025-12-22: `:00` and `:30` of every hour 08–23 ET, then tighten

Output: one JSON per date (`exists` / `403` / other), byte size, which token worked.

**Gates**

- 2023-10-24, 2024-10-22, 2025-12-06, 2026-03-18, 2026-06-14 behave as already observed (or we document the exception).
- Count of 200s is finite and explainable (gaps on off days / All-Star are expected).
- Stop if the host rate-limits or ToS/robots make a full crawl unreasonable — then fall back to **filing-window only** (below).

**Finding this phase must answer:** how many files exist in 2023–10-23…2026-06-14? Hourly vs 15-minute density? Are late-night (8–10 PM) snapshots common enough that 5:30 PM is not always pre-T−60 for West Coast tips?

### Phase 2 — snapshot policy (do not ingest everything by default)

WOWY does not need every 15-minute file. It needs the **last complete report strictly before each game’s T−60**.

Minimum set per game:

1. Day-before ~5:00 p.m. **local** (league initial filing; store as ET wall + team local).
2. Game-day filing window (11:00–1:00 p.m. local, or 8:00–10:00 a.m. if tip ≤ 5:00 p.m.).
3. Last snapshot before T−60.

Practical archive rule after Phase 1:

- If 15-minute files are dense near tip, keep **all 200s** for those days (raw is small; PDFs were 70–90 KB). Storage is cheap; missing a 6:30 PM file for a 7:30 ET game is expensive.
- If most days only have 11:30 / 1:30 / 5:30, archive those plus any later 200.

Raw prefix (proposed, not created):

`raw/source=nba_official/league=nba/season={2023,2024,2025}/entity=injury_report_pdf/report_date=YYYY-MM-DD/report_time={token}/Injury-Report_….pdf`

Envelope JSON sibling: requested URL, HTTP status, `report_published_at` (from title or filename+30min rule), checksum, bytes, filename family (`hourly` | `15min`).

Empty/403 is a first-class result (`EMPTY_PROVIDER_HISTORY` equivalent). Do not skip dates.

### Phase 3 — parser certification (bounded, not a season job)

Build a parser **offline** on the already-downloaded samples plus 10–20 extra PDFs from Phase 2 (mix of 2023 / 2024 / 2025–26, 11AM vs 5PM, playoff date, a `NOT YET SUBMITTED`-heavy morning file).

Required outputs per player row:

```text
report_published_at   # from title, America/New_York
game_date             # ET calendar date of the game
game_time_et          # tip
matchup               # AWAY@HOME
team_name
player_name_raw       # Last, First as printed
status                # Out | Available | Questionable | Doubtful | Probable | (keep unknown strings)
reason_raw
row_kind              # player | team_not_yet_submitted
```

**Gates (all must pass on held-out pages)**

- Header row count = 7 named columns.
- Forward-fill does not leak Team A’s date onto Team B’s next game.
- Wrapped reasons concatenate; suffixes stay on the name (`Butler III, Jimmy`, `Porter Jr., Michael`).
- `NOT YET SUBMITTED` never becomes a player named “Submitted”.
- Status vocabulary on 2023 sample includes Probable, does not invent Available.
- 11AM vs 5PM 2025-12-06 still shows Missi Questionable → Available after parse.

Until those pass, do not write analytics tables.

### Phase 4 — identity and game join (the real remaining finding)

The PDF has no ids. Court Context already joins other name-only tapes (Owls props). Do the same, fail closed.

**Game join**

`matchup` + `game_date` + `game_time_et` → `analytics.games` via `analytics.teams.abbreviation` (AWAY@HOME). Ambiguous or missing Final row → drop with reason, do not unique-team-night guess if two games that night.

**Player join**

`player_name_raw` + `team_id` + `game_date` → `analytics.players` / `player_entity_id` / optional `provider='nba'` id, using the game’s PGL roster as the candidate set (not the whole league). Jr./III/II collisions and two-way names are the expected failures.

**Gates on a labeled week (e.g. 2025-12-06 slate + 2023-10-24 opening night)**

- Game-join rate on populated player rows.
- Unique player-entity rate; quarantine list for unresolved.
- Zero silent cross-team name matches.

If unique-match rate is too low for WOWY known-Out (need thousands of player-games across three seasons, 2,000-row nomination floor), stop and report — do not fuzzy-match the league.

### Phase 5 — as-of reconstruction vs WOWY gate

For each Final subject-game in 2023–2025:

1. Collect official rows for that team-night with `report_published_at < tip − 60m`.
2. Take the latest such report.
3. If that report is `NOT YET SUBMITTED` for the team → unknown.
4. Teammate listed `Out` / `Out For Season` → WITHOUT candidate.
5. Teammate listed `Available` → WITH candidate (2024–26 only; 2023 likely unknown).
6. Questionable / Doubtful / Probable / Rest / G League / missing → unknown.
7. Stale if latest pre-cutoff report is >48h old (should be rare if game-day files exist).

**Gates**

- No post-cutoff snapshot used (Missi 5:30 PM must not apply to a 5:00 ET tip that day).
- Coverage table: eligible WITHOUT counts by season vs the 399/625 BDL known-Out window.
- Overlap check vs BDL Mar–May 2026: same player-game Out should usually agree; disagreements are findings, not auto-BDL wins.

Only after this table exists is it worth re-running known-Out residual. Not before.

### Phase 6 — live 2026–27 (later)

After backfill is archived: poll new PDFs on the 15-minute pattern during game days, same envelope, same parser. Do not point the existing BDL Lambda at PDFs. New source = new worker.

Do not promise landing/hero “injuries” until a current-board view is served from this tape with honest freshness.

---

## Findings we still need (checklist)

Close these with probes, not intuition.

| ID | Question | How | Stop if |
| --- | --- | --- | --- |
| F1 | How many snapshot files exist in 2023-10-23…2026-06-14? | HEAD inventory | Host blocks / unbounded 15-min volume with no filing-window fallback |
| F2 | Which slots actually appear (11:30 / 17:30 vs all day)? | Same inventory | — |
| F3 | Is 5:30 PM always before T−60 for late West Coast tips? | Join inventory to `analytics.games.start_time` | If not, we must keep later snapshots |
| F4 | Parser accuracy on wrapped names/reasons | 15–20 labeled pages | Cannot beat a documented error budget |
| F5 | `Available` coverage by season | Parsed status counts | 2023 WITH stays closed (expected) |
| F6 | Game-join hit rate | Matchup × date vs Final games | Ambiguous nights not rare |
| F7 | Player-entity unique-match rate on PGL roster | Name + team + night | Mass quarantine |
| F8 | Official vs BDL Out agreement, Mar–May 2026 | Overlap audit | Systematic disagreement unexplained |
| F9 | `NOT YET SUBMITTED` rate at last pre-T−60 snapshot | Reconstruction | Too many games still NYS at cutoff |
| F10 | Legal/retention of bulk PDF archive | Compare to how we treat other public NBA static assets | Counsel says no archive |

F1–F3 before a full download. F4 before Postgres. F5–F9 before any model or `/wowy` injury copy. F10 in parallel with F1.

---

## What not to do

- Do not scrape ESPN / Rotowire / Twitter as the archive.
- Do not enable BDL injuries collection to “fill WOWY” (401, no as-of, no Available, no 2023–24).
- Do not infer Available from a player missing on a complete report.
- Do not use `"00"` DNP as pregame status.
- Do not keep only `analytics.player_injury_status_current` (latest board). That is the bug we already have.
- Do not start with a season-wide Java/`tabula` dependency in the Next app. Offline Python/Node probe is enough until F4 passes.
- Do not pull 2021–22 because the CDN has it.

---

## Suggested next slice (smallest)

One ops script, HEAD-only, three seasons, write `reports/operations/official-injury-report-existence-inventory.json` + a short MD of 200-counts by season and time token. No parser, no S3, no schema.

That is the next finding we do not have.

---

## Verification checklist

1. Re-open `tmp/injury-report-samples/Injury-Report_2025-12-06_11AM.pdf` vs `…_05PM.pdf` and confirm Missi / Clowney.
2. Confirm 2026 `05PM` 403 vs `05_30PM` 200.
3. Confirm PDF title is the only as-of clock.
4. Confirm WOWY box seasons are 2023–2025 only before expanding the date range.
5. Do not treat `tmp/injury-report-samples/` as a production feed; it is a probe cache.
6. Keep BDL 401 report as a live-board issue, independent of this path.
7. After Phase 1, compare file counts to a sanity range (hundreds to low thousands of PDFs, not millions) before Phase 2.
