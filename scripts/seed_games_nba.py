import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

import psycopg
from dotenv import load_dotenv
from nba_api.stats.endpoints import boxscoretraditionalv2, scoreboardv2
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from psycopg.types.json import Json

load_dotenv()

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    logging.error("Missing SUPABASE_DB_URL. Set it in your environment or .env file.")
    sys.exit(1)

TARGET_SEASON = os.getenv("NBA_STATS_SEASON", "2025-26")
START_DATE = os.getenv("NBA_STATS_START_DATE")
END_DATE = os.getenv("NBA_STATS_END_DATE")

if not START_DATE or not END_DATE:
    logging.error("NBA_STATS_START_DATE and NBA_STATS_END_DATE must be set (YYYY-MM-DD).")
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


class BoxScorePlayer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    game_id: str = Field(alias="GAME_ID")
    team_id: int = Field(alias="TEAM_ID")
    player_id: int = Field(alias="PLAYER_ID")
    player_name: str = Field(alias="PLAYER_NAME")
    start_position: Optional[str] = Field(alias="START_POSITION", default=None)
    comment: Optional[str] = Field(alias="COMMENT", default=None)
    minutes: Optional[str] = Field(alias="MIN", default=None)
    fgm: Optional[float] = Field(alias="FGM", default=None)
    fga: Optional[float] = Field(alias="FGA", default=None)
    tpm: Optional[float] = Field(alias="FG3M", default=None)
    tpa: Optional[float] = Field(alias="FG3A", default=None)
    ftm: Optional[float] = Field(alias="FTM", default=None)
    fta: Optional[float] = Field(alias="FTA", default=None)
    oreb: Optional[float] = Field(alias="OREB", default=None)
    dreb: Optional[float] = Field(alias="DREB", default=None)
    reb: Optional[float] = Field(alias="REB", default=None)
    ast: Optional[float] = Field(alias="AST", default=None)
    stl: Optional[float] = Field(alias="STL", default=None)
    blk: Optional[float] = Field(alias="BLK", default=None)
    to: Optional[float] = Field(alias="TOV", default=None)
    pts: Optional[float] = Field(alias="PTS", default=None)
    plus_minus: Optional[float] = Field(alias="PLUS_MINUS", default=None)


class NormalizedGame(BaseModel):
    game_id: str
    season: str
    start_time_utc: datetime
    status_text: str
    status_id: int
    home_team_internal_id: str
    away_team_internal_id: str
    home_team_provider_id: str
    away_team_provider_id: str
    home_score: Optional[int]
    away_score: Optional[int]
    arena: Optional[str]


class NormalizedPlayerStat(BaseModel):
    game_id: str
    player_id: str
    team_internal_id: str
    minutes: Optional[float]
    points: Optional[int]
    rebounds: Optional[int]
    assists: Optional[int]
    steals: Optional[int]
    blocks: Optional[int]
    turnovers: Optional[int]
    fgm: Optional[int]
    fga: Optional[int]
    tpm: Optional[int]
    tpa: Optional[int]
    ftm: Optional[int]
    fta: Optional[int]
    plus_minus: Optional[int]
    started: Optional[bool]
    dnp_reason: Optional[str]


UPSERT_GAME_SQL = """
    insert into games (
        game_id, season, start_time, status, home_team_id, away_team_id,
        home_score, away_score, venue, created_at, updated_at
    ) values (
        %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), now()
    )
    on conflict (game_id) do update set
        season = excluded.season,
        start_time = excluded.start_time,
        -- Only update status if existing is NULL/invalid, or new is more complete (Final > Scheduled)
        status = CASE 
            WHEN games.status IS NULL OR games.status NOT IN ('Final', 'Scheduled', 'InProgress', 'Postponed', 'Cancelled')
                THEN excluded.status
            WHEN games.status = 'Scheduled' AND excluded.status = 'Final'
                THEN excluded.status
            WHEN games.status = 'InProgress' AND excluded.status = 'Final'
                THEN excluded.status
            ELSE games.status
        END,
        home_team_id = excluded.home_team_id,
        away_team_id = excluded.away_team_id,
        -- Only update scores if existing is NULL, or new is NOT NULL (don't overwrite with NULL)
        home_score = CASE 
            WHEN games.home_score IS NULL THEN excluded.home_score
            WHEN excluded.home_score IS NOT NULL THEN excluded.home_score
            ELSE games.home_score
        END,
        away_score = CASE 
            WHEN games.away_score IS NULL THEN excluded.away_score
            WHEN excluded.away_score IS NOT NULL THEN excluded.away_score
            ELSE games.away_score
        END,
        venue = excluded.venue,
        updated_at = now();
"""

UPSERT_BOX_SCORE_SQL = """
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
        updated_at = now();
"""

UPSERT_PLAYER_SQL = """
    insert into players (
        player_id, full_name, first_name, last_name, created_at, updated_at
    ) values (%s, %s, %s, %s, now(), now())
    on conflict (player_id) do nothing;
"""

