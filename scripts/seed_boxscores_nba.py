#!/usr/bin/env python3
"""
Production script to seed player game stats (box scores) from NBA Stats API.

This script:
1. Finds Final games that don't have box scores yet (or updates existing ones)
2. Gets NBA Stats game IDs from provider_id_map
3. Fetches box scores using BoxScoreTraditionalV3
4. Resolves player and team IDs
5. Inserts/updates player_game_stats table

Usage:
    python scripts/seed_boxscores_nba.py                    # All Final games without box scores
    python scripts/seed_boxscores_nba.py --date 2025-10-21  # Specific date
    python scripts/seed_boxscores_nba.py --start-date 2025-10-21 --end-date 2025-10-25  # Date range
"""

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import psycopg
from dotenv import load_dotenv
from nba_api.stats.endpoints import BoxScoreTraditionalV3

load_dotenv()

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    logging.error("Missing SUPABASE_DB_URL")
    sys.exit(1)

# Rate limiting: NBA Stats API doesn't have documented limits, but be respectful
REQUEST_DELAY_MS = int(os.getenv("NBA_STATS_REQUEST_DELAY_MS", "1000"))  # 1 second default
MAX_RETRIES = 3
RETRY_DELAY_MS = 5000  # 5 seconds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)


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
    """
    Resolve NBA Stats player ID to internal player ID, creating player if needed.
    
    Also checks if player exists by name from other sources (e.g., API-Sports)
    and links them via provider_id_map.
    """
    # First check provider_id_map for NBA Stats mapping
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
        internal_id = row[0]
        # Verify player actually exists
        player_check = conn.execute(
            "select player_id from players where player_id = %s",
            (internal_id,),
        ).fetchone()
        
        if player_check:
            return internal_id
        else:
            # Provider mapping exists but player doesn't - this is the bug!
            logging.warning(
                "Provider mapping exists for player %s (NBA ID: %s) but player doesn't exist. "
                "Creating player now.",
                player_name, provider_player_id
            )
            # Fall through to create player
    
    # Check if player exists by name (might be from API-Sports or other source)
    name_parts = player_name.split()
    if len(name_parts) >= 2:
        first_name = name_parts[0]
        last_name = name_parts[-1]
        
        existing_player = conn.execute(
            """
            select player_id
            from players
            where (first_name ilike %s and last_name ilike %s)
               or full_name ilike %s
            limit 1
            """,
            (first_name, last_name, f"%{player_name}%"),
        ).fetchone()
        
        if existing_player:
            existing_id = existing_player[0]
            logging.info(
                "Found existing player %s (ID: %s) for NBA Stats player %s (ID: %s). Linking...",
                player_name, existing_id, player_name, provider_player_id
            )
            
            # Create provider mapping linking NBA Stats ID to existing player
            conn.execute(
                """
                insert into provider_id_map (
                    entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
                ) values ('player', %s, 'nba', %s, %s::jsonb, now(), now(), now())
                on conflict (entity_type, provider, provider_id) do update set
                    internal_id = excluded.internal_id,
                    metadata = excluded.metadata,
                    fetched_at = excluded.fetched_at,
                    updated_at = now()
                """,
                (existing_id, provider_player_id, '{"source": "nba_api", "seeded_from_boxscore": true, "linked_to_existing": true}'),
            )
            
            return existing_id
    
    # Player doesn't exist, create it
    parts = player_name.split()
    first_name = parts[0] if parts else None
    last_name = parts[-1] if len(parts) > 1 else None
    
    # Insert player (use NBA Stats ID as internal ID)
    try:
        conn.execute(
            """
            insert into players (player_id, full_name, first_name, last_name, created_at, updated_at)
            values (%s, %s, %s, %s, now(), now())
            on conflict (player_id) do update set
                full_name = excluded.full_name,
                first_name = excluded.first_name,
                last_name = excluded.last_name,
                updated_at = now()
            """,
            (provider_player_id, player_name, first_name, last_name),
        )
    except Exception as exc:
        logging.error("Failed to insert player %s (ID: %s): %s", player_name, provider_player_id, exc)
        raise
    
    # Insert provider mapping
    conn.execute(
        """
        insert into provider_id_map (
            entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
        ) values ('player', %s, 'nba', %s, %s::jsonb, now(), now(), now())
        on conflict (entity_type, provider, provider_id) do update set
            internal_id = excluded.internal_id,
            metadata = excluded.metadata,
            fetched_at = excluded.fetched_at,
            updated_at = now()
        """,
        (provider_player_id, provider_player_id, '{"source": "nba_api", "seeded_from_boxscore": true}'),
    )
    
    logging.debug("Created new player: %s (ID: %s)", player_name, provider_player_id)
    return provider_player_id


