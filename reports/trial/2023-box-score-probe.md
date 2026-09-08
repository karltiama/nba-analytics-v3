# 2023 Box Scores probe (Step 4D)

Generated: 2026-09-08T19:11:50.850Z

**YELLOW — Box Scores confirms persistent provider anomaly; decide serving policy**

Do not fetch the remaining 7 mismatch dates. Do not materialize 2023. Do not start Advanced Stats, 2022, props, odds, or lineups.

## Safety State

Preflight passed before execute:

| Check | Value |
| --- | --- |
| `BDL_TRIAL_MODE` | `1` |
| configured spacing | 13,000 ms |
| concurrency | 1 |
| lock | acquired, then released |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| season pin | 2025 |
| Production | frozen |
| 2023 serving | 0 |
| `raw.player_game_stats` 2023 | 0 |
| 2024/2025/2026 | unchanged vs expected isolation |

## Trial Limiter Result

`fetchWithRetry` now waits `requestDelayMs` before every trial attempt, including date-scoped first requests.

| Metric | Value |
| --- | --- |
| planned requests | 2 |
| actual requests | 2 |
| statuses | 200, 200 |
| 429s | 0 |
| retries | 0 |
| Retry-After | 0 |
| ms between request 1 and 2 | **13,010** |
| min spacing | 13,010 ms |
| limiter OK (≥12s) | true |

API key not logged.

## Feb 7 Box Scores Result

`GET /v1/box_scores?date=2024-02-07` → HTTP 200. 7 games in payload.

Matched by provider game id:

- `1038319` PHI vs GSW — Box Scores header **104–125**, 18+17 player rows
- `1038322` MIA vs SAS — Box Scores header **114–104**, 17+18 player rows

Archived at `raw/.../entity=box_scores_diagnostic/date=2024-02-07.json`.

## Mar 8 Box Scores Result

`GET /v1/box_scores?date=2024-03-08` → HTTP 200. 8 games in payload.

Matched by provider game id:

- `1038504` NYK vs ORL — Box Scores header **98–72**, 16+18 player rows

Archived at `raw/.../entity=box_scores_diagnostic/date=2024-03-08.json`.

## Per-Game Comparison

Official scores below are from the archived `/v1/games` records. Player IDs align 1:1 with `/v1/stats`. No player-point diffs.

| Game | Official (`/v1/games`) | Season `/v1/stats` | Fresh `/v1/stats` | Box Scores player sum | Box Scores header | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1038319 PHI vs GSW | 104–127 | 104–125 (GSW −2) | 104–125 | 104–125 | 104–125 | `BOX_SCORE_MATCHES_STATS_ANOMALY` |
| 1038322 MIA vs SAS | 116–104 | 114–104 (MIA −2) | 114–104 | 114–104 | 114–104 | `BOX_SCORE_MATCHES_STATS_ANOMALY` |
| 1038504 NYK vs ORL | 98–74 | 98–72 (ORL −2) | 98–72 | 98–72 | 98–72 | `BOX_SCORE_MATCHES_STATS_ANOMALY` |

All three boxes: both teams present, 0 duplicate player IDs, 0 missing IDs, structurally OK.

## Does Box Scores Fix the Provider Anomaly?

**B — same incorrect player data.** All three sampled games.

Box Scores does not fix player-point reconciliation. Player IDs and points are identical to `/v1/stats`.

Related difference (not a fix): Box Scores `home_team_score` / `visitor_team_score` match the undercounted player sums, whereas `/v1/stats` nested game scores followed the `/v1/games` archive (the higher official totals). Box Scores is internally consistent with its own undercount and still disagrees with the games archive.

## Additional Requests Needed If Useful

**0.** Endpoint is not useful as a repair source. Remaining unique mismatch dates (do not fetch):

`2024-02-10`, `2024-02-12`, `2024-02-14`, `2024-02-27`, `2024-02-28`, `2024-03-01`, `2024-03-06`

## Postgres Unchanged Confirmation

2023 games/logs/team stats/averages/stints = 0. 2024 = 1,321 games. 2025 = 1,323. 2026 = 1,200. `raw.player_game_stats` = 46,056. No serving writes.

## Recommended Next Step

Do not keep hitting BDL for these 10 games. The anomaly likely exists in BDL's underlying historical box-score data, not only `/v1/stats`.

Later serving-policy options (do not implement in 4D):

- materialize structurally valid stats with an explicit provider-quality flag
- exclude the 10 games from derived score-sensitive analytics
- verify against a separately trusted source later

Do not fabricate player points.

## Step Verdict

**YELLOW — Box Scores confirms persistent provider anomaly; decide serving policy**
