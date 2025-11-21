#!/usr/bin/env python3
"""
Daily box score seeding script with multiple source fallbacks.

This script tries multiple sources in order of reliability:
1. NBA Stats API (official, but delayed 1-2 hours)
2. Basketball Reference scraping (faster updates, very accurate, rate-limited)
3. NBA.com scraping (fallback)

Usage:
    python scripts/daily-boxscore-seed.py                    # Process today's Final games
    python scripts/daily-boxscore-seed.py --date 2025-11-20  # Specific date
    python scripts/daily-boxscore-seed.py --days-back 3      # Last 3 days
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

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

# Import existing box score scripts
try:
    # Import NBA Stats box score seeding
    sys.path.insert(0, os.path.dirname(__file__))
    from seed_boxscores_nba import (
        get_games_to_process as get_nba_stats_games,
        process_game as process_nba_stats_game,
        resolve_team_mapping,
    )
except ImportError as e:
    logging.error("Failed to import NBA Stats box score functions: %s", e)
    sys.exit(1)


def get_final_games_without_boxscores(
    conn: psycopg.Connection,
    target_date: Optional[str] = None,
    days_back: int = 0,
) -> List[Tuple[str, str, str, str]]:
    """
    Get Final games without box scores.
    Returns: (game_id, home_abbr, away_abbr, game_date)
    """
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
    
    query += " ORDER BY g.start_time DESC"
    
    result = conn.execute(query, params).fetchall()
    return [(row[0], row[1], row[2], str(row[3])) for row in result]


def try_nba_stats_api(
    conn: psycopg.Connection,
    game_id: str,
    nba_game_id: Optional[str] = None,
) -> bool:
    """Try to fetch box score from NBA Stats API."""
    try:
        if not nba_game_id:
            # Try to get NBA Stats game ID from provider mapping
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
            
            if not result:
                # Check if game_id is already an NBA Stats ID
                if game_id.startswith('002'):
                    nba_game_id = game_id
                else:
                    return False
            else:
                nba_game_id = result[0]
        
        logging.info("Trying NBA Stats API for game %s (NBA ID: %s)", game_id, nba_game_id)
        
        team_map = resolve_team_mapping(conn)
        success = process_nba_stats_game(conn, game_id, nba_game_id, team_map)
        
        if success:
            logging.info("Successfully fetched from NBA Stats API")
            return True
        else:
            logging.warning("NBA Stats API returned no data")
            return False
            
    except Exception as exc:
        logging.warning("NBA Stats API failed: %s", exc)
        return False


def try_basketball_reference(
    conn: psycopg.Connection,
    game_id: str,
    home_abbr: str,
    away_abbr: str,
    game_date: str,
) -> bool:
    """Try to fetch box score from Basketball Reference."""
    try:
        # Import Basketball Reference scraper
        import subprocess
        
        logging.info("Trying Basketball Reference for game %s (%s @ %s, %s)", 
                    game_id, away_abbr, home_abbr, game_date)
        
        # Call the TypeScript scraper
        result = subprocess.run(
            [
                'npx', 'tsx', 
                'scripts/scrape-basketball-reference.ts',
                '--game-id', game_id
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        
        if result.returncode == 0:
            # Check if box score was actually stored
            check_result = conn.execute(
                """
                SELECT COUNT(*) 
                FROM player_game_stats 
                WHERE game_id = %s
                """,
                [game_id],
            ).fetchone()
            
            if check_result and check_result[0] > 0:
                logging.info("Successfully fetched from Basketball Reference")
                return True
        
        logging.warning("Basketball Reference returned no data")
        return False
        
    except Exception as exc:
        logging.warning("Basketball Reference failed: %s", exc)
        return False


def try_nba_com_scraping(
    conn: psycopg.Connection,
    game_id: str,
    nba_game_id: Optional[str] = None,
) -> bool:
    """Try to fetch box score from NBA.com scraping."""
    try:
        import subprocess
        
        logging.info("Trying NBA.com scraping for game %s", game_id)
        
        if not nba_game_id:
            # Try to get NBA Stats game ID
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
        
        # Call the NBA.com scraper
        result = subprocess.run(
            [
                'npx', 'tsx',
                'scripts/scrape-nba-com.ts',
                '--boxscore', '--game-id', nba_game_id
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        
        if result.returncode == 0:
            # Check if box score was stored
            check_result = conn.execute(
                """
                SELECT COUNT(*) 
                FROM player_game_stats 
                WHERE game_id = %s
                """,
                [game_id],
            ).fetchone()
            
            if check_result and check_result[0] > 0:
                logging.info("Successfully fetched from NBA.com")
                return True
        
        logging.warning("NBA.com scraping returned no data")
        return False
        
    except Exception as exc:
        logging.warning("NBA.com scraping failed: %s", exc)
        return False


def process_game_with_fallbacks(
    conn: psycopg.Connection,
    game_id: str,
    home_abbr: str,
    away_abbr: str,
    game_date: str,
    nba_game_id: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Try multiple sources to fetch box score.
    Strategy: Basketball Reference first (fastest updates), then NBA Stats API (official but delayed).
    Returns: (success, source_used)
    """
    # Calculate hours since game (approximate)
    try:
        game_datetime = datetime.strptime(game_date, '%Y-%m-%d').date()
        hours_since_game = (datetime.now().date() - game_datetime).days * 24
    except:
        hours_since_game = 24  # Default to older game
    
    # For recent games (< 4 hours), Basketball Reference updates faster
    # For older games, NBA Stats API is more reliable
    if hours_since_game < 4:
        # Recent game: Try Basketball Reference first (faster updates)
        if try_basketball_reference(conn, game_id, home_abbr, away_abbr, game_date):
            return (True, 'basketball_reference')
        
        # Fallback to NBA Stats API
        if try_nba_stats_api(conn, game_id, nba_game_id):
            return (True, 'nba_stats')
        
        # Last resort: NBA.com scraping
        if try_nba_com_scraping(conn, game_id, nba_game_id):
            return (True, 'nba_com')
    else:
        # Older game: Try NBA Stats API first (more reliable for historical)
        if try_nba_stats_api(conn, game_id, nba_game_id):
            return (True, 'nba_stats')
        
        # Fallback to Basketball Reference
        if try_basketball_reference(conn, game_id, home_abbr, away_abbr, game_date):
            return (True, 'basketball_reference')
    
    return (False, 'none')


