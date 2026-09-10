# Targeted Season Averages archive (Step 9C)

Generated: 2026-09-09T15:51:50Z (certify pass; HTTP completed 15:36:38Z)

**Archive verdict:** `HIGH_VALUE_TARGET_ARCHIVE_COMPLETE`

**Step verdict:** GREEN — targeted Season Averages archive complete and product-useful

Do NOT start Plays. Do NOT start 2022.

Machine-readable: `reports/trial/season-averages-targeted-archive-report.json`

---

## Safety State

All gates matched. No stop.

| Check | Observed |
| --- | --- |
| `BDL_TRIAL_MODE` | `1` |
| Delay / min / concurrency | 13,000 ms / ≥12,000 / 1 |
| Lock | acquired for HTTP; released after |
| Freeze | `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`, pin `2025` |
| Postgres | 342,846,611 bytes / 326.96 MB before and after |
| Serving tables | none created |
| Writes | canonical S3 + local reports only |

## Archive Allowlist

From Step 9B **characterized** unique signals only. Untested estimate types were not added.

**Player:** playtype isolation, prballhandler, prrollman · tracking drives, passing · shooting by_zone

**Team:** playtype isolation · tracking possessions · shooting by_zone_opponent

**Excluded:** general/advanced, shotdashboard, hustle, clutch, defense, spotup/transition, catchshoot/pullupshot, player possessions, team by_zone_base, extra team playtypes, 2022

## Player / Team Targets

From certified local logs / games. Identity = BDL provider IDs. Full ID lists are in the JSON `targets` object.

| Season | Player IDs | Team IDs |
| --- | --- | --- |
| 2023 | 595 | 30 |
| 2024 | 587 | 30 |
| 2025 | 603 | 30 |

## Dry-Run Estimate

123 jobs (player batches of ≤100 + one 30-team batch per team combo). Projected **26.7 min** / 123 HTTP. Under the 90-minute cap.

Below the Step 9B 189 HTTP / 41 min estimate because untested types were excluded.

## Acquisition Result

| Metric | Value |
| --- | --- |
| Planned HTTP | 123 |
| Actual HTTP | **126** (3 extra pages) |
| Pages archived | 126 (117 player + 9 team) |
| 429s / retries | 0 / 0 |
| Wall clock | ~28.4 min |
| Spacing | ~13.5 s |

First execute wrote all pages, then crashed on a report-only `nullIdentity` bug. Certify re-run skipped every object (**0 additional BDL HTTP**) and wrote reports.

## Record Grain

Verified:

- Player `(season, season_type, player_id, category, type)`
- Team `(season, season_type, team_id, category, type)`
- Duplicates **0** · null identity **0** · null stats **0**
- Pagination complete on every combo (max 2 pages/batch; cap was 3)

## Player Coverage

Tracking and by_zone return almost every log player. Play-type rows are **qualifying players for that Synergy type**, not the full log universe.

| Combo | 2023 | 2024 | 2025 |
| --- | --- | --- | --- |
| playtype / isolation | 39.3% (234/595) | 44.5% (261/587) | 44.3% |
| playtype / prballhandler | 47.4% | 52.5% | 52.9% |
| playtype / prrollman | 40.3% | 46.0% | 44.4% |
| tracking / drives | 96.1% | 96.9% | 96.5% |
| tracking / passing | 96.1% | 96.9% | 96.5% |
| shooting / by_zone | 96.1% | 96.9% | 96.5% |

Missing play-type IDs are **not** just cup-of-coffee players (sampled missing median log GP ~52–61). They simply did not qualify for that play type. Tracking/zone misses cluster in the remaining ~4%.

## Team Coverage

**100%** for all 9 team combos (30/30 every season × isolation, possessions, by_zone_opponent).

## Historical Schema Consistency

2023 vs 2024 vs 2025: **identical field sets** for every archived category/type. No fields added or dropped. Coverage similar year over year.

2023 is compatible with 2024/2025.

## Play-Type Certification

Fields present on player and team isolation/BH/roll: `poss`, `poss_pct`, `ppp`, `pts`, `percentile`, `score_poss_pct`, `fg_pct`, `efg_pct`, `gp`, plus FT/and-one/turnover possession rates.

No always-zero fields on player play types. `gp` remains qualifying games, not season GP.

## Tracking Certification

Drives and passing populated; no always-zero fields. ~96% of log players. Team possessions 100% of teams. Schema stable 2023–2025. Season grain only — not in-season role change.

## Zone-Shooting Certification

Player `by_zone` has restricted area, paint (non-RA), mid-range, corner 3, above-the-break 3 (~96% players).

Team `by_zone_opponent` has the matching `*_opp_*` fields, 30/30 teams. Always-zero: `backcourt_opp_fgm` (unused). Suitable as a **descriptive matchup-profile input**. No matchup score was built.

## S3 Certification

Canonical (not `_characterization`):

- `raw/source=balldontlie/league=nba/entity=season_averages/season={year}/season_type=regular/category=.../type=.../batch=NN/page=P.json`
- `raw/source=balldontlie/league=nba/entity=team_season_averages/...` (same shape)

Manifests state this is a **targeted high-value archive**, not a complete BDL dump:

- `.../entity=season_averages/_manifest.json`
- `.../entity=team_season_averages/_manifest.json`

## Product Limitations

- Season grain cannot describe role on one game/date
- Opportunity Check cannot detect post-injury role change from this dataset alone
- general/advanced intentionally excluded
- Untested shot dashboards / play types remain absent
- Play-type `gp` is not season GP
- Play-type coverage is qualifying players (~40–53%), not the full log list

## Product-Readiness Assessment

| Surface | Readiness |
| --- | --- |
| Role Profile | Strong season-level enrichment (play types + drives/passing + zones) |
| Matchup Profile | Useful (team isolation + possessions + opponent zone). No score built |
| Historical Explorer | Useful for the archived allowlist across 2023–2025 |
| Opportunity Check | Still limited (season grain) |
| Market + Context | Later only |

## S3 Size

| | Objects | Bytes |
| --- | --- | --- |
| Player | 117 | 8,910,592 |
| Team | 9 | 294,379 |
| **Total** | **126 pages / 7,888 records** | **9,204,971 (8.78 MB)** |

Under the ~12 MB Step 9B estimate because untested types were not archived.

## Trial Time Remaining

Elapsed ~27.5 h. Remaining ~20.5 h. Protected reserve 6 h. Usable ~14.5 h.

## Postgres Unchanged Confirmation

**342,846,611 bytes / 326.96 MB → unchanged.** No Season Average / Advanced / lineup serving tables.

## Archive Verdict

`HIGH_VALUE_TARGET_ARCHIVE_COMPLETE`

## Step Verdict

GREEN — targeted Season Averages archive complete and product-useful
