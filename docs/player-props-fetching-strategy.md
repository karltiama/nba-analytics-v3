# Player Props Fetching Strategy

## Problem Statement

Player props require **per-event API calls** (1 call per game), which is expensive:
- Team odds: 1 call/day for all games = **30 calls/month**
- Player props: N calls/day (N = number of games) = **~300 calls/month** (10 games/day avg)
- **Total: ~330 calls/month** = **990-1,320 credits/month** ❌ **Exceeds 500 quota**

**Solution:** Use data-driven prioritization to fetch player props only for high-value players/games.

---

## Strategy Overview

### Tier 1: Always Fetch (High-Value Games)
- **Primetime games** (national TV, late night)
- **Rivalry games** (high betting interest)
- **Playoff implications** (late season)

### Tier 2: Star Players Only
- **Top 20-30 players** by usage/performance
- **Players with recent hot streaks** (L5 trending up)
- **Players with betting popularity** (if available)

### Tier 3: Skip
- **Low-interest games** (early afternoon, non-competitive)
- **Players with minimal minutes** (< 20 min/game)
- **Injured/resting players** (check injury status)

---

## Implementation Approaches

### Approach 1: Query-Based Prioritization (Recommended)

Use your existing player stats database to identify which players to fetch props for.

#### Step 1: Identify "Star" Players

Query players who meet criteria for betting interest:

```sql
-- Get players worth fetching props for
WITH player_metrics AS (
  SELECT 
    p.player_id,
    p.full_name,
    bpgs.team_id,
    t.abbreviation as team_abbr,
    COUNT(DISTINCT bpgs.game_id) as games_played,
    AVG(bpgs.points) as avg_points,
    AVG(bpgs.rebounds) as avg_rebounds,
    AVG(bpgs.assists) as avg_assists,
    AVG(bpgs.minutes) as avg_minutes,
    -- Recent form (L5)
    (
      SELECT AVG(points) 
      FROM (
        SELECT bpgs2.points
        FROM bbref_player_game_stats bpgs2
        JOIN bbref_games bg2 ON bpgs2.game_id = bg2.bbref_game_id
        WHERE bpgs2.player_id = p.player_id
          AND bg2.status = 'Final'
          AND bpgs2.dnp_reason IS NULL
          AND bpgs2.minutes > 10
        ORDER BY bg2.game_date DESC
        LIMIT 5
      ) recent
    ) as l5_avg_points
  FROM players p
  JOIN bbref_player_game_stats bpgs ON p.player_id = bpgs.player_id
  JOIN teams t ON bpgs.team_id = t.team_id
  JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
  WHERE bg.status = 'Final'
    AND bpgs.dnp_reason IS NULL
    AND bg.season = '2025' -- Current season
  GROUP BY p.player_id, p.full_name, bpgs.team_id, t.abbreviation
  HAVING COUNT(DISTINCT bpgs.game_id) >= 5
    AND AVG(bpgs.minutes) >= 20 -- Regular rotation player
)
SELECT 
  player_id,
  full_name,
  team_abbr,
  avg_points,
  avg_rebounds,
  avg_assists,
  l5_avg_points,
  -- Prioritize: high usage + recent form
  CASE 
    WHEN avg_points >= 20 OR avg_rebounds >= 10 OR avg_assists >= 8 THEN 'tier_1'
    WHEN avg_points >= 15 OR (avg_rebounds >= 7 AND avg_assists >= 5) THEN 'tier_2'
    WHEN avg_points >= 12 THEN 'tier_3'
    ELSE 'skip'
  END as priority_tier
FROM player_metrics
WHERE avg_points >= 12 -- Minimum threshold
ORDER BY avg_points DESC, l5_avg_points DESC
LIMIT 50; -- Top 50 players
```

#### Step 2: Match Players to Scheduled Games

For each scheduled game, check if it has "star" players:

```sql
-- Get today's games with star players
SELECT 
  bs.bbref_game_id,
  bs.home_team,
  bs.away_team,
  bs.game_date,
  bs.start_time_et,
  -- Count star players in game
  (
    SELECT COUNT(DISTINCT p.player_id)
    FROM players p
    JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    WHERE ptr.team_id IN (
      SELECT team_id FROM teams WHERE abbreviation = bs.home_team
      UNION
      SELECT team_id FROM teams WHERE abbreviation = bs.away_team
    )
    AND p.player_id IN (
      -- Star players from Step 1
      SELECT player_id FROM star_players
    )
  ) as star_player_count
FROM bbref_schedule bs
WHERE bs.game_date = CURRENT_DATE
  AND bs.status = 'Scheduled'
ORDER BY star_player_count DESC, bs.start_time_et DESC;
```