UPSERT_PLAYER_PROVIDER_SQL = """
    insert into provider_id_map (
        entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
    ) values ('player', %s, 'nba', %s, %s::jsonb, now(), now(), now())
    on conflict (entity_type, provider, provider_id) do update set
        internal_id = excluded.internal_id,
        metadata = excluded.metadata,
        fetched_at = excluded.fetched_at,
        updated_at = now();
"""


def daterange(start: datetime, end: datetime) -> Iterable[datetime]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def parse_minutes_to_decimal(value: Optional[str]) -> Optional[float]:
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
    if value is None:
        return None
    return int(value)


def resolve_team_mapping(conn: psycopg.Connection) -> Dict[str, str]:
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
    row = conn.execute(
        """
        select internal_id
          from provider_id_map
         where entity_type = 'player'
           and provider = 'nba'
           and provider_id = %s
         limit 1;
        """,
        (provider_player_id,),
    ).fetchone()
    if row:
        return row[0]

    parts = player_name.split()
    first_name = parts[0] if parts else None
    last_name = parts[-1] if len(parts) > 1 else None

    conn.execute(
        UPSERT_PLAYER_SQL,
        (
            provider_player_id,
            player_name,
            first_name,
            last_name,
        ),
    )

    metadata = {"source": "nba_api", "seeded_from_boxscore": True}
    conn.execute(
        UPSERT_PLAYER_PROVIDER_SQL,
        (
            provider_player_id,
            provider_player_id,
            Json(metadata),
        ),
    )

    return provider_player_id


def normalize_game(raw: ScoreboardGameHeader, team_map: Dict[str, str]) -> NormalizedGame:
    home_provider_id = str(raw.home_team_id)
    away_provider_id = str(raw.visitor_team_id)

    home_internal_id = team_map.get(home_provider_id)
    away_internal_id = team_map.get(away_provider_id)

    if not home_internal_id or not away_internal_id:
        raise RuntimeError(
            f"Missing team mapping for game {raw.game_id}: "
            f"home={home_provider_id}, away={away_provider_id}"
        )

    start_time_utc = parse_start_time(raw.game_date_est, raw.game_status_text)

    return NormalizedGame(
        game_id=raw.game_id,
        season=TARGET_SEASON,
        start_time_utc=start_time_utc,
        status_text=raw.game_status_text,
        status_id=raw.game_status_id,
        home_team_internal_id=home_internal_id,
        away_team_internal_id=away_internal_id,
        home_team_provider_id=home_provider_id,
        away_team_provider_id=away_provider_id,
        home_score=None,
        away_score=None,
        arena=raw.arena_name,
    )


def fetch_games_for_date(game_date: datetime) -> List[ScoreboardGameHeader]:
    endpoint = scoreboardv2.ScoreboardV2(game_date=game_date.strftime("%m/%d/%Y"))
    headers = endpoint.get_normalized_dict().get("GameHeader", [])

    parsed: List[ScoreboardGameHeader] = []
    for raw in headers:
        try:
            parsed.append(ScoreboardGameHeader.model_validate(raw))
        except ValidationError as exc:
            logging.warning("Failed to parse scoreboard game for %s: %s", game_date.date(), exc)
    return parsed


def parse_start_time(game_date_est: str, status_text: str) -> datetime:
    try:
        base = datetime.fromisoformat(game_date_est)
    except ValueError:
        base = datetime.strptime(game_date_est[:10], "%Y-%m-%d")

    if base.tzinfo is None:
        base = base.replace(tzinfo=EASTERN_TZ)
    else:
        base = base.astimezone(EASTERN_TZ)

    match = re.search(r"(\d{1,2}:\d{2})\s*([ap]m)", status_text.lower())
    if match:
        time_str = f"{match.group(1)} {match.group(2)}"
        try:
            start_local = datetime.strptime(
                f"{base.date()} {time_str}",
                "%Y-%m-%d %I:%M %p",
            ).replace(tzinfo=EASTERN_TZ)
            return start_local.astimezone(ZoneInfo("UTC"))
        except ValueError:
            pass

    return base.astimezone(ZoneInfo("UTC"))


def fetch_boxscore(game_id: str) -> List[BoxScorePlayer]:
    endpoint = boxscoretraditionalv2.BoxScoreTraditionalV2(game_id=game_id)
    player_stats = endpoint.get_normalized_dict().get("PlayerStats", [])
    parsed: List[BoxScorePlayer] = []
    for raw in player_stats:
        try:
            parsed.append(BoxScorePlayer.model_validate(raw))
        except ValidationError as exc:
            logging.warning("Failed to parse boxscore row for %s: %s", game_id, exc)
    return parsed


