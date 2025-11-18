#!/usr/bin/env python3
"""
Seed games from NBA Stats API first, then cross-reference with BallDontLie.

This ensures NBA Stats (authoritative source) is primary, and BallDontLie is used
for cross-referencing and filling in any gaps.
"""

import logging
import os
import sys
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

import psycopg
from dotenv import load_dotenv
from nba_api.stats.endpoints import scoreboardv2
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from psycopg.types.json import Json

load_dotenv()

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    logging.error("Missing SUPABASE_DB_URL")
    sys.exit(1)

REQUEST_DELAY_SECONDS = float(os.getenv("NBA_STATS_REQUEST_DELAY_SECONDS", "0.7"))
EASTERN_TZ = ZoneInfo("America/New_York")


class ScoreboardGameHeader(BaseModel):
    model_config = ConfigDict(extra="ignore")

    game_id: str = Field(alias="GAME_ID")
    game_status_text: str = Field(alias="GAME_STATUS_TEXT")
    game_status_id: int = Field(alias="GAME_STATUS_ID")
    game_date_est: str = Field(alias="GAME_DATE_EST")
    home_team_id: int = Field(alias="HOME_TEAM_ID")
    visitor_team_id: int = Field(alias="VISITOR_TEAM_ID")
    season: str = Field(alias="SEASON")
    arena_name: Optional[str] = Field(alias="ARENA_NAME", default=None)


def resolve_team_mapping(conn: psycopg.Connection) -> Dict[str, str]:
    """Get mapping from NBA Stats team IDs to internal team IDs."""
    rows = conn.execute(
        """
        SELECT provider_id, internal_id
        FROM provider_id_map
        WHERE entity_type = 'team' AND provider = 'nba'
        """
    ).fetchall()
    mapping = {row[0]: row[1] for row in rows}
    if not mapping:
        raise RuntimeError("No team mappings found for provider='nba'. Seed teams first.")
    return mapping


def fetch_nba_games_for_date(game_date: datetime) -> List[ScoreboardGameHeader]:
    """Fetch games from NBA Stats API for a specific date."""
    try:
        endpoint = scoreboardv2.ScoreboardV2(game_date=game_date.strftime("%m/%d/%Y"))
        headers = endpoint.get_normalized_dict().get("GameHeader", [])
        
        parsed: List[ScoreboardGameHeader] = []
        for raw in headers:
            try:
                parsed.append(ScoreboardGameHeader.model_validate(raw))
            except ValidationError as exc:
                logging.warning("Failed to parse scoreboard game for %s: %s", game_date.date(), exc)
        return parsed
    except Exception as exc:
        logging.error("Failed to fetch NBA games for %s: %s", game_date.date(), exc)
        return []


