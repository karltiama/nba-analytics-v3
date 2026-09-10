# Season Averages characterization (Step 9B)

Generated: 2026-09-09T13:51:50.168Z

**Archive recommendation:** `TARGETED_ARCHIVE_CONSIDER`

**Step verdict:** YELLOW — useful subset exists but broad archive is unnecessary

Do NOT start a full Season Averages archive. Do NOT start Plays. Do NOT start 2022.

Machine-readable: `reports/trial/season-averages-characterization.json`

---

## Safety State

All gates matched. No stop.

| Check | Observed |
| --- | --- |
| `BDL_TRIAL_MODE` | `1` |
| Delay / min / concurrency | 13,000 ms / ≥12,000 / 1 |
| Acquisition lock | free before; released after |
| `DATA_MODE` / offseason / cron | `replay` / `OFFSEASON_MODE=1` / `CRON_DRY_RUN=1` |
| Season pin | `2025` |
| Production | frozen |
| Postgres | 342,846,611 bytes / 326.96 MB before and after |
| GOAT serving tables | none (`analytics.bdl_season_averages`, advanced, lineups all missing) |
| Acquisition writes | characterization S3 + local reports only |

## Existing Implementation Audit

- No GOAT category/type Season Averages client existed.
- Legacy `scripts/seed-raw-balldontlie.ts` hits `/v1/season_averages?player_id=&season=` (box-score averages). Not this endpoint. Not reused.
- Reused: `BdlArchiveClient`, trial limiter, acquisition lock, `archiveJsonObjectToS3`.
- OpenAPI YAML is stale (`{type}` path). Live paths used:
  - Player `GET /nba/v1/season_averages/{category}`
  - Team `GET /nba/v1/team_season_averages/{category}`
- Hustle: no `type`. Other probed categories: `season` + `season_type` + `type`.
- Array filters: `player_ids[]` / `team_ids[]`.

## Characterization Plan

Frozen **16** probes. Printed in full before HTTP. Not expanded after results.

- Players (local IDs, no discovery HTTP): `175` SGA, `246` Jokic, `73` Brunson, `140` Durant, `3547249` Achiuwa
- Teams: `21` OKC, `8` DEN, `29` UTA, `3` BKN
- Seasons: 2025 regular (all probes) + 2024 regular (playtype isolation, tracking drives, shooting by_zone)
- 2023 not needed (2024 vs 2025 field names identical)
- Clutch / defense / Plays / 2022: not included

Projected: 16 HTTP, ~3.5 min. Cap: 2 pages/probe.

## Acquisition Result

| Metric | Value |
| --- | --- |
| Planned requests | 16 |
| HTTP attempts | 16 |
| Success | 16 |
| Pages | 16 (1 each) |
| 429s / retries | 0 / 0 |
| Wall clock | 202,263 ms (~3.4 min) |
| Spacing min / avg / max | 13,362 / 13,426 / 13,579 ms |
| Failed / stopped early | none |

Raw envelopes archived under non-canonical prefixes:

- `raw/source=balldontlie/league=nba/entity=season_averages/_characterization/`
- `raw/source=balldontlie/league=nba/entity=team_season_averages/_characterization/`

## Player Category Results

All 12 player probes: HTTP 200, 5/5 IDs, 100% coverage, 0 grain duplicates.

| ID | Category / type | Distinct product signal |
| --- | --- | --- |
| P01–P03 | playtype isolation / prballhandler / prrollman | **High.** Frequency, PPP, percentile, pts/poss. Roles separate cleanly. |
| P04–P05 | tracking drives / passing | **High.** Per-game drives, drive FG%, passes, potential_ast. |
| P06 | shooting by_zone | **High for profile.** Rim / paint / mid / corner / ATB per-game FGA+FG%. No `gp`. |
| P07 | shotdashboard overall | **Low.** 2pt vs 3pt mix already in logs. `fga_frequency=1`. Pullups / C&S not probed. |
| P08 | hustle | **Medium, not core.** Deflections, contested shots, screen assists. Games field is `g`. |
| P09 | general advanced | **Skip.** Season rollup of Advanced Stats (usg, eFG, TS, ORTG/DRTG, PIE, pace). |
| P10–P12 | 2024 isolation / drives / by_zone | Same field names as 2025. |

Play-type GP is **not** season GP: SGA playtype `gp=63` vs tracking/general `gp=68`.

