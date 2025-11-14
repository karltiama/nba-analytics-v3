#!/usr/bin/env python3
"""Test fetching box scores from a past game that should definitely be Final."""

import logging
from nba_api.stats.endpoints import scoreboardv2, boxscoretraditionalv2

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Test the first day of 2025-26 season
test_date = "10/21/2025"

print(f"Fetching scoreboard for {test_date}...")
try:
    endpoint = scoreboardv2.ScoreboardV2(game_date=test_date)
    data = endpoint.get_normalized_dict()
    
    games = data.get("GameHeader", [])
    print(f"\nFound {len(games)} games")
    
    # Show all games and their statuses
    print("\nAll games:")
    for game in games:
        game_id = game.get("GAME_ID")
        status_id = game.get("GAME_STATUS_ID", 0)
        status_text = game.get("GAME_STATUS_TEXT", "Unknown")
        print(f"  Game {game_id}: {status_text} (status_id={status_id})")
        
        # Try fetching box score regardless of status
        print(f"    Attempting to fetch box score...")
        try:
            boxscore = boxscoretraditionalv2.BoxScoreTraditionalV2(game_id=game_id)
            boxscore_data = boxscore.get_normalized_dict()
            player_stats = boxscore_data.get("PlayerStats", [])
            
            if player_stats:
                print(f"    [OK] Success! Found {len(player_stats)} player stats")
                print(f"    Sample player: {player_stats[0].get('PLAYER_NAME')} - {player_stats[0].get('PTS')} pts")
            else:
                print(f"    [FAIL] No player stats returned (empty array)")
        except Exception as e:
            print(f"    [ERROR] Failed: {e}")
            import traceback
            traceback.print_exc()
        
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