def fetch_boxscore_v3(game_id: str, retry_count: int = 0) -> Optional[List[dict]]:
    """Fetch box score from NBA Stats API using V3 endpoint with retry logic."""
    try:
        logging.debug("Fetching box score (V3) for game %s (attempt %d)...", game_id, retry_count + 1)
        endpoint = BoxScoreTraditionalV3(game_id=game_id)
        data = endpoint.get_dict()
        
        boxscore = data.get("boxScoreTraditional", {})
        if not boxscore:
            logging.warning("No boxScoreTraditional data for game %s", game_id)
            return None
        
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
        
        if not all_players:
            logging.warning("No player stats found for game %s", game_id)
            return None
        
        logging.debug("Found %d player stat rows for game %s", len(all_players), game_id)
        return all_players
        
    except Exception as exc:
        if retry_count < MAX_RETRIES:
            logging.warning("Failed to fetch box score for game %s (attempt %d): %s. Retrying...", 
                          game_id, retry_count + 1, exc)
            time.sleep(RETRY_DELAY_MS / 1000)
            return fetch_boxscore_v3(game_id, retry_count + 1)
        else:
            logging.error("Failed to fetch box score for game %s after %d attempts: %s", 
                         game_id, MAX_RETRIES, exc)
            return None


def get_games_to_process(
    conn: psycopg.Connection,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    update_existing: bool = False,
) -> List[Tuple[str, str]]:
    """
    Get list of games to process: (internal_game_id, nba_game_id).
    
    By default, only processes games without box scores.
    Set update_existing=True to update all Final games.
    """
    if update_existing:
        # Get all Final games with NBA Stats mappings
        query = """
            select distinct g.game_id, pm.provider_id as nba_game_id, g.start_time
            from games g
            join provider_id_map pm on g.game_id = pm.internal_id
                and pm.entity_type = 'game' and pm.provider = 'nba'
            where g.status = 'Final'
        """
        params = []
        
        if start_date:
            query += " and g.start_time::date >= %s::date"
            params.append(start_date)
        if end_date:
            query += " and g.start_time::date <= %s::date"
            params.append(end_date)
        
        query += " order by g.start_time"
        
        result = conn.execute(query, params).fetchall()
        
        # Also include NBA Stats games directly (002...)
        query2 = """
            select game_id, game_id as nba_game_id, start_time
            from games
            where status = 'Final'
              and game_id like '002%%'
        """
        params2 = []
        
        if start_date:
            query2 += " and start_time::date >= %s::date"
            params2.append(start_date)
        if end_date:
            query2 += " and start_time::date <= %s::date"
            params2.append(end_date)
        
        query2 += " order by start_time"
        
        result2 = conn.execute(query2, params2).fetchall()
        
        # Combine and deduplicate (keep first occurrence)
        games = {}
        for row in sorted(result + result2, key=lambda x: x[2]):  # Sort by start_time
            if row[0] not in games:
                games[row[0]] = row[1]
        return list(games.items())
    else:
        # Only get games without box scores
        query = """
            select distinct g.game_id, pm.provider_id as nba_game_id, g.start_time
            from games g
            join provider_id_map pm on g.game_id = pm.internal_id
                and pm.entity_type = 'game' and pm.provider = 'nba'
            where g.status = 'Final'
              and not exists (
                  select 1 from player_game_stats pgs where pgs.game_id = g.game_id
              )
        """
        params = []
        
        if start_date:
            query += " and g.start_time::date >= %s::date"
            params.append(start_date)
        if end_date:
            query += " and g.start_time::date <= %s::date"
            params.append(end_date)
        
        query += " order by g.start_time"
        
        result = conn.execute(query, params).fetchall()
        
        # Also include NBA Stats games directly (002...) without box scores
        query2 = """
            select game_id, game_id as nba_game_id, start_time
            from games
            where status = 'Final'
              and game_id like '002%%'
              and not exists (
                  select 1 from player_game_stats pgs where pgs.game_id = games.game_id
              )
        """
        params2 = []
        
        if start_date:
            query2 += " and start_time::date >= %s::date"
            params2.append(start_date)
        if end_date:
            query2 += " and start_time::date <= %s::date"
            params2.append(end_date)
        
        query2 += " order by start_time"
        
        result2 = conn.execute(query2, params2).fetchall()
        
        # Combine and deduplicate (keep first occurrence)
        games = {}
        for row in sorted(result + result2, key=lambda x: x[2]):  # Sort by start_time
            if row[0] not in games:
                games[row[0]] = row[1]
        return list(games.items())


