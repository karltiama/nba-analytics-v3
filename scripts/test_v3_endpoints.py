#!/usr/bin/env python3
"""Test V3 endpoints for quarter data."""

import json
from nba_api.stats.endpoints import (
    BoxScoreTraditionalV3,
    BoxScoreAdvancedV3,
    BoxScoreScoringV3,
    BoxScoreUsageV3,
    BoxScoreFourFactorsV3,
    BoxScoreMiscV3,
)

# Try to import BoxScoreSummaryV3 if it exists
try:
    from nba_api.stats.endpoints import BoxScoreSummaryV3
    has_summary_v3 = True
except ImportError:
    has_summary_v3 = False
    print("BoxScoreSummaryV3 not available\n")

test_game_id = "0022500082"  # Game without quarter data in V2
test_game_with_data = "0022500001"  # Game with quarter data in V2

print("="*60)
print("Testing V3 Endpoints for Quarter Data")
print("="*60)
print()

v3_endpoints = [
    ("BoxScoreTraditionalV3", BoxScoreTraditionalV3),
    ("BoxScoreAdvancedV3", BoxScoreAdvancedV3),
    ("BoxScoreScoringV3", BoxScoreScoringV3),
    ("BoxScoreUsageV3", BoxScoreUsageV3),
    ("BoxScoreFourFactorsV3", BoxScoreFourFactorsV3),
    ("BoxScoreMiscV3", BoxScoreMiscV3),
]

if has_summary_v3:
    v3_endpoints.insert(0, ("BoxScoreSummaryV3", BoxScoreSummaryV3))

for name, endpoint_class in v3_endpoints:
    print(f"{'='*60}")
    print(f"{name}:")
    print(f"{'='*60}")
    
    try:
        # Test with game that has no quarter data in V2
        endpoint = endpoint_class(game_id=test_game_id)
        data = endpoint.get_normalized_dict()
        
        print(f"Available keys: {list(data.keys())}")
        
        # Look for quarter-related data
        quarter_found = False
        
        for key in data.keys():
            value = data[key]
            if isinstance(value, list) and len(value) > 0:
                sample = value[0]
                if isinstance(sample, dict):
                    # Check for quarter-related keys
                    quarter_keys = [k for k in sample.keys() if any(term in k.upper() for term in ['QTR', 'QUARTER', 'PERIOD', 'PTS_Q'])]
                    if quarter_keys:
                        print(f"\n  Found quarter keys in '{key}': {quarter_keys}")
                        quarter_found = True
                        
                        # Show sample data
                        if len(value) >= 2:  # Should have 2 teams
                            print(f"  Sample data:")
                            for i, item in enumerate(value[:2]):
                                team_id = item.get('TEAM_ID') or item.get('teamId') or f"Team {i+1}"
                                print(f"    {team_id}:")
                                for qk in quarter_keys[:4]:  # Show first 4 quarter keys
                                    val = item.get(qk)
                                    print(f"      {qk}: {val}")
        
        # Also check for LineScore or similar structures
        if "LineScore" in data:
            line_score = data["LineScore"]
            print(f"\n  LineScore found: {len(line_score)} teams")
            if line_score:
                team = line_score[0]
                q1 = team.get("PTS_QTR1") or team.get("ptsQtr1")
                q2 = team.get("PTS_QTR2") or team.get("ptsQtr2")
                q3 = team.get("PTS_QTR3") or team.get("ptsQtr3")
                q4 = team.get("PTS_QTR4") or team.get("ptsQtr4")
                print(f"    Q1: {q1}, Q2: {q2}, Q3: {q3}, Q4: {q4}")
                if q1 is not None or q2 is not None:
                    quarter_found = True
        
        if not quarter_found:
            print("  [X] No quarter data found")
        else:
            print("  [OK] Quarter data found!")
            
    except Exception as e:
        print(f"  [ERROR] {e}")
        import traceback
        traceback.print_exc()
    
    print()

print("="*60)
print("Summary")
print("="*60)
print("Check which V3 endpoints have quarter data available")


