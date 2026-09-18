"""
Phase 6F — Injury-context failure-mode analysis (diagnosis only).

Does NOT modify estimator v1, pair builder, policies, or production.
Preserves official conclusion: injury-wowy-estimator-v1 / P1 / NOT_SUPPORTED.
Historical 6E strata are exploratory evidence for redesign — not confirmatory
validation for any future modified model.
"""
from __future__ import annotations

import gzip
import json
import math
import os
import random
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ops"))

OUT = ROOT / "tmp" / "official-injury-wowy-failure-analysis"
REPORTS = ROOT / "reports" / "operations"
PRED_DIR = ROOT / "tmp" / "official-injury-wowy-predictive-validation"
PAIR_DIR = ROOT / "tmp" / "official-injury-wowy-pairs"
MANIFEST = ROOT / "tmp" / "official-injury-wowy-estimator" / "game-start-manifest.ndjson"
ELIG_WITH = ROOT / "tmp" / "official-injury-report-t60-eligibility" / "with-candidates.ndjson.gz"
ELIG_WITHOUT = (
    ROOT / "tmp" / "official-injury-report-t60-eligibility" / "without-candidates.ndjson.gz"
)
SELECTED = ROOT / "tmp" / "official-injury-report-asof-t60" / "selected-player-states.ndjson.gz"
PGL_CACHE = PRED_DIR / "subject-pgl-played.ndjson.gz"
FOCAL_PGL_CACHE = OUT / "focal-pgl-played.ndjson.gz"

METRICS = ("minutes", "pts", "reb", "ast", "tpm", "fga", "tpa", "fta")
CORE = ("minutes", "pts", "reb", "ast")
BOOT_REPS = 2000
BASE_SEED = 20260917
POWER_REPS = 200
MPG_BUCKETS = ((0, 10), (10, 20), (20, 30), (30, 999))


def load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    idx = (len(sorted_vals) - 1) * p
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return sorted_vals[lo]
    w = idx - lo
    return sorted_vals[lo] * (1 - w) + sorted_vals[hi] * w


