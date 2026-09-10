# Market Movement v1 — Historical Backfill (Step 11C)

Generated: 2026-09-09  
Status: **certified historical serving rows populated. No API/UI. No live/current.**

**Step verdict:** `GREEN — historical Market Movement serving data is certified and ready for API integration`

Do not start Step 11D until this report is reviewed.

---

## Safety / Scope

| Guardrail | Status |
| --- | --- |
| BDL HTTP | **0** |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Production ingestion | Frozen |
| S3 | Read existing opening archives only (no acquisition) |
| Source tables | Read-only (`sourceImmutable: true`) |
| 11B unit tests | Passed before execute |
| Serving tables existed | Yes |
| Serving counts before first execute | **0 / 0** |
| Props Explorer UI | Unchanged |
| API contracts | Unchanged |
| Live/current rows | **0** |
| Extra serving tables | None |
| Math/thresholds | Unchanged (`lib/betting/market-movement.ts`) |

Postgres bytes **before first execute:** `342,912,147` (327.03 MB).  
(11B empty-table DDL had already moved this slightly above the 11A/7E pin of `342,846,611`.)

---

## Source Certification

### Player reference (S3 3-Hour Pre-Tip)

| Metric | Actual | Expected |
| --- | ---: | ---: |
| Game objects | 129 | 129 |
| Opening rows | 44,127 | 44,127 |

Prefix: `raw/source=balldontlie/league=nba/season=2025/entity=opening_player_props`  
Not used: `player_prop_lines`, `player_prop_movement_summary`, current props.

### Player comparison (decision_close)

| Metric | Actual | Expected |
| --- | ---: | ---: |
| `research.prop_decision_lines` | 94,086 | 94,086 |
| Distinct games | 129 | 129 |

Join: `game_id + player_id + lower(vendor) + canonical prop` into PDL over/under slots (Step 7E).

### Game reference (S3 Opening Snapshot)

| Metric | Actual | Expected |
| --- | ---: | ---: |
| Game objects | 107 | 107 |
| Opening rows | 1,179 | 1,179 |
| Sportsbook opening | 965 | 965 |
| Prediction-market opening | 214 | 214 |

Prefix: `.../entity=opening_game_odds/window=2026-03-09_to_2026-03-22`  
Characterization prefixes skipped.

### Game comparison (last_pre_tip_history)

`DISTINCT ON (game_id, lower(vendor))` from `analytics.game_odds_history` where `snapshot_at <= games.start_time`, latest snapshot. Same 7E rule.

---

## Dry-Run Candidate Counts

`joinOk: true` — INSERT proceeded only after this gate.

| Player funnel | n |
| --- | ---: |
| Opening rows read | 44,127 |
| v1 books | 34,900 |
| v1 props | 33,169 |
| v1 books ∩ v1 props | 24,955 |
| Ambiguous groups / rows (all books) | 1,827 / 5,024 |
| v1-book ambiguous groups / rows | **0 / 0** |
| Unmapped (non-canonical) opening | 6,168 |
| 4-book × all canonical matches (7E universe) | **24,412** |
| v1 allowlist matches (insert set) | **21,132** |
| Unmatched v1 identities (opening, no close) | 3,823 |

| Game funnel | n |
| --- | ---: |
| Sportsbook opening | **965** |
| Deterministic matches | **945** |
| Unmatched | **20** (all `rebet`) |
| Match rate | **97.9%** |
| Prediction markets (not inserted) | 214 |

**24,412 vs 21,132:** 7E product-grade included blocks (1,248) + steals (365) + rebounds_assists (1,667) = 3,280 rows that the approved v1 allowlist excludes. 24,412 − 3,280 = **21,132**. The join is certified; the insert set is the narrower product allowlist. Counts were not forced.

---

## Player Backfill Result

`analytics.player_prop_market_movement` = **21,132**

- Distinct games: **121** (8 of 129 archive games have no v1-allowlist Open→Close match)
- `reference_kind = 3_hour_pre_tip` on every row
- `comparison_kind = decision_close` on every row
- `live_current` = 0
- `player_name` is null on all rows (opening archive objects do not carry a parseable name; join `analytics.players` in 11D)

---

## Player Counts by Vendor

| Vendor | n |
| --- | ---: |
| BetMGM | 6,856 |
| FanDuel | 6,466 |
| DraftKings | 4,184 |
| Caesars | 3,626 |
| **Total** | **21,132** |

---

## Player Counts by Prop

| Prop | n |
| --- | ---: |
| points | 4,716 |
| rebounds | 4,180 |
| threes | 3,397 |
| assists | 2,777 |
| points_rebounds_assists | 2,237 |
| points_rebounds | 2,116 |
| points_assists | 1,709 |
| **Total** | **21,132** |