def main():
    parser = argparse.ArgumentParser(
        description="Daily box score seeding with multiple source fallbacks"
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
        default=50,
        help='Maximum number of games to process (default: 50)',
    )
    
    args = parser.parse_args()
    
    with psycopg.connect(SUPABASE_DB_URL) as conn:
        # Get games to process
        games = get_final_games_without_boxscores(
            conn,
            target_date=args.date,
            days_back=args.days_back,
        )
        
        if not games:
            logging.info("No Final games without box scores found")
            return
        
        # Limit to max games
        games = games[:args.max_games]
        
        logging.info("Found %d Final games without box scores", len(games))
        logging.info("Processing strategy:")
        logging.info("  Recent games (< 4h): Basketball Reference -> NBA Stats API -> NBA.com")
        logging.info("  Older games: NBA Stats API -> Basketball Reference\n")
        
        results = {
            'success': 0,
            'failed': 0,
            'sources': {},
        }
        
        for idx, (game_id, home_abbr, away_abbr, game_date) in enumerate(games, 1):
            logging.info("\n[%d/%d] Processing %s @ %s (%s)", 
                        idx, len(games), away_abbr, home_abbr, game_date)
            
            # Get NBA game ID if available
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
            
            success, source = process_game_with_fallbacks(
                conn,
                game_id,
                home_abbr,
                away_abbr,
                game_date,
                nba_game_id,
            )
            
            if success:
                results['success'] += 1
                results['sources'][source] = results['sources'].get(source, 0) + 1
                logging.info("Successfully fetched box score from %s", source)
            else:
                results['failed'] += 1
                logging.warning("Failed to fetch box score from all sources")
        
        # Summary
        logging.info("\n" + "="*60)
        logging.info("Summary:")
        logging.info("  Success: %d", results['success'])
        logging.info("  Failed: %d", results['failed'])
        logging.info("\nSources used:")
        for source, count in results['sources'].items():
            logging.info("  %s: %d", source, count)


if __name__ == '__main__':
    main()

