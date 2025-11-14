#!/usr/bin/env python3
"""Check player resolution issues."""

import os
import psycopg
from dotenv import load_dotenv

load_dotenv()

conn = psycopg.connect(os.getenv("SUPABASE_DB_URL"))

# Check for players that failed
failed_players = [
    ("1641732", "Colby Jones"),
    ("1630644", "Mac McClung"),
    ("1629646", "Charles Bassey"),
]

print("Checking player resolution issues:\n")

for nba_id, name in failed_players:
    print(f"Player: {name} (NBA Stats ID: {nba_id})")
    
    # Check if player exists in players table
    result = conn.execute(
        "select player_id, full_name from players where full_name ilike %s",
        (f"%{name}%",),
    ).fetchall()
    
    if result:
        print(f"  Found in players table:")
        for row in result:
            print(f"    player_id: {row[0]}, name: {row[1]}")
            
            # Check provider mappings
            pm_result = conn.execute(
                """
                select provider, provider_id, internal_id
                from provider_id_map
                where entity_type = 'player' and internal_id = %s
                """,
                (row[0],),
            ).fetchall()
            
            if pm_result:
                print(f"    Provider mappings:")
                for pm_row in pm_result:
                    print(f"      {pm_row[0]}: {pm_row[1]} -> {pm_row[2]}")
    else:
        print(f"  NOT found in players table")
    
    # Check if NBA Stats mapping exists
    nba_result = conn.execute(
        """
        select internal_id
        from provider_id_map
        where entity_type = 'player' and provider = 'nba' and provider_id = %s
        """,
        (nba_id,),
    ).fetchone()
    
    if nba_result:
        print(f"  NBA Stats mapping exists: {nba_result[0]}")
    else:
        print(f"  NO NBA Stats mapping")
    
    print()

conn.close()

