"""
Utility script to run the NBA game seed for a single day and optionally
inspect the inserted records.

Example:
    python scripts/run_day_seed.py --date 2025-10-21 --check
"""

from __future__ import annotations

import argparse
import logging
import os
import pathlib
import sys
from datetime import datetime
from typing import Iterable, Tuple

import psycopg

# Ensure the project root is on sys.path so we can import other scripts.
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Import the existing seed script so we can invoke its main() function directly.
from scripts import seed_games_nba  # type: ignore  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed NBA games for a single date.")
    parser.add_argument(
        "--date",
        required=True,
        help="Target date in YYYY-MM-DD (Eastern) to seed games for.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="After seeding, query the games table and print a summary.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=5,
        help="Maximum number of games to show when using --check (default: 5).",
    )
    return parser.parse_args()


def validate_date(value: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise SystemExit(f"Invalid --date value '{value}': {exc}") from exc
    return value


def ensure_env(var_name: str) -> str:
    value = os.getenv(var_name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {var_name}")
    return value


def fetch_games_for_date(conn: psycopg.Connection, target_date: str, limit: int) -> Iterable[Tuple[str, str, int, int]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select game_id, status, home_score, away_score
              from games
             where start_time::date = %s
             order by start_time
             limit %s;
            """,
            (target_date, limit),
        )
        return cur.fetchall()


def main() -> None:
    args = parse_args()
    target_date = validate_date(args.date)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    # Set the environment variables expected by the seed script.
    os.environ["NBA_STATS_START_DATE"] = target_date
    os.environ["NBA_STATS_END_DATE"] = target_date

    seed_games_nba.main()

    if args.check:
        supabase_url = ensure_env("SUPABASE_DB_URL")
        logging.info("Checking seeded games for %s", target_date)
        with psycopg.connect(supabase_url) as conn:
            rows = list(fetch_games_for_date(conn, target_date, args.limit))

        if not rows:
            logging.warning("No games found in database for %s", target_date)
            return

        print(f"Games for {target_date}:")
        for game_id, status, home_score, away_score in rows:
            print(f"  {game_id} | {status} | home_score={home_score} | away_score={away_score}")


if __name__ == "__main__":
    main()


