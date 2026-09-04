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

## Season key

Roster rows for this project use the NBA season label (`2025-26`), forced from
`NBA_STATS_SEASON` / `TARGET_SEASON` in `scripts/seed_players_nba.py` (the raw API
`SEASON` field may return `2025` and must not redefine the persisted season key).
