#!/usr/bin/env python3
"""Test NBA Stats scoreboard to see what games are available."""

import logging
from datetime import datetime

from nba_api.stats.endpoints import scoreboardv2

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Try a recent date that should have games
test_date = "10/21/2025"

print(f"Fetching scoreboard for {test_date}...")
try:
    endpoint = scoreboardv2.ScoreboardV2(game_date=test_date)
    data = endpoint.get_normalized_dict()
    
    games = data.get("GameHeader", [])
    print(f"\nFound {len(games)} games")
    
    for game in games[:5]:
        print(f"\nGame ID: {game.get('GAME_ID')}")
        print(f"  Status: {game.get('GAME_STATUS_TEXT')} (ID: {game.get('GAME_STATUS_ID')})")
        print(f"  Home: {game.get('HOME_TEAM_ID')} vs Away: {game.get('VISITOR_TEAM_ID')}")
        print(f"  Season: {game.get('SEASON')}")
        
        # Try fetching box score for this game
        game_id = game.get("GAME_ID")
        status_id = game.get("GAME_STATUS_ID", 0)
        
        if status_id >= 2:  # Game started or finished
            print(f"  Attempting to fetch box score...")
            try:
                from nba_api.stats.endpoints import boxscoretraditionalv2
                boxscore = boxscoretraditionalv2.BoxScoreTraditionalV2(game_id=game_id)
                boxscore_data = boxscore.get_normalized_dict()
                player_stats = boxscore_data.get("PlayerStats", [])
                print(f"  ✓ Box score available: {len(player_stats)} players")
            except Exception as e:
                print(f"  ✗ Box score failed: {e}")
        else:
            print(f"  Game not started yet (status_id={status_id})")
            
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

