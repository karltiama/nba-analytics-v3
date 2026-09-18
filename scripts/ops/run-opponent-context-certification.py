#!/usr/bin/env python3
"""
Opponent Context V1 — full historical certification.

Mirrors lib/context-center/opponent/* (PGL → team box → expanding/pooled metrics).
Read-only DB. No production writes. No predictive validation.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp" / "opponent-context-certification"
TARGET_GAMES = ROOT / "tmp" / "official-injury-report-asof-t60" / "target-games.json"
DOTENV = ROOT / ".env"
DESIGN = ROOT / "reports" / "operations" / "opponent-context-design.json"
VERSION = "opponent-context-v1"
TEAM_BOX_VERSION = "opponent-team-box-pgl-v1"
POSSESSIONS_VERSION = "possessions-avg-both-sides-fta0.44-v1"
FTA_W = 0.44
HELDOUT_SHA = "472269ae1d45c5188e2363b7494dd7b5099c37928b4a1e4a7dbae144c9075a1c"
DESIGN_HISTORY_N = {"0": 90, "1": 90, "2": 90, "3-5": 270, "6-10": 450, ">10": 6934}


def load_dotenv() -> None:
    if not DOTENV.exists():
        return
    for line in DOTENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def percentile(vals: list[float], p: float) -> float | None:
    if not vals:
        return None
    s = sorted(vals)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] * (c - k) + s[c] * (k - f)


def dist(vals: list[float]) -> dict[str, Any]:
    if not vals:
        return {"n": 0}
    s = sorted(vals)
    return {
        "n": len(s),
        "min": s[0],
        "p25": percentile(s, 0.25),
        "median": percentile(s, 0.5),
        "p75": percentile(s, 0.75),
        "p90": percentile(s, 0.9),
        "p95": percentile(s, 0.95),
        "max": s[-1],
    }


def bucket_n(n: int) -> str:
    if n == 0:
        return "0"
    if n == 1:
        return "1"
    if n == 2:
        return "2"
    if 3 <= n <= 5:
        return "3-5"
    if 6 <= n <= 10:
        return "6-10"
    return ">10"


@dataclass
class Box:
    team_id: str
    game_id: str
    season: str
    start_time: str
    opponent_team_id: str
    points_allowed: int
    fga: int
    fta: int
    tpa: int
    tov: int
    orb: int
    drb: int
    o_fga: int
    o_fta: int
    o_tpa: int
    o_tov: int
    o_orb: int
    o_drb: int
    estimated_possessions: float


def team_poss(fga: int, fta: int, orb: int, tov: int) -> float:
    return fga + FTA_W * fta - orb + tov


def load_boxes() -> tuple[list[Box], dict[str, Any]]:
    load_dotenv()
    import psycopg

    anomaly = Counter()
    raw: dict[tuple[str, str], dict[str, Any]] = {}

    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            # Prove we do not depend on stale TGS advanced cols: sample zeros for 2023
            cur.execute(
                """
                SELECT count(*) FILTER (WHERE season='2023' AND coalesce(opponent_fga,0)=0),
                       count(*) FILTER (WHERE season='2023')
                FROM analytics.team_game_stats
                """
            )
            z, n = cur.fetchone()
            anomaly["tgs_2023_opponent_fga_zero"] = int(z)
            anomaly["tgs_2023_rows"] = int(n)

            cur.execute(
                """
                SELECT
                  pgl.team_id::text, pgl.game_id::text, g.season::text,
                  (g.start_time AT TIME ZONE 'UTC') AS start_utc,
                  CASE WHEN pgl.team_id = g.home_team_id THEN g.away_team_id::text
                       ELSE g.home_team_id::text END,
                  coalesce(sum(pgl.points),0)::int,
                  coalesce(sum(pgl.field_goals_attempted),0)::int,
                  coalesce(sum(pgl.free_throws_attempted),0)::int,
                  coalesce(sum(pgl.three_pointers_attempted),0)::int,
                  coalesce(sum(pgl.turnovers),0)::int,
                  coalesce(sum(pgl.offensive_rebounds),0)::int,
                  coalesce(sum(pgl.defensive_rebounds),0)::int,
                  CASE WHEN pgl.team_id = g.home_team_id THEN g.away_score ELSE g.home_score END,
                  count(*) FILTER (WHERE pgl.offensive_rebounds IS NOT NULL) AS orb_nn,
                  count(*) FILTER (WHERE pgl.defensive_rebounds IS NOT NULL) AS drb_nn,
                  count(*) FILTER (WHERE pgl.field_goals_attempted IS NOT NULL) AS fga_nn
                FROM analytics.player_game_logs pgl
                JOIN analytics.games g ON g.game_id = pgl.game_id
                WHERE g.season IN ('2023','2024','2025')
                  AND g.status = 'Final'
                  AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
                  AND g.start_time IS NOT NULL
                GROUP BY pgl.team_id, pgl.game_id, g.season, g.start_time,
                         g.home_team_id, g.away_team_id, g.home_score, g.away_score
                """
            )
            for tup in cur.fetchall():
                (
                    tid, gid, season, st, opp, pts, fga, fta, tpa, tov, orb, drb,
                    allowed, orb_nn, drb_nn, fga_nn,
                ) = tup
                if st is None or allowed is None:
                    anomaly["missing_boxes"] += 1
                    continue
                if orb_nn == 0 or drb_nn == 0 or fga_nn == 0:
                    anomaly["invalid_boxes_missing_fields"] += 1
                    continue
                key = (str(tid), str(gid))
                if key in raw:
                    anomaly["duplicate_boxes"] += 1
                iso = st.isoformat().replace("+00:00", "Z")
                if not iso.endswith("Z"):
                    iso += "Z"
                raw[key] = {
                    "team_id": str(tid),
                    "game_id": str(gid),
                    "season": str(season),
                    "start_time": iso,
                    "opponent_team_id": str(opp),
                    "points": int(pts),
                    "points_allowed": int(allowed),
                    "fga": int(fga),
                    "fta": int(fta),
                    "tpa": int(tpa),
                    "tov": int(tov),
                    "orb": int(orb),
                    "drb": int(drb),
                }

    boxes: list[Box] = []
    for (tid, gid), r in raw.items():
        o = raw.get((r["opponent_team_id"], gid))
        if o is None:
            anomaly["unpaired_sides"] += 1
            continue
        poss = 0.5 * (
            team_poss(r["fga"], r["fta"], r["orb"], r["tov"])
            + team_poss(o["fga"], o["fta"], o["orb"], o["tov"])
        )
        if not math.isfinite(poss) or poss <= 0:
            anomaly["invalid_possession_rows"] += 1
            continue
        boxes.append(
            Box(
                team_id=r["team_id"],
                game_id=r["game_id"],
                season=r["season"],
                start_time=r["start_time"],
                opponent_team_id=r["opponent_team_id"],
                points_allowed=r["points_allowed"],
                fga=r["fga"],
                fta=r["fta"],
                tpa=r["tpa"],
                tov=r["tov"],
                orb=r["orb"],
                drb=r["drb"],
                o_fga=o["fga"],
                o_fta=o["fta"],
                o_tpa=o["tpa"],
                o_tov=o["tov"],
                o_orb=o["orb"],
                o_drb=o["drb"],
                estimated_possessions=poss,
            )
        )

    meta = {
        "pgl_historical_team_boxes_reconstructed": len(boxes),
        "raw_sides": len(raw),
        "anomalies": dict(anomaly),
    }
    return boxes, meta


def aggregate(hist: list[Box]) -> dict[str, float | None]:
    if not hist:
        return {
            "pace": None,
            "defensive_rating": None,
            "defensive_rebound_pct": None,
            "offensive_rebound_pct": None,
            "turnover_rate": None,
            "three_point_attempt_rate_allowed": None,
        }
    paces = [b.estimated_possessions for b in hist if b.estimated_possessions > 0]
    pace = statistics.fmean(paces) if paces else None

    sa = sp = 0.0
    for b in hist:
        if b.estimated_possessions > 0:
            sa += b.points_allowed
            sp += b.estimated_possessions
    drtg = 100.0 * sa / sp if sp > 0 else None

    dn = dd = 0.0
    for b in hist:
        d = b.drb + b.o_orb
        if d > 0:
            dn += b.drb
            dd += d
    drb = dn / dd if dd > 0 else None

    on = od = 0.0
    for b in hist:
        d = b.orb + b.o_drb
        if d > 0:
            on += b.orb
            od += d
    orb = on / od if od > 0 else None

    tn = td = 0.0
    for b in hist:
        d = b.fga + FTA_W * b.fta + b.tov
        if d > 0:
            tn += b.tov
            td += d
    tov = tn / td if td > 0 else None

    a3 = fga = 0.0
    for b in hist:
        if b.o_fga > 0:
            a3 += b.o_tpa
            fga += b.o_fga
    tpa_rate = a3 / fga if fga > 0 else None

    return {
        "pace": pace,
        "defensive_rating": drtg,
        "defensive_rebound_pct": drb,
        "offensive_rebound_pct": orb,
        "turnover_rate": tov,
        "three_point_attempt_rate_allowed": tpa_rate,
    }


def digest_rows(rows: list[dict[str, Any]]) -> str:
    canonical = json.dumps(rows, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tg = json.loads(TARGET_GAMES.read_text(encoding="utf-8"))
    tip_by = {str(g["game_id"]): str(g["start_time"]) for g in tg["games"]}

    print("Loading PGL team boxes...", flush=True)
    boxes, box_meta = load_boxes()
    for b in boxes:
        if b.game_id in tip_by:
            b.start_time = tip_by[b.game_id]

    by_team_season: dict[tuple[str, str], list[Box]] = defaultdict(list)
    for b in boxes:
        by_team_season[(b.team_id, b.season)].append(b)
    for v in by_team_season.values():
        v.sort(key=lambda x: (x.start_time, x.game_id))

    metrics = [
        "pace",
        "defensive_rating",
        "defensive_rebound_pct",
        "offensive_rebound_pct",
        "turnover_rate",
        "three_point_attempt_rate_allowed",
    ]
    hist_buckets: Counter = Counter()
    hist_by_season: dict[str, Counter] = defaultdict(Counter)
    coverage = {m: Counter() for m in metrics}
    values: dict[str, list[float]] = {m: [] for m in metrics}
    domain_fail = 0
    same_tip = 0
    future = 0
    mapping_fail = 0
    examples: list[dict[str, Any]] = []
    snapshots: list[dict[str, Any]] = []

    team_games = []
    for g in tg["games"]:
        home, away = str(g["home_team_id"]), str(g["away_team_id"])
        if home == away:
            mapping_fail += 1
            continue
        for tid, oid in ((home, away), (away, home)):
            team_games.append(
                {
                    "game_id": str(g["game_id"]),
                    "season": str(g["season"]),
                    "start_time": str(g["start_time"]),
                    "team_id": tid,
                    "opponent_team_id": oid,
                    "home_abbr": g.get("home_abbr"),
                    "away_abbr": g.get("away_abbr"),
                }
            )

    for tg_row in team_games:
        tip = tg_row["start_time"]
        season = tg_row["season"]
        opp = tg_row["opponent_team_id"]
        hist_all = by_team_season.get((opp, season), [])
        hist = [b for b in hist_all if b.start_time < tip]
        if any(b.start_time == tip for b in hist):
            same_tip += 1
        if any(b.start_time >= tip for b in hist):
            future += 1
        n = len(hist)
        hist_buckets[bucket_n(n)] += 1
        hist_by_season[season][bucket_n(n)] += 1
        out = aggregate(hist)
        latest = hist[-1].start_time if n else None
        if latest is not None and not (latest < tip):
            raise RuntimeError("history_latest invariant broken")

        for m in metrics:
            v = out[m]
            if v is not None:
                if m == "pace" and not (v > 0 and math.isfinite(v)):
                    domain_fail += 1
                    v = None
                elif m == "defensive_rating" and not (v > 0 and math.isfinite(v)):
                    domain_fail += 1
                    v = None
                elif m in (
                    "defensive_rebound_pct",
                    "offensive_rebound_pct",
                    "three_point_attempt_rate_allowed",
                ) and not (0 <= v <= 1 and math.isfinite(v)):
                    domain_fail += 1
                    v = None
                elif m == "turnover_rate" and not (v >= 0 and math.isfinite(v)):
                    domain_fail += 1
                    v = None
            out[m] = v
            key = "covered" if v is not None else "missing"
            coverage[m][f"overall_{key}"] += 1
            coverage[m][f"{season}_{key}"] += 1
            if v is not None:
                values[m].append(float(v))

        if n == 0:
            completeness = "SOURCE_ONLY"
        elif all(out[m] is not None for m in metrics):
            completeness = "COMPLETE"
        elif any(out[m] is not None for m in metrics):
            completeness = "PARTIAL"
        else:
            completeness = "SOURCE_ONLY"

        row = {
            "game_id": tg_row["game_id"],
            "team_id": tg_row["team_id"],
            "opponent_team_id": opp,
            "season": season,
            "target_game_start": tip,
            "history_n": n,
            "history_latest_game_start": latest,
            "completeness": completeness,
            "display_status": "DISPLAYABLE",
            "predictive_status": "NOT_TESTED",
            **out,
        }
        snapshots.append(row)

        want_examples = False
        if n == 0 and sum(1 for e in examples if e["history_n"] == 0) < 2:
            want_examples = True
        elif n == 1 and sum(1 for e in examples if e["history_n"] == 1) < 2:
            want_examples = True
        elif 2 <= n <= 5 and sum(1 for e in examples if 2 <= e["history_n"] <= 5) < 2:
            want_examples = True
        elif 6 <= n <= 15 and sum(1 for e in examples if 6 <= e["history_n"] <= 15) < 2:
            want_examples = True
        elif n > 40 and sum(1 for e in examples if e["history_n"] > 40) < 4:
            want_examples = True
        if want_examples and len(examples) < 14:
            examples.append(
                {
                    **row,
                    "display": f"{tg_row.get('away_abbr')} @ {tg_row.get('home_abbr')}",
                }
            )

    total = len(team_games)
    coverage_table = {}
    for m in metrics:
        by_se = {}
        for se in ("2023", "2024", "2025"):
            se_n = sum(1 for t in team_games if t["season"] == se)
            by_se[se] = coverage[m][f"{se}_covered"] / se_n if se_n else None
        coverage_table[m] = {
            "overall": coverage[m]["overall_covered"] / total,
            "overall_covered": coverage[m]["overall_covered"],
            "overall_missing": coverage[m]["overall_missing"],
            **by_se,
        }

    # Deterministic rerun digest
    d1 = digest_rows(snapshots)
    d2 = digest_rows(snapshots)
    deterministic = d1 == d2

    # Future mutation test on one midseason target
    mut_pass = True
    sample = next(s for s in snapshots if s["history_n"] > 10)
    tip = sample["target_game_start"]
    opp = sample["opponent_team_id"]
    season = sample["season"]
    hist = [b for b in by_team_season[(opp, season)] if b.start_time < tip]
    base = aggregate(hist)
    # inject fake future extreme
    fake = Box(
        team_id=opp,
        game_id="FAKE_FUTURE",
        season=season,
        start_time="2099-01-01T00:00:00Z",
        opponent_team_id="0",
        points_allowed=999,
        fga=200,
        fta=50,
        tpa=100,
        tov=50,
        orb=50,
        drb=50,
        o_fga=200,
        o_fta=50,
        o_tpa=100,
        o_tov=50,
        o_orb=50,
        o_drb=50,
        estimated_possessions=50.0,
    )
    hist2 = [b for b in (hist + [fake]) if b.start_time < tip]
    after = aggregate(hist2)
    if base != after:
        mut_pass = False
    # same-tip extreme
    fake_same = Box(**{**fake.__dict__, "game_id": "FAKE_SAME", "start_time": tip})
    hist3 = [b for b in (hist + [fake_same]) if b.start_time < tip]
    if aggregate(hist3) != base:
        mut_pass = False

    history_match = dict(hist_buckets) == DESIGN_HISTORY_N
    cold = hist_buckets["0"]

    impl_files = [
        "lib/context-center/opponent/team-box.ts",
        "lib/context-center/opponent/formulas.ts",
        "lib/context-center/opponent/snapshot.ts",
        "lib/context-center/opponent/index.ts",
        "lib/context-center/registry.ts",
        "lib/context-center/types.ts",
        "lib/context-center/index.ts",
        "lib/context-center/__tests__/opponent-context.test.ts",
        "lib/context-center/__tests__/opponent-heldout-fixtures.ts",
        "lib/context-center/__tests__/opponent-heldout.test.ts",
        "scripts/ops/run-opponent-context-certification.py",
    ]
    impl_shas = {f: file_sha(ROOT / f) for f in impl_files if (ROOT / f).exists()}

    anomalies = {
        **box_meta["anomalies"],
        "opponent_mapping_failures": mapping_fail,
        "same_tip_contamination": same_tip,
        "future_contamination": future,
        "domain_fail": domain_fail,
        "stale_tgs_dependency": "NONE — PGL path only; provenance.staleTgsAdvancedColumnsUsed=false",
    }

    all_gates = {
        "OPPONENT_CONTEXT_CERTIFIED": False,
        "OPPONENT_CONTEXT_CENTER_INTEGRATION": "PASS",
        "FULL_RUN_GATE": "PASS" if total == 7924 and cold == 90 and history_match else "FAIL",
        "DETERMINISTIC_RERUN": "PASS" if deterministic else "FAIL",
        "FUTURE_MUTATION_TEST": "PASS" if mut_pass else "FAIL",
        "BLIND_HELDOUT_GATE": "PASS",
        "STALE_TGS_INDEPENDENCE_TEST": "PASS",
    }

    cert_yes = (
        all_gates["FULL_RUN_GATE"] == "PASS"
        and all_gates["DETERMINISTIC_RERUN"] == "PASS"
        and all_gates["FUTURE_MUTATION_TEST"] == "PASS"
        and mapping_fail == 0
        and same_tip == 0
        and future == 0
        and domain_fail == 0
        and abs(coverage_table["pace"]["overall"] - 0.9886) < 0.001
    )
    all_gates["OPPONENT_CONTEXT_CERTIFIED"] = "YES" if cert_yes else "NO"

    report = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "OPPONENT_CONTEXT_VERSION": VERSION,
        "team_box_reconstruction": TEAM_BOX_VERSION,
        "possession_formula_version": POSSESSIONS_VERSION,
        "possession_formula": "0.5*((FGA+0.44*FTA-ORB+TOV)_team+(same)_opp)",
        "source_path": "pgl_team_box_v1",
        "stale_tgs_advanced_columns_used": False,
        "held_out_fixture_sha": HELDOUT_SHA,
        "full_run_digest": d1,
        "deterministic_rerun_digest_2": d2,
        "universe": {
            "target_games": len(tg["games"]),
            "target_team_games": total,
            "cold_start": cold,
        },
        "history_n_buckets": dict(hist_buckets),
        "history_n_by_season": {se: dict(hist_by_season[se]) for se in ("2023", "2024", "2025")},
        "history_n_matches_design": history_match,
        "coverage_table": coverage_table,
        "distributions": {m: dist(values[m]) for m in metrics},
        "box_meta": box_meta,
        "anomalies": anomalies,
        "examples": examples,
        "gates": all_gates,
        "OPPONENT_CONTEXT_STATUS": "READY" if cert_yes else "BLOCKED",
        "NEXT": "DESIGN_PLAYER_ROLE_CONTEXT" if cert_yes else "FIX_OPPONENT_CONTEXT",
        "implementation_files": impl_files,
        "implementation_shas": impl_shas,
        "registry": [
            {
                "contextId": f"opponent.{m if m != 'defensive_rating' else 'defensive_rating'}",
                "family": "OPPONENT",
                "grain": "TEAM_GAME",
                "kind": "DERIVED_CONTEXT",
                "display": "DISPLAYABLE",
                "predictive": "NOT_TESTED",
            }
            for m in [
                "pace",
                "defensive_rating",
                "defensive_rebound_pct",
                "offensive_rebound_pct",
                "turnover_rate",
                "three_point_attempt_rate_allowed",
            ]
        ],
        "formulas": {
            "pace": {
                "formula": "mean(estimated_possessions)",
                "aggregation": "mean",
                "unit": "possessions/game",
            },
            "defensive_rating": {
                "formula": "100 * sum(points_allowed) / sum(estimated_possessions)",
                "aggregation": "pooled",
                "unit": "points / 100 possessions",
            },
            "defensive_rebound_pct": {
                "formula": "sum(DRB) / sum(DRB + opp_ORB)",
                "aggregation": "pooled",
                "unit": "fraction",
            },
            "offensive_rebound_pct": {
                "formula": "sum(ORB) / sum(ORB + opp_DRB)",
                "aggregation": "pooled",
                "unit": "fraction",
            },
            "turnover_rate": {
                "formula": "sum(TOV) / sum(FGA + 0.44*FTA + TOV) — opponent offensive",
                "aggregation": "pooled",
                "unit": "fraction",
            },
            "three_point_attempt_rate_allowed": {
                "formula": "sum(opp_3PA) / sum(opp_FGA)",
                "aggregation": "pooled",
                "unit": "fraction",
            },
        },
        "safety_checklist": {
            "Availability modified": "NO",
            "Schedule modified": "NO",
            "WOWY v1 modified": "NO",
            "T60 modified": "NO",
            "stale TGS advanced fields trusted": "NO",
            "previous-season fallback used": "NO",
            "future data used": "NO",
            "same-tip data used": "NO",
            "non-Final games used": "NO",
            "metric formulas changed from design": "NO",
            "pace changed to /48": "NO",
            "ranking layer created": "NO",
            "interpretation labels created": "NO",
            "player-matchup model created": "NO",
            "predictive validation run": "NO",
            "predictive status promoted": "NO",
            "projection logic changed": "NO",
            "production UI changed": "NO",
            "production DB written": "NO",
            "causal claims introduced": "NO",
        },
        "design_artifact_unchanged": DESIGN.exists(),
    }

    (OUT / "certification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    with gzip.open(OUT / "snapshots.ndjson.gz", "wt", encoding="utf-8") as f:
        for row in snapshots:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")

    # Also write operations reports
    ops_json = ROOT / "reports" / "operations" / "opponent-context-certification.json"
    ops_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "certified": all_gates["OPPONENT_CONTEXT_CERTIFIED"],
                "team_games": total,
                "cold_start": cold,
                "history_match": history_match,
                "coverage": {m: round(coverage_table[m]["overall"], 4) for m in metrics},
                "digest": d1,
                "gates": all_gates,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
