# Odds Snapshot Strategy: Pre-Game vs. Multiple Daily Snapshots

## Executive Summary

**Recommendation: Start with Pre-Game + Closing Line Only**

- ✅ **Pre-game snapshot**: Daily at 09:05 ET (1 call/day)
- ✅ **Closing line snapshot**: 5 minutes before each game (batch approach, ~1 call/day)
- ❌ **Skip intra-game/live odds**: Limited value, high cost, complex implementation

**Total Credit Usage: ~120-180 credits/month** (well under 500 quota)

---

## Option Comparison

### Option 1: Pre-Game Only (Simplest)

**Schedule:**
- 1 API call per day at 09:05 ET
- Fetch all games for the day

**Credit Usage:**
- 30 calls/month × 3-4 credits = **90-120 credits/month**

**Pros:**
- ✅ Simplest implementation
- ✅ Lowest credit usage
- ✅ Covers most use cases
- ✅ Easy to maintain

**Cons:**
- ❌ No line movement tracking
- ❌ No closing line value (CLV) analysis
- ❌ Missing industry-standard metric

**Value Score: 6/10** (Good baseline, but missing key metrics)

---

### Option 2: Pre-Game + Closing Line (Recommended)

**Schedule:**
- **Pre-game**: Daily at 09:05 ET (1 call/day)
- **Closing**: Batch approach - every 15 minutes during game hours (18:00-02:00 ET), fetch games starting in next 5-20 minutes

**Credit Usage:**
- Pre-game: 30 calls/month × 3-4 credits = 90-120 credits
- Closing: ~30 calls/month × 3-4 credits = 90-120 credits
- **Total: 180-240 credits/month** ✅

**Pros:**
- ✅ Captures closing line value (CLV) - industry standard
- ✅ Enables line movement analysis
- ✅ Still within credit quota
- ✅ Batch approach is simpler than per-game triggers
- ✅ Most valuable for historical analysis

**Cons:**
- ⚠️ Slightly more complex (2 Lambda functions)
- ⚠️ More credit usage (but still well under 500)

**Value Score: 9/10** (Best balance of value and complexity)

---

### Option 3: Pre-Game + Closing + Intra-Game (Not Recommended for MVP)

**Schedule:**
- Pre-game: Daily at 09:05 ET
- Closing: 5 minutes before each game
- Intra-game: Every 15-30 minutes during games (live odds)

**Credit Usage:**
- Pre-game: 90-120 credits
- Closing: 90-120 credits
- Intra-game: ~10 games/day × 2-3 hours × 4 calls/hour = 80-120 calls/day = **2,400-3,600 credits/month** ❌

**Pros:**
- ✅ Real-time line movement tracking
- ✅ Live betting opportunities (if you support live betting)

**Cons:**
- ❌ **Exceeds credit quota by 5-7x**
- ❌ Very complex implementation
- ❌ Limited historical value (live odds change constantly)
- ❌ Most live odds aren't useful for historical analysis
- ❌ Requires complex scheduling (games at different times)
- ❌ High storage costs (many snapshots per game)

**Value Score: 3/10** (High cost, low value for historical analysis)

---

### Option 4: Pre-Game + Mid-Day Snapshot (Alternative)

**Schedule:**
- Pre-game: Daily at 09:05 ET
- Mid-day: Daily at 12:00 PM ET (noon)

**Credit Usage:**
- Pre-game: 90-120 credits
- Mid-day: 90-120 credits
- **Total: 180-240 credits/month** ✅

**Pros:**
- ✅ Tracks line movement during the day
- ✅ Captures injury/news impact
- ✅ Simple implementation (2 daily calls)

**Cons:**
- ❌ No closing line (most important metric)
- ❌ Mid-day snapshot less valuable than closing line
- ❌ Doesn't capture final market consensus

**Value Score: 7/10** (Better than pre-game only, but closing line is more valuable)

---

## Detailed Analysis: Why Closing Line > Intra-Game

### Closing Line Value (CLV) is Industry Standard

**What is CLV?**
- The difference between odds you bet at vs. closing odds
- Industry standard for evaluating bet quality
- Used by professional bettors and sportsbooks

**Example:**
- You bet Lakers -3.5 at -110 (pre-game)
- Closing line: Lakers -4.5 at -110
- **CLV = Positive** (you got better odds than closing line)

**Why it matters:**
- If you consistently beat closing lines, you're getting value
- Closing line is the market's final consensus (most accurate)
- Used to measure betting skill vs. luck

### Intra-Game Odds Have Limited Historical Value

**Why live odds are less useful:**
1. **Constantly changing**: Lines move every few minutes during games
2. **Reactive, not predictive**: Based on current score, not future outcome
3. **High noise**: Many small movements that don't matter
4. **Storage overhead**: Need to store hundreds of snapshots per game
5. **Analysis complexity**: Hard to extract meaningful patterns

**When live odds ARE useful:**
- Real-time betting applications (not your use case)
- In-game betting strategies (not historical analysis)
- Live line shopping (comparing books in real-time)

**For historical analysis:**
- Pre-game odds: Baseline, opening line
- Closing odds: Final consensus, most accurate
- Live odds: Mostly noise, limited predictive value

---

## Credit Usage Breakdown

### Recommended Approach (Pre-Game + Closing)

| Snapshot Type | Calls/Day | Calls/Month | Credits/Call | Total Credits |
|---------------|-----------|-------------|--------------|---------------|
| Pre-game | 1 | 30 | 3-4 | 90-120 |
| Closing (batch) | ~1 | 30 | 3-4 | 90-120 |
| **Total** | **2** | **60** | **3-4** | **180-240** |

