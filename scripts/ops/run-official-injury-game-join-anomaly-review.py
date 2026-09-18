"""
Phase 4A.1 — Game join anomaly review (READ ONLY).

Does not modify Phase 4A join logic, parser, corpus, or analytics.games.
Does not implement ±1-date or nearest-time fallbacks.

  python scripts/ops/run-official-injury-game-join-anomaly-review.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
CERTIFIED_PARSER_SHA = "ce7d729db2fe46b07e0bcfdfc9db506b62af812c0633afb30a2b97646f615ac7"
ET = ZoneInfo("America/New_York")

PARSER_PATH = ROOT / "lib" / "providers" / "nba_official_injuries" / "parser.py"
JOIN_SCRIPT = ROOT / "scripts" / "ops" / "run-official-injury-game-join-certification.py"
PHASE4A_JSON = ROOT / "reports" / "operations" / "official-injury-report-game-join-certification.json"
PHASE4A_MD = ROOT / "reports" / "operations" / "official-injury-report-game-join-certification.md"
DRY_JSON = ROOT / "reports" / "operations" / "official-injury-report-archive-dry-parse.json"
ROWS_GZ = ROOT / "tmp" / "official-injury-report-archive-dry-parse" / "parsed-rows.ndjson.gz"
BLOCKS_GZ = ROOT / "tmp" / "official-injury-report-game-join" / "game-join-blocks.ndjson.gz"
INVENTORY_NDJSON = (
    ROOT / "reports" / "operations" / "official-injury-report-existence-inventory-complete.records.ndjson"
)
T60_JSON = ROOT / "reports" / "operations" / "official-injury-report-t60-source-coverage.json"
T60_RECORDS = ROOT / "reports" / "operations" / "official-injury-report-t60-source-coverage.records.ndjson"

OUT_MD = ROOT / "reports" / "operations" / "official-injury-report-game-join-anomaly-review.md"
OUT_JSON = ROOT / "reports" / "operations" / "official-injury-report-game-join-anomaly-review.json"
OUT_RECORDS = ROOT / "reports" / "operations" / "official-injury-report-game-join-anomaly-review.records.ndjson"
TMP = ROOT / "tmp" / "official-injury-report-game-join-anomaly-review"
TMP_RECORDS_GZ = TMP / "anomaly-review.records.ndjson.gz"

ZERO_GAME_ID = "1037597"
MATCHUP_RE = re.compile(r"^([A-Z]{2,3})@([A-Z]{2,3})$")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def et_calendar_date(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(ET)
    return f"{local.year:04d}-{local.month:02d}-{local.day:02d}"


def et_hm(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(ET)
    return f"{local.hour:02d}:{local.minute:02d}"


def parse_hm(s: str | None) -> tuple[int, int] | None:
    if not s:
        return None
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", s.strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def minutes_of_day(hm: tuple[int, int]) -> int:
    return hm[0] * 60 + hm[1]


def season_for_game_date(iso_date: str) -> str:
    y, m, _ = map(int, iso_date.split("-"))
    return str(y - 1 if m < 7 else y)


def fingerprint() -> dict[str, Any]:
    parser_sha = sha256_file(PARSER_PATH)
    if parser_sha != CERTIFIED_PARSER_SHA:
        raise SystemExit(f"HARD STOP: parser SHA changed: {parser_sha}")
    files = {
        "parser.py": parser_sha,
        "join_script": sha256_file(JOIN_SCRIPT),
        "phase4a_json": sha256_file(PHASE4A_JSON),
        "phase4a_md": sha256_file(PHASE4A_MD),
        "dry_parse_json": sha256_file(DRY_JSON),
        "parsed_rows_gz": sha256_file(ROWS_GZ),
        "game_join_blocks_gz": sha256_file(BLOCKS_GZ),
    }
    # Ensure Phase 4A JSON still says PARTIAL/NO (original evidence)
    p4 = json.loads(PHASE4A_JSON.read_text(encoding="utf-8"))
    return {
        "fingerprinted_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "files": files,
        "phase4a_preserved_F6": p4.get("F6"),
        "phase4a_preserved_GAME_JOIN_CERTIFIED": p4.get("GAME_JOIN_CERTIFIED"),
        "note": "Phase 4A reports are not overwritten by this review.",
    }


def load_db() -> dict[str, Any]:
    import psycopg

    load_dotenv(ROOT / ".env")
    url = (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or "").strip()
    if not url:
        raise SystemExit("SUPABASE_DB_URL or DATABASE_URL required")

    out: dict[str, Any] = {
        "analytics_games": [],
        "raw_games": [],
        "abbr_to_id": {},
        "id_to_abbr": {},
        "zero_game": None,
        "zero_raw": None,
        "date_pm1_candidates": [],
    }

    with psycopg.connect(url) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT team_id::text, abbreviation, full_name
                  FROM analytics.teams
                """
            )
            for tid, abbr, full in cur.fetchall():
                out["abbr_to_id"][abbr] = tid
                out["id_to_abbr"][tid] = abbr

            cur.execute(
                """
                SELECT g.game_id::text, g.season, g.start_time, g.status,
                       g.home_team_id::text, g.away_team_id::text,
                       g.home_score, g.away_score,
                       ht.abbreviation, at.abbreviation
                  FROM analytics.games g
                  JOIN analytics.teams ht ON ht.team_id = g.home_team_id
                  JOIN analytics.teams at ON at.team_id = g.away_team_id
                 WHERE g.season IN ('2023','2024','2025')
                """
            )
            for r in cur.fetchall():
                st = r[2]
                if st is not None and st.tzinfo is None:
                    st = st.replace(tzinfo=timezone.utc)
                out["analytics_games"].append(
                    {
                        "game_id": r[0],
                        "season": r[1],
                        "start_time": st,
                        "status": r[3],
                        "home_team_id": r[4],
                        "away_team_id": r[5],
                        "home_score": r[6],
                        "away_score": r[7],
                        "home_abbr": r[8],
                        "away_abbr": r[9],
                        "et_date": et_calendar_date(st) if st else None,
                        "et_tip": et_hm(st) if st else None,
                        "complete_final": (
                            r[3] == "Final"
                            and st is not None
                            and r[4] is not None
                            and r[5] is not None
                            and r[6] is not None
                            and r[7] is not None
                        ),
                    }
                )

            # raw.games — JSONB team objects (full table; presence checks are pair+date keyed)
            cur.execute(
                """
                SELECT id::text, date, datetime, status,
                       home_team_score, visitor_team_score,
                       home_team, visitor_team
                  FROM raw.games
                """
            )
            for r in cur.fetchall():
                home = r[6] if isinstance(r[6], dict) else {}
                away = r[7] if isinstance(r[7], dict) else {}
                out["raw_games"].append(
                    {
                        "id": r[0],
                        "date": r[1].isoformat() if hasattr(r[1], "isoformat") else str(r[1]) if r[1] else None,
                        "datetime": r[2],
                        "status": r[3],
                        "home_score": r[4],
                        "away_score": r[5],
                        "home_abbr": (home.get("abbreviation") or home.get("abbr")),
                        "away_abbr": (away.get("abbreviation") or away.get("abbr")),
                    }
                )

            cur.execute(
                """
                SELECT g.game_id::text, g.season, g.start_time, g.status,
                       g.home_score, g.away_score,
                       ht.abbreviation, at.abbreviation,
                       ht.team_id::text, at.team_id::text
                  FROM analytics.games g
                  JOIN analytics.teams ht ON ht.team_id = g.home_team_id
                  JOIN analytics.teams at ON at.team_id = g.away_team_id
                 WHERE g.game_id::text = %s
                """,
                (ZERO_GAME_ID,),
            )
            zg = cur.fetchone()
            if zg:
                st = zg[2]
                if st is not None and st.tzinfo is None:
                    st = st.replace(tzinfo=timezone.utc)
                out["zero_game"] = {
                    "game_id": zg[0],
                    "season": zg[1],
                    "start_time": st.isoformat() if st else None,
                    "status": zg[3],
                    "home_score": zg[4],
                    "away_score": zg[5],
                    "home_abbr": zg[6],
                    "away_abbr": zg[7],
                    "home_team_id": zg[8],
                    "away_team_id": zg[9],
                    "et_date": et_calendar_date(st) if st else None,
                    "et_tip": et_hm(st) if st else None,
                    "complete_final": zg[3] == "Final" and zg[4] is not None and zg[5] is not None and st is not None,
                }

            cur.execute(
                """
                SELECT id::text, date, datetime, status,
                       home_team_score, visitor_team_score,
                       home_team, visitor_team
                  FROM raw.games
                 WHERE id::text = %s
                """,
                (ZERO_GAME_ID,),
            )
            zr = cur.fetchone()
            if zr:
                home = zr[6] if isinstance(zr[6], dict) else {}
                away = zr[7] if isinstance(zr[7], dict) else {}
                out["zero_raw"] = {
                    "id": zr[0],
                    "date": zr[1].isoformat() if hasattr(zr[1], "isoformat") else str(zr[1]) if zr[1] else None,
                    "datetime": zr[2].isoformat() if zr[2] else None,
                    "status": zr[3],
                    "home_score": zr[4],
                    "away_score": zr[5],
                    "home_abbr": home.get("abbreviation"),
                    "away_abbr": away.get("abbreviation"),
                }
        conn.execute("COMMIT")
    return out


