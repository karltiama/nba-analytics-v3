"""
Seed the `players` table using NBA.com data via the nba_api package.

Workflow:
1. Load environment configuration (.env supported).
2. Resolve canonical team IDs via `provider_id_map` (provider='nba').
3. Fetch roster data for each team using CommonTeamRoster.
4. Validate and normalize with Pydantic before database writes.
5. Insert raw payloads into staging_events for replay/debug.
6. Upsert players and provider_id_map rows in a transaction.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable, List, Optional

import psycopg
from dotenv import load_dotenv
from nba_api.stats.endpoints import commonteamroster
from pydantic import BaseModel, ConfigDict, Field, ValidationError, AliasChoices, field_validator

from psycopg import errors
# --------------------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------------------

load_dotenv()

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    logging.error("Missing SUPABASE_DB_URL. Set it in your environment or .env file.")
    sys.exit(1)

TARGET_SEASON = os.getenv("NBA_STATS_SEASON") or os.getenv("CURRENT_ANALYTICS_SEASON") or "2025"
if TARGET_SEASON.isdigit() and len(TARGET_SEASON) == 4:
    _year = int(TARGET_SEASON)
    TARGET_SEASON = f"{_year}-{str(_year + 1)[-2:]}"
TARGET_TEAM_ID = os.getenv("NBA_STATS_TEAM_ID")  # Optional override (NBA Stats team id)
REQUEST_DELAY_SECONDS = float(os.getenv("NBA_STATS_REQUEST_DELAY_SECONDS", "0.7"))
STAGING_ENABLED = os.getenv("NBA_STATS_STAGE_EVENTS", "true").lower() in {"true", "1", "yes"}
# Rehearsal-safe: when true, fetch + validate only — no DB writes.
DRY_RUN = os.getenv("NBA_STATS_DRY_RUN", "false").lower() in {"true", "1", "yes"}
# After a successful full-season run, delete player_team_rosters rows for TARGET_SEASON
# whose player_id was not observed in this snapshot (other seasons untouched).
PRUNE_SEASON_ROSTER = os.getenv("NBA_STATS_PRUNE_SEASON_ROSTER", "true").lower() in {
    "true",
    "1",
    "yes",
}

_staging_disabled_due_to_error = False


# --------------------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------------------

class RosterPlayer(BaseModel):
    """Pydantic model that reflects the CommonTeamRoster player payload."""

    model_config = ConfigDict(extra="ignore")

    player_id: int = Field(alias="PLAYER_ID")
    player_name: str = Field(alias="PLAYER")
    first_name: Optional[str] = Field(alias="FIRST_NAME", default=None)
    last_name: Optional[str] = Field(alias="LAST_NAME", default=None)
    position: Optional[str] = Field(alias="POSITION", default=None)
    height: Optional[str] = Field(alias="HEIGHT", default=None)
    weight: Optional[str] = Field(alias="WEIGHT", default=None)
    jersey: Optional[str] = Field(alias="NUM", default=None)
    birth_date: Optional[date] = Field(alias="BIRTH_DATE", default=None)
    age: Optional[float] = Field(alias="AGE", default=None)
    roster_status: Optional[str] = Field(alias="ROSTERSTATUS", default=None)
    team_id: int = Field(validation_alias=AliasChoices("TEAM_ID", "TeamID"))
    team_name: Optional[str] = Field(alias="TEAM_NAME", default=None)
    team_city: Optional[str] = Field(alias="TEAM_CITY", default=None)
    team_abbreviation: Optional[str] = Field(alias="TEAM_ABBREVIATION", default=None)
    season: str = Field(alias="SEASON")

    @field_validator("birth_date", mode="before")
    @classmethod
    def parse_birth_date(cls, value: Optional[str]) -> Optional[date]:
        if value in (None, "", "NULL"):
            return None

        if isinstance(value, date):
            return value

        # NBA returns strings like "NOV 08, 2002" (uppercase month abbreviations)
        try:
            return datetime.strptime(value.strip(), "%b %d, %Y").date()
        except ValueError:
            # Some payloads use uppercase month fully spelled (e.g., "NOVEMBER 08, 2002")
            for fmt in ("%b %d, %Y", "%B %d, %Y"):
                try:
                    return datetime.strptime(value.strip().title(), fmt).date()
                except ValueError:
                    continue

        raise ValueError(f"Unrecognized birth date format: {value!r}")


class NormalizedPlayer(BaseModel):
    """Canonical representation ready for database insertion."""

    model_config = ConfigDict(extra="ignore")

    player_id: str
    full_name: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    position: Optional[str] = None
    height: Optional[str] = None
    weight: Optional[str] = None
    dob: Optional[date] = None
    active: Optional[bool] = None
    jersey: Optional[str] = None
    team_internal_id: str
    provider_team_id: str
    season: str
    raw: dict


@dataclass(frozen=True)
class TeamMapping:
    provider_team_id: str  # NBA stats team id
    internal_team_id: str  # canonical team id in our system


# --------------------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------------------

UPSERT_PLAYER_SQL = """
    insert into players (
        player_id, full_name, first_name, last_name, position, height, weight, dob, active, created_at, updated_at
    ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now(), now())
    on conflict (player_id) do update set
        full_name = excluded.full_name,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        position = excluded.position,
        height = excluded.height,
        weight = excluded.weight,
        dob = excluded.dob,
        active = excluded.active,
        updated_at = now();
