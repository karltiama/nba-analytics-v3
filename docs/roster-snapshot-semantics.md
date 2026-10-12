# CommonTeamRoster is a membership snapshot

NBA Stats `CommonTeamRoster` (and the resulting `public.player_team_rosters` rows) record:

> Player X was **observed** on Team Y when this roster was fetched for season S.

That is **membership observation**, not exact transaction history.

## Implications for later stint modeling (2.T.2C+)

- Do **not** invent signing/trade timestamps from a roster fetch.
- `start_date` / `end_date` on future stints should come from explicit evidence
  (transaction feeds, consecutive game-log team changes, or documented as-of fetch dates).
- A roster refresh may show a player on a new team without telling us the exact trade date.
- Players absent from a later snapshot may have been waived, traded, or two-way assigned —
  absence alone is not a precise end event.

## BallDontLie observations

`raw.nba_roster_snapshots` stores NBA.com ids. BallDontLie active-player observations belong in `raw.roster_observation_batches` and `raw.roster_observation_members`. A BallDontLie player id is not an `nba_player_id`, and a BallDontLie team id is not `analytics.teams.team_id`.

The NBA.com snapshot helpers still select by UTC `snapshot_date` on or before the game's Eastern date. That date-only rule can treat a same-day observation collected after tipoff as eligible. The scoreboard Matchup loader does not use those helpers. It reads a stored BallDontLie batch only when `collected_at` is earlier than tipoff, and freshness still uses the Eastern calendar date. It does not mix NBA.com membership into the continuity percentages.

A difference between two observations is not a trade date.

## Season key

Roster rows for this project use the NBA season label (`2025-26`), forced from
`NBA_STATS_SEASON` / `TARGET_SEASON` in `scripts/seed_players_nba.py` (the raw API
`SEASON` field may return `2025` and must not redefine the persisted season key).
