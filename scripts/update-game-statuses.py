#!/usr/bin/env python3
"""
Update game statuses to 'Final' if they have scores.
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


def update_game_statuses(conn: psycopg.Connection, start_date: str = None, end_date: str = None) -> int:
    """Update game statuses to 'Final' if they have scores."""
    query = """
        UPDATE games
        SET status = 'Final', updated_at = now()
        WHERE (home_score IS NOT NULL AND away_score IS NOT NULL)
          AND status != 'Final'
          AND game_id LIKE '002%%'
    """
    
    params = []
    if start_date:
        query += " AND start_time::date >= %s::date"
        params.append(start_date)
    if end_date:
        query += " AND start_time::date <= %s::date"
        params.append(end_date)
    
    result = conn.execute(query, params)
    return result.rowcount


def main() -> None:
    import argparse
    
    parser = argparse.ArgumentParser(description="Update game statuses to Final if they have scores")
    parser.add_argument("--start-date", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", type=str, help="End date (YYYY-MM-DD)")
    
    args = parser.parse_args()
    
    with psycopg.connect(SUPABASE_DB_URL) as conn:
        conn.execute("begin")
        
        try:
            updated = update_game_statuses(conn, args.start_date, args.end_date)
            conn.execute("commit")
            logging.info("Updated %d games to 'Final' status", updated)
            print(f"Updated {updated} games to 'Final' status")
        except Exception as exc:
            conn.execute("rollback")
            logging.exception("Failed to update game statuses: %s", exc)
            sys.exit(1)


if __name__ == "__main__":
    main()


