# Missing Data Filling Strategies

## Overview
This document outlines strategies and ideas for filling in missing data gaps in the NBA analytics database.

---

## 1. Box Scores (Current Priority)

### Problem
- Box scores are delayed 1-2 days after games finish
- Some historical games may be missing box scores entirely

### Strategies

#### A. Retry Script (✅ Implemented)
- **Script**: `retry-missing-boxscores.ts`
- **Approach**: Daily retry for Final games missing box scores
- **Pros**: Handles delayed data automatically
- **Cons**: Still subject to NBA.com's delay

#### A2. HTML Box Score Scraping (✅ Implemented)
- **Script**: `scrape-nba-com.ts` with `fetchBoxScoreHTML()`
- **Approach**: Scrape HTML box score pages as fallback when JSON API fails
- **URL Format**: `https://www.nba.com/game/{away}-vs-{home}-{gameId}/box-score`
- **Pros**: 
  - Fallback when JSON API is unavailable
  - May have different availability than JSON endpoints
  - Uses same rate limiting as JSON scraper
- **Cons**: 
  - HTML parsing is more fragile (page structure changes)
  - May need refinement based on actual page structure
- **Status**: Implemented, needs testing with real pages

#### B. Multiple Data Sources
- **BallDontLie API**: May have box scores available earlier
- **API-Basketball**: Alternative source for player stats
- **Basketball Reference**: Web scraping fallback (if legal)
- **Pros**: Redundancy, faster availability
- **Cons**: Need to handle different data formats, potential cost

#### C. Real-time WebSocket/Streaming
- **NBA.com Live API**: Subscribe to live game events
- **Approach**: Capture stats as game progresses
- **Pros**: Real-time data, no delays
- **Cons**: Complex implementation, need to handle reconnections

#### D. Historical Backfill
- **NBA Stats Archive**: Fetch all historical box scores
- **Approach**: Batch process past seasons
- **Pros**: Complete historical dataset
- **Cons**: Time-consuming, rate limits

---

## 2. Historical Game Data

### Problem
- Missing games from past seasons
- Incomplete schedules for older seasons

### Strategies

#### A. NBA Stats Historical Endpoints
- **Endpoint**: `scoreboardV2` with date ranges
- **Approach**: Loop through historical dates
- **Implementation**: 
  ```typescript
  // Fetch all games from 2020-21 season onwards
  for (date in seasonDates) {
    await fetchScoreboard(date);
  }
  ```
- **Pros**: Official source, reliable
- **Cons**: Rate limits, time-consuming

#### B. Basketball Reference Scraping
- **URL Pattern**: `https://www.basketball-reference.com/boxscores/YYYYMMDD0TEAM.html`
- **Approach**: Parse HTML tables for game data
- **Pros**: Comprehensive historical data
- **Cons**: Scraping complexity, legal considerations

#### C. Public Datasets
- **Kaggle**: NBA datasets with historical data
- **GitHub**: Community-maintained datasets
- **Approach**: Import CSV/JSON files
- **Pros**: Quick, comprehensive
- **Cons**: Data quality varies, may need cleaning

---

## 3. Player Data & Rosters

### Problem
- Missing player information
- Incomplete historical rosters
- Missing player photos/biographies

### Strategies

#### A. NBA Stats Player Info Endpoint
- **Endpoint**: `commonplayerinfo`
- **Approach**: Fetch detailed player profiles
- **Data**: Height, weight, draft info, career stats
- **Pros**: Official, comprehensive
- **Cons**: Rate limits

#### B. Wikipedia API
- **Approach**: Fetch player biographies, photos
- **Pros**: Rich metadata, free
- **Cons**: Unstructured, needs parsing

#### C. ESPN API (if available)
- **Approach**: Player profiles and photos
- **Pros**: High-quality images
- **Cons**: May require API key, rate limits

---

## 4. Advanced Statistics

### Problem
- Missing advanced metrics (PER, BPM, VORP, etc.)
- Missing play-by-play data
- Missing shot charts

### Strategies

#### A. Calculate from Existing Data
- **Approach**: Compute advanced stats from box scores
- **Metrics**: 
  - PER (Player Efficiency Rating)
  - True Shooting %
  - Usage Rate
  - Pace
  - Offensive/Defensive Rating
- **Pros**: No external API needed
- **Cons**: Limited to what we can calculate

#### B. NBA Stats Advanced Endpoints
- **Endpoints**: 
  - `playergamelog` - Player game logs
  - `playerdashboardbygeneralsplits` - Advanced splits
  - `shotchartdetail` - Shot location data
- **Approach**: Fetch advanced metrics directly
- **Pros**: Official advanced stats
- **Cons**: Complex endpoints, rate limits

#### C. Third-party Analytics APIs
- **Stats Perform**: Professional sports data
- **Sportradar**: Comprehensive sports APIs
- **Pros**: High-quality, reliable
- **Cons**: Expensive, may require contracts

---

## 5. Betting/Odds Data

### Problem
- Missing pre-game odds
- Missing line movements
- Missing closing lines

### Strategies

#### A. The Odds API
- **Endpoint**: `/v4/sports/basketball_nba/odds`
- **Approach**: Fetch odds from multiple books
- **Pros**: Multiple sportsbooks, historical data
- **Cons**: Paid service, rate limits

#### B. API-Sports Odds
- **Endpoint**: `/odds` endpoint
- **Approach**: Historical and live odds
- **Pros**: Good coverage
- **Cons**: Subscription required