"""

UPSERT_PROVIDER_MAP_SQL = """
    insert into provider_id_map (
        entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
    ) values ('player', %s, 'nba', %s, %s::jsonb, now(), now(), now())
    on conflict (entity_type, provider, provider_id) do update set
        internal_id = excluded.internal_id,
        metadata = excluded.metadata,
        fetched_at = excluded.fetched_at,
        updated_at = now();
"""

UPSERT_PLAYER_ROSTER_SQL = """
    insert into player_team_rosters (
        player_id, team_id, season, active, jersey, created_at, updated_at
    ) values (%s, %s, %s, %s, %s, now(), now())
    on conflict (player_id, season) do update set
        team_id = excluded.team_id,
        active = excluded.active,
        jersey = excluded.jersey,
        updated_at = now();
"""

INSERT_STAGING_EVENT_SQL = """
    insert into staging_events (source, kind, cursor, payload, fetched_at)
    values (%s, %s, %s, %s::jsonb, now());
"""

def _json_default(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def fetch_team_mappings(conn: psycopg.Connection) -> List[TeamMapping]:
    """Fetch provider team mappings for the NBA stats provider."""
    if TARGET_TEAM_ID:
        sql = """
            select internal_id, provider_id
              from provider_id_map
             where entity_type = 'team'
               and provider = 'nba'
               and provider_id = %s
             limit 1;
        """
        rows = conn.execute(sql, (TARGET_TEAM_ID,)).fetchall()
    else:
        sql = """
            select internal_id, provider_id
              from provider_id_map
             where entity_type = 'team'
               and provider = 'nba'
             order by provider_id::int;
        """
        rows = conn.execute(sql).fetchall()

    mappings = [
        TeamMapping(provider_team_id=row[1], internal_team_id=row[0])
        for row in rows
    ]

    if not mappings:
        target_msg = (
            f"provider_id='{TARGET_TEAM_ID}'" if TARGET_TEAM_ID else "provider='nba'"
        )
        raise RuntimeError(f"No team mappings found in provider_id_map for {target_msg}")

    return mappings


def stage_roster_payload(
    conn: psycopg.Connection,
    team_id: str,
    season: str,
    players_raw: Iterable[dict],
) -> None:
    """Persist raw roster payload for auditing if staging is enabled."""
    global _staging_disabled_due_to_error

    if not STAGING_ENABLED or _staging_disabled_due_to_error:
        return

    payload = {
        "team_id": team_id,
        "season": season,
        "players": list(players_raw),
    }

    try:
        conn.execute(
            INSERT_STAGING_EVENT_SQL,
            (
                "nba",
                "team_roster",
                f"{season}:{team_id}",
                json.dumps(payload, default=_json_default),
            ),
        )
    except errors.UndefinedTable:
        logging.warning(
            "Skipping staging_events writes because table does not exist. "
            "Set NBA_STATS_STAGE_EVENTS=false to suppress this warning."
        )
        _staging_disabled_due_to_error = True
    except Exception:
        logging.exception("Failed to insert staging event; continuing without staging.")


def normalize_player(player: RosterPlayer, team: TeamMapping) -> NormalizedPlayer:
    """Convert a roster row into our canonical player shape."""
    first_name = player.first_name.strip() if player.first_name else None
    last_name = player.last_name.strip() if player.last_name else None
    full_name = player.player_name.strip() if player.player_name else "Unknown Player"
    position = player.position.strip() if player.position else None
    height = player.height.strip() if player.height else None
    weight = player.weight.strip() if player.weight else None
    jersey = player.jersey.strip() if isinstance(player.jersey, str) else None

    active = None
    if player.roster_status:
        active = player.roster_status.strip().upper() == "ACTIVE"

    return NormalizedPlayer(
        player_id=str(player.player_id),
        full_name=full_name,
        first_name=first_name,
        last_name=last_name,
        position=position,
        height=height,
        weight=weight,
        dob=player.birth_date,
        active=active,
        jersey=jersey,
        team_internal_id=team.internal_team_id,
        provider_team_id=team.provider_team_id,
        # Always persist the configured target season (e.g. 2025-26), not the
        # raw API SEASON string which may be "2025" / "2025-26" inconsistently.
        season=TARGET_SEASON,
        raw=player.model_dump(by_alias=True),
    )


def fetch_roster(team_id: str, season: str) -> List[RosterPlayer]:
    """Fetch and validate the roster for a single team/season."""
    try:
        endpoint = commonteamroster.CommonTeamRoster(team_id=team_id, season=season)
    except Exception as error:  # noqa: BLE001
        raise RuntimeError(f"Failed NBA stats request for team {team_id}: {error}")

    payload = endpoint.get_normalized_dict()
    roster_raw = payload.get("CommonTeamRoster", [])

    players: List[RosterPlayer] = []
    errors: List[str] = []

    for item in roster_raw:
        try:
            players.append(RosterPlayer.model_validate(item))
        except ValidationError as exc:
            errors.append(f"Validation failed for team {team_id}: {exc}")

    if errors:
        for message in errors:
            logging.warning(message)

    return players


def upsert_players(
    conn: psycopg.Connection,
    team: TeamMapping,
    roster: List[NormalizedPlayer],
) -> None:
    """Upsert player rows and provider mappings inside a transaction."""
    for player in roster:
        conn.execute(
            UPSERT_PLAYER_SQL,
            (
                player.player_id,
                player.full_name,
                player.first_name,
                player.last_name,
                player.position,
                player.height,
                player.weight,
                player.dob,
                player.active,
            ),
        )

        metadata = {
            "team_id": player.provider_team_id,
            "season": player.season,
            "jersey": player.jersey,
            "source": "nba_api",
        }

        conn.execute(
            UPSERT_PROVIDER_MAP_SQL,
            (
                player.player_id,
                player.player_id,
                json.dumps(
                    {**metadata, "internal_team_id": player.team_internal_id, "raw": player.raw},
                    default=_json_default,
                ),
            ),
        )

        conn.execute(
            UPSERT_PLAYER_ROSTER_SQL,
            (
                player.player_id,
                player.team_internal_id,
                player.season,
                player.active,
                player.jersey,
            ),
        )


def process_team(
    conn: psycopg.Connection,
    team: TeamMapping,
    dry_run: bool = False,
) -> List[NormalizedPlayer]:
    """Fetch, stage, and upsert a single team's roster. Returns normalized players."""
    logging.info(
        "Fetching roster for provider team %s (internal id %s, season %s)%s",
        team.provider_team_id,
        team.internal_team_id,
        TARGET_SEASON,
        " [DRY_RUN]" if dry_run else "",
    )

    roster_players = fetch_roster(team.provider_team_id, TARGET_SEASON)

    if not roster_players:
        logging.warning(
            "No players returned for provider team %s (season %s)",
            team.provider_team_id,
            TARGET_SEASON,
        )
        return []

    normalized = [normalize_player(player, team) for player in roster_players]

    if dry_run:
        logging.info(
            "DRY_RUN: would upsert %s players for provider team %s",
            len(normalized),
            team.provider_team_id,
        )
        return normalized

    stage_roster_payload(
        conn,
        team.provider_team_id,
        TARGET_SEASON,
        (player.raw for player in normalized),
    )

    upsert_players(conn, team, normalized)

    logging.info(
        "Upserted %s players for provider team %s",
        len(normalized),
        team.provider_team_id,
    )
    return normalized


