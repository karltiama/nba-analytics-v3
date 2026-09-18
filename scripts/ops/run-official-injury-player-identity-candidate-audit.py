"""
Phase 4B — Official injury-report PLAYER IDENTITY CANDIDATE COVERAGE AUDIT (read-only).

Does NOT implement a resolver. Does NOT write identity mappings / provider IDs.
Does NOT change parser, join policy, corpus, or schema.

  python scripts/ops/run-official-injury-player-identity-candidate-audit.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import statistics
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
CERTIFIED_PARSER_SHA = "ce7d729db2fe46b07e0bcfdfc9db506b62af812c0633afb30a2b97646f615ac7"
PARSER_PATH = ROOT / "lib" / "providers" / "nba_official_injuries" / "parser.py"
ROWS_GZ = ROOT / "tmp" / "official-injury-report-archive-dry-parse" / "parsed-rows.ndjson.gz"
BLOCKS_GZ = ROOT / "tmp" / "official-injury-report-game-join" / "game-join-blocks.ndjson.gz"
PHASE4A_JSON = ROOT / "reports" / "operations" / "official-injury-report-game-join-certification.json"
PHASE4A1_JSON = ROOT / "reports" / "operations" / "official-injury-report-game-join-anomaly-review.json"
DRY_PARSE_JSON = ROOT / "reports" / "operations" / "official-injury-report-archive-dry-parse.json"

OUT_MD = ROOT / "reports" / "operations" / "official-injury-report-player-identity-candidate-audit.md"
OUT_JSON = ROOT / "reports" / "operations" / "official-injury-report-player-identity-candidate-audit.json"
OUT_ANOM = ROOT / "reports" / "operations" / "official-injury-report-player-identity-candidate-anomalies.ndjson"
TMP_DIR = ROOT / "tmp" / "official-injury-report-player-identity-candidate-audit"
TMP_RECORDS_GZ = TMP_DIR / "official-player-game-candidates.ndjson.gz"

QUARANTINE_LOGICAL = {"2026-01-24|GSW@MIN"}

ABBR_ALIASES = {
    "BRK": "BKN",
    "CHO": "CHA",
    "CHH": "CHA",
    "PHO": "PHX",
    "GS": "GSW",
    "NO": "NOP",
    "NY": "NYK",
    "SA": "SAS",
    "UTAH": "UTA",
    "WSH": "WAS",
}

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

SUFFIX_RE = re.compile(r"\b(?:jr\.?|sr\.?|ii|iii|iv|v)\b", re.I)
STATUS_MAP = {
    "out": "Out",
    "available": "Available",
    "questionable": "Questionable",
    "doubtful": "Doubtful",
    "probable": "Probable",
}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def normalize_team_name(name: str | None) -> str | None:
    if not name:
        return None
    raw = name.lower().replace(".", "").replace("  ", " ").strip()
    if raw in NAME_TO_ABBR:
        return NAME_TO_ABBR[raw]
    up = name.strip().upper()
    if up in ABBR_ALIASES:
        return ABBR_ALIASES[up]
    if up in NAME_TO_ABBR.values():
        return up
    return None


def reorder_last_comma_first(raw: str) -> str:
    s = (raw or "").strip()
    if "," in s:
        last, first = s.split(",", 1)
        return f"{first.strip()} {last.strip()}".strip()
    return s


def fold_unicode(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def safe_key(raw: str | None) -> str:
    """Suffix-preserving diagnostic comparison key (not identity authority)."""
    s = reorder_last_comma_first(raw or "")
    s = fold_unicode(s).lower().strip()
    s = s.replace("'", "").replace("'", "").replace("`", "")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def legacy_suffix_stripped_key(raw: str | None) -> str:
    """Behavior equivalent to lib/roster/normalize-player-name.ts normalizePersonName."""
    s = reorder_last_comma_first(raw or "")
    s = fold_unicode(s).lower().strip()
    s = SUFFIX_RE.sub(" ", s)
    s = re.sub(r"[''']", "", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    prev = ""
    while s != prev:
        prev = s
        s = re.sub(r"\b([a-z])\s+(?=[a-z]\b)", r"\1", s)
    return s


def parse_iso_date(s: str) -> date:
    y, m, d = map(int, s.split("-"))
    return date(y, m, d)


def age_bucket(days: int | None) -> str:
    if days is None:
        return "none"
    if days == 0:
        return "0_days"
    if days == 1:
        return "1_day"
    if days <= 3:
        return "2_3_days"
    if days <= 7:
        return "4_7_days"
    if days <= 14:
        return "8_14_days"
    if days <= 30:
        return "15_30_days"
    return "gt_30_days"


def name_shape_flags(raw: str) -> dict[str, bool]:
    s = raw or ""
    low = s.lower()
    return {
        "has_jr": bool(re.search(r"\bjr\.?\b", low)),
        "has_sr": bool(re.search(r"\bsr\.?\b", low)),
        "has_ii": bool(re.search(r"\bii\b", low)),
        "has_iii": bool(re.search(r"\biii\b", low)),
        "has_iv": bool(re.search(r"\biv\b", low)),
        "has_apostrophe": ("'" in s) or ("'" in s) or ("'" in s),
        "has_hyphen": "-" in s,
        "has_period": "." in s,
        "has_multipart_last": ("," in s and (" " in s.split(",", 1)[0].strip())),
    }


def load_certified_games() -> dict[str, dict[str, Any]]:
    """Map logical_source_game -> certified join context. EXACT_UNIQUE + PAIR_ET_DATE_UNIQUE only."""
    out: dict[str, dict[str, Any]] = {}
    with gzip.open(BLOCKS_GZ, "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            rec = json.loads(line)
            if not rec.get("target_scope"):
                continue
            gr = rec.get("game_resolution") or {}
            if gr.get("status") != "EXACT_UNIQUE":
                continue
            if gr.get("provenance") != "PAIR_ET_DATE_UNIQUE":
                continue
            logical = rec["logical_source_game"]
            if logical in QUARANTINE_LOGICAL:
                continue
            if logical in out:
                continue
            tr = rec["team_resolution"]
            off = rec["official"]
            out[logical] = {
                "logical_source_game": logical,
                "game_id": str(gr["game_id"]),
                "game_date": off["game_date"],
                "matchup": off["matchup"],
                "away_abbr": off["away_abbreviation"],
                "home_abbr": off["home_abbreviation"],
                "away_team_id": str(tr["away_team_id"]),
                "home_team_id": str(tr["home_team_id"]),
                "source_season": rec.get("source_season"),
            }
    return out


def build_official_player_games(
    certified: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Stream Phase 3D player rows; retain certified joins only; aggregate official_player_game."""
    opg: dict[tuple[str, str, str], dict[str, Any]] = {}
    stats = {
        "player_observations_total_corpus": 0,
        "player_observations_certified": 0,
        "player_observations_excluded_quarantine_or_non_certified": 0,
        "team_unresolved_observations": 0,
        "nys_skipped": 0,
    }
    team_unresolved_sample: list[dict[str, Any]] = []

    with gzip.open(ROWS_GZ, "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("row_kind") != "player":
                if row.get("row_kind") == "nys" or (row.get("status_raw") or "").upper() == "NYS":
                    stats["nys_skipped"] += 1
                continue
            stats["player_observations_total_corpus"] += 1
            logical = f"{row.get('game_date')}|{row.get('matchup')}"
            game = certified.get(logical)
            if not game:
                stats["player_observations_excluded_quarantine_or_non_certified"] += 1
                continue
            abbr = normalize_team_name(row.get("team_name"))
            if abbr == game["away_abbr"]:
                team_id = game["away_team_id"]
                team_side = "away"
            elif abbr == game["home_abbr"]:
                team_id = game["home_team_id"]
                team_side = "home"
            else:
                stats["team_unresolved_observations"] += 1
                if len(team_unresolved_sample) < 50:
                    team_unresolved_sample.append(
                        {
                            "team_name": row.get("team_name"),
                            "logical": logical,
                            "game_id": game["game_id"],
                            "player_name_raw": row.get("player_name_raw"),
                        }
                    )
                continue

            stats["player_observations_certified"] += 1
            pname = row.get("player_name_raw") or ""
            key = (game["game_id"], team_id, pname)
            status_raw = (row.get("status_raw") or "").strip()
            status_norm = STATUS_MAP.get(status_raw.lower(), status_raw)
            pub = row.get("report_published_at")
            meta = opg.get(key)
            if meta is None:
                meta = {
                    "game_id": game["game_id"],
                    "season": game.get("source_season") or season_for_game_date(game["game_date"]),
                    "et_game_date": game["game_date"],
                    "team_id": team_id,
                    "team_abbreviation": abbr,
                    "team_side": team_side,
                    "matchup": game["matchup"],
                    "player_name_raw": pname,
                    "safe_key": safe_key(pname),
                    "legacy_key": legacy_suffix_stripped_key(pname),
                    "observation_count": 0,
                    "statuses": set(),
                    "first_report_published_at": pub,
                    "last_report_published_at": pub,
                    "name_shape": name_shape_flags(pname),
                }
                opg[key] = meta
            meta["observation_count"] += 1
            if status_norm:
                meta["statuses"].add(status_norm)
            if pub:
                if not meta["first_report_published_at"] or pub < meta["first_report_published_at"]:
                    meta["first_report_published_at"] = pub
                if not meta["last_report_published_at"] or pub > meta["last_report_published_at"]:
                    meta["last_report_published_at"] = pub

    rows: list[dict[str, Any]] = []
    for meta in opg.values():
        statuses = sorted(meta["statuses"])
        rows.append(
            {
                **{k: v for k, v in meta.items() if k != "statuses"},
                "statuses_observed": statuses,
                "ever_out": "Out" in meta["statuses"],
                "ever_available": "Available" in meta["statuses"],
                "ever_questionable": "Questionable" in meta["statuses"],
                "ever_doubtful": "Doubtful" in meta["statuses"],
                "ever_probable": "Probable" in meta["statuses"],
            }
        )
    stats["team_unresolved_sample"] = team_unresolved_sample
    stats["unique_official_player_games"] = len(rows)
    stats["unique_raw_player_names"] = len({r["player_name_raw"] for r in rows})
    stats["target_games_represented"] = len({r["game_id"] for r in rows})
    return rows, stats


def season_for_game_date(iso_date: str) -> str:
    y, m, _ = map(int, iso_date.split("-"))
    return str(y - 1 if m < 7 else y)


def load_db(game_ids: set[str]) -> dict[str, Any]:
    import psycopg

    load_dotenv(ROOT / ".env")
    url = (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or "").strip()
    if not url:
        raise SystemExit("SUPABASE_DB_URL or DATABASE_URL required")

    out: dict[str, Any] = {
        "snapshots": [],
        "stints": [],
        "pgl": [],
        "nba_bridges": {},  # nba_id -> list entity_ids
        "entity_to_bdl": {},  # entity_id -> list player_ids
        "entities": [],
        "players": [],
        "teams": {},
    }
    with psycopg.connect(url) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT team_id::text, abbreviation FROM analytics.teams
                """
            )
            for tid, abbr in cur.fetchall():
                out["teams"][tid] = abbr

            cur.execute(
                """
                SELECT snapshot_date, analytics_season, nba_team_id, nba_player_id,
                       player_name, team_abbreviation, analytics_team_id
                  FROM raw.nba_roster_snapshots
                """
            )
            for r in cur.fetchall():
                out["snapshots"].append(
                    {
                        "snapshot_date": r[0].isoformat() if r[0] else None,
                        "analytics_season": r[1],
                        "nba_team_id": str(r[2]) if r[2] is not None else None,
                        "nba_player_id": str(r[3]) if r[3] is not None else None,
                        "player_name": r[4],
                        "team_abbreviation": r[5],
                        "analytics_team_id": str(r[6]) if r[6] is not None else None,
                        "safe_key": safe_key(r[4] or ""),
                    }
                )

            cur.execute(
                """
                SELECT s.stint_id, s.season, s.player_id::text, s.player_entity_id::text,
                       s.team_id::text, s.observed_from, s.observed_to, s.source,
                       s.source_player_id,
                       e.display_name, e.first_name, e.last_name,
                       p.first_name, p.last_name, p.full_name
                  FROM analytics.player_team_stints s
                  LEFT JOIN analytics.player_entities e ON e.player_entity_id = s.player_entity_id
                  LEFT JOIN analytics.players p ON p.player_id = s.player_id
                 WHERE s.season IN ('2023','2024','2025','2026')
                """
            )
            for r in cur.fetchall():
                disp = r[9] or r[14] or " ".join(x for x in [r[12], r[13]] if x) or " ".join(
                    x for x in [r[10], r[11]] if x
                )
                out["stints"].append(
                    {
                        "stint_id": r[0],
                        "season": r[1],
                        "player_id": r[2],
                        "player_entity_id": r[3],
                        "team_id": r[4],
                        "observed_from": r[5].isoformat() if r[5] else None,
                        "observed_to": r[6].isoformat() if r[6] else None,
                        "source": r[7],
                        "source_player_id": str(r[8]) if r[8] is not None else None,
                        "display_name": disp,
                        "safe_key": safe_key(disp or ""),
                    }
                )

            # PGL for certified games only
            gids = sorted(game_ids)
            # chunk IN lists
            for i in range(0, len(gids), 500):
                chunk = gids[i : i + 500]
                cur.execute(
                    """
                    SELECT pgl.game_id::text, pgl.player_id::text, pgl.team_id::text, pgl.minutes,
                           p.first_name, p.last_name, p.full_name, p.player_entity_id::text
                      FROM analytics.player_game_logs pgl
                      JOIN analytics.players p ON p.player_id = pgl.player_id
                     WHERE pgl.game_id = ANY(%s)
                    """,
                    (chunk,),
                )
                for r in cur.fetchall():
                    full = r[6] or " ".join(x for x in [r[4], r[5]] if x)
                    mins = r[3]
                    out["pgl"].append(
                        {
                            "game_id": r[0],
                            "player_id": r[1],
                            "team_id": r[2],
                            "minutes": mins,
                            "display_name": full,
                            "player_entity_id": r[7],
                            "safe_key": safe_key(full or ""),
                            "is_00": str(mins).strip() in {"00", "0", "0:00", "00:00"},
                        }
                    )

            cur.execute(
                """
                SELECT provider_player_id::text, player_entity_id::text
                  FROM analytics.player_provider_ids
                 WHERE provider = 'nba'
                """
            )
            for pid, eid in cur.fetchall():
                out["nba_bridges"].setdefault(str(pid), []).append(eid)

            cur.execute(
                """
                SELECT player_entity_id::text, player_id::text
                  FROM analytics.players
                 WHERE player_entity_id IS NOT NULL
                """
            )
            for eid, pid in cur.fetchall():
                out["entity_to_bdl"].setdefault(eid, []).append(pid)

            cur.execute(
                """
                SELECT player_entity_id::text, display_name, first_name, last_name
                  FROM analytics.player_entities
                """
            )
            for r in cur.fetchall():
                disp = r[1] or " ".join(x for x in [r[2], r[3]] if x)
                out["entities"].append(
                    {"player_entity_id": r[0], "display_name": disp, "safe_key": safe_key(disp or "")}
                )

            cur.execute(
                """
                SELECT player_id::text, first_name, last_name, full_name, player_entity_id::text
                  FROM analytics.players
                """
            )
            for r in cur.fetchall():
                disp = r[3] or " ".join(x for x in [r[1], r[2]] if x)
                out["players"].append(
                    {
                        "player_id": r[0],
                        "display_name": disp,
                        "player_entity_id": r[4],
                        "safe_key": safe_key(disp or ""),
                    }
                )
        conn.execute("COMMIT")
    return out


def index_snapshots(snaps: list[dict[str, Any]]) -> dict[str, Any]:
    """Index by analytics_team_id and by team_abbreviation."""
    by_team_date: dict[tuple[str, str], list[dict]] = defaultdict(list)
    dates_by_team: dict[str, list[str]] = defaultdict(list)
    for s in snaps:
        tid = s.get("analytics_team_id")
        abbr = s.get("team_abbreviation")
        d = s.get("snapshot_date")
        if not d:
            continue
        keys = []
        if tid:
            keys.append(("id", tid))
        if abbr:
            keys.append(("abbr", abbr))
        for k in keys:
            by_team_date[(k[0] + ":" + k[1], d)].append(s)
            dates_by_team[k[0] + ":" + k[1]].append(d)
    for k in dates_by_team:
        dates_by_team[k] = sorted(set(dates_by_team[k]))
    return {"by_team_date": by_team_date, "dates_by_team": dates_by_team, "all": snaps}


def latest_prior_snapshot_date(dates: list[str], game_date: str) -> str | None:
    prior = [d for d in dates if d <= game_date]
    return prior[-1] if prior else None


def match_name_candidates(cands: list[dict[str, Any]], sk: str) -> list[dict[str, Any]]:
    return [c for c in cands if c.get("safe_key") == sk]


def classify_name_match(matches: list[dict[str, Any]], none_label: str, uniq_label: str, multi_label: str) -> str:
    if not matches:
        return none_label
    # unique by identity endpoint
    return uniq_label if len(matches) == 1 else multi_label


def audit_u5(opgs: list[dict[str, Any]], db: dict[str, Any]) -> dict[str, Any]:
    idx = index_snapshots(db["snapshots"])
    bridges = db["nba_bridges"]
    entity_to_bdl = db["entity_to_bdl"]

    # Historical availability at team-game grain
    team_games = sorted({(r["game_id"], r["team_id"], r["et_game_date"], r["season"], r["team_abbreviation"]) for r in opgs})
    avail_rows = []
    age_buckets_by_season: dict[str, Counter] = defaultdict(Counter)
    for _gid, tid, gdate, season, abbr in team_games:
        keys = [f"id:{tid}", f"abbr:{abbr}"]
        dates: list[str] = []
        for k in keys:
            dates.extend(idx["dates_by_team"].get(k, []))
        dates = sorted(set(dates))
        exact = gdate in dates
        prior = latest_prior_snapshot_date(dates, gdate)
        age = (parse_iso_date(gdate) - parse_iso_date(prior)).days if prior else None
        bucket = age_bucket(age)
        age_buckets_by_season[season][bucket] += 1
        avail_rows.append(
            {
                "game_id": _gid,
                "team_id": tid,
                "et_game_date": gdate,
                "season": season,
                "exact_date": exact,
                "prior_date": prior,
                "age_days": age,
                "age_bucket": bucket,
            }
        )

    snap_meta = {
        "total_rows": len(db["snapshots"]),
        "first_snapshot_date": min((s["snapshot_date"] for s in db["snapshots"] if s["snapshot_date"]), default=None),
        "last_snapshot_date": max((s["snapshot_date"] for s in db["snapshots"] if s["snapshot_date"]), default=None),
        "distinct_snapshot_dates": len({s["snapshot_date"] for s in db["snapshots"] if s["snapshot_date"]}),
        "distinct_teams_abbr": len({s["team_abbreviation"] for s in db["snapshots"] if s["team_abbreviation"]}),
    }

    results = []
    for r in opgs:
        tid, abbr, gdate = r["team_id"], r["team_abbreviation"], r["et_game_date"]
        keys = [f"id:{tid}", f"abbr:{abbr}"]
        dates: list[str] = []
        for k in keys:
            dates.extend(idx["dates_by_team"].get(k, []))
        dates = sorted(set(dates))
        exact_date = gdate if gdate in dates else None
        prior_date = latest_prior_snapshot_date(dates, gdate)

        def gather(d: str | None) -> list[dict]:
            if not d:
                return []
            seen = set()
            out = []
            for k in keys:
                for s in idx["by_team_date"].get((k, d), []):
                    pid = s["nba_player_id"]
                    if pid in seen:
                        continue
                    seen.add(pid)
                    out.append(s)
            return out

        exact_cands = gather(exact_date)
        prior_cands = gather(prior_date)
        age = (parse_iso_date(gdate) - parse_iso_date(prior_date)).days if prior_date else None

        def name_class(cands: list[dict], prefix: str) -> tuple[str, list[dict]]:
            if not cands and not (exact_date if prefix == "U5A" else prior_date):
                return f"{prefix}_NO_SNAPSHOT", []
            if not cands:
                return f"{prefix}_NO_SNAPSHOT", []
            hits = match_name_candidates(cands, r["safe_key"])
            if not hits:
                return f"{prefix}_NO_NAME_MATCH", []
            # unique by nba_player_id
            by_id = {}
            for h in hits:
                by_id[h["nba_player_id"]] = h
            if len(by_id) == 1:
                return f"{prefix}_UNIQUE_NAME_MATCH", list(by_id.values())
            return f"{prefix}_MULTIPLE_NAME_MATCHES", list(by_id.values())

        u5a_cls, u5a_hits = name_class(exact_cands, "U5A")
        u5b_cls, u5b_hits = name_class(prior_cands, "U5B")

        # Prefer exact-date unique, else prior unique for bridge audit
        chosen = u5a_hits[0] if u5a_cls.endswith("UNIQUE_NAME_MATCH") else (
            u5b_hits[0] if u5b_cls.endswith("UNIQUE_NAME_MATCH") else None
        )
        bridge_cls = None
        entity_id = None
        serving_ids: list[str] = []
        if chosen:
            nba_id = chosen["nba_player_id"]
            ents = bridges.get(nba_id, [])
            uniq_ents = sorted(set(ents))
            if not uniq_ents:
                bridge_cls = "NBA_ID_NO_ENTITY_BRIDGE"
            elif len(uniq_ents) > 1:
                bridge_cls = "NBA_ID_BRIDGE_CONFLICT"
            else:
                entity_id = uniq_ents[0]
                serving_ids = entity_to_bdl.get(entity_id, [])
                if serving_ids:
                    bridge_cls = "ENTITY_AND_SERVING_BDL_PLAYER"
                else:
                    bridge_cls = "ENTITY_ONLY"

        results.append(
            {
                **{k: r[k] for k in ("game_id", "team_id", "player_name_raw", "season", "et_game_date", "ever_out")},
                "u5a_class": u5a_cls,
                "u5b_class": u5b_cls,
                "u5b_age_days": age,
                "u5b_age_bucket": age_bucket(age),
                "u5_nba_player_id": chosen["nba_player_id"] if chosen else None,
                "u5_roster_player_name": chosen["player_name"] if chosen else None,
                "u5_snapshot_date": (exact_date if u5a_cls.endswith("UNIQUE_NAME_MATCH") else prior_date)
                if chosen
                else None,
                "u5_bridge_class": bridge_cls,
                "u5_entity_id": entity_id,
                "u5_serving_player_ids": serving_ids,
            }
        )

    # availability summary by season
    avail_by_season: dict[str, Any] = {}
    for season in sorted({a["season"] for a in avail_rows}):
        rows = [a for a in avail_rows if a["season"] == season]
        ages = [a["age_days"] for a in rows if a["age_days"] is not None]
        avail_by_season[season] = {
            "target_team_games": len(rows),
            "exact_date_snapshot": sum(1 for a in rows if a["exact_date"]),
            "latest_prior_snapshot": sum(1 for a in rows if a["prior_date"]),
            "no_prior_snapshot": sum(1 for a in rows if not a["prior_date"]),
            "age_buckets": dict(age_buckets_by_season[season]),
            "median_snapshot_age_days": statistics.median(ages) if ages else None,
        }

    return {
        "snapshot_meta": snap_meta,
        "availability_by_season": avail_by_season,
        "per_opg": results,
        "u5a_counts": dict(Counter(x["u5a_class"] for x in results)),
        "u5b_counts": dict(Counter(x["u5b_class"] for x in results)),
        "bridge_counts": dict(Counter(x["u5_bridge_class"] for x in results if x["u5_bridge_class"])),
    }


def stint_active(st: dict[str, Any], gdate: str) -> bool:
    of = st.get("observed_from")
    ot = st.get("observed_to")
    if not of or of > gdate:
        return False
    if ot is None or ot >= gdate:
        return True
    return False


def audit_u4(opgs: list[dict[str, Any]], db: dict[str, Any]) -> dict[str, Any]:
    stints = db["stints"]
    by_team: dict[str, list[dict]] = defaultdict(list)
    for s in stints:
        by_team[s["team_id"]].append(s)

    results = []
    for r in opgs:
        cands = [s for s in by_team.get(r["team_id"], []) if stint_active(s, r["et_game_date"])]
        nba = [s for s in cands if s.get("source") == "nba_stats"]
        inf = [s for s in cands if s.get("source") == "inferred_pgl"]
        all_c = cands

        def match(universe: list[dict]) -> tuple[str, list[str]]:
            hits = match_name_candidates(universe, r["safe_key"])
            ents = sorted({h["player_entity_id"] for h in hits if h.get("player_entity_id")})
            if not hits:
                return "NO_CANDIDATE", []
            if len(ents) == 1:
                return "UNIQUE_CANDIDATE", ents
            if len(ents) == 0:
                # matched name but no entity — treat as no entity candidate
                return "NO_CANDIDATE", []
            return "MULTIPLE_CANDIDATES", ents

        nba_cls, nba_ents = match(nba)
        inf_cls, inf_ents = match(inf)
        all_cls, all_ents = match(all_c)
        results.append(
            {
                "game_id": r["game_id"],
                "team_id": r["team_id"],
                "player_name_raw": r["player_name_raw"],
                "season": r["season"],
                "ever_out": r["ever_out"],
                "u4_nba_class": nba_cls,
                "u4_nba_entity_ids": nba_ents,
                "u4_inferred_class": inf_cls,
                "u4_inferred_entity_ids": inf_ents,
                "u4_all_class": all_cls,
                "u4_all_entity_ids": all_ents,
                "u4_active_stint_sources": dict(Counter(s["source"] for s in cands)),
            }
        )
    return {
        "per_opg": results,
        "nba_counts": dict(Counter(x["u4_nba_class"] for x in results)),
        "inferred_counts": dict(Counter(x["u4_inferred_class"] for x in results)),
        "all_counts": dict(Counter(x["u4_all_class"] for x in results)),
    }


def audit_u2(opgs: list[dict[str, Any]], db: dict[str, Any]) -> dict[str, Any]:
    by_gt: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for p in db["pgl"]:
        by_gt[(p["game_id"], p["team_id"])].append(p)

    results = []
    for r in opgs:
        cands = by_gt.get((r["game_id"], r["team_id"]), [])
        hits = match_name_candidates(cands, r["safe_key"])
        by_pid = {}
        for h in hits:
            by_pid[h["player_id"]] = h
        vals = list(by_pid.values())
        if not vals:
            cls = "U2_NO_MATCH"
        elif len(vals) > 1:
            cls = "U2_MULTIPLE_MATCHES"
        else:
            cls = "U2_UNIQUE_DNP_00" if vals[0]["is_00"] else "U2_UNIQUE_PLAYED"
        hit = vals[0] if len(vals) == 1 else None
        results.append(
            {
                "game_id": r["game_id"],
                "team_id": r["team_id"],
                "player_name_raw": r["player_name_raw"],
                "season": r["season"],
                "ever_out": r["ever_out"],
                "u2_class": cls,
                "u2_player_id": hit["player_id"] if hit else None,
                "u2_minutes": hit["minutes"] if hit else None,
                "u2_entity_id": hit["player_entity_id"] if hit else None,
            }
        )
    return {"per_opg": results, "counts": dict(Counter(x["u2_class"] for x in results))}


def league_wide_diagnostic(opgs: list[dict[str, Any]], db: dict[str, Any]) -> dict[str, Any]:
    ent_idx: dict[str, list[str]] = defaultdict(list)
    for e in db["entities"]:
        ent_idx[e["safe_key"]].append(e["player_entity_id"])
    pl_idx: dict[str, list[str]] = defaultdict(list)
    for p in db["players"]:
        pl_idx[p["safe_key"]].append(p["player_id"])

    names = sorted({r["player_name_raw"] for r in opgs})
    ent_counts = Counter()
    pl_counts = Counter()
    for n in names:
        sk = safe_key(n)
        ec = len(set(ent_idx.get(sk, [])))
        pc = len(set(pl_idx.get(sk, [])))
        ent_counts["zero" if ec == 0 else ("one" if ec == 1 else "multiple")] += 1
        pl_counts["zero" if pc == 0 else ("one" if pc == 1 else "multiple")] += 1
    return {
        "unique_raw_names": len(names),
        "entities_safe_key": dict(ent_counts),
        "players_safe_key": dict(pl_counts),
        "note": "Diagnostic only — not a candidate assignment path.",
    }


def suffix_collision_audit(opgs: list[dict[str, Any]], db: dict[str, Any]) -> dict[str, Any]:
    """Find cases where SAFE_KEY distinguishes people but legacy strip merges them."""
    # Across entity+player+roster+official names in candidate populations
    name_pairs: list[tuple[str, str, str]] = []  # safe, legacy, source_label
    for r in opgs:
        name_pairs.append((r["safe_key"], r["legacy_key"], "official"))
    for e in db["entities"]:
        name_pairs.append((e["safe_key"], legacy_suffix_stripped_key(e["display_name"]), "entity"))
    for p in db["players"]:
        name_pairs.append((p["safe_key"], legacy_suffix_stripped_key(p["display_name"]), "player"))
    for s in db["snapshots"]:
        name_pairs.append((s["safe_key"], legacy_suffix_stripped_key(s["player_name"] or ""), "roster"))

    by_legacy: dict[str, set[str]] = defaultdict(set)
    for sk, lk, _ in name_pairs:
        if sk and lk:
            by_legacy[lk].add(sk)

    collision_groups = []
    for lk, safes in by_legacy.items():
        if len(safes) > 1:
            collision_groups.append({"legacy_key": lk, "safe_keys": sorted(safes), "safe_key_count": len(safes)})

    affected = 0
    for r in opgs:
        if len(by_legacy.get(r["legacy_key"], set())) > 1:
            affected += 1

    return {
        "distinct_safe_keys_in_populations": len({sk for sk, _, _ in name_pairs if sk}),
        "distinct_legacy_keys_in_populations": len({lk for _, lk, _ in name_pairs if lk}),
        "collision_group_count": len(collision_groups),
        "official_player_games_affected": affected,
        "collision_groups": collision_groups[:200],
        "SUFFIX_STRIPPING_SAFE_FOR_IDENTITY": "NO" if collision_groups else "YES",
    }


def combine_and_simulate(
    opgs: list[dict[str, Any]],
    u5: dict[str, Any],
    u4: dict[str, Any],
    u2: dict[str, Any],
) -> list[dict[str, Any]]:
    u5m = {(x["game_id"], x["team_id"], x["player_name_raw"]): x for x in u5["per_opg"]}
    u4m = {(x["game_id"], x["team_id"], x["player_name_raw"]): x for x in u4["per_opg"]}
    u2m = {(x["game_id"], x["team_id"], x["player_name_raw"]): x for x in u2["per_opg"]}

    out = []
    for r in opgs:
        k = (r["game_id"], r["team_id"], r["player_name_raw"])
        a = u5m[k]
        b = u4m[k]
        c = u2m[k]

        ents: dict[str, str] = {}
        multi = False

        # U5 entity
        if a.get("u5_entity_id"):
            ents["U5"] = a["u5_entity_id"]
        elif a.get("u5a_class", "").endswith("MULTIPLE") or a.get("u5b_class", "").endswith("MULTIPLE"):
            multi = True

        if b["u4_nba_class"] == "UNIQUE_CANDIDATE":
            ents["U4_NBA"] = b["u4_nba_entity_ids"][0]
        elif b["u4_nba_class"] == "MULTIPLE_CANDIDATES":
            multi = True

        if c["u2_class"] in ("U2_UNIQUE_PLAYED", "U2_UNIQUE_DNP_00") and c.get("u2_entity_id"):
            ents["U2"] = c["u2_entity_id"]
        elif c["u2_class"] == "U2_MULTIPLE_MATCHES":
            multi = True

        if b["u4_inferred_class"] == "UNIQUE_CANDIDATE":
            ents["U4_INFERRED"] = b["u4_inferred_entity_ids"][0]
        elif b["u4_inferred_class"] == "MULTIPLE_CANDIDATES":
            multi = True

        uniq_ents = sorted(set(ents.values()))
        if multi and not uniq_ents:
            sim = "MULTIPLE_NAME_CANDIDATES"
            concordance = "MULTIPLE_NAME_CANDIDATES"
        elif len(uniq_ents) > 1:
            sim = "SOURCE_CONFLICT"
            concordance = "SOURCE_CONFLICT"
        elif len(uniq_ents) == 0:
            if a.get("u5_bridge_class") == "NBA_ID_NO_ENTITY_BRIDGE":
                sim = "NBA_ID_NO_ENTITY_BRIDGE"
            else:
                sim = "NO_SAFE_CANDIDATE"
            concordance = "NO_SOURCE_CANDIDATE"
        else:
            # unique entity
            sources = sorted(ents.keys())
            if len(sources) >= 2:
                srcset = set(sources)
                if srcset == {"U5", "U4_NBA"} or srcset == {"U5", "U4_NBA", "U4_INFERRED"}:
                    concordance = "U5_U4_AGREE"
                elif srcset == {"U5", "U2"}:
                    concordance = "U5_U2_AGREE"
                elif srcset == {"U4_NBA", "U2"} or srcset == {"U4_INFERRED", "U2"}:
                    concordance = "U4_U2_AGREE"
                else:
                    concordance = "ALL_AVAILABLE_SOURCES_AGREE"
                sim = "MULTI_SOURCE_CONCORDANT"
            else:
                concordance = "SINGLE_SOURCE_ONLY"
                src = sources[0]
                if src == "U5":
                    if a.get("u5_bridge_class") == "ENTITY_ONLY":
                        sim = "ENTITY_ONLY_NO_SERVING_BDL"
                    else:
                        sim = "U5_ONLY_UNIQUE"
                elif src == "U4_NBA":
                    sim = "U4_NBA_ONLY_UNIQUE"
                elif src == "U2":
                    sim = "U2_ONLY_UNIQUE"
                else:
                    sim = "U4_INFERRED_ONLY_UNIQUE"

        entity_id = uniq_ents[0] if len(uniq_ents) == 1 else None
        has_serving = bool(a.get("u5_serving_player_ids")) or (
            c.get("u2_player_id") is not None and entity_id and c.get("u2_entity_id") == entity_id
        )
        # also check u4 player_id via unique nba/inferred — approximate via U2 or U5 serving
        if entity_id and not has_serving:
            # serving if any U2 unique points to same entity (already) or U5 serving
            pass

        out.append(
            {
                **r,
                "u5": a,
                "u4": b,
                "u2": c,
                "concordance": concordance,
                "simulation_class": sim,
                "candidate_entity_id": entity_id,
                "candidate_sources": sorted(ents.keys()),
                "canonical_identity": entity_id is not None,
                "serving_projection": bool(
                    (a.get("u5_serving_player_ids"))
                    or (c.get("u2_player_id") and c.get("u2_entity_id") == entity_id)
                )
                if entity_id
                else False,
            }
        )
    return out


def subset(rows: list[dict[str, Any]], pred) -> list[dict[str, Any]]:
    return [r for r in rows if pred(r)]


def count_by(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    return dict(Counter(r[key] for r in rows))


def season_matrix(rows: list[dict[str, Any]], builder) -> dict[str, Any]:
    out = {}
    for season in sorted({r["season"] for r in rows}):
        out[season] = builder([r for r in rows if r["season"] == season])
    out["ALL"] = builder(rows)
    return out


def main() -> int:
    print("Fingerprinting frozen artifacts...", flush=True)
    fp = {
        "parser.py": sha256_file(PARSER_PATH),
        "phase4a_json": sha256_file(PHASE4A_JSON) if PHASE4A_JSON.exists() else None,
        "phase4a1_json": sha256_file(PHASE4A1_JSON) if PHASE4A1_JSON.exists() else None,
        "dry_parse_json": sha256_file(DRY_PARSE_JSON) if DRY_PARSE_JSON.exists() else None,
        "parsed_rows_gz": sha256_file(ROWS_GZ),
        "blocks_gz": sha256_file(BLOCKS_GZ),
        "certified_parser_sha_expected": CERTIFIED_PARSER_SHA,
        "parser_sha_match": sha256_file(PARSER_PATH) == CERTIFIED_PARSER_SHA,
    }
    if not fp["parser_sha_match"]:
        raise SystemExit("Parser SHA mismatch — abort")

    print("Loading certified game joins...", flush=True)
    certified = load_certified_games()
    print(f"certified_logical_games={len(certified)}", flush=True)

    print("Building official_player_game grain...", flush=True)
    opgs, grain_stats = build_official_player_games(certified)
    print(
        f"opg={len(opgs)} games={grain_stats['target_games_represented']} "
        f"obs={grain_stats['player_observations_certified']} names={grain_stats['unique_raw_player_names']}",
        flush=True,
    )
    if grain_stats["team_unresolved_observations"]:
        print(f"WARNING team_unresolved_obs={grain_stats['team_unresolved_observations']}", flush=True)

    print("Loading DB (READ ONLY)...", flush=True)
    db = load_db({r["game_id"] for r in opgs})
    print(
        f"snapshots={len(db['snapshots'])} stints={len(db['stints'])} pgl={len(db['pgl'])} "
        f"nba_bridges={len(db['nba_bridges'])}",
        flush=True,
    )

    print("Auditing U5...", flush=True)
    u5 = audit_u5(opgs, db)
    print("Auditing U4...", flush=True)
    u4 = audit_u4(opgs, db)
    print("Auditing U2...", flush=True)
    u2 = audit_u2(opgs, db)
    print("Combining simulation...", flush=True)
    combined = combine_and_simulate(opgs, u5, u4, u2)

    suffix = suffix_collision_audit(opgs, db)
    league = league_wide_diagnostic(opgs, db)

    ever_out = subset(combined, lambda r: r["ever_out"])
    ever_avail = subset(combined, lambda r: r["ever_available"])
    ever_q = subset(combined, lambda r: r["ever_questionable"])

    def u5_matrix_row(rows: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "player_games": len(rows),
            "exact_day_snapshot_unique_or_present": sum(
                1 for r in rows if not r["u5"]["u5a_class"].endswith("NO_SNAPSHOT")
            ),
            "u5a_unique": sum(1 for r in rows if r["u5"]["u5a_class"].endswith("UNIQUE_NAME_MATCH")),
            "prior_snapshot_present": sum(
                1 for r in rows if not r["u5"]["u5b_class"].endswith("NO_SNAPSHOT")
            ),
            "u5b_unique": sum(1 for r in rows if r["u5"]["u5b_class"].endswith("UNIQUE_NAME_MATCH")),
            "nba_id_to_entity": sum(
                1
                for r in rows
                if r["u5"]["u5_bridge_class"] in ("ENTITY_AND_SERVING_BDL_PLAYER", "ENTITY_ONLY")
            ),
            "entity_to_serving_bdl": sum(
                1 for r in rows if r["u5"]["u5_bridge_class"] == "ENTITY_AND_SERVING_BDL_PLAYER"
            ),
        }

    def u4_matrix_row(rows: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "player_games": len(rows),
            "u4_nba_unique": sum(1 for r in rows if r["u4"]["u4_nba_class"] == "UNIQUE_CANDIDATE"),
            "u4_inferred_unique": sum(
                1 for r in rows if r["u4"]["u4_inferred_class"] == "UNIQUE_CANDIDATE"
            ),
            "u4_nba_none": sum(1 for r in rows if r["u4"]["u4_nba_class"] == "NO_CANDIDATE"),
            "u4_inferred_none": sum(
                1 for r in rows if r["u4"]["u4_inferred_class"] == "NO_CANDIDATE"
            ),
            "u4_nba_ambiguous": sum(
                1 for r in rows if r["u4"]["u4_nba_class"] == "MULTIPLE_CANDIDATES"
            ),
            "u4_inferred_ambiguous": sum(
                1 for r in rows if r["u4"]["u4_inferred_class"] == "MULTIPLE_CANDIDATES"
            ),
        }

    def u2_matrix_row(rows: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "player_games": len(rows),
            "played": sum(1 for r in rows if r["u2"]["u2_class"] == "U2_UNIQUE_PLAYED"),
            "dnp_00": sum(1 for r in rows if r["u2"]["u2_class"] == "U2_UNIQUE_DNP_00"),
            "no_match": sum(1 for r in rows if r["u2"]["u2_class"] == "U2_NO_MATCH"),
            "ambiguous": sum(1 for r in rows if r["u2"]["u2_class"] == "U2_MULTIPLE_MATCHES"),
        }

    # ever-Out U2 missing recovery
    u2_missing_out = [r for r in ever_out if r["u2"]["u2_class"] == "U2_NO_MATCH"]
    recovery = {
        "u2_missing_ever_out": len(u2_missing_out),
        "recovered_u5_unique_entity": sum(
            1
            for r in u2_missing_out
            if r["u5"]["u5_entity_id"]
            or r["u5"]["u5a_class"].endswith("UNIQUE_NAME_MATCH")
            or r["u5"]["u5b_class"].endswith("UNIQUE_NAME_MATCH")
        ),
        "recovered_u5_bridged_entity": sum(1 for r in u2_missing_out if r["u5"]["u5_entity_id"]),
        "recovered_u4_nba": sum(
            1 for r in u2_missing_out if r["u4"]["u4_nba_class"] == "UNIQUE_CANDIDATE"
        ),
        "recovered_u4_inferred": sum(
            1 for r in u2_missing_out if r["u4"]["u4_inferred_class"] == "UNIQUE_CANDIDATE"
        ),
        "still_no_safe": sum(1 for r in u2_missing_out if r["simulation_class"] == "NO_SAFE_CANDIDATE"),
        "by_season": dict(Counter(r["season"] for r in u2_missing_out)),
        "unique_names": len({r["player_name_raw"] for r in u2_missing_out}),
        "unique_teams": len({r["team_abbreviation"] for r in u2_missing_out}),
    }

    entity_only = [r for r in combined if r["simulation_class"] == "ENTITY_ONLY_NO_SERVING_BDL" or r["u5"]["u5_bridge_class"] == "ENTITY_ONLY"]
    # Prefer bridge class for Class-C-like
    class_c = [
        r
        for r in combined
        if r["u5"]["u5_bridge_class"] == "ENTITY_ONLY"
    ]

    sim_counts = count_by(combined, "simulation_class")
    conc_counts = count_by(combined, "concordance")

    # U5 historical assessment by season
    u5_assessment = {}
    for season, avail in u5["availability_by_season"].items():
        prior_rate = avail["latest_prior_snapshot"] / max(avail["target_team_games"], 1)
        if prior_rate >= 0.95 and avail["exact_date_snapshot"] / max(avail["target_team_games"], 1) >= 0.5:
            grade = "STRONG_PRIMARY_SOURCE"
        elif prior_rate >= 0.25:
            grade = "USEFUL_BUT_PARTIAL"
        else:
            grade = "INSUFFICIENT_HISTORICAL_COVERAGE"
        u5_assessment[season] = {"grade": grade, **avail}

    # Name-shape coverage
    shape_cov = {}
    for flag in (
        "has_jr",
        "has_sr",
        "has_ii",
        "has_iii",
        "has_iv",
        "has_apostrophe",
        "has_hyphen",
        "has_period",
        "has_multipart_last",
    ):
        rows = [r for r in combined if r["name_shape"].get(flag)]
        shape_cov[flag] = {
            "n": len(rows),
            "u5_unique": sum(
                1
                for r in rows
                if r["u5"]["u5a_class"].endswith("UNIQUE_NAME_MATCH")
                or r["u5"]["u5b_class"].endswith("UNIQUE_NAME_MATCH")
            ),
            "u4_nba_unique": sum(1 for r in rows if r["u4"]["u4_nba_class"] == "UNIQUE_CANDIDATE"),
            "u4_inferred_unique": sum(
                1 for r in rows if r["u4"]["u4_inferred_class"] == "UNIQUE_CANDIDATE"
            ),
            "u2_unique": sum(
                1 for r in rows if r["u2"]["u2_class"] in ("U2_UNIQUE_PLAYED", "U2_UNIQUE_DNP_00")
            ),
        }

    # Observation-grain secondary: approximate by summing observation_count weighted classes
    obs_total = sum(r["observation_count"] for r in combined)
    obs_u2_unique = sum(
        r["observation_count"]
        for r in combined
        if r["u2"]["u2_class"] in ("U2_UNIQUE_PLAYED", "U2_UNIQUE_DNP_00")
    )

    # Circular U4
    u4_circ = {
        "by_season_all": {},
        "by_season_ever_out": {},
    }
    for season in sorted({r["season"] for r in combined}):
        rows = [r for r in combined if r["season"] == season]
        outs = [r for r in rows if r["ever_out"]]
        for label, rs in (("all", rows), ("ever_out", outs)):
            u4_circ[f"by_season_{label}"][season] = {
                "n": len(rs),
                "nba_unique": sum(1 for r in rs if r["u4"]["u4_nba_class"] == "UNIQUE_CANDIDATE"),
                "inferred_unique": sum(
                    1 for r in rs if r["u4"]["u4_inferred_class"] == "UNIQUE_CANDIDATE"
                ),
                "inferred_only_unique": sum(
                    1
                    for r in rs
                    if r["u4"]["u4_inferred_class"] == "UNIQUE_CANDIDATE"
                    and r["u4"]["u4_nba_class"] != "UNIQUE_CANDIDATE"
                ),
            }

    no_safe = [r for r in combined if r["simulation_class"] == "NO_SAFE_CANDIDATE"]
    conflicts = [r for r in combined if r["simulation_class"] == "SOURCE_CONFLICT"]
    multiples = [r for r in combined if r["simulation_class"] == "MULTIPLE_NAME_CANDIDATES"]
    no_bridge = [r for r in combined if r["simulation_class"] == "NBA_ID_NO_ENTITY_BRIDGE"]

    canonical_cov = sum(1 for r in combined if r["canonical_identity"])
    serving_cov = sum(1 for r in combined if r["serving_projection"])

    ever_out_n = len(ever_out)
    ever_out_u2 = u2_matrix_row(ever_out)
    lost_if_u2_only = ever_out_u2["no_match"] / max(ever_out_n, 1)

    # Gate
    measured = all(
        [
            u5["snapshot_meta"]["total_rows"] is not None,
            len(combined) > 0,
            "SUFFIX_STRIPPING_SAFE_FOR_IDENTITY" in suffix,
            len(u5_assessment) >= 1,
        ]
    )
    audit_gate = "PASS" if measured else "FAIL"

    summary = {
        "generated_at": utc_now(),
        "phase": "4B",
        "PLAYER_IDENTITY_CANDIDATE_AUDIT": audit_gate,
        "F7": "OPEN",
        "AS_OF_INJURY_TAPE_CERTIFIED": "NO",
        "GAME_JOIN_CERTIFIED": "YES",
        "NEXT": "DESIGN_PLAYER_IDENTITY_RESOLVER" if audit_gate == "PASS" else "REMEDIATE_CANDIDATE_AUDIT_GAPS",
        "fingerprint": fp,
        "grain": grain_stats,
        "population": {
            "target_games_represented": grain_stats["target_games_represented"],
            "unique_official_player_games": len(combined),
            "raw_player_observations_certified": grain_stats["player_observations_certified"],
            "raw_player_observations_corpus": grain_stats["player_observations_total_corpus"],
            "unique_raw_player_names": grain_stats["unique_raw_player_names"],
            "team_unresolved_observations": grain_stats["team_unresolved_observations"],
            "ever_out": ever_out_n,
            "ever_available": len(ever_avail),
            "ever_questionable": len(ever_q),
        },
        "u5": {
            "snapshot_meta": u5["snapshot_meta"],
            "assessment_by_season": u5_assessment,
            "u5a_counts": u5["u5a_counts"],
            "u5b_counts": u5["u5b_counts"],
            "bridge_counts": u5["bridge_counts"],
            "matrix_all": season_matrix(combined, u5_matrix_row),
            "matrix_ever_out": season_matrix(ever_out, u5_matrix_row),
        },
        "u4": {
            "nba_counts": u4["nba_counts"],
            "inferred_counts": u4["inferred_counts"],
            "circularity": u4_circ,
            "matrix_all": season_matrix(combined, u4_matrix_row),
            "matrix_ever_out": season_matrix(ever_out, u4_matrix_row),
        },
        "u2": {
            "counts": u2["counts"],
            "matrix_all": season_matrix(combined, u2_matrix_row),
            "matrix_ever_out": season_matrix(ever_out, u2_matrix_row),
            "ever_out_lost_if_u2_exclusive_rate": lost_if_u2_only,
            "ever_out_u2_missing_recovery": recovery,
            "observation_grain_secondary": {
                "observations": obs_total,
                "u2_unique_observations": obs_u2_unique,
            },
        },
        "concordance_counts": conc_counts,
        "simulation_counts": sim_counts,
        "canonical_identity_coverage": {
            "opg_with_unique_entity": canonical_cov,
            "rate": canonical_cov / max(len(combined), 1),
        },
        "serving_bdl_projection_coverage": {
            "opg_with_serving_projection": serving_cov,
            "rate": serving_cov / max(len(combined), 1),
        },
        "class_c_entity_only": {
            "count": len(class_c),
            "unique_entities": len({r["u5"]["u5_entity_id"] for r in class_c if r["u5"]["u5_entity_id"]}),
            "by_season": dict(Counter(r["season"] for r in class_c)),
            "sample": [
                {
                    "player_name_raw": r["player_name_raw"],
                    "team": r["team_abbreviation"],
                    "season": r["season"],
                    "game_id": r["game_id"],
                    "nba_player_id": r["u5"]["u5_nba_player_id"],
                    "entity_id": r["u5"]["u5_entity_id"],
                }
                for r in class_c[:25]
            ],
        },
        "unresolved": {
            "no_safe_candidate": len(no_safe),
            "source_conflict": len(conflicts),
            "multiple_name_candidates": len(multiples),
            "nba_id_no_entity_bridge": len(no_bridge),
            "no_safe_by_season": dict(Counter(r["season"] for r in no_safe)),
            "no_safe_ever_out": sum(1 for r in no_safe if r["ever_out"]),
            "no_safe_ever_out_by_season": dict(
                Counter(r["season"] for r in no_safe if r["ever_out"])
            ),
        },
        "suffix_collision": {
            **{k: v for k, v in suffix.items() if k != "collision_groups"},
            "collision_groups_sample": suffix["collision_groups"][:30],
        },
        "league_wide_diagnostic": league,
        "name_shape_coverage": shape_cov,
        "restrictions": {
            "no_resolver_implemented": True,
            "no_identity_writes": True,
            "no_fuzzy_matching": True,
            "suffix_stripped_not_authoritative": True,
            "ever_out_is_not_t60": True,
        },
    }

    # Write artifacts
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    print("Writing records...", flush=True)
    with gzip.open(TMP_RECORDS_GZ, "wt", encoding="utf-8") as fh:
        for r in combined:
            # slim record for lossless audit
            rec = {
                "record_type": "official_player_game",
                "game_id": r["game_id"],
                "season": r["season"],
                "et_game_date": r["et_game_date"],
                "team_id": r["team_id"],
                "team_abbreviation": r["team_abbreviation"],
                "player_name_raw": r["player_name_raw"],
                "safe_key": r["safe_key"],
                "legacy_key": r["legacy_key"],
                "observation_count": r["observation_count"],
                "statuses_observed": r["statuses_observed"],
                "ever_out": r["ever_out"],
                "ever_available": r["ever_available"],
                "ever_questionable": r["ever_questionable"],
                "u5a_class": r["u5"]["u5a_class"],
                "u5b_class": r["u5"]["u5b_class"],
                "u5b_age_days": r["u5"]["u5b_age_days"],
                "u5_nba_player_id": r["u5"]["u5_nba_player_id"],
                "u5_entity_id": r["u5"]["u5_entity_id"],
                "u5_bridge_class": r["u5"]["u5_bridge_class"],
                "u4_nba_class": r["u4"]["u4_nba_class"],
                "u4_nba_entity_ids": r["u4"]["u4_nba_entity_ids"],
                "u4_inferred_class": r["u4"]["u4_inferred_class"],
                "u4_inferred_entity_ids": r["u4"]["u4_inferred_entity_ids"],
                "u2_class": r["u2"]["u2_class"],
                "u2_player_id": r["u2"]["u2_player_id"],
                "u2_minutes": r["u2"]["u2_minutes"],
                "u2_entity_id": r["u2"]["u2_entity_id"],
                "concordance": r["concordance"],
                "simulation_class": r["simulation_class"],
                "candidate_entity_id": r["candidate_entity_id"],
                "canonical_identity": r["canonical_identity"],
                "serving_projection": r["serving_projection"],
            }
            fh.write(json.dumps(rec, separators=(",", ":")) + "\n")

    records_sha = sha256_file(TMP_RECORDS_GZ)
    records_bytes = TMP_RECORDS_GZ.stat().st_size

    # Anomalies
    anom_path = OUT_ANOM
    anom_n = 0
    with anom_path.open("w", encoding="utf-8") as fh:
        def emit(kind: str, payload: dict) -> None:
            nonlocal anom_n
            fh.write(json.dumps({"kind": kind, **payload}, separators=(",", ":")) + "\n")
            anom_n += 1

        for r in conflicts:
            emit(
                "SOURCE_CONFLICT",
                {
                    "game_id": r["game_id"],
                    "team_id": r["team_id"],
                    "player_name_raw": r["player_name_raw"],
                    "sources": r["candidate_sources"],
                    "u5_entity": r["u5"]["u5_entity_id"],
                    "u4_nba": r["u4"]["u4_nba_entity_ids"],
                    "u4_inferred": r["u4"]["u4_inferred_entity_ids"],
                    "u2_entity": r["u2"]["u2_entity_id"],
                },
            )
        for r in multiples:
            emit(
                "MULTIPLE_NAME_CANDIDATES",
                {
                    "game_id": r["game_id"],
                    "team": r["team_abbreviation"],
                    "player_name_raw": r["player_name_raw"],
                    "u5a": r["u5"]["u5a_class"],
                    "u5b": r["u5"]["u5b_class"],
                    "u4_nba": r["u4"]["u4_nba_class"],
                    "u2": r["u2"]["u2_class"],
                },
            )
        for r in no_bridge:
            emit(
                "NBA_ID_NO_ENTITY_BRIDGE",
                {
                    "game_id": r["game_id"],
                    "player_name_raw": r["player_name_raw"],
                    "nba_player_id": r["u5"]["u5_nba_player_id"],
                },
            )
        for r in class_c[:500]:
            emit(
                "ENTITY_ONLY_NO_SERVING_BDL",
                {
                    "game_id": r["game_id"],
                    "player_name_raw": r["player_name_raw"],
                    "entity_id": r["u5"]["u5_entity_id"],
                    "nba_player_id": r["u5"]["u5_nba_player_id"],
                    "season": r["season"],
                },
            )
        # ever-out no safe — all if manageable
        no_safe_out = [r for r in no_safe if r["ever_out"]]
        for r in no_safe_out if len(no_safe_out) <= 5000 else no_safe_out[:2000]:
            emit(
                "EVER_OUT_NO_SAFE_CANDIDATE",
                {
                    "game_id": r["game_id"],
                    "season": r["season"],
                    "team": r["team_abbreviation"],
                    "player_name_raw": r["player_name_raw"],
                    "et_game_date": r["et_game_date"],
                    "statuses": r["statuses_observed"],
                },
            )
        for g in suffix["collision_groups"]:
            emit("SUFFIX_COLLISION_GROUP", g)

    summary["artifacts"] = {
        "records_gz": str(TMP_RECORDS_GZ.relative_to(ROOT)).replace("\\", "/"),
        "records_gz_sha256": records_sha,
        "records_gz_bytes": records_bytes,
        "records_count": len(combined),
        "anomalies_ndjson": str(anom_path.relative_to(ROOT)).replace("\\", "/"),
        "anomalies_count": anom_n,
    }

    OUT_JSON.write_text(json.dumps(summary, indent=2, default=str) + "\n", encoding="utf-8")

    # Markdown
    lines = [
        "# Official injury-report player identity candidate audit (Phase 4B)",
        "",
        f"Generated: **{summary['generated_at']}**",
        "",
        f"**PLAYER_IDENTITY_CANDIDATE_AUDIT = {audit_gate}**  ",
        f"**F7 = OPEN**  ",
        f"**AS_OF_INJURY_TAPE_CERTIFIED = NO**  ",
        f"**NEXT = {summary['NEXT']}**",
        "",
        "Read-only candidate coverage audit. No resolver. No identity writes. No fuzzy matching.",
        "Primary grain: `official_player_game` = game_id + team_id + player_name_raw.",
        "`ever_Out` is snapshot-sequence metadata — **not** T−60.",
        "",
        "## Population",
        "",
        f"- Target games represented: **{summary['population']['target_games_represented']}**",
        f"- Unique official_player_games: **{summary['population']['unique_official_player_games']}**",
        f"- Certified player observations: **{summary['population']['raw_player_observations_certified']}**",
        f"- Corpus player observations: **{summary['population']['raw_player_observations_corpus']}**",
        f"- Unique raw player names: **{summary['population']['unique_raw_player_names']}**",
        f"- Team-unresolved observations: **{summary['population']['team_unresolved_observations']}**",
        f"- ever-Out / Available / Questionable: **{ever_out_n}** / **{len(ever_avail)}** / **{len(ever_q)}**",
        "",
        "## U5 roster snapshot historical coverage",
        "",
        f"- Snapshot rows in DB: **{u5['snapshot_meta']['total_rows']}**",
        f"- First/last snapshot date: **{u5['snapshot_meta']['first_snapshot_date']}** → **{u5['snapshot_meta']['last_snapshot_date']}**",
        f"- Distinct snapshot dates: **{u5['snapshot_meta']['distinct_snapshot_dates']}**",
        "",
    ]
    for season, a in sorted(u5_assessment.items()):
        lines.append(
            f"- **{season}**: grade=**{a['grade']}** team-games={a['target_team_games']} "
            f"exact={a['exact_date_snapshot']} prior={a['latest_prior_snapshot']} "
            f"none={a['no_prior_snapshot']} median_age={a['median_snapshot_age_days']}"
        )
    lines += [
        "",
        f"U5A classes: `{u5['u5a_counts']}`",
        f"U5B classes: `{u5['u5b_counts']}`",
        f"Bridge classes: `{u5['bridge_counts']}`",
        "",
        "## U4 stints",
        "",
        f"- NBA-backed: `{u4['nba_counts']}`",
        f"- Inferred-PGL: `{u4['inferred_counts']}`",
        f"- Circularity: `{u4_circ}`",
        "",
        "## U2 same-game PGL",
        "",
        f"- All: `{u2['counts']}`",
        f"- ever-Out matrix: `{season_matrix(ever_out, u2_matrix_row)}`",
        f"- ever-Out lost if U2 exclusive: **{lost_if_u2_only:.4f}**",
        f"- U2-missing ever-Out recovery: `{recovery}`",
        "",
        "## Concordance / simulation",
        "",
        f"- Concordance: `{conc_counts}`",
        f"- Simulation: `{sim_counts}`",
        f"- Source conflicts: **{len(conflicts)}**",
        f"- Multiple name candidates: **{len(multiples)}**",
        f"- No safe candidate: **{len(no_safe)}** (ever-Out: **{sum(1 for r in no_safe if r['ever_out'])}**)",
        f"- Canonical identity coverage: **{canonical_cov}** ({canonical_cov/max(len(combined),1):.4f})",
        f"- Serving BDL projection: **{serving_cov}** ({serving_cov/max(len(combined),1):.4f})",
        f"- Entity-only (Class-C-like): **{len(class_c)}**",
        "",
        "## Suffix stripping",
        "",
        f"- Collision groups: **{suffix['collision_group_count']}**",
        f"- Official player-games affected: **{suffix['official_player_games_affected']}**",
        f"- **SUFFIX_STRIPPING_SAFE_FOR_IDENTITY = {suffix['SUFFIX_STRIPPING_SAFE_FOR_IDENTITY']}**",
        "",
        "## Artifacts",
        "",
        f"- Records: `{summary['artifacts']['records_gz']}` SHA-256 `{records_sha}` "
        f"({records_bytes} bytes, {len(combined)} records)",
        f"- Anomalies: `{summary['artifacts']['anomalies_ndjson']}` ({anom_n} rows)",
        "",
        "Join policy / parser / Phase 3D corpus unchanged. No Postgres writes.",
        "",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "PLAYER_IDENTITY_CANDIDATE_AUDIT": audit_gate,
                "F7": "OPEN",
                "opg": len(combined),
                "names": grain_stats["unique_raw_player_names"],
                "u5_assessment": {s: a["grade"] for s, a in u5_assessment.items()},
                "sim": sim_counts,
                "ever_out_u2_miss_rate": round(lost_if_u2_only, 4),
                "suffix_safe": suffix["SUFFIX_STRIPPING_SAFE_FOR_IDENTITY"],
                "NEXT": summary["NEXT"],
            },
            indent=2,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