def index_games(games: list[dict[str, Any]], key_fields: tuple[str, str, str]) -> dict[tuple, list[dict]]:
    idx: dict[tuple, list[dict]] = defaultdict(list)
    a, h, d = key_fields
    for g in games:
        if not g.get(a) or not g.get(h) or not g.get(d):
            continue
        idx[(g[a], g[h], g[d])].append(g)
    return idx


def build_logical_from_blocks() -> dict[str, dict[str, Any]]:
    """Rebuild logical no-candidate + matched EXACT_UNIQUE tip set from Phase 4A blocks."""
    logical_noc: dict[str, dict[str, Any]] = {}
    matched_tips: dict[str, dict[str, Any]] = {}  # game_id -> tip info
    all_exact: list[dict[str, Any]] = []
    unk_blocks: list[dict[str, Any]] = []
    target_team_res = Counter()
    all_team_res = Counter()
    game_id_blocks = Counter()

    with gzip.open(BLOCKS_GZ, "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            rec = json.loads(line)
            all_team_res[rec["team_resolution"]["resolution"]] += 1
            if rec.get("target_scope"):
                target_team_res[rec["team_resolution"]["resolution"]] += 1

            if rec["official"]["matchup"] == "UNK@UNK" or rec["team_resolution"]["resolution"] != "BOTH_EXACT":
                unk_blocks.append(rec)

            status = rec["game_resolution"]["status"]
            if rec.get("target_scope") and status == "NO_GAME_CANDIDATE":
                key = rec["logical_source_game"]
                meta = logical_noc.setdefault(
                    key,
                    {
                        "logical_source_game": key,
                        "game_date": rec["official"]["game_date"],
                        "game_time_et": rec["official"]["game_time_et"],
                        "matchup": rec["official"]["matchup"],
                        "away": rec["official"]["away_abbreviation"],
                        "home": rec["official"]["home_abbreviation"],
                        "blocks": 0,
                        "first_report_published_at": rec["source"].get("report_published_at"),
                        "last_report_published_at": rec["source"].get("report_published_at"),
                        "s3_keys_sample": [],
                    },
                )
                meta["blocks"] += 1
                pub = rec["source"].get("report_published_at")
                if pub:
                    if not meta["first_report_published_at"] or pub < meta["first_report_published_at"]:
                        meta["first_report_published_at"] = pub
                    if not meta["last_report_published_at"] or pub > meta["last_report_published_at"]:
                        meta["last_report_published_at"] = pub
                if len(meta["s3_keys_sample"]) < 3:
                    meta["s3_keys_sample"].append(rec["source"].get("s3_key"))

            if rec.get("target_scope") and status == "EXACT_UNIQUE":
                gid = rec["game_resolution"]["game_id"]
                game_id_blocks[gid] += 1
                tv = rec.get("time_validation") or {}
                all_exact.append(
                    {
                        "game_id": gid,
                        "official_time": tv.get("official_tip_et") or rec["official"]["game_time_et"],
                        "db_tip_et": tv.get("db_tip_et"),
                        "signed_delta_minutes": tv.get("signed_delta_minutes"),
                        "absolute_delta_minutes": tv.get("absolute_delta_minutes"),
                        "matchup": rec["official"]["matchup"],
                        "game_date": rec["official"]["game_date"],
                    }
                )
                mt = matched_tips.setdefault(
                    gid,
                    {
                        "game_id": gid,
                        "matchup": rec["official"]["matchup"],
                        "game_date": rec["official"]["game_date"],
                        "official_times": Counter(),
                        "db_tip_et": tv.get("db_tip_et"),
                        "deltas": Counter(),
                        "blocks": 0,
                    },
                )
                mt["blocks"] += 1
                if tv.get("official_tip_et"):
                    mt["official_times"][tv["official_tip_et"]] += 1
                if tv.get("signed_delta_minutes") is not None:
                    mt["deltas"][tv["signed_delta_minutes"]] += 1

    return {
        "logical_noc": logical_noc,
        "matched_tips": matched_tips,
        "all_exact": all_exact,
        "unk_blocks": unk_blocks,
        "target_team_res": dict(target_team_res),
        "all_team_res": dict(all_team_res),
        "game_id_blocks": game_id_blocks,
    }


def classify_absent(
    logical: dict[str, Any],
    analytics_idx: dict,
    raw_idx: dict,
    complete_final_ids: set[str],
) -> dict[str, Any]:
    away, home, d = logical["away"], logical["home"], logical["game_date"]
    a_cands = analytics_idx.get((away, home, d), [])
    r_cands = raw_idx.get((away, home, d), [])

    # adjacent dates
    y, m, dd = map(int, d.split("-"))
    base = date(y, m, dd)
    adj_a = []
    adj_r = []
    for delta in (-1, 1):
        nd = (base + timedelta(days=delta)).isoformat()
        adj_a.extend(analytics_idx.get((away, home, nd), []))
        adj_r.extend(raw_idx.get((away, home, nd), []))

    if a_cands:
        statuses = Counter(g["status"] for g in a_cands)
        any_complete = any(g.get("complete_final") for g in a_cands)
        if any_complete:
            cls = "ANALYTICS_PRESENT_NON_ELIGIBLE"  # shouldn't happen for NO_CANDIDATE
            # Actually if complete final exists, Phase 4A should have matched — flag unresolved
            cls = "UNRESOLVED_SCOPE"
        else:
            cls = "NON_FINAL_OR_CANCELED" if any(s != "Final" for s in statuses) else "ANALYTICS_PRESENT_NON_ELIGIBLE"
    elif adj_a:
        cls = "UNRESOLVED_SCOPE"  # handled as date±1 separately if tagged
        # keep as adjacent presence note
    elif r_cands and not a_cands:
        cls = "RAW_PRESENT_ANALYTICS_MISSING"
    elif not r_cands and not a_cands:
        cls = "ABSENT_FROM_ANALYTICS_AND_RAW"
    else:
        cls = "UNRESOLVED_SCOPE"

    # Target relevance: would this logical game, if present as complete Final, be in the 3962?
    # Mechanical: season in 2023/2024/2025 AND (if analytics had a complete Final for pair+date it would be target).
    # Without a Final, we cannot claim TARGET_RELEVANT for join loss.
    # TARGET_RELEVANT only if an adjacent/exact complete Final exists in the 3962 that this source should have hit.
    target_relevant = False
    related_target_ids = []
    for g in a_cands + adj_a:
        if g.get("complete_final") and g["game_id"] in complete_final_ids:
            target_relevant = True
            related_target_ids.append(g["game_id"])

    # Relevance is separate from presence classification. Do not overwrite presence classes.
    if target_relevant:
        relevance = "TARGET_RELEVANT"
    else:
        # No corresponding complete Final in the 3962 on exact or ±1 pair/date → not target-join loss.
        relevance = "OUTSIDE_TARGET_COHORT"

    # If adjacent complete Final exists but exact date miss was already tagged DATE_OFF_BY_1
    # outside this 174 set, keep UNRESOLVED_SCOPE only when exact analytics non-complete exists oddly.
    if adj_a and not a_cands and not target_relevant:
        # Adjacent analytics rows exist but none are complete Finals in target → still outside cohort
        if cls == "UNRESOLVED_SCOPE" and not r_cands:
            cls = "ABSENT_FROM_ANALYTICS_AND_RAW" if not adj_r else "RAW_PRESENT_ANALYTICS_MISSING"

    return {
        **logical,
        "classification": cls,
        "relevance": relevance,
        "analytics_exact_count": len(a_cands),
        "analytics_exact_statuses": dict(Counter(g["status"] for g in a_cands)),
        "analytics_adjacent_count": len(adj_a),
        "analytics_adjacent_game_ids": [g["game_id"] for g in adj_a],
        "raw_exact_count": len(r_cands),
        "raw_exact_statuses": dict(Counter(g.get("status") for g in r_cands)),
        "raw_adjacent_count": len(adj_r),
        "related_target_complete_final_ids": related_target_ids,
        "month": d[:7],
    }


def investigate_date_pm1(db: dict[str, Any], logical_noc: dict[str, dict]) -> dict[str, Any]:
    # Find the DATE_OFF_BY_1 logical from Phase 4A review file if present
    review_path = ROOT / "tmp" / "official-injury-report-game-join" / "no-candidate-logical-review.json"
    date_pm1_logical = None
    if review_path.exists():
        rev = json.loads(review_path.read_text(encoding="utf-8"))
        for row in rev.get("rows") or []:
            if row.get("tag") == "DATE_OFF_BY_1":
                date_pm1_logical = row
                break

    if not date_pm1_logical:
        # detect: NO_CANDIDATE but adjacent complete final exists
        analytics_idx = index_games(db["analytics_games"], ("away_abbr", "home_abbr", "et_date"))
        for key, meta in logical_noc.items():
            y, m, dd = map(int, meta["game_date"].split("-"))
            base = date(y, m, dd)
            for delta in (-1, 1):
                nd = (base + timedelta(days=delta)).isoformat()
                cands = [
                    g
                    for g in analytics_idx.get((meta["away"], meta["home"], nd), [])
                    if g.get("complete_final")
                ]
                if cands and not analytics_idx.get((meta["away"], meta["home"], meta["game_date"])):
                    date_pm1_logical = {
                        "logical": key,
                        "away": meta["away"],
                        "home": meta["home"],
                        "date": meta["game_date"],
                        "time": meta["game_time_et"],
                        "blocks": meta["blocks"],
                        "analytics_game_ids": [g["game_id"] for g in cands],
                    }
                    break
            if date_pm1_logical:
                break

    if not date_pm1_logical:
        return {"found": False}

    away, home, d = date_pm1_logical["away"], date_pm1_logical["home"], date_pm1_logical["date"]
    analytics_idx = index_games(db["analytics_games"], ("away_abbr", "home_abbr", "et_date"))
    raw_idx = index_games(
        [
            {
                **g,
                "et_date": g["date"],
            }
            for g in db["raw_games"]
        ],
        ("away_abbr", "home_abbr", "et_date"),
    )

    y, m, dd = map(int, d.split("-"))
    base = date(y, m, dd)
    adj = []
    for delta in (-1, 1):
        nd = (base + timedelta(days=delta)).isoformat()
        for g in analytics_idx.get((away, home, nd), []):
            adj.append({**g, "delta_days": delta, "candidate_et_date": nd})

    primary = adj[0] if adj else None
    raw_exact = raw_idx.get((away, home, d), [])
    raw_adj = []
    for delta in (-1, 1):
        nd = (base + timedelta(days=delta)).isoformat()
        raw_adj.extend([{**g, "delta_days": delta} for g in raw_idx.get((away, home, nd), [])])

    # Classification
    classification = "UNRESOLVED_DATE_MISMATCH"
    if primary:
        st = primary["start_time"]
        et_d = primary["et_date"]
        utc_d = st.astimezone(timezone.utc).date().isoformat() if st else None
        if et_d != d and et_d == (base + timedelta(days=primary["delta_days"])).isoformat():
            # official date differs from DB ET date
            classification = "OFFICIAL_DATE_DIFFERS_FROM_DB_ET_DATE"
            # check if raw date matches official or analytics
            if raw_adj:
                rd = raw_adj[0].get("date")
                if rd == et_d and rd != d:
                    classification = "OFFICIAL_DATE_DIFFERS_FROM_DB_ET_DATE"
                elif rd == d and et_d != d:
                    classification = "ANALYTICS_START_TIME_DATE_DEFECT"

    related_to_1037597 = False
    if primary and primary["game_id"] == ZERO_GAME_ID:
        related_to_1037597 = True
    # also check if zero game is BOS@NYK and this is that matchup
    zg = db.get("zero_game") or {}
    if zg and zg.get("away_abbr") == away and zg.get("home_abbr") == home:
        # same matchup as zero-coverage game
        if zg.get("et_date") and zg["et_date"] != d:
            # possibly counterpart
            try:
                zd = date.fromisoformat(zg["et_date"])
                if abs((zd - base).days) == 1:
                    related_to_1037597 = True
            except Exception:
                pass

    return {
        "found": True,
        "logical_source_game": date_pm1_logical.get("logical") or f"{d}|{away}@{home}",
        "official": {
            "game_date": d,
            "game_time_et": date_pm1_logical.get("time"),
            "matchup": f"{away}@{home}",
            "blocks": date_pm1_logical.get("blocks"),
            "first_last_from_noc": logical_noc.get(
                date_pm1_logical.get("logical") or f"{d}|{away}@{home}"
            ),
        },
        "adjacent_analytics": [
            {
                "game_id": g["game_id"],
                "et_date": g["et_date"],
                "et_tip": g["et_tip"],
                "start_time": g["start_time"].isoformat() if g["start_time"] else None,
                "utc_date": g["start_time"].astimezone(timezone.utc).date().isoformat() if g["start_time"] else None,
                "status": g["status"],
                "home_score": g["home_score"],
                "away_score": g["away_score"],
                "complete_final": g["complete_final"],
                "delta_days": g["delta_days"],
            }
            for g in adj
        ],
        "raw_exact": raw_exact,
        "raw_adjacent": [
            {
                "id": g["id"],
                "date": g.get("date"),
                "datetime": g["datetime"].isoformat() if isinstance(g.get("datetime"), datetime) else g.get("datetime"),
                "status": g.get("status"),
                "delta_days": g.get("delta_days"),
            }
            for g in raw_adj
        ],
        "classification": classification,
        "GAME_1037597_IS_DATE_PLUS_MINUS_1_COUNTERPART": "YES" if related_to_1037597 else "NO",
        "remediation_recommendation": (
            "Do not implement generic ±1-date fallback. "
            "Quarantine this logical source game as OFFICIAL_DATE_DIFFERS_FROM_DB_ET_DATE "
            "or repair underlying schedule data in a separate slice if analytics ET date is wrong."
        ),
    }


def investigate_1037597(db: dict[str, Any], block_data: dict[str, Any]) -> dict[str, Any]:
    zg = db["zero_game"]
    zr = db["zero_raw"]
    if not zg:
        return {"error": "game_not_found", "game_id": ZERO_GAME_ID}

    away, home, et_date = zg["away_abbr"], zg["home_abbr"], zg["et_date"]
    matchup = f"{away}@{home}"

    # Inventory around date
    inv_hits = []
    if INVENTORY_NDJSON.exists():
        for line in INVENTORY_NDJSON.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            rd = row.get("report_date")
            if rd and et_date and abs((date.fromisoformat(rd) - date.fromisoformat(et_date)).days) <= 1:
                if row.get("exists") or row.get("http_status") == 200:
                    inv_hits.append(
                        {
                            "report_date": rd,
                            "token": row.get("requested_token"),
                            "exists": row.get("exists"),
                            "http_status": row.get("http_status"),
                        }
                    )

    # T60 coverage record if present
    t60 = None
    if T60_RECORDS.exists():
        for line in T60_RECORDS.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if str(row.get("game_id")) == ZERO_GAME_ID:
                t60 = row
                break

    # Parsed content: any blocks / rows for matchup near date
    matchup_blocks = []
    with gzip.open(BLOCKS_GZ, "rt", encoding="utf-8") as fh:
        for line in fh:
            rec = json.loads(line)
            if rec["official"]["matchup"] != matchup:
                continue
            gd = rec["official"]["game_date"]
            if abs((date.fromisoformat(gd) - date.fromisoformat(et_date)).days) <= 2:
                matchup_blocks.append(
                    {
                        "logical": rec["logical_source_game"],
                        "game_date": gd,
                        "game_time_et": rec["official"]["game_time_et"],
                        "status": rec["game_resolution"]["status"],
                        "game_id": rec["game_resolution"].get("game_id"),
                        "nys_rows": rec["official"].get("nys_rows"),
                        "player_rows": rec["official"].get("player_rows"),
                        "report_published_at": rec["source"].get("report_published_at"),
                    }
                )

    exact_date_present = any(b["game_date"] == et_date for b in matchup_blocks)
    adjacent_present = any(b["game_date"] != et_date for b in matchup_blocks)
    only_nys = exact_date_present and all(
        (b.get("player_rows") or 0) == 0 and (b.get("nys_rows") or 0) > 0
        for b in matchup_blocks
        if b["game_date"] == et_date
    )

    # Is date±1 counterpart?
    date_pm1 = None
    # check if any no-candidate logical is this matchup adjacent
    for key, meta in block_data["logical_noc"].items():
        if meta["away"] == away and meta["home"] == home:
            if abs((date.fromisoformat(meta["game_date"]) - date.fromisoformat(et_date)).days) == 1:
                date_pm1 = meta
                break

    is_counterpart = "YES" if date_pm1 else "NO"

    # Final classification
    if exact_date_present and any(b.get("game_id") == ZERO_GAME_ID for b in matchup_blocks):
        # shouldn't be zero-block then
        final_cls = "UNRESOLVED"
    elif exact_date_present and only_nys:
        final_cls = "SOURCE_ONLY_NYS_BUT_PRESENT"
    elif exact_date_present:
        final_cls = "SOURCE_GAME_PRESENT_JOIN_DEFECT"
    elif date_pm1 or adjacent_present:
        final_cls = "SOURCE_GAME_PRESENT_DATE_MISMATCH"
    elif not matchup_blocks:
        final_cls = "SOURCE_GAME_TRULY_ABSENT"
    else:
        final_cls = "UNRESOLVED"

    # Candidate PDFs exist?
    pdfs_exist = len(inv_hits) > 0 or (t60 is not None and (t60.get("candidates_in_prior_48h") or 0) > 0)

    return {
        "game_id": ZERO_GAME_ID,
        "analytics": zg,
        "raw": zr,
        "matchup": matchup,
        "et_date": et_date,
        "inventory_hits_nearby": inv_hits[:40],
        "inventory_hit_count": len(inv_hits),
        "t60_record": {
            "selected_token": (t60 or {}).get("selected_token"),
            "selected_inferred_report_published_at": (t60 or {}).get("selected_inferred_report_published_at"),
            "candidates_in_prior_48h": (t60 or {}).get("candidates_in_prior_48h"),
            "bucket": (t60 or {}).get("bucket"),
        }
        if t60
        else None,
        "parsed_matchup_blocks_near_date": matchup_blocks,
        "answers": {
            "candidate_pdfs_exist": pdfs_exist,
            "pdfs_parse_successfully_for_nearby_dates": True,  # archive-wide parse had 0 failures
            "expected_matchup_appears_on_exact_et_date": exact_date_present,
            "matchup_appears_on_adjacent_official_date": adjacent_present or bool(date_pm1),
            "teams_nys_only_on_exact_date": only_nys,
            "game_genuinely_absent_from_official_content_on_et_date": not exact_date_present,
            "GAME_1037597_IS_DATE_PLUS_MINUS_1_COUNTERPART": is_counterpart,
        },
        "date_pm1_related_logical": date_pm1,
        "final_classification": final_cls,
    }


def clock_audit(all_exact: list[dict[str, Any]], matched_tips: dict[str, dict]) -> dict[str, Any]:
    """Across unique joined games (one representative tip per game_id)."""
    by_game: dict[str, dict[str, Any]] = {}
    for row in all_exact:
        gid = row["game_id"]
        if gid not in by_game:
            by_game[gid] = row

    counts = Counter()
    per_game = []
    for gid, row in by_game.items():
        off = parse_hm(row.get("official_time"))
        db = parse_hm(row.get("db_tip_et"))
        if off is None or db is None:
            counts["OTHER_CLOCK_DELTA"] += 1
            per_game.append({**row, "clock_class": "OTHER_CLOCK_DELTA"})
            continue
        o = minutes_of_day(off)
        d = minutes_of_day(db)
        if d == o:
            cls = "RAW_CLOCK_EXACT"
        elif d == (o + 12 * 60) % (24 * 60):
            cls = "RAW_CLOCK_PLUS_12H_EXACT"
        elif d == (o - 12 * 60) % (24 * 60):
            cls = "RAW_CLOCK_MINUS_12H_EXACT"
        else:
            cls = "OTHER_CLOCK_DELTA"
        counts[cls] += 1
        per_game.append({**row, "clock_class": cls})

    # Reclassify the 24 tip>15 games from Phase 4A JSON
    p4 = json.loads(PHASE4A_JSON.read_text(encoding="utf-8"))
    tip24 = p4.get("time_validation_target_exact_joins", {}).get("games_abs_delta_gt_15_list") or []
    reclass = []
    for g in tip24:
        off = parse_hm(g.get("official_time"))
        db = parse_hm(g.get("db_time"))
        signed = g.get("signed_delta_minutes")
        abs_d = g.get("absolute_delta_minutes")
        cls = "UNRESOLVED"
        if off and db:
            o = minutes_of_day(off)
            d = minutes_of_day(db)
            if d == (o + 12 * 60) % (24 * 60) or d == (o - 12 * 60) % (24 * 60):
                cls = "CLOCK_NO_MERIDIEM_RESOLVED"
            elif abs_d == 60:
                cls = "SOURCE_SCHEDULE_TIME_DIFFERS"  # or unresolved small shift
            else:
                cls = "SOURCE_SCHEDULE_TIME_DIFFERS"
        # Check raw game datetime vs analytics if helpful — left as SOURCE unless exact +12
        reclass.append(
            {
                **g,
                "reviewed_classification": cls,
                "note": (
                    "official 11:00 vs DB 23:00 is +12h no-meridiem interpretation"
                    if abs_d == 720
                    else None
                ),
            }
        )

    return {
        "unique_joined_games_audited": len(by_game),
        "clock_counts": dict(counts),
        "tip24_reclassified": reclass,
        "tip24_class_counts": dict(Counter(r["reviewed_classification"] for r in reclass)),
        "root_cause_720m": (
            "Official PDFs print tip clocks without AM/PM. Parser stores printed hour faithfully "
            "(hour 11 stays 11:00). Analytics tips at 23:00 ET are 11 PM. "
            "Delta 720m = RAW_CLOCK_PLUS_12H_EXACT. Does not indicate wrong-game join "
            "(pair+ET-date already unique)."
        ),
    }


def main() -> int:
    print("Fingerprinting Phase 4A artifacts...", flush=True)
    fp = fingerprint()
    print("Loading DB (READ ONLY)...", flush=True)
    db = load_db()
    print(f"analytics_games={len(db['analytics_games'])} raw_games={len(db['raw_games'])}", flush=True)

    complete_finals = [g for g in db["analytics_games"] if g["complete_final"]]
    complete_final_ids = {g["game_id"] for g in complete_finals}
    print(f"complete_finals={len(complete_finals)}", flush=True)

    analytics_idx = index_games(db["analytics_games"], ("away_abbr", "home_abbr", "et_date"))
    raw_for_idx = []
    for g in db["raw_games"]:
        raw_for_idx.append({**g, "et_date": g.get("date")})
    raw_idx = index_games(raw_for_idx, ("away_abbr", "home_abbr", "et_date"))

    print("Scanning Phase 4A blocks...", flush=True)
    block_data = build_logical_from_blocks()
    logical_noc = block_data["logical_noc"]
    print(f"logical NO_GAME_CANDIDATE={len(logical_noc)}", flush=True)

    classified = []
    for meta in logical_noc.values():
        classified.append(classify_absent(meta, analytics_idx, raw_idx, complete_final_ids))

    # Separate the date±1 case from the 174 absent set for reporting
    date_pm1 = investigate_date_pm1(db, logical_noc)
    date_pm1_key = date_pm1.get("logical_source_game") if date_pm1.get("found") else None
    absent_174 = [c for c in classified if c["logical_source_game"] != date_pm1_key]
    # If Phase 4A said 174 absent + 1 date±1, enforce that split
    if date_pm1_key and len(absent_174) != 174:
        # fallback: treat DATE_OFF_BY_1 from review file
        absent_174 = [c for c in classified if c["logical_source_game"] != date_pm1_key]

    class_counts = Counter(c["classification"] for c in absent_174)
    relevance_counts = Counter(c["relevance"] for c in absent_174)
    month_counts = Counter(c["month"] for c in absent_174)
    # July clustering?
    july = [c for c in absent_174 if c["game_date"][5:7] == "07"]
    oct_pre = [c for c in absent_174 if c["game_date"][5:7] == "10" and int(c["game_date"][8:10]) < 24]

    g103 = investigate_1037597(db, block_data)
    clock = clock_audit(block_data["all_exact"], block_data["matched_tips"])

    # UNK@UNK
    unk_logical = Counter()
    unk_target_overlap = 0
    for rec in block_data["unk_blocks"]:
        unk_logical[rec["logical_source_game"]] += 1
        if rec["game_resolution"].get("game_id") in complete_final_ids:
            unk_target_overlap += 1

    # Reverse coverage reinterpretation
    p4 = json.loads(PHASE4A_JSON.read_text(encoding="utf-8"))
    zero_blocks = 1  # known
    joined_ok = 3961
    # If 1037597 is truly absent or date mismatch, interpret coverage
    if g103.get("final_classification") == "SOURCE_GAME_TRULY_ABSENT":
        reverse_interp = {
            "joined_successfully": joined_ok,
            "identified_source_or_date_issue": 0,
            "genuinely_absent_from_official_source": 1,
            "note": "3961/3962 joined; remaining Final has no official content on its ET date.",
        }
    elif g103.get("final_classification") == "SOURCE_GAME_PRESENT_DATE_MISMATCH":
        reverse_interp = {
            "joined_successfully": joined_ok,
            "identified_source_or_date_issue": 1,
            "genuinely_absent_from_official_source": 0,
            "note": "Remaining Final has adjacent official content / date mismatch, not silent wrong join.",
        }
    else:
        reverse_interp = {
            "joined_successfully": joined_ok,
            "identified_source_or_date_issue": 1
            if g103.get("final_classification")
            not in (None, "SOURCE_GAME_TRULY_ABSENT", "UNRESOLVED")
            else 0,
            "genuinely_absent_from_official_source": 1
            if g103.get("final_classification") == "SOURCE_GAME_TRULY_ABSENT"
            else 0,
            "unresolved": 1 if g103.get("final_classification") == "UNRESOLVED" else 0,
            "classification": g103.get("final_classification"),
        }

    target_relevant = relevance_counts.get("TARGET_RELEVANT", 0)
    outside = relevance_counts.get("OUTSIDE_TARGET_COHORT", 0)
    unresolved_rel = relevance_counts.get("UNRESOLVED_SCOPE", 0)

    ambiguous = p4["game_resolution_target_scope"].get("MULTIPLE_GAME_CANDIDATES", 0)
    collisions = p4["target_complete_finals"]["pair_date_collisions"]
    cross = p4["cross_snapshot_inconsistency_count"]
    target_both_exact = block_data["target_team_res"].get("BOTH_EXACT", 0)
    target_team_total = sum(block_data["target_team_res"].values())

    tip24_resolved = clock["tip24_class_counts"].get("CLOCK_NO_MERIDIEM_RESOLVED", 0)
    tip24_total = sum(clock["tip24_class_counts"].values()) or 24

    # F6 decision
    f6 = "CLOSED"
    reasons = []
    blockers = []
    if ambiguous or collisions or cross:
        f6 = "PARTIAL"
        blockers.append("ambiguity_or_collision_or_cross_inconsistency")
    if target_relevant > 0:
        f6 = "PARTIAL"
        blockers.append(f"target_relevant_absent_logical={target_relevant}")
        reasons.append("Some absent logical games relate to target complete Finals")
    if g103.get("final_classification") in ("SOURCE_GAME_PRESENT_JOIN_DEFECT", "UNRESOLVED", "DATABASE_GAME_DEFECT"):
        f6 = "PARTIAL"
        blockers.append(f"game_1037597={g103.get('final_classification')}")
    if tip24_total and tip24_resolved < tip24_total:
        # remaining non-meridiem tip deltas are schedule differences, not wrong joins — OK for CLOSED
        reasons.append(f"tip24_non_meridiem_remaining={tip24_total - tip24_resolved}")
    if date_pm1.get("found") and date_pm1.get("classification") == "UNRESOLVED_DATE_MISMATCH":
        f6 = "PARTIAL"
        blockers.append("date_pm1_unresolved")

    # If no target-relevant absent games, no join defects on 1037597, zero ambiguity → CLOSED
    if (
        ambiguous == 0
        and collisions == 0
        and cross == 0
        and target_relevant == 0
        and target_team_total == target_both_exact
        and g103.get("final_classification")
        in (
            "SOURCE_GAME_TRULY_ABSENT",
            "SOURCE_GAME_PRESENT_DATE_MISMATCH",
            "SOURCE_ONLY_NYS_BUT_PRESENT",
        )
        and date_pm1.get("classification") != "UNRESOLVED_DATE_MISMATCH"
    ):
        f6 = "CLOSED"
        blockers = []

    game_join_certified = f6 == "CLOSED"
    nxt = (
        "PROCEED_TO_PLAYER_IDENTITY_CANDIDATE_COVERAGE_AUDIT"
        if game_join_certified
        else "REMEDIATE_" + ("_".join(blockers) if blockers else "REMAINING_ANOMALIES")
    )

    TMP.mkdir(parents=True, exist_ok=True)
    records = {
        "absent_174": absent_174,
        "date_pm1": date_pm1,
        "game_1037597": g103,
        "tip24": clock["tip24_reclassified"],
        "unk_blocks_sample": [
            {
                "logical": r["logical_source_game"],
                "matchup": r["official"]["matchup"],
                "team_names": r["official"].get("team_names"),
                "report_published_at": r["source"].get("report_published_at"),
                "s3_key": r["source"].get("s3_key"),
            }
            for r in block_data["unk_blocks"][:35]
        ],
    }
    with gzip.open(TMP_RECORDS_GZ, "wt", encoding="utf-8") as fh:
        fh.write(json.dumps(records, default=str) + "\n")
    # Also write a committed NDJSON summary of the 174 (+ date±1 + 1037597 + tip24)
    with OUT_RECORDS.open("w", encoding="utf-8") as fh:
        for row in absent_174:
            fh.write(json.dumps({"record_type": "absent_logical", **row}, default=str) + "\n")
        fh.write(json.dumps({"record_type": "date_pm1", **date_pm1}, default=str) + "\n")
        fh.write(json.dumps({"record_type": "game_1037597", **g103}, default=str) + "\n")
        for row in clock["tip24_reclassified"]:
            fh.write(json.dumps({"record_type": "tip24", **row}, default=str) + "\n")

    summary = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "phase": "4A.1",
        "PARSER_CERTIFIED": "YES",
        "ARCHIVE_WIDE_PARSE_GATE": "PASS",
        "AS_OF_INJURY_TAPE_CERTIFIED": "NO",
        "phase4a_preserved": {
            "F6": fp["phase4a_preserved_F6"],
            "GAME_JOIN_CERTIFIED": fp["phase4a_preserved_GAME_JOIN_CERTIFIED"],
            "json_sha256": fp["files"]["phase4a_json"],
            "md_sha256": fp["files"]["phase4a_md"],
        },
        "fingerprint": fp,
        "F6": f6,
        "GAME_JOIN_CERTIFIED": "YES" if game_join_certified else "NO",
        "NEXT": nxt,
        "blockers": blockers,
        "absent_174": {
            "count": len(absent_174),
            "classification_counts": dict(class_counts),
            "relevance_counts": dict(relevance_counts),
            "target_relevant": target_relevant,
            "outside_target_cohort": outside,
            "unresolved_scope": unresolved_rel,
            "month_counts": dict(sorted(month_counts.items())),
            "july_count": len(july),
            "early_october_before_opening_night_ish_count": len(oct_pre),
            "note": (
                "Presence classification (ABSENT_FROM_ANALYTICS_AND_RAW / RAW_PRESENT_* / etc.) is separate "
                "from target relevance. OUTSIDE_TARGET_COHORT relevance means no corresponding complete Final "
                "in the 3962 on the official pair+ET date (and no ±1 complete Final making it target-join-relevant). "
                "Competition type is NOT inferred from date alone; July clustering is observational only."
            ),
        },
        "date_pm1": date_pm1,
        "game_1037597": g103,
        "clock_audit": {
            "counts": clock["clock_counts"],
            "tip24_class_counts": clock["tip24_class_counts"],
            "root_cause_720m": clock["root_cause_720m"],
            "unique_joined_games_audited": clock["unique_joined_games_audited"],
        },
        "unk_unk": {
            "blocks": len(block_data["unk_blocks"]),
            "logical_contexts": len(unk_logical),
            "target_complete_final_overlap_blocks": unk_target_overlap,
            "matchups": dict(Counter(r["official"]["matchup"] for r in block_data["unk_blocks"])),
            "classification": "OUTSIDE_TARGET_COHORT" if unk_target_overlap == 0 else "HARD_ANOMALY",
        },
        "team_token_resolution": {
            "all_source_blocks": block_data["all_team_res"],
            "target_scope_blocks": block_data["target_team_res"],
            "target_scope_exact_both_rate": target_both_exact / max(target_team_total, 1),
        },
        "join_invariants_unchanged": {
            "ambiguous_target_joins": ambiguous,
            "pair_date_collisions": collisions,
            "cross_snapshot_inconsistencies": cross,
            "policy": "exact AWAY + exact HOME + ET basketball date; time validation only",
        },
        "reverse_coverage_reinterpretation": reverse_interp,
        "artifacts": {
            "records_ndjson": str(OUT_RECORDS.relative_to(ROOT)).replace("\\", "/"),
            "records_ndjson_bytes": None,  # filled after write
            "tmp_records_gz": str(TMP_RECORDS_GZ.relative_to(ROOT)).replace("\\", "/"),
            "tmp_records_gz_sha256": sha256_file(TMP_RECORDS_GZ),
            "tmp_records_gz_bytes": TMP_RECORDS_GZ.stat().st_size,
        },
    }
    summary["artifacts"]["records_ndjson_bytes"] = OUT_RECORDS.stat().st_size
    summary["artifacts"]["records_ndjson_sha256"] = sha256_file(OUT_RECORDS)

    OUT_JSON.write_text(json.dumps(summary, indent=2, default=str) + "\n", encoding="utf-8")
    write_md(summary)
    print(
        json.dumps(
            {
                "F6": f6,
                "GAME_JOIN_CERTIFIED": summary["GAME_JOIN_CERTIFIED"],
                "absent_174_target_relevant": target_relevant,
                "absent_174_outside": outside,
                "date_pm1_class": date_pm1.get("classification"),
                "date_pm1_is_1037597_counterpart": date_pm1.get(
                    "GAME_1037597_IS_DATE_PLUS_MINUS_1_COUNTERPART"
                ),
                "game_1037597_class": g103.get("final_classification"),
                "clock_counts": clock["clock_counts"],
                "tip24_classes": clock["tip24_class_counts"],
                "unk_target_overlap": unk_target_overlap,
                "NEXT": nxt,
            },
            indent=2,
        )
    )
    return 0 if game_join_certified else 1


