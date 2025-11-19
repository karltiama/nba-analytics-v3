# Advanced Statistics for NBA Props Betting

## Overview

This document outlines advanced statistics that would benefit a props betting/analytics website. These metrics help predict player performance and identify value in betting lines.

---

## 🎯 Tier 1: High-Impact Stats (Implement First)

### 1. **True Shooting Percentage (TS%)**
**Formula:** `Points / (2 * (FGA + 0.44 * FTA))`

**Why it matters:**
- Better than FG% because it accounts for 3-pointers and free throws
- Shows actual scoring efficiency
- Helps predict points props

**Calculable from:** `player_game_stats` (FGM, FGA, FTM, FTA, Points)

**Use case:** "Player X has TS% of 60% vs opponent's 25th-ranked defense → Over on points"

---

### 2. **Usage Rate (USG%)**
**Formula:** `((FGA + 0.44 * FTA + TOV) * (Team Minutes / 5)) / (Player Minutes * (Team FGA + 0.44 * Team FTA + Team TOV)) * 100`

**Why it matters:**
- Shows how much a player "touches" the ball
- High usage = more opportunities = higher stat totals
- Critical for predicting points, rebounds, assists

**Calculable from:** `player_game_stats` + `team_game_stats` (needs team totals)

**Use case:** "Player X usage up 5% in last 5 games → Likely more shots/points"

---

### 3. **Pace-Adjusted Stats (Per 100 Possessions)**
**Formula:** `(Stat / Player Possessions) * 100`

**Why it matters:**
- Normalizes stats across different game paces
- Fast-paced games = more stats, but per-100 shows true rate
- Better comparison across matchups

**Calculable from:** `player_game_stats` + `team_game_stats` (possessions)

**Use case:** "Player averages 25 PPG, but 28 per 100 vs fast-paced teams → Over on points"

---

### 4. **Effective Field Goal Percentage (eFG%)**
**Formula:** `(FGM + 0.5 * 3PM) / FGA`

**Why it matters:**
- Accounts for 3-pointers being worth more
- Better than FG% for predicting scoring
- Shows shot selection quality

**Calculable from:** `player_game_stats` (FGM, FGA, 3PM)

**Use case:** "Player eFG% 55% vs opponent's 20th-ranked defense → Over on points"

---

### 5. **Assist Rate (AST%)**
**Formula:** `(Assists * 100) / (((Minutes / (Team Minutes / 5)) * Team FGM) - FGM)`

**Why it matters:**
- Shows passing/playmaking ability
- Predicts assist props
- High AST% = more assists per opportunity

**Calculable from:** `player_game_stats` + `team_game_stats`

**Use case:** "Player AST% 35% vs opponent's 28th-ranked assist defense → Over on assists"

---

## 🎯 Tier 2: Matchup-Specific Stats (High Value)

### 6. **vs Opponent Stats (Historical Performance)**
**What it is:** Player's stats when facing specific opponent

**Why it matters:**
- Some players perform better/worse vs certain teams
- Matchup-specific trends
- Defensive matchups matter

**Calculable from:** `player_game_stats` + `games` (join by opponent)

**Use case:** "Player X averages 28 PPG vs Team Y (career) → Over on points"

---

### 7. **Opponent Defensive Rankings**
**What it is:** Where opponent ranks in points allowed, rebounds allowed, etc.

**Why it matters:**
- Easy to understand context
- "Player vs 30th-ranked defense" = favorable matchup
- Industry standard metric

**Calculable from:** `team_game_stats` aggregated by opponent

**Use case:** "Player vs 30th-ranked points defense → Over on points"

---

### 8. **Pace Context**
**What it is:** Game pace (possessions per 48 min) for player's team vs opponent

**Why it matters:**
- Fast pace = more opportunities
- Slow pace = fewer opportunities
- Critical for all props

**Calculable from:** `team_game_stats` (already have pace)

**Use case:** "Game pace: 105 (fast) → More opportunities → Over on points/rebounds"

---

## 🎯 Tier 3: Consistency & Variance Metrics

### 9. **Standard Deviation / Variance**
**Formula:** `STDDEV(points)` per game

**Why it matters:**
- Shows consistency
- Low variance = more predictable = better for props
- High variance = riskier bets

**Calculable from:** `player_game_stats` (aggregate variance)

**Use case:** "Player has low variance (SD = 3) → More reliable → Better for props"

---

### 10. **Hit Rate (Over/Under Success Rate)**
**What it is:** % of games player hits over on specific prop

**Why it matters:**
- Shows historical success vs lines
- "Player hits over on 25.5 points 70% of time"
- Direct betting relevance

**Calculable from:** `player_game_stats` (compare to historical lines if available)

**Use case:** "Player hits over on rebounds 65% of time → Over on rebounds"

---

### 11. **Consistency Score**
**Formula:** `(Games Over Line) / (Total Games)`

**Why it matters:**
- Simple metric for reliability
- Higher = more consistent
- Easy to understand

**Calculable from:** `player_game_stats` + line data (if available)

---

## 🎯 Tier 4: Advanced Efficiency Metrics

### 12. **Player Efficiency Rating (PER)**
**Formula:** Complex formula involving all stats

**Why it matters:**
- Industry standard efficiency metric
- Single number summarizing performance
- Good for overall player value

**Note:** Complex to calculate, may need external source or simplified version

---

### 13. **Box Plus/Minus (BPM)**
**Formula:** Advanced metric combining box score stats

**Why it matters:**
- Advanced efficiency metric
- Accounts for team context
- Better than raw +/- 

**Note:** Very complex, may need external source

---

