"""Backfill quarter data for existing games that don't have it."""
import os
import sys
from dotenv import load_dotenv
import psycopg
from nba_api.stats.endpoints import BoxScoreSummaryV2
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
load_dotenv()

def to_int(value):
    """Convert value to int, return None if invalid."""
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

def fetch_quarter_data(nba_game_id: str) -> list:
    """Fetch quarter-by-quarter team totals from BoxScoreSummaryV2."""
    try:
        endpoint = BoxScoreSummaryV2(game_id=nba_game_id)
        data = endpoint.get_normalized_dict()
        line_score = data.get("LineScore", [])
        if not line_score:
            return []
        return line_score
    except Exception as exc:
        logging.error("Error fetching quarter data for game %s: %s", nba_game_id, exc)
        return []

def resolve_team_mapping(conn: psycopg.Connection) -> dict:
    """Get mapping from NBA Stats team ID to internal team ID."""
    rows = conn.execute("""
        select provider_id, internal_id
        from provider_id_map
        where entity_type = 'team'
          and provider = 'nba'
    """).fetchall()
    mapping = {str(row[0]): row[1] for row in rows}  # Convert provider_id to string for matching
    if not mapping:
        raise RuntimeError("No team mappings found for provider='nba'. Seed provider_id_map first.")
    return mapping

def main():
    conn = psycopg.connect(os.getenv('SUPABASE_DB_URL'))
    
    # Get team mapping
    team_map = resolve_team_mapping(conn)
    reverse_team_map = {v: k for k, v in team_map.items()}  # internal_id -> provider_id
    
    # Find games that need quarter data backfilled
    games_to_update = conn.execute("""
        SELECT DISTINCT g.game_id, g.status
        FROM games g
        JOIN team_game_stats tgs ON g.game_id = tgs.game_id
        WHERE g.status = 'Final'
          AND (tgs.points_q1 IS NULL AND tgs.points_q2 IS NULL 
               AND tgs.points_q3 IS NULL AND tgs.points_q4 IS NULL)
        ORDER BY g.game_id
    """).fetchall()
    
    logging.info("Found %d games that need quarter data backfilled", len(games_to_update))
    
    updated = 0
    failed = 0
    
    for game_id, status in games_to_update:
        logging.info("Processing game %s...", game_id)
        
        # Fetch quarter data from NBA API
        quarter_data = fetch_quarter_data(game_id)
        
        if not quarter_data:
            logging.warning("No quarter data available for game %s", game_id)
            failed += 1
            time.sleep(0.6)  # Rate limiting
            continue
        
        # Get teams for this game
        game_teams = conn.execute("""
            SELECT DISTINCT team_id FROM team_game_stats WHERE game_id = %s
        """, (game_id,)).fetchall()
        
        for (team_internal_id,) in game_teams:
            # Get provider team ID
            team_provider_id = reverse_team_map.get(team_internal_id)
            if not team_provider_id:
                logging.warning("No provider mapping for team %s in game %s", team_internal_id, game_id)
                continue
            
            # Find quarter data for this team
            quarter_points = {}
            for team_line in quarter_data:
                # NBA API returns TEAM_ID as integer, convert to string for comparison
                api_team_id = str(team_line.get("TEAM_ID"))
                if api_team_id == str(team_provider_id):
                    quarter_points = {
                        "q1": to_int(team_line.get("PTS_QTR1")),
                        "q2": to_int(team_line.get("PTS_QTR2")),
                        "q3": to_int(team_line.get("PTS_QTR3")),
                        "q4": to_int(team_line.get("PTS_QTR4")),
                        "ot": to_int(team_line.get("PTS_OT1")) or to_int(team_line.get("PTS_OT2")) or to_int(team_line.get("PTS_OT3")) or None,
                    }
                    break
            
            # Update team_game_stats with quarter data
            if quarter_points.get("q1") is not None:  # Only update if we have at least Q1 data
                conn.execute("""
                    UPDATE team_game_stats
                    SET points_q1 = %s,
                        points_q2 = %s,
                        points_q3 = %s,
                        points_q4 = %s,
                        points_ot = %s,
                        updated_at = now()
                    WHERE game_id = %s AND team_id = %s
                """, (
                    quarter_points.get("q1"),
                    quarter_points.get("q2"),
                    quarter_points.get("q3"),
                    quarter_points.get("q4"),
                    quarter_points.get("ot"),
                    game_id,
                    team_internal_id,
                ))
                conn.commit()
                logging.info("Updated quarter data for team %s in game %s: Q1=%s, Q2=%s, Q3=%s, Q4=%s",
                           team_internal_id, game_id,
                           quarter_points.get("q1"), quarter_points.get("q2"),
                           quarter_points.get("q3"), quarter_points.get("q4"))
                updated += 1
            else:
                logging.warning("No quarter data found for team %s (provider %s) in game %s",
                              team_internal_id, team_provider_id, game_id)
        
        time.sleep(0.6)  # Rate limiting for NBA API
    
    logging.info("Backfill complete: %d games updated, %d games failed", updated, failed)
    conn.close()

if __name__ == "__main__":
    main()

