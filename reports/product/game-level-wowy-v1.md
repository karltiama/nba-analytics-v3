# Game-level WOWY v1

Historical with/without-you at **game participation** grain. Not possession on/off. Not a production projection input.

Route: `/wowy`  
Shared module: `lib/wowy/`  
Calculation version: `game-level-wowy-v1`

## Eligibility (verified)

| Rule | Evidence | Finding |
|---|---|---|
| Subject must have played | `classifyAppearance` on `analytics.player_game_logs.minutes` | `minutes > 0` or token `"0"` = played. Token `"00"` = DNP roster row. Not an injury label. Inspected 2023–2025 Final logs: `"00"` ≈ 53k DNP rows; no DNP-reason column. |
| Same team that night | Both players have a PGL row with the same `team_id` for that `game_id` | Required for with and without. |
| Verified without | Teammate row present, same team, `minutes = '00'` | Absence is **not** inferred from a missing row. |
| Unknown | Teammate row missing, malformed minutes, or ambiguous team_id | Excluded from the split; counts returned. |
| Complete game | `analytics.games.status = 'Final'` and non-null `start_time`, `home_score`, `away_score` | Non-Final status values (including ISO timestamps stored as status on 2026-27 schedule rows) are incomplete. |
| Identity | `analytics.players.player_entity_id` present; no open UNRESOLVED/CONFLICT quarantine for that BDL id | Serving players currently all have entity ids; unresolved table empty. Fail closed if either fails. |
| Stints / trades | Game-log `team_id` keeps stints separate | `analytics.player_team_stints` 2023–2024 are 100% `inferred_pgl` (game-derived). 2025 mixed `inferred_pgl` / `nba_stats`. Observation dates are **not** verified trade timestamps and are not used to manufacture DNP. |
| Box coverage | PGL seasons 2023, 2024, 2025 | No 2026 WOWY box tape yet. |

## Example: Nikola Jokić (246) with/without Jamal Murray (335)

DEN `team_id=8`, season `2024`, Final games, regular season (ET date before 2025-04-15).

| Group | Games | PTS/g | REB/g | AST/g | MIN/g | Date coverage | Sample game IDs |
|---|---|---|---|---|---|---|---|
| With | 58 | 28.4 | 12.7 | 10.2 | 36.8 | 2024-10-24 → 2025-04-13 | 15907452, 15907464, 15907484, 15907490, 15907516 |
| Without (verified DNP) | 12 | 35.3 | 12.9 | 10.2 | 36.8 | 2024-11-02 → 2025-04-09 | 15907525, 15907543, 15907554, 15907778, 15907787 |

Murray missing-row count on Jokić's 2024 DEN Final logs: **0**. Different-team count: **0**.

These are descriptive. They are not “Murray being out caused Jokić to score more.”

Luka Dončić 2024 game-log teams (not trade dates): DAL `team_id=7` 2024-10-24–2025-01-31 (49 Final logs); LAL `team_id=14` 2025-02-04–2025-04-30 (40). Matching `inferred_pgl` stints. WOWY queries require an explicit `teamId` so these are never pooled.

## Shared module / API contract (for the learned-model / context-collection agent)

Do not import this into frozen PTS C / REB C scoring in this slice.

```ts
import {
  summarizeWowyPair,            // page + any feature adapter
  summarizeWowyBeforeCutoff,    // historically safe model interface
  WOWY_SCENARIO_UNKNOWN,
  type WowyPairQuery,
  type WowyModelPairResult,
} from '@/lib/wowy';
```

- `GET /api/wowy/pair?subjectPlayerId&teammatePlayerId&season&teamId&seasonType=regular|playoffs|all&dateFrom&dateTo&cutoffStartTime`
- `GET /api/wowy/model-pair?...&cutoffStartTime=` (required). Returns `{ history, reliability, scenario }`. `scenario` is `unknown` unless a **later** caller supplies timestamped pregame availability or an explicit hypothetical. The adapter never reads the target box or target teammate participation to choose with vs without.
- `GET /api/wowy/players?q=`
- `GET /api/wowy/context?playerId&season&teamId`

Cache keys include calculation version, data version, filters, and cutoff (`lib/wowy/cache.ts`).

Cutoff uses ET basketball-date exclusion: prior game must be strictly before tipoff **and** on an earlier America/New_York date.

If pregame availability is unknown, leave `scenario.status = 'unknown'`. Do not auto-apply an absence adjustment. Do not add pairwise diffs across multiple absent teammates.

## Integration requirements (other agent)

1. Live context collection / injury as-of is owned elsewhere. WOWY v1 does not consume those snapshots.
2. When a timestamped pregame availability feed exists, pass it as `WowyScenarioSelection` — do not infer from the eventual box.
3. Do not apply the unused index migration (`db/schemas/MIGRATION_wowy_query_indexes.sql`) without a separate ops review. Current pair queries are bounded by one player-season-team (~80–100 subject rows).
4. Shared `MIGRATION_context_collection_snapshots.sql` was not modified.

## Remaining limitations

- Game-level only. No possession reconstruction, no shared-court claim.
- Verified without coverage is only as good as `"00"` DNP roster rows. Two-way / G-League players who simply have no row stay unknown.
- `inferred_pgl` stints cannot date a trade.
- Sample-size policy is a documented floor, not a confidence score.
- Entitlement key `wowy` exists for a future Founding Pro gate; this slice ships the historical page ungated like `/teams`.
