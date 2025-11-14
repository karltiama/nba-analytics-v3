#!/usr/bin/env python3
"""Test BoxScoreTraditionalV3 endpoint."""

import json
from nba_api.stats.endpoints import BoxScoreTraditionalV3

test_game_id = "0022500001"

print(f"Testing BoxScoreTraditionalV3 for game {test_game_id}...\n")

try:
    endpoint = BoxScoreTraditionalV3(game_id=test_game_id)
    
    # Try get_dict() instead of get_normalized_dict()
    print("Trying get_dict()...")
    data_dict = endpoint.get_dict()
    print(f"Keys: {list(data_dict.keys())}")
    
    # Check resultSets
    if "resultSets" in data_dict:
        for rs in data_dict["resultSets"]:
            print(f"\nResultSet: {rs.get('name')}")
            print(f"  Headers: {rs.get('headers', [])[:5]}")
            print(f"  RowSet rows: {len(rs.get('rowSet', []))}")
            if rs.get('rowSet'):
                print(f"  Sample row: {rs['rowSet'][0][:5]}")
    
    # Also try get_normalized_dict()
    print("\nTrying get_normalized_dict()...")
    data_norm = endpoint.get_normalized_dict()
    print(f"Keys: {list(data_norm.keys())}")
    
    if "PlayerStats" in data_norm:
        print(f"PlayerStats: {len(data_norm['PlayerStats'])} players")
    else:
        print("No PlayerStats in normalized dict")
        
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

