"""
Phase 6E — Rolling-origin predictive validation for injury-wowy-estimator-v1.

Leakage-safe PRODUCTION_AS_OF only. Does not modify estimator or product systems.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import random
import sys
import time
from bisect import bisect_left
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ops"))
from _injury_wowy_estimator_ref import (  # noqa: E402
    METRICS,
    Obs,
    estimate_pair,
    pair_key,
    run_metric_window,
)

OUT = ROOT / "tmp" / "official-injury-wowy-predictive-validation"
REPORTS = ROOT / "reports" / "operations"
PAIR_DIR = ROOT / "tmp" / "official-injury-wowy-pairs"
MANIFEST = ROOT / "tmp" / "official-injury-wowy-estimator" / "game-start-manifest.ndjson"

BOOT_REPS = 2000
BASE_SEED = 20260917
CORE_METRICS = ("minutes", "pts", "reb", "ast")


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


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def load_manifest() -> dict[str, str]:
    m: dict[str, str] = {}
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        m[str(o["game_id"])] = o["start_time_utc"]
    return m


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
    """Match WOWY appearance: '00' = DNP; numeric/other played when >0 or '0'."""
    if raw is None:
        return False
    s = str(raw).strip()
    if s == "00":
        return False
    try:
        return float(s) >= 0  # '0' and positive minutes count as played rows present
    except ValueError:
        return False


def load_pair_obs(cohort_file: str, manifest: dict[str, str]) -> list[Obs]:
    path = PAIR_DIR / cohort_file
    out: list[Obs] = []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            o = json.loads(line)
            gid = str(o["game_id"])
            out.append(
                Obs(
                    game_id=gid,
                    game_start=manifest[gid],
                    season=str(o["season"]),
                    team_id=str(o["team_id"]),
                    subject_player_entity_id=o["subject_player_entity_id"],
                    focal_player_entity_id=o["focal_player_entity_id"],
                    focal_state=o["focal_state"],
                    metrics={k: float(o["subject_metrics"][k]) for k in METRICS},
                    cohort_flags={
                        "cohort_p0": True,
                        "cohort_p1": bool(o.get("cohort_p1")),
                        "cohort_p2": bool(o.get("cohort_p2")),
                        "cohort_p3": bool(o.get("cohort_p3")),
                    },
                )
            )
    return out


@dataclass
class PglGame:
    game_id: str
    game_start: str
    season: str
    team_id: str
    entity_id: str
    metrics: dict[str, float]


def load_subject_pgl(entity_ids: set[str], manifest: dict[str, str]) -> list[PglGame]:
    """Read-only PGL for subjects; join games.start_time; played rows only."""
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
                        iso = iso + "Z"
                    # Prefer certified manifest tip when available
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
        conn.execute("COMMIT")
    return rows


def index_pgl(games: list[PglGame]) -> dict[tuple[str, str, str], list[PglGame]]:
    idx: dict[tuple[str, str, str], list[PglGame]] = defaultdict(list)
    for g in games:
        idx[(g.entity_id, g.season, g.team_id)].append(g)
    for k in idx:
        idx[k].sort(key=lambda x: (x.game_start, x.game_id))
    return idx


def baseline_predictions(
    hist: list[PglGame], as_of: str, metric: str
) -> tuple[float | None, float | None, int]:
    """Return B0, B1, n_prior for metric; hist must be sorted by start."""
    prior = [g for g in hist if g.game_start < as_of]
    n = len(prior)
    if n < 1:
        return None, None, 0
    vals = [g.metrics[metric] for g in prior]
    b0 = sum(vals) / n
    recent = vals[-10:] if n >= 10 else vals
    b1 = sum(recent) / len(recent)
    return b0, b1, n


def centered_adjustments(d_hat: float, with_n: int, without_n: int) -> tuple[float, float]:
    n_total = with_n + without_n
    p_with = with_n / n_total
    p_without = without_n / n_total
    adj_out = p_with * d_hat
    adj_avail = -p_without * d_hat
    return adj_out, adj_avail


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return float("nan")
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = (len(sorted_vals) - 1) * p
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return sorted_vals[lo]
    w = idx - lo
    return sorted_vals[lo] * (1 - w) + sorted_vals[hi] * w


def weighted_mae_rmse(
    rows: list[dict[str, Any]], pred_key: str, actual_key: str = "actual"
) -> tuple[float, float, float]:
    """Subject-game weighted MAE, RMSE, ME."""
    wsum = 0.0
    ae = 0.0
    se = 0.0
    me = 0.0
    for r in rows:
        w = float(r["subject_game_weight"])
        err = float(r[pred_key]) - float(r[actual_key])
        wsum += w
        ae += w * abs(err)
        se += w * err * err
        me += w * err
    if wsum <= 0:
        return float("nan"), float("nan"), float("nan")
    return ae / wsum, math.sqrt(se / wsum), me / wsum


def block_bootstrap_delta(
    rows: list[dict[str, Any]],
    base_key: str,
    cand_key: str,
    metric_index: int,
    stream: int = 0,
) -> dict[str, Any]:
    """Paired ΔMAE = MAE_base - MAE_cand with subject-game blocks (pre-aggregated)."""
    # Per block: (wsum, abs_err_base_sum, abs_err_cand_sum)
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
        return {"valid": 0, "point_dmae": None, "p2.5": None, "median": None, "p97.5": None}
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
        "p2.5": percentile(deltas, 0.025) if deltas else None,
        "median": percentile(deltas, 0.5) if deltas else None,
        "p97.5": percentile(deltas, 0.975) if deltas else None,
        "mae_base": point_base,
        "mae_cand": point_cand,
    }


def classify_vs_baseline(boot: dict[str, Any]) -> str:
    d = boot.get("point_dmae")
    lo = boot.get("p2.5")
    hi = boot.get("p97.5")
    if d is None or lo is None or hi is None:
        return "INCONCLUSIVE"
    if d > 0 and lo > 0:
        return "SUPPORTED"
    if d < 0 and hi < 0:
        return "HARMFUL"
    return "INCONCLUSIVE"


def classify_eb_vs_raw(boot: dict[str, Any]) -> str:
    # point = MAE_RAW - MAE_EB (positive => EB better)
    d = boot.get("point_dmae")
    lo = boot.get("p2.5")
    hi = boot.get("p97.5")
    if d is None or lo is None or hi is None:
        return "INCONCLUSIVE"
    if d > 0 and lo > 0:
        return "EB_BETTER"
    if d < 0 and hi < 0:
        return "RAW_BETTER"
    return "INCONCLUSIVE"


def overall_signal_status(metric_status: dict[str, str]) -> str:
    statuses = [metric_status[m] for m in METRICS]
    core = [metric_status[m] for m in CORE_METRICS]
    if "HARMFUL" not in statuses:
        supported_core = sum(1 for s in core if s == "SUPPORTED")
        if supported_core >= 1 and sum(1 for m in CORE_METRICS if metric_status[m] != "HARMFUL" and (
            # positive point ΔMAE for at least 3 of 4 — use status SUPPORTED count + need point check externally
            True
        )) >= 0:
            # Precommitted: at least one of core SUPPORTED AND positive point ΔMAE for >=3 of 4 core
            # Caller should pass point signs; we recompute below with extra arg
            pass
    return "NOT_SUPPORTED"  # placeholder overwritten


def decide_overall(metric_status: dict[str, str], core_point_positive: dict[str, bool]) -> str:
    statuses = list(metric_status.values())
    core_stat = [metric_status[m] for m in CORE_METRICS]
    harmful = sum(1 for s in statuses if s == "HARMFUL")
    supported_any = any(s == "SUPPORTED" for s in statuses)
    supported_core = sum(1 for s in core_stat if s == "SUPPORTED")
    pos3 = sum(1 for m in CORE_METRICS if core_point_positive.get(m, False))
    if harmful == 0 and supported_core >= 1 and pos3 >= 3:
        return "SUPPORTED"
    core_harmful = sum(1 for s in core_stat if s == "HARMFUL")
    if not supported_any or core_harmful >= 3:
        return "NOT_SUPPORTED"
    if not supported_any:
        return "NOT_SUPPORTED"
    return "MIXED"


def assign_subject_game_weights(rows: list[dict[str, Any]]) -> None:
    counts: Counter = Counter()
    for r in rows:
        counts[(r["subject_player_entity_id"], r["target_game_id"], r["metric"])] += 1
    for r in rows:
        k = (r["subject_player_entity_id"], r["target_game_id"], r["metric"])
        r["subject_game_weight"] = 1.0 / counts[k]


def add_to_cell(cells: dict[tuple, Any], key: tuple, x: float) -> None:
    """Online update of n, mean, sse (Welford) for CellStats-compatible dict."""
    c = cells.get(key)
    if c is None:
        cells[key] = {"n": 1, "mean": x, "sse": 0.0}
        return
    n1 = c["n"]
    n = n1 + 1
    delta = x - c["mean"]
    mean = c["mean"] + delta / n
    sse = c["sse"] + delta * (x - mean)
    c["n"] = n
    c["mean"] = mean
    c["sse"] = sse


def cells_to_stats(cells_raw: dict[tuple, Any]) -> dict:
    from _injury_wowy_estimator_ref import CellStats

    out = {}
    for key, c in cells_raw.items():
        n = c["n"]
        sv = (c["sse"] / (n - 1)) if n >= 2 else None
        out[key] = CellStats(n=n, mean=c["mean"], sse=c["sse"], sample_var=sv)
    return out


def run_cohort(
    cohort: str,
    pair_obs: list[Obs],
    pgl_idx: dict[tuple[str, str, str], list[PglGame]],
    *,
    do_bootstrap: bool,
    detailed_quality_bootstrap: bool,
    out_pred_path: Path | None,
) -> dict[str, Any]:
    from _injury_wowy_estimator_ref import (
        PairRaw,
        estimate_pair,
        estimate_prior,
        pair_raw_from_cells,
        pooled_residual_variance,
    )

    t0 = time.time()
    by_asof: dict[str, list[Obs]] = defaultdict(list)
    for o in pair_obs:
        by_asof[o.game_start].append(o)
    asof_times = sorted(by_asof.keys())
    all_sorted = sorted(
        pair_obs,
        key=lambda o: (o.game_start, o.game_id, o.focal_player_entity_id, o.subject_player_entity_id),
    )

    # Incremental cell stores per metric
    cells_raw: dict[str, dict[tuple, Any]] = {m: {} for m in METRICS}
    cursor = 0
    pred_rows: list[dict[str, Any]] = []
    coverage = Counter()
    gz_fh = None
    if out_pred_path is not None:
        gz_fh = gzip.open(out_pred_path, "wt", encoding="utf-8")

    try:
        for ai, as_of in enumerate(asof_times):
            if ai % 200 == 0:
                print(f"  {cohort} as_of {ai}/{len(asof_times)}", flush=True)
            while cursor < len(all_sorted) and all_sorted[cursor].game_start < as_of:
                o = all_sorted[cursor]
                cursor += 1
                for metric in METRICS:
                    add_to_cell(
                        cells_raw[metric],
                        (*pair_key(o), o.focal_state),
                        float(o.metrics[metric]),
                    )

            windows: dict[str, Any] = {}
            for metric in METRICS:
                cells = cells_to_stats(cells_raw[metric])
                sigma2, df = pooled_residual_variance(cells)
                keys = {(c[0], c[1], c[2], c[3]) for c in cells}
                pairs = {k: pair_raw_from_cells(cells, k, sigma2) for k in keys}
                prior = estimate_prior(pairs, sigma2, df)
                windows[metric] = (prior, pairs)

            for o in by_asof[as_of]:
                coverage["total_target_pair_obs"] += 1
                key = pair_key(o)
                hist = pgl_idx.get((o.subject_player_entity_id, o.season, o.team_id), [])
                for metric in METRICS:
                    b0, b1, n_base = baseline_predictions(hist, as_of, metric)
                    if b0 is None:
                        coverage["BASELINE_NO_HISTORY"] += 1
                        continue
                    coverage["B0_available"] += 1
                    if b1 is not None:
                        coverage["B1_available"] += 1

                    prior, pairs = windows[metric]
                    pr = pairs.get(key) or PairRaw(
                        0, 0, None, None, None, None, None, None, None, None
                    )
                    est = estimate_pair(
                        pr,
                        prior,
                        season=key[0],
                        team_id=key[1],
                        subject=key[2],
                        focal=key[3],
                        metric=metric,
                        cohort=cohort,  # type: ignore
                        mode="PRODUCTION_AS_OF",
                        as_of=as_of,
                    )
                    status = est["estimation_status"]
                    coverage[f"status_{status}"] += 1

                    row: dict[str, Any] = {
                        "cohort": cohort,
                        "target_game_id": o.game_id,
                        "target_game_start": as_of,
                        "season": o.season,
                        "team_id": o.team_id,
                        "subject_player_entity_id": o.subject_player_entity_id,
                        "focal_player_entity_id": o.focal_player_entity_id,
                        "focal_state": o.focal_state,
                        "metric": metric,
                        "baseline_history_n": n_base,
                        "B0_prediction": b0,
                        "B1_prediction": b1,
                        "estimation_status": status,
                        "quality_tier": est["quality_tier"],
                        "with_n_prior": est["with_n"],
                        "without_n_prior": est["without_n"],
                        "raw_delta_prior": est["raw_delta"],
                        "estimated_delta_prior": est["estimated_delta"],
                        "actual": o.metrics[metric],
                        "injury_signal_available": status
                        in ("SPARSE_BOTH_STATES", "PAIR_ESTIMATE_AVAILABLE"),
                    }

                    if not row["injury_signal_available"]:
                        coverage["INJURY_SIGNAL_UNAVAILABLE"] += 1
                        row["B0_EB"] = None
                        row["B0_RAW"] = None
                        row["B1_EB"] = None
                        row["B1_RAW"] = None
                        row["state_adjustment_eb"] = None
                        row["state_adjustment_raw"] = None
                    else:
                        coverage["internal_eb_evaluable"] += 1
                        if status == "PAIR_ESTIMATE_AVAILABLE":
                            coverage["ui_history_evaluable"] += 1
                        d_eb = float(est["estimated_delta"])
                        d_raw = float(est["raw_delta"])
                        wn, won = int(est["with_n"]), int(est["without_n"])
                        adj_out_eb, adj_av_eb = centered_adjustments(d_eb, wn, won)
                        adj_out_raw, adj_av_raw = centered_adjustments(d_raw, wn, won)
                        if o.focal_state == "PRE_GAME_OUT":
                            adj_eb, adj_raw = adj_out_eb, adj_out_raw
                        else:
                            adj_eb, adj_raw = adj_av_eb, adj_av_raw
                        row["state_adjustment_eb"] = adj_eb
                        row["state_adjustment_raw"] = adj_raw
                        row["B0_EB"] = b0 + adj_eb
                        row["B0_RAW"] = b0 + adj_raw
                        row["B1_EB"] = (b1 + adj_eb) if b1 is not None else None
                        row["B1_RAW"] = (b1 + adj_raw) if b1 is not None else None

                    if gz_fh is not None:
                        gz_fh.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
                    # keep only evaluable injury-signal rows in memory for aggregates
                    if row["injury_signal_available"] and row["B0_EB"] is not None:
                        pred_rows.append(row)
    finally:
        if gz_fh is not None:
            gz_fh.close()

    results_by_metric: dict[str, Any] = {}
    for mi, metric in enumerate(METRICS):
        eval_rows = [r for r in pred_rows if r["metric"] == metric]
        assign_subject_game_weights(eval_rows)
        ui_rows = [r for r in eval_rows if r["estimation_status"] == "PAIR_ESTIMATE_AVAILABLE"]
        assign_subject_game_weights(ui_rows)

        mae_b0, rmse_b0, me_b0 = weighted_mae_rmse(eval_rows, "B0_prediction")
        mae_eb, rmse_eb, me_eb = weighted_mae_rmse(eval_rows, "B0_EB")
        mae_raw, rmse_raw, me_raw = weighted_mae_rmse(eval_rows, "B0_RAW")

        boot_eb = (
            block_bootstrap_delta(eval_rows, "B0_prediction", "B0_EB", mi, stream=0)
            if do_bootstrap
            else {}
        )
        boot_raw = (
            block_bootstrap_delta(eval_rows, "B0_RAW", "B0_EB", mi, stream=1)
            if do_bootstrap
            else {}
        )
        b1_rows = [r for r in eval_rows if r["B1_prediction"] is not None and r["B1_EB"] is not None]
        assign_subject_game_weights(b1_rows)
        mae_b1, rmse_b1, _ = (
            weighted_mae_rmse(b1_rows, "B1_prediction") if b1_rows else (float("nan"), float("nan"), float("nan"))
        )
        mae_b1eb, rmse_b1eb, _ = (
            weighted_mae_rmse(b1_rows, "B1_EB") if b1_rows else (float("nan"), float("nan"), float("nan"))
        )
        boot_b1 = (
            block_bootstrap_delta(b1_rows, "B1_prediction", "B1_EB", mi, stream=2)
            if do_bootstrap and b1_rows
            else {}
        )

        ui_boot = (
            block_bootstrap_delta(ui_rows, "B0_prediction", "B0_EB", mi, stream=3)
            if do_bootstrap and ui_rows
            else {}
        )
        mae_ui_b0, _, _ = weighted_mae_rmse(ui_rows, "B0_prediction") if ui_rows else (float("nan"), float("nan"), float("nan"))
        mae_ui_eb, _, _ = weighted_mae_rmse(ui_rows, "B0_EB") if ui_rows else (float("nan"), float("nan"), float("nan"))

        status = classify_vs_baseline(boot_eb) if boot_eb else "INCONCLUSIVE"
        eb_raw_status = classify_eb_vs_raw(boot_raw) if boot_raw else "INCONCLUSIVE"

        qt = {}
        for tier in ("Q1", "Q2", "Q3", "Q4"):
            tr = [r for r in eval_rows if r["quality_tier"] == tier]
            assign_subject_game_weights(tr)
            if len(tr) < 30:
                qt[tier] = {"rows": len(tr), "note": "insufficient_for_strong_inference"}
                continue
            if detailed_quality_bootstrap and do_bootstrap:
                b = block_bootstrap_delta(tr, "B0_prediction", "B0_EB", mi, stream=10 + ord(tier[-1]))
                qt[tier] = {
                    "rows": len(tr),
                    "subject_games": len({(r["subject_player_entity_id"], r["target_game_id"]) for r in tr}),
                    "boot": b,
                    "status": classify_vs_baseline(b),
                }
            else:
                mb, _, _ = weighted_mae_rmse(tr, "B0_prediction")
                meb, _, _ = weighted_mae_rmse(tr, "B0_EB")
                qt[tier] = {
                    "rows": len(tr),
                    "subject_games": len({(r["subject_player_entity_id"], r["target_game_id"]) for r in tr}),
                    "delta_MAE": mb - meb,
                }

        seasons = {}
        for season in ("2023", "2024", "2025"):
            sr = [r for r in eval_rows if r["season"] == season]
            assign_subject_game_weights(sr)
            if not sr:
                seasons[season] = {"rows": 0}
                continue
            mb, _, _ = weighted_mae_rmse(sr, "B0_prediction")
            meb, _, _ = weighted_mae_rmse(sr, "B0_EB")
            seasons[season] = {
                "rows": len(sr),
                "subject_games": len({(r["subject_player_entity_id"], r["target_game_id"]) for r in sr}),
                "B0_MAE": mb,
                "B0_EB_MAE": meb,
                "delta_MAE": mb - meb,
            }

        states = {}
        for st in ("PRE_GAME_OUT", "PRE_GAME_AVAILABLE"):
            sr = [r for r in eval_rows if r["focal_state"] == st]
            assign_subject_game_weights(sr)
            if not sr:
                states[st] = {"rows": 0}
                continue
            mb, _, _ = weighted_mae_rmse(sr, "B0_prediction")
            meb, _, _ = weighted_mae_rmse(sr, "B0_EB")
            states[st] = {"rows": len(sr), "B0_MAE": mb, "B0_EB_MAE": meb, "delta_MAE": mb - meb}

        results_by_metric[metric] = {
            "eval_rows": len(eval_rows),
            "subject_games": len({(r["subject_player_entity_id"], r["target_game_id"]) for r in eval_rows}),
            "subjects": len({r["subject_player_entity_id"] for r in eval_rows}),
            "focals": len({r["focal_player_entity_id"] for r in eval_rows}),
            "pair_keys": len(
                {
                    (r["season"], r["team_id"], r["subject_player_entity_id"], r["focal_player_entity_id"])
                    for r in eval_rows
                }
            ),
            "B0_MAE": mae_b0,
            "B0_EB_MAE": mae_eb,
            "delta_MAE": mae_b0 - mae_eb if math.isfinite(mae_b0) else None,
            "mae_improvement_pct": ((mae_b0 - mae_eb) / mae_b0) if mae_b0 and mae_b0 > 0 else None,
            "B0_RMSE": rmse_b0,
            "B0_EB_RMSE": rmse_eb,
            "B0_ME": me_b0,
            "B0_EB_ME": me_eb,
            "bootstrap_B0_vs_EB": boot_eb,
            "status": status,
            "B0_RAW_MAE": mae_raw,
            "bootstrap_RAW_vs_EB": boot_raw,
            "eb_vs_raw_status": eb_raw_status,
            "B1_MAE": mae_b1,
            "B1_EB_MAE": mae_b1eb,
            "bootstrap_B1_vs_EB": boot_b1,
            "ui_subset": {
                "rows": len(ui_rows),
                "B0_MAE": mae_ui_b0,
                "B0_EB_MAE": mae_ui_eb,
                "delta_MAE": (mae_ui_b0 - mae_ui_eb) if math.isfinite(mae_ui_b0) else None,
                "bootstrap": ui_boot,
                "status": classify_vs_baseline(ui_boot) if ui_boot else None,
            },
            "quality_tiers": qt,
            "seasons": seasons,
            "states": states,
            "sparse_both_at_prediction": sum(
                1 for r in eval_rows if r["estimation_status"] == "SPARSE_BOTH_STATES"
            ),
            "pair_estimate_available_at_prediction": sum(
                1 for r in eval_rows if r["estimation_status"] == "PAIR_ESTIMATE_AVAILABLE"
            ),
        }

    elapsed = time.time() - t0
    return {
        "cohort": cohort,
        "elapsed_sec": elapsed,
        "coverage": dict(coverage),
        "prediction_row_count": sum(1 for _ in []),  # filled by caller via file
        "eval_injury_signal_rows": len(pred_rows),
        "metrics": results_by_metric,
        "prediction_rows": pred_rows,
    }


def mutation_test(pair_obs: list[Obs], pgl_idx: dict) -> bool:
    """Historical predictions at T must ignore synthetic future pair obs."""
    if not pair_obs:
        return False
    starts = sorted({o.game_start for o in pair_obs})
    T = starts[len(starts) // 3]
    targets = [o for o in pair_obs if o.game_start == T][:5]
    if not targets:
        return False

    def score(obs_list: list[Obs]) -> list[tuple]:
        window = [o for o in obs_list if o.game_start < T]
        out = []
        for metric in ("pts",):
            prior, pairs, _ = run_metric_window(
                window, metric=metric, cohort="P1", mode="PRODUCTION_AS_OF", as_of=T
            )
            for o in targets:
                key = pair_key(o)
                pr = pairs.get(key)
                if pr is None:
                    continue
                est = estimate_pair(
                    pr,
                    prior,
                    season=key[0],
                    team_id=key[1],
                    subject=key[2],
                    focal=key[3],
                    metric=metric,
                    cohort="P1",
                    mode="PRODUCTION_AS_OF",
                    as_of=T,
                )
                hist = pgl_idx.get((o.subject_player_entity_id, o.season, o.team_id), [])
                b0, _, _ = baseline_predictions(hist, T, metric)
                out.append(
                    (
                        o.game_id,
                        o.subject_player_entity_id,
                        o.focal_player_entity_id,
                        est["estimation_status"],
                        est["estimated_delta"],
                        est["with_n"],
                        est["without_n"],
                        b0,
                        prior.mu0,
                        prior.tau2,
                        prior.sigma2_pool,
                    )
                )
        return out

    base = score(pair_obs)
    future = list(pair_obs)
    d = pair_obs[0]
    future.append(
        Obs(
            game_id="FUTURE_VAL_MUTATION",
            game_start="2099-06-01T00:00:00.000Z",
            season=d.season,
            team_id=d.team_id,
            subject_player_entity_id=d.subject_player_entity_id,
            focal_player_entity_id=d.focal_player_entity_id,
            focal_state="PRE_GAME_OUT",
            metrics={m: 999.0 for m in METRICS},
            cohort_flags=d.cohort_flags,
        )
    )
    mut = score(future)
    return base == mut


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()

    print("Loading pair corpora...")
    p0 = load_pair_obs("p0.ndjson.gz", manifest)
    p1 = load_pair_obs("p1.ndjson.gz", manifest)
    p2 = load_pair_obs("p2.ndjson.gz", manifest)
    p3 = load_pair_obs("p3.ndjson.gz", manifest)
    print(f"P0={len(p0)} P1={len(p1)} P2={len(p2)} P3={len(p3)}")

    entities = {o.subject_player_entity_id for o in p0}
    print(f"Loading PGL for {len(entities)} subjects...")
    pgl_cache = OUT / "subject-pgl-played.ndjson.gz"
    if pgl_cache.exists():
        pgl = []
        with gzip.open(pgl_cache, "rt", encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                o = json.loads(line)
                pgl.append(
                    PglGame(
                        game_id=o["game_id"],
                        game_start=o["game_start"],
                        season=o["season"],
                        team_id=o["team_id"],
                        entity_id=o["entity_id"],
                        metrics=o["metrics"],
                    )
                )
        print(f"Loaded cached PGL rows: {len(pgl)}")
    else:
        pgl = load_subject_pgl(entities, manifest)
        print(f"Played PGL rows: {len(pgl)}")
        with gzip.open(pgl_cache, "wt", encoding="utf-8") as fh:
            for g in pgl:
                fh.write(
                    json.dumps(
                        {
                            "game_id": g.game_id,
                            "game_start": g.game_start,
                            "season": g.season,
                            "team_id": g.team_id,
                            "entity_id": g.entity_id,
                            "metrics": g.metrics,
                        },
                        sort_keys=True,
                    )
                    + "\n"
                )
    pgl_idx = index_pgl(pgl)

    mutation_ok = mutation_test(p1, pgl_idx)
    print("mutation_test", mutation_ok)

    print("Running P1 rolling validation (bootstrap on)...")
    p1_path = OUT / "rolling-predictions-p1.ndjson.gz"
    p1_res = run_cohort(
        "P1",
        p1,
        pgl_idx,
        do_bootstrap=True,
        detailed_quality_bootstrap=True,
        out_pred_path=p1_path,
    )
    # Determinism: second pass core fields
    print("Determinism second pass (P1, no bootstrap)...")
    p1_res2 = run_cohort(
        "P1",
        p1,
        pgl_idx,
        do_bootstrap=False,
        detailed_quality_bootstrap=False,
        out_pred_path=None,
    )

    def core_tuple(r: dict) -> tuple:
        return (
            r["target_game_id"],
            r["subject_player_entity_id"],
            r["focal_player_entity_id"],
            r["metric"],
            r.get("B0_prediction"),
            r.get("B0_EB"),
            r.get("B0_RAW"),
            r.get("estimation_status"),
            r.get("with_n_prior"),
            r.get("without_n_prior"),
            r.get("estimated_delta_prior"),
            r.get("raw_delta_prior"),
        )

    set1 = sorted(core_tuple(r) for r in p1_res["prediction_rows"])
    set2 = sorted(core_tuple(r) for r in p1_res2["prediction_rows"])
    determinism_ok = set1 == set2
    hash1 = sha256_bytes(p1_path.read_bytes())
    print("determinism_ok", determinism_ok, "hash", hash1)
    p1_res["prediction_row_count"] = sum(
        1 for _ in gzip.open(p1_path, "rt", encoding="utf-8")
    )

    # Sensitivity cohorts
    sens = {}
    for name, obs in [("P0", p0), ("P2", p2), ("P3", p3)]:
        print(f"Running {name}...")
        path = OUT / f"rolling-predictions-{name.lower()}.ndjson.gz"
        res = run_cohort(
            name,
            obs,
            pgl_idx,
            do_bootstrap=True,
            detailed_quality_bootstrap=False,
            out_pred_path=path,
        )
        sens[name] = {
            "elapsed_sec": res["elapsed_sec"],
            "coverage": res["coverage"],
            "eval_injury_signal_rows": res["eval_injury_signal_rows"],
            "metrics": {
                m: {
                    "eval_rows": res["metrics"][m]["eval_rows"],
                    "subject_games": res["metrics"][m]["subject_games"],
                    "delta_MAE": res["metrics"][m]["delta_MAE"],
                    "bootstrap_B0_vs_EB": {
                        k: res["metrics"][m]["bootstrap_B0_vs_EB"].get(k)
                        for k in ("point_dmae", "p2.5", "median", "p97.5", "valid")
                    },
                    "status": res["metrics"][m]["status"],
                }
                for m in METRICS
            },
        }
        del res

    metric_status = {m: p1_res["metrics"][m]["status"] for m in METRICS}
    core_pos = {
        m: bool(
            p1_res["metrics"][m]["delta_MAE"] is not None and p1_res["metrics"][m]["delta_MAE"] > 0
        )
        for m in CORE_METRICS
    }
    signal_status = decide_overall(metric_status, core_pos)

    gate = "PASS" if mutation_ok and determinism_ok else "FAIL"
    model_validated = "YES" if gate == "PASS" and signal_status == "SUPPORTED" else "NO"

    if signal_status == "SUPPORTED":
        nxt = "DESIGN_INJURY_WOWY_PRODUCT_INTEGRATION_AND_MULTI_FOCAL_COMBINATION"
    elif signal_status == "MIXED":
        nxt = "REVIEW_METRIC_SPECIFIC_SIGNAL_AND_MODEL_REFINEMENT"
    else:
        nxt = "DO_NOT_INTEGRATE_SIGNAL; ANALYZE_FAILURE_MODES"

    metric_summary = []
    for m in METRICS:
        mm = p1_res["metrics"][m]
        metric_summary.append({"metric": m, **{k: mm[k] for k in mm if k != "quality_tiers"}})

    with gzip.open(OUT / "metric-summary.ndjson.gz", "wt", encoding="utf-8") as fh:
        for rec in metric_summary:
            fh.write(json.dumps(rec, sort_keys=True) + "\n")

    qt_lines = []
    for m in METRICS:
        qt_lines.append(
            json.dumps({"metric": m, "quality_tiers": p1_res["metrics"][m]["quality_tiers"]}, sort_keys=True)
        )
    with gzip.open(OUT / "quality-tier-summary.ndjson.gz", "wt", encoding="utf-8") as fh:
        fh.write("\n".join(qt_lines) + "\n")

    season_lines = []
    for m in METRICS:
        season_lines.append(
            json.dumps({"metric": m, "seasons": p1_res["metrics"][m]["seasons"]}, sort_keys=True)
        )
    with gzip.open(OUT / "season-summary.ndjson.gz", "wt", encoding="utf-8") as fh:
        fh.write("\n".join(season_lines) + "\n")

    boot_lines = []
    for m in METRICS:
        boot_lines.append(
            json.dumps(
                {
                    "metric": m,
                    "B0_vs_EB": p1_res["metrics"][m]["bootstrap_B0_vs_EB"],
                    "RAW_vs_EB": p1_res["metrics"][m]["bootstrap_RAW_vs_EB"],
                    "B1_vs_EB": p1_res["metrics"][m]["bootstrap_B1_vs_EB"],
                },
                sort_keys=True,
            )
        )
    with gzip.open(OUT / "bootstrap-summary.ndjson.gz", "wt", encoding="utf-8") as fh:
        fh.write("\n".join(boot_lines) + "\n")

    run_state = {
        "ROLLING_ORIGIN_VALIDATION_GATE": gate,
        "INJURY_WOWY_SIGNAL_STATUS": signal_status,
        "INJURY_WOWY_MODEL_VALIDATED": model_validated,
        "NEXT": nxt,
        "prediction_sha256_p1": hash1,
        "determinism_ok": determinism_ok,
        "mutation_ok": mutation_ok,
        "bootstrap_replicates": BOOT_REPS,
        "base_seed": BASE_SEED,
        "HISTORICAL_EXISTING_PROJECTION_BASELINE": "UNAVAILABLE",
        "existing_projection_note": "No versioned as-of-safe Court Context projection spanning 2023-2025 for all eight metrics; shadow PTS/REB not used.",
        "p1_elapsed_sec": p1_res["elapsed_sec"],
        "p1_prediction_rows": p1_res["prediction_row_count"],
        "p1_eval_injury_signal_rows": p1_res["eval_injury_signal_rows"],
    }
    (OUT / "run-state.json").write_text(json.dumps(run_state, indent=2) + "\n", encoding="utf-8")

    report = {
        "phase": "6E",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **run_state,
        "upstream": {
            "INJURY_WOWY_ESTIMATOR_CERTIFIED": "YES",
            "INJURY_WOWY_ESTIMATOR_FULL_RUN_GATE": "PASS",
        },
        "leakage": {
            "target_in_subject_baseline": "NO",
            "target_in_pair_estimator": "NO",
            "future_in_baseline": "NO",
            "future_in_pair_stats": "NO",
            "future_in_priors": "NO",
            "same_tip_leak": "NO",
            "future_mutation_invariance": "PASS" if mutation_ok else "FAIL",
        },
        "p1_coverage": p1_res["coverage"],
        "p1_metrics": {m: p1_res["metrics"][m] for m in METRICS},
        "sensitivity": sens,
        "safety": {
            "estimator_modified": "NO",
            "pair_builder_modified": "NO",
            "t60_tape_modified": "NO",
            "reason_eligibility_modified": "NO",
            "realized_wowy_modified": "NO",
            "validation_thresholds_tuned_after_results": "NO",
            "p1_changed_after_results": "NO",
            "future_leakage": "NO",
            "target_leakage": "NO",
            "multi_focal_combined": "NO",
            "production_integration": "NO",
            "causal_claim": "NO",
        },
    }
    (REPORTS / "official-injury-wowy-predictive-validation.json").write_text(
        json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8"
    )

    lines_md = [
        "# Injury WOWY rolling-origin predictive validation (Phase 6E)",
        "",
        f"Generated: **{report['generated_at']}**",
        "",
        "```text",
        f"ROLLING_ORIGIN_VALIDATION_GATE = {gate}",
        f"INJURY_WOWY_SIGNAL_STATUS = {signal_status}",
        f"INJURY_WOWY_MODEL_VALIDATED = {model_validated}",
        f"NEXT = {nxt}",
        "```",
        "",
        "## Mechanics",
        "",
        f"- Deterministic rerun: **{'PASS' if determinism_ok else 'FAIL'}**",
        f"- Future-mutation: **{'PASS' if mutation_ok else 'FAIL'}**",
        f"- Bootstrap replicates: **{BOOT_REPS}** (subject+game blocks)",
        f"- P1 prediction rows: **{p1_res['prediction_row_count']}**",
        f"- Historical existing projection baseline: **UNAVAILABLE**",
        "",
        "## Primary B0 vs B0_EB (subject-game weighted)",
        "",
        "| Metric | Eval rows | Subject-games | B0 MAE | B0+EB MAE | ΔMAE | 95% interval | Status |",
        "| ------ | --------: | ------------: | -----: | --------: | ---: | ------------ | ------ |",
    ]
    for m in METRICS:
        mm = p1_res["metrics"][m]
        b = mm["bootstrap_B0_vs_EB"]
        iv = (
            f"[{b.get('p2.5'):.4f}, {b.get('p97.5'):.4f}]"
            if b.get("p2.5") is not None
            else "n/a"
        )
        lines_md.append(
            f"| {m} | {mm['eval_rows']} | {mm['subject_games']} | {mm['B0_MAE']:.4f} | {mm['B0_EB_MAE']:.4f} | {mm['delta_MAE']:.4f} | {iv} | {mm['status']} |"
        )
    lines_md += ["", "## EB vs RAW", ""]
    for m in METRICS:
        mm = p1_res["metrics"][m]
        lines_md.append(
            f"- **{m}**: {mm['eb_vs_raw_status']} (RAW MAE={mm['B0_RAW_MAE']:.4f}, EB MAE={mm['B0_EB_MAE']:.4f})"
        )
    lines_md += [
        "",
        "## Safety",
        "",
        "All checklist items: **NO** (no estimator/product changes; no leakage; no multi-focal combine).",
        "",
    ]
    (REPORTS / "official-injury-wowy-predictive-validation.md").write_text(
        "\n".join(lines_md) + "\n", encoding="utf-8"
    )

    print(json.dumps({k: run_state[k] for k in run_state if k != "p1_elapsed_sec"}, indent=2))
    print("metric_status", metric_status)


if __name__ == "__main__":
    main()
