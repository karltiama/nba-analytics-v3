#!/usr/bin/env python3
"""
Test script to seed box scores for the first game on 10/21/25.

This script:
1. Finds the first Final game on 10/21/25
2. Gets NBA Stats game ID from provider_id_map
3. Fetches box scores using BoxScoreTraditionalV3
4. Resolves player and team IDs
5. Inserts into player_game_stats table
"""

import logging
import os
import sys
from typing import Dict, Optional

import psycopg
from dotenv import load_dotenv
from nba_api.stats.endpoints import BoxScoreTraditionalV3

load_dotenv()

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    logging.error("Missing SUPABASE_DB_URL")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def parse_minutes_to_decimal(value: Optional[str]) -> Optional[float]:
    """Parse MM:SS format to decimal minutes."""
    if not value:
        return None
    if value in {"", "0", "0:00"}:
        return 0.0
    try:
        parts = value.split(":")
        if len(parts) != 2:
            return None
        minutes = int(parts[0])
        seconds = int(parts[1])
        return round(minutes + seconds / 60, 2)
    except (ValueError, TypeError):
        return None


def to_int(value: Optional[float]) -> Optional[int]:
    """Convert float to int, handling None."""
    if value is None:
        return None
    return int(value)


def resolve_team_mapping(conn: psycopg.Connection) -> Dict[str, str]:
    """Get mapping from NBA Stats team ID to internal team ID."""
    rows = conn.execute(
        """
        select provider_id, internal_id
        from provider_id_map
        where entity_type = 'team'
          and provider = 'nba'
        """
    ).fetchall()
    mapping = {row[0]: row[1] for row in rows}
    if not mapping:
        raise RuntimeError("No team mappings found for provider='nba'. Seed provider_id_map first.")
    return mapping


def resolve_player_internal_id(
    conn: psycopg.Connection,
    provider_player_id: str,
    player_name: str,
) -> str:
    """Resolve NBA Stats player ID to internal player ID, creating player if needed."""
    row = conn.execute(
        """
        select internal_id
        from provider_id_map
        where entity_type = 'player'
          and provider = 'nba'
          and provider_id = %s
        limit 1
        """,
        (provider_player_id,),
    ).fetchone()
    
    if row:
        return row[0]
    
    # Player doesn't exist, create it
    parts = player_name.split()
    first_name = parts[0] if parts else None
    last_name = parts[-1] if len(parts) > 1 else None
    
    # Insert player
    conn.execute(
        """
        insert into players (player_id, full_name, first_name, last_name, created_at, updated_at)
        values (%s, %s, %s, %s, now(), now())
        on conflict (player_id) do nothing
        """,
        (provider_player_id, player_name, first_name, last_name),
    )
    
    # Insert provider mapping
    conn.execute(
        """
        insert into provider_id_map (
            entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
        ) values ('player', %s, 'nba', %s, %s::jsonb, now(), now(), now())
        on conflict (entity_type, provider, provider_id) do nothing
        """,
        (provider_player_id, provider_player_id, '{"source": "nba_api", "seeded_from_boxscore": true}'),
    )
    
    logging.info("Created new player: %s (ID: %s)", player_name, provider_player_id)
    return provider_player_id


