#!/usr/bin/env python3
"""Test different NBA API endpoints to find quarter data for games that don't have it in BoxScoreSummaryV2."""

import json
from nba_api.stats.endpoints import (
    BoxScoreSummaryV2,
    PlayByPlayV2,
    BoxScoreTraditionalV3,
)

# Test games: one with quarter data, one without
games_to_test = [
    ("0022500001", "Has quarter data"),
    ("0022500082", "Missing quarter data"),
]

print("Testing different endpoints for quarter data...\n")

for game_id, description in games_to_test:
    print(f"{'='*60}")
    print(f"Game {game_id} ({description})")
    print(f"{'='*60}\n")
    
    # Test 1: BoxScoreSummaryV2 (current endpoint)
    print("1. BoxScoreSummaryV2:")
    try:
        endpoint = BoxScoreSummaryV2(game_id=game_id)
        data = endpoint.get_normalized_dict()
        line_score = data.get("LineScore", [])
        if line_score:
            print(f"   Found {len(line_score)} teams")
            for team in line_score:
                q1 = team.get("PTS_QTR1")
                q2 = team.get("PTS_QTR2")
                q3 = team.get("PTS_QTR3")
                q4 = team.get("PTS_QTR4")
                print(f"   Team {team.get('TEAM_ABBREVIATION')}: Q1={q1}, Q2={q2}, Q3={q3}, Q4={q4}")
        else:
            print("   No LineScore data")
    except Exception as e:
        print(f"   ERROR: {e}")
    
    print()
    
    # Test 2: PlayByPlayV2 (might have quarter scores)
    print("2. PlayByPlayV2:")
    try:
        endpoint = PlayByPlayV2(game_id=game_id)
        data = endpoint.get_normalized_dict()
        plays = data.get("PlayByPlay", [])
        print(f"   Found {len(plays)} plays")
        
        # Look for period-end events or score summaries
        period_ends = [p for p in plays if p.get("EVENTMSGTYPE") == 13]  # Period end
        print(f"   Period end events: {len(period_ends)}")
        
        # Check if there's a way to get quarter scores from play-by-play
        # Look for score changes at period boundaries
        if plays:
            # Group by period
            periods = {}
            for play in plays:
                period = play.get("PERIOD")
                if period:
                    if period not in periods:
                        periods[period] = []
                    periods[period].append(play)
            
            print(f"   Periods found: {sorted(periods.keys())}")
            
            # Try to find final score for each period
            for period in sorted(periods.keys())[:4]:  # Q1-Q4
                period_plays = periods[period]
                if period_plays:
                    # Get last play of period (should have final score)
                    last_play = period_plays[-1]
                    home_score = last_play.get("HOMEDESCRIPTION") or ""
                    visitor_score = last_play.get("VISITORDESCRIPTION") or ""
                    score = last_play.get("SCORE")
                    print(f"   Period {period}: Score={score}, Last event={last_play.get('EVENTMSGTYPE')}")
    except Exception as e:
        print(f"   ERROR: {e}")
    
    print()
    
    # Test 3: BoxScoreTraditionalV3 (check if it has any quarter info)
    print("3. BoxScoreTraditionalV3:")
    try:
        endpoint = BoxScoreTraditionalV3(game_id=game_id)
        data = endpoint.get_normalized_dict()
        print(f"   Available keys: {list(data.keys())}")
        
        # Check if there's any quarter-related data
        for key in data.keys():
            if isinstance(data[key], list) and data[key]:
                sample = data[key][0]
                if isinstance(sample, dict):
                    quarter_keys = [k for k in sample.keys() if 'QTR' in k.upper() or 'QUARTER' in k.upper()]
                    if quarter_keys:
                        print(f"   Found quarter keys in {key}: {quarter_keys}")
    except Exception as e:
        print(f"   ERROR: {e}")
    
    print("\n")

