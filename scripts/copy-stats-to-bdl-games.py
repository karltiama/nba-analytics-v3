#!/usr/bin/env python3
"""
Copy player and team stats from NBA Stats games to matching BallDontLie games.

This script finds BallDontLie games that match NBA Stats games (same date, same teams)
and copies the stats so both game IDs have the data.
"""

import logging
import os
import sys
from typing import List, Tuple

import psycopg
from dotenv import load_dotenv

load_dotenv()

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    logging.error("Missing SUPABASE_DB_URL")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def find_matching_games(conn: psycopg.Connection, start_date: str = None, end_date: str = None) -> List[Tuple[str, str]]:
    """
    Find BallDontLie games that match NBA Stats games.
    Returns list of (bdl_game_id, nba_game_id) tuples.
    """
    query = """
        SELECT DISTINCT 
            bdl_game.game_id as bdl_id,
            nba_game.game_id as nba_id,
            bdl_game.start_time
        FROM games bdl_game
        JOIN teams bdl_home ON bdl_game.home_team_id = bdl_home.team_id
        JOIN teams bdl_away ON bdl_game.away_team_id = bdl_away.team_id
        JOIN games nba_game ON (
            (bdl_game.start_time AT TIME ZONE 'America/New_York')::date = 
            (nba_game.start_time AT TIME ZONE 'America/New_York')::date
        )
        JOIN teams nba_home ON nba_game.home_team_id = nba_home.team_id
        JOIN teams nba_away ON nba_game.away_team_id = nba_away.team_id
        WHERE bdl_game.status = 'Final'
          AND bdl_game.game_id LIKE '184%%'
          AND nba_game.game_id LIKE '002%%'
          AND nba_home.abbreviation = bdl_home.abbreviation
          AND nba_away.abbreviation = bdl_away.abbreviation
          AND EXISTS (SELECT 1 FROM player_game_stats WHERE game_id = nba_game.game_id)
          AND NOT EXISTS (SELECT 1 FROM player_game_stats WHERE game_id = bdl_game.game_id)
    """
    
    params = []
    if start_date:
        query += " AND bdl_game.start_time::date >= %s::date"
        params.append(start_date)
    if end_date:
        query += " AND bdl_game.start_time::date <= %s::date"
        params.append(end_date)
    
    query += " ORDER BY bdl_game.start_time"
    
    result = conn.execute(query, params).fetchall()
    return [(row[0], row[1]) for row in result]


def copy_player_stats(conn: psycopg.Connection, bdl_game_id: str, nba_game_id: str) -> int:
    """Copy player stats from NBA Stats game to BallDontLie game."""
    # Copy player_game_stats
    result = conn.execute(
        """
        INSERT INTO player_game_stats (
            game_id, player_id, team_id, minutes, points, rebounds, assists,
            steals, blocks, turnovers, field_goals_made, field_goals_attempted,
            three_pointers_made, three_pointers_attempted, free_throws_made,
            free_throws_attempted, plus_minus, started, dnp_reason, created_at, updated_at
        )
        SELECT 
            %s as game_id,  -- Use BDL game ID
            player_id,
            team_id,
            minutes,
            points,
            rebounds,
            assists,
            steals,
            blocks,
            turnovers,
            field_goals_made,
            field_goals_attempted,
            three_pointers_made,
            three_pointers_attempted,
            free_throws_made,
            free_throws_attempted,
            plus_minus,
            started,
            dnp_reason,
            created_at,
            updated_at
        FROM player_game_stats
        WHERE game_id = %s  -- NBA Stats game ID
        ON CONFLICT (game_id, player_id) DO NOTHING
        RETURNING game_id
        """,
        (bdl_game_id, nba_game_id)
    )
    
    return len(result.fetchall())


def copy_team_stats(conn: psycopg.Connection, bdl_game_id: str, nba_game_id: str) -> int:
    """Copy team stats from NBA Stats game to BallDontLie game."""
    # Copy team_game_stats
    result = conn.execute(
        """
        INSERT INTO team_game_stats (
            game_id, team_id, is_home, minutes, points, field_goals_made,
            field_goals_attempted, three_pointers_made, three_pointers_attempted,
            free_throws_made, free_throws_attempted, offensive_rebounds,
            defensive_rebounds, rebounds, assists, steals, blocks, turnovers,
            personal_fouls, points_q1, points_q2, points_q3, points_q4, points_ot,
            created_at, updated_at
        )
        SELECT 
            %s as game_id,  -- Use BDL game ID
            team_id,
            is_home,
            minutes,
            points,
            field_goals_made,
            field_goals_attempted,
            three_pointers_made,
            three_pointers_attempted,
            free_throws_made,
            free_throws_attempted,
            offensive_rebounds,
            defensive_rebounds,
            rebounds,
            assists,
            steals,
            blocks,
            turnovers,
            personal_fouls,
            points_q1,
            points_q2,
            points_q3,
            points_q4,
            points_ot,
            created_at,
            updated_at
        FROM team_game_stats
        WHERE game_id = %s  -- NBA Stats game ID
        ON CONFLICT (game_id, team_id) DO NOTHING
        RETURNING game_id
        """,
        (bdl_game_id, nba_game_id)
    )
    
    return len(result.fetchall())


def main() -> None:
    import argparse
    
    parser = argparse.ArgumentParser(description="Copy stats from NBA Stats games to matching BallDontLie games")
    parser.add_argument("--start-date", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be copied without actually copying")
    
    args = parser.parse_args()
    
    with psycopg.connect(SUPABASE_DB_URL) as conn:
        conn.execute("begin")
        
        try:
            matches = find_matching_games(conn, args.start_date, args.end_date)
            
            if not matches:
                logging.info("No matching games found")
                conn.execute("rollback")
                return
            
            logging.info("Found %d matching games to copy stats for", len(matches))
            
            if args.dry_run:
                logging.info("DRY RUN - Would copy stats for:")
                for bdl_id, nba_id in matches[:10]:
                    logging.info("  BDL: %s <- NBA: %s", bdl_id, nba_id)
                if len(matches) > 10:
                    logging.info("  ... and %d more", len(matches) - 10)
                conn.execute("rollback")
                return
            
            total_player_stats = 0
            total_team_stats = 0
            
            for bdl_id, nba_id in matches:
                try:
                    player_count = copy_player_stats(conn, bdl_id, nba_id)
                    team_count = copy_team_stats(conn, bdl_id, nba_id)
                    total_player_stats += player_count
                    total_team_stats += team_count
                    logging.info("Copied stats: BDL %s <- NBA %s (%d players, %d teams)", 
                               bdl_id, nba_id, player_count, team_count)
                except Exception as exc:
                    logging.error("Failed to copy stats for BDL %s <- NBA %s: %s", bdl_id, nba_id, exc)
            
            conn.execute("commit")
            logging.info("Complete! Copied %d player stats and %d team stats", 
                        total_player_stats, total_team_stats)
            
        except Exception as exc:
            conn.execute("rollback")
            logging.exception("Failed to copy stats: %s", exc)
            sys.exit(1)


if __name__ == "__main__":
    main()

