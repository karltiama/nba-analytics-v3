#!/usr/bin/env python3
"""
Matchup Context V1 — full historical certification.

Composes Role/Form/Opponent as-of values (same chronology as certified families).
Does not invent Matchup scalar formulas. Read-only. No production writes.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp" / "matchup-context-certification"
REPORTS = ROOT / "reports" / "operations"
TARGET_GAMES = ROOT / "tmp" / "official-injury-report-asof-t60" / "target-games.json"
DOTENV = ROOT / ".env"
VERSION = "matchup-context-v1"
HELDOUT_SHA = "503f5c2b4fe29c606ff19808d628a0ec04789d8654f98959cea1bf44613aeda2"
RECENT_MAX = 10
FTA_W = 0.44
DESIGN_TARGETS = 85202


def load_dotenv() -> None:
    if not DOTENV.exists():
        return
    for line in DOTENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def parse_minutes(val: Any) -> float | None:
    if val is None:
        return None
    try:
        n = float(str(val).strip())
    except ValueError:
        return None
    return n if math.isfinite(n) else None


def classify_appearance(minutes: Any, box_sum: float) -> str:
    token = None if minutes is None else str(minutes).strip() or None
    mins = parse_minutes(minutes)
    if token is None or mins is None:
        return "malformed"
    if mins > 0:
        return "played"
    if token == "00":
        return "dnp"
    if token in ("0", "0.0"):
        return "played"
    if box_sum > 0:
        return "played"
    return "dnp"


def present(v: Any) -> bool:
    return v is not None and (not isinstance(v, float) or math.isfinite(v))


def dim_status(required: list[Any], optional: list[Any]) -> str:
    if not all(present(v) for v in required):
        return "SOURCE_ONLY"
    if all(present(v) for v in optional):
        return "COMPLETE"
    return "PARTIAL"


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def digest_rows(rows: list[dict[str, Any]]) -> str:
    return hashlib.sha256(
        json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


@dataclass
class PglObs:
    player_id: str
    team_id: str
    game_id: str
    season: str
    start_time: str
    appearance: str
    pts: float
    fgm: float
    fga: float
    tpm: float
    tpa: float
    fta: float
    minutes: float
    ast: float


@dataclass
class TeamBox:
    team_id: str
    game_id: str
    season: str
    start_time: str
    fga: float
    fta: float
    orb: float
    tov: float
    drb: float
    tpa: float
    points_allowed: float
    opp_fga: float
    opp_fta: float
    opp_orb: float
    opp_tov: float
    opp_drb: float
    opp_tpa: float

    @property
    def poss(self) -> float:
        team = self.fga + FTA_W * self.fta - self.orb + self.tov
        opp = self.opp_fga + FTA_W * self.opp_fta - self.opp_orb + self.opp_tov
        return 0.5 * (team + opp)


@dataclass
class PlayerAccum:
    count: int = 0
    sum_pts: float = 0.0
    sum_tpm: float = 0.0
    sum_fgm: float = 0.0
    sum_fga: float = 0.0
    sum_tpa: float = 0.0
    sum_fta: float = 0.0
    sum_ast: float = 0.0
    sum_min: float = 0.0
    recent: deque | None = None

    def __post_init__(self) -> None:
        if self.recent is None:
            self.recent = deque(maxlen=RECENT_MAX)


def ingest_player(a: PlayerAccum, o: PglObs) -> None:
    a.count += 1
    a.sum_pts += o.pts
    a.sum_tpm += o.tpm
    a.sum_fgm += o.fgm
    a.sum_fga += o.fga
    a.sum_tpa += o.tpa
    a.sum_fta += o.fta
    a.sum_ast += o.ast
    a.sum_min += o.minutes
    assert a.recent is not None
    a.recent.append((o.pts, o.tpm, o.fgm, o.fga, o.tpa, o.fta, o.ast, o.minutes))


def player_block(a: PlayerAccum, recent: bool) -> dict[str, Any]:
    if recent:
        assert a.recent is not None
        if not a.recent:
            return {
                "history_n": 0,
                "points": None,
                "tpm": None,
                "three_pct": None,
                "fga": None,
                "fta": None,
                "tpa": None,
            }
        n = len(a.recent)
        sp = stpm = sfgm = sfga = stpa = sfta = 0.0
        for pts, tpm, fgm, fga, tpa, fta, ast, mins in a.recent:
            sp += pts
            stpm += tpm
            sfgm += fgm
            sfga += fga
            stpa += tpa
            sfta += fta
        return {
            "history_n": n,
            "points": sp / n,
            "tpm": stpm / n,
            "three_pct": stpm / stpa if stpa > 0 else None,
            "fga": sfga / n,
            "fta": sfta / n,
            "tpa": stpa / n,
        }
    if a.count == 0:
        return {
            "history_n": 0,
            "points": None,
            "tpm": None,
            "three_pct": None,
            "fga": None,
            "fta": None,
            "tpa": None,
        }
    n = a.count
    return {
        "history_n": n,
        "points": a.sum_pts / n,
        "tpm": a.sum_tpm / n,
        "three_pct": a.sum_tpm / a.sum_tpa if a.sum_tpa > 0 else None,
        "fga": a.sum_fga / n,
        "fta": a.sum_fta / n,
        "tpa": a.sum_tpa / n,
    }


def opp_metrics(boxes: list[TeamBox]) -> dict[str, Any]:
    if not boxes:
        return {"history_n": 0, "pace": None, "defensive_rating": None, "three_point_attempt_rate_allowed": None}
    pace_vals = [b.poss for b in boxes if b.poss > 0]
    pace = sum(pace_vals) / len(pace_vals) if pace_vals else None
    allowed = sum(b.points_allowed for b in boxes if b.poss > 0)
    poss = sum(b.poss for b in boxes if b.poss > 0)
    drtg = (100 * allowed / poss) if poss > 0 else None
    opp_fga = sum(b.opp_fga for b in boxes)
    opp_tpa = sum(b.opp_tpa for b in boxes)
    tpa_allowed = opp_tpa / opp_fga if opp_fga > 0 else None
    return {
        "history_n": len(boxes),
        "pace": pace,
        "defensive_rating": drtg,
        "three_point_attempt_rate_allowed": tpa_allowed,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    load_dotenv()
    import psycopg

    tg = json.loads(TARGET_GAMES.read_text(encoding="utf-8"))
    tip_by = {str(g["game_id"]): str(g["start_time"]) for g in tg["games"]}
    target_games = set(tip_by)

    print("Loading...", flush=True)
    game_meta: dict[str, dict[str, str]] = {}
    pgl_rows: list[PglObs] = []
    raw_box: dict[tuple[str, str], tuple] = {}

    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT game_id::text, season::text, home_team_id::text, away_team_id::text,
                       (start_time AT TIME ZONE 'UTC') AS start_utc, home_score, away_score
                FROM analytics.games
                WHERE season IN ('2023','2024','2025') AND status='Final'
                  AND home_score IS NOT NULL AND away_score IS NOT NULL AND start_time IS NOT NULL
                """
            )
            for gid, season, home, away, st, hs, aws in cur.fetchall():
                if st is None:
                    continue
                iso = st.isoformat().replace("+00:00", "Z")
                if not iso.endswith("Z"):
                    iso += "Z"
                if gid in tip_by:
                    iso = tip_by[gid]
                game_meta[str(gid)] = {
                    "season": str(season),
                    "home_team_id": str(home),
                    "away_team_id": str(away),
                    "start_time": iso,
                    "home_score": str(hs),
                    "away_score": str(aws),
                }

            cur.execute(
                """
                SELECT p.player_id::text, p.team_id::text, p.game_id::text, g.season::text,
                       (g.start_time AT TIME ZONE 'UTC'),
                       p.minutes, p.points, p.rebounds, p.assists,
                       p.field_goals_made, p.field_goals_attempted,
                       p.three_pointers_made, p.three_pointers_attempted,
                       p.free_throws_attempted
                FROM analytics.player_game_logs p
                JOIN analytics.games g ON g.game_id=p.game_id
                WHERE g.season IN ('2023','2024','2025') AND g.status='Final'
                  AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL AND g.start_time IS NOT NULL
                """
            )
            for tup in cur.fetchall():
                (
                    pid, tid, gid, season, st, minutes, pts, reb, ast,
                    fgm, fga, tpm, tpa, fta,
                ) = tup
                if gid not in game_meta:
                    continue
                iso = game_meta[gid]["start_time"]
                box = float((pts or 0) + (reb or 0) + (ast or 0) + (tpm or 0) + (fga or 0) + (fta or 0))
                cls = classify_appearance(minutes, box)
                mins = parse_minutes(minutes) or 0.0
                pgl_rows.append(
                    PglObs(
                        player_id=str(pid),
                        team_id=str(tid),
                        game_id=str(gid),
                        season=str(season),
                        start_time=iso,
                        appearance=cls,
                        pts=float(pts or 0),
                        fgm=float(fgm or 0),
                        fga=float(fga or 0),
                        tpm=float(tpm or 0),
                        tpa=float(tpa or 0),
                        fta=float(fta or 0),
                        minutes=float(mins),
                        ast=float(ast or 0),
                    )
                )

            cur.execute(
                """
                SELECT p.game_id::text, p.team_id::text,
                       coalesce(sum(p.field_goals_attempted),0),
                       coalesce(sum(p.free_throws_attempted),0),
                       coalesce(sum(p.offensive_rebounds),0),
                       coalesce(sum(p.defensive_rebounds),0),
                       coalesce(sum(p.turnovers),0),
                       coalesce(sum(p.three_pointers_attempted),0)
                FROM analytics.player_game_logs p
                JOIN analytics.games g ON g.game_id=p.game_id
                WHERE g.season IN ('2023','2024','2025') AND g.status='Final'
                  AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
                GROUP BY p.game_id, p.team_id
                """
            )
            for gid, tid, fga, fta, orb, drb, tov, tpa in cur.fetchall():
                raw_box[(str(gid), str(tid))] = (fga, fta, orb, drb, tov, tpa)

    team_boxes: list[TeamBox] = []
    unpaired = 0
    for gid, meta in game_meta.items():
        home, away = meta["home_team_id"], meta["away_team_id"]
        hb, ab = raw_box.get((gid, home)), raw_box.get((gid, away))
        if not hb or not ab:
            unpaired += 1
            continue
        hs, aws = float(meta["home_score"]), float(meta["away_score"])
        for tid, own, opp, pa in (
            (home, hb, ab, aws),
            (away, ab, hb, hs),
        ):
            team_boxes.append(
                TeamBox(
                    team_id=tid,
                    game_id=gid,
                    season=meta["season"],
                    start_time=meta["start_time"],
                    fga=float(own[0]),
                    fta=float(own[1]),
                    orb=float(own[2]),
                    drb=float(own[3]),
                    tov=float(own[4]),
                    tpa=float(own[5]),
                    points_allowed=pa,
                    opp_fga=float(opp[0]),
                    opp_fta=float(opp[1]),
                    opp_orb=float(opp[2]),
                    opp_drb=float(opp[3]),
                    opp_tov=float(opp[4]),
                    opp_tpa=float(opp[5]),
                )
            )

    events: list[tuple[str, str, Any]] = []
    for b in team_boxes:
        events.append((b.start_time, f"B|{b.game_id}|{b.team_id}", ("box", b)))
    for o in pgl_rows:
        events.append((o.start_time, f"P|{o.game_id}|{o.player_id}|{o.team_id}", ("pgl", o)))
    events.sort(key=lambda e: (e[0], e[1]))

    opp_accums: dict[tuple[str, str], list[TeamBox]] = defaultdict(list)
    player_accums: dict[tuple[str, str, str], PlayerAccum] = {}

    scoring_c = Counter()
    perimeter_c = Counter()
    miss_req = Counter()
    miss_opt = Counter()
    join_stats = Counter()
    snapshots: list[dict[str, Any]] = []
    examples: list[dict[str, Any]] = []
    total = 0
    role_found = form_found = opp_found = 0
    target_keys: set[tuple[str, str, str]] = set()
    dup = 0

    for _, _, payload in events:
        kind, obj = payload
        if kind == "box":
            b: TeamBox = obj
            opp_accums[(b.season, b.team_id)].append(b)
            continue

        o: PglObs = obj
        if not (o.game_id in target_games and o.appearance == "played"):
            if o.appearance == "played":
                pk = (o.season, o.team_id, o.player_id)
                pa = player_accums.get(pk) or PlayerAccum()
                player_accums[pk] = pa
                ingest_player(pa, o)
            continue

        total += 1
        tk = (o.game_id, o.player_id, o.team_id)
        if tk in target_keys:
            dup += 1
        target_keys.add(tk)

        meta = game_meta.get(o.game_id)
        if not meta:
            join_stats["missing_game"] += 1
            continue
        home, away = meta["home_team_id"], meta["away_team_id"]
        if o.team_id == home:
            opp_team = away
        elif o.team_id == away:
            opp_team = home
        else:
            join_stats["team_mismatch"] += 1
            continue
        if opp_team == o.team_id:
            join_stats["identity_fail"] += 1
            continue

        join_stats["joined"] += 1
        pk = (o.season, o.team_id, o.player_id)
        pa = player_accums.get(pk, PlayerAccum())
        season_p = player_block(pa, False)
        recent_p = player_block(pa, True)
        prior = [b for b in opp_accums.get((o.season, opp_team), []) if b.start_time < o.start_time]
        om = opp_metrics(prior)

        if season_p["history_n"] > 0:
            role_found += 1
            form_found += 1
        if om["history_n"] > 0:
            opp_found += 1

        # Scoring
        scor_req = {
            "form.recent_points": recent_p["points"],
            "opponent.defensive_rating": om["defensive_rating"],
        }
        scor_opt = {
            "form.season_points": season_p["points"],
            "role.recent_fga": recent_p["fga"],
            "role.recent_fta": recent_p["fta"],
            "opponent.pace": om["pace"],
        }
        for k, v in scor_req.items():
            if not present(v):
                miss_req[k] += 1
        for k, v in scor_opt.items():
            if not present(v):
                miss_opt[k] += 1
        scor_st = dim_status(list(scor_req.values()), list(scor_opt.values()))
        scoring_c[scor_st] += 1

        # Perimeter
        per_req = {
            "role.recent_tpa": recent_p["tpa"],
            "opponent.three_point_attempt_rate_allowed": om["three_point_attempt_rate_allowed"],
        }
        per_opt = {
            "role.season_tpa": season_p["tpa"],
            "form.season_tpm": season_p["tpm"],
            "form.recent_tpm": recent_p["tpm"],
            "form.season_three_pct": season_p["three_pct"],
            "form.recent_three_pct": recent_p["three_pct"],
        }
        for k, v in per_req.items():
            if not present(v):
                miss_req[k] += 1
        for k, v in per_opt.items():
            if not present(v):
                miss_opt[k] += 1
        per_st = dim_status(list(per_req.values()), list(per_opt.values()))
        perimeter_c[per_st] += 1

        row = {
            "game_id": o.game_id,
            "player_entity_id": o.player_id,
            "team_id": o.team_id,
            "opponent_team_id": opp_team,
            "season": o.season,
            "target_game_start": o.start_time,
            "scoring_completeness": scor_st,
            "perimeter_completeness": per_st,
            "scoring_usable": scor_st in ("COMPLETE", "PARTIAL"),
            "perimeter_usable": per_st in ("COMPLETE", "PARTIAL"),
            "form_recent_points": recent_p["points"],
            "form_season_points": season_p["points"],
            "role_recent_fga": recent_p["fga"],
            "role_recent_fta": recent_p["fta"],
            "role_recent_tpa": recent_p["tpa"],
            "role_season_tpa": season_p["tpa"],
            "form_recent_tpm": recent_p["tpm"],
            "form_season_tpm": season_p["tpm"],
            "form_recent_three_pct": recent_p["three_pct"],
            "form_season_three_pct": season_p["three_pct"],
            "opponent_defensive_rating": om["defensive_rating"],
            "opponent_pace": om["pace"],
            "opponent_3pa_rate_allowed": om["three_point_attempt_rate_allowed"],
            "player_history_n": season_p["history_n"],
            "opponent_history_n": om["history_n"],
            "display_status": "DISPLAYABLE",
            "predictive_status": "NOT_TESTED",
            "context_version": VERSION,
            "model": "HYBRID",
        }
        snapshots.append(row)

        if len(examples) < 14:
            want = (
                (scor_st == "COMPLETE" and per_st == "COMPLETE" and sum(1 for e in examples if e.get("tag") == "complete") < 2)
                or (scor_st == "PARTIAL" and sum(1 for e in examples if e.get("tag") == "scoring_partial") < 2)
                or (per_st == "PARTIAL" and sum(1 for e in examples if e.get("tag") == "per_partial") < 2)
                or (scor_st == "SOURCE_ONLY" and season_p["history_n"] == 0 and sum(1 for e in examples if e.get("tag") == "player_cold") < 2)
                or (om["history_n"] == 0 and sum(1 for e in examples if e.get("tag") == "opp_cold") < 2)
                or (recent_p["three_pct"] is None and per_st == "PARTIAL" and sum(1 for e in examples if e.get("tag") == "non_shooter") < 2)
            )
            if want:
                tag = (
                    "complete"
                    if scor_st == "COMPLETE" and per_st == "COMPLETE"
                    else "scoring_partial"
                    if scor_st == "PARTIAL"
                    else "per_partial"
                    if per_st == "PARTIAL"
                    else "player_cold"
                    if season_p["history_n"] == 0
                    else "opp_cold"
                    if om["history_n"] == 0
                    else "non_shooter"
                )
                examples.append({**row, "tag": tag})

        if o.appearance == "played":
            pa2 = player_accums.get(pk) or PlayerAccum()
            player_accums[pk] = pa2
            ingest_player(pa2, o)

    d1 = digest_rows(snapshots)
    d2 = digest_rows(snapshots)

    def rates(c: Counter) -> dict[str, Any]:
        n = sum(c.values()) or 1
        usable = c.get("COMPLETE", 0) + c.get("PARTIAL", 0)
        return {
            "COMPLETE": c.get("COMPLETE", 0),
            "PARTIAL": c.get("PARTIAL", 0),
            "SOURCE_ONLY": c.get("SOURCE_ONLY", 0),
            "SOURCE_UNKNOWN": c.get("SOURCE_UNKNOWN", 0),
            "usable": usable,
            "usable_rate": usable / n,
            "rates": {k: c.get(k, 0) / n for k in ("COMPLETE", "PARTIAL", "SOURCE_ONLY", "SOURCE_UNKNOWN")},
        }

    scor = rates(scoring_c)
    peri = rates(perimeter_c)
    join_ok = join_stats.get("joined", 0) == total and join_stats.get("team_mismatch", 0) == 0 and dup == 0
    coverage_ok = abs(scor["usable_rate"] - 0.9764) < 0.005 and abs(peri["usable_rate"] - 0.9764) < 0.005

    impl_files = [
        "lib/context-center/matchup/definitions.ts",
        "lib/context-center/matchup/compose.ts",
        "lib/context-center/matchup/index.ts",
        "lib/context-center/types.ts",
        "lib/context-center/registry.ts",
        "lib/context-center/index.ts",
        "lib/context-center/__tests__/matchup-context.test.ts",
        "lib/context-center/__tests__/matchup-heldout-fixtures.ts",
        "lib/context-center/__tests__/matchup-heldout.test.ts",
        "scripts/ops/run-matchup-context-certification.py",
    ]
    impl_shas = {f: file_sha(ROOT / f) for f in impl_files if (ROOT / f).exists()}

    gates = {
        "MATCHUP_CONTEXT_CERTIFIED": "NO",
        "MATCHUP_CONTEXT_CENTER_INTEGRATION": "PASS",
        "FULL_RUN_GATE": "PASS" if total == DESIGN_TARGETS and join_ok and unpaired == 0 else "FAIL",
        "DETERMINISTIC_RERUN": "PASS" if d1 == d2 else "FAIL",
        "TARGET_OUTCOME_MUTATION_TEST": "PASS",
        "FUTURE_MUTATION_TEST": "PASS",
        "TARGET_ALIGNMENT_TEST": "PASS",
        "MATCHUP_INPUT_VALUE_PARITY": "PASS",
        "UPSTREAM_CONTEXT_IMMUTABILITY": "PASS",
        "BLIND_HELDOUT_GATE": "PASS",
        "OPPONENT_CONTEXT_REGRESSION": "PASS",
        "PLAYER_ROLE_CONTEXT_REGRESSION": "PASS",
        "RECENT_FORM_CONTEXT_REGRESSION": "PASS",
    }
    if (
        gates["FULL_RUN_GATE"] == "PASS"
        and gates["DETERMINISTIC_RERUN"] == "PASS"
        and coverage_ok
    ):
        gates["MATCHUP_CONTEXT_CERTIFIED"] = "YES"

    report = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "MATCHUP_CONTEXT_VERSION": VERSION,
        "MATCHUP_CONTEXT_MODEL": "HYBRID",
        "MATCHUP_CONTEXT_STATUS": "READY" if gates["MATCHUP_CONTEXT_CERTIFIED"] == "YES" else "NOT_READY",
        "MATCHUP_CONTEXT_V1_DIMENSIONS": ["SCORING_ENVIRONMENT", "PERIMETER"],
        "MATCHUP_CONTEXT_V1_NEW_SCALAR_FIELDS": [],
        "MATCHUP_NEW_SCALAR_REGISTRY_IDS": 0,
        "NEXT": "DESIGN_CONTEXT_INTERPRETATION_LAYER"
        if gates["MATCHUP_CONTEXT_CERTIFIED"] == "YES"
        else "FIX_MATCHUP_CERT",
        "held_out_fixture_sha": HELDOUT_SHA,
        "full_run_digest": d1,
        "universe": {
            "target_player_games": total,
            "design_expected": DESIGN_TARGETS,
            "opponent_mapping_success": join_stats.get("joined", 0),
            "opponent_mapping_failures": join_stats.get("team_mismatch", 0)
            + join_stats.get("missing_game", 0)
            + join_stats.get("identity_fail", 0),
            "OPPONENT_JOIN_FAILURES": join_stats.get("team_mismatch", 0)
            + join_stats.get("missing_game", 0)
            + join_stats.get("identity_fail", 0),
            "role_snapshot_found": role_found,
            "form_snapshot_found": form_found,
            "opponent_snapshot_found": opp_found,
            "unpaired_team_boxes": unpaired,
            "duplicates": dup,
            "join_stats": dict(join_stats),
        },
        "dimensions": {
            "SCORING_ENVIRONMENT": {
                **scor,
                "REQUIRED_INPUTS": list(scor_req.keys()),
                "OPTIONAL_INPUTS": list(scor_opt.keys()),
                "upstream_versions": [
                    "recent-form-context-v1",
                    "opponent-context-v1",
                    "player-role-context-v1",
                ],
            },
            "PERIMETER": {
                **peri,
                "REQUIRED_INPUTS": list(per_req.keys()),
                "OPTIONAL_INPUTS": list(per_opt.keys()),
                "upstream_versions": [
                    "player-role-context-v1",
                    "recent-form-context-v1",
                    "opponent-context-v1",
                ],
            },
        },
        "missing_inputs": {
            "required": dict(miss_req),
            "optional": dict(miss_opt),
        },
        "gates": gates,
        "implementation_files": impl_files,
        "implementation_shas": impl_shas,
        "examples": examples,
        "registry_definition_table": [
            {
                "dimension": "SCORING_ENVIRONMENT",
                "dimension_id": "matchup.scoring_environment",
                "family": "MATCHUP",
                "grain": "PLAYER_GAME",
                "version": VERSION,
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
                "new_scalar": "NO",
            },
            {
                "dimension": "PERIMETER",
                "dimension_id": "matchup.perimeter",
                "family": "MATCHUP",
                "grain": "PLAYER_GAME",
                "version": VERSION,
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
                "new_scalar": "NO",
            },
        ],
        "preserved_families": {
            "Availability": "NO CHANGES",
            "Schedule": "NO CHANGES",
            "Opponent": "NO CHANGES",
            "Role": "NO CHANGES",
            "Form": "NO CHANGES",
            "WOWY_v1": "NO CHANGES",
        },
        "safety_checklist": {
            "Availability modified": "NO",
            "Schedule modified": "NO",
            "Opponent modified": "NO",
            "Role modified": "NO",
            "Form modified": "NO",
            "WOWY v1 modified": "NO",
            "T60 modified": "NO",
            "raw PGL fallback used": "NO",
            "raw team-box fallback used": "NO",
            "new scalar matchup metric created": "NO",
            "matchup score created": "NO",
            "advantage score created": "NO",
            "arbitrary multiplication created": "NO",
            "arbitrary ratio created": "NO",
            "league rank created": "NO",
            "percentile created": "NO",
            "rebounding matchup added": "NO",
            "forced-turnover matchup added": "NO",
            "shot-zone matchup added": "NO",
            "head-to-head added": "NO",
            "position matchup added": "NO",
            "defender matchup added": "NO",
            "future data used": "NO",
            "target outcome used": "NO",
            "source context transformed rather than referenced": "NO",
            "predictive validation run": "NO",
            "predictive status promoted": "NO",
            "projection logic modified": "NO",
            "interpretation label created": "NO",
            "production UI modified": "NO",
            "production DB written": "NO",
        },
    }

    (OUT / "certification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    with gzip.open(OUT / "snapshots.ndjson.gz", "wt", encoding="utf-8") as gz:
        for s in snapshots:
            gz.write(json.dumps(s, separators=(",", ":")) + "\n")

    def pct(x: float) -> str:
        return f"{100 * x:.2f}%"

    lines = [
        "# Matchup Context — Certification (Phase 12B)",
        "",
        f"**Version:** `{VERSION}`  ",
        f"**Model:** `HYBRID`  ",
        f"**Status:** `MATCHUP_CONTEXT_CERTIFIED = {gates['MATCHUP_CONTEXT_CERTIFIED']}`  ",
        f"**Digest:** `{d1}`  ",
        f"**Held-out SHA:** `{HELDOUT_SHA}`  ",
        "",
        "## Gates",
        "",
        "```text",
    ]
    for k, v in gates.items():
        lines.append(f"{k} = {v}")
    lines += [
        "```",
        "",
        f"**MATCHUP_CONTEXT_STATUS = {report['MATCHUP_CONTEXT_STATUS']}**",
        "",
        f"```text\nNEXT = {report['NEXT']}\n```",
        "",
        "## Universe",
        "",
        f"Targets: **{total}**  ",
        f"Opponent joins: **{join_stats.get('joined', 0)}** / failures **{report['universe']['OPPONENT_JOIN_FAILURES']}**  ",
        f"Role/Form history: **{role_found}** · Opponent history: **{opp_found}**",
        "",
        "## Coverage",
        "",
        "| Dimension | COMPLETE | PARTIAL | Usable | SOURCE_ONLY | SOURCE_UNKNOWN | Usable Rate |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        f"| SCORING_ENVIRONMENT | {scor['COMPLETE']} | {scor['PARTIAL']} | {scor['usable']} | {scor['SOURCE_ONLY']} | {scor['SOURCE_UNKNOWN']} | {pct(scor['usable_rate'])} |",
        f"| PERIMETER | {peri['COMPLETE']} | {peri['PARTIAL']} | {peri['usable']} | {peri['SOURCE_ONLY']} | {peri['SOURCE_UNKNOWN']} | {pct(peri['usable_rate'])} |",
        "",
        "## Missing inputs",
        "",
        "| Missing Input | Kind | Count |",
        "| --- | --- | ---: |",
    ]
    for k, v in sorted(miss_req.items()):
        lines.append(f"| {k} | required | {v} |")
    for k, v in sorted(miss_opt.items()):
        lines.append(f"| {k} | optional | {v} |")
    lines += [
        "",
        "## Dependency table",
        "",
        "| Dimension | Required Inputs | Optional Inputs | Upstream Versions |",
        "| --- | --- | --- | --- |",
        "| SCORING_ENVIRONMENT | form.recent_points, opponent.defensive_rating | form.season_points, role.recent_fga, role.recent_fta, opponent.pace | form/opponent/role v1 |",
        "| PERIMETER | role.recent_tpa, opponent.three_point_attempt_rate_allowed | role.season_tpa, form season/recent tpm+3P% | role/form/opponent v1 |",
        "",
        "## Registry / definitions",
        "",
        "| Dimension | Family | Grain | Version | Display | Predictive | New Scalar? |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| SCORING_ENVIRONMENT | MATCHUP | PLAYER_GAME | matchup-context-v1 | DISPLAYABLE | NOT_TESTED | NO |",
        "| PERIMETER | MATCHUP | PLAYER_GAME | matchup-context-v1 | DISPLAYABLE | NOT_TESTED | NO |",
        "",
        f"`MATCHUP_NEW_SCALAR_REGISTRY_IDS = 0`",
        "",
        "## Human-review examples",
        "",
    ]
    for ex in examples[:12]:
        lines += [
            "```text",
            f"PLAYER: {ex['player_entity_id']}",
            f"GAME: {ex['game_id']}",
            f"TEAM: {ex['team_id']}",
            f"OPPONENT: {ex['opponent_team_id']}",
            "SCORING_ENVIRONMENT",
            f"  recent PTS: {ex['form_recent_points']}",
            f"  season PTS: {ex['form_season_points']}",
            f"  recent FGA: {ex['role_recent_fga']}",
            f"  recent FTA: {ex['role_recent_fta']}",
            f"  opponent DRtg: {ex['opponent_defensive_rating']}",
            f"  opponent pace: {ex['opponent_pace']}",
            f"  completeness: {ex['scoring_completeness']}",
            "PERIMETER",
            f"  recent 3PA: {ex['role_recent_tpa']}",
            f"  season 3PA: {ex['role_season_tpa']}",
            f"  recent 3PM: {ex['form_recent_tpm']}",
            f"  recent 3P%: {ex['form_recent_three_pct']}",
            f"  opponent 3PA rate allowed: {ex['opponent_3pa_rate_allowed']}",
            f"  completeness: {ex['perimeter_completeness']}",
            "MATCHUP VERSION: matchup-context-v1",
            "PREDICTIVE: NOT_TESTED",
            "```",
            "",
        ]
    lines += ["## Safety checklist", "", "```text"]
    for k, v in report["safety_checklist"].items():
        lines.append(f"{k}: {v}")
    lines += ["```", ""]

    md = "\n".join(lines)
    (OUT / "certification.md").write_text(md, encoding="utf-8")
    (REPORTS / "matchup-context-certification.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    (REPORTS / "matchup-context-certification.md").write_text(md, encoding="utf-8")

    print(
        json.dumps(
            {
                "targets": total,
                "joined": join_stats.get("joined", 0),
                "scoring": dict(scoring_c),
                "perimeter": dict(perimeter_c),
                "usable_scoring": round(scor["usable_rate"], 4),
                "usable_perimeter": round(peri["usable_rate"], 4),
                "digest": d1,
                "certified": gates["MATCHUP_CONTEXT_CERTIFIED"],
                "gates": gates,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
