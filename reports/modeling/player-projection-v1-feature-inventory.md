# Player projection v1 — pregame feature inventory

Inspected 2026-09-14 from live analytics/research schemas. Features that do not exist historically are marked unavailable. Nothing below is fabricated.

## High-value pregame features that actually exist

- Previous-game / L3 / L5 / L10 / season **minutes** from `analytics.player_game_logs.minutes` (as-of prior Final games). Complete for 2023–2025.
- **FGA / FTA** on every 2023–2025 Final log (0 nulls). Touches: **not stored**.
- **Team, opponent, home/away** from `analytics.games.home_team_id` / `away_team_id` vs log `team_id`. Complete.
- **Days rest / back-to-back** computable from prior `games.start_time` (ET calendar). Complete whenever a prior game exists.
- **Team pace / opponent defensive rating** as-of prior games from `analytics.team_game_stats` (2023–2025 complete). Target-game row is leakage.
- **Usage / pace** as-of prior games from `analytics.player_game_advanced` (2023–2025). Target-game usage is leakage.
- **Starter/bench for 2025–26 only** from `analytics.game_starters` (postgame certified BDL lineups). Prior-game starter is a valid as-of feature; **target-game starter is not pregame**.

## Unavailable or unsafe for this phase

- Historically valid **pregame injury / inactive** tape: `player_injury_status_history` only 2026-03-10 23:43:43.097+00 → 2026-05-06 18:00:27.42+00 (late 2025–26). Cannot backfill 2023–25 as-of injuries.
- **Pregame announced lineups**: not stored. `game_starters` is certified postgame starters, 2025 only.
- **Touches**, on/off, WOWY: not in serving tables.
- **Public betting %**: archive exists with **unknown capture timing** — rejected as a projection input.
- **Closing player-prop / game odds**: evaluation-only, never a basketball feature in v1 minutes/role.

### previous-game minutes

| | |
| --- | --- |
| **FEATURE** | previous-game minutes |
| **SOURCE TABLE / FIELD** | analytics.player_game_logs.minutes |
| **HISTORICAL COVERAGE** | 2023: 46090 logs; 2024: 46150 logs; 2025: 46056 logs |
| **AVAILABLE BEFORE TIP?** | YES |
| **LEAKAGE RISK** | Low if prior games only |
| **MISSINGNESS** | None on Final 2023–25 |
| **NOTES** | Token `"00"` = DNP; `"0"`/`"0.0"` = played; minutes>0 = played. |

### L3 / L5 / L10 / season minutes

| | |
| --- | --- |
| **FEATURE** | L3 / L5 / L10 / season minutes |
| **SOURCE TABLE / FIELD** | Derived as-of from player_game_logs |
| **HISTORICAL COVERAGE** | Same as PGL 2023–2025 |
| **AVAILABLE BEFORE TIP?** | YES |
| **LEAKAGE RISK** | Low |
| **MISSINGNESS** | Undefined until enough prior played games |
| **NOTES** | Played-only windows. Zero-minute played appearances skipped in minute means. |

### starting status (target game)

| | |
| --- | --- |
| **FEATURE** | starting status (target game) |
| **SOURCE TABLE / FIELD** | analytics.game_starters |
| **HISTORICAL COVERAGE** | 2025: 13200 rows / 1320 games |
| **AVAILABLE BEFORE TIP?** | NO |
| **LEAKAGE RISK** | HIGH — postgame certified archive |
| **MISSINGNESS** | No 2023 or 2024 rows |
| **NOTES** | Use only as an observed evaluation split. Not a projection input. |

### recent starting rate / games started / consecutive starts

| | |
| --- | --- |
| **FEATURE** | recent starting rate / games started / consecutive starts |
| **SOURCE TABLE / FIELD** | Prior rows of analytics.game_starters |
| **HISTORICAL COVERAGE** | 2025 prior games only |
| **AVAILABLE BEFORE TIP?** | CONDITIONAL |
| **LEAKAGE RISK** | Low if restricted to prior games |
| **MISSINGNESS** | Unknown for 2023–24 history; early 2025 until first labeled game |
| **NOTES** | 28130/83479 scored targets had ≥1 prior known-role game. |

### FGA / FTA

| | |
| --- | --- |
| **FEATURE** | FGA / FTA |
| **SOURCE TABLE / FIELD** | analytics.player_game_logs.field_goals_attempted / free_throws_attempted |
| **HISTORICAL COVERAGE** | 0 nulls on Final 2023–25 |
| **AVAILABLE BEFORE TIP?** | YES as prior-game features |
| **LEAKAGE RISK** | Low |
| **MISSINGNESS** | None |
| **NOTES** | Usage-like counting. Not used in this minutes/role pass. |

### touches

| | |
| --- | --- |
| **FEATURE** | touches |
| **SOURCE TABLE / FIELD** | — |
| **HISTORICAL COVERAGE** | Not in schema |
| **AVAILABLE BEFORE TIP?** | NO |
| **LEAKAGE RISK** | n/a |
| **MISSINGNESS** | 100% |
| **NOTES** | Do not fabricate. |

### minutes share

| | |
| --- | --- |
| **FEATURE** | minutes share |
| **SOURCE TABLE / FIELD** | Derived: player minutes / team minutes from prior PGL |
| **HISTORICAL COVERAGE** | Computable 2023–2025 |
| **AVAILABLE BEFORE TIP?** | YES |
| **LEAKAGE RISK** | Low if prior only |
| **MISSINGNESS** | Needs teammates' prior logs |
| **NOTES** | Not precomputed. Deferred to usage experiment. |

### team / opponent / home-away