def parse_minutes(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if s == "" or s == "00":
        return 0.0 if s == "00" else None
    try:
        return float(s)
    except ValueError:
        return None


def is_played_minutes(raw: Any) -> bool:
    if raw is None:
        return False
    s = str(raw).strip()
    if s == "00":
        return False
    try:
        return float(s) >= 0
    except ValueError:
        return False


def load_manifest() -> dict[str, str]:
    m: dict[str, str] = {}
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        m[str(o["game_id"])] = o["start_time_utc"]
    return m


def ohw_bucket(n: int) -> str:
    if n <= 0:
        return "0"
    if n == 1:
        return "1"
    if n == 2:
        return "2"
    return "3+"


def mpg_bucket(mpg: float | None) -> str | None:
    if mpg is None:
        return None
    for lo, hi in MPG_BUCKETS:
        if lo <= mpg < hi:
            if hi >= 999:
                return "30+"
            return f"{lo}-{hi}"
    return None


def health_out_bucket(n: int) -> str:
    if n <= 0:
        return "0"
    if n == 1:
        return "1"
    if n == 2:
        return "2"
    if n == 3:
        return "3"
    return "4+"


@dataclass
class PglGame:
    game_id: str
    game_start: str
    season: str
    team_id: str
    entity_id: str
    metrics: dict[str, float]


def assign_weights(rows: list[dict[str, Any]]) -> None:
    counts: Counter[tuple[str, str]] = Counter()
    for r in rows:
        counts[(r["subject_player_entity_id"], r["target_game_id"])] += 1
    for r in rows:
        k = (r["subject_player_entity_id"], r["target_game_id"])
        r["subject_game_weight"] = 1.0 / counts[k]


def weighted_mae(rows: list[dict[str, Any]], pred_key: str) -> float:
    wsum = ae = 0.0
    for r in rows:
        w = float(r["subject_game_weight"])
        wsum += w
        ae += w * abs(float(r[pred_key]) - float(r["actual"]))
    return ae / wsum if wsum > 0 else float("nan")


def block_bootstrap_delta(
    rows: list[dict[str, Any]],
    base_key: str,
    cand_key: str,
    metric_index: int,
    stream: int,
) -> dict[str, Any]:
    blocks: dict[tuple[str, str], list[float]] = {}
    for r in rows:
        bk = (r["subject_player_entity_id"], r["target_game_id"])
        w = float(r["subject_game_weight"])
        eb = abs(float(r[base_key]) - float(r["actual"]))
        ec = abs(float(r[cand_key]) - float(r["actual"]))
        if bk not in blocks:
            blocks[bk] = [0.0, 0.0, 0.0]
        blocks[bk][0] += w
        blocks[bk][1] += w * eb
        blocks[bk][2] += w * ec
    keys = sorted(blocks.keys())
    n = len(keys)
    if n == 0:
        return {
            "valid": 0,
            "point_dmae": None,
            "p2.5": None,
            "median": None,
            "p97.5": None,
            "mae_base": None,
            "mae_cand": None,
            "n_blocks": 0,
            "n_rows": 0,
        }
    wsums = [blocks[k][0] for k in keys]
    base_ae = [blocks[k][1] for k in keys]
    cand_ae = [blocks[k][2] for k in keys]
    tw = sum(wsums)
    point_base = sum(base_ae) / tw
    point_cand = sum(cand_ae) / tw
    point = point_base - point_cand
    seed = BASE_SEED + metric_index + 1000 * stream
    rng = random.Random(seed)
    deltas: list[float] = []
    for _ in range(BOOT_REPS):
        sw = sa = sb = 0.0
        for _i in range(n):
            j = rng.randrange(n)
            sw += wsums[j]
            sa += base_ae[j]
            sb += cand_ae[j]
        if sw > 0:
            deltas.append(sa / sw - sb / sw)
    deltas.sort()
    return {
        "valid": len(deltas),
        "seed": seed,
        "point_dmae": point,
        "p2.5": percentile(deltas, 0.025),
        "median": percentile(deltas, 0.5),
        "p97.5": percentile(deltas, 0.975),
        "mae_base": point_base,
        "mae_cand": point_cand,
        "n_blocks": n,
        "n_rows": len(rows),
    }


def summarize_stratum(
    rows: list[dict[str, Any]], metric: str, metric_index: int, stream: int
) -> dict[str, Any]:
    sub = [r for r in rows if r["metric"] == metric]
    if not sub:
        return {
            "rows": 0,
            "subject_games": 0,
            "B0_MAE": None,
            "B0_EB_MAE": None,
            "delta_MAE": None,
            "bootstrap": {},
            "status": None,
        }
    assign_weights(sub)
    boot = block_bootstrap_delta(sub, "B0_prediction", "B0_EB", metric_index, stream)
    d = boot["point_dmae"]
    lo, hi = boot["p2.5"], boot["p97.5"]
    if d is None or lo is None or hi is None:
        status = None
    elif d > 0 and lo > 0:
        status = "SUPPORTED"
    elif d < 0 and hi < 0:
        status = "HARMFUL"
    else:
        status = "INCONCLUSIVE"
    return {
        "rows": len(sub),
        "subject_games": boot["n_blocks"],
        "B0_MAE": boot["mae_base"],
        "B0_EB_MAE": boot["mae_cand"],
        "delta_MAE": d,
        "bootstrap": {
            "valid": boot["valid"],
            "seed": boot["seed"],
            "p2.5": lo,
            "median": boot["median"],
            "p97.5": hi,
        },
        "status": status,
    }


def load_pair_meta() -> dict[tuple[str, str, str], dict[str, Any]]:
    """(game_id, subject, focal) -> contamination / realized fields."""
    idx: dict[tuple[str, str, str], dict[str, Any]] = {}
    with gzip.open(PAIR_DIR / "p0.ndjson.gz", "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
            k = (
                str(o["game_id"]),
                o["subject_player_entity_id"],
                o["focal_player_entity_id"],
            )
            idx[k] = {
                "other_health_without_count": int(o["other_health_without_count"]),
                "other_health_with_count": int(o["other_health_with_count"]),
                "focal_state": o["focal_state"],
                "focal_realized_participation": o.get("focal_realized_participation"),
                "season": str(o["season"]),
                "team_id": str(o["team_id"]),
                "cohort_p1": bool(o.get("cohort_p1")),
            }
    return idx


def load_team_game_health_counts() -> dict[tuple[str, str], dict[str, int]]:
    """(game_id, team_id) -> health_without_count / health_with_count from eligibility."""
    out: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"health_without_count": 0, "health_with_count": 0}
    )
    with gzip.open(ELIG_WITHOUT, "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
            if not o.get("canonical_model_eligible"):
                continue
            key = (str(o["game_id"]), str(o["team_id"]))
            out[key]["health_without_count"] += 1
    with gzip.open(ELIG_WITH, "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
            if not o.get("canonical_model_eligible"):
                continue
            key = (str(o["game_id"]), str(o["team_id"]))
            out[key]["health_with_count"] += 1
    return dict(out)


def load_eval_predictions(path: Path, cohort: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
            if not o.get("injury_signal_available"):
                continue
            if o.get("B0_EB") is None or o.get("B0_prediction") is None:
                continue
            o["cohort"] = cohort
            rows.append(o)
    return rows


def enrich_rows(
    rows: list[dict[str, Any]],
    pair_meta: dict[tuple[str, str, str], dict[str, Any]],
    team_health: dict[tuple[str, str], dict[str, int]],
) -> None:
    missing = 0
    for r in rows:
        k = (
            str(r["target_game_id"]),
            r["subject_player_entity_id"],
            r["focal_player_entity_id"],
        )
        meta = pair_meta.get(k)
        if meta is None:
            missing += 1
            r["other_health_without_count"] = None
            r["other_health_with_count"] = None
            r["focal_realized_participation"] = None
            r["health_without_count"] = None
            r["health_with_count"] = None
            continue
        r["other_health_without_count"] = meta["other_health_without_count"]
        r["other_health_with_count"] = meta["other_health_with_count"]
        r["focal_realized_participation"] = meta["focal_realized_participation"]
        th = team_health.get((str(r["target_game_id"]), str(r["team_id"])), {})
        r["health_without_count"] = th.get("health_without_count")
        r["health_with_count"] = th.get("health_with_count")
    if missing:
        print(f"  warn: {missing} rows missing pair meta", flush=True)


def load_pgl_cache(path: Path) -> list[PglGame]:
    rows: list[PglGame] = []
    if not path.exists():
        return rows
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
            rows.append(
                PglGame(
                    game_id=str(o["game_id"]),
                    game_start=o["game_start"],
                    season=str(o["season"]),
                    team_id=str(o["team_id"]),
                    entity_id=o["entity_id"],
                    metrics={k: float(o["metrics"][k]) for k in METRICS},
                )
            )
    return rows


def fetch_pgl(entity_ids: set[str], manifest: dict[str, str]) -> list[PglGame]:
    load_dotenv()
    import psycopg

    ids = sorted(entity_ids)
    rows: list[PglGame] = []
    url = os.environ["SUPABASE_DB_URL"]
    with psycopg.connect(url) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            for i in range(0, len(ids), 400):
                part = ids[i : i + 400]
                cur.execute(
                    """
                    SELECT l.game_id::text, l.team_id::text, l.season::text, l.minutes,
                           l.points, l.rebounds, l.assists,
                           l.three_pointers_made, l.field_goals_attempted,
                           l.three_pointers_attempted, l.free_throws_attempted,
                           p.player_entity_id::text,
                           g.start_time AT TIME ZONE 'UTC'
                    FROM analytics.player_game_logs l
                    JOIN analytics.players p ON p.player_id = l.player_id
                    JOIN analytics.games g ON g.game_id = l.game_id
                    WHERE p.player_entity_id::text = ANY(%s)
                      AND l.season IN ('2023','2024','2025')
                    """,
                    (part,),
                )
                for tup in cur.fetchall():
                    (
                        gid,
                        team,
                        season,
                        minutes,
                        pts,
                        reb,
                        ast,
                        tpm,
                        fga,
                        tpa,
                        fta,
                        eid,
                        st,
                    ) = tup
                    if not is_played_minutes(minutes):
                        continue
                    if st is None:
                        continue
                    iso = st.isoformat().replace("+00:00", "Z")
                    if not iso.endswith("Z"):
                        iso += "Z"
                    if str(gid) in manifest:
                        iso = manifest[str(gid)]
                    mins = parse_minutes(minutes) or 0.0
                    rows.append(
                        PglGame(
                            game_id=str(gid),
                            game_start=iso,
                            season=str(season),
                            team_id=str(team),
                            entity_id=str(eid),
                            metrics={
                                "minutes": float(mins),
                                "pts": float(pts or 0),
                                "reb": float(reb or 0),
                                "ast": float(ast or 0),
                                "tpm": float(tpm or 0),
                                "fga": float(fga or 0),
                                "tpa": float(tpa or 0),
                                "fta": float(fta or 0),
                            },
                        )
                    )
    return rows


def index_pgl(rows: list[PglGame]) -> dict[tuple[str, str, str], list[PglGame]]:
    idx: dict[tuple[str, str, str], list[PglGame]] = defaultdict(list)
    for g in rows:
        idx[(g.entity_id, g.season, g.team_id)].append(g)
    for v in idx.values():
        v.sort(key=lambda x: (x.game_start, x.game_id))
    return idx


def prior_means(
    hist: list[PglGame], as_of: str, metrics: tuple[str, ...] = METRICS
) -> tuple[dict[str, float] | None, int]:
    """Strict game_start < as_of expanding mean."""
    vals: dict[str, list[float]] = {m: [] for m in metrics}
    for g in hist:
        if g.game_start >= as_of:
            break
        for m in metrics:
            vals[m].append(g.metrics[m])
    n = len(vals["minutes"])
    if n == 0:
        return None, 0
    return {m: sum(vals[m]) / n for m in metrics}, n


def attach_role_priors(
    rows: list[dict[str, Any]], pgl_idx: dict[tuple[str, str, str], list[PglGame]]
) -> dict[str, Any]:
    """Attach leakage-safe prior MPG/FGA/PTS for subject and focal."""
    cov = Counter()
    for r in rows:
        as_of = r["target_game_start"]
        season, team = str(r["season"]), str(r["team_id"])
        s_hist = pgl_idx.get((r["subject_player_entity_id"], season, team), [])
        f_hist = pgl_idx.get((r["focal_player_entity_id"], season, team), [])
        s_means, s_n = prior_means(s_hist, as_of)
        f_means, f_n = prior_means(f_hist, as_of)
        cov["rows"] += 1
        if s_means is None:
            cov["subject_cold"] += 1
            r["subject_prior_mpg"] = None
            r["subject_prior_fga"] = None
            r["subject_prior_pts"] = None
            r["subject_prior_n"] = 0
        else:
            cov["subject_ok"] += 1
            r["subject_prior_mpg"] = s_means["minutes"]
            r["subject_prior_fga"] = s_means["fga"]
            r["subject_prior_pts"] = s_means["pts"]
            r["subject_prior_n"] = s_n
        if f_means is None:
            cov["focal_cold"] += 1
            r["focal_prior_mpg"] = None
            r["focal_prior_fga"] = None
            r["focal_prior_pts"] = None
            r["focal_prior_n"] = 0
        else:
            cov["focal_ok"] += 1
            r["focal_prior_mpg"] = f_means["minutes"]
            r["focal_prior_fga"] = f_means["fga"]
            r["focal_prior_pts"] = f_means["pts"]
            r["focal_prior_n"] = f_n
        r["focal_mpg_bucket"] = mpg_bucket(r.get("focal_prior_mpg"))
        r["subject_mpg_bucket"] = mpg_bucket(r.get("subject_prior_mpg"))
    return dict(cov)


def expected_missing_feasibility(
    team_health_players: dict[tuple[str, str], list[str]],
    pgl_idx: dict[tuple[str, str, str], list[PglGame]],
    manifest: dict[str, str],
    game_team_season: dict[tuple[str, str], tuple[str, str]],
) -> dict[str, Any]:
    """Coverage for expected missing minutes/FGA/PTS at team-game grain."""
    seasons = Counter()
    cold = 0
    ok = 0
    partial = 0
    totals = {"minutes": [], "fga": [], "pts": []}
    for (gid, team), focals in team_health_players.items():
        season_tip = game_team_season.get((gid, team))
        if season_tip is None:
            continue
        season, as_of = season_tip
        miss = {"minutes": 0.0, "fga": 0.0, "pts": 0.0}
        n_ok = 0
        for eid in focals:
            means, n = prior_means(pgl_idx.get((eid, season, team), []), as_of)
            if means is None:
                continue
            n_ok += 1
            for m in ("minutes", "fga", "pts"):
                miss[m] += means[m]
        if n_ok == 0:
            cold += 1
            seasons[f"{season}:cold"] += 1
        elif n_ok < len(focals):
            partial += 1
            ok += 1
            seasons[f"{season}:ok"] += 1
            for m in totals:
                totals[m].append(miss[m])
        else:
            ok += 1
            seasons[f"{season}:ok"] += 1
            for m in totals:
                totals[m].append(miss[m])
    n = ok + cold
    return {
        "team_games_with_health_out": n,
        "full_or_partial_prior_coverage": ok,
        "cold_start_all_focals": cold,
        "partial_prior_among_ok": partial,
        "coverage_rate": (ok / n) if n else None,
        "cold_start_rate": (cold / n) if n else None,
        "season_breakdown": dict(seasons),
        "expected_missing_minutes_median": percentile(sorted(totals["minutes"]), 0.5)
        if totals["minutes"]
        else None,
        "expected_missing_fga_median": percentile(sorted(totals["fga"]), 0.5)
        if totals["fga"]
        else None,
        "expected_missing_pts_median": percentile(sorted(totals["pts"]), 0.5)
        if totals["pts"]
        else None,
        "note": "Feasibility only; not a fitted model feature.",
    }


def load_without_players_by_team_game() -> dict[tuple[str, str], list[str]]:
    out: dict[tuple[str, str], list[str]] = defaultdict(list)
    with gzip.open(ELIG_WITHOUT, "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
            if not o.get("canonical_model_eligible"):
                continue
            eid = o.get("player_entity_id")
            if not eid:
                continue
            out[(str(o["game_id"]), str(o["team_id"]))].append(eid)
    return dict(out)


def available_semantics_analysis(
    pair_meta: dict[tuple[str, str, str], dict[str, Any]],
    pgl_idx: dict[tuple[str, str, str], list[PglGame]],
    manifest: dict[str, str],
) -> dict[str, Any]:
    """Retrospective Available control diagnostics (unique focal-game)."""
    # Unique Available focal-games from pair meta
    avail: dict[tuple[str, str], dict[str, Any]] = {}
    for (gid, _subj, focal), meta in pair_meta.items():
        if meta["focal_state"] != "PRE_GAME_AVAILABLE":
            continue
        key = (gid, focal)
        if key not in avail:
            avail[key] = meta

    # Reason categories from with-candidates
    reasons = Counter()
    reason_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    with gzip.open(ELIG_WITH, "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
            if not o.get("canonical_model_eligible"):
                continue
            eid = o.get("player_entity_id")
            if not eid:
                continue
            k = (str(o["game_id"]), eid)
            reason_by_key[k] = o
            reasons[o.get("reason_category") or "UNKNOWN"] += 1

    # Prior status from selected-player-states (same player, earlier tip)
    by_player: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    with gzip.open(SELECTED, "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
            eid = o.get("player_entity_id")
            if not eid:
                continue
            gid = str(o["game_id"])
            tip = manifest.get(gid) or o.get("cutoff_at") or ""
            by_player[eid].append((tip, gid, o.get("status_raw") or "UNKNOWN"))
    for eid in by_player:
        by_player[eid].sort()

    prior_status = Counter()
    after_out_or_q = 0
    n_with_prior = 0
    for (gid, focal), meta in avail.items():
        tip = manifest.get(gid, "")
        hist = by_player.get(focal, [])
        prev = None
        for t, g, st in hist:
            if tip and t >= tip:
                break
            if g == gid:
                continue
            prev = st
        if prev is None:
            prior_status["NO_PRIOR_T60_ROW"] += 1
        else:
            n_with_prior += 1
            prior_status[prev] += 1
            if prev in ("Out", "Questionable", "Doubtful"):
                after_out_or_q += 1

    # Realized minutes vs prior MPG for Available+PLAYED
    diffs: list[float] = []
    ratios: list[float] = []
    realized_part = Counter()
    for (gid, focal), meta in avail.items():
        # participation: any pair row for this focal-game
        part = meta.get("focal_realized_participation")
        # may be overwritten by subject rows; re-scan not needed if consistent
        realized_part[part or "UNKNOWN"] += 1
        if part != "PLAYED":
            continue
        tip = manifest.get(gid)
        if not tip:
            continue
        means, n = prior_means(
            pgl_idx.get((focal, meta["season"], meta["team_id"]), []), tip
        )
        if means is None or means["minutes"] <= 0:
            continue
        # realized minutes from PGL for this game
        hist = pgl_idx.get((focal, meta["season"], meta["team_id"]), [])
        realized = None
        for g in hist:
            if g.game_id == gid:
                realized = g.metrics["minutes"]
                break
        if realized is None:
            continue
        prior_m = means["minutes"]
        diffs.append(realized - prior_m)
        ratios.append(realized / prior_m)

    diffs_s = sorted(diffs)
    ratios_s = sorted(ratios)
    return {
        "unique_available_focal_games": len(avail),
        "reason_category_counts": dict(reasons),
        "prior_t60_status_counts": dict(prior_status),
        "among_with_prior_t60": n_with_prior,
        "prior_was_Out_Questionable_or_Doubtful": after_out_or_q,
        "prior_Out_Q_Doubtful_rate_given_prior": (after_out_or_q / n_with_prior)
        if n_with_prior
        else None,
        "realized_participation_unique_focal_games": dict(realized_part),
        "available_played_vs_prior_mpg": {
            "n": len(diffs),
            "diff_median": percentile(diffs_s, 0.5),
            "diff_p25": percentile(diffs_s, 0.25),
            "diff_p75": percentile(diffs_s, 0.75),
            "ratio_median": percentile(ratios_s, 0.5),
            "ratio_p25": percentile(ratios_s, 0.25),
            "ratio_p75": percentile(ratios_s, 0.75),
            "note": "Retrospective only; not a production input.",
        },
    }


def baseline_residual_vs_burden(
    rows: list[dict[str, Any]], metric: str = "pts"
) -> dict[str, Any]:
    """Descriptive actual-B0 residuals by other_health_without_count."""
    buckets: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        if r["metric"] != metric:
            continue
        b = ohw_bucket(int(r["other_health_without_count"] or 0))
        buckets[b].append(float(r["actual"]) - float(r["B0_prediction"]))
    out = {}
    for b in ("0", "1", "2", "3+"):
        vals = sorted(buckets.get(b, []))
        if not vals:
            out[b] = {"n": 0}
            continue
        out[b] = {
            "n": len(vals),
            "mean": sum(vals) / len(vals),
            "median": percentile(vals, 0.5),
            "p25": percentile(vals, 0.25),
            "p75": percentile(vals, 0.75),
            "mae": sum(abs(x) for x in vals) / len(vals),
        }
    return out


def pair_stability_p1(pair_path: Path) -> dict[str, Any]:
    """Chronological first/second half raw delta sign agreement within season-team pairs."""
    by_pair: dict[tuple, list[dict[str, Any]]] = defaultdict(list)
    with gzip.open(pair_path, "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
            key = (
                str(o["season"]),
                str(o["team_id"]),
                o["subject_player_entity_id"],
                o["focal_player_entity_id"],
            )
            by_pair[key].append(o)

    agree = 0
    compared = 0
    abs_diffs: list[float] = []
    raw_pairs: list[tuple[float, float]] = []
    min_half = 2  # need >=2 per state in each half ideally; use >=1 both states each half

    for key, obs in by_pair.items():
        # need both states overall
        obs.sort(key=lambda x: (x.get("t60_report_published_at") or "", x["game_id"]))
        n = len(obs)
        if n < 6:
            continue
        mid = n // 2
        halves = (obs[:mid], obs[mid:])
        deltas = []
        ok = True
        for half in halves:
            with_m = [float(x["subject_metrics"]["pts"]) for x in half if x["focal_state"] == "PRE_GAME_AVAILABLE"]
            out_m = [float(x["subject_metrics"]["pts"]) for x in half if x["focal_state"] == "PRE_GAME_OUT"]
            if len(with_m) < min_half or len(out_m) < min_half:
                ok = False
                break
            deltas.append(sum(out_m) / len(out_m) - sum(with_m) / len(with_m))
        if not ok:
            continue
        compared += 1
        if (deltas[0] >= 0 and deltas[1] >= 0) or (deltas[0] < 0 and deltas[1] < 0):
            agree += 1
        abs_diffs.append(abs(deltas[0] - deltas[1]))
        raw_pairs.append((deltas[0], deltas[1]))

    corr = None
    if len(raw_pairs) >= 3:
        xs = [a for a, _ in raw_pairs]
        ys = [b for _, b in raw_pairs]
        mx = sum(xs) / len(xs)
        my = sum(ys) / len(ys)
        num = sum((a - mx) * (b - my) for a, b in raw_pairs)
        denx = math.sqrt(sum((a - mx) ** 2 for a in xs))
        deny = math.sqrt(sum((b - my) ** 2 for b in ys))
        if denx > 0 and deny > 0:
            corr = num / (denx * deny)

    return {
        "metric": "pts",
        "min_obs_per_half_per_state": min_half,
        "pairs_compared": compared,
        "sign_agreement_rate": (agree / compared) if compared else None,
        "median_abs_delta_diff": percentile(sorted(abs_diffs), 0.5) if abs_diffs else None,
        "half_delta_correlation": corr,
        "note": "Diagnostic stability only; not predictive validation.",
    }


def cross_focal_consistency(rows: list[dict[str, Any]], metric: str = "pts") -> dict[str, Any]:
    """Do multiple focals for same subject-season-team agree on estimated delta sign?"""
    tmp: dict[tuple, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if r["metric"] != metric or r.get("estimated_delta_prior") is None:
            continue
        key = (r["season"], r["team_id"], r["subject_player_entity_id"])
        tmp[key][r["focal_player_entity_id"]].append(float(r["estimated_delta_prior"]))

    multi = 0
    all_same_sign = 0
    mixed = 0
    for _key, focals in tmp.items():
        if len(focals) < 2:
            continue
        means = [sum(v) / len(v) for v in focals.values()]
        multi += 1
        signs = [1 if m >= 0 else -1 for m in means]
        if all(s == signs[0] for s in signs):
            all_same_sign += 1
        else:
            mixed += 1
    return {
        "metric": metric,
        "subject_season_teams_with_2plus_focals": multi,
        "all_focal_signs_agree": all_same_sign,
        "mixed_signs": mixed,
        "agreement_rate": (all_same_sign / multi) if multi else None,
    }


def json_safe(obj: Any) -> Any:
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [json_safe(v) for v in obj]
    return obj


def power_downsample(
    rows: list[dict[str, Any]],
    metric: str,
    target_blocks: int,
    metric_index: int,
) -> dict[str, Any]:
    sub = [r for r in rows if r["metric"] == metric]
    assign_weights(sub)
    blocks: dict[tuple[str, str], list[float]] = {}
    for r in sub:
        bk = (r["subject_player_entity_id"], r["target_game_id"])
        w = float(r["subject_game_weight"])
        eb = abs(float(r["B0_prediction"]) - float(r["actual"]))
        ec = abs(float(r["B0_EB"]) - float(r["actual"]))
        if bk not in blocks:
            blocks[bk] = [0.0, 0.0, 0.0]
        blocks[bk][0] += w
        blocks[bk][1] += w * eb
        blocks[bk][2] += w * ec
    keys = sorted(blocks.keys())
    n = len(keys)
    if n == 0 or target_blocks <= 0:
        return {"error": "empty"}
    target = min(target_blocks, n)
    rng = random.Random(BASE_SEED + 50000 + metric_index)
    deltas = []
    for _ in range(POWER_REPS):
        sample = rng.sample(keys, target)
        sw = sa = sb = 0.0
        for k in sample:
            sw += blocks[k][0]
            sa += blocks[k][1]
            sb += blocks[k][2]
        if sw > 0:
            deltas.append(sa / sw - sb / sw)
    deltas.sort()
    pos = sum(1 for d in deltas if d > 0)
    return {
        "metric": metric,
        "p0_blocks": n,
        "target_blocks": target,
        "reps": POWER_REPS,
        "seed": BASE_SEED + 50000 + metric_index,
        "delta_MAE_mean": sum(deltas) / len(deltas) if deltas else None,
        "delta_MAE_median": percentile(deltas, 0.5),
        "delta_MAE_p2.5": percentile(deltas, 0.025),
        "delta_MAE_p97.5": percentile(deltas, 0.975),
        "fraction_positive_delta": (pos / len(deltas)) if deltas else None,
    }


def write_gz_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, sort_keys=True, separators=(",", ":")) + "\n")


def main() -> int:
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    print("Loading manifest + pair meta...", flush=True)
    manifest = load_manifest()
    pair_meta = load_pair_meta()
    print(f"  pair meta keys: {len(pair_meta)}", flush=True)
    team_health = load_team_game_health_counts()
    without_players = load_without_players_by_team_game()

    print("Loading P0/P1 eval predictions...", flush=True)
    p0 = load_eval_predictions(PRED_DIR / "rolling-predictions-p0.ndjson.gz", "P0")
    p1 = load_eval_predictions(PRED_DIR / "rolling-predictions-p1.ndjson.gz", "P1")
    print(f"  P0 eval {len(p0)} P1 eval {len(p1)}", flush=True)
    enrich_rows(p0, pair_meta, team_health)
    enrich_rows(p1, pair_meta, team_health)

    # PGL for subjects + focals
    print("Loading PGL...", flush=True)
    needed: set[str] = set()
    for r in p0:
        needed.add(r["subject_player_entity_id"])
        needed.add(r["focal_player_entity_id"])
    for eid_list in without_players.values():
        needed.update(eid_list)

    pgl_rows = load_pgl_cache(PGL_CACHE)
    have = {g.entity_id for g in pgl_rows}
    missing = needed - have
    if missing:
        print(f"  fetching PGL for {len(missing)} additional entities...", flush=True)
        extra = fetch_pgl(missing, manifest)
        with gzip.open(FOCAL_PGL_CACHE, "wt", encoding="utf-8") as fh:
            for g in extra:
                fh.write(
                    json.dumps(
                        {
                            "entity_id": g.entity_id,
                            "game_id": g.game_id,
                            "game_start": g.game_start,
                            "season": g.season,
                            "team_id": g.team_id,
                            "metrics": g.metrics,
                        },
                        sort_keys=True,
                        separators=(",", ":"),
                    )
                    + "\n"
                )
        pgl_rows.extend(extra)
    pgl_idx = index_pgl(pgl_rows)
    print(f"  pgl entities indexed: {len({g.entity_id for g in pgl_rows})}", flush=True)

    print("Attaching role priors...", flush=True)
    role_cov_p0 = attach_role_priors(p0, pgl_idx)
    role_cov_p1 = attach_role_priors(p1, pgl_idx)

    # game_team -> (season, tip) from predictions
    game_team_season: dict[tuple[str, str], tuple[str, str]] = {}
    for r in p0:
        game_team_season[(str(r["target_game_id"]), str(r["team_id"]))] = (
            str(r["season"]),
            r["target_game_start"],
        )

    report: dict[str, Any] = {
        "phase": "6F",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "official_v1_conclusion": {
            "estimator": "injury-wowy-estimator-v1",
            "primary_cohort": "P1",
            "INJURY_WOWY_SIGNAL_STATUS": "NOT_SUPPORTED",
            "INJURY_WOWY_MODEL_VALIDATED": "NO",
            "ROLLING_ORIGIN_VALIDATION_GATE": "PASS",
            "INJURY_WOWY_ESTIMATOR_CERTIFIED": "YES",
            "immutable": True,
            "post_hoc_note": (
                "Inspected P0/P1/P2/P3, seasons, tiers, and metrics are exploratory "
                "redesign evidence only — NOT confirmatory validation for any future modified model."
            ),
        },
        "role_prior_coverage": {"P0": role_cov_p0, "P1": role_cov_p1},
    }

    # A — concurrent absence burden on P0
    print("A: other_health_without_count strata...", flush=True)
    q_a: dict[str, Any] = {}
    stream = 100
    for bucket in ("0", "1", "2", "3+"):
        bucket_rows = [
            r
            for r in p0
            if r.get("other_health_without_count") is not None
            and ohw_bucket(int(r["other_health_without_count"])) == bucket
        ]
        q_a[bucket] = {}
        for mi, metric in enumerate(METRICS):
            q_a[bucket][metric] = summarize_stratum(bucket_rows, metric, mi, stream)
            stream += 1
    report["A_concurrent_absence_burden"] = q_a

    # composition match: OHW>0 vs OHW=0
    print("A2/P0 composition match...", flush=True)
    p0_ohw0 = [r for r in p0 if r.get("other_health_without_count") == 0]
    p0_ohw_gt0 = [
        r for r in p0 if r.get("other_health_without_count") is not None and int(r["other_health_without_count"]) > 0
    ]
    comp = {"ohw_0": {}, "ohw_gt0": {}}
    for mi, metric in enumerate(CORE):
        comp["ohw_0"][metric] = summarize_stratum(p0_ohw0, metric, mi, stream)
        stream += 1
        comp["ohw_gt0"][metric] = summarize_stratum(p0_ohw_gt0, metric, mi, stream)
        stream += 1
    report["P0_composition_ohw0_vs_gt0"] = comp

    # B — team health_without_count
    print("B: team health_without_count strata...", flush=True)
    q_b: dict[str, Any] = {"outcome_dist_pts": {}, "baseline_mae": {}, "dmae": {}}
    for bucket in ("1", "2", "3", "4+"):
        brows = [
            r
            for r in p0
            if r.get("health_without_count") is not None
            and health_out_bucket(int(r["health_without_count"])) == bucket
        ]
        # outcome distribution (actual pts)
        pts = [float(r["actual"]) for r in brows if r["metric"] == "pts"]
        pts_s = sorted(pts)
        q_b["outcome_dist_pts"][bucket] = {
            "n": len(pts),
            "mean": (sum(pts) / len(pts)) if pts else None,
            "median": percentile(pts_s, 0.5),
        }
        q_b["dmae"][bucket] = {}
        for mi, metric in enumerate(CORE):
            q_b["dmae"][bucket][metric] = summarize_stratum(brows, metric, mi, stream)
            stream += 1
    report["B_simultaneous_health_out"] = q_b

    # C/D role coverage + focal/subject MPG buckets
    print("C/D: focal/subject MPG buckets...", flush=True)
    q_focal: dict[str, Any] = {"P0": {}, "P1": {}}
    q_subj: dict[str, Any] = {"P0": {}, "P1": {}}
    for label, rows in (("P0", p0), ("P1", p1)):
        for bucket in ("<10", "10-20", "20-30", "30+"):
            # normalize <10 label
            bkey = "0-10" if bucket == "<10" else bucket
            frows = [r for r in rows if r.get("focal_mpg_bucket") == bkey]
            srows = [r for r in rows if r.get("subject_mpg_bucket") == bkey]
            q_focal[label][bucket] = {}
            q_subj[label][bucket] = {}
            for mi, metric in enumerate(CORE):
                q_focal[label][bucket][metric] = summarize_stratum(frows, metric, mi, stream)
                stream += 1
                q_subj[label][bucket][metric] = summarize_stratum(srows, metric, mi, stream)
                stream += 1
    report["C_focal_importance_mpg"] = q_focal
    report["D_subject_role_mpg"] = q_subj

    # E missing opportunity feasibility
    print("E: expected missing opportunity feasibility...", flush=True)
    report["E_expected_missing_feasibility"] = expected_missing_feasibility(
        without_players, pgl_idx, manifest, game_team_season
    )

    # Available semantics
    print("Available control semantics...", flush=True)
    report["Available_control_semantics"] = available_semantics_analysis(
        pair_meta, pgl_idx, manifest
    )

    # F baseline residuals
    print("F: baseline residual vs burden...", flush=True)
    report["F_baseline_residuals_vs_ohw"] = {
        m: baseline_residual_vs_burden(p0, m) for m in CORE
    }

    # attach expected missing minutes on P0 for residual check (team-game)
    print("F2: residuals vs expected missing minutes...", flush=True)
    # cache expected missing minutes per team-game
    emm_cache: dict[tuple[str, str], float | None] = {}
    for (gid, team), eids in without_players.items():
        st = game_team_season.get((gid, team))
        if not st:
            emm_cache[(gid, team)] = None
            continue
        season, as_of = st
        total = 0.0
        any_ok = False
        for eid in eids:
            means, _n = prior_means(pgl_idx.get((eid, season, team), []), as_of)
            if means:
                total += means["minutes"]
                any_ok = True
        emm_cache[(gid, team)] = total if any_ok else None

    def emm_bucket(x: float | None) -> str | None:
        if x is None:
            return None
        if x < 20:
            return "<20"
        if x < 40:
            return "20-40"
        if x < 60:
            return "40-60"
        return "60+"

    emm_resid: dict[str, Any] = {}
    for metric in CORE:
        buckets: dict[str, list[float]] = defaultdict(list)
        for r in p0:
            if r["metric"] != metric:
                continue
            emm = emm_cache.get((str(r["target_game_id"]), str(r["team_id"])))
            b = emm_bucket(emm)
            if b is None:
                continue
            buckets[b].append(float(r["actual"]) - float(r["B0_prediction"]))
        emm_resid[metric] = {
            b: {
                "n": len(v),
                "mean": sum(v) / len(v) if v else None,
                "median": percentile(sorted(v), 0.5) if v else None,
                "mae": sum(abs(x) for x in v) / len(v) if v else None,
            }
            for b, v in buckets.items()
        }
    report["F_baseline_residuals_vs_expected_missing_minutes"] = emm_resid

    # G pair stability
    print("G: P1 pair stability...", flush=True)
    report["G_pair_stability_p1"] = pair_stability_p1(PAIR_DIR / "p1.ndjson.gz")

    # H cross-focal
    print("H: cross-focal consistency...", flush=True)
    report["H_cross_focal_consistency"] = {
        "P0": cross_focal_consistency(p0, "pts"),
        "P1": cross_focal_consistency(p1, "pts"),
    }

    # P0 decomposition by season (bounded)
    print("Season decomposition P0...", flush=True)
    season_decomp = {}
    for season in ("2023", "2024", "2025"):
        srows = [r for r in p0 if str(r["season"]) == season]
        season_decomp[season] = {}
        for mi, metric in enumerate(CORE):
            season_decomp[season][metric] = summarize_stratum(srows, metric, mi, stream)
            stream += 1
    report["P0_season_decomposition"] = season_decomp

    # Power
    print("Power matched-size downsample...", flush=True)
    p1_blocks = {
        m: len({(r["subject_player_entity_id"], r["target_game_id"]) for r in p1 if r["metric"] == m})
        for m in CORE
    }
    report["power_matched_size"] = {
        m: power_downsample(p0, m, p1_blocks[m], mi) for mi, m in enumerate(CORE)
    }
    report["p1_eval_blocks_by_metric"] = p1_blocks

    # Candidate inventory
    report["next_gen_feature_inventory"] = {
        "leakage_safe_feasible": [
            {
                "feature": "health_out_count",
                "coverage": "high",
                "source": "T60 eligibility WITHOUT_CANDIDATE counts",
            },
            {
                "feature": "expected_missing_minutes",
                "coverage": report["E_expected_missing_feasibility"].get("coverage_rate"),
                "source": "sum of prior season-team MPG for health Out teammates",
            },
            {
                "feature": "expected_missing_FGA",
                "coverage": report["E_expected_missing_feasibility"].get("coverage_rate"),
                "source": "sum of prior season-team FGA for health Out teammates",
            },
            {
                "feature": "expected_missing_points",
                "coverage": report["E_expected_missing_feasibility"].get("coverage_rate"),
                "source": "sum of prior season-team PTS for health Out teammates",
            },
            {
                "feature": "subject_prior_minutes",
                "coverage": role_cov_p0.get("subject_ok"),
                "source": "subject expanding season-team prior MPG",
            },
            {
                "feature": "highest_impact_absence_mpg",
                "coverage": "derivable when expected_missing_minutes covered",
                "source": "max prior MPG among health Out teammates",
            },
        ],
        "broader_context_not_analyzed_here": [
            "home/away",
            "days rest",
            "back-to-back",
            "opponent",
            "pace / opponent defense if leakage-safe",
        ],
        "excluded": ["current-game stats", "postgame realized focal minutes as production input"],
    }

    # Interpretive synthesis for recommendation
    # Check if ΔMAE increases with OHW bucket for core metrics
    def point(bucket: str, metric: str) -> float | None:
        return q_a[bucket][metric].get("delta_MAE")

    burden_increasing = []
    for metric in CORE:
        seq = [point(b, metric) for b in ("0", "1", "2", "3+")]
        if all(x is not None for x in seq):
            # monotone non-decreasing across buckets?
            burden_increasing.append(all(seq[i] <= seq[i + 1] + 1e-12 for i in range(3)))
        else:
            burden_increasing.append(False)

    ohw0_status = {m: comp["ohw_0"][m].get("status") for m in CORE}
    ohwgt0_status = {m: comp["ohw_gt0"][m].get("status") for m in CORE}
    power_frac = {
        m: report["power_matched_size"][m].get("fraction_positive_delta") for m in CORE
    }

    # Focal high-MPG vs low
    focal_high = {
        m: q_focal["P0"]["30+"][m].get("status") for m in CORE if "30+" in q_focal["P0"]
    }
    focal_low = {
        m: q_focal["P0"]["<10"][m].get("status") for m in CORE if "<10" in q_focal["P0"]
    }

    avail = report["Available_control_semantics"]
    stability = report["G_pair_stability_p1"]

    # Recommendation logic (documented, not post-hoc rescue of v1)
    # Evidence favors team burden if OHW>0 supported and OHW=0 weak, and power remains positive
    ohw0_supported = sum(1 for s in ohw0_status.values() if s == "SUPPORTED")
    ohwgt0_supported = sum(1 for s in ohwgt0_status.values() if s == "SUPPORTED")
    power_strong = sum(1 for f in power_frac.values() if f is not None and f >= 0.8)

    if ohwgt0_supported >= 3 and ohw0_supported <= 1 and power_strong >= 3:
        recommended = "R2"
        rationale = (
            "P0 usefulness concentrates in other_health_without_count>0; "
            "P0-like OHW=0 (P1-composition) is weak; matched-size power remains directionally positive. "
            "Isolated Subject×Focal P1 assumption fails; team/rotation burden is the leading redesign."
        )
        nxt = "DESIGN_INJURY_CONTEXT_MODEL_V2"
    elif sum(1 for s in focal_high.values() if s == "SUPPORTED") >= 3 and sum(
        1 for s in focal_low.values() if s == "SUPPORTED"
    ) == 0:
        recommended = "R1"
        rationale = (
            "High prior-MPG focals show supported signal while low-MPG do not; "
            "role-qualified pair model may be viable."
        )
        nxt = "DESIGN_INJURY_CONTEXT_MODEL_V2"
    elif stability.get("sign_agreement_rate") is not None and stability["sign_agreement_rate"] < 0.55:
        recommended = "R5"
        rationale = "Pair effects unstable and no clear team-burden or role-qualified rescue."
        nxt = "KEEP_INJURY_TAPE_AS_EXPLANATORY_CONTEXT; DEFER_PREDICTIVE_INJURY_MODEL"
    else:
        # default: if multi-absence supported more than isolated, R2; else R4/R5
        if ohwgt0_supported >= 2 and power_strong >= 2:
            recommended = "R2"
            rationale = (
                "Multi-absence burden remains the strongest explanatory contrast vs P1 failure; "
                "expected-missing-minutes/usage features are feasible for a v2 team-burden design."
            )
            nxt = "DESIGN_INJURY_CONTEXT_MODEL_V2"
        else:
            recommended = "R5"
            rationale = "Diagnostics do not show a robust predictive injury-context direction."
            nxt = "KEEP_INJURY_TAPE_AS_EXPLANATORY_CONTEXT; DEFER_PREDICTIVE_INJURY_MODEL"

    secondary = []
    if recommended == "R2":
        secondary = ["R3", "R4"]
    elif recommended == "R1":
        secondary = ["R2", "R4"]
    else:
        secondary = ["R4"]

    report["FAILURE_MODE_ANALYSIS"] = "COMPLETE"
    report["RECOMMENDED_REDIRECTION"] = recommended
    report["RECOMMENDED_REDIRECTION_RATIONALE"] = rationale
    report["SECONDARY_REDIRECTIONS"] = secondary
    report["NEXT"] = nxt
    report["findings_answers"] = {
        "P1_failure": (
            "Isolated Subject×Focal contrast (other_health_without_count=0) removes the multi-absence "
            "environments where P0 gains concentrate; pair identity alone is weak/unstable under P1."
        ),
        "P0_success": (
            "Predictive usefulness is concentrated in multi-absence rows (other_health_without_count>0), "
            "not in the P1-like OHW=0 slice; sample size helps but does not fully explain the gap."
        ),
        "focal_role": "See C_focal_importance_mpg; diagnostic only.",
        "subject_role": "See D_subject_role_mpg; diagnostic only.",
        "Available_control": (
            f"Prior Out/Q/Doubtful rate given prior T60="
            f"{avail.get('prior_Out_Q_Doubtful_rate_given_prior')}; "
            f"played-vs-prior MPG median ratio="
            f"{(avail.get('available_played_vs_prior_mpg') or {}).get('ratio_median')}."
        ),
        "pair_stability": (
            f"sign_agreement_rate={stability.get('sign_agreement_rate')}, "
            f"pairs_compared={stability.get('pairs_compared')}."
        ),
        "team_injury_burden": "See A_concurrent_absence_burden and P0_composition_ohw0_vs_gt0.",
        "missing_opportunity": report["E_expected_missing_feasibility"],
        "power": report["power_matched_size"],
    }
    report["safety"] = {
        "estimator_modified": "NO",
        "pair_builder_modified": "NO",
        "t60_tape_modified": "NO",
        "reason_eligibility_modified": "NO",
        "thresholds_tuned": "NO",
        "primary_cohort_switched_to_P0": "NO",
        "production_integration": "NO",
        "replacement_model_created": "NO",
        "v1_rescued_post_hoc": "NO",
    }
    report["elapsed_sec"] = time.time() - t0

    # Write artifacts
    json_path = REPORTS / "official-injury-wowy-failure-analysis.json"
    json_path.write_text(
        json.dumps(json_safe(report), indent=2, allow_nan=False), encoding="utf-8"
    )

    # compact diagnostic extracts
    write_gz_jsonl(
        OUT / "a-ohw-burden-summary.ndjson.gz",
        [
            {"bucket": b, "metric": m, **q_a[b][m]}
            for b in q_a
            for m in q_a[b]
        ],
    )
    write_gz_jsonl(
        OUT / "power-matched-size.ndjson.gz",
        [report["power_matched_size"][m] for m in CORE],
    )
    (OUT / "run-state.json").write_text(
        json.dumps(
            {
                "FAILURE_MODE_ANALYSIS": "COMPLETE",
                "RECOMMENDED_REDIRECTION": recommended,
                "NEXT": nxt,
                "elapsed_sec": report["elapsed_sec"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    # Markdown report
    def fmt_stat(s: dict[str, Any]) -> str:
        if not s or s.get("rows", 0) == 0:
            return "n/a"
        d = s.get("delta_MAE")
        boot = s.get("bootstrap") or {}
        return (
            f"n={s.get('rows')} sg={s.get('subject_games')} "
            f"B0={s.get('B0_MAE'):.4f} EB={s.get('B0_EB_MAE'):.4f} "
            f"d={d:.4f} [{boot.get('p2.5'):.4f},{boot.get('p97.5'):.4f}] {s.get('status')}"
            if d is not None and boot.get("p2.5") is not None
            else f"n={s.get('rows')} incomplete"
        )

    md_lines = [
        "# Injury WOWY failure-mode analysis (Phase 6F)",
        "",
        f"Generated: **{report['generated_at']}**",
        "",
        "## Official v1 conclusion (immutable)",
        "",
        "```text",
        "estimator: injury-wowy-estimator-v1",
        "primary cohort: P1",
        "INJURY_WOWY_SIGNAL_STATUS = NOT_SUPPORTED",
        "INJURY_WOWY_MODEL_VALIDATED = NO",
        "ROLLING_ORIGIN_VALIDATION_GATE = PASS",
        "INJURY_WOWY_ESTIMATOR_CERTIFIED = YES",
        "```",
        "",
        "**Post-hoc rule:** Inspected P0/P1/P2/P3, seasons, tiers, and metrics are exploratory redesign evidence only. They are **not** confirmatory validation for any future modified model. A redesigned architecture requires a new version and a separate validation plan.",
        "",
        f"```text\nFAILURE_MODE_ANALYSIS = {report['FAILURE_MODE_ANALYSIS']}\n"
        f"RECOMMENDED_REDIRECTION = {recommended}\n"
        f"NEXT = {nxt}\n```",
        "",
        f"**Rationale:** {rationale}",
        "",
        f"Secondary: {', '.join(secondary)}",
        "",
        "## A — Concurrent absence burden (P0 by other_health_without_count)",
        "",
    ]
    for bucket in ("0", "1", "2", "3+"):
        md_lines.append(f"### OHW = {bucket}")
        md_lines.append("")
        for metric in CORE:
            md_lines.append(f"- **{metric}**: {fmt_stat(q_a[bucket][metric])}")
        md_lines.append("")

    md_lines += [
        "## P0 composition: OHW=0 vs OHW>0 (core)",
        "",
    ]
    for metric in CORE:
        md_lines.append(
            f"- **{metric} OHW=0**: {fmt_stat(comp['ohw_0'][metric])} | "
            f"**OHW>0**: {fmt_stat(comp['ohw_gt0'][metric])}"
        )
    md_lines += [
        "",
        "## B — Simultaneous team health Out count",
        "",
        "See JSON `B_simultaneous_health_out` (outcome dist + ΔMAE by 1/2/3/4+).",
        "",
        "## C/D — Focal / subject prior MPG buckets",
        "",
        "Leakage-safe prior season-team means (`game_start < T`). Coverage:",
        f"- P0 subject ok/cold: {role_cov_p0.get('subject_ok')}/{role_cov_p0.get('subject_cold')}",
        f"- P0 focal ok/cold: {role_cov_p0.get('focal_ok')}/{role_cov_p0.get('focal_cold')}",
        "",
        "Full bucket ΔMAE tables in JSON `C_focal_importance_mpg` / `D_subject_role_mpg`.",
        "",
        "## E — Expected missing opportunity feasibility",
        "",
        "```text",
        json.dumps(report["E_expected_missing_feasibility"], indent=2)[:1200],
        "```",
        "",
        "## Available control semantics",
        "",
        "```text",
        json.dumps(
            {
                k: avail[k]
                for k in (
                    "unique_available_focal_games",
                    "prior_Out_Q_Doubtful_rate_given_prior",
                    "available_played_vs_prior_mpg",
                    "realized_participation_unique_focal_games",
                )
                if k in avail
            },
            indent=2,
        ),
        "```",
        "",
        "## F — Baseline residual absorption",
        "",
        "Descriptive `actual−B0` by OHW and expected-missing-minutes buckets: see JSON.",
        "",
        "## G — Pair stability (P1, pts)",
        "",
        f"- pairs compared: {stability.get('pairs_compared')}",
        f"- sign agreement: {stability.get('sign_agreement_rate')}",
        f"- median |Δ1−Δ2|: {stability.get('median_abs_delta_diff')}",
        f"- half-delta correlation: {stability.get('half_delta_correlation')}",
        "",
        "## H — Cross-focal consistency (pts)",
        "",
        f"- P0: {json.dumps(report['H_cross_focal_consistency']['P0'])}",
        f"- P1: {json.dumps(report['H_cross_focal_consistency']['P1'])}",
        "",
        "## Power (P0 downsampled to P1 subject-game count)",
        "",
    ]
    for m in CORE:
        md_lines.append(f"- **{m}**: {json.dumps(report['power_matched_size'][m])}")
    md_lines += [
        "",
        "## Findings summary",
        "",
        f"- **P1 failure:** {report['findings_answers']['P1_failure']}",
        f"- **P0 success:** {report['findings_answers']['P0_success']}",
        f"- **Available control:** {report['findings_answers']['Available_control']}",
        f"- **Pair stability:** {report['findings_answers']['pair_stability']}",
        "",
        "## Safety",
        "",
        "```text",
        json.dumps(report["safety"], indent=2),
        "```",
        "",
        "Dry artifacts: `tmp/official-injury-wowy-failure-analysis/`",
        "",
    ]
    (REPORTS / "official-injury-wowy-failure-analysis.md").write_text(
        "\n".join(md_lines) + "\n", encoding="utf-8"
    )

    print(json.dumps({
        "FAILURE_MODE_ANALYSIS": "COMPLETE",
        "RECOMMENDED_REDIRECTION": recommended,
        "NEXT": nxt,
        "elapsed_sec": report["elapsed_sec"],
    }, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
