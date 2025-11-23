#!/usr/bin/env python3
"""
Simple daily box score seeding - prioritizes Basketball Reference (fastest updates).

This script:
1. Finds Final games without box scores (today or last N days)
2. Tries Basketball Reference first (fastest updates, very accurate)
3. Falls back to NBA Stats API if Basketball Reference fails

Usage:
    python scripts/daily-boxscore-seed-simple.py              # Today's games
    python scripts/daily-boxscore-seed-simple.py --days-back 2  # Last 2 days
    python scripts/daily-boxscore-seed-simple.py --date 2025-11-20
"""

import argparse
import logging
import os
import subprocess
import sys
from datetime import datetime, timedelta
from typing import List, Optional

import psycopg
from dotenv import load_dotenv

load_dotenv()

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    logging.error("Missing SUPABASE_DB_URL")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)


def get_final_games_without_boxscores(
    conn: psycopg.Connection,
    target_date: Optional[str] = None,
    days_back: int = 0,
    max_games: int = 50,
) -> List[tuple]:
    """Get Final games without box scores."""
    query = """
        SELECT 
            g.game_id,
            ht.abbreviation as home_abbr,
            at.abbreviation as away_abbr,
            DATE(g.start_time AT TIME ZONE 'America/New_York') as game_date
        FROM games g
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        WHERE g.status = 'Final'
          AND NOT EXISTS (
              SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id
          )
    """
    
    params = []
    
    if target_date:
        query += " AND DATE(g.start_time AT TIME ZONE 'America/New_York') = %s::date"
        params.append(target_date)
    elif days_back > 0:
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=days_back)
        query += " AND DATE(g.start_time AT TIME ZONE 'America/New_York') >= %s::date"
        query += " AND DATE(g.start_time AT TIME ZONE 'America/New_York') <= %s::date"
        params.extend([start_date, end_date])
    else:
        # Default: today
        today = datetime.now().date()
        query += " AND DATE(g.start_time AT TIME ZONE 'America/New_York') = %s::date"
        params.append(today)
    
    query += " ORDER BY g.start_time DESC LIMIT %s"
    params.append(max_games)
    
    result = conn.execute(query, params).fetchall()
    return result


def try_basketball_reference(game_id: str) -> bool:
    """Try to fetch box score from Basketball Reference."""
    try:
        logging.info("Trying Basketball Reference for game %s", game_id)
        
        result = subprocess.run(
            ['npx', 'tsx', 'scripts/scrape-basketball-reference.ts', '--game-id', game_id],
            capture_output=True,
            text=True,
            timeout=60,
        )
        
        if result.returncode == 0 and 'Successfully' in result.stdout:
            return True
        
        return False
    except Exception as exc:
        logging.warning("Basketball Reference failed: %s", exc)
        return False


def try_nba_stats_api(game_id: str, nba_game_id: Optional[str] = None) -> bool:
    """Try to fetch box score from NBA Stats API."""
    try:
        if not nba_game_id:
            # Try to get NBA Stats game ID
            with psycopg.connect(SUPABASE_DB_URL) as conn:
                result = conn.execute(
                    """
                    SELECT provider_id
                    FROM provider_id_map
                    WHERE entity_type = 'game'
                      AND provider = 'nba'
                      AND internal_id = %s
                    LIMIT 1
                    """,
                    [game_id],
                ).fetchone()
                
                if result:
                    nba_game_id = result[0]
                elif game_id.startswith('002'):
                    nba_game_id = game_id
                else:
                    return False
        
        logging.info("Trying NBA Stats API for game %s (NBA ID: %s)", game_id, nba_game_id)
        
        # Import and use NBA Stats box score script
        import sys
        import os
        sys.path.insert(0, os.path.dirname(__file__))
        
        from seed_boxscores_nba import (
            get_games_to_process,
            process_game,
            resolve_team_mapping,
        )
        
        with psycopg.connect(SUPABASE_DB_URL) as conn:
            team_map = resolve_team_mapping(conn)
            success = process_game(conn, game_id, nba_game_id, team_map)
            return success
            
    except Exception as exc:
        logging.warning("NBA Stats API failed: %s", exc)
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Daily box score seeding - Basketball Reference first, NBA Stats API fallback"
    )
    parser.add_argument(
        '--date',
        type=str,
        help='Target date (YYYY-MM-DD). Defaults to today.',
    )
    parser.add_argument(
        '--days-back',
        type=int,
        default=0,
        help='Process games from last N days (default: 0 = today only)',
    )
    parser.add_argument(
        '--max-games',
        type=int,
        default=30,
        help='Maximum number of games to process (default: 30)',
    )
    parser.add_argument(
        '--skip-bbref',
        action='store_true',
        help='Skip Basketball Reference, use NBA Stats API only',
    )
    
    args = parser.parse_args()
    
    with psycopg.connect(SUPABASE_DB_URL) as conn:
        games = get_final_games_without_boxscores(
            conn,
            target_date=args.date,
            days_back=args.days_back,
            max_games=args.max_games,
        )
        
        if not games:
            logging.info("No Final games without box scores found")
            return
        
        logging.info("Found %d Final games without box scores", len(games))
        logging.info("Strategy: Basketball Reference (fast updates) -> NBA Stats API (official)\n")
        
        results = {
            'success': 0,
            'failed': 0,
            'bbref': 0,
            'nba_stats': 0,
        }
        
        for idx, (game_id, home_abbr, away_abbr, game_date) in enumerate(games, 1):
            logging.info("\n[%d/%d] %s @ %s (%s)", 
                        idx, len(games), away_abbr, home_abbr, game_date)
            
            success = False
            
            # Try Basketball Reference first (fastest updates)
            if not args.skip_bbref:
                if try_basketball_reference(game_id):
                    results['bbref'] += 1
                    results['success'] += 1
                    success = True
                    logging.info("Successfully fetched from Basketball Reference")
            
            # Fallback to NBA Stats API
            if not success:
                # Get NBA game ID
                nba_game_id = None
                try:
                    result = conn.execute(
                        """
                        SELECT provider_id
                        FROM provider_id_map
                        WHERE entity_type = 'game'
                          AND provider = 'nba'
                          AND internal_id = %s
                        LIMIT 1
                        """,
                        [game_id],
                    ).fetchone()
                    if result:
                        nba_game_id = result[0]
                    elif game_id.startswith('002'):
                        nba_game_id = game_id
                except Exception:
                    pass
                
                if nba_game_id:
                    if try_nba_stats_api(game_id, nba_game_id):
                        results['nba_stats'] += 1
                        results['success'] += 1
                        success = True
                        logging.info("Successfully fetched from NBA Stats API")
            
            if not success:
                results['failed'] += 1
                logging.warning("Failed to fetch box score from all sources")
        
        # Summary
        logging.info("\n" + "="*60)
        logging.info("Summary:")
        logging.info("  Success: %d", results['success'])
        logging.info("    - Basketball Reference: %d", results['bbref'])
        logging.info("    - NBA Stats API: %d", results['nba_stats'])
        logging.info("  Failed: %d", results['failed'])


if __name__ == '__main__':
    main()




