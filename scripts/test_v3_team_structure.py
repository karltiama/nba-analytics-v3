#!/usr/bin/env python3
"""Check V3 team structure for quarter data."""

import json
from nba_api.stats.endpoints import BoxScoreTraditionalV3

test_game_id = "0022500001"

print(f"Checking V3 team structure for game {test_game_id}...\n")

try:
    endpoint = BoxScoreTraditionalV3(game_id=test_game_id, get_request=False)
    endpoint.get_request()
    raw_response = endpoint.nba_response.get_dict()
    
    bst = raw_response.get('boxScoreTraditional', {})
    
    print("Game info:")
    print(f"  gameId: {bst.get('gameId')}")
    print(f"  homeTeamId: {bst.get('homeTeamId')}")
    print(f"  awayTeamId: {bst.get('awayTeamId')}\n")
    
    # Check homeTeam structure
    home_team = bst.get('homeTeam', {})
    print("homeTeam structure:")
    print(f"  Type: {type(home_team)}")
    if isinstance(home_team, dict):
        print(f"  Keys: {list(home_team.keys())}")
        
        # Look for quarter-related keys
        quarter_keys = [k for k in home_team.keys() if any(term in str(k).upper() for term in ['QTR', 'QUARTER', 'PERIOD', 'PTS_Q', 'SCORE'])]
        if quarter_keys:
            print(f"  [FOUND] Quarter-related keys: {quarter_keys}")
            for qk in quarter_keys:
                print(f"    {qk}: {home_team.get(qk)}")
        
        # Check if there's a periods array or similar
        for key in home_team.keys():
            value = home_team[key]
            if isinstance(value, list):
                print(f"\n  {key} (list with {len(value)} items):")
                if value and isinstance(value[0], dict):
                    print(f"    Sample item keys: {list(value[0].keys())[:10]}")
            elif isinstance(value, dict):
                print(f"\n  {key} (dict):")
                print(f"    Keys: {list(value.keys())[:10]}")
                # Check for quarter data in nested dict
                quarter_keys_nested = [k for k in value.keys() if any(term in str(k).upper() for term in ['QTR', 'QUARTER', 'PERIOD', 'PTS_Q'])]
                if quarter_keys_nested:
                    print(f"    [FOUND] Quarter keys: {quarter_keys_nested}")
    
    print("\n" + "="*60)
    print("Full homeTeam structure (first 500 chars):")
    print("="*60)
    print(json.dumps(home_team, indent=2, default=str)[:500])
    
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()