def upsert_nba_game(conn: psycopg.Connection, game: ScoreboardGameHeader, team_map: Dict[str, str], season: str) -> bool:
    """Insert or update NBA Stats game in database."""
    home_provider_id = str(game.home_team_id)
    away_provider_id = str(game.visitor_team_id)
    
    home_internal_id = team_map.get(home_provider_id)
    away_internal_id = team_map.get(away_provider_id)
    
    if not home_internal_id or not away_internal_id:
        logging.warning("Missing team mapping for game %s: home=%s, away=%s", 
                       game.game_id, home_provider_id, away_provider_id)
        return False
    
    # Parse start time
    try:
        base = datetime.fromisoformat(game.game_date_est)
    except ValueError:
        base = datetime.strptime(game.game_date_est[:10], "%Y-%m-%d")
    
    if base.tzinfo is None:
        base = base.replace(tzinfo=EASTERN_TZ)
    else:
        base = base.astimezone(EASTERN_TZ)
    
    start_time_utc = base.astimezone(ZoneInfo("UTC"))
    
    try:
        conn.execute(
            """
            INSERT INTO games (
                game_id, season, start_time, status, home_team_id, away_team_id,
                home_score, away_score, venue, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now(), now())
            ON CONFLICT (game_id) DO UPDATE SET
                season = excluded.season,
                start_time = excluded.start_time,
                status = excluded.status,
                home_team_id = excluded.home_team_id,
                away_team_id = excluded.away_team_id,
                home_score = excluded.home_score,
                away_score = excluded.away_score,
                venue = excluded.venue,
                updated_at = now()
            """,
            (
                game.game_id,
                season,
                start_time_utc,
                game.game_status_text,
                home_internal_id,
                away_internal_id,
                None,  # Scores will be filled from boxscore
                None,
                game.arena_name,
            ),
        )
        
        # Create provider mapping
        conn.execute(
            """
            INSERT INTO provider_id_map (
                entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
            ) VALUES ('game', %s, 'nba', %s, %s::jsonb, now(), now(), now())
            ON CONFLICT (entity_type, provider, provider_id) DO UPDATE SET
                internal_id = excluded.internal_id,
                metadata = excluded.metadata,
                fetched_at = excluded.fetched_at,
                updated_at = now()
            """,
            (
                game.game_id,
                game.game_id,
                Json({"source": "nba_stats", "seeded_from_scoreboard": True}),
            ),
        )
        
        return True
    except Exception as exc:
        logging.error("Failed to upsert NBA game %s: %s", game.game_id, exc)
        return False


def cross_reference_with_bdl(conn: psycopg.Connection, nba_game_id: str, nba_date: datetime, 
                              home_abbr: str, away_abbr: str) -> Optional[str]:
    """Find matching BallDontLie game for an NBA Stats game."""
    result = conn.execute(
        """
        SELECT bdl_game.game_id
        FROM games bdl_game
        JOIN teams bdl_home ON bdl_game.home_team_id = bdl_home.team_id
        JOIN teams bdl_away ON bdl_game.away_team_id = bdl_away.team_id
        WHERE bdl_game.game_id LIKE '184%%'
          AND (bdl_game.start_time AT TIME ZONE 'America/New_York')::date = (%s AT TIME ZONE 'America/New_York')::date
          AND bdl_home.abbreviation = %s
          AND bdl_away.abbreviation = %s
        LIMIT 1
        """,
        (nba_date, home_abbr, away_abbr),
    )
    
    row = result.fetchone()
    return row[0] if row else None


def create_bdl_mapping(conn: psycopg.Connection, nba_game_id: str, bdl_game_id: str) -> None:
    """Create bidirectional mapping between NBA Stats and BallDontLie games."""
    # Map NBA -> BDL
    conn.execute(
        """
        INSERT INTO provider_id_map (
            entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
        ) VALUES ('game', %s, 'balldontlie', %s, %s::jsonb, now(), now(), now())
        ON CONFLICT (entity_type, provider, provider_id) DO UPDATE SET
            internal_id = excluded.internal_id,
            metadata = excluded.metadata,
            updated_at = now()
        """,
        (
            nba_game_id,  # Use NBA game as internal ID (authoritative)
            bdl_game_id,
            Json({"source": "balldontlie", "cross_referenced_from": "nba_stats", "matched_by": "date_and_teams"}),
        ),
    )
    
    # Also map BDL -> NBA (if BDL game exists as internal ID)
    conn.execute(
        """
        INSERT INTO provider_id_map (
            entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
        ) VALUES ('game', %s, 'nba', %s, %s::jsonb, now(), now(), now())
        ON CONFLICT (entity_type, provider, provider_id) DO UPDATE SET
            internal_id = excluded.internal_id,
            metadata = excluded.metadata,
            updated_at = now()
        """,
        (
            bdl_game_id,
            nba_game_id,
            Json({"source": "nba_stats", "cross_referenced_from": "balldontlie", "matched_by": "date_and_teams"}),
        ),
    )


