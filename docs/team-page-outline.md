# Team Page Outline

## Overview
The team page should provide comprehensive analytics and insights for betting/analytics purposes, following the same design system as the betting dashboard.

---

## Page Structure

### 1. **Header Section** ✅ (Already Implemented)
- Team logo/abbreviation
- Full team name
- Conference & Division
- Theme toggle

---

### 2. **Team Overview Cards** ✅ (Partially Implemented)
**Current:**
- Season Stats (Points For/Against, Pace)
- League Rankings (Offensive/Defensive Rank)
- Recent Form (L5 Record & Averages)

**Should Add:**
- Win/Loss Record (Overall season)
- Win Percentage
- Home/Away Record Split
- Conference/Division Standing
- Streak (W/L streak indicator)

---

### 3. **Recent Games Timeline**
**Purpose:** Quick view of recent performance with betting context

**Display:**
- Last 5-10 games in chronological order
- For each game:
  - Date & Opponent (clickable to game detail)
  - Score & Result (W/L)
  - Home/Away indicator
  - Key stats: Points For/Against, Margin
  - Spread coverage (if odds available)
  - Over/Under result (if odds available)
- Visual indicators:
  - Win streak (green highlight)
  - Loss streak (red highlight)
  - Close games (within 5 points)

**Data Source:** `teamStats.recent_form` (already available)

---

### 4. **Upcoming Games / Schedule Preview**
**Purpose:** See next 3-5 games with betting context

**Display:**
- Next 3-5 scheduled games
- For each game:
  - Date & Time
  - Opponent (clickable to opponent team page)
  - Home/Away indicator
  - Opponent's recent form
  - Opponent's key stats (ORTG, DRTG, Pace)
  - Pre-game odds (if available):
    - Moneyline
    - Spread
    - Over/Under
  - Matchup analysis:
    - Pace differential
    - Offensive/Defensive matchup
    - Historical head-to-head (if available)

**Data Source:** 
- `bbref_schedule` for upcoming games
- `markets` table for odds
- Opponent team stats

---

### 5. **Team Performance Metrics**
**Purpose:** Deep dive into team strengths/weaknesses

**Sections:**

#### A. **Offensive Metrics**
- Points Per Game (PPG) - with league rank
- Field Goal % - with league rank
- 3-Point % - with league rank
- Free Throw % - with league rank
- Offensive Rating (ORTG) - with league rank
- Assists Per Game
- Turnovers Per Game
- Offensive Rebounding %

#### B. **Defensive Metrics**
- Points Allowed Per Game - with league rank
- Defensive Rating (DRTG) - with league rank
- Opponent FG% - with league rank
- Opponent 3P% - with league rank
- Steals Per Game
- Blocks Per Game
- Defensive Rebounding %

#### C. **Pace & Efficiency**
- Pace (Possessions per game) - with league rank
- Net Rating (ORTG - DRTG)
- True Shooting %
- Effective FG%

**Data Source:** `teamStats.season_stats` + league rankings

---

### 6. **Home/Away Splits**
**Purpose:** Identify home court advantage and betting angles

**Display:**
- Side-by-side comparison cards:
  - **Home Record:** W-L, Win %, PPG, PPG Allowed
  - **Away Record:** W-L, Win %, PPG, PPG Allowed
- Key differences highlighted:
  - PPG differential (home vs away)
  - Defensive performance (home vs away)
  - Win % difference

**Data Source:** `teamStats.splits` (already available)

---

### 7. **Quarter-by-Quarter Analysis**
**Purpose:** Identify when team is strongest/weakest

**Display:**
- Q1, Q2, Q3, Q4 performance:
  - Average points scored per quarter
  - Average points allowed per quarter
  - Net points per quarter
  - League rank for each quarter
- Visual: Bar chart showing quarter performance
- Insights:
  - "Strong 1st quarter team" / "Slow starters"
  - "Clutch 4th quarter" / "4th quarter struggles"

**Data Source:** `teamStats.quarter_strengths` (already available)

---

### 8. **Key Players / Roster Highlights**
**Purpose:** Identify top performers and betting angles

**Display:**
- Top 5-8 players by:
  - Points Per Game
  - Recent form (L5 games trending up/down)
  - Player props relevance (if available)
- For each player:
  - Name (clickable to player page)
  - Position
  - Season averages (PTS, REB, AST)
  - Recent trend (L5 vs Season)
  - Key stat: "Player is +X% above season avg in L5"