## Team Category Results

All 4 team probes: 4/4 IDs, 100% coverage, 0 duplicates.

| ID | Category / type | Distinct product signal |
| --- | --- | --- |
| T01 | playtype isolation | **High for style.** OKC 9.7% isolation possessions, 100th percentile PPP vs BKN 5.9% / 0.379. Team isolation `gp` 77–80 vs 82 season games. |
| T02 | tracking possessions | **Medium.** Touches, paint/post/elbow, time of possession. Pace-ish but not opponent defense. |
| T03 | shooting by_zone_opponent | **High for matchup.** OKC holds opponents to 61.0% RA; UTA 72.9% RA. Per-game opponent FGA by zone. |
| T04 | general advanced | **Skip.** Team ORTG/DRTG/pace/eFG already derivable from existing team data. |

## Response Grain / Schema

Verified from responses:

- Player: `(season, season_type, player.id, category, type)`
- Team: `(season, season_type, team.id, category, type)`
- Hustle type is absent; grain uses `type=none`
- Top-level keys: `player` or `team`, `season`, `season_type`, `stats`
- Player identity: nested `player.id` (no `player.team_id` on these rows)
- Team identity: nested `team.id`
- Duplicates: **0**
- Pagination: `meta={ per_page: 100 }` only; no cursor on these filtered samples

`stats.play_type` repeats the query type (`Isolation`, `PRBallHandler`, `PRRollMan`). `type_grouping` = `Offensive`.

## Historical Consistency

Compared 2025 vs 2024 for isolation, drives, by_zone. 2023 not required.

| Pair | Same fields | Shared | Added/dropped | Coverage | IDs |
| --- | --- | --- | --- | --- | --- |
| playtype/isolation | yes | 20 | none | 100 / 100 | same 5 players |
| tracking/drives | yes | 21 | none | 100 / 100 | same 5 |
| shooting/by_zone | yes | 24 | none | 100 / 100 | same 5 |

Units look the same (per-game rates, 0–1 percentages). Schema is stable across the two seasons we already serve.

## Coverage / Field Quality

- Requested entities returned: 100% on every probe (stars **and** Achiuwa).
- Null fields: none in sampled stats.
- No `-1` / `999` sentinels observed.
- `zeroFields` in the JSON means **at least one row is 0**, not always-zero. Achiuwa isolation `plusone_poss_pct=0` while SGA is `0.022`. Durant `charges_drawn=0`. Backcourt shooting is genuinely unused.
- Outliers look real: SGA 25.8 drives vs Achiuwa 3.9; Jokic 72.9 passes_made vs Achiuwa 19.9.

## Advanced-Stats Overlap

Honest classification (naive script Class C over-counted `general/advanced` because names did not match `usage_percentage` vs `usg_pct`):

### Player `general/advanced` — do not archive

- **A (already in logs / serving averages):** `gp`, `min`, `fgm`, `fga`, `fg_pct`, win/loss counts
- **B (present in Advanced Stats V2 at game grain; this is season aggregation):** `usg_pct`, `efg_pct`, `ts_pct`, `off_rating`, `def_rating`, `net_rating`, `pace`, `pie`, `poss`, rebound/assist rates
- **C (not worth a separate dataset):** ranks, `sp_work_*` duplicates, `age`, `team_count`

### Player playtype / tracking / by_zone — unique

- **A:** counting husks (`gp`, `pts`, `fgm`, `fga`) inside a play-type slice
- **B:** none vs Advanced Stats
- **C:** `poss`, `poss_pct`, `ppp`, `percentile`, `score_poss_pct`, `ft_poss_pct`, drive family, passing tracking, zone FGA/FG%

## Unique Player Signals

Genuinely new for Court Context:

1. Offensive role mix: isolation / PnR ball-handler / roll-man **frequency + PPP + percentile**
2. Drive volume and drive efficiency
3. Pass volume, potential assists, points created
4. Shot-zone profile (rim vs mid vs corner vs ATB)

Not unique: season advanced rates, shotdashboard overall 2/3 split, hustle except as a later nicety.

## Unique Team Signals

Genuinely new for Matchup Context:

1. Team play-type frequency and efficiency (how much isolation, how well)
2. Opponent shot-zone vulnerability (RA% allowed, corner 3 volume/accuracy)

Aggregation convenience only: team `general/advanced`.

