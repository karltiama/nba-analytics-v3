# Protocol amendment: prospective-game-universe-v1

**Status:** FROZEN before first live cohort row  
**Date:** 2026-09-18  
**Applies to:** `prod-pts-context-v1-first500` and `aux-min-role-avail-joint-v1-first750`

## Why

Historical PTS residual fit, aux MIN fit, and selective validation filtered:

```text
analytics.games.season ∈ {2023,2024,2025}
AND status = 'Final'
(+ non-null scores / start_time where applicable)
```

`analytics.games` has **no** `game_type` / `season_type` column. Competition eligibility was therefore **not** frozen in Phase 18–19. Phase 19B freezes it **before** activation.

## Characterized historical Final universe

For 2023–2025 Finals with scores, tips begin at regular-season opening night (no Final preseason rows under ET open-night floors). Tips on/after WOWY play-in floors are present (Play-In + Playoffs + Finals). NBA Cup / IST games are not separately labeled and fall in the regular-season calendar band.

## Frozen prospective primary universe

```text
PROSPECTIVE_GAME_UNIVERSE = [
  REGULAR_SEASON,
  NBA_CUP_IN_SEASON_TOURNAMENT,  # not separately labeled; included with REGULAR
  PLAY_IN,
  PLAYOFFS,
  FINALS
]

PRESEASON_PRIMARY_ELIGIBILITY = NO
PLAY_IN_ELIGIBILITY = YES
PLAYOFF_ELIGIBILITY = YES
ALL_STAR_EXHIBITION_ELIGIBILITY = NO
```

## Classification (structured fields only)

| Signal | Source |
| --- | --- |
| Tip time | `analytics.games.start_time` |
| Season | `analytics.games.season` |
| Cancel/postpone | `status ∈ {Cancelled, Postponed}` |
| Preseason | ET calendar date `< REGULAR_SEASON_OPEN_ET[season]` |
| Play-In / Playoffs / Finals | ET date `≥ WOWY_POSTSEASON_START_ET[season]` |
| Regular (+ Cup) | otherwise on/after RS open and before play-in floor |

Frozen opens: see `REGULAR_SEASON_OPEN_ET` in `lib/context-projection/game-universe.ts`.

## Non-cohort testing

Preseason / exhibition may be used only as `CONTEXT_PROSPECTIVE_DRY_RUN=1` (no window inserts). They must not increment PTS/MIN primary counters.

## Implementation

- `lib/context-projection/game-universe.ts`
- Enforced in `loadProspectiveUpcomingGames` filter