def upsert_player_game_stats(
    conn: psycopg.Connection,
    internal_game_id: str,
    stats: List[dict],
    team_map: Dict[str, str],
) -> int:
    """Insert/update player game stats into database."""
    inserted = 0
    errors = 0
    
    for stat in stats:
        try:
            team_provider_id = stat["TEAM_ID"]
            if team_provider_id not in team_map:
                logging.warning("Missing team mapping for TEAM_ID=%s in game %s", 
                              team_provider_id, internal_game_id)
                errors += 1
                continue
            
            player_internal_id = resolve_player_internal_id(
                conn, stat["PLAYER_ID"], stat["PLAYER_NAME"]
            )
            team_internal_id = team_map[team_provider_id]
            minutes_decimal = parse_minutes_to_decimal(stat["MIN"])
            dnp_reason = stat["COMMENT"] if (minutes_decimal is None and stat["COMMENT"]) else None
            started = bool(stat["START_POSITION"])
            
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
        except Exception as exc:
            logging.error("Failed to insert stat for player %s in game %s: %s", 
                         stat.get("PLAYER_NAME"), internal_game_id, exc)
            errors += 1
    
    if errors > 0:
        logging.warning("Encountered %d errors inserting stats for game %s", errors, internal_game_id)
    
    return inserted


def process_game(
    conn: psycopg.Connection,
    internal_game_id: str,
    nba_game_id: str,
    team_map: Dict[str, str],
) -> bool:
    """Process a single game: fetch box scores and insert stats."""
    try:
        # Fetch box scores
        raw_stats = fetch_boxscore_v3(nba_game_id)
        
        if not raw_stats:
            logging.warning("No player stats returned for game %s (NBA ID: %s)", 
                          internal_game_id, nba_game_id)
            return False
        
        # Update stats to use internal game ID
        for stat in raw_stats:
            stat["GAME_ID"] = internal_game_id
        
        # Insert stats
        inserted = upsert_player_game_stats(conn, internal_game_id, raw_stats, team_map)
        
        if inserted > 0:
            logging.info("Successfully processed game %s: %d player stats", 
                        internal_game_id, inserted)
            return True
        else:
            logging.warning("No stats inserted for game %s", internal_game_id)
            return False
            
    except Exception as exc:
        logging.error("Failed to process game %s: %s", internal_game_id, exc)
        return False


def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Seed player game stats (box scores) from NBA Stats API"
    )
    parser.add_argument(
        "--date",
        type=str,
        help="Process games for a specific date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--start-date",
        type=str,
        help="Process games from this date onwards (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        help="Process games up to this date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--update-existing",
        action="store_true",
        help="Update existing box scores (default: only process games without box scores)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be processed without actually inserting data",
    )
    
    args = parser.parse_args()
    
    # Determine date range
    start_date = args.date if args.date else args.start_date
    end_date = args.date if args.date else args.end_date
    
    with psycopg.connect(SUPABASE_DB_URL) as conn:
        conn.execute("begin")
        
        try:
            # Get games to process
            logging.info("Finding games to process...")
            games = get_games_to_process(conn, start_date, end_date, args.update_existing)
            
            if not games:
                logging.info("No games found to process")
                sys.exit(0)
            
            logging.info("Found %d games to process", len(games))
            
            if args.dry_run:
                logging.info("DRY RUN - Would process the following games:")
                for internal_id, nba_id in games[:10]:
                    logging.info("  %s (NBA ID: %s)", internal_id, nba_id)
                if len(games) > 10:
                    logging.info("  ... and %d more", len(games) - 10)
                sys.exit(0)
            
            # Resolve team mappings once
            team_map = resolve_team_mapping(conn)
            logging.info("Resolved %d team mappings", len(team_map))
            
            # Process games
            successful = 0
            failed = 0
            
            for i, (internal_id, nba_id) in enumerate(games, 1):
                logging.info("[%d/%d] Processing game %s...", i, len(games), internal_id)
                
                if process_game(conn, internal_id, nba_id, team_map):
                    successful += 1
                else:
                    failed += 1
                
                # Commit after each game
                conn.execute("commit")
                conn.execute("begin")
                
                # Rate limiting
                if i < len(games):
                    time.sleep(REQUEST_DELAY_MS / 1000)
            
            conn.execute("commit")
            
            logging.info("=" * 60)
            logging.info("Processing complete!")
            logging.info("  Successful: %d", successful)
            logging.info("  Failed: %d", failed)
            logging.info("  Total: %d", len(games))
            
        except Exception as exc:
            conn.execute("rollback")
            logging.exception("Fatal error: %s", exc)
            sys.exit(1)


if __name__ == "__main__":
    main()

