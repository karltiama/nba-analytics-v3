#!/usr/bin/env python3
"""
Update game scores from player_game_stats if they're missing.
"""

import logging
import os
import sys

import psycopg
from dotenv import load_dotenv

load_dotenv()

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    logging.error("Missing SUPABASE_DB_URL")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def update_scores_from_stats(conn: psycopg.Connection, start_date: str = None, end_date: str = None) -> int:
    """Update game scores from aggregated player stats."""
    query = """
        UPDATE games g
        SET 
            home_score = home_totals.total_points,
            away_score = away_totals.total_points,
            status = 'Final',
            updated_at = now()
        FROM (
            SELECT 
                game_id,
                team_id,
                SUM(points) as total_points
            FROM player_game_stats
            WHERE game_id IN (
                SELECT game_id FROM games
                WHERE game_id LIKE '002%%'
                  AND (home_score IS NULL OR away_score IS NULL)
            )
            GROUP BY game_id, team_id
        ) home_totals,
        (
            SELECT 
                game_id,
                team_id,
                SUM(points) as total_points
            FROM player_game_stats
            WHERE game_id IN (
                SELECT game_id FROM games
                WHERE game_id LIKE '002%%'
                  AND (home_score IS NULL OR away_score IS NULL)
            )
            GROUP BY game_id, team_id
        ) away_totals
        WHERE g.game_id = home_totals.game_id
          AND g.game_id = away_totals.game_id
          AND g.home_team_id = home_totals.team_id
          AND g.away_team_id = away_totals.team_id
          AND (g.home_score IS NULL OR g.away_score IS NULL)
          AND g.game_id LIKE '002%%'
    """
    
    params = []
    if start_date:
        query += " AND g.start_time::date >= %s::date"
        params.append(start_date)
    if end_date:
        query += " AND g.start_time::date <= %s::date"
        params.append(end_date)
    
    result = conn.execute(query, params)
    return result.rowcount


def main() -> None:
    import argparse
    
    parser = argparse.ArgumentParser(description="Update game scores from player stats")
    parser.add_argument("--start-date", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", type=str, help="End date (YYYY-MM-DD)")
    
    args = parser.parse_args()
    
    with psycopg.connect(SUPABASE_DB_URL) as conn:
        conn.execute("begin")
        
        try:
            updated = update_scores_from_stats(conn, args.start_date, args.end_date)
            conn.execute("commit")
            logging.info("Updated scores for %d games", updated)
            print(f"Updated scores for {updated} games")
        except Exception as exc:
            conn.execute("rollback")
            logging.exception("Failed to update scores: %s", exc)
            import traceback
            traceback.print_exc()
            sys.exit(1)


if __name__ == "__main__":
    main()



