#!/usr/bin/env python3
"""Test different NBA Stats boxscore endpoints to see which ones return data."""

import logging
from nba_api.stats.endpoints import (
    BoxScoreSummaryV2,
    BoxScoreTraditionalV2,
    BoxScoreTraditionalV3,
    BoxScoreAdvancedV2,
    BoxScoreScoringV2,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

test_game_id = "0022500001"

endpoints_to_test = [
    ("BoxScoreSummaryV2", BoxScoreSummaryV2),
    ("BoxScoreTraditionalV2", BoxScoreTraditionalV2),
    ("BoxScoreTraditionalV3", BoxScoreTraditionalV3),
    ("BoxScoreAdvancedV2", BoxScoreAdvancedV2),
    ("BoxScoreScoringV2", BoxScoreScoringV2),
]

print(f"Testing boxscore endpoints for game {test_game_id}...\n")

for name, endpoint_class in endpoints_to_test:
    print(f"{name}:")
    try:
        endpoint = endpoint_class(game_id=test_game_id)
        data = endpoint.get_normalized_dict()
        
        # Check what keys are available
        keys = list(data.keys())
        print(f"  Available data keys: {keys}")
        
        # Check for player stats
        if "PlayerStats" in data:
            player_stats = data["PlayerStats"]
            print(f"  PlayerStats: {len(player_stats)} players")
            if player_stats:
                print(f"    Sample: {player_stats[0].get('PLAYER_NAME', 'N/A')}")
        elif "GameSummary" in data:
            print(f"  GameSummary available")
        elif "LineScore" in data:
            print(f"  LineScore available")
        else:
            # Show first few keys with sample data
            for key in keys[:3]:
                value = data[key]
                if isinstance(value, list):
                    print(f"  {key}: {len(value)} items")
                else:
                    print(f"  {key}: {type(value).__name__}")
                    
    except Exception as e:
        print(f"  [ERROR] {e}")
    
    print()