#### Step 3: Decision Logic

```typescript
// Pseudo-code for Lambda function
async function shouldFetchPlayerProps(game: ScheduledGame): Promise<boolean> {
  // Always fetch for primetime games (7:00 PM ET or later)
  if (game.startTimeET >= '19:00') {
    return true;
  }
  
  // Fetch if game has 3+ star players
  const starPlayerCount = await getStarPlayerCount(game);
  if (starPlayerCount >= 3) {
    return true;
  }
  
  // Fetch if game has at least 1 tier_1 player
  const tier1Players = await getTier1PlayersInGame(game);
  if (tier1Players.length > 0) {
    return true;
  }
  
  // Skip otherwise
  return false;
}
```

---

### Approach 2: Fixed Player List (Simpler)

Maintain a curated list of ~30-50 "star" players and only fetch props for games they're in.

**Pros:**
- ✅ Simple to implement
- ✅ Predictable API usage
- ✅ Easy to maintain

**Cons:**
- ❌ Requires manual updates
- ❌ May miss emerging players

**Implementation:**

```typescript
// In Lambda function
const STAR_PLAYER_IDS = [
  'lebron-james',
  'stephen-curry',
  'kevin-durant',
  // ... ~30-50 players
];

async function shouldFetchPlayerProps(game: ScheduledGame): Promise<boolean> {
  const playersInGame = await getPlayersInGame(game);
  return playersInGame.some(p => STAR_PLAYER_IDS.includes(p.player_id));
}
```

---

### Approach 3: Hybrid (Recommended for MVP)

Combine both approaches:
1. **Always fetch** for primetime games (7 PM ET+)
2. **Query-based** for other games (check for star players)
3. **Fallback** to fixed list if query fails

---

## Credit Usage Estimates

### Scenario A: Conservative (Fetch 30% of games)
- **Games/day**: 10 average
- **Fetch player props**: 3 games/day (30%)
- **API calls**: 1 (team) + 3 (player props) = 4 calls/day
- **Monthly**: 120 calls = **360 credits/month** ✅

### Scenario B: Moderate (Fetch 50% of games)
- **Games/day**: 10 average
- **Fetch player props**: 5 games/day (50%)
- **API calls**: 1 (team) + 5 (player props) = 6 calls/day
- **Monthly**: 180 calls = **540 credits/month** ⚠️ (slightly over)

### Scenario C: Aggressive (Fetch 70% of games)
- **Games/day**: 10 average
- **Fetch player props**: 7 games/day (70%)
- **API calls**: 1 (team) + 7 (player props) = 8 calls/day
- **Monthly**: 240 calls = **720 credits/month** ❌ (exceeds quota)

**Recommendation: Target 30-40% of games (Scenario A)**

---

## Implementation Plan

### Phase 1: MVP (Start Conservative)
1. ✅ Fetch team odds for all games (1 call/day)
2. ✅ Fetch player props **only for primetime games** (7 PM ET+)
3. ✅ Monitor credit usage for 1 week
4. ✅ Adjust threshold based on actual usage

**Expected**: ~2-3 primetime games/day = **90-120 credits/month** ✅

### Phase 2: Expand (After Validating)
1. ✅ Add query-based prioritization
2. ✅ Fetch props for games with 3+ star players
3. ✅ Monitor credit usage
4. ✅ Fine-tune thresholds

**Expected**: ~3-4 games/day = **120-150 credits/month** ✅

### Phase 3: Optimize (If Needed)
1. ✅ Add player-level filtering (only fetch props for star players in game)
2. ✅ Cache player lists (reduce DB queries)
3. ✅ Consider upgrading API plan if needed

---

## Code Changes Required

### 1. Add Helper Function to Lambda

