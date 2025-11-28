# Odds Data Best Practices

Quick reference guide for maintaining high-quality historical odds data.

---

## Data Collection

### ✅ DO

1. **Always capture closing odds** - Most valuable snapshot
2. **Use consistent bookmaker** - DraftKings default
3. **Store complete snapshots** - All markets at same timestamp
4. **Handle missing data gracefully** - Use NULL, log issues
5. **Make operations idempotent** - Safe to re-run
6. **Monitor data quality** - Track completeness daily
7. **Log everything** - Staging events for debugging

### ❌ DON'T

1. **Don't mix bookmakers** - Inconsistent data
2. **Don't skip snapshots** - Even if partial data
3. **Don't use zeros for missing** - Use NULL
4. **Don't overwrite historical data** - Use snapshot_type
5. **Don't calculate in UI** - Precompute and store

---

## Snapshot Timing

| Snapshot | When | Purpose | Priority |
|----------|------|---------|----------|
| Pre-game | 09:05 ET daily | Baseline for movement | High |
| Closing | 5 min before start | Market consensus | **Critical** |
| Mid-day | 12:00 ET (optional) | Track movement | Low |

---

## Data Quality Metrics

**Track Daily:**
- % games with pre-game odds: Target >95%
- % games with closing odds: Target >90%
- % games with all 3 market types: Target >90%
- Average markets per game: Target 6+ (2 moneyline + 2 spread + 2 total)

**Alert If:**
- <80% games have complete pre-game odds
- <70% games have closing odds
- >10% of snapshots fail

---

## Query Patterns

### Get Latest Odds for Game
```sql
SELECT * FROM markets
WHERE game_id = $1
  AND snapshot_type = 'pre_game'
  AND bookmaker = 'draftkings'
ORDER BY fetched_at DESC;
```

### Compare Pre-Game vs Closing
```sql
SELECT 
  m_pre.line as opening,
  m_closing.line as closing,
  (m_closing.line - m_pre.line) as movement
FROM markets m_pre
JOIN markets m_closing ON m_pre.game_id = m_closing.game_id
WHERE m_pre.snapshot_type = 'pre_game'
  AND m_closing.snapshot_type = 'closing'
  AND m_pre.market_type = m_closing.market_type;
```

---

## Common Issues & Solutions

### Issue: Missing Closing Odds

**Cause:** Game started early, Lambda didn't run, API error

**Solution:**
- Check EventBridge logs
- Re-run closing snapshot manually if <5 min after start
- Accept missing data, log for analysis

### Issue: Duplicate Snapshots

**Cause:** Lambda ran twice, unique constraint not working

**Solution:**
- Verify unique constraint exists
- Check UPSERT logic
- Clean duplicates manually if needed

### Issue: Wrong Game Matched

**Cause:** Team name mismatch, date/timezone issue

**Solution:**
- Verify team mapping
- Check date conversion (UTC vs ET)
- Review staging_events for raw data

---

_Last updated: 2025-01-15_