| | |
| --- | --- |
| **FEATURE** | team / opponent / home-away |
| **SOURCE TABLE / FIELD** | analytics.games + player_game_logs.team_id |
| **HISTORICAL COVERAGE** | Complete Final 2023–25 |
| **AVAILABLE BEFORE TIP?** | YES |
| **LEAKAGE RISK** | Low |
| **MISSINGNESS** | None |
| **NOTES** | Scheduled before tip. Safe. |

### days rest / back-to-back

| | |
| --- | --- |
| **FEATURE** | days rest / back-to-back |
| **SOURCE TABLE / FIELD** | analytics.games.start_time as-of last prior game |
| **HISTORICAL COVERAGE** | Complete when a prior game exists |
| **AVAILABLE BEFORE TIP?** | YES |
| **LEAKAGE RISK** | Low |
| **MISSINGNESS** | First game of season has no rest |
| **NOTES** | Not modeled in this pass. |

### team pace / opponent pace / opponent defensive metrics

| | |
| --- | --- |
| **FEATURE** | team pace / opponent pace / opponent defensive metrics |
| **SOURCE TABLE / FIELD** | analytics.team_game_stats.pace, defensive_rating, points_allowed (prior games) |
| **HISTORICAL COVERAGE** | 2023: 2638; 2024: 2642; 2025: 2644 |
| **AVAILABLE BEFORE TIP?** | YES if prior games only |
| **LEAKAGE RISK** | HIGH if target-game row used |
| **MISSINGNESS** | Target-game stats exist but are postgame |
| **NOTES** | Full 2023–2025 team-game coverage. Next families, not this pass. |

### player usage / pace

| | |
| --- | --- |
| **FEATURE** | player usage / pace |
| **SOURCE TABLE / FIELD** | analytics.player_game_advanced.usage_percentage, pace |
| **HISTORICAL COVERAGE** | 2023: 34843 (usg 34843); 2024: 35103 (usg 35103); 2025: 34810 (usg 34780) |
| **AVAILABLE BEFORE TIP?** | YES if prior games only |
| **LEAKAGE RISK** | HIGH if tonight's Advanced used |
| **MISSINGNESS** | A few 2025 rows lack pace |
| **NOTES** | Deferred to usage/rate-change experiment. |

### teammate availability

| | |
| --- | --- |
| **FEATURE** | teammate availability |
| **SOURCE TABLE / FIELD** | No historical pregame inactive list |
| **HISTORICAL COVERAGE** | Not available 2023–25 |
| **AVAILABLE BEFORE TIP?** | NO |
| **LEAKAGE RISK** | HIGH if inferred from target box |
| **MISSINGNESS** | Injury history too late |
| **NOTES** | DNP `"00"` on prior games is a weak post-hoc proxy, not pregame availability. |

### injury / inactive

| | |
| --- | --- |
| **FEATURE** | injury / inactive |
| **SOURCE TABLE / FIELD** | analytics.player_injury_status_history.snapshot_at |
| **HISTORICAL COVERAGE** | 4801 rows 2026-03-10 23:43:43.097+00 → 2026-05-06 18:00:27.42+00 |
| **AVAILABLE BEFORE TIP?** | NO for 2023–25 |
| **LEAKAGE RISK** | HIGH |
| **MISSINGNESS** | No tape before 2026-03-10 |
| **NOTES** | Do not use in v1 historical eval. |

### lineup data

| | |
| --- | --- |
| **FEATURE** | lineup data |
| **SOURCE TABLE / FIELD** | analytics.game_starters (5 certified starters, 2025) |
| **HISTORICAL COVERAGE** | 2025: 13200 rows / 1320 games |
| **AVAILABLE BEFORE TIP?** | NO as pregame |
| **LEAKAGE RISK** | HIGH for tonight |
| **MISSINGNESS** | 2023–24 missing; non-starters omitted |
| **NOTES** | Not a full rotation / lineup card. |

### roster / team changes

| | |
| --- | --- |
| **FEATURE** | roster / team changes |
| **SOURCE TABLE / FIELD** | player_game_logs.team_id vs prior team_id |
| **HISTORICAL COVERAGE** | Inferable 2023–2025 |
| **AVAILABLE BEFORE TIP?** | CONDITIONAL |
| **LEAKAGE RISK** | Medium — observation of first game on new team, not trade timestamp |
| **MISSINGNESS** | No transaction table |
| **NOTES** | Useful later; not this pass. |

### closing player-prop market

| | |
| --- | --- |
| **FEATURE** | closing player-prop market |
| **SOURCE TABLE / FIELD** | Owls S3 historical_player_props |
| **HISTORICAL COVERAGE** | 2023–24 core two-way on ~21% of Final games |
| **AVAILABLE BEFORE TIP?** | YES as a line (evaluation) |
| **LEAKAGE RISK** | Do not use as a feature |
| **MISSINGNESS** | Most games EMPTY_PROVIDER_HISTORY |
| **NOTES** | Evaluation-only. 2024–25 ESPN BET mix is a different product. |

### public betting %

| | |
| --- | --- |
| **FEATURE** | public betting % |
| **SOURCE TABLE / FIELD** | Owls public-betting archive |
| **HISTORICAL COVERAGE** | Descriptive snapshots |
| **AVAILABLE BEFORE TIP?** | UNKNOWN timing |
| **LEAKAGE RISK** | HIGH |
| **MISSINGNESS** | Capture time not proven pre-tip |
| **NOTES** | Rejected as a projection input. |


## Leakage guardrail

Every prior log used in v1 minutes/role must satisfy `feature_timestamp < target_tipoff` (`isStrictlyBefore`). Rejected inputs:

- target-game box score
- target-game minutes
- target-game starter / lineup (postgame certified archive)
- postgame injury resolution
- season aggregates that include future games
- closing-market prices as basketball features
- historical public-betting percentages (capture timing unknown)