def main() -> None:
    import argparse
    
    parser = argparse.ArgumentParser(description="Seed games from NBA Stats, then cross-reference with BallDontLie")
    parser.add_argument("--start-date", type=str, required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", type=str, required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--season", type=str, default="2025-26", help="Season (e.g., 2025-26)")
    
    args = parser.parse_args()
    
    start_dt = datetime.fromisoformat(f"{args.start_date}T00:00:00").replace(tzinfo=EASTERN_TZ)
    end_dt = datetime.fromisoformat(f"{args.end_date}T00:00:00").replace(tzinfo=EASTERN_TZ)
    
    if start_dt > end_dt:
        logging.error("Start date must be before end date")
        sys.exit(1)
    
    print(f"Starting seed from {start_dt.date()} to {end_dt.date()}")
    logging.info("Seeding games from NBA Stats API (%s to %s)", start_dt.date(), end_dt.date())
    
    with psycopg.connect(SUPABASE_DB_URL) as conn:
        conn.execute("begin")
        
        try:
            print("Resolving team mappings...")
            team_map = resolve_team_mapping(conn)
            print(f"Resolved {len(team_map)} team mappings")
            logging.info("Resolved %d team mappings", len(team_map))
            
            current_date = start_dt
            total_nba_games = 0
            total_mapped = 0
            
            while current_date <= end_dt:
                print(f"\nProcessing {current_date.date()}...")
                logging.info("Processing %s...", current_date.date())
                
                # Fetch games from NBA Stats
                print(f"Fetching games from NBA Stats API...")
                nba_games = fetch_nba_games_for_date(current_date)
                print(f"Found {len(nba_games)} games from NBA Stats")
                logging.info("  Found %d games from NBA Stats", len(nba_games))
                
                for game in nba_games:
                    print(f"  Processing game {game.game_id}...")
                    # Upsert NBA game
                    if upsert_nba_game(conn, game, team_map, args.season):
                        total_nba_games += 1
                        print(f"    Upserted NBA game {game.game_id}")
                        
                        # Get team abbreviations for cross-referencing
                        home_abbr_result = conn.execute(
                            "SELECT abbreviation FROM teams WHERE team_id = %s",
                            (team_map[str(game.home_team_id)],),
                        ).fetchone()
                        away_abbr_result = conn.execute(
                            "SELECT abbreviation FROM teams WHERE team_id = %s",
                            (team_map[str(game.visitor_team_id)],),
                        ).fetchone()
                        
                        if home_abbr_result and away_abbr_result:
                            home_abbr = home_abbr_result[0]
                            away_abbr = away_abbr_result[0]
                            
                            # Cross-reference with BallDontLie
                            bdl_game_id = cross_reference_with_bdl(
                                conn, game.game_id, current_date, home_abbr, away_abbr
                            )
                            
                            if bdl_game_id:
                                create_bdl_mapping(conn, game.game_id, bdl_game_id)
                                total_mapped += 1
                                print(f"    Mapped NBA {game.game_id} <-> BDL {bdl_game_id} ({away_abbr} @ {home_abbr})")
                                logging.info("    Mapped NBA %s <-> BDL %s (%s @ %s)", 
                                           game.game_id, bdl_game_id, away_abbr, home_abbr)
                
                time.sleep(REQUEST_DELAY_SECONDS)
                current_date += timedelta(days=1)
            
            print(f"\nCommitting transaction...")
            conn.execute("commit")
            print(f"Complete! Processed {total_nba_games} NBA games, created {total_mapped} BDL mappings")
            logging.info("Complete! Processed %d NBA games, created %d BDL mappings", 
                        total_nba_games, total_mapped)
            
        except Exception as exc:
            conn.execute("rollback")
            print(f"ERROR: {exc}")
            import traceback
            traceback.print_exc()
            logging.exception("Failed to seed games: %s", exc)
            sys.exit(1)


if __name__ == "__main__":
    main()