def normalize_player_stat(
    stat: BoxScorePlayer,
    team_map: Dict[str, str],
    conn: psycopg.Connection,
) -> Optional[NormalizedPlayerStat]:
    team_provider_id = str(stat.team_id)
    if team_provider_id not in team_map:
        logging.warning("Missing team mapping for TEAM_ID=%s", team_provider_id)
        return None

    player_internal_id = resolve_player_internal_id(conn, str(stat.player_id), stat.player_name)
    minutes_decimal = parse_minutes_to_decimal(stat.minutes)
    dnp_reason = stat.comment if (minutes_decimal is None and stat.comment) else None
    started = bool(stat.start_position)

    return NormalizedPlayerStat(
        game_id=stat.game_id,
        player_id=player_internal_id,
        team_internal_id=team_map[team_provider_id],
        minutes=minutes_decimal,
        points=to_int(stat.pts),
        rebounds=to_int(stat.reb),
        assists=to_int(stat.ast),
        steals=to_int(stat.stl),
        blocks=to_int(stat.blk),
        turnovers=to_int(stat.to),
        fgm=to_int(stat.fgm),
        fga=to_int(stat.fga),
        tpm=to_int(stat.tpm),
        tpa=to_int(stat.tpa),
        ftm=to_int(stat.ftm),
        fta=to_int(stat.fta),
        plus_minus=to_int(stat.plus_minus),
        started=started,
        dnp_reason=dnp_reason,
    )


def upsert_game(conn: psycopg.Connection, game: NormalizedGame) -> None:
    conn.execute(
        UPSERT_GAME_SQL,
        (
            game.game_id,
            game.season,
            game.start_time_utc,
            game.status_text,
            game.home_team_internal_id,
            game.away_team_internal_id,
            game.home_score,
            game.away_score,
            game.arena,
        ),
    )


def upsert_boxscore_batch(
    conn: psycopg.Connection,
    stats: Iterable[NormalizedPlayerStat],
    game: NormalizedGame,
) -> None:
    points_by_team: Dict[str, int] = {}

    for stat in stats:
        conn.execute(
            UPSERT_BOX_SCORE_SQL,
            (
                stat.game_id,
                stat.player_id,
                stat.team_internal_id,
                stat.minutes,
                stat.points,
                stat.rebounds,
                stat.assists,
                stat.steals,
                stat.blocks,
                stat.turnovers,
                stat.fgm,
                stat.fga,
                stat.tpm,
                stat.tpa,
                stat.ftm,
                stat.fta,
                stat.plus_minus,
                stat.started,
                stat.dnp_reason,
            ),
        )

        if stat.points is not None:
            points_by_team[stat.team_internal_id] = (
                points_by_team.get(stat.team_internal_id, 0) + stat.points
            )

    home_points = points_by_team.get(game.home_team_internal_id)
    away_points = points_by_team.get(game.away_team_internal_id)

    if home_points is not None or away_points is not None:
        conn.execute(
            """
            update games
               set home_score = coalesce(%s, home_score),
                   away_score = coalesce(%s, away_score),
                   status = %s,
                   updated_at = now()
             where game_id = %s;
            """,
            (
                home_points,
                away_points,
                game.status_text,
                game.game_id,
            ),
        )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    start_dt = datetime.fromisoformat(f"{START_DATE}T00:00:00").replace(tzinfo=EASTERN_TZ)
    end_dt = datetime.fromisoformat(f"{END_DATE}T00:00:00").replace(tzinfo=EASTERN_TZ)

    if start_dt > end_dt:
        logging.error("NBA_STATS_START_DATE must be before NBA_STATS_END_DATE.")
        sys.exit(1)

    logging.info(
        "Seeding games and box scores from %s through %s (season %s)",
        start_dt.date(),
        end_dt.date(),
        TARGET_SEASON,
    )

    with psycopg.connect(SUPABASE_DB_URL) as conn:
        team_map = resolve_team_mapping(conn)

        current_index = 0
        for day in daterange(start_dt, end_dt):
            current_index += 1
            logging.info("Processing %s", day.date())

            games_raw = fetch_games_for_date(day)
            if not games_raw:
                continue

            for raw_game in games_raw:
                normalized_game = normalize_game(raw_game, team_map)

                try:
                    conn.execute("begin;")
                    upsert_game(conn, normalized_game)

                    if normalized_game.status_id >= 2:
                        player_stats_raw = fetch_boxscore(normalized_game.game_id)
                        normalized_stats: List[NormalizedPlayerStat] = []
                        for stat in player_stats_raw:
                            normalized = normalize_player_stat(stat, team_map, conn)
                            if normalized:
                                normalized_stats.append(normalized)

                        upsert_boxscore_batch(conn, normalized_stats, normalized_game)

                    conn.execute("commit;")
                except Exception as exc:  # noqa: BLE001
                    conn.execute("rollback;")
                    logging.exception(
                        "Failed to upsert game %s on %s: %s",
                        normalized_game.game_id,
                        day.date(),
                        exc,
                    )

                time.sleep(REQUEST_DELAY_SECONDS)

    logging.info("Game backfill complete.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        logging.exception("Unhandled exception during game seed: %s", error)
        sys.exit(1)