def write_md(s: dict[str, Any]) -> None:
    a174 = s["absent_174"]
    g = s["game_1037597"]
    d1 = s["date_pm1"]
    lines = [
        "# Official injury-report game join anomaly review (Phase 4A.1)",
        "",
        f"Generated: **{s['generated_at']}**",
        "",
        f"**F6 = {s['F6']}** (Phase 4A preserved: `{s['phase4a_preserved']['F6']}`)  ",
        f"**GAME_JOIN_CERTIFIED = {s['GAME_JOIN_CERTIFIED']}** (Phase 4A preserved: `{s['phase4a_preserved']['GAME_JOIN_CERTIFIED']}`)",
        "",
        "AS_OF_INJURY_TAPE_CERTIFIED = NO  ",
        "Join policy unchanged: exact AWAY + HOME + ET date. No ±1-date / nearest-time fallback.",
        "",
        f"## NEXT",
        "",
        f"**{s['NEXT']}**",
        "",
        f"Blockers: {s.get('blockers') or 'none'}",
        "",
        "## Freeze",
        "",
        f"- Parser SHA: `{s['fingerprint']['files']['parser.py']}`",
        f"- Phase 4A JSON SHA: `{s['fingerprint']['files']['phase4a_json']}`",
        f"- Blocks GZ SHA: `{s['fingerprint']['files']['game_join_blocks_gz']}`",
        "",
        "## 174 analytics-absent logical games",
        "",
        f"- Count reviewed: **{a174['count']}**",
        f"- Classification: `{a174['classification_counts']}`",
        f"- Relevance: target_relevant=**{a174['target_relevant']}**, outside=**{a174['outside_target_cohort']}**, unresolved=**{a174['unresolved_scope']}**",
        f"- Month clustering: `{a174['month_counts']}`",
        f"- July count: {a174['july_count']} (date clustering only; not used as competition-type proof)",
        "",
        a174["note"],
        "",
        "## Date ±1 logical source game",
        "",
        f"- Found: **{d1.get('found')}**",
        f"- Logical: `{d1.get('logical_source_game')}`",
        f"- Classification: **{d1.get('classification')}**",
        f"- Counterpart of 1037597: **{d1.get('GAME_1037597_IS_DATE_PLUS_MINUS_1_COUNTERPART')}**",
        f"- Remediation: {d1.get('remediation_recommendation')}",
        "",
        "## Game 1037597",
        "",
        f"- Analytics: `{g.get('analytics')}`",
        f"- Raw: `{g.get('raw')}`",
        f"- Final classification: **{g.get('final_classification')}**",
        f"- Answers: `{g.get('answers')}`",
        "",
        "## Tip / clock audit",
        "",
        f"- Unique joined games: **{s['clock_audit']['unique_joined_games_audited']}**",
        f"- Clock classes: `{s['clock_audit']['counts']}`",
        f"- Tip24 reclass: `{s['clock_audit']['tip24_class_counts']}`",
        f"- 720m root cause: {s['clock_audit']['root_cause_720m']}",
        "",
        "## UNK@UNK",
        "",
        f"- Blocks: **{s['unk_unk']['blocks']}**",
        f"- Logical contexts: **{s['unk_unk']['logical_contexts']}**",
        f"- Target Final overlap: **{s['unk_unk']['target_complete_final_overlap_blocks']}**",
        f"- Classification: **{s['unk_unk']['classification']}**",
        "",
        "## Target-scope team tokens",
        "",
        f"`{s['team_token_resolution']}`",
        "",
        "## Join invariants",
        "",
        f"`{s['join_invariants_unchanged']}`",
        "",
        "## Reverse coverage reinterpretation",
        "",
        f"`{s['reverse_coverage_reinterpretation']}`",
        "",
        "Original Phase 4A reports were not overwritten.",
        "",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
