#!/usr/bin/env python3
"""Test BoxScoreSummaryV2 to see what data it contains."""

import json
from nba_api.stats.endpoints import BoxScoreSummaryV2

test_game_id = "0022500001"

print(f"Fetching BoxScoreSummaryV2 for game {test_game_id}...\n")

try:
    endpoint = BoxScoreSummaryV2(game_id=test_game_id)
    data = endpoint.get_normalized_dict()
    
    print("Available sections:")
    for key in data.keys():
        value = data[key]
        if isinstance(value, list):
            print(f"  {key}: {len(value)} items")
            if value and len(value) > 0:
                print(f"    Sample: {json.dumps(value[0], indent=6, default=str)[:200]}...")
        elif isinstance(value, dict):
            print(f"  {key}: dict with keys {list(value.keys())[:5]}")
        else:
            print(f"  {key}: {type(value).__name__}")
    
    # Check LineScore for team totals
    if "LineScore" in data:
        print("\nLineScore (team totals by quarter):")
        for team in data["LineScore"]:
            print(f"  Team {team.get('TEAM_ID')}: Q1={team.get('PTS_QTR1')}, Q2={team.get('PTS_QTR2')}, Q3={team.get('PTS_QTR3')}, Q4={team.get('PTS_QTR4')}, Total={team.get('PTS')}")
    
    # Check GameSummary
    if "GameSummary" in data:
        print("\nGameSummary:")
        summary = data["GameSummary"]
        if isinstance(summary, list) and summary:
            print(json.dumps(summary[0], indent=2, default=str))
        else:
            print(summary)
            
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

