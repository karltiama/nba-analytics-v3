#!/usr/bin/env python3
"""Test V3 endpoints with period parameters to get quarter data."""

import json
from nba_api.stats.endpoints import BoxScoreTraditionalV3

test_game_id = "0022500001"  # Game with quarter data in V2
test_game_no_data = "0022500082"  # Game without quarter data in V2

print("Testing BoxScoreTraditionalV3 with period parameters...\n")

for game_id, description in [(test_game_id, "Has V2 data"), (test_game_no_data, "No V2 data")]:
    print(f"{'='*60}")
    print(f"Game {game_id} ({description})")
    print(f"{'='*60}\n")
    
    # Test 1: Default (all periods)
    print("1. Default (all periods):")
    try:
        endpoint = BoxScoreTraditionalV3(game_id=game_id)
        data = endpoint.get_normalized_dict()
        print(f"   Keys: {list(data.keys())}")
        if data:
            for key, value in data.items():
                if isinstance(value, list):
                    print(f"   {key}: {len(value)} items")
                    if value and isinstance(value[0], dict):
                        print(f"      Sample keys: {list(value[0].keys())[:10]}")
    except Exception as e:
        print(f"   ERROR: {e}")
    
    print()
    
    # Test 2: Specific period (Q1 = period 1)
    print("2. Period 1 (Q1) only:")
    try:
        endpoint = BoxScoreTraditionalV3(
            game_id=game_id,
            start_period='1',
            end_period='1'
        )
        data = endpoint.get_normalized_dict()
        print(f"   Keys: {list(data.keys())}")
        if data:
            for key, value in data.items():
                if isinstance(value, list):
                    print(f"   {key}: {len(value)} items")
    except Exception as e:
        print(f"   ERROR: {e}")
    
    print()
    
    # Test 3: Check raw response structure
    print("3. Raw response structure:")
    try:
        endpoint = BoxScoreTraditionalV3(game_id=game_id, get_request=False)
        endpoint.get_request()
        raw_response = endpoint.nba_response.get_dict()
        print(f"   Top-level keys: {list(raw_response.keys())[:10]}")
        
        # Check resultSets
        if 'resultSets' in raw_response:
            result_sets = raw_response['resultSets']
            print(f"   Result sets: {len(result_sets)}")
            for i, rs in enumerate(result_sets[:3]):
                print(f"      Set {i}: name='{rs.get('name')}', headers={rs.get('headers', [])[:5]}")
    except Exception as e:
        print(f"   ERROR: {e}")
    
    print("\n")


