#!/usr/bin/env python3
"""Test BoxScoreTraditionalV3 raw structure."""

import json
from nba_api.stats.endpoints import BoxScoreTraditionalV3

test_game_id = "0022500001"

print(f"Testing BoxScoreTraditionalV3 for game {test_game_id}...\n")

try:
    endpoint = BoxScoreTraditionalV3(game_id=test_game_id)
    data = endpoint.get_dict()
    
    print("Top-level keys:", list(data.keys()))
    
    if "boxScoreTraditional" in data:
        boxscore = data["boxScoreTraditional"]
        print(f"\nboxScoreTraditional keys: {list(boxscore.keys())}")
        
        if "resultSets" in boxscore:
            print("\nResultSets:")
            for rs in boxscore["resultSets"]:
                name = rs.get("name", "Unknown")
                rows = rs.get("rowSet", [])
                headers = rs.get("headers", [])
                print(f"  {name}: {len(rows)} rows, {len(headers)} columns")
                
                if rows and name == "PlayerStats":
                    print(f"    Headers: {headers[:10]}")
                    print(f"    Sample row: {rows[0][:10]}")
                    print(f"    First player: {rows[0][headers.index('PLAYER_NAME')] if 'PLAYER_NAME' in headers else 'N/A'}")
    
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