def fetch_boxscore_v3(game_id: str) -> list[dict]:
    """Fetch box score from NBA Stats API using V3 endpoint."""
    logging.info("Fetching box score (V3) for game %s...", game_id)
    endpoint = BoxScoreTraditionalV3(game_id=game_id)
    data = endpoint.get_dict()
    
    boxscore = data.get("boxScoreTraditional", {})
    home_team = boxscore.get("homeTeam", {})
    away_team = boxscore.get("awayTeam", {})
    
    all_players = []
    
    # Process home team
    for player in home_team.get("players", []):
        stats = player.get("statistics", {})
        player_data = {
            "GAME_ID": game_id,
            "TEAM_ID": str(home_team.get("teamId")),
            "PLAYER_ID": str(player.get("personId")),
            "PLAYER_NAME": f"{player.get('firstName')} {player.get('familyName')}",
            "START_POSITION": player.get("position") if player.get("position") else None,
            "COMMENT": player.get("comment") if player.get("comment") else None,
            "MIN": stats.get("minutes"),
            "FGM": stats.get("fieldGoalsMade"),
            "FGA": stats.get("fieldGoalsAttempted"),
            "FG3M": stats.get("threePointersMade"),
            "FG3A": stats.get("threePointersAttempted"),
            "FTM": stats.get("freeThrowsMade"),
            "FTA": stats.get("freeThrowsAttempted"),
            "REB": stats.get("reboundsTotal"),
            "AST": stats.get("assists"),
            "STL": stats.get("steals"),
            "BLK": stats.get("blocks"),
            "TOV": stats.get("turnovers"),
            "PTS": stats.get("points"),
            "PLUS_MINUS": stats.get("plusMinusPoints"),
        }
        all_players.append(player_data)
    
    # Process away team
    for player in away_team.get("players", []):
        stats = player.get("statistics", {})
        player_data = {
            "GAME_ID": game_id,
            "TEAM_ID": str(away_team.get("teamId")),
            "PLAYER_ID": str(player.get("personId")),
            "PLAYER_NAME": f"{player.get('firstName')} {player.get('familyName')}",
            "START_POSITION": player.get("position") if player.get("position") else None,
            "COMMENT": player.get("comment") if player.get("comment") else None,
            "MIN": stats.get("minutes"),
            "FGM": stats.get("fieldGoalsMade"),
            "FGA": stats.get("fieldGoalsAttempted"),
            "FG3M": stats.get("threePointersMade"),
            "FG3A": stats.get("threePointersAttempted"),
            "FTM": stats.get("freeThrowsMade"),
            "FTA": stats.get("freeThrowsAttempted"),
            "REB": stats.get("reboundsTotal"),
            "AST": stats.get("assists"),
            "STL": stats.get("steals"),
            "BLK": stats.get("blocks"),
            "TOV": stats.get("turnovers"),
            "PTS": stats.get("points"),
            "PLUS_MINUS": stats.get("plusMinusPoints"),
        }
        all_players.append(player_data)
    
    logging.info("Found %d player stat rows", len(all_players))
    return all_players


def get_first_game_on_date(conn: psycopg.Connection, date_str: str) -> Optional[tuple]:
    """Get the first Final game on a given date with NBA Stats mapping, returning (internal_game_id, nba_game_id)."""
    # First try to find games with NBA Stats mappings
    result = conn.execute(
        """
        select g.game_id, pm.provider_id as nba_game_id
        from games g
        join provider_id_map pm on g.game_id = pm.internal_id
            and pm.entity_type = 'game' and pm.provider = 'nba'
        where g.start_time::date = %s::date
          and g.status = 'Final'
        order by g.start_time
        limit 1
        """,
        (date_str,),
    ).fetchone()
    
    if result:
        return result
    
    # If no mapped games, try NBA Stats games directly (002...)
    result = conn.execute(
        """
        select game_id, game_id as nba_game_id
        from games
        where start_time::date = %s::date
          and status = 'Final'
          and game_id like '002%%'
        order by start_time
        limit 1
        """,
        (date_str,),
    ).fetchone()
    
    if result:
        return result
    
    return None


