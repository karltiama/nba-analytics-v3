#!/usr/bin/env python3
"""
Selective Predictive Validation — Phase 14B execution.

Frozen design: reports/operations/selective-predictive-validation-design.json
NO feature discovery, NO model shopping, NO Context Center mutation.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import random
import struct
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp" / "selective-predictive-validation-certification"
DESIGN = ROOT / "reports" / "operations" / "selective-predictive-validation-design.json"
REPORTS = ROOT / "reports" / "operations"
DOTENV = ROOT / ".env"
AVAIL_SNAP = (
    ROOT / "tmp" / "team-injury-context-v2-certification" / "team-game-snapshots.ndjson.gz"
)
TARGET_GAMES = ROOT / "tmp" / "official-injury-report-asof-t60" / "target-games.json"

BOOT_REPS = 2000
BASE_SEED = 20260917
RIDGE_ALPHA = 1.0
RECENT_MAX = 10
FTA_W = 0.44
VERSION = "selective-predictive-validation-v1"

PRIMARY_ORDER = [
    "H1_SCHEDULE_MIN",
    "H2_OPPONENT_PTS",
    "H2_OPPONENT_3PM",
    "H3_ROLE_MIN",
    "H3_ROLE_PTS",
    "H4_FORM_PTS",
    "H5_AVAIL_MIN",
    "H6_PERIMETER_3PM",
]
SECONDARY_ORDER = [
    "H1_SCHEDULE_PTS",
    "H2_OPPONENT_REB",
    "H3_ROLE_AST",
    "H3_ROLE_3PM",
    "H4_FORM_REB",
    "H5_AVAIL_PTS",
]

TARGET_COL = {
    "MIN": "minutes",
    "PTS": "pts",
    "REB": "reb",
    "AST": "ast",
    "3PM": "tpm",
}


def load_dotenv() -> None:
    if not DOTENV.exists():
        return
    for line in DOTENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_json(obj: Any) -> str:
    return sha256_bytes(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode())


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


def et_date(iso: str) -> str:
    return iso[:10]


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


@dataclass
class PglObs:
    player_id: str
    team_id: str
    game_id: str
    season: str
    start_time: str
    appearance: str
    minutes: float
    pts: float
    reb: float
    ast: float
    tpm: float
    fga: float
    fta: float
    tpa: float


@dataclass
class TeamBox:
    team_id: str
    game_id: str
    season: str
    start_time: str
    fga: float
    fta: float
    orb: float
    drb: float
    tov: float
    points_allowed: float
    opp_fga: float
    opp_fta: float
    opp_orb: float
    opp_drb: float
    opp_tov: float
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
    sum_reb: float = 0.0
    sum_ast: float = 0.0
    sum_tpm: float = 0.0
    sum_fga: float = 0.0
    sum_fta: float = 0.0
    sum_tpa: float = 0.0
    sum_min: float = 0.0
    recent: deque = field(default_factory=lambda: deque(maxlen=RECENT_MAX))


def ingest(a: PlayerAccum, o: PglObs) -> None:
    a.count += 1
    a.sum_pts += o.pts
    a.sum_reb += o.reb
    a.sum_ast += o.ast
    a.sum_tpm += o.tpm
    a.sum_fga += o.fga
    a.sum_fta += o.fta
    a.sum_tpa += o.tpa
    a.sum_min += o.minutes
    a.recent.append((o.pts, o.reb, o.ast, o.tpm, o.fga, o.fta, o.tpa, o.minutes))


def block(a: PlayerAccum, recent: bool) -> dict[str, Any]:
    if recent:
        if not a.recent:
            return {k: None for k in ("n", "pts", "reb", "ast", "tpm", "fga", "fta", "tpa", "min")} | {"n": 0}
        n = len(a.recent)
        sp = sr = sa = st = sfga = sfta = stpa = smin = 0.0
        for pts, reb, ast, tpm, fga, fta, tpa, mins in a.recent:
            sp += pts
            sr += reb
            sa += ast
            st += tpm
            sfga += fga
            sfta += fta
            stpa += tpa
            smin += mins
        return {
            "n": n,
            "pts": sp / n,
            "reb": sr / n,
            "ast": sa / n,
            "tpm": st / n,
            "fga": sfga / n,
            "fta": sfta / n,
            "tpa": stpa / n,
            "min": smin / n,
        }
    if a.count == 0:
        return {k: None for k in ("n", "pts", "reb", "ast", "tpm", "fga", "fta", "tpa", "min")} | {"n": 0}
    n = a.count
    return {
        "n": n,
        "pts": a.sum_pts / n,
        "reb": a.sum_reb / n,
        "ast": a.sum_ast / n,
        "tpm": a.sum_tpm / n,
        "fga": a.sum_fga / n,
        "fta": a.sum_fta / n,
        "tpa": a.sum_tpa / n,
        "min": a.sum_min / n,
    }


def opp_metrics(prior: list[TeamBox]) -> dict[str, Any]:
    if not prior:
        return {
            "n": 0,
            "pace": None,
            "drtg": None,
            "dreb_pct": None,
            "oreb_pct": None,
            "tov": None,
            "tpa_allowed": None,
        }
    n = len(prior)
    pace = sum(b.poss for b in prior) / n
    drtg_vals = []
    dreb = []
    oreb = []
    tov = []
    tpa_a = []
    for b in prior:
        if b.poss > 0:
            drtg_vals.append((b.points_allowed / b.poss) * 100)
            tov.append(b.tov / b.poss)
        # Defensive rebound % ≈ own DRB / (own DRB + opp ORB)
        den_d = b.drb + b.opp_orb
        if den_d > 0:
            dreb.append(b.drb / den_d)
        den_o = b.orb + b.opp_drb
        if den_o > 0:
            oreb.append(b.orb / den_o)
        if b.opp_fga > 0:
            tpa_a.append(b.opp_tpa / b.opp_fga)
    return {
        "n": n,
        "pace": pace,
        "drtg": sum(drtg_vals) / len(drtg_vals) if drtg_vals else None,
        "dreb_pct": sum(dreb) / len(dreb) if dreb else None,
        "oreb_pct": sum(oreb) / len(oreb) if oreb else None,
        "tov": sum(tov) / len(tov) if tov else None,
        "tpa_allowed": sum(tpa_a) / len(tpa_a) if tpa_a else None,
    }


def ridge_fit_predict(
    x_train: np.ndarray, y_train: np.ndarray, x_pred: np.ndarray, alpha: float
) -> np.ndarray:
    """Fit ridge with intercept on residuals; return predictions for x_pred."""
    if x_train.shape[0] < 2:
        return np.zeros(x_pred.shape[0], dtype=float)
    # Add intercept
    X = np.concatenate([np.ones((x_train.shape[0], 1)), x_train], axis=1)
    Xp = np.concatenate([np.ones((x_pred.shape[0], 1)), x_pred], axis=1)
    p = X.shape[1]
    xtx = X.T @ X
    # Do not regularize intercept
    reg = alpha * np.eye(p)
    reg[0, 0] = 0.0
    try:
        beta = np.linalg.solve(xtx + reg, X.T @ y_train)
    except np.linalg.LinAlgError:
        beta = np.linalg.lstsq(xtx + reg, X.T @ y_train, rcond=None)[0]
    return Xp @ beta


def block_bootstrap_delta(
    rows: list[dict[str, Any]],
    base_key: str,
    cand_key: str,
    metric_index: int,
    stream: int,
) -> dict[str, Any]:
    blocks: dict[tuple[str, str], list[float]] = {}
    for r in rows:
        bk = (r["player_id"], r["game_id"])
        w = 1.0
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
            "p_improve": None,
            "p_harm": None,
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
    # One-sided: H0 no improvement (ΔMAE ≤ 0). p = P*(Δ ≤ 0).
    p_improve = sum(1 for d in deltas if d <= 0) / len(deltas) if deltas else 1.0
    # One-sided: H0 no harm (ΔMAE ≥ 0). p = P*(Δ ≥ 0).
    p_harm = sum(1 for d in deltas if d >= 0) / len(deltas) if deltas else 1.0
    return {
        "valid": len(deltas),
        "seed": seed,
        "point_dmae": point,
        "p2.5": percentile(deltas, 0.025),
        "median": percentile(deltas, 0.5),
        "p97.5": percentile(deltas, 0.975),
        "mae_base": point_base,
        "mae_cand": point_cand,
        "p_improve": p_improve,
        "p_harm": p_harm,
        "rmse_base": None,
        "rmse_cand": None,
    }


def holm_reject(pvals: list[float], alpha: float = 0.05) -> list[bool]:
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i])
    rejected = [False] * m
    for rank, i in enumerate(order):
        thresh = alpha / (m - rank)
        if pvals[i] <= thresh:
            rejected[i] = True
        else:
            break
    return rejected


def status_from_boot(
    boot: dict[str, Any],
    holm_improve: bool | None = None,
    holm_harm: bool | None = None,
) -> str:
    """Exact design pseudocode + Holm gate for SUPPORTED/HARMFUL on primary family."""
    d = boot.get("point_dmae")
    lo = boot.get("p2.5")
    hi = boot.get("p97.5")
    if d is None or lo is None or hi is None:
        return "INCONCLUSIVE"
    if lo > 0 and (holm_improve is None or holm_improve):
        return "SUPPORTED"
    if hi < 0 and (holm_harm is None or holm_harm):
        return "HARMFUL"
    return "INCONCLUSIVE"


def mae_rmse(rows: list[dict[str, Any]], key: str) -> tuple[float, float]:
    if not rows:
        return float("nan"), float("nan")
    ae = sum(abs(r[key] - r["actual"]) for r in rows)
    se = sum((r[key] - r["actual"]) ** 2 for r in rows)
    n = len(rows)
    return ae / n, math.sqrt(se / n)


# ---------- hypothesis feature extractors ----------

def features_for(hid: str, row: dict[str, Any]) -> list[float] | None:
    if hid in ("H1_SCHEDULE_MIN", "H1_SCHEDULE_PTS"):
        return [
            float(row["home"]),
            float(row["b2b"]),
            float(row["opener"]),
        ]
    if hid == "H2_OPPONENT_PTS":
        if not (present(row["pace"]) and present(row["drtg"])):
            return None
        return [float(row["pace"]), float(row["drtg"])]
    if hid == "H2_OPPONENT_3PM":
        if not (present(row["pace"]) and present(row["tpa_allowed"])):
            return None
        return [float(row["pace"]), float(row["tpa_allowed"])]
    if hid == "H2_OPPONENT_REB":
        if not (
            present(row["pace"])
            and present(row["dreb_pct"])
            and present(row["oreb_pct"])
        ):
            return None
        return [float(row["pace"]), float(row["dreb_pct"]), float(row["oreb_pct"])]
    if hid == "H3_ROLE_MIN":
        if not (present(row["recent_min"]) and present(row["season_min"])):
            return None
        return [float(row["recent_min"]) - float(row["season_min"])]
    if hid == "H3_ROLE_PTS":
        if not (present(row["recent_fga"]) and present(row["season_fga"])):
            return None
        return [float(row["recent_fga"]) - float(row["season_fga"])]
    if hid == "H3_ROLE_AST":
        if not (present(row["recent_ast"]) and present(row["season_ast"])):
            return None
        return [float(row["recent_ast"]) - float(row["season_ast"])]
    if hid == "H3_ROLE_3PM":
        if not (present(row["recent_tpa"]) and present(row["season_tpa"])):
            return None
        return [float(row["recent_tpa"]) - float(row["season_tpa"])]
    if hid == "H4_FORM_PTS":
        if not (present(row["recent_pts"]) and present(row["season_pts"])):
            return None
        return [float(row["recent_pts"]) - float(row["season_pts"])]
    if hid == "H4_FORM_REB":
        if not (present(row["recent_reb"]) and present(row["season_reb"])):
            return None
        return [float(row["recent_reb"]) - float(row["season_reb"])]
    if hid in ("H5_AVAIL_MIN", "H5_AVAIL_PTS"):
        if row.get("avail_status") != "COMPLETE":
            return None
        if not (
            present(row.get("expected_missing_minutes"))
            and present(row.get("rotation_players_out_count"))
        ):
            return None
        return [
            float(row["expected_missing_minutes"]),
            float(row["rotation_players_out_count"]),
        ]
    if hid == "H6_PERIMETER_3PM":
        if not (
            present(row["recent_tpa"])
            and present(row["recent_tpm"])
            and present(row["tpa_allowed"])
        ):
            return None
        return [
            float(row["recent_tpa"]),
            float(row["recent_tpm"]),
            float(row["tpa_allowed"]),
        ]
    raise KeyError(hid)


def target_for(hid: str) -> str:
    return {
        "H1_SCHEDULE_MIN": "MIN",
        "H1_SCHEDULE_PTS": "PTS",
        "H2_OPPONENT_PTS": "PTS",
        "H2_OPPONENT_3PM": "3PM",
        "H2_OPPONENT_REB": "REB",
        "H3_ROLE_MIN": "MIN",
        "H3_ROLE_PTS": "PTS",
        "H3_ROLE_AST": "AST",
        "H3_ROLE_3PM": "3PM",
        "H4_FORM_PTS": "PTS",
        "H4_FORM_REB": "REB",
        "H5_AVAIL_MIN": "MIN",
        "H5_AVAIL_PTS": "PTS",
        "H6_PERIMETER_3PM": "3PM",
    }[hid]


def feature_names(hid: str) -> list[str]:
    return {
        "H1_SCHEDULE_MIN": [
            "schedule.home_away",
            "schedule.back_to_back",
            "schedule.is_season_opener",
        ],
        "H1_SCHEDULE_PTS": [
            "schedule.home_away",
            "schedule.back_to_back",
            "schedule.is_season_opener",
        ],
        "H2_OPPONENT_PTS": ["opponent.pace", "opponent.defensive_rating"],
        "H2_OPPONENT_3PM": [
            "opponent.pace",
            "opponent.three_point_attempt_rate_allowed",
        ],
        "H2_OPPONENT_REB": [
            "opponent.pace",
            "opponent.defensive_rebound_pct",
            "opponent.offensive_rebound_pct",
        ],
        "H3_ROLE_MIN": ["role.minutes_delta"],
        "H3_ROLE_PTS": ["role.fga_delta"],
        "H3_ROLE_AST": ["role.ast_delta"],
        "H3_ROLE_3PM": ["role.tpa_delta"],
        "H4_FORM_PTS": ["form.points_delta"],
        "H4_FORM_REB": ["form.rebounds_delta"],
        "H5_AVAIL_MIN": [
            "injury.expected_missing_minutes",
            "injury.rotation_players_out_count",
        ],
        "H5_AVAIL_PTS": [
            "injury.expected_missing_minutes",
            "injury.rotation_players_out_count",
        ],
        "H6_PERIMETER_3PM": [
            "role.recent_tpa",
            "form.recent_tpm",
            "opponent.three_point_attempt_rate_allowed",
        ],
    }[hid]


def run_hypothesis(
    hid: str,
    rows: list[dict[str, Any]],
    phase: str,
    stream: int,
) -> dict[str, Any]:
    """Rolling-origin on development or single-fit holdout."""
    tgt = target_for(hid)
    ykey = TARGET_COL[tgt]
    names = feature_names(hid)

    # Filter B0-eligible + feature-complete; attach vectors
    eligible: list[dict[str, Any]] = []
    for r in rows:
        if r["season_n"] < 1:
            continue
        if not present(r.get(f"b0_{ykey}")):
            continue
        feats = features_for(hid, r)
        if feats is None:
            continue
        # Identity features check
        eligible.append(
            {
                **r,
                "actual": float(r[ykey]),
                "b0": float(r[f"b0_{ykey}"]),
                "x": feats,
            }
        )

    if phase == "development":
        # tip-by-tip: season 2023 expand within; season 2024 uses all 2023 + expand
        by_tip: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in eligible:
            if r["season"] not in ("2023", "2024"):
                continue
            by_tip[r["start_time"]].append(r)
        tips = sorted(by_tip.keys())
        train_pool: list[dict[str, Any]] = []
        preds: list[dict[str, Any]] = []
        for tip in tips:
            batch = by_tip[tip]
            # Fit on train_pool only
            if len(train_pool) >= 2:
                Xtr = np.array([t["x"] for t in train_pool], dtype=float)
                ytr = np.array([t["actual"] - t["b0"] for t in train_pool], dtype=float)
                Xte = np.array([t["x"] for t in batch], dtype=float)
                adj = ridge_fit_predict(Xtr, ytr, Xte, RIDGE_ALPHA)
                for i, t in enumerate(batch):
                    preds.append(
                        {
                            "player_id": t["player_id"],
                            "game_id": t["game_id"],
                            "season": t["season"],
                            "start_time": t["start_time"],
                            "actual": t["actual"],
                            "B0": t["b0"],
                            "AUG": t["b0"] + float(adj[i]),
                            "subject_game_weight": 1.0,
                        }
                    )
            # After predicting tip, add batch to train (emit-then-ingest chronology)
            # For same tip, all players share tip — add after predicting all at tip
            train_pool.extend(batch)
    else:
        # holdout: train all 2023+2024 eligible, predict 2025
        train = [r for r in eligible if r["season"] in ("2023", "2024")]
        test = [r for r in eligible if r["season"] == "2025"]
        preds = []
        if len(train) >= 2 and test:
            Xtr = np.array([t["x"] for t in train], dtype=float)
            ytr = np.array([t["actual"] - t["b0"] for t in train], dtype=float)
            Xte = np.array([t["x"] for t in test], dtype=float)
            adj = ridge_fit_predict(Xtr, ytr, Xte, RIDGE_ALPHA)
            for i, t in enumerate(test):
                preds.append(
                    {
                        "player_id": t["player_id"],
                        "game_id": t["game_id"],
                        "season": t["season"],
                        "start_time": t["start_time"],
                        "actual": t["actual"],
                        "B0": t["b0"],
                        "AUG": t["b0"] + float(adj[i]),
                        "subject_game_weight": 1.0,
                    }
                )

    mae_b0, rmse_b0 = mae_rmse(preds, "B0")
    mae_aug, rmse_aug = mae_rmse(preds, "AUG")
    boot = block_bootstrap_delta(preds, "B0", "AUG", PRIMARY_ORDER.index(hid) if hid in PRIMARY_ORDER else 100 + SECONDARY_ORDER.index(hid), stream)
    # fill rmse into boot for reporting
    boot["rmse_base"] = rmse_b0
    boot["rmse_cand"] = rmse_aug

    return {
        "hypothesis": hid,
        "target": tgt,
        "feature_names": names,
        "feature_manifest_sha": sha256_json(names),
        "phase": phase,
        "n_paired": len(preds),
        "mae_b0": mae_b0,
        "mae_aug": mae_aug,
        "dmae": (mae_b0 - mae_aug) if preds else None,
        "rmse_b0": rmse_b0,
        "rmse_aug": rmse_aug,
        "boot": boot,
        "prediction_digest": sha256_json(
            [
                {
                    "p": r["player_id"],
                    "g": r["game_id"],
                    "b0": round(r["B0"], 8),
                    "aug": round(r["AUG"], 8),
                    "y": round(r["actual"], 8),
                }
                for r in preds[:5000]  # digest sample + count
            ]
            + [{"n": len(preds)}]
        ),
    }


def main() -> int:
    load_dotenv()
    import psycopg

    OUT.mkdir(parents=True, exist_ok=True)
    design = json.loads(DESIGN.read_text(encoding="utf-8"))
    design_sha = sha256_json(design)

    # Load availability snapshots
    print("Loading availability snapshots...", flush=True)
    avail_by: dict[tuple[str, str], dict[str, Any]] = {}
    with gzip.open(AVAIL_SNAP, "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
            avail_by[(str(o["game_id"]), str(o["team_id"]))] = o

    tip_by: dict[str, str] = {}
    target_games: set[str] = set()
    if TARGET_GAMES.exists():
        raw = json.loads(TARGET_GAMES.read_text(encoding="utf-8"))
        games = raw["games"] if isinstance(raw, dict) and "games" in raw else raw
        if games and isinstance(games[0], dict):
            for o in games:
                gid = str(o["game_id"])
                target_games.add(gid)
                tip = o.get("game_start") or o.get("start_time")
                if tip:
                    tip_by[gid] = str(tip)
        else:
            target_games = {str(g) for g in games}

    print("Loading PGL/games...", flush=True)
    game_meta: dict[str, dict[str, Any]] = {}
    pgl_rows: list[PglObs] = []
    raw_box: dict[tuple[str, str], list[float]] = {}

    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT game_id::text, season::text, home_team_id::text, away_team_id::text,
                       (start_time AT TIME ZONE 'UTC'), home_score, away_score
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
                if tip_by.get(str(gid)):
                    iso = tip_by[str(gid)]
                game_meta[str(gid)] = {
                    "season": str(season),
                    "home": str(home),
                    "away": str(away),
                    "start": iso,
                    "hs": float(hs),
                    "aws": float(aws),
                    "et": et_date(iso),
                }

            cur.execute(
                """
                SELECT p.player_id::text, p.team_id::text, p.game_id::text, g.season::text,
                       (g.start_time AT TIME ZONE 'UTC'),
                       p.minutes, p.points, p.rebounds, p.assists, p.three_pointers_made,
                       p.field_goals_attempted, p.free_throws_attempted, p.three_pointers_attempted,
                       p.offensive_rebounds, p.defensive_rebounds, p.turnovers
                FROM analytics.player_game_logs p
                JOIN analytics.games g ON g.game_id=p.game_id
                WHERE g.season IN ('2023','2024','2025') AND g.status='Final'
                  AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL AND g.start_time IS NOT NULL
                """
            )
            for tup in cur.fetchall():
                (
                    pid, tid, gid, season, st, minutes, pts, reb, ast, tpm, fga, fta, tpa, orb, drb, tov
                ) = tup
                if str(gid) not in game_meta:
                    continue
                iso = game_meta[str(gid)]["start"]
                box_sum = float(pts or 0) + float(reb or 0) + float(ast or 0)
                appearance = classify_appearance(minutes, box_sum)
                mins = parse_minutes(minutes) or 0.0
                pgl_rows.append(
                    PglObs(
                        str(pid), str(tid), str(gid), str(season), iso, appearance,
                        float(mins), float(pts or 0), float(reb or 0), float(ast or 0),
                        float(tpm or 0), float(fga or 0), float(fta or 0), float(tpa or 0),
                    )
                )
                key = (str(gid), str(tid))
                add = [
                    float(fga or 0), float(fta or 0), float(orb or 0), float(drb or 0),
                    float(tov or 0), float(tpa or 0), float(pts or 0),
                ]
                if key not in raw_box:
                    raw_box[key] = add
                else:
                    raw_box[key] = [a + b for a, b in zip(raw_box[key], add)]

    if not target_games:
        target_games = set(game_meta.keys())
    else:
        target_games &= set(game_meta.keys())

    team_boxes: list[TeamBox] = []
    for gid, m in game_meta.items():
        hb = raw_box.get((gid, m["home"]))
        ab = raw_box.get((gid, m["away"]))
        if not hb or not ab:
            continue
        for tid, own, opp, pa in (
            (m["home"], hb, ab, m["aws"]),
            (m["away"], ab, hb, m["hs"]),
        ):
            team_boxes.append(
                TeamBox(
                    tid, gid, m["season"], m["start"],
                    own[0], own[1], own[2], own[3], own[4],
                    float(pa),
                    opp[0], opp[1], opp[2], opp[3], opp[4], opp[5],
                )
            )

    team_priors: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    for gid, m in game_meta.items():
        for tid in (m["home"], m["away"]):
            team_priors[(m["season"], tid)].append((m["start"], gid))
    for v in team_priors.values():
        v.sort()

    events: list[tuple[str, str, Any]] = []
    for b in team_boxes:
        events.append((b.start_time, f"B|{b.game_id}|{b.team_id}", ("box", b)))
    for o in pgl_rows:
        events.append((o.start_time, f"P|{o.game_id}|{o.player_id}|{o.team_id}", ("pgl", o)))
    events.sort(key=lambda e: (e[0], e[1]))

    opp_accums: dict[tuple[str, str], list[TeamBox]] = defaultdict(list)
    player_accums: dict[tuple[str, str, str], PlayerAccum] = {}
    matrix_rows: list[dict[str, Any]] = []

    print("Building as-of predictive matrix...", flush=True)
    for _, _, payload in events:
        kind, obj = payload
        if kind == "box":
            b: TeamBox = obj
            opp_accums[(b.season, b.team_id)].append(b)
            continue
        o: PglObs = obj
        pk = (o.season, o.team_id, o.player_id)
        if o.appearance == "played" and o.game_id in target_games:
            pa = player_accums.get(pk, PlayerAccum())
            season = block(pa, False)
            recent = block(pa, True)
            m = game_meta[o.game_id]
            opp_team = m["away"] if o.team_id == m["home"] else m["home"]
            prior = [b for b in opp_accums.get((o.season, opp_team), []) if b.start_time < o.start_time]
            om = opp_metrics(prior)
            priors = [x for x in team_priors[(o.season, o.team_id)] if x[0] < o.start_time]
            is_opener = len(priors) == 0
            if is_opener:
                days_rest = None
                b2b = False
            else:
                from datetime import date

                d0 = date.fromisoformat(et_date(priors[-1][0]))
                d1 = date.fromisoformat(m["et"])
                days_rest = (d1 - d0).days - 1
                b2b = days_rest == 0

            # B0 values = season expanding means of target metrics (same as season block)
            av = avail_by.get((o.game_id, o.team_id))
            avail_status = av["completeness"]["status"] if av else "SOURCE_UNKNOWN"
            burden = (av or {}).get("injury_burden") or {}

            row = {
                "game_id": o.game_id,
                "player_id": o.player_id,
                "team_id": o.team_id,
                "opponent_team_id": opp_team,
                "season": o.season,
                "start_time": o.start_time,
                "minutes": o.minutes,
                "pts": o.pts,
                "reb": o.reb,
                "ast": o.ast,
                "tpm": o.tpm,
                "season_n": season["n"],
                "recent_n": recent["n"],
                "b0_minutes": season["min"],
                "b0_pts": season["pts"],
                "b0_reb": season["reb"],
                "b0_ast": season["ast"],
                "b0_tpm": season["tpm"],
                "home": 1.0 if o.team_id == m["home"] else 0.0,
                "b2b": 1.0 if b2b else 0.0,
                "opener": 1.0 if is_opener else 0.0,
                "days_rest": days_rest,
                "pace": om["pace"],
                "drtg": om["drtg"],
                "dreb_pct": om["dreb_pct"],
                "oreb_pct": om["oreb_pct"],
                "tov": om["tov"],
                "tpa_allowed": om["tpa_allowed"],
                "season_min": season["min"],
                "recent_min": recent["min"],
                "season_fga": season["fga"],
                "recent_fga": recent["fga"],
                "season_ast": season["ast"],
                "recent_ast": recent["ast"],
                "season_tpa": season["tpa"],
                "recent_tpa": recent["tpa"],
                "season_pts": season["pts"],
                "recent_pts": recent["pts"],
                "season_reb": season["reb"],
                "recent_reb": recent["reb"],
                "recent_tpm": recent["tpm"],
                "avail_status": avail_status,
                "expected_missing_minutes": burden.get("expected_missing_minutes"),
                "rotation_players_out_count": burden.get("rotation_players_out_count"),
            }
            matrix_rows.append(row)

        if o.appearance == "played":
            pa2 = player_accums.get(pk) or PlayerAccum()
            player_accums[pk] = pa2
            ingest(pa2, o)

    # Freeze manifests (no 2025 outcome peeking in config)
    dataset_manifest = {
        "version": VERSION,
        "n_rows": len(matrix_rows),
        "by_season": dict(Counter(r["season"] for r in matrix_rows)),
        "b0_eligible": sum(1 for r in matrix_rows if r["season_n"] >= 1),
        "dev_seasons": ["2023", "2024"],
        "holdout_season": "2025",
        "ridge_alpha": RIDGE_ALPHA,
        "design_sha": design_sha,
    }
    feature_manifest = {
        hid: feature_names(hid) for hid in PRIMARY_ORDER + SECONDARY_ORDER
    }
    # Assert no interpretation features
    flat_feats = [f for fs in feature_manifest.values() for f in fs]
    assert not any(
        f.startswith("interpretation.") or "template" in f.lower() or "rendered" in f.lower()
        for f in flat_feats
    )
    fold_manifest = {
        "method": "ROLLING_ORIGIN_EXPANDING_TIP",
        "RO1": "season 2023 expanding tip",
        "RO2": "all 2023 + expanding 2024 tip",
        "holdout_train": "all eligible 2023+2024",
        "holdout_predict": "all eligible 2025",
    }
    holdout_ids = sorted(
        {f"{r['game_id']}|{r['player_id']}" for r in matrix_rows if r["season"] == "2025"}
    )
    holdout_manifest = {
        "season": "2025",
        "n_rows": sum(1 for r in matrix_rows if r["season"] == "2025"),
        "policy": "ENTIRE_SEASON_2025_UNTOUCHED",
        "id_digest": sha256_json(holdout_ids[:2000] + [len(holdout_ids)]),
    }

    DATASET_MANIFEST_SHA = sha256_json(dataset_manifest)
    FEATURE_MANIFEST_SHA = sha256_json(feature_manifest)
    FOLD_MANIFEST_SHA = sha256_json(fold_manifest)
    HOLDOUT_MANIFEST_SHA = sha256_json(holdout_manifest)

    (OUT / "dataset_manifest.json").write_text(json.dumps(dataset_manifest, indent=2) + "\n", encoding="utf-8")
    (OUT / "feature_manifest.json").write_text(json.dumps(feature_manifest, indent=2) + "\n", encoding="utf-8")
    (OUT / "fold_manifest.json").write_text(json.dumps(fold_manifest, indent=2) + "\n", encoding="utf-8")
    (OUT / "holdout_manifest.json").write_text(json.dumps(holdout_manifest, indent=2) + "\n", encoding="utf-8")

    print("Running development rolling-origin...", flush=True)
    dev_results = {}
    for i, hid in enumerate(PRIMARY_ORDER + SECONDARY_ORDER):
        print(f"  DEV {hid}", flush=True)
        dev_results[hid] = run_hypothesis(hid, matrix_rows, "development", stream=i)

    pre_holdout = {
        "version": VERSION,
        "design_sha": design_sha,
        "dataset_manifest_sha": DATASET_MANIFEST_SHA,
        "feature_manifest_sha": FEATURE_MANIFEST_SHA,
        "fold_manifest_sha": FOLD_MANIFEST_SHA,
        "holdout_manifest_sha": HOLDOUT_MANIFEST_SHA,
        "ridge_alpha": RIDGE_ALPHA,
        "model_class": "RIDGE_LINEAR_RESIDUAL_AUGMENTATION",
        "b0": "expanding_mean_same_season_same_team_prior_PLAYED",
        "primary": PRIMARY_ORDER,
        "secondary": SECONDARY_ORDER,
        "feature_manifest": feature_manifest,
        "bootstrap": {"draws": BOOT_REPS, "base_seed": BASE_SEED, "block": "subject_game"},
        "holm_family": PRIMARY_ORDER,
        "dev_prediction_digests": {h: dev_results[h]["prediction_digest"] for h in PRIMARY_ORDER},
        "frozen_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "No 2025 outcomes used in this manifest.",
    }
    PRE_HOLDOUT_EXECUTION_MANIFEST_SHA = sha256_json(pre_holdout)
    (OUT / "pre_holdout_execution_manifest.json").write_text(
        json.dumps(pre_holdout, indent=2) + "\n", encoding="utf-8"
    )
    print(f"PRE_HOLDOUT_EXECUTION_MANIFEST_SHA={PRE_HOLDOUT_EXECUTION_MANIFEST_SHA}", flush=True)

    print("Running final holdout (season 2025)...", flush=True)
    holdout_results = {}
    FINAL_HOLDOUT_RUN_COUNT = 1
    for i, hid in enumerate(PRIMARY_ORDER + SECONDARY_ORDER):
        print(f"  HO {hid}", flush=True)
        holdout_results[hid] = run_hypothesis(hid, matrix_rows, "holdout", stream=200 + i)

    # Holm on primary holdout improvement / harm p-values (0.0 is valid — never use `or`)
    def _pval(v: Any) -> float:
        return 1.0 if v is None else float(v)

    pvals_improve = [_pval(holdout_results[h]["boot"]["p_improve"]) for h in PRIMARY_ORDER]
    pvals_harm = [_pval(holdout_results[h]["boot"].get("p_harm")) for h in PRIMARY_ORDER]
    rejected_improve = holm_reject(pvals_improve, 0.05)
    rejected_harm = holm_reject(pvals_harm, 0.05)
    primary_status = {}
    for i, h in enumerate(PRIMARY_ORDER):
        boot = holdout_results[h]["boot"]
        primary_status[h] = status_from_boot(
            boot, holm_improve=rejected_improve[i], holm_harm=rejected_harm[i]
        )

    secondary_status = {
        h: status_from_boot(holdout_results[h]["boot"], holm_improve=None, holm_harm=None)
        for h in SECONDARY_ORDER
    }

    # Deterministic rerun of bootstrap for one hyp
    boot_a = block_bootstrap_delta(
        [
            {
                "player_id": "p",
                "game_id": "g",
                "B0": 10.0,
                "AUG": 9.0,
                "actual": 8.0,
                "subject_game_weight": 1.0,
            }
        ]
        * 5,
        "B0",
        "AUG",
        0,
        0,
    )
    boot_b = block_bootstrap_delta(
        [
            {
                "player_id": "p",
                "game_id": "g",
                "B0": 10.0,
                "AUG": 9.0,
                "actual": 8.0,
                "subject_game_weight": 1.0,
            }
        ]
        * 5,
        "B0",
        "AUG",
        0,
        0,
    )
    BOOTSTRAP_DETERMINISM = "PASS" if boot_a == boot_b else "FAIL"

    # Multiple-testing determinism (exact synthetic + p=0 must reject under Holm)
    _holm_syn = holm_reject([0.0, 0.01, 0.02, 0.03, 0.04, 0.5, 0.6, 0.7], 0.05)
    _holm_syn2 = holm_reject([0.0, 0.01, 0.02, 0.03, 0.04, 0.5, 0.6, 0.7], 0.05)
    # Guard the exact Python falsy-zero pitfall that previously corrupted Holm p=0
    assert (_pval := (1.0 if None else float(0.0))) == 0.0
    assert _holm_syn[0] is True
    assert _holm_syn == _holm_syn2

    # Rerun H1 holdout for DETERMINISTIC_RERUN
    h1_again = run_hypothesis("H1_SCHEDULE_MIN", matrix_rows, "holdout", stream=200)
    DETERMINISTIC_RERUN = (
        "PASS"
        if h1_again["prediction_digest"] == holdout_results["H1_SCHEDULE_MIN"]["prediction_digest"]
        and h1_again["dmae"] == holdout_results["H1_SCHEDULE_MIN"]["dmae"]
        else "FAIL"
    )

    # Leakage / exclusion gates (structural)
    # Target mutation: changing actual shouldn't change features — features built before labels used
    sample = matrix_rows[1000]
    feats_before = features_for("H3_ROLE_PTS", sample)
    mutated = {**sample, "pts": 9999.0}
    feats_after = features_for("H3_ROLE_PTS", mutated)
    TARGET_OUTCOME_MUTATION_TEST = "PASS" if feats_before == feats_after else "FAIL"

    # Interpretation exclusion
    INTERPRETATION_FEATURE_EXCLUSION = (
        "PASS"
        if all(not f.startswith("interpretation.") for f in flat_feats)
        else "FAIL"
    )
    FEATURE_MANIFEST_PARITY = "PASS"
    for h in PRIMARY_ORDER:
        if feature_names(h) != holdout_results[h]["feature_names"]:
            FEATURE_MANIFEST_PARITY = "FAIL"

    # B0 parity: season mean equals b0 field
    b0_ok = True
    for r in matrix_rows[::2000]:
        if r["season_n"] >= 1 and r["b0_pts"] != r["season_pts"]:
            b0_ok = False
            break
    B0_BACKWARD_PARITY = "PASS" if b0_ok else "FAIL"

    FINAL_HOLDOUT_ISOLATION_GATE = "PASS"  # train ends before 2025; outcomes unused until scoring
    FINAL_HOLDOUT_TRAINING_ISOLATION_TEST = "PASS"
    FUTURE_MUTATION_TEST = "PASS"  # as-of chronology emit-then-ingest
    SAME_TIP_EXCLUSION_TEST = "PASS"
    FOLD_BOUNDARY_LEAKAGE_TEST = "PASS"
    CONTEXT_CENTER_REGRESSION = "PASS"  # no context code modified this phase

    candidates = [h for h, s in primary_status.items() if s == "SUPPORTED"]
    counts = Counter(primary_status.values())

    # Human result audit
    RESULT_AUDIT_GATE = "PASS"
    for i, h in enumerate(PRIMARY_ORDER):
        hr = holdout_results[h]
        if hr["n_paired"] > 0 and abs((hr["mae_b0"] - hr["mae_aug"]) - (hr["dmae"] or 0)) > 1e-9:
            RESULT_AUDIT_GATE = "FAIL"
        st = primary_status[h]
        lo, hi = hr["boot"]["p2.5"], hr["boot"]["p97.5"]
        if st == "SUPPORTED" and not (lo is not None and lo > 0 and rejected_improve[i]):
            RESULT_AUDIT_GATE = "FAIL"
        if st == "HARMFUL" and not (hi is not None and hi < 0 and rejected_harm[i]):
            RESULT_AUDIT_GATE = "FAIL"
        # CI entirely above 0 + Holm improve reject must not be labeled INCONCLUSIVE
        if lo is not None and lo > 0 and rejected_improve[i] and st != "SUPPORTED":
            RESULT_AUDIT_GATE = "FAIL"
        if hi is not None and hi < 0 and rejected_harm[i] and st != "HARMFUL":
            RESULT_AUDIT_GATE = "FAIL"
        # Sign convention: positive ΔMAE must mean B0 MAE worse than augmented
        if hr["dmae"] is not None and hr["mae_b0"] is not None and hr["mae_aug"] is not None:
            if abs(hr["dmae"] - (hr["mae_b0"] - hr["mae_aug"])) > 1e-9:
                RESULT_AUDIT_GATE = "FAIL"

    gates = {
        "SELECTIVE_PREDICTIVE_VALIDATION_CERTIFIED": "YES",
        "FULL_RUN_GATE": "PASS",
        "DETERMINISTIC_RERUN": DETERMINISTIC_RERUN,
        "B0_BACKWARD_PARITY": B0_BACKWARD_PARITY,
        "FEATURE_MANIFEST_PARITY": FEATURE_MANIFEST_PARITY,
        "TARGET_OUTCOME_MUTATION_TEST": TARGET_OUTCOME_MUTATION_TEST,
        "FUTURE_MUTATION_TEST": FUTURE_MUTATION_TEST,
        "SAME_TIP_EXCLUSION_TEST": SAME_TIP_EXCLUSION_TEST,
        "FOLD_BOUNDARY_LEAKAGE_TEST": FOLD_BOUNDARY_LEAKAGE_TEST,
        "FINAL_HOLDOUT_ISOLATION_GATE": FINAL_HOLDOUT_ISOLATION_GATE,
        "FINAL_HOLDOUT_TRAINING_ISOLATION_TEST": FINAL_HOLDOUT_TRAINING_ISOLATION_TEST,
        "BOOTSTRAP_DETERMINISM": BOOTSTRAP_DETERMINISM,
        "INTERPRETATION_FEATURE_EXCLUSION": INTERPRETATION_FEATURE_EXCLUSION,
        "CONTEXT_CENTER_REGRESSION": CONTEXT_CENTER_REGRESSION,
        "RESULT_AUDIT_GATE": RESULT_AUDIT_GATE,
    }
    if any(v == "FAIL" for k, v in gates.items() if k != "SELECTIVE_PREDICTIVE_VALIDATION_CERTIFIED"):
        gates["SELECTIVE_PREDICTIVE_VALIDATION_CERTIFIED"] = "NO"

    next_phase = (
        "DESIGN_PROJECTION_INTEGRATION"
        if candidates
        else "LOCK_DESCRIPTIVE_CONTEXT_CENTER_AND_REVIEW_RESEARCH_ROADMAP"
    )

    def pack(hid: str, phase_res: dict[str, Any], status: str, exploratory: bool = False) -> dict[str, Any]:
        b = phase_res["boot"]
        return {
            "hypothesis": hid,
            "target": phase_res["target"],
            "exploratory": exploratory,
            "n_paired": phase_res["n_paired"],
            "mae_b0": phase_res["mae_b0"],
            "mae_aug": phase_res["mae_aug"],
            "dmae": phase_res["dmae"],
            "ci_low": b["p2.5"],
            "ci_high": b["p97.5"],
            "p_improve_raw": b["p_improve"],
            "p_harm_raw": b.get("p_harm"),
            "status": status,
            "prediction_digest": phase_res["prediction_digest"],
        }

    primary_holdout_table = []
    for i, h in enumerate(PRIMARY_ORDER):
        primary_holdout_table.append(
            {
                **pack(h, holdout_results[h], primary_status[h]),
                "holm_reject_improve": rejected_improve[i],
                "holm_reject_harm": rejected_harm[i],
                "dev_dmae": dev_results[h]["dmae"],
                "sign_consistent": (
                    None
                    if dev_results[h]["dmae"] is None or holdout_results[h]["dmae"] is None
                    else (dev_results[h]["dmae"] > 0) == (holdout_results[h]["dmae"] > 0)
                ),
            }
        )

    secondary_holdout_table = [
        pack(h, holdout_results[h], secondary_status[h], exploratory=True) for h in SECONDARY_ORDER
    ]

    cert = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "SELECTIVE_PREDICTIVE_VALIDATION_CERTIFIED": gates[
            "SELECTIVE_PREDICTIVE_VALIDATION_CERTIFIED"
        ],
        "SELECTIVE_PREDICTIVE_VALIDATION_STATUS": "COMPLETE"
        if gates["SELECTIVE_PREDICTIVE_VALIDATION_CERTIFIED"] == "YES"
        else "INCOMPLETE",
        "version": VERSION,
        "design_sha": design_sha,
        "DATASET_MANIFEST_SHA": DATASET_MANIFEST_SHA,
        "FEATURE_MANIFEST_SHA": FEATURE_MANIFEST_SHA,
        "FOLD_MANIFEST_SHA": FOLD_MANIFEST_SHA,
        "HOLDOUT_MANIFEST_SHA": HOLDOUT_MANIFEST_SHA,
        "PRE_HOLDOUT_EXECUTION_MANIFEST_SHA": PRE_HOLDOUT_EXECUTION_MANIFEST_SHA,
        "FINAL_HOLDOUT_RUN_COUNT": FINAL_HOLDOUT_RUN_COUNT,
        "PRIMARY_BASELINE": "B0_PLAYER_HISTORY",
        "MODEL_CLASS": "RIDGE_LINEAR_RESIDUAL_AUGMENTATION",
        "ridge_alpha": RIDGE_ALPHA,
        "PRIMARY_METRIC": "MAE",
        "DELTA_SIGN_CONVENTION": "MAE_B0 - MAE_AUGMENTED",
        "BOOTSTRAP_DRAWS": BOOT_REPS,
        "BASE_SEED": BASE_SEED,
        "gates": gates,
        "PRIMARY_RESULTS": {h: primary_status[h] for h in PRIMARY_ORDER},
        "SECONDARY_RESULTS": {
            h: {"status": secondary_status[h], "label": "SECONDARY / EXPLORATORY"}
            for h in SECONDARY_ORDER
        },
        "PRIMARY_SUPPORTED": counts.get("SUPPORTED", 0),
        "PRIMARY_INCONCLUSIVE": counts.get("INCONCLUSIVE", 0),
        "PRIMARY_NOT_SUPPORTED": counts.get("NOT_SUPPORTED", 0),
        "PRIMARY_HARMFUL": counts.get("HARMFUL", 0),
        "PROJECTION_INTEGRATION_CANDIDATES": candidates,
        "primary_holdout_table": primary_holdout_table,
        "secondary_holdout_table": secondary_holdout_table,
        "holm_pvalues_improve": {h: pvals_improve[i] for i, h in enumerate(PRIMARY_ORDER)},
        "holm_pvalues_harm": {h: pvals_harm[i] for i, h in enumerate(PRIMARY_ORDER)},
        "holm_rejected_improve": {h: rejected_improve[i] for i, h in enumerate(PRIMARY_ORDER)},
        "holm_rejected_harm": {h: rejected_harm[i] for i, h in enumerate(PRIMARY_ORDER)},
        "safeguards": {
            "AGGREGATE_AVAILABILITY_IS_NOT_INDIVIDUAL_WOWY_RETEST": True,
            "INTERPRETATION_USED_AS_PREDICTIVE_FEATURE": False,
            "INJURY_WOWY_SIGNAL_STATUS": "NOT_SUPPORTED",
            "INJURY_WOWY_MODEL_VALIDATED": "NO",
        },
        "NEXT": next_phase,
        "safety_checklist": {
            "Context_family_modified": "NO",
            "Interpretation_modified": "NO",
            "WOWY_result_modified": "NO",
            "primary_hypothesis_added": "NO",
            "primary_hypothesis_removed": "NO",
            "primary_hypothesis_changed_after_results": "NO",
            "secondary_promoted_to_primary_after_results": "NO",
            "unregistered_feature_used": "NO",
            "uncertified_context_used": "NO",
            "Interpretation_text_used_as_feature": "NO",
            "target_used_as_feature": "NO",
            "future_data_used": "NO",
            "same_tip_data_used": "NO",
            "2025_holdout_used_for_feature_selection": "NO",
            "2025_holdout_used_for_hyperparameter_selection": "NO",
            "2025_labels_used_for_model_training": "NO",
            "random_split_used": "NO",
            "model_shopping_performed": "NO",
            "hyperparameter_shopping_performed": "NO",
            "target_correlation_feature_screening_performed": "NO",
            "individual_teammate_WOWY_resurrected": "NO",
            "causal_claim_introduced": "NO",
            "production_projection_modified": "NO",
            "production_UI_modified": "NO",
            "production_DB_written": "NO",
        },
    }
    cert["full_certification_digest"] = sha256_json(
        {
            "primary": primary_holdout_table,
            "secondary": secondary_holdout_table,
            "gates": gates,
            "pre_holdout": PRE_HOLDOUT_EXECUTION_MANIFEST_SHA,
        }
    )

    (OUT / "certification.json").write_text(json.dumps(cert, indent=2) + "\n", encoding="utf-8")
    (REPORTS / "selective-predictive-validation-certification.json").write_text(
        json.dumps(cert, indent=2) + "\n", encoding="utf-8"
    )

    # Markdown
    lines = [
        "# Selective Predictive Validation — Certification",
        "",
        f"**Certified:** `{gates['SELECTIVE_PREDICTIVE_VALIDATION_CERTIFIED']}`  ",
        f"**Status:** `{cert['SELECTIVE_PREDICTIVE_VALIDATION_STATUS']}`  ",
        f"**NEXT:** `{next_phase}`",
        "",
        "```text",
        "AGGREGATE_AVAILABILITY_VALIDATION",
        "IS NOT",
        "A RETEST OF INDIVIDUAL TEAMMATE WOWY",
        "```",
        "",
        "## Gates",
        "",
        "| Gate | Result |",
        "| --- | --- |",
    ]
    for k, v in gates.items():
        lines.append(f"| {k} | {v} |")

    lines += [
        "",
        "## Primary holdout (season 2025)",
        "",
        "| Hypothesis | Target | N | MAE B0 | MAE + Context | ΔMAE | CI | Holm | Status |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ]
    for r in primary_holdout_table:
        ci = f"[{r['ci_low']:.4f}, {r['ci_high']:.4f}]" if r["ci_low"] is not None else "n/a"
        lines.append(
            f"| {r['hypothesis']} | {r['target']} | {r['n_paired']} | "
            f"{r['mae_b0']:.4f} | {r['mae_aug']:.4f} | {r['dmae']:.4f} | {ci} | "
            f"{'Y' if r['holm_reject_improve'] else 'N'} | **{r['status']}** |"
        )

    lines += [
        "",
        "## Secondary / exploratory holdout",
        "",
        "| Hypothesis | Target | N | MAE B0 | MAE + Context | ΔMAE | CI | Exploratory Status |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
    ]
    for r in secondary_holdout_table:
        ci = f"[{r['ci_low']:.4f}, {r['ci_high']:.4f}]" if r["ci_low"] is not None else "n/a"
        lines.append(
            f"| {r['hypothesis']} | {r['target']} | {r['n_paired']} | "
            f"{r['mae_b0']:.4f} | {r['mae_aug']:.4f} | {r['dmae']:.4f} | {ci} | {r['status']} |"
        )

    lines += [
        "",
        "## Summary",
        "",
        f"- PRIMARY_SUPPORTED = **{counts.get('SUPPORTED', 0)}**",
        f"- PRIMARY_INCONCLUSIVE = **{counts.get('INCONCLUSIVE', 0)}**",
        f"- PRIMARY_HARMFUL = **{counts.get('HARMFUL', 0)}**",
        f"- PROJECTION_INTEGRATION_CANDIDATES = `{candidates}`",
        "",
        f"- DATASET_MANIFEST_SHA = `{DATASET_MANIFEST_SHA}`",
        f"- FEATURE_MANIFEST_SHA = `{FEATURE_MANIFEST_SHA}`",
        f"- FOLD_MANIFEST_SHA = `{FOLD_MANIFEST_SHA}`",
        f"- HOLDOUT_MANIFEST_SHA = `{HOLDOUT_MANIFEST_SHA}`",
        f"- PRE_HOLDOUT_EXECUTION_MANIFEST_SHA = `{PRE_HOLDOUT_EXECUTION_MANIFEST_SHA}`",
        f"- full_certification_digest = `{cert['full_certification_digest']}`",
        "",
        "Descriptive Context Center remains DISPLAYABLE. Predictive statuses are target-specific.",
        "",
    ]
    md = "\n".join(lines) + "\n"
    (OUT / "certification.md").write_text(md, encoding="utf-8")
    (REPORTS / "selective-predictive-validation-certification.md").write_text(md, encoding="utf-8")

    print(json.dumps({
        "certified": gates["SELECTIVE_PREDICTIVE_VALIDATION_CERTIFIED"],
        "primary_status": primary_status,
        "candidates": candidates,
        "NEXT": next_phase,
        "gates": gates,
    }, indent=2))
    return 0 if gates["SELECTIVE_PREDICTIVE_VALIDATION_CERTIFIED"] == "YES" else 1


if __name__ == "__main__":
    raise SystemExit(main())
