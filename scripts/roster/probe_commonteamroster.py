"""
Phase 2.T.2D.1 — Fetch-only NBA.com CommonTeamRoster probe.

Uses the same nba_api CommonTeamRoster path as scripts/seed_players_nba.py.
Never writes players, player_team_rosters, staging_events, or analytics stints.

Usage:
  python scripts/roster/probe_commonteamroster.py --season 2026-27
  python scripts/roster/probe_commonteamroster.py --season 2026-27 --out reports/roster/2026-27-nba-fetch.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import psycopg
from dotenv import load_dotenv
from nba_api.stats.endpoints import commonteamroster

load_dotenv()

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
REQUEST_DELAY_SECONDS = float(os.getenv("NBA_STATS_REQUEST_DELAY_SECONDS", "0.7"))


def _json_default(value: Any):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def fetch_modern_team_mappings(conn: psycopg.Connection) -> List[Dict[str, str]]:
    """
    Modern NBA teams only: nba provider map joined to analytics.teams with a
    3-letter abbreviation (excludes legacy/ABA junk ids).
    """
    rows = conn.execute(
        """
        SELECT m.provider_id, m.internal_id, t.abbreviation, t.full_name
          FROM provider_id_map m
          JOIN analytics.teams t ON t.team_id = m.internal_id
         WHERE m.entity_type = 'team'
           AND m.provider = 'nba'
           AND t.abbreviation IS NOT NULL
           AND length(t.abbreviation) = 3
           AND t.abbreviation NOT IN ('EAST', 'WEST')
         ORDER BY t.abbreviation
        """
    ).fetchall()
    return [
        {
            "provider_team_id": str(r[0]),
            "internal_team_id": str(r[1]),
            "abbreviation": str(r[2]),
            "full_name": str(r[3]) if r[3] is not None else None,
        }
        for r in rows
    ]


def fetch_roster_raw(team_id: str, season: str) -> Dict[str, Any]:
    endpoint = commonteamroster.CommonTeamRoster(team_id=team_id, season=season)
    payload = endpoint.get_normalized_dict()
    roster = payload.get("CommonTeamRoster", []) or []
    keys: List[str] = []
    if roster:
        keys = sorted({k for row in roster for k in row.keys()})
    return {
        "rows": roster,
        "result_set_keys": keys,
        "payload_keys": sorted(payload.keys()),
    }


def median(values: List[int]) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2:
        return float(s[mid])
    return (s[mid - 1] + s[mid]) / 2.0


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch-only CommonTeamRoster probe")
    parser.add_argument("--season", required=True, help="NBA season label e.g. 2026-27")
    parser.add_argument(
        "--out",
        default=None,
        help="Output JSON path (default reports/roster/{season}-nba-fetch.json)",
    )
    args = parser.parse_args()
    season = args.season.strip()
    out_path = Path(
        args.out
        or Path("reports") / "roster" / f"{season}-nba-fetch.json"
    )

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if not SUPABASE_DB_URL:
        logging.error("Missing SUPABASE_DB_URL")
        sys.exit(1)

    teams_attempted = 0
    teams_ok = 0
    teams_failed: List[Dict[str, str]] = []
    players: List[Dict[str, Any]] = []
    players_per_team: Dict[str, int] = {}
    schema_keys_union: set[str] = set()
    sample_raw_keys: List[str] = []
    payload_keys_sample: List[str] = []
    seen_ids: Dict[str, str] = {}
    duplicate_nba_player_ids: List[Dict[str, Any]] = []

    with psycopg.connect(SUPABASE_DB_URL) as conn:
        teams = fetch_modern_team_mappings(conn)
        logging.info(
            "Probe CommonTeamRoster season=%s teams=%s (fetch-only, no writes)",
            season,
            len(teams),
        )

        for index, team in enumerate(teams, start=1):
            teams_attempted += 1
            abbr = team["abbreviation"]
            provider_team_id = team["provider_team_id"]
            logging.info(
                "[%d/%d] %s provider_team_id=%s",
                index,
                len(teams),
                abbr,
                provider_team_id,
            )
            try:
                fetched = fetch_roster_raw(provider_team_id, season)
                rows = fetched["rows"]
                if fetched["result_set_keys"]:
                    schema_keys_union.update(fetched["result_set_keys"])
                    if not sample_raw_keys:
                        sample_raw_keys = fetched["result_set_keys"]
                if fetched["payload_keys"] and not payload_keys_sample:
                    payload_keys_sample = fetched["payload_keys"]

                teams_ok += 1
                players_per_team[abbr] = len(rows)

                for row in rows:
                    nba_player_id = str(row.get("PLAYER_ID") or "")
                    player = {
                        "nba_player_id": nba_player_id,
                        "player_name": row.get("PLAYER"),
                        "team_abbreviation": row.get("TEAM_ABBREVIATION") or abbr,
                        "nba_team_id": str(row.get("TEAM_ID") or provider_team_id),
                        "analytics_team_id": team["internal_team_id"],
                        "jersey": None if row.get("NUM") in (None, "") else str(row.get("NUM")),
                        "position": row.get("POSITION"),
                        "height": row.get("HEIGHT"),
                        "weight": None if row.get("WEIGHT") in (None, "") else str(row.get("WEIGHT")),
                        "experience": row.get("EXP"),
                        "school": row.get("SCHOOL"),
                        "roster_status": row.get("ROSTERSTATUS"),
                        "age": row.get("AGE"),
                        "birth_date": row.get("BIRTH_DATE"),
                        "api_season_field": row.get("SEASON"),
                        "raw": row,
                    }
                    players.append(player)
                    if nba_player_id:
                        if nba_player_id in seen_ids and seen_ids[nba_player_id] != abbr:
                            duplicate_nba_player_ids.append(
                                {
                                    "nba_player_id": nba_player_id,
                                    "name": player["player_name"],
                                    "teams": [seen_ids[nba_player_id], abbr],
                                }
                            )
                        seen_ids[nba_player_id] = abbr
            except Exception as exc:  # noqa: BLE001
                teams_failed.append(
                    {
                        "abbreviation": abbr,
                        "provider_team_id": provider_team_id,
                        "error": str(exc),
                    }
                )
                logging.exception("Failed %s: %s", abbr, exc)
            finally:
                time.sleep(REQUEST_DELAY_SECONDS)

    counts = list(players_per_team.values())
    expected_fields = [
        "PLAYER_ID",
        "PLAYER",
        "NUM",
        "POSITION",
        "HEIGHT",
        "WEIGHT",
        "BIRTH_DATE",
        "AGE",
        "EXP",
        "SCHOOL",
        "ROSTERSTATUS",
        "TEAM_ID",
        "TEAM_ABBREVIATION",
        "SEASON",
    ]
    field_availability = {
        f: f in schema_keys_union for f in expected_fields
    }

    # API often returns SEASON as start year ("2026") even when requested as 2026-27
    api_season_values = sorted(
        {
            str(p.get("api_season_field"))
            for p in players
            if p.get("api_season_field") is not None
        }
    )

    report = {
        "phase": "2.T.2D.1",
        "mode": "fetch_only",
        "requested_season": season,
        "fetched_at": datetime.utcnow().isoformat() + "Z",
        "writes": {
            "analytics_player_team_stints": False,
            "public_player_team_rosters": False,
            "public_players": False,
            "staging_events": False,
            "raw_nba_roster_snapshots": False,
        },
        "teams_attempted": teams_attempted,
        "teams_successful": teams_ok,
        "teams_failed": teams_failed,
        "total_roster_players": len(players),
        "players_per_team": players_per_team,
        "roster_size_stats": {
            "min": min(counts) if counts else None,
            "median": median(counts),
            "max": max(counts) if counts else None,
        },
        "suspicious_roster_sizes": {
            k: v for k, v in players_per_team.items() if v < 12 or v > 22
        },
        "duplicate_nba_player_ids": duplicate_nba_player_ids,
        "schema": {
            "payload_keys_sample": payload_keys_sample,
            "result_set_keys_union": sorted(schema_keys_union),
            "field_availability": field_availability,
            "api_season_field_distinct_values": api_season_values,
            "note": (
                "Configured target season label must be forced on persist "
                "(API SEASON field may be start-year only)."
            ),
        },
        "players": players,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, default=_json_default), encoding="utf-8")
    logging.info("Wrote %s (%s players)", out_path, len(players))

    # Compact stdout summary (no full player dump)
    summary = {k: v for k, v in report.items() if k != "players"}
    print(json.dumps(summary, indent=2, default=_json_default))


if __name__ == "__main__":
    main()
