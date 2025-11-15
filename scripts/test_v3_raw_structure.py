#!/usr/bin/env python3
"""Check raw V3 endpoint response structure for quarter data."""

import json
from nba_api.stats.endpoints import BoxScoreTraditionalV3

test_game_id = "0022500001"

print(f"Checking raw V3 response structure for game {test_game_id}...\n")

try:
    endpoint = BoxScoreTraditionalV3(game_id=test_game_id, get_request=False)
    endpoint.get_request()
    raw_response = endpoint.nba_response.get_dict()
    
    print("Raw response structure:")
    print(f"Top-level keys: {list(raw_response.keys())}\n")
    
    # Check boxScoreTraditional
    if 'boxScoreTraditional' in raw_response:
        bst = raw_response['boxScoreTraditional']
        print("boxScoreTraditional structure:")
        print(f"  Type: {type(bst)}")
        if isinstance(bst, dict):
            print(f"  Keys: {list(bst.keys())}")
            
            # Check resultSets
            if 'resultSets' in bst:
                result_sets = bst['resultSets']
                print(f"\n  Result sets: {len(result_sets)}")
                for i, rs in enumerate(result_sets):
                    name = rs.get('name', f'Set {i}')
                    headers = rs.get('headers', [])
                    row_set = rs.get('rowSet', [])
                    print(f"\n    Set {i}: {name}")
                    print(f"      Headers ({len(headers)}): {headers[:15]}")
                    print(f"      Rows: {len(row_set)}")
                    
                    # Check for quarter-related headers
                    quarter_headers = [h for h in headers if any(term in str(h).upper() for term in ['QTR', 'QUARTER', 'PERIOD', 'PTS_Q'])]
                    if quarter_headers:
                        print(f"      [FOUND] Quarter headers: {quarter_headers}")
                        if row_set:
                            print(f"      Sample row: {row_set[0][:10]}")
    
    # Also check if there's a summary or lineScore section
    print("\n" + "="*60)
    print("Checking for summary/lineScore data...")
    print("="*60)
    
    # Try to get normalized dict with different method
    try:
        # Check if there's a different method
        data_sets = endpoint.nba_response.get_data_sets()
        print(f"Data sets: {list(data_sets.keys())}")
    except Exception as e:
        print(f"get_data_sets() error: {e}")
    
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()