Matches the 7E taxonomy `n` for these seven markets exactly.

---

## Movement Distribution

| Class | n | % of 21,132 |
| --- | ---: | ---: |
| A Quiet | 14,195 | 67.2 |
| B Juice | 3,612 | 17.1 |
| C Line | 759 | 3.6 |
| D Line+Price | 2,566 | 12.1 |
| unclassified | 0 | 0 |

These A–D counts equal 7E’s seven-market slice (7E overall 16,652/4,171/776/2,813 minus blocks+steals+RA).

---

## Meaningful Movement Rate

**32.8%** = (B+C+D) / 21,132 = 6,937 / 21,132

7E headline **31.8%** was on the 24,412 universe that included low-movement blocks/steals. The v1 allowlist rate is slightly higher, as expected. Threshold unchanged: **≥ 0.02 implied probability**.

---

## Game-Odds Backfill Result

`analytics.game_odds_market_movement` = **945**

| Metric | n |
| --- | ---: |
| Distinct games | **107** |
| Distinct vendors | 10 |
| Certified window rows | 945 / 945 (`2026-03-09`–`2026-03-22`) |
| Unmatched Rebet (not inserted) | 20 |
| `live_current` | 0 |

Vendors are traditional sportsbooks (including Betway). Polymarket/Kalshi were not inserted.

---

## Game Market Coverage

| Field present on comparison | n / 945 |
| --- | ---: |
| Spread | 945 |
| Total | 837 |
| Home ML | 859 |
| Away ML | 859 |

Missing totals/MLs stay null. Not coerced to 0. ML movement stored as implied-probability delta only.

---

## Identity Audit

Foreign keys were **not** added.

| Check | Mapped | Unmapped |
| --- | ---: | ---: |
| Player serving `game_id` → `analytics.games` | 121 | **0** |
| Player serving `player_id` → `analytics.players` | 274 | **0** |
| Game serving `game_id` → `analytics.games` | 107 | **0** |

**Recommendation:** Step 11D (or immediately after API wiring) **may add FKs**. All current serving IDs join. Do not add them blindly to the S3 archive itself — 8 opening-archive games simply have no v1 serving row.

---

## Consensus Coverage

Read-time `playerPropConsensus` on comparison lines. **No consensus table.**

Unique `game + player + prop` markets: **8,340**

| Eligible books | Markets |
| --- | ---: |
| 1 | 2,054 |
| 2 | 2,542 |
| 3 | 982 |
| 4 | 2,762 |
| **Consensus-eligible (≥2)** | **6,286** |

7E’s **7,029** included rebounds_assists (and other non-v1 canonicals) in the four-book multi-book universe. 6,286 is the v1 allowlist recompute. Not forced.

---

## Consensus Sample Verification

Market `18447934|132|points_assists`:

| Book | Comparison line |
| --- | ---: |
| BetMGM | 39.5 |
| FanDuel | 38.5 |

- median **39.0** (interpolating even-n)
- min 38.5 / max 39.5 / count 2

**39.0 consensus does not imply a sportsbook offered 39.0.**  
Same rule as **25.5 + 26.5 → 26.0**.

One-book markets (2,054) return `available: false` — not substituted as consensus.

---

## Source-to-Serving Reconciliation

Quiet sample `fanduel` / player `1028037477` / `points_assists` / game `18447934`:

| Field | Serving | PDL |
| --- | --- | --- |
| comparison line | 15.5 | 15.5 both sides |
| comparison over / under | −104 / −128 | −104 / −128 |
| decision_at | 2026-04-03T01:00:35.436Z | 2026-04-03 01:00:35.436+00 |
| line delta | 0 | — |
| class | A | juice &lt; 2pp |

Juice / Line+Price samples for the same player on BetMGM match PDL close lines/odds (assists 2.5 −160/120; PRA 18.5 +100/−135).

Outlier game `18447469` preserved raw prints (DK spread Δ **+16**, BetMGM **+18**, Rebet **−18**) with 7E classifications. Not normalized away.

---

## Ambiguity / Exclusion Result

- Ambiguous simultaneous groups in the full opening archive: **1,827 groups / 5,024 rows** (BetRivers-dominated, as in 7E)
- **v1 books: 0 ambiguous groups**
- Excluded from serving: unsupported vendors/props, ambiguous groups, unmatched comparison, prediction markets, Rebet closing gaps
- Missing values remain null (never 0)

---

## Known Outliers

Inserted (not deleted), `outlier_class` set:

| game_id | vendor | class |
| --- | --- | --- |
| 18447469 | draftkings | suspicious_opening_snapshot |
| 18447469 | betmgm | suspicious_opening_snapshot |
| 18447469 | rebet | suspicious_vendor_move_vs_consensus |
| 18447808 | draftkings | aligned_with_cross_book_consensus |
| 18447845 | fanatics | suspicious_opening_snapshot |

