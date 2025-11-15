"""Test script to check quarter data fetching for specific games."""
import os
from dotenv import load_dotenv
import psycopg
from nba_api.stats.endpoints import BoxScoreSummaryV2

load_dotenv()

conn = psycopg.connect(os.getenv('SUPABASE_DB_URL'))

# Get a game for team 1
game_id = '0022500082'
print(f"Checking game {game_id}...")

# Get team mapping for this game
game_info = conn.execute("""
    SELECT g.game_id, g.home_team_id, g.away_team_id,
           ht.provider_team_id as home_provider_id,
           at.provider_team_id as away_provider_id
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.game_id = %s
""", (game_id,)).fetchone()

if game_info:
    print(f"Game: {game_info[0]}")
    print(f"Home Team ID: {game_info[1]}, Provider ID: {game_info[3]}")
    print(f"Away Team ID: {game_info[2]}, Provider ID: {game_info[4]}")
    
    # Try to fetch quarter data
    provider_game_id = game_info[0]  # game_id is the provider game ID
    print(f"\nFetching quarter data from NBA API for {provider_game_id}...")
    try:
        endpoint = BoxScoreSummaryV2(game_id=provider_game_id)
        data = endpoint.get_normalized_dict()
        line_score = data.get('LineScore', [])
        
        if line_score:
            print(f"Found {len(line_score)} teams in LineScore:")
            for team in line_score:
                team_id = team.get('TEAM_ID')
                abbr = team.get('TEAM_ABBREVIATION')
                q1 = team.get('PTS_QTR1')
                q2 = team.get('PTS_QTR2')
                q3 = team.get('PTS_QTR3')
                q4 = team.get('PTS_QTR4')
                print(f"  Team {abbr} (ID: {team_id}): Q1={q1}, Q2={q2}, Q3={q3}, Q4={q4}")
        else:
            print("No LineScore data found")
    except Exception as e:
        print(f"Error fetching quarter data: {e}")

conn.close()

