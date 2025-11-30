# Optimized Odds Fetching Strategy

## Overview

This document describes the optimized approach for fetching team odds and player props while minimizing API calls and staying within credit quotas.

## Strategy

### 1. Query `bbref_schedule` First (Source of Truth)
- Get today's games from `bbref_schedule` table
- This ensures we only fetch odds for games we actually have scheduled
- Avoids wasting API calls on games not in our database

### 2. Fetch Team Odds (Single Call)
- Call `/sports/basketball_nba/odds` once
- Get all upcoming games (team odds: moneyline, spread, total)
- Match API events to `bbref_schedule` games by team abbreviations

### 3. Fetch Player Props (Per-Event Calls, Only for Matched Games)
- For each game that matched between API and `bbref_schedule`:
  - Call `/events/{eventId}/odds` with player prop markets
  - Only fetch for games we actually have in our schedule
  - Skip games that don't match (saves API calls)

## Credit Usage

### Example: 10 games scheduled today

**Old Approach (fetching all events):**
- 1 call for team odds (gets 12 events, including 2 future games)
- 12 calls for player props (one per event)
- **Total: 13 calls** (wastes 2 calls on future games)

**New Approach (using bbref_schedule):**
- 1 call for team odds (gets 12 events)
- 10 calls for player props (only for matched games)
- **Total: 11 calls** (saves 2 calls)

**Monthly Usage:**
- Average 10 games/day × 30 days = 300 games/month
- 1 team odds call/day = 30 calls/month
- 300 player prop calls/month
- **Total: 330 calls/month**
- **Credits: ~990-1,650/month** ⚠️ (exceeds 500 quota)

## Recommendation

**For MVP: Fetch team odds only, skip player props**

- 1 call/day = 30 calls/month
- **Credits: 90-150/month** ✅ (well within quota)

**If you need player props:**
- Option A: Fetch selectively (e.g., primetime games only)
- Option B: Upgrade Odds API plan
- Option C: Fetch player props for specific players only

## Implementation

The Lambda function now:
1. Queries `bbref_schedule` for today's games
2. Fetches team odds (single call)
3. Matches events to scheduled games
4. Fetches player props only for matched games
5. Processes both team odds and player props

## Benefits

✅ **Efficient:** Only fetches data for games in our schedule  
✅ **Accurate:** Uses `bbref_schedule` as source of truth  
✅ **Flexible:** Can easily skip player props if needed  
✅ **Optimized:** Avoids unnecessary API calls  

---

_Last updated: 2025-11-29_

