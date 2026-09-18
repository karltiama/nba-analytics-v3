"""
Materialize certified official game snapshots for Phase 5A (data assembly only).

Does NOT apply T−60 selection policy. READ ONLY.

  python scripts/ops/materialize-official-injury-asof-t60-snapshots.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
ROWS_GZ = ROOT / "tmp" / "official-injury-report-archive-dry-parse" / "parsed-rows.ndjson.gz"
BLOCKS_GZ = ROOT / "tmp" / "official-injury-report-game-join" / "game-join-blocks.ndjson.gz"
OUT_DIR = ROOT / "tmp" / "official-injury-report-asof-t60"
OUT_SNAP = OUT_DIR / "game-snapshots.ndjson.gz"
OUT_GAMES = OUT_DIR / "target-games.json"
OUT_META = OUT_DIR / "materialize-meta.json"

QUARANTINE_LOGICAL = {"2026-01-24|GSW@MIN"}
ET = ZoneInfo("America/New_York")
PARSER_SHA = "ce7d729db2fe46b07e0bcfdfc9db506b62af812c0633afb30a2b97646f615ac7"

NAME_TO_ABBR = {
    "atlanta hawks": "ATL",
    "boston celtics": "BOS",
    "brooklyn nets": "BKN",
    "charlotte hornets": "CHA",
    "chicago bulls": "CHI",
    "cleveland cavaliers": "CLE",
    "dallas mavericks": "DAL",
    "denver nuggets": "DEN",
    "detroit pistons": "DET",
    "golden state warriors": "GSW",
    "houston rockets": "HOU",
    "indiana pacers": "IND",
    "la clippers": "LAC",
    "los angeles clippers": "LAC",
    "los angeles lakers": "LAL",
    "memphis grizzlies": "MEM",
    "miami heat": "MIA",
    "milwaukee bucks": "MIL",
    "minnesota timberwolves": "MIN",
    "new orleans pelicans": "NOP",
    "new york knicks": "NYK",
    "oklahoma city thunder": "OKC",
    "orlando magic": "ORL",
    "philadelphia 76ers": "PHI",
    "phoenix suns": "PHX",
    "portland trail blazers": "POR",
    "sacramento kings": "SAC",
    "san antonio spurs": "SAS",
    "toronto raptors": "TOR",
    "utah jazz": "UTA",
    "washington wizards": "WAS",
}


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def normalize_team(name: str | None) -> str | None:
    if not name:
        return None
    raw = name.lower().replace(".", "").replace("  ", " ").strip()
    return NAME_TO_ABBR.get(raw)


def et_calendar_date(dt: datetime) -> str:
    local = dt.astimezone(ET)
    return f"{local.year:04d}-{local.month:02d}-{local.day:02d}"


def load_target_games() -> list[dict[str, Any]]:
    import psycopg

    load_dotenv(ROOT / ".env")
    url = (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or "").strip()
    games: list[dict[str, Any]] = []
    with psycopg.connect(url) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT g.game_id::text, g.season, g.start_time,
                       g.home_team_id::text, g.away_team_id::text,
                       ht.abbreviation, at.abbreviation
                  FROM analytics.games g
                  JOIN analytics.teams ht ON ht.team_id = g.home_team_id
                  JOIN analytics.teams at ON at.team_id = g.away_team_id
                 WHERE g.season IN ('2023','2024','2025')
                   AND g.status = 'Final'
                   AND g.start_time IS NOT NULL
                   AND g.home_team_id IS NOT NULL
                   AND g.away_team_id IS NOT NULL
                   AND g.home_score IS NOT NULL
                   AND g.away_score IS NOT NULL
                """
            )
            for r in cur.fetchall():
                st = r[2]
                if st is not None and st.tzinfo is None:
                    st = st.replace(tzinfo=timezone.utc)
                tip = st.astimezone(timezone.utc)
                cutoff = tip - timedelta(minutes=60)
                games.append(
                    {
                        "game_id": r[0],
                        "season": r[1],
                        "start_time": tip.isoformat().replace("+00:00", "Z"),
                        "cutoff_at": cutoff.isoformat().replace("+00:00", "Z"),
                        "home_team_id": r[3],
                        "away_team_id": r[4],
                        "home_abbr": r[5],
                        "away_abbr": r[6],
                        "et_game_date": et_calendar_date(tip),
                    }
                )
        conn.execute("COMMIT")
    return games