```typescript
// In lambda/odds-pre-game-snapshot/index.ts

interface GamePriority {
  shouldFetchPlayerProps: boolean;
  reason: string;
  starPlayerCount?: number;
}

async function shouldFetchPlayerPropsForGame(
  game: ScheduledGame,
  pool: Pool
): Promise<GamePriority> {
  // Check if primetime (7 PM ET or later)
  const startTime = game.start_time_et;
  if (startTime && startTime >= '19:00') {
    return {
      shouldFetchPlayerProps: true,
      reason: 'primetime_game'
    };
  }
  
  // Check star player count
  const result = await pool.query(`
    WITH star_players AS (
      SELECT DISTINCT p.player_id
      FROM players p
      JOIN bbref_player_game_stats bpgs ON p.player_id = bpgs.player_id
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      WHERE bg.season = '2025'
        AND bg.status = 'Final'
        AND bpgs.dnp_reason IS NULL
        AND bpgs.minutes >= 20
      GROUP BY p.player_id
      HAVING AVG(bpgs.points) >= 15
        AND COUNT(DISTINCT bpgs.game_id) >= 5
    ),
    game_players AS (
      SELECT DISTINCT p.player_id
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE t.abbreviation IN ($1, $2)
        AND ptr.season = '2025'
    )
    SELECT COUNT(*) as star_count
    FROM star_players sp
    JOIN game_players gp ON sp.player_id = gp.player_id
  `, [game.away_team, game.home_team]);
  
  const starCount = parseInt(result.rows[0]?.star_count || '0');
  
  if (starCount >= 3) {
    return {
      shouldFetchPlayerProps: true,
      reason: 'star_players',
      starPlayerCount: starCount
    };
  }
  
  return {
    shouldFetchPlayerProps: false,
    reason: 'low_priority',
    starPlayerCount: starCount
  };
}
```

### 2. Update Handler Logic

```typescript
// In handler function
for (const matchedGame of matchedGames) {
  // Process team markets (always)
  await processEvent(matchedGame.event, matchedGame.gameId, stagingEventId);
  
  // Check if we should fetch player props
  const priority = await shouldFetchPlayerPropsForGame(
    matchedGame.scheduledGame,
    pool
  );
  
  if (priority.shouldFetchPlayerProps) {
    console.log(`Fetching player props for ${matchedGame.scheduledGame.away_team} @ ${matchedGame.scheduledGame.home_team} (${priority.reason})`);
    const playerProps = await fetchPlayerPropsForEvent(matchedGame.event.id);
    await processPlayerProps(playerProps, matchedGame.gameId, matchedGame.event.id, ...);
  } else {
    console.log(`Skipping player props for ${matchedGame.scheduledGame.away_team} @ ${matchedGame.scheduledGame.home_team} (${priority.reason}, ${priority.starPlayerCount} stars)`);
  }
}
```

---

## Monitoring & Optimization

### Key Metrics to Track

1. **API Calls per Day**
   - Team odds: Should be 1
   - Player props: Should be 2-4 (depending on strategy)

2. **Credit Usage**
   - Daily: ~12-18 credits (4-6 calls × 3 credits)
   - Monthly: ~360-540 credits
   - **Alert if > 400 credits/month**

3. **Coverage**
   - % of games with player props
   - % of star players covered
   - Games skipped (and why)

### Optimization Tips

1. **Cache star player list** (update weekly, not daily)
2. **Batch queries** (get all game priorities in one query)
3. **Skip injured players** (if injury data available)
4. **Adjust thresholds** based on actual credit usage

---

## Recommended Starting Point

**For MVP, start with Approach 3 (Hybrid):**

1. ✅ **Always fetch** player props for games starting at 7:00 PM ET or later
2. ✅ **Query-based** for other games: fetch if 3+ star players (15+ PPG, 5+ games)
3. ✅ **Monitor** credit usage for first week
4. ✅ **Adjust** thresholds based on actual usage

**Expected Results:**
- **Primetime games**: ~2-3/day
- **Star player games**: ~1-2/day
- **Total player prop calls**: ~3-5/day
- **Monthly credits**: ~270-450 credits ✅ **Well under 500**

---

## Next Steps

1. ✅ Implement `shouldFetchPlayerPropsForGame()` function
2. ✅ Update Lambda handler to use prioritization
3. ✅ Test locally with today's games
4. ✅ Deploy and monitor for 1 week
5. ✅ Adjust thresholds based on actual usage