def prune_season_roster(
    conn: psycopg.Connection,
    season: str,
    keep_player_ids: List[str],
    dry_run: bool = False,
) -> int:
    """
    Delete player_team_rosters rows for `season` whose player_id is not in keep set.
    Other seasons are never touched.
    """
    if not keep_player_ids:
        logging.warning("Refusing season prune: keep_player_ids is empty")
        return 0

    count_sql = """
        select count(*)::int
          from player_team_rosters
         where season = %s
           and player_id <> all(%s);
    """
    to_delete = conn.execute(count_sql, (season, keep_player_ids)).fetchone()[0]
    if to_delete == 0:
        logging.info("Season roster prune: 0 stale rows for season %s", season)
        return 0

    if dry_run:
        logging.info(
            "DRY_RUN: would delete %s stale player_team_rosters rows for season %s",
            to_delete,
            season,
        )
        return to_delete

    conn.execute(
        """
        delete from player_team_rosters
         where season = %s
           and player_id <> all(%s);
        """,
        (season, keep_player_ids),
    )
    logging.info(
        "Deleted %s stale player_team_rosters rows for season %s only",
        to_delete,
        season,
    )
    return to_delete


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    logging.info(
        "Starting NBA roster seed (season %s)%s",
        TARGET_SEASON,
        " [DRY_RUN]" if DRY_RUN else "",
    )

    summary = {
        "season": TARGET_SEASON,
        "dry_run": DRY_RUN,
        "teams_attempted": 0,
        "teams_ok": 0,
        "teams_failed": [],
        "players_returned": 0,
        "players_per_team": {},
        "duplicate_nba_player_ids": [],
        "pruned_stale_rows": 0,
        "note": (
            "CommonTeamRoster is a membership SNAPSHOT observation "
            "(player observed on team at fetch time), not exact trade/signing timestamps."
        ),
    }

    seen_ids: dict[str, str] = {}
    all_normalized: List[NormalizedPlayer] = []

    with psycopg.connect(SUPABASE_DB_URL) as conn:
        team_mappings = fetch_team_mappings(conn)
        logging.info("Seeding %s team(s)", len(team_mappings))

        for index, team in enumerate(team_mappings, start=1):
            summary["teams_attempted"] += 1
            logging.info(
                "[%d/%d] Processing provider team %s",
                index,
                len(team_mappings),
                team.provider_team_id,
            )

            try:
                if not DRY_RUN:
                    conn.execute("begin;")
                normalized = process_team(conn, team, dry_run=DRY_RUN)
                if not DRY_RUN:
                    conn.execute("commit;")
                summary["teams_ok"] += 1
                summary["players_returned"] += len(normalized)
                # Prefer team abbreviation from first player payload when present.
                abbr = None
                if normalized:
                    abbr = (normalized[0].raw or {}).get("TEAM_ABBREVIATION")
                key = abbr or team.internal_team_id
                summary["players_per_team"][key] = len(normalized)
                all_normalized.extend(normalized)
                for p in normalized:
                    if p.player_id in seen_ids and seen_ids[p.player_id] != key:
                        summary["duplicate_nba_player_ids"].append(
                            {
                                "player_id": p.player_id,
                                "name": p.full_name,
                                "teams": [seen_ids[p.player_id], key],
                            }
                        )
                    seen_ids[p.player_id] = key
            except Exception as exc:  # noqa: BLE001
                if not DRY_RUN:
                    conn.execute("rollback;")
                summary["teams_failed"].append(
                    {"provider_team_id": team.provider_team_id, "error": str(exc)}
                )
                logging.exception(
                    "Failed processing team %s: %s",
                    team.provider_team_id,
                    exc,
                )
            finally:
                time.sleep(REQUEST_DELAY_SECONDS)

        if PRUNE_SEASON_ROSTER and summary["teams_ok"] == len(team_mappings):
            keep_ids = [p.player_id for p in all_normalized]
            try:
                if not DRY_RUN:
                    conn.execute("begin;")
                pruned = prune_season_roster(
                    conn, TARGET_SEASON, keep_ids, dry_run=DRY_RUN
                )
                if not DRY_RUN:
                    conn.execute("commit;")
                summary["pruned_stale_rows"] = pruned
            except Exception as exc:  # noqa: BLE001
                if not DRY_RUN:
                    conn.execute("rollback;")
                logging.exception("Season roster prune failed: %s", exc)

    # Suspicious sizes: NBA rosters typically ~14-18; flag outside 12-22.
    summary["suspicious_roster_sizes"] = {
        k: v for k, v in summary["players_per_team"].items() if v < 12 or v > 22
    }

    print(json.dumps(summary, indent=2, default=_json_default))
    logging.info("NBA roster seed complete.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        logging.exception("Unhandled exception during roster seed: %s", error)
        sys.exit(1)