def load_certified_block_index() -> dict[str, list[dict[str, Any]]]:
    """game_id -> list of certified block headers (EXACT_UNIQUE only)."""
    by_game: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with gzip.open(BLOCKS_GZ, "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            rec = json.loads(line)
            if not rec.get("target_scope"):
                continue
            gr = rec.get("game_resolution") or {}
            if gr.get("status") != "EXACT_UNIQUE" or gr.get("provenance") != "PAIR_ET_DATE_UNIQUE":
                continue
            logical = rec["logical_source_game"]
            if logical in QUARANTINE_LOGICAL:
                continue
            gid = str(gr["game_id"])
            tr = rec["team_resolution"]
            off = rec["official"]
            by_game[gid].append(
                {
                    "source_game_block_id": rec["source_game_block_id"],
                    "s3_key": rec["source"]["s3_key"],
                    "source_sha256": rec["source"].get("source_sha256"),
                    "report_published_at": rec["source"]["report_published_at"],
                    "game_date": off["game_date"],
                    "matchup": off["matchup"],
                    "away_abbr": off["away_abbreviation"],
                    "home_abbr": off["home_abbreviation"],
                    "away_team_id": str(tr["away_team_id"]),
                    "home_team_id": str(tr["home_team_id"]),
                }
            )
    return by_game


def semantic_hash(payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Loading target games...", flush=True)
    games = load_target_games()
    by_season = defaultdict(int)
    for g in games:
        by_season[g["season"]] += 1
    print(f"target_games={len(games)} by_season={dict(by_season)}", flush=True)
    if len(games) != 3962:
        raise SystemExit(f"Finals cohort drift: {len(games)} != 3962")

    game_by_id = {g["game_id"]: g for g in games}
    OUT_GAMES.write_text(json.dumps({"games": games, "count": len(games)}, indent=2) + "\n", encoding="utf-8")

    print("Indexing certified blocks...", flush=True)
    blocks_by_game = load_certified_block_index()
    # Map (s3_key, game_date, matchup) -> block meta
    block_key_index: dict[tuple[str, str, str], dict[str, Any]] = {}
    for gid, blist in blocks_by_game.items():
        for b in blist:
            key = (b["s3_key"], b["game_date"], b["matchup"])
            block_key_index[key] = {**b, "game_id": gid}

    print(f"certified_block_keys={len(block_key_index)} games_with_blocks={len(blocks_by_game)}", flush=True)

    # Accumulate rows into snapshot buckets keyed by block key
    # snapshot_id = s3_key|game_date|matchup|report_published_at
    buckets: dict[tuple[str, str, str, str], dict[str, Any]] = {}

    print("Streaming parsed rows...", flush=True)
    n_rows = 0
    n_attached = 0
    with gzip.open(ROWS_GZ, "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            row = json.loads(line)
            n_rows += 1
            key = (row.get("s3_key"), row.get("game_date"), row.get("matchup"))
            meta = block_key_index.get(key)  # type: ignore[arg-type]
            if not meta:
                continue
            pub = row.get("report_published_at")
            if not pub:
                continue
            bkey = (meta["s3_key"], meta["game_date"], meta["matchup"], pub)
            snap = buckets.get(bkey)
            if snap is None:
                snap = {
                    "game_id": meta["game_id"],
                    "source_game_block_id": meta["source_game_block_id"],
                    "s3_key": meta["s3_key"],
                    "source_sha256": meta.get("source_sha256"),
                    "report_published_at": pub,
                    "game_date": meta["game_date"],
                    "matchup": meta["matchup"],
                    "away_abbr": meta["away_abbr"],
                    "home_abbr": meta["home_abbr"],
                    "away_team_id": meta["away_team_id"],
                    "home_team_id": meta["home_team_id"],
                    "teams": {
                        meta["away_team_id"]: {
                            "team_id": meta["away_team_id"],
                            "abbr": meta["away_abbr"],
                            "side": "away",
                            "nys": False,
                            "players": [],
                        },
                        meta["home_team_id"]: {
                            "team_id": meta["home_team_id"],
                            "abbr": meta["home_abbr"],
                            "side": "home",
                            "nys": False,
                            "players": [],
                        },
                    },
                }
                buckets[bkey] = snap
            abbr = normalize_team(row.get("team_name"))
            team_id = None
            if abbr == meta["away_abbr"]:
                team_id = meta["away_team_id"]
            elif abbr == meta["home_abbr"]:
                team_id = meta["home_team_id"]
            if team_id is None:
                continue
            t = snap["teams"][team_id]
            kind = row.get("row_kind")
            if kind == "team_not_yet_submitted":
                t["nys"] = True
                n_attached += 1
                continue
            if kind == "player":
                t["players"].append(
                    {
                        "player_name_raw": row.get("player_name_raw"),
                        "status_raw": row.get("status_raw"),
                        "reason_raw": row.get("reason_raw"),
                        "page_number": row.get("page_number"),
                        "visual_row_index": row.get("visual_row_index"),
                    }
                )
                n_attached += 1

    print(f"rows={n_rows} attached={n_attached} snapshots={len(buckets)}", flush=True)

    # Group snapshots by game_id; compute semantic hash
    by_game_snaps: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for snap in buckets.values():
        # Detect structural conflict per team
        for tid, t in snap["teams"].items():
            if t["nys"] and t["players"]:
                t["structural_conflict"] = True
            else:
                t["structural_conflict"] = False
            if t["nys"]:
                t["state_hint"] = "NOT_YET_SUBMITTED"
            elif t["players"]:
                t["state_hint"] = "SUBMITTED_WITH_PLAYER_ROWS"
            else:
                t["state_hint"] = "TEAM_BLOCK_MISSING"
        # Sort players for stable hash
        for t in snap["teams"].values():
            t["players"].sort(
                key=lambda p: (
                    p.get("player_name_raw") or "",
                    p.get("status_raw") or "",
                    p.get("reason_raw") or "",
                    p.get("page_number") or 0,
                    p.get("visual_row_index") or 0,
                )
            )
        content = {
            "report_published_at": snap["report_published_at"],
            "game_date": snap["game_date"],
            "matchup": snap["matchup"],
            "teams": {
                tid: {
                    "abbr": t["abbr"],
                    "nys": t["nys"],
                    "structural_conflict": t["structural_conflict"],
                    "players": t["players"],
                }
                for tid, t in sorted(snap["teams"].items())
            },
        }
        snap["semantic_hash"] = semantic_hash(content)
        by_game_snaps[snap["game_id"]].append(snap)

    # Write one line per game with all snapshots
    written = 0
    with gzip.open(OUT_SNAP, "wt", encoding="utf-8") as out:
        for g in games:
            gid = g["game_id"]
            snaps = by_game_snaps.get(gid, [])
            snaps.sort(key=lambda s: (s["report_published_at"], s["source_game_block_id"]))
            rec = {
                "game_id": gid,
                "season": g["season"],
                "start_time": g["start_time"],
                "cutoff_at": g["cutoff_at"],
                "et_game_date": g["et_game_date"],
                "away_team_id": g["away_team_id"],
                "home_team_id": g["home_team_id"],
                "away_abbr": g["away_abbr"],
                "home_abbr": g["home_abbr"],
                "snapshot_count": len(snaps),
                "has_certified_blocks": gid in blocks_by_game,
                "source_content_absent": gid not in blocks_by_game,
                "snapshots": snaps,
            }
            out.write(json.dumps(rec, separators=(",", ":")) + "\n")
            written += 1

    meta = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "target_games": len(games),
        "by_season": dict(by_season),
        "games_with_snapshots": sum(1 for g in games if g["game_id"] in by_game_snaps),
        "games_without_snapshots": sum(1 for g in games if g["game_id"] not in by_game_snaps),
        "total_snapshots": len(buckets),
        "fingerprints": {
            "parser.py": PARSER_SHA,
            "parsed_rows_gz": sha256_file(ROWS_GZ),
            "blocks_gz": sha256_file(BLOCKS_GZ),
            "game_snapshots_gz": sha256_file(OUT_SNAP),
        },
        "quarantine_logical_excluded": sorted(QUARANTINE_LOGICAL),
        "note": "Data assembly only; no T-60 selection applied.",
    }
    OUT_META.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: meta[k] for k in ("target_games", "games_with_snapshots", "games_without_snapshots", "total_snapshots")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