### 14. **Value Over Replacement Player (VORP)**
**Formula:** BPM * Minutes * Team Factor

**Why it matters:**
- Shows player's value vs replacement
- Good for overall assessment
- Less useful for specific props

**Note:** Complex, lower priority for props betting

---

## 🎯 Tier 5: Situational Stats

### 15. **Clutch Performance**
**What it is:** Stats in "clutch" situations (last 5 min, score within 5)

**Why it matters:**
- Some players perform better in clutch
- Affects late-game props
- Shows mental toughness

**Note:** Requires play-by-play data (not currently available)

---

### 16. **Rest Days Impact**
**What it is:** Performance with 0, 1, 2+ days rest

**Why it matters:**
- Some players perform better with rest
- Back-to-back games affect performance
- Scheduling context

**Calculable from:** `games` (start_time) + `player_game_stats`

**Use case:** "Player averages 28 PPG with 1 day rest, 22 PPG on back-to-back → Check schedule"

---

### 17. **Home/Away Splits**
**What it is:** Performance at home vs away

**Why it matters:**
- Some players have significant home/away differences
- Travel affects performance
- Venue context

**Calculable from:** `player_game_stats` + `games` (home/away)

**Note:** Already partially implemented!

---

## 🎯 Tier 6: Opponent Context (Team-Level)

### 18. **Opponent Points Allowed Per Game**
**What it is:** Average points opponent allows

**Why it matters:**
- Direct context for points props
- Easy to understand
- Industry standard

**Calculable from:** `team_game_stats` aggregated by opponent

---

### 19. **Opponent Rebounds Allowed**
**What it is:** Average rebounds opponent allows

**Why it matters:**
- Context for rebound props
- Some teams allow more rebounds (bad defense)
- Matchup context

**Calculable from:** `team_game_stats` aggregated by opponent

---

### 20. **Opponent Assist Rate Allowed**
**What it is:** Average assists opponent allows

**Why it matters:**
- Context for assist props
- Defensive scheme affects assists
- Matchup context

**Calculable from:** `team_game_stats` aggregated by opponent

---

## 📊 Implementation Priority

### Phase 1 (Quick Wins - This Week):
1. ✅ **True Shooting % (TS%)** - Easy calculation
2. ✅ **Effective FG% (eFG%)** - Easy calculation  
3. ✅ **Pace-Adjusted Stats** - Already have pace data
4. ✅ **Opponent Defensive Rankings** - Aggregate team stats

### Phase 2 (High Value - Next Week):
5. ✅ **Usage Rate (USG%)** - More complex but high value
6. ✅ **Assist Rate (AST%)** - Important for assist props
7. ✅ **vs Opponent Stats** - Historical matchup data
8. ✅ **Standard Deviation** - Consistency metrics

### Phase 3 (Advanced - Later):
9. ⏳ **Hit Rate** - Requires line data
10. ⏳ **Rest Days Impact** - Schedule analysis
11. ⏳ **PER** - Complex but industry standard
12. ⏳ **Clutch Performance** - Requires play-by-play

---

## 💡 Recommended Starting Point

**Start with these 4 metrics:**
1. **TS%** - Better scoring efficiency metric
2. **Pace-Adjusted Stats** - Normalize for game pace
3. **Opponent Defensive Rankings** - Easy context
4. **Usage Rate** - Critical for opportunity prediction

These give you:
- Better efficiency metrics
- Pace normalization
- Matchup context
- Opportunity prediction

All calculable from your current data!

---

## 🔧 SQL Examples

### True Shooting %
```sql
SELECT 
  player_id,
  SUM(points) as total_points,
  SUM(field_goals_attempted) as fga,
  SUM(free_throws_attempted) as fta,
  SUM(points) / (2 * (SUM(field_goals_attempted) + 0.44 * SUM(free_throws_attempted))) * 100 as ts_pct
FROM player_game_stats
WHERE dnp_reason IS NULL
GROUP BY player_id
```

### Effective FG%
```sql
SELECT 
  player_id,
  SUM(field_goals_made) as fgm,
  SUM(field_goals_attempted) as fga,
  SUM(three_pointers_made) as tpm,
  (SUM(field_goals_made) + 0.5 * SUM(three_pointers_made)) / NULLIF(SUM(field_goals_attempted), 0) * 100 as efg_pct
FROM player_game_stats
WHERE dnp_reason IS NULL
GROUP BY player_id
```

### Pace-Adjusted Points (Per 100 Possessions)
```sql
SELECT 
  pgs.player_id,
  AVG(pgs.points) as avg_points,
  AVG(tgs.possessions) as avg_team_possessions,
  AVG(pgs.minutes) as avg_minutes,
  -- Estimate player possessions (simplified)
  AVG(pgs.points) / (AVG(pgs.minutes) / 48.0 * AVG(tgs.possessions)) * 100 as points_per_100_poss
FROM player_game_stats pgs
JOIN team_game_stats tgs ON pgs.game_id = tgs.game_id AND pgs.team_id = tgs.team_id
WHERE pgs.dnp_reason IS NULL
GROUP BY pgs.player_id
```

---

## 📈 Display Recommendations

**For Player Pages:**
- Show TS%, eFG% alongside FG%
- Display pace-adjusted stats alongside raw stats
- Show usage rate prominently
- Display vs opponent historical stats

**For Matchup Analysis:**
- Opponent defensive rankings (points, rebounds, assists)
- Game pace projection
- Player's historical vs opponent
- Usage rate trends

**For Props Analysis:**
- Hit rate vs line (if line data available)
- Consistency metrics (SD, variance)
- Recent form vs season average
- Matchup context (opponent rankings)

