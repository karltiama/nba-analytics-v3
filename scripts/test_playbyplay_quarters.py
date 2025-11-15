#!/usr/bin/env python3
"""Test if we can derive quarter scores from PlayByPlayV2 data."""

from nba_api.stats.endpoints import PlayByPlayV2

# Test games
games_to_test = [
    ("0022500001", "Has quarter data in Summary"),
    ("0022500082", "Missing quarter data in Summary"),
]

for game_id, description in games_to_test:
    print(f"{'='*60}")
    print(f"Game {game_id} ({description})")
    print(f"{'='*60}\n")
    
    try:
        endpoint = PlayByPlayV2(game_id=game_id)
        data = endpoint.get_normalized_dict()
        
        # PlayByPlayV2 returns data differently
        result_sets = data.get("resultSets", [])
        print(f"Result sets: {len(result_sets)}")
        
        for i, result_set in enumerate(result_sets):
            name = result_set.get("name", f"Set {i}")
            headers = result_set.get("rowSet", [])
            rows = result_set.get("rowSet", [])
            print(f"\n{name}:")
            if rows:
                print(f"  Rows: {len(rows)}")
                print(f"  Sample row: {rows[0] if rows else 'N/A'}")
        
        # Try alternative access
        if "PlayByPlay" in data:
            plays = data["PlayByPlay"]
            print(f"\nPlayByPlay found: {len(plays)} plays")
            
            # Group by period and find scores at period end
            periods = {}
            for play in plays:
                period = play.get("PERIOD")
                if period:
                    if period not in periods:
                        periods[period] = []
                    periods[period].append(play)
            
            print(f"\nPeriods found: {sorted(periods.keys())}")
            
            # Try to extract quarter scores
            for period in sorted(periods.keys())[:4]:  # Q1-Q4
                period_plays = periods[period]
                if period_plays:
                    # Find period end event (EVENTMSGTYPE 13)
                    period_end = [p for p in period_plays if p.get("EVENTMSGTYPE") == 13]
                    if period_end:
                        last_event = period_end[-1]
                        print(f"  Period {period} end:")
                        print(f"    Home score: {last_event.get('SCORE')}")
                        print(f"    Event: {last_event.get('HOMEDESCRIPTION') or last_event.get('VISITORDESCRIPTION')}")
                    else:
                        # Use last play of period
                        last_play = period_plays[-1]
                        score = last_play.get("SCORE")
                        print(f"  Period {period} (no end event): Last score = {score}")
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n")