def upsert_player_game_stats(conn: psycopg.Connection, stats: list[dict], team_map: Dict[str, str]) -> int:
    """Insert player game stats into database."""
    inserted = 0
    
    for stat in stats:
        team_provider_id = stat["TEAM_ID"]
        if team_provider_id not in team_map:
            logging.warning("Missing team mapping for TEAM_ID=%s", team_provider_id)
            continue
        
        player_internal_id = resolve_player_internal_id(
            conn, stat["PLAYER_ID"], stat["PLAYER_NAME"]
        )
        team_internal_id = team_map[team_provider_id]
        minutes_decimal = parse_minutes_to_decimal(stat["MIN"])
        dnp_reason = stat["COMMENT"] if (minutes_decimal is None and stat["COMMENT"]) else None
        started = bool(stat["START_POSITION"])
        
        # Use internal game ID (not NBA Stats game ID)
        # We need to get the internal game ID from the NBA Stats game ID
        # For now, we'll use the NBA Stats game ID as the internal ID
        # In production, you'd look this up from provider_id_map
        internal_game_id = stat["GAME_ID"]  # This will be NBA Stats ID
        
        conn.execute(
            """
            insert into player_game_stats (
                game_id, player_id, team_id, minutes, points, rebounds, assists,
                steals, blocks, turnovers, field_goals_made, field_goals_attempted,
                three_pointers_made, three_pointers_attempted, free_throws_made,
                free_throws_attempted, plus_minus, started, dnp_reason, created_at, updated_at
            ) values (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), now()
            )
            on conflict (game_id, player_id) do update set
                team_id = excluded.team_id,
                minutes = excluded.minutes,
                points = excluded.points,
                rebounds = excluded.rebounds,
                assists = excluded.assists,
                steals = excluded.steals,
                blocks = excluded.blocks,
                turnovers = excluded.turnovers,
                field_goals_made = excluded.field_goals_made,
                field_goals_attempted = excluded.field_goals_attempted,
                three_pointers_made = excluded.three_pointers_made,
                three_pointers_attempted = excluded.three_pointers_attempted,
                free_throws_made = excluded.free_throws_made,
                free_throws_attempted = excluded.free_throws_attempted,
                plus_minus = excluded.plus_minus,
                started = excluded.started,
                dnp_reason = excluded.dnp_reason,
                updated_at = now()
            """,
            (
                internal_game_id,
                player_internal_id,
                team_internal_id,
                minutes_decimal,
                to_int(stat["PTS"]),
                to_int(stat["REB"]),
                to_int(stat["AST"]),
                to_int(stat["STL"]),
                to_int(stat["BLK"]),
                to_int(stat["TOV"]),
                to_int(stat["FGM"]),
                to_int(stat["FGA"]),
                to_int(stat["FG3M"]),
                to_int(stat["FG3A"]),
                to_int(stat["FTM"]),
                to_int(stat["FTA"]),
                to_int(stat["PLUS_MINUS"]),
                started,
                dnp_reason,
            ),
        )
        inserted += 1
    
    return inserted


def main() -> None:
    """Main entry point."""
    target_date = "2025-10-21"
    
    with psycopg.connect(SUPABASE_DB_URL) as conn:
        conn.execute("begin")
        
        try:
            # Find first Final game on date
            logging.info("Finding first Final game on %s...", target_date)
            game_info = get_first_game_on_date(conn, target_date)
            
            if not game_info:
                logging.error("No Final games found on %s", target_date)
                sys.exit(1)
            
            internal_game_id, nba_game_id = game_info
            
            if not nba_game_id:
                logging.error("No NBA Stats game ID found for game %s", internal_game_id)
                sys.exit(1)
            
            logging.info("Found game: internal_id=%s, nba_id=%s", internal_game_id, nba_game_id)
            
            # Fetch box scores
            raw_stats = fetch_boxscore_v3(nba_game_id)
            
            if not raw_stats:
                logging.error("No player stats returned from API")
                sys.exit(1)
            
            # Resolve team mappings
            team_map = resolve_team_mapping(conn)
            logging.info("Resolved %d team mappings", len(team_map))
            
            # Map NBA Stats game ID to internal game ID in stats
            # Update stats to use internal game ID
            for stat in raw_stats:
                stat["GAME_ID"] = internal_game_id
            
            # Insert stats
            logging.info("Inserting player game stats...")
            inserted = upsert_player_game_stats(conn, raw_stats, team_map)
            
            conn.execute("commit")
            
            logging.info("Successfully inserted %d player game stats for game %s", inserted, internal_game_id)
            
            # Show sample stats
            result = conn.execute(
                """
                select pgs.game_id, p.full_name, t.abbreviation, pgs.points, pgs.rebounds, pgs.assists
                from player_game_stats pgs
                join players p on pgs.player_id = p.player_id
                join teams t on pgs.team_id = t.team_id
                where pgs.game_id = %s
                order by pgs.points desc nulls last
                limit 10
                """,
                (internal_game_id,),
            )
            
            print("\nTop 10 players by points:")
            print("-" * 80)
            for row in result.fetchall():
                print(f"  {row[1]:<25} ({row[2]}) - {row[3]} pts, {row[4]} reb, {row[5]} ast")
            
        except Exception as exc:
            conn.execute("rollback")
            logging.exception("Failed to seed box scores: %s", exc)
            sys.exit(1)


if __name__ == "__main__":
    main()

