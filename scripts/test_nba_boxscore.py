#!/usr/bin/env python3
"""
Test script to fetch box scores from NBA Stats API.

Usage:
    python scripts/test_nba_boxscore.py --game-id 0022500001
    python scripts/test_nba_boxscore.py --game-id 18446819  # BallDontLie game ID
"""

import argparse
import logging
import sys
from typing import List

from nba_api.stats.endpoints import boxscoretraditionalv2
from pydantic import BaseModel, ConfigDict, Field, ValidationError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class BoxScorePlayer(BaseModel):
    """NBA Stats box score player model."""

    model_config = ConfigDict(extra="ignore")

    game_id: str = Field(alias="GAME_ID")
    team_id: int = Field(alias="TEAM_ID")
    player_id: int = Field(alias="PLAYER_ID")
    player_name: str = Field(alias="PLAYER_NAME")
    start_position: str | None = Field(alias="START_POSITION", default=None)
    comment: str | None = Field(alias="COMMENT", default=None)
    minutes: str | None = Field(alias="MIN", default=None)
    fgm: float | None = Field(alias="FGM", default=None)
    fga: float | None = Field(alias="FGA", default=None)
    tpm: float | None = Field(alias="FG3M", default=None)
    tpa: float | None = Field(alias="FG3A", default=None)
    ftm: float | None = Field(alias="FTM", default=None)
    fta: float | None = Field(alias="FTA", default=None)
    oreb: float | None = Field(alias="OREB", default=None)
    dreb: float | None = Field(alias="DREB", default=None)
    reb: float | None = Field(alias="REB", default=None)
    ast: float | None = Field(alias="AST", default=None)
    stl: float | None = Field(alias="STL", default=None)
    blk: float | None = Field(alias="BLK", default=None)
    to: float | None = Field(alias="TOV", default=None)
    pts: float | None = Field(alias="PTS", default=None)
    plus_minus: float | None = Field(alias="PLUS_MINUS", default=None)


def fetch_boxscore_v3(game_id: str) -> List[dict]:
    """Fetch box score from NBA Stats API using V3 endpoint."""
    try:
        from nba_api.stats.endpoints import BoxScoreTraditionalV3
        
        logging.info("Fetching box score (V3) for game %s...", game_id)
        endpoint = BoxScoreTraditionalV3(game_id=game_id)
        data = endpoint.get_dict()
        
        boxscore = data.get("boxScoreTraditional", {})
        home_team = boxscore.get("homeTeam", {})
        away_team = boxscore.get("awayTeam", {})
        
        # Flatten players from both teams
        all_players = []
        
        for player in home_team.get("players", []):
            stats = player.get("statistics", {})
            player_data = {
                "GAME_ID": game_id,
                "TEAM_ID": home_team.get("teamId"),
                "PLAYER_ID": player.get("personId"),
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
        
        for player in away_team.get("players", []):
            stats = player.get("statistics", {})
            player_data = {
                "GAME_ID": game_id,
                "TEAM_ID": away_team.get("teamId"),
                "PLAYER_ID": player.get("personId"),
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
    except Exception as exc:
        logging.error("Failed to fetch box score: %s", exc)
        raise


def parse_player_stats(raw_stats: List[dict]) -> List[BoxScorePlayer]:
    """Parse and validate player stats."""
    parsed: List[BoxScorePlayer] = []
    errors = 0
    
    for raw in raw_stats:
        try:
            parsed.append(BoxScorePlayer.model_validate(raw))
        except ValidationError as exc:
            errors += 1
            logging.warning("Failed to parse player stat: %s", exc)
    
    if errors > 0:
        logging.warning("Failed to parse %d of %d player stats", errors, len(raw_stats))
    
    return parsed


def print_player_stats(stats: List[BoxScorePlayer]) -> None:
    """Print player stats in a readable format."""
    print(f"\n{'='*80}")
    print(f"Box Score - {len(stats)} players")
    print(f"{'='*80}")
    
    # Group by team
    teams: dict[int, List[BoxScorePlayer]] = {}
    for stat in stats:
        if stat.team_id not in teams:
            teams[stat.team_id] = []
        teams[stat.team_id].append(stat)
    
    for team_id, team_stats in teams.items():
        print(f"\nTeam ID: {team_id} ({len(team_stats)} players)")
        print("-" * 80)
        print(f"{'Player':<25} {'MIN':<8} {'PTS':<6} {'REB':<6} {'AST':<6} {'STL':<6} {'BLK':<6} {'TO':<6} {'+/-':<6}")
        print("-" * 80)
        
        for stat in team_stats:
            print(
                f"{stat.player_name:<25} "
                f"{stat.minutes or 'DNP':<8} "
                f"{stat.pts or 0:<6} "
                f"{stat.reb or 0:<6} "
                f"{stat.ast or 0:<6} "
                f"{stat.stl or 0:<6} "
                f"{stat.blk or 0:<6} "
                f"{stat.to or 0:<6} "
                f"{stat.plus_minus or 0:<6}"
            )


def get_nba_stats_game_id_from_internal(conn, internal_game_id: str) -> str | None:
    """Get NBA Stats game ID from provider_id_map."""
    result = conn.execute(
        """
        select provider_id
        from provider_id_map
        where entity_type = 'game'
          and internal_id = %s
          and provider = 'nba'
        limit 1
        """,
        (internal_game_id,),
    )
    row = result.fetchone()
    return row[0] if row else None


def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Test NBA Stats box score fetching")
    parser.add_argument(
        "--game-id",
        type=str,
        required=True,
        help="Game ID (internal, NBA Stats, or BallDontLie - will look up NBA Stats ID)",
    )
    parser.add_argument("--direct", action="store_true", help="Use game ID directly (don't look up mapping)")
    
    args = parser.parse_args()
    
    try:
        game_id_to_use = args.game_id
        
        # If not direct, try to resolve NBA Stats game ID from provider mappings
        if not args.direct:
            import os
            from dotenv import load_dotenv
            import psycopg
            
            load_dotenv()
            supabase_url = os.getenv("SUPABASE_DB_URL")
            if supabase_url:
                with psycopg.connect(supabase_url) as conn:
                    nba_id = get_nba_stats_game_id_from_internal(conn, args.game_id)
                    if nba_id:
                        game_id_to_use = nba_id
                        logging.info("Resolved NBA Stats game ID: %s -> %s", args.game_id, game_id_to_use)
                    else:
                        logging.warning(
                            "No NBA Stats mapping found for %s, using directly (may fail if not NBA Stats ID)",
                            args.game_id,
                        )
        
        # Fetch raw data using V3 endpoint
        raw_stats = fetch_boxscore_v3(game_id_to_use)
        
        if not raw_stats:
            print(f"No player stats found for game {args.game_id}")
            print("This might mean:")
            print("  - Game hasn't been played yet")
            print("  - Game ID format is incorrect")
            print("  - API is not returning data")
            sys.exit(1)
        
        # Parse and validate
        parsed_stats = parse_player_stats(raw_stats)
        
        # Print results
        print_player_stats(parsed_stats)
        
        # Print raw sample
        print(f"\n{'='*80}")
        print("Raw API response sample (first player):")
        print(f"{'='*80}")
        if raw_stats:
            import json
            print(json.dumps(raw_stats[0], indent=2))
        
    except Exception as error:
        logging.exception("Unhandled exception: %s", error)
        sys.exit(1)


if __name__ == "__main__":
    main()

