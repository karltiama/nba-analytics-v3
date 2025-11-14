#!/usr/bin/env python3
"""Test BoxScoreTraditionalV3 team structure."""

import json
from nba_api.stats.endpoints import BoxScoreTraditionalV3

test_game_id = "0022500001"

print(f"Testing BoxScoreTraditionalV3 for game {test_game_id}...\n")

try:
    endpoint = BoxScoreTraditionalV3(game_id=test_game_id)
    data = endpoint.get_dict()
    
    boxscore = data.get("boxScoreTraditional", {})
    
    print("Game ID:", boxscore.get("gameId"))
    print("Home Team ID:", boxscore.get("homeTeamId"))
    print("Away Team ID:", boxscore.get("awayTeamId"))
    
    home_team = boxscore.get("homeTeam", {})
    away_team = boxscore.get("awayTeam", {})
    
    print(f"\nHome Team keys: {list(home_team.keys())}")
    print(f"Away Team keys: {list(away_team.keys())}")
    
    # Check for players
    if "players" in home_team:
        print(f"\nHome Team Players: {len(home_team['players'])}")
        if home_team["players"]:
            sample = home_team["players"][0]
            print(f"  Sample player keys: {list(sample.keys())[:10]}")
            print(f"  Sample player: {json.dumps(sample, indent=2, default=str)[:300]}")
    
    if "players" in away_team:
        print(f"\nAway Team Players: {len(away_team['players'])}")
        if away_team["players"]:
            sample = away_team["players"][0]
            print(f"  Sample player keys: {list(sample.keys())[:10]}")
    
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

