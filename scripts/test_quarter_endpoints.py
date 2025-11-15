#!/usr/bin/env python3
"""Test different NBA API endpoints to find quarter-by-quarter data."""
import logging
from nba_api.stats.endpoints import (
    BoxScoreSummaryV2,
    BoxScoreTraditionalV2,
    BoxScoreTraditionalV3,
    BoxScoreAdvancedV2,
    BoxScoreScoringV2,
    PlayByPlayV2,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Test with a game that currently doesn't have quarter data
test_game_id = "0022500082"  # Atlanta Hawks game

endpoints_to_test = [
    ("BoxScoreSummaryV2", BoxScoreSummaryV2),
    ("BoxScoreTraditionalV2", BoxScoreTraditionalV2),
    ("BoxScoreTraditionalV3", BoxScoreTraditionalV3),
    ("BoxScoreAdvancedV2", BoxScoreAdvancedV2),
    ("BoxScoreScoringV2", BoxScoreScoringV2),
    ("PlayByPlayV2", PlayByPlayV2),
]

print(f"Testing endpoints for quarter data in game {test_game_id}...\n")

for name, endpoint_class in endpoints_to_test:
    print(f"{'='*60}")
    print(f"{name}:")
    print(f"{'='*60}")
    try:
        endpoint = endpoint_class(game_id=test_game_id)
        data = endpoint.get_normalized_dict()
        
        # Check what keys are available
        keys = list(data.keys())
        print(f"Available data keys: {keys}\n")
        
        # Check for quarter-related data
        quarter_found = False
        
        # Check LineScore (from BoxScoreSummaryV2)
        if "LineScore" in data:
            line_score = data["LineScore"]
            print(f"LineScore found: {len(line_score)} teams")
            if line_score:
                team = line_score[0]
                q1 = team.get("PTS_QTR1")
                q2 = team.get("PTS_QTR2")
                q3 = team.get("PTS_QTR3")
                q4 = team.get("PTS_QTR4")
                print(f"  Sample team ({team.get('TEAM_ABBREVIATION')}):")
                print(f"    Q1: {q1}, Q2: {q2}, Q3: {q3}, Q4: {q4}")
                if q1 is not None or q2 is not None or q3 is not None or q4 is not None:
                    quarter_found = True
        
        # Check GameSummary (from BoxScoreSummaryV2)
        if "GameSummary" in data:
            game_summary = data["GameSummary"]
            print(f"GameSummary found: {len(game_summary)} items")
            if game_summary:
                sample = game_summary[0]
                print(f"  Sample keys: {list(sample.keys())[:10]}")
                # Check for quarter fields
                quarter_keys = [k for k in sample.keys() if 'QTR' in k or 'QUARTER' in k]
                if quarter_keys:
                    print(f"  Quarter-related keys: {quarter_keys}")
                    quarter_found = True
        
        # Check PlayByPlay for quarter-by-quarter breakdown
        if "PlayByPlay" in data:
            play_by_play = data["PlayByPlay"]
            print(f"PlayByPlay found: {len(play_by_play)} events")
            if play_by_play:
                # Check if we can derive quarters from play-by-play
                quarters = set()
                for event in play_by_play[:10]:  # Check first 10 events
                    period = event.get("PERIOD")
                    if period:
                        quarters.add(period)
                print(f"  Periods found: {sorted(quarters)}")
                if quarters:
                    quarter_found = True
        
        # Check other potential quarter fields
        for key in keys:
            if isinstance(data[key], list) and len(data[key]) > 0:
                sample = data[key][0]
                if isinstance(sample, dict):
                    quarter_keys = [k for k in sample.keys() if 'QTR' in k.upper() or 'QUARTER' in k.upper() or 'PERIOD' in k.upper()]
                    if quarter_keys:
                        print(f"\n{key} has quarter-related fields: {quarter_keys}")
                        quarter_found = True
        
        if not quarter_found:
            print("  [X] No quarter data found in this endpoint")
        else:
            print("  [OK] Quarter data found!")
                    
    except Exception as e:
        print(f"  [ERROR] {e}")
        import traceback
        traceback.print_exc()
    
    print()

print("\n" + "="*60)
print("Summary: Check which endpoints have quarter data available")
print("="*60)

