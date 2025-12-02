# Resolving Unresolved Players Guide

## Two Scenarios

### Scenario 1: Player Already Exists in Database ✅

If a player exists in the database but wasn't auto-matched (due to name variations, special characters, etc.), use the **interactive resolver** to match them manually.

#### Steps:

1. **Check if player exists:**
   ```bash
   tsx scripts/check-unresolved-vs-database.ts
   ```
   This will show which unresolved players have potential matches in the database.

2. **Use interactive resolver:**
   ```bash
   tsx scripts/resolve-missing-player-ids.ts
   ```

3. **When prompted:**
   - The script will show candidate players from the same team
   - Enter the `player_id` of the correct player
   - Or type `skip` to skip this player

#### Example:
```
📋 Player: Monte Morris (IND)
   Games: 1
   ⚠️  No auto-match found. Candidates from IND:
      1. Monte Morris (1628420)
      2. T.J. McConnell (1626192)
      ...
   Enter player_id to assign (or 'skip'): 1628420
   ✅ Updated 1 records
```

---

### Scenario 2: Player Doesn't Exist in Database ❌

If a player doesn't exist in the database, you need to **add them first**, then resolve.

#### Steps:

1. **Add the player:**
   ```bash
   tsx scripts/add-unresolved-players.ts
   ```

2. **When prompted:**
   - Review the suggested player_id (auto-generated from name)
   - Press Enter to use suggested ID, or enter a custom ID
   - The script will:
     - Add player to `players` table
     - Add player to `player_team_rosters` table
     - Update `scraped_boxscores` with the new player_id

3. **After adding, verify:**
   ```bash
   tsx scripts/resolve-missing-player-ids.ts --auto
   ```
   This will auto-resolve any newly added players.

#### Example:
```
📋 Player: Jamaree Bouyea (PHO)
   Games: 6
   Suggested ID: bouyea_j_pho
   
   Add this player? (y/n/skip): y
   Enter player_id (or press Enter to use 'bouyea_j_pho'): 
   ✅ Added player with ID: bouyea_j_pho
   ✅ Updated 6 records in scraped_boxscores
```

---

## Quick Reference

### Check Status
```bash
# List all unresolved players
tsx scripts/list-unresolved-players.ts

# Check if they exist in database
tsx scripts/check-unresolved-vs-database.ts
```

### Resolve Existing Players
```bash
# Interactive mode (shows candidates, lets you choose)
tsx scripts/resolve-missing-player-ids.ts

# Auto mode (tries to match automatically)
tsx scripts/resolve-missing-player-ids.ts --auto
```

### Add New Players
```bash
# Interactive mode (adds players one by one)
tsx scripts/add-unresolved-players.ts
```

---

## Workflow Summary

```
┌─────────────────────────────────────┐
│  Unresolved Players Found           │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Check if exists?     │
    └──┬───────────────┬───┘
       │               │
    YES│               │NO
       │               │
       ▼               ▼
┌─────────────┐  ┌──────────────┐
│ Interactive │  │ Add Player   │
│ Resolver    │  │ First        │
└─────────────┘  └──────┬───────┘
                        │
                        ▼
                 ┌──────────────┐
                 │ Auto Resolve │
                 └──────────────┘
```

---

## Tips

1. **Always check first:** Run `check-unresolved-vs-database.ts` to see which players exist
2. **Use auto mode first:** Try `--auto` flag - it resolves many cases automatically
3. **Interactive for edge cases:** Use interactive mode when auto-mode fails
4. **Add missing players:** Only add players that truly don't exist (new rookies, etc.)

---

## Common Issues

### Issue: "No candidates found"
**Solution:** Player doesn't exist - use `add-unresolved-players.ts` to add them

### Issue: "Multiple candidates, not sure which one"
**Solution:** 
- Check the team abbreviation matches
- Check the full name similarity
- Use Basketball Reference to verify the correct player

### Issue: "Player exists but wrong team"
**Solution:** 
- The player might have been traded
- Check if they're on a different team in the roster
- You may need to update the roster or match manually