**Data Source:** 
- `player_team_rosters` for roster
- `player_game_stats` for season/recent stats
- Player rolling stats (if available)

---

### 9. **Betting Insights & Trends**
**Purpose:** Actionable betting information

**Sections:**

#### A. **Spread Performance**
- ATS Record (Against The Spread)
- ATS Win % (Home/Away splits)
- Average margin of victory/defeat
- Recent ATS trend (last 5, last 10)

#### B. **Over/Under Performance**
- O/U Record
- O/U Win % (Home/Away splits)
- Average total points (team + opponent)
- Recent O/U trend

#### C. **Moneyline Performance**
- ML Record (as favorite/underdog)
- ML Win % by role
- Recent ML trend

**Data Source:** 
- `markets` table for historical odds
- Game results for outcomes

---

### 10. **Matchup Analysis** (Future Enhancement)
**Purpose:** Preview specific upcoming matchups

**Display:**
- Next game deep dive:
  - Opponent team card
  - Head-to-head comparison:
    - Pace matchup
    - Offense vs Defense matchup
    - Key player matchups
  - Historical H2H record
  - Betting recommendations (if odds available)

---

### 11. **Advanced Analytics** (Future Enhancement)
**Purpose:** Deeper statistical insights

**Sections:**
- **Clutch Performance:** Performance in close games (within 5 points)
- **Rest Days:** Performance by days of rest
- **Back-to-Back:** Performance in B2B games
- **Opponent Strength:** Performance vs top/middle/bottom teams
- **Injury Impact:** Performance with/without key players (if injury data available)

---

### 12. **AI Insights Sidebar** ✅ (Already Implemented)
- Team-specific insights
- Recent form alerts
- Betting angle suggestions
- Performance trends

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│ Header (Team Name, Theme Toggle)                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ┌────────────────────────┐  ┌──────────────────────┐  │
│ │ Main Content           │  │ AI Insights Sidebar  │  │
│ │                        │  │ (Sticky)             │  │
│ │ 1. Team Overview       │  │                      │  │
│ │ 2. Recent Games        │  │                      │  │
│ │ 3. Upcoming Games      │  │                      │  │
│ │ 4. Performance Metrics │  │                      │  │
│ │ 5. Home/Away Splits    │  │                      │  │
│ │ 6. Quarter Analysis    │  │                      │  │
│ │ 7. Key Players        │  │                      │  │
│ │ 8. Betting Insights   │  │                      │  │
│ │                        │  │                      │  │
│ └────────────────────────┘  └──────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Data Requirements Summary

### Already Available:
- ✅ Team basic info (`getTeamInfo`)
- ✅ Season stats (`getTeamStats`)
- ✅ Rankings (offensive/defensive)
- ✅ Home/Away splits
- ✅ Recent form (L5, L10)
- ✅ Quarter strengths
- ✅ Roster data
- ✅ Schedule data

### Need to Add:
- ⚠️ Spread/ATS performance (requires odds + results)
- ⚠️ Over/Under performance (requires odds + results)
- ⚠️ Upcoming games with odds
- ⚠️ Player recent trends (L5 vs Season)
- ⚠️ Head-to-head historical data
- ⚠️ Clutch performance metrics

---

## Priority Implementation Order

### Phase 1 (MVP - Current):
1. ✅ Team Overview Cards
2. ✅ AI Insights Sidebar
3. ⚠️ Recent Games Timeline (enhance current)

### Phase 2 (High Value):
4. ⚠️ Upcoming Games Preview
5. ⚠️ Performance Metrics (detailed stats)
6. ⚠️ Home/Away Splits (enhance current)

### Phase 3 (Enhanced Analytics):
7. ⚠️ Quarter-by-Quarter Analysis
8. ⚠️ Key Players Section
9. ⚠️ Betting Insights (ATS, O/U, ML)

### Phase 4 (Advanced):
10. ⚠️ Matchup Analysis
11. ⚠️ Advanced Analytics

---

## Design Notes

- Use same `glass-card` styling as betting dashboard
- Maintain color scheme:
  - Cyan (`#00d4ff`) for pace/offense
  - Green (`#39ff14`) for positive metrics
  - Orange (`#ff6b35`) for defense/negative
  - Purple (`#bf5af2`) for AI/insights
- All team/player names should be clickable links
- Use skeleton loaders for all sections
- Responsive: Stack on mobile, side-by-side on desktop