`by_zone_base` (own shooting) was not probed; field names likely mirror player `by_zone` with a team grain. Do not treat that as verified.

## Play-Type Assessment

**`HIGH_VALUE`**

Actual fields: `poss`, `poss_pct`, `ppp`, `pts`, `percentile`, `score_poss_pct`, `efg_pct`, `fg_pct`, `fgm`, `fga`, `fgmx`, `ft_poss_pct`, `plusone_poss_pct`, `sf_poss_pct`, `tov_poss_pct`, `gp`, `play_type`, `type_grouping`, `season_id`, `team_name`.

2025 evidence:

- SGA: 36% PnR BH (1.199 PPP, 96.5th pctile) + 28% isolation (1.163 PPP)
- Brunson: 34% PnR BH, 16% isolation
- Jokic: 11.4% roll (1.25 PPP) vs 8.5% BH
- Achiuwa: 11.3% roll, 4.5% isolation, 1.8% BH

That is enough to describe offensive role. Spot-up / transition were not queried; isolation vs BH vs roll already share one stats object, so additional types are likely the same shape.

## Tracking Assessment

Populated and interpretable.

| Surface | Evidence | Fit |
| --- | --- | --- |
| Role Check | SGA 25.8 drives vs Jokic 8.8; Jokic 72.9 passes vs SGA 38.1 | Strong season-style |
| Opportunity | Season grain only; no in-season role shift | Weak until game grain exists |
| Matchup Context | Team possessions (paint touches, time of poss) is style, not opponent defense | Medium; opponent zone is better |
| Historical Explorer | 2024 drives schema identical | Strong if archived |

## Shooting / Shot-Dashboard Assessment

- **by_zone:** useful player shot profile beyond Advanced Stats (Durant 5.4 midrange FGA at 48.2%; Achiuwa 3.8 RA FGA / 0.4 mid).
- **shotdashboard/overall:** skip. 2pt/3pt frequency is box-adjacent. `pullups` / `catch_and_shoot` remain untested; do not archive them on speculation.
- **team by_zone_opponent:** useful opponent rim/zone profile for future Matchup Context. Not built.

## Product Applications

| Application | Readiness | Unique value | Major limitation | Priority |
| --- | --- | --- | --- | --- |
| Role Profile | promising | play types + drives/passing + zone mix | season grain, not per game | P2 |
| Matchup Profile | promising | opponent zone + team play-type frequency | 4 teams sampled; `by_zone_base` untested | P2 |
| Opportunity Check | not ready | season style only | no role-shift without game grain | later |
| Historical Explorer | partial | stable 2024–2025 schema | not a league archive yet | P2 |
| Market + Context | later | could pair with 3-Hour Pre-Tip | not tested against props | later |

## Targeted Archive Estimate

**Not executed.**

Minimal high-value universe (skip general/advanced, hustle, clutch, defense, shotdashboard overall):

**Player:** playtype isolation, prballhandler, prrollman, spotup, transition; tracking drives, passing, possessions, catchshoot, pullupshot; shooting by_zone.

**Team:** playtype isolation, spotup, prballhandler; tracking drives, possessions, passing; shooting by_zone_base, by_zone_opponent.

- ~19 combinations × 3 seasons (2023–2025) = 57 logical probes
- Safe method: batch known log player IDs (`player_ids[]` ≤ 100). ≈ **189 HTTP**, ~**41 minutes** at 13s
- S3 ≈ **12 MB**
- **Do not** call player endpoints unfiltered; that is how this becomes a crawl

## Trial Time Remaining

Elapsed ~25.7 h. Remaining ~22.3 h. Protected reserve 6 h. Usable ~16.3 h.

A targeted 189-request archive fits the usable window. That is **not** authorization to run it.

## Postgres Unchanged Confirmation

- Expected: 342,846,611 bytes / 326.96 MB
- After: 342,846,611
- Unchanged: **true**
- No Season Averages serving table
- No Advanced serving table
- No lineup serving table
- No unrelated writes

## Archive Recommendation

`TARGETED_ARCHIVE_CONSIDER`

Play-type, tracking, and zone shooting add Court Context that Advanced Stats and box logs do not. `general/advanced` and shotdashboard overall do not. A full category/type dump would be mostly redundant. If we spend more trial time, spend it on the small player/team subset above — or stop and keep Plays blocked.

## Step Verdict

YELLOW — useful subset exists but broad archive is unnecessary
