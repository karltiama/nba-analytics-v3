# Schema Validation for Player Props

## Current Schema Status

### ✅ Fields That Support Player Props

1. **`stat_type` (TEXT)**
   - ✅ Can store any value (no constraint)
   - ✅ Supports: 'points', 'rebounds', 'assists', 'threes', 'blocks'
   - ✅ Supports: 'double_double', 'triple_double', 'first_basket'
   - **Status: GOOD** ✅

2. **`stat_line` (NUMERIC, nullable)**
   - ✅ Can be NULL (required for Yes/No bets)
   - ✅ Stores Over/Under lines (e.g., 25.5 for points)
   - ✅ NULL for Yes/No bets (double_double, triple_double, first_basket)
   - **Status: GOOD** ✅

3. **`side` (TEXT)**
   - ✅ Constraint allows: 'over', 'under', 'yes', 'no' for player_prop
   - ✅ Supports Over/Under bets (points, rebounds, etc.)
   - ✅ Supports Yes/No bets (double_double, triple_double, first_basket)
   - **Status: GOOD** ✅

4. **`player_id` (TEXT, references players)**
   - ✅ Required for player_prop (enforced by constraint)
   - ✅ Links to players table
   - **Status: GOOD** ✅

### Schema Constraints

```sql
-- ✅ Allows 'yes' | 'no' for player props
constraint markets_side_check check (
  (market_type = 'player_prop' and side in ('over', 'under', 'yes', 'no')) or
  ...
)

-- ✅ Requires player_id and stat_type for player props
constraint markets_player_prop_check check (
  (market_type = 'player_prop' and player_id is not null and stat_type is not null) or
  (market_type != 'player_prop' and player_id is null)
)
```

## Player Prop Types We're Storing

### Over/Under Props (have `stat_line`)
- `player_points` → stat_type: 'points', side: 'over'/'under', stat_line: 25.5
- `player_rebounds` → stat_type: 'rebounds', side: 'over'/'under', stat_line: 11.5
- `player_assists` → stat_type: 'assists', side: 'over'/'under', stat_line: 4.5
- `player_threes` → stat_type: 'threes', side: 'over'/'under', stat_line: 3.5
- `player_blocks` → stat_type: 'blocks', side: 'over'/'under', stat_line: 1.5

### Yes/No Props (no `stat_line`, NULL)
- `player_double_double` → stat_type: 'double_double', side: 'yes'/'no', stat_line: NULL
- `player_triple_double` → stat_type: 'triple_double', side: 'yes'/'no', stat_line: NULL
- `player_first_basket` → stat_type: 'first_basket', side: 'yes'/'no', stat_line: NULL

## Schema Compatibility Check

| Field | Over/Under Props | Yes/No Props | Status |
|-------|-----------------|--------------|--------|
| `stat_type` | ✅ 'points', 'rebounds', etc. | ✅ 'double_double', etc. | ✅ GOOD |
| `stat_line` | ✅ 25.5, 11.5, etc. | ✅ NULL | ✅ GOOD |
| `side` | ✅ 'over'/'under' | ✅ 'yes'/'no' | ✅ GOOD |
| `player_id` | ✅ Required | ✅ Required | ✅ GOOD |

## Conclusion

**✅ Your schema is fully updated and ready for all player prop types!**

The schema supports:
- ✅ Over/Under props (points, rebounds, assists, threes, blocks)
- ✅ Yes/No props (double_double, triple_double, first_basket)
- ✅ NULL stat_line for Yes/No bets
- ✅ 'yes'/'no' side values for Yes/No bets
- ✅ All stat_type values (TEXT field, no restrictions)

**No schema changes needed!** 🎉

---

_Last updated: 2025-11-29_