**Remaining Quota: 260-320 credits** (52-64% of quota remaining)

### If You Add Player Props

| Snapshot Type | Calls/Day | Calls/Month | Credits/Call | Total Credits |
|---------------|-----------|-------------|--------------|---------------|
| Pre-game (with props) | 1 | 30 | 3-5 | 90-150 |
| Closing (with props) | ~1 | 30 | 3-5 | 90-150 |
| **Total** | **2** | **60** | **3-5** | **180-300** |

**Remaining Quota: 200-320 credits** (40-64% of quota remaining)

**Still well under 500 credits!** ✅

---

## Implementation Complexity

### Pre-Game Only
- **Complexity: Low** ⭐
- **Lambda Functions: 1**
- **EventBridge Rules: 1** (daily cron)
- **Time to Implement: 1-2 hours**

### Pre-Game + Closing (Batch)
- **Complexity: Medium** ⭐⭐
- **Lambda Functions: 2** (pre-game + closing)
- **EventBridge Rules: 2** (daily cron + periodic during game hours)
- **Time to Implement: 3-4 hours**

### Pre-Game + Closing + Intra-Game
- **Complexity: High** ⭐⭐⭐⭐⭐
- **Lambda Functions: 3+**
- **EventBridge Rules: Complex** (per-game triggers + periodic)
- **Time to Implement: 10+ hours**
- **Maintenance: Ongoing** (handle edge cases, game delays, etc.)

---

## Recommendation: Phased Approach

### Phase 1: MVP (Now)
**Implement: Pre-Game + Closing Line (Batch)**

1. ✅ Pre-game snapshot: Daily at 09:05 ET
2. ✅ Closing snapshot: Batch approach (every 15 min during game hours)
3. ✅ Monitor credit usage for 1-2 weeks
4. ✅ Validate data quality

**Credit Usage: 180-240 credits/month**
**Time: 3-4 hours to implement**

### Phase 2: Enhancement (After MVP is stable)
**Add: Player Props**

1. ✅ Include player props in pre-game call
2. ✅ Include player props in closing call
3. ✅ Process and store player prop markets

**Credit Usage: 180-300 credits/month**
**Time: 2-3 hours to implement**

### Phase 3: Future (If needed)
**Consider: Mid-Day Snapshot**

1. ⚠️ Only if you need to track line movement during the day
2. ⚠️ Only if credit usage allows (should still be under 500)
3. ⚠️ Less valuable than closing line, but can be useful

**Credit Usage: 270-360 credits/month**
**Time: 1-2 hours to implement**

### Phase 4: Not Recommended (Skip)
**Intra-Game/Live Odds**

1. ❌ Skip for MVP
2. ❌ Only consider if you build live betting features
3. ❌ Requires significant credit quota increase

---

## Decision Matrix

| Factor | Pre-Game Only | Pre-Game + Closing | Pre-Game + Closing + Live |
|--------|---------------|-------------------|---------------------------|
| **Credit Usage** | 90-120 | 180-240 | 2,400-3,600 ❌ |
| **Complexity** | Low ⭐ | Medium ⭐⭐ | High ⭐⭐⭐⭐⭐ |
| **Historical Value** | Medium | High | Low |
| **CLV Analysis** | ❌ | ✅ | ✅ |
| **Line Movement** | ❌ | ✅ | ✅ |
| **Industry Standard** | ❌ | ✅ | ❌ |
| **Within Quota** | ✅ | ✅ | ❌ |
| **MVP Appropriate** | ✅ | ✅ | ❌ |

---

## Final Recommendation

### ✅ **Start with: Pre-Game + Closing Line (Batch Approach)**

**Why:**
1. ✅ Captures closing line value (most important metric)
2. ✅ Enables line movement analysis
3. ✅ Still within credit quota (180-240 credits/month)
4. ✅ Reasonable complexity (2 Lambda functions)
5. ✅ Industry standard approach
6. ✅ Best value-to-complexity ratio

**Implementation:**
1. Keep existing pre-game snapshot (09:05 ET daily)
2. Add closing snapshot Lambda (batch approach)
3. Run closing snapshot every 15 minutes during game hours (18:00-02:00 ET)
4. Only fetch games starting in next 5-20 minutes

**Skip for MVP:**
- ❌ Intra-game/live odds (too expensive, low value)
- ❌ Per-game EventBridge rules (too complex)
- ❌ Multiple bookmaker comparison (can add later)

---

## Next Steps

1. ✅ **Set up EventBridge for pre-game** (already planned)
2. ✅ **Implement closing line snapshot** (batch approach)
3. ✅ **Monitor credit usage** for 1-2 weeks
4. ✅ **Add player props** to both snapshots
5. ✅ **Validate data quality** and CLV calculations

**Total Estimated Credit Usage: 180-300 credits/month** (36-60% of quota)

**You'll have 200-320 credits remaining for:**
- Error retries
- Testing
- Future enhancements
- Buffer for unexpected usage

---

## Questions to Consider

1. **Do you need live/intra-game odds?**
   - If yes: You'll need to upgrade Odds API plan (500 credits won't be enough)
   - If no: Stick with pre-game + closing

2. **What's your primary use case?**
   - Historical analysis → Pre-game + closing is perfect
   - Live betting → Need intra-game odds (but exceeds quota)
   - Line movement tracking → Pre-game + closing covers this

3. **How important is CLV?**
   - Very important → Must have closing line
   - Not important → Pre-game only is fine

**For MVP and historical analysis: Pre-game + closing line is the sweet spot!** 🎯

