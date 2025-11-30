# Odds API Credit Usage Analysis

## Current Usage (Team Odds Only)

- **API Calls**: 1 per day (single request for all games)
- **Credits per Call**: 3 credits
- **Monthly Usage**: 30 days × 3 credits = **90 credits/month**
- **Remaining Quota**: 500 - 90 = **410 credits available**

## Adding Player Props

### Option 1: Include in Same API Call (Recommended)

**Implementation:**
- Modify `markets` parameter to include player props
- Change: `markets=h2h,spreads,totals` 
- To: `markets=h2h,spreads,totals,player_points,player_rebounds,player_assists`

**Credit Cost Scenarios:**

| Scenario | Credits/Call | Monthly Usage | Status |
|----------|--------------|---------------|--------|
| **A: Same cost** (most likely) | 3 | 90 credits | ✅ Well under 500 |
| **B: Slightly higher** | 4-5 | 120-150 credits | ✅ Still under 500 |
| **C: Double cost** (unlikely) | 6 | 180 credits | ✅ Still under 500 |

**Advantages:**
- ✅ Single API call (efficient)
- ✅ All data in one response
- ✅ Minimal code changes
- ✅ Likely same credit cost

**Disadvantages:**
- ⚠️ Larger response payload (more data to process)
- ⚠️ Slightly longer processing time

### Option 2: Separate API Call (Not Recommended)

**Implementation:**
- Make 2 API calls: one for team odds, one for player props
- Would double credit usage: 90 × 2 = **180 credits/month**

**Why Not Recommended:**
- ❌ Wastes credits unnecessarily
- ❌ More complex code
- ❌ Two separate requests (slower)

## Monthly Credit Budget Breakdown

### Conservative Estimate (4 credits/call with player props)

| Item | Credits | Notes |
|------|---------|-------|
| Pre-game snapshots (daily) | 120 | 30 days × 4 credits |
| Buffer for errors/retries | 50 | ~10% buffer |
| **Total** | **170** | **Well under 500** |

### Worst Case (6 credits/call with player props)

| Item | Credits | Notes |
|------|---------|-------|
| Pre-game snapshots (daily) | 180 | 30 days × 6 credits |
| Buffer for errors/retries | 50 | ~10% buffer |
| **Total** | **230** | **Still under 500** |

## Future Considerations

### If You Add Closing Odds Snapshots

**Current Plan:**
- Pre-game: 1 call/day = 30 calls/month
- Closing: ~10 games/day × 1 call = 300 calls/month (if done per-game)
- **Total: 330 calls/month**

**Credit Usage:**
- At 3 credits/call: 990 credits/month ❌ **Exceeds 500**
- At 4 credits/call: 1,320 credits/month ❌ **Exceeds 500**

**Solutions:**
1. **Batch closing odds** (recommended): Fetch all closing odds in 1 call instead of per-game
   - Pre-game: 30 calls
   - Closing: 30 calls (1 per day for all games)
   - **Total: 60 calls/month = 180-240 credits** ✅

2. **Selective closing odds**: Only fetch closing odds for games with bets
   - Reduces calls but adds complexity

3. **Upgrade plan**: If you need more credits, consider upgrading Odds API plan

## Recommendations

### Immediate (MVP)
1. ✅ **Add player props to existing API call** (same endpoint)
2. ✅ **Monitor credit usage** in Odds API dashboard
3. ✅ **Set up EventBridge** for daily automation
4. ✅ **Track actual credit usage** for first week

### Short-term (1-2 months)
1. ✅ **Validate credit cost** with player props included
2. ✅ **Implement closing odds** using batch approach (1 call/day)
3. ✅ **Add error handling** to prevent wasted credits on retries

### Long-term (if needed)
1. ⚠️ **Consider upgrading** Odds API plan if usage exceeds 500 credits
2. ⚠️ **Optimize** by only fetching markets you actually use
3. ⚠️ **Cache** responses if possible (though Lambda cold starts make this less useful)

## Monitoring

### Track Credit Usage
- Check Odds API dashboard weekly
- Set up alerts if usage exceeds 400 credits/month (80% threshold)
- Log credit usage in CloudWatch metrics

### Key Metrics to Monitor
- API calls per day
- Credits used per call
- Total credits used per month
- Error rate (failed calls waste credits)

## Conclusion

**Yes, you can easily fit within 500 credits/month** by:
1. Including player props in the same API call (likely 3-4 credits/call)
2. Using batch approach for closing odds (if implemented)
3. Monitoring usage to catch any unexpected increases

**Estimated Monthly Usage:**
- **Best case**: 90 credits (same as current)
- **Realistic**: 120-150 credits (with player props)
- **Worst case**: 180 credits (if credits double)

All scenarios are well under your 500 credit quota! 🎉