#### C. Web Scraping Sportsbooks
- **Approach**: Scrape DraftKings, FanDuel, etc.
- **Pros**: Free, real-time
- **Cons**: Legal/ToS concerns, fragile (site changes break it)

---

## 6. Injury Data

### Problem
- Missing injury reports
- Missing player availability status
- Missing injury history

### Strategies

#### A. ESPN Injury API (if available)
- **Approach**: Fetch injury reports
- **Pros**: Official source
- **Cons**: May not be publicly available

#### B. Web Scraping
- **Sources**: 
  - ESPN injury report pages
  - NBA.com injury reports
  - Rotowire injury updates
- **Approach**: Parse HTML/JSON
- **Pros**: Free, comprehensive
- **Cons**: Fragile, needs maintenance

#### C. Twitter/X API
- **Approach**: Monitor team beat reporters
- **Pros**: Real-time updates
- **Cons**: Unstructured, needs NLP

---

## 7. Play-by-Play Data

### Problem
- Missing detailed play-by-play
- Missing shot locations
- Missing timeouts, substitutions

### Strategies

#### A. NBA Stats Play-by-Play Endpoint
- **Endpoint**: `playbyplayv2`
- **Approach**: Fetch detailed game events
- **Pros**: Official, comprehensive
- **Cons**: Large data volume, rate limits

#### B. Big Data Basket
- **Approach**: Public play-by-play datasets
- **Pros**: Pre-processed, easy to import
- **Cons**: May not be up-to-date

---

## 8. Team Statistics & Rankings

### Problem
- Missing team advanced stats
- Missing league rankings
- Missing team efficiency metrics

### Strategies

#### A. Calculate from Game Data
- **Approach**: Aggregate from `team_game_stats`
- **Metrics**:
  - Offensive Rating
  - Defensive Rating
  - Net Rating
  - Pace
  - Effective FG%
- **Pros**: Use existing data
- **Cons**: Limited scope

#### B. NBA Stats Team Dashboard
- **Endpoint**: `teamdashboardbygeneralsplits`
- **Approach**: Fetch team advanced metrics
- **Pros**: Official advanced stats
- **Cons**: Rate limits

---

## 9. Implementation Priority

### Phase 1: Quick Wins (This Week)
1. ✅ Retry script for delayed box scores
2. ⏳ Historical box score backfill (last 30 days)
3. ⏳ Calculate basic advanced stats from existing data

### Phase 2: Medium-term (Next 2 Weeks)
4. ⏳ Integrate BallDontLie as backup box score source
5. ⏳ Historical game data backfill (current season)
6. ⏳ Player profile enrichment (photos, bios)

### Phase 3: Long-term (Next Month)
7. ⏳ Play-by-play data integration
8. ⏳ Advanced statistics endpoints
9. ⏳ Betting odds integration (if budget allows)

---

## 10. Data Quality Strategies

### A. Data Validation
- **Zod schemas**: Validate all incoming data
- **Cross-reference**: Compare multiple sources
- **Anomaly detection**: Flag unusual values

### B. Data Completeness Tracking
- **Metrics**: Track % complete for each data type
- **Alerts**: Notify when completeness drops
- **Dashboard**: Visualize data gaps

### C. Automated Backfilling
- **Scheduled jobs**: Daily/weekly backfill runs
- **Retry logic**: Exponential backoff for failures
- **Monitoring**: Track success rates

---

## 11. Cost-Benefit Analysis

### Free Options
- ✅ NBA.com scraping (current)
- ✅ Basketball Reference scraping
- ✅ Public datasets (Kaggle, GitHub)
- ⚠️ Legal/ToS considerations

### Paid Options
- 💰 BallDontLie API: ~$50-100/month
- 💰 The Odds API: ~$50-200/month
- 💰 API-Sports: ~$30-100/month
- 💰 Stats Perform: Enterprise pricing

### Hybrid Approach
- Use free sources for core data
- Use paid sources for critical/complex data
- Fallback chains: Try free first, then paid

---

## 12. Technical Implementation Ideas

### A. Data Pipeline Architecture
```
External APIs → Validation Layer → Staging Tables → Production Tables
                    ↓
              Error Handling & Retry
                    ↓
              Monitoring & Alerts
```

### B. Caching Strategy
- **Redis**: Cache frequently accessed data
- **TTL**: Set appropriate expiration times
- **Invalidation**: Clear cache on updates

### C. Incremental Updates
- **Change detection**: Only fetch new/changed data
- **Delta processing**: Process only differences
- **Efficient queries**: Use date ranges, filters

---

## 13. Monitoring & Alerting

### Key Metrics to Track
- Box score completeness %
- Data freshness (time since last update)
- API success rates
- Data quality scores
- Missing data counts by type

### Alert Triggers
- Box score completeness < 95%
- No updates in 24+ hours
- API error rate > 10%
- Data anomalies detected

---

## Next Steps

1. **Prioritize**: Which data gaps are most critical?
2. **Prototype**: Test 1-2 strategies from Phase 1
3. **Measure**: Track current data completeness
4. **Iterate**: Refine based on results

---

## Questions to Consider

1. **Budget**: What's the monthly budget for data sources?
2. **Timeline**: How quickly do we need data?
3. **Completeness**: What % completeness is acceptable?
4. **Legal**: Are we comfortable with web scraping?
5. **Maintenance**: How much ongoing maintenance can we handle?


