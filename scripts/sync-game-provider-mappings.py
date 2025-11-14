#!/usr/bin/env python3
"""
Sync game provider mappings and cross-reference games between providers.

This script:
1. Creates provider mappings for NBA Stats games (002...)
2. Cross-references games between NBA Stats and BallDontLie by date/teams
3. Creates bidirectional mappings so we can fetch box scores from NBA Stats
   even if the game was originally seeded from BallDontLie
"""

import logging
import os
import sys
from typing import Dict, Optional

import psycopg
from dotenv import load_dotenv

load_dotenv()

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    logging.error("Missing SUPABASE_DB_URL")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def create_nba_stats_mappings(conn: psycopg.Connection) -> None:
    """Create provider mappings for NBA Stats games that don't have them."""
    logging.info("Creating provider mappings for NBA Stats games...")
    
    result = conn.execute(
        """
        insert into provider_id_map (
            entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
        )
        select 
            'game',
            g.game_id,
            'nba',
            g.game_id,
            jsonb_build_object('source', 'nba_stats', 'seeded_from_scoreboard', true),
            now(),
            now(),
            now()
        from games g
        where g.game_id like '002%'
          and not exists (
              select 1
              from provider_id_map pm
              where pm.entity_type = 'game'
                and pm.provider = 'nba'
                and pm.provider_id = g.game_id
          )
        on conflict (entity_type, provider, provider_id) do nothing
        returning internal_id
        """
    )
    
    count = len(result.fetchall())
    logging.info("Created %d NBA Stats provider mappings", count)


def cross_reference_games(conn: psycopg.Connection) -> None:
    """Cross-reference games between NBA Stats and BallDontLie by matching date/teams."""
    logging.info("Cross-referencing games between providers...")
    
    # Match games by ET date and team abbreviations
    result = conn.execute(
        """
        insert into provider_id_map (
            entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
        )
        select distinct
            'game',
            nba_game.game_id as internal_id,
            'nba' as provider,
            nba_game.game_id as provider_id,
            jsonb_build_object(
                'source', 'nba_stats',
                'cross_referenced_from', 'balldontlie',
                'matched_by', 'date_and_teams'
            ) as metadata,
            now(),
            now(),
            now()
        from games nba_game
        join teams nba_home on nba_game.home_team_id = nba_home.team_id
        join teams nba_away on nba_game.away_team_id = nba_away.team_id
        join games bdl_game on (
            (nba_game.start_time at time zone 'America/New_York')::date = 
            (bdl_game.start_time at time zone 'America/New_York')::date
        )
        join teams bdl_home on bdl_game.home_team_id = bdl_home.team_id
        join teams bdl_away on bdl_game.away_team_id = bdl_away.team_id
        where nba_game.game_id like '002%'
          and bdl_game.game_id like '184%'
          and nba_home.abbreviation = bdl_home.abbreviation
          and nba_away.abbreviation = bdl_away.abbreviation
          and not exists (
              select 1
              from provider_id_map pm
              where pm.entity_type = 'game'
                and pm.provider = 'nba'
                and pm.provider_id = nba_game.game_id
          )
        on conflict (entity_type, provider, provider_id) do nothing
        returning internal_id
        """
    )
    
    count = len(result.fetchall())
    logging.info("Cross-referenced %d NBA Stats games with BallDontLie games", count)
    
    # Also create reverse mappings (NBA Stats -> BallDontLie for games that match)
    result2 = conn.execute(
        """
        insert into provider_id_map (
            entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
        )
        select distinct
            'game',
            bdl_game.game_id as internal_id,
            'balldontlie' as provider,
            bdl_game.game_id as provider_id,
            jsonb_build_object(
                'source', 'balldontlie',
                'cross_referenced_from', 'nba_stats',
                'matched_by', 'date_and_teams'
            ) as metadata,
            now(),
            now(),
            now()
        from games nba_game
        join teams nba_home on nba_game.home_team_id = nba_home.team_id
        join teams nba_away on nba_game.away_team_id = nba_away.team_id
        join games bdl_game on (
            (nba_game.start_time at time zone 'America/New_York')::date = 
            (bdl_game.start_time at time zone 'America/New_York')::date
        )
        join teams bdl_home on bdl_game.home_team_id = bdl_home.team_id
        join teams bdl_away on bdl_game.away_team_id = bdl_away.team_id
        where nba_game.game_id like '002%'
          and bdl_game.game_id like '184%'
          and nba_home.abbreviation = bdl_home.abbreviation
          and nba_away.abbreviation = bdl_away.abbreviation
          and not exists (
              select 1
              from provider_id_map pm
              where pm.entity_type = 'game'
                and pm.provider = 'balldontlie'
                and pm.provider_id = bdl_game.game_id
          )
        on conflict (entity_type, provider, provider_id) do nothing
        returning internal_id
        """
    )
    
    count2 = len(result2.fetchall())
    logging.info("Created %d additional BallDontLie mappings", count2)


def get_nba_stats_game_id(conn: psycopg.Connection, internal_game_id: str) -> Optional[str]:
    """Get NBA Stats game ID for a given internal game ID."""
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
    with psycopg.connect(SUPABASE_DB_URL) as conn:
        conn.execute("begin")
        
        try:
            create_nba_stats_mappings(conn)
            cross_reference_games(conn)
            
            conn.execute("commit")
            logging.info("Provider mapping sync complete")
            
            # Test: Show some cross-referenced games
            logging.info("\nSample cross-referenced games:")
            result = conn.execute(
                """
                select 
                    g.game_id as internal_id,
                    nba_pm.provider_id as nba_game_id,
                    bdl_pm.provider_id as bdl_game_id,
                    g.status,
                    g.home_score,
                    g.away_score
                from games g
                left join provider_id_map nba_pm on g.game_id = nba_pm.internal_id 
                    and nba_pm.entity_type = 'game' and nba_pm.provider = 'nba'
                left join provider_id_map bdl_pm on g.game_id = bdl_pm.internal_id 
                    and bdl_pm.entity_type = 'game' and bdl_pm.provider = 'balldontlie'
                where (nba_pm.provider_id is not null or bdl_pm.provider_id is not null)
                  and g.start_time::date >= '2025-10-21'
                  and g.start_time::date <= '2025-10-22'
                order by g.start_time
                limit 5
                """
            )
            
            for row in result.fetchall():
                logging.info(
                    "  Internal: %s | NBA: %s | BDL: %s | Status: %s | Score: %s-%s",
                    row[0],
                    row[1] or "N/A",
                    row[2] or "N/A",
                    row[3],
                    row[4] or "?",
                    row[5] or "?",
                )
                
        except Exception as exc:
            conn.execute("rollback")
            logging.exception("Failed to sync provider mappings: %s", exc)
            sys.exit(1)


if __name__ == "__main__":
    main()

