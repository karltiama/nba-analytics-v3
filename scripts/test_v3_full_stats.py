#!/usr/bin/env python3
"""Test BoxScoreTraditionalV3 full player statistics structure."""

import json
from nba_api.stats.endpoints import BoxScoreTraditionalV3

test_game_id = "0022500001"

print(f"Testing BoxScoreTraditionalV3 for game {test_game_id}...\n")

try:
    endpoint = BoxScoreTraditionalV3(game_id=test_game_id)
    data = endpoint.get_dict()
    
    boxscore = data.get("boxScoreTraditional", {})
    home_team = boxscore.get("homeTeam", {})
    away_team = boxscore.get("awayTeam", {})
    
    print(f"Home Team: {home_team.get('teamCity')} {home_team.get('teamName')}")
    print(f"Players: {len(home_team.get('players', []))}\n")
    
    if home_team.get("players"):
        sample_player = home_team["players"][0]
        print("Sample Player:")
        print(f"  Name: {sample_player.get('firstName')} {sample_player.get('familyName')}")
        print(f"  Position: {sample_player.get('position')}")
        print(f"  Person ID: {sample_player.get('personId')}")
        
        stats = sample_player.get("statistics", {})
        print(f"\n  Statistics keys: {list(stats.keys())}")
        print(f"\n  Full statistics:")
        print(json.dumps(stats, indent=4, default=str))
    
    print(f"\n\nAway Team: {away_team.get('teamCity')} {away_team.get('teamName')}")
    print(f"Players: {len(away_team.get('players', []))}")
    
    if away_team.get("players"):
        sample_player = away_team["players"][0]
        print(f"\nSample Player: {sample_player.get('firstName')} {sample_player.get('familyName')}")
        stats = sample_player.get("statistics", {})
        print(f"  Statistics keys: {list(stats.keys())}")
    
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