Matches 7E’s five-row outlier list. Display/consensus filtering stays an API concern.

---

## Idempotency Verification

Second `--execute`:

- Same candidate counts
- UPSERT 21,132 + 945
- Serving row counts unchanged: **21,132 / 945**
- No duplicate PK rows
- Source checksums unchanged

Note: a full-table `ON CONFLICT DO UPDATE` rewrite created dead tuples (~2× `pg_total_relation_size` until VACUUM FULL). Values did not duplicate. Future recertification should skip unchanged rows.

---

## Postgres Storage Delta

Measured on **first insert** (compact, matches 11A 4–8 MB / &lt;0.5 MB):

| | Bytes | MB |
| --- | ---: | ---: |
| DB before | 342,912,147 | 327.03 |
| DB after first insert | 349,637,779 | 333.44 |
| **Delta** | **6,725,632** | **6.414** |
| Player table+indexes | 6,397,952 | 6.10 |
| Game table+indexes | 368,640 | 0.35 |

S3 remains raw/deep. Postgres holds compact serving only.

---

## Source Immutability

| Object | Before | After |
| --- | ---: | ---: |
| `research.prop_decision_lines` | 94,086 (odds sum −6,124,607) | identical |
| `analytics.game_odds_history` | 63,380 | 63,380 |
| `analytics.player_prop_current` | 25,812 | 25,812 |
| `analytics.player_prop_movement_summary` | 1,611 | 1,611 |
| `analytics.game_line_movement_summary` | 334 | 334 |

---

## Tests Added

`lib/betting/__tests__/market-movement-backfill.test.ts`

- Opening + close → serving row (kinds, deltas, class D)
- Quiet / Juice / Line classification
- Unsupported vendor excluded
- Unsupported prop excluded (blocks recognized but not v1)
- Ambiguous group excluded
- Missing comparison unmatched
- Idempotent rebuild
- Rebet unmatched does not manufacture close
- Prediction markets not inserted
- Outliers kept
- Certified window constants / characterization keys skipped

---

## Test Results

```
npx vitest run lib/betting/__tests__/market-movement.test.ts \
  lib/betting/__tests__/market-movement-schema.test.ts \
  lib/betting/__tests__/market-movement-backfill.test.ts

Test Files  3 passed (3)
     Tests  47 passed (47)
```

---

## Files Changed

- `lib/betting/market-movement-backfill.ts` — 7E match + serving builders
- `lib/betting/__tests__/market-movement-backfill.test.ts`
- `scripts/backfill-market-movement-v1.ts` — `--dry-run` / `--execute` / `--certify`
- `reports/product/market-movement-v1-historical-backfill.md`
- `reports/product/market-movement-v1-historical-backfill.json`

Not changed: Props Explorer UI, `/api/betting/props-explorer/market`, market-math thresholds, research/history/current tables, live_current.

---

## Risks / Open Questions

1. **`player_name` is unused** — opening JSON did not parse a name. 11D should join `analytics.players.full_name`.
2. **8 / 129 archive games** have no v1 serving row (allowlist ∩ close). Do not treat as missing FK.
3. **Consensus 6,286 vs 7E 7,029** — allowlist, not a join bug.
4. **Full UPSERT rewrite bloat** — second execute left dead tuples. Prefer change-detection next time.
5. **Explorer movement is still first/last snapshot** — still misleading if read as 3-Hour Pre-Tip. Replace in 11D/11E, not by adding a second widget.

---

## Recommendation for Step 11D

1. Extend `GET /api/betting/props-explorer/market` to read `analytics.player_prop_market_movement` (do not relabel `player_prop_lines` movement).
2. Return consensus at read time: median + min/max + book count; never imply the median was offered.
3. Copy: **3-Hour Pre-Tip → Decision Close**, never “open” / “first print”.
4. Optional: add FKs (audit is clean) and player display names via `analytics.players`.
5. Game-odds serving is certified for a later surface; not required for first Explorer wiring.
6. Do not activate `live_current`.

---

## Verification Checklist

1. Confirm Explorer UI/API files have no 11C diff.
2. `select count(*) from analytics.player_prop_market_movement` = 21132.
3. `select count(*) from analytics.game_odds_market_movement` = 945.
4. No `live_current` rows.
5. Do not serve `player_prop_movement_summary` as 3-Hour Pre-Tip.
6. Re-run the three vitest files after math/backfill edits.
7. Future API: interpolating median is not necessarily an offered line.

---

## Step Verdict

`GREEN — historical Market Movement serving data is certified and ready for API integration`

**STOP.** Do not automatically start API integration.
