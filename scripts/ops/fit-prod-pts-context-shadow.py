#!/usr/bin/env python3
"""
Phase 16B — Fit + freeze PROD_PTS_ROLE_FORM_JOINT (and ROLE_ONLY / FORM_ONLY).

Training: 2023+2024+2025 Final DNP-inclusive residuals vs Track B.1.
2025 used for future-facing training ≠ independent certification holdout.
Prospective certification = first 500 eligible shadow predictions.

Does NOT modify Props Explorer / Context Center / B0 historical statuses.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DOTENV = ROOT / ".env"
ARTIFACT_DIR = ROOT / "reports" / "modeling" / "prod-pts-context-role-form-joint-v1"
REPORTS = ROOT / "reports" / "operations"
TMP = ROOT / "tmp" / "pts-production-context-shadow"

RIDGE_ALPHA = 1.0
W_L5_MAX = 0.45
SAMPLE_FULL = 10
MINUTES_CV_DAMP = 0.35
STAT_CV_DAMP = 0.45
EPS_MEAN = 0.5
BOOT_REPS = 2000
BASE_SEED = 20260918
RECENT_MAX = 10

MODEL_VERSION = "prod-pts-context-role-form-joint-v1"
INTEGRATION_VERSION = "context-projection-integration-v1"
BASELINE_ID = "production_70_30"
BASELINE_VERSION = "court-context-model-lifecycle-c1.0"
WINDOW_ID = "prod-pts-context-v1-first500"


def load_dotenv() -> None:
    if not DOTENV.exists():
        return
    for line in DOTENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def sha256_json(obj: Any) -> str:
    raw = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def parse_minutes(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if s in ("", "null"):
        return None
    if ":" in s:
        parts = s.split(":")
        try:
            return float(parts[0]) + float(parts[1]) / 60.0
        except ValueError:
            return None
    try:
        return float(s)
    except ValueError:
        return None


def is_dnp(minutes: Any) -> bool:
    s = str(minutes).strip() if minutes is not None else ""
    return s in ("00", "0:00", "00:00")


def classify_played(minutes: Any, box_sum: float) -> bool:
    """Played for Role/Form priors (not DNP minutes=00)."""
    if is_dnp(minutes):
        return False
    mins = parse_minutes(minutes)
    if mins is None:
        return False
    return mins > 0 or box_sum > 0


def clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def track_a(l10: float, season: float) -> float:
    return 0.7 * l10 + 0.3 * season


def l5_weight(sample_n: int, minutes_cv: float | None, stat_cv: float | None) -> float:
    w = W_L5_MAX * clamp01(sample_n / SAMPLE_FULL)
    if minutes_cv is not None and minutes_cv > MINUTES_CV_DAMP:
        over = (minutes_cv - MINUTES_CV_DAMP) / (1 - MINUTES_CV_DAMP)
        w *= 1 - 0.55 * clamp01(over)
    if stat_cv is not None and stat_cv > STAT_CV_DAMP:
        over = (stat_cv - STAT_CV_DAMP) / max(0.5, 1 - STAT_CV_DAMP)
        w *= 1 - 0.45 * clamp01(over)
    return max(0.0, min(W_L5_MAX, w))


def cv(vals: list[float]) -> float | None:
    if len(vals) < 2:
        return None
    m = sum(vals) / len(vals)
    var = sum((x - m) ** 2 for x in vals) / (len(vals) - 1)
    sd = math.sqrt(max(var, 0.0))
    if abs(m) <= EPS_MEAN:
        return None
    return sd / abs(m)


def ridge_fit(X: np.ndarray, y: np.ndarray, alpha: float) -> np.ndarray:
    """Return beta [intercept, ...] intercept not regularized."""
    if X.shape[0] < 2:
        return np.zeros(X.shape[1] + 1)
    ones = np.ones((X.shape[0], 1))
    A = np.concatenate([ones, X], axis=1)
    p = A.shape[1]
    reg = alpha * np.eye(p)
    reg[0, 0] = 0.0
    try:
        return np.linalg.solve(A.T @ A + reg, A.T @ y)
    except np.linalg.LinAlgError:
        return np.linalg.lstsq(A.T @ A + reg, A.T @ y, rcond=None)[0]


def ridge_predict(beta: np.ndarray, X: np.ndarray) -> np.ndarray:
    ones = np.ones((X.shape[0], 1))
    A = np.concatenate([ones, X], axis=1)
    return A @ beta


def percentile(xs: list[float], q: float) -> float:
    if not xs:
        return float("nan")
    ys = sorted(xs)
    idx = (len(ys) - 1) * q
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return ys[lo]
    return ys[lo] * (hi - idx) + ys[hi] * (idx - lo)


def block_bootstrap_dmae(
    rows: list[dict[str, Any]], base_key: str, cand_key: str, seed: int
) -> dict[str, Any]:
    blocks: dict[tuple[str, str], list[float]] = {}
    for r in rows:
        bk = (r["player_id"], r["game_id"])
        eb = abs(r[base_key] - r["actual"])
        ec = abs(r[cand_key] - r["actual"])
        if bk not in blocks:
            blocks[bk] = [0.0, 0.0, 0.0]
        blocks[bk][0] += 1.0
        blocks[bk][1] += eb
        blocks[bk][2] += ec
    keys = sorted(blocks.keys())
    n = len(keys)
    if n == 0:
        return {"point_dmae": None, "p2.5": None, "p97.5": None, "mae_base": None, "mae_cand": None}
    wsums = [blocks[k][0] for k in keys]
    base_ae = [blocks[k][1] for k in keys]
    cand_ae = [blocks[k][2] for k in keys]
    tw = sum(wsums)
    mae_b = sum(base_ae) / tw
    mae_c = sum(cand_ae) / tw
    point = mae_b - mae_c
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
        "point_dmae": point,
        "p2.5": percentile(deltas, 0.025),
        "p97.5": percentile(deltas, 0.975),
        "mae_base": mae_b,
        "mae_cand": mae_c,
        "n_blocks": n,
    }


def main() -> None:
    load_dotenv()
    import psycopg

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    freeze_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    print("Loading Final PGL 2023-2025...", flush=True)
    # row: player, team, game, season, start, minutes_raw, pts, reb, ast, fga, played
    rows: list[dict[str, Any]] = []
    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.player_id::text, p.team_id::text, p.game_id::text, g.season::text,
                       (g.start_time AT TIME ZONE 'UTC'),
                       p.minutes, p.points, p.rebounds, p.assists,
                       p.field_goals_attempted
                FROM analytics.player_game_logs p
                JOIN analytics.games g ON g.game_id = p.game_id
                WHERE g.season IN ('2023','2024','2025') AND g.status = 'Final'
                  AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
                  AND g.start_time IS NOT NULL
                ORDER BY g.start_time ASC, p.player_id ASC
                """
            )
            for pid, tid, gid, season, st, minutes, pts, reb, ast, fga in cur.fetchall():
                if st is None:
                    continue
                iso = st.isoformat().replace("+00:00", "Z")
                if not iso.endswith("Z"):
                    iso += "Z"
                pts_f = float(pts or 0)
                box = pts_f + float(reb or 0) + float(ast or 0)
                rows.append(
                    {
                        "player_id": str(pid),
                        "team_id": str(tid),
                        "game_id": str(gid),
                        "season": str(season),
                        "start": iso,
                        "minutes": minutes,
                        "pts": pts_f,
                        "fga": float(fga or 0),
                        "played": classify_played(minutes, box),
                        "dnp": is_dnp(minutes),
                        "mins_num": parse_minutes(minutes) or 0.0,
                    }
                )

    # Group by player+season chronological
    by_ps: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_ps[(r["player_id"], r["season"])].append(r)
    for k in by_ps:
        by_ps[k].sort(key=lambda x: (x["start"], x["game_id"]))

    print("Building as-of Track B.1 + Role/Form deltas...", flush=True)
    train_joint: list[dict[str, Any]] = []
    for (pid, season), hist in by_ps.items():
        for i, cur in enumerate(hist):
            prior_all = hist[:i]  # DNP-inclusive Final priors
            if len(prior_all) < 1:
                continue  # need some season history for production eligibility analog
            # Production L10/L5/season from ALL prior Final logs (DNP zeros included)
            pts_all = [p["pts"] for p in prior_all]
            season_avg = sum(pts_all) / len(pts_all)
            last10 = pts_all[-10:] if len(pts_all) >= 1 else pts_all
            last5 = pts_all[-5:] if len(pts_all) >= 1 else pts_all
            l10 = sum(last10) / len(last10)
            l5 = sum(last5) / len(last5)
            # std10
            if len(last10) >= 2:
                m = l10
                var = sum((x - m) ** 2 for x in last10) / (len(last10) - 1)
                std10 = math.sqrt(max(var, 0.0))
            else:
                std10 = None
            window = prior_all[-10:]
            mins_nums = [p["mins_num"] for p in window]
            stat_vals = [p["pts"] for p in window]
            minutes_cv = cv(mins_nums) if len(mins_nums) >= 2 else None
            # minutes CV uses mean > EPS
            if minutes_cv is not None:
                mean_m = sum(mins_nums) / len(mins_nums)
                if mean_m <= EPS_MEAN:
                    minutes_cv = None
            stat_cv = cv(stat_vals)
            sample_n = len(window)
            w = l5_weight(sample_n, minutes_cv, stat_cv)
            base_a = track_a(l10, season_avg)
            baseline = (1 - w) * base_a + w * l5

            # Role/Form deltas from PLAYED-only priors (certified semantics)
            played_prior = [p for p in prior_all if p["played"]]
            if len(played_prior) < 1:
                continue
            season_fga = sum(p["fga"] for p in played_prior) / len(played_prior)
            season_pts = sum(p["pts"] for p in played_prior) / len(played_prior)
            recent_played = played_prior[-RECENT_MAX:]
            recent_fga = sum(p["fga"] for p in recent_played) / len(recent_played)
            recent_pts = sum(p["pts"] for p in recent_played) / len(recent_played)
            role_delta = recent_fga - season_fga
            form_delta = recent_pts - season_pts

            train_joint.append(
                {
                    "player_id": pid,
                    "team_id": cur["team_id"],
                    "game_id": cur["game_id"],
                    "season": season,
                    "start": cur["start"],
                    "actual": cur["pts"],
                    "baseline": baseline,
                    "residual": cur["pts"] - baseline,
                    "role_fga_delta": role_delta,
                    "form_points_delta": form_delta,
                    "dnp": cur["dnp"],
                    "played": cur["played"],
                }
            )

    # Training cutoff = last tip before freeze (all completed Final tips in corpus)
    if not train_joint:
        raise SystemExit("no training rows")
    tips = sorted({r["start"] for r in train_joint})
    training_cutoff = tips[-1]
    # All rows with start <= training_cutoff (all of them by construction)
    fit_rows = [r for r in train_joint if r["start"] <= training_cutoff]

    print(f"Fit rows={len(fit_rows)} training_cutoff={training_cutoff}", flush=True)

    Xj = np.array([[r["role_fga_delta"], r["form_points_delta"]] for r in fit_rows], dtype=float)
    Xr = np.array([[r["role_fga_delta"]] for r in fit_rows], dtype=float)
    Xf = np.array([[r["form_points_delta"]] for r in fit_rows], dtype=float)
    y = np.array([r["residual"] for r in fit_rows], dtype=float)

    beta_j1 = ridge_fit(Xj, y, RIDGE_ALPHA)
    beta_j2 = ridge_fit(Xj, y, RIDGE_ALPHA)
    beta_r1 = ridge_fit(Xr, y, RIDGE_ALPHA)
    beta_r2 = ridge_fit(Xr, y, RIDGE_ALPHA)
    beta_f1 = ridge_fit(Xf, y, RIDGE_ALPHA)
    beta_f2 = ridge_fit(Xf, y, RIDGE_ALPHA)

    model_fit_determinism = (
        np.allclose(beta_j1, beta_j2)
        and np.allclose(beta_r1, beta_r2)
        and np.allclose(beta_f1, beta_f2)
    )
    if not model_fit_determinism:
        raise SystemExit("MODEL_FIT_DETERMINISM FAIL")

    adj_j = ridge_predict(beta_j1, Xj)
    for i, r in enumerate(fit_rows):
        r["shadow"] = r["baseline"] + float(adj_j[i])
        r["B0"] = r["baseline"]
        r["AUG"] = r["shadow"]

    # Retrospective diagnostic (POST_SELECTION_DIAGNOSTIC_ONLY)
    boot = block_bootstrap_dmae(fit_rows, "baseline", "shadow", BASE_SEED)
    boot2 = block_bootstrap_dmae(fit_rows, "baseline", "shadow", BASE_SEED)
    bootstrap_determinism = boot == boot2

    played_rows = [r for r in fit_rows if r["played"]]
    dnp_rows = [r for r in fit_rows if r["dnp"]]
    boot_played = block_bootstrap_dmae(played_rows, "baseline", "shadow", BASE_SEED + 1)
    boot_dnp = block_bootstrap_dmae(dnp_rows, "baseline", "shadow", BASE_SEED + 2)

    harmful = (
        boot["p97.5"] is not None
        and boot["p2.5"] is not None
        and boot["p97.5"] < 0
    )
    retrospective_blocks_prospective = bool(harmful)

    feature_manifest = {
        "features": ["role.fga_delta", "form.points_delta"],
        "transforms": {
            "role.fga_delta": "role.recent_fga - role.season_fga",
            "form.points_delta": "form.recent_points - form.season_points",
        },
        "unauthorized": [
            "schedule.*",
            "opponent.*",
            "injury.*",
            "matchup.*",
            "interpretation.*",
            "H5_AVAIL_PTS",
        ],
        "standardization": "NONE",
    }
    feature_manifest_sha = sha256_json(feature_manifest)

    training_manifest = {
        "seasons": ["2023", "2024", "2025"],
        "population": "Final DNP-inclusive",
        "training_cutoff": training_cutoff,
        "freeze_ts": freeze_ts,
        "training_rows": len(fit_rows),
        "n_played": len(played_rows),
        "n_dnp": len(dnp_rows),
        "baseline": BASELINE_ID,
        "baseline_version": BASELINE_VERSION,
        "residual_target": "actual_pts - track_b1_pts",
        "2025_USED_FOR_FUTURE_FACING_TRAINING": "YES",
        "2025_USED_AS_INDEPENDENT_PRODUCTION_CERTIFICATION": "NO",
        "B0_RESIDUAL_COEFFICIENTS_IMPORTED": 0,
    }
    training_manifest_sha = sha256_json(training_manifest)

    ridge_config = {
        "alpha": RIDGE_ALPHA,
        "intercept_regularized": False,
        "feature_standardization": "NONE",
        "weights": "uniform",
    }
    ridge_config_sha = sha256_json(ridge_config)

    joint_model = {
        "model_version": MODEL_VERSION,
        "branch": "ROLE_FORM_JOINT",
        "feature_names": ["role.fga_delta", "form.points_delta"],
        "intercept": float(beta_j1[0]),
        "feature_betas": [float(beta_j1[1]), float(beta_j1[2])],
        "coefficients": [float(x) for x in beta_j1],
        "alpha": RIDGE_ALPHA,
        "training_rows": len(fit_rows),
    }
    role_model = {
        "model_version": "prod-pts-context-role-only-v1",
        "branch": "ROLE_ONLY",
        "feature_names": ["role.fga_delta"],
        "intercept": float(beta_r1[0]),
        "feature_betas": [float(beta_r1[1])],
        "coefficients": [float(x) for x in beta_r1],
        "alpha": RIDGE_ALPHA,
        "training_rows": len(fit_rows),
    }
    form_model = {
        "model_version": "prod-pts-context-form-only-v1",
        "branch": "FORM_ONLY",
        "feature_names": ["form.points_delta"],
        "intercept": float(beta_f1[0]),
        "feature_betas": [float(beta_f1[1])],
        "coefficients": [float(x) for x in beta_f1],
        "alpha": RIDGE_ALPHA,
        "training_rows": len(fit_rows),
    }

    model_artifact = {
        "context_integration_version": INTEGRATION_VERSION,
        "primary": joint_model,
        "role_only": role_model,
        "form_only": form_model,
        "feature_manifest_sha": feature_manifest_sha,
        "training_manifest_sha": training_manifest_sha,
        "ridge_config_sha": ridge_config_sha,
        "production_baseline_id": BASELINE_ID,
        "production_baseline_version": BASELINE_VERSION,
        "freeze_ts": freeze_ts,
        "training_cutoff": training_cutoff,
        "MODEL_FIT_DETERMINISM": "PASS" if model_fit_determinism else "FAIL",
        "DIRECT_B0_COEFFICIENT_PORT": "NO",
        "note": "Coefficients are predictive parameters, not causal effects.",
    }
    model_artifact_sha = sha256_json(model_artifact)
    model_artifact["model_artifact_sha"] = model_artifact_sha

    (ARTIFACT_DIR / "feature_manifest.json").write_text(
        json.dumps(feature_manifest, indent=2) + "\n", encoding="utf-8"
    )
    (ARTIFACT_DIR / "training_manifest.json").write_text(
        json.dumps(training_manifest, indent=2) + "\n", encoding="utf-8"
    )
    (ARTIFACT_DIR / "ridge_config.json").write_text(
        json.dumps(ridge_config, indent=2) + "\n", encoding="utf-8"
    )
    (ARTIFACT_DIR / "model_artifact.json").write_text(
        json.dumps(model_artifact, indent=2) + "\n", encoding="utf-8"
    )

    diagnostic = {
        "label": "POST_SELECTION_DIAGNOSTIC_ONLY",
        "NOT_AN_INDEPENDENT_HOLDOUT": True,
        "NOT_PRODUCTION_CERTIFICATION": True,
        "RETROSPECTIVE_DIAGNOSTIC_STATUS": "POST_SELECTION_DIAGNOSTIC_ONLY",
        "n_dnp_inclusive": len(fit_rows),
        "n_played": len(played_rows),
        "n_dnp": len(dnp_rows),
        "mae_baseline": boot["mae_base"],
        "mae_context": boot["mae_cand"],
        "dmae": boot["point_dmae"],
        "ci_low": boot["p2.5"],
        "ci_high": boot["p97.5"],
        "played_diagnostic": {
            "n": len(played_rows),
            "dmae": boot_played["point_dmae"],
            "ci": [boot_played["p2.5"], boot_played["p97.5"]],
        },
        "dnp_diagnostic": {
            "n": len(dnp_rows),
            "dmae": boot_dnp["point_dmae"],
            "ci": [boot_dnp["p2.5"], boot_dnp["p97.5"]],
        },
        "BOOTSTRAP_DETERMINISM": "PASS" if bootstrap_determinism else "FAIL",
        "retrospective_harmful": harmful,
        "RETROSPECTIVE_BLOCKS_PROSPECTIVE": retrospective_blocks_prospective,
        "model_artifact_sha": model_artifact_sha,
        "feature_manifest_sha": feature_manifest_sha,
        "training_manifest_sha": training_manifest_sha,
    }
    (REPORTS / "pts-production-context-shadow-retrospective-diagnostic.json").write_text(
        json.dumps(diagnostic, indent=2) + "\n", encoding="utf-8"
    )
    md = [
        "# PTS Production Context Shadow — Retrospective Diagnostic",
        "",
        "**POST_SELECTION_DIAGNOSTIC_ONLY**",
        "**NOT_AN_INDEPENDENT_HOLDOUT**",
        "**NOT_PRODUCTION_CERTIFICATION**",
        "",
        f"- N (DNP-inclusive) = {diagnostic['n_dnp_inclusive']}",
        f"- MAE baseline = {diagnostic['mae_baseline']:.6f}",
        f"- MAE context = {diagnostic['mae_context']:.6f}",
        f"- ΔMAE = {diagnostic['dmae']:.6f}",
        f"- CI = [{diagnostic['ci_low']:.6f}, {diagnostic['ci_high']:.6f}]",
        f"- PLAYED N/ΔMAE = {diagnostic['played_diagnostic']}",
        f"- DNP N/ΔMAE = {diagnostic['dnp_diagnostic']}",
        f"- RETROSPECTIVE_BLOCKS_PROSPECTIVE = {retrospective_blocks_prospective}",
        "",
        "A positive diagnostic does **not** grant PRODUCTION_SUPPORTED.",
        "Prospective certification source remains FIRST_500_ELIGIBLE_PRODUCTION_PTS_SHADOW_PREDICTIONS.",
        "",
    ]
    (REPORTS / "pts-production-context-shadow-retrospective-diagnostic.md").write_text(
        "\n".join(md) + "\n", encoding="utf-8"
    )

    # Prospective window manifest (committed)
    window_manifest = {
        "prospective_window_id": WINDOW_ID,
        "target": "PTS",
        "PRIMARY_PROSPECTIVE_PTS_CANDIDATE": "PROD_PTS_ROLE_FORM_JOINT",
        "PROSPECTIVE_REQUIRED_N": 500,
        "PROSPECTIVE_CURRENT_N": 0,
        "eligibility": "PRIMARY_ELIGIBLE requires ROLE_FORM_JOINT + valid pregame T-60 snapshot + frozen versions",
        "baseline_version_policy": "FIXED_DURING_CERTIFICATION_WINDOW",
        "production_baseline_id": BASELINE_ID,
        "production_baseline_version": BASELINE_VERSION,
        "context_model_version": MODEL_VERSION,
        "context_integration_version": INTEGRATION_VERSION,
        "model_artifact_sha": model_artifact_sha,
        "feature_manifest_sha": feature_manifest_sha,
        "training_manifest_sha": training_manifest_sha,
        "ridge_config_sha": ridge_config_sha,
        "training_cutoff": training_cutoff,
        "canonical_snapshot_policy": "LATEST_ELIGIBLE_AT_OR_BEFORE_T_MINUS_60",
        "metric": "MAE",
        "delta_sign": "MAE_PRODUCTION_BASELINE - MAE_CONTEXT_SHADOW",
        "bootstrap": {"method": "SUBJECT_GAME_BLOCK", "draws": 2000, "base_seed": BASE_SEED},
        "status_policy": {
            "PRODUCTION_SUPPORTED": "CI entirely > 0",
            "PRODUCTION_HARMFUL": "CI entirely < 0",
            "PRODUCTION_INCONCLUSIVE": "CI overlaps 0",
        },
        "no_refit": True,
        "HISTORICAL_ROWS_IN_PROSPECTIVE_WINDOW": 0,
        "RETROSPECTIVE_BLOCKS_PROSPECTIVE": retrospective_blocks_prospective,
        "PROSPECTIVE_STATUS": (
            "BLOCKED_BY_RETROSPECTIVE_HARMFUL"
            if retrospective_blocks_prospective
            else "READY_FOR_PROSPECTIVE_COLLECTION"
        ),
        "SHADOW_PERSISTENCE_DESTINATION": "analytics.prospective_shadow_predictions",
        "frozen_at": freeze_ts,
    }
    (REPORTS / "pts-production-context-prospective-window-v1.json").write_text(
        json.dumps(window_manifest, indent=2) + "\n", encoding="utf-8"
    )

    summary = {
        "MODEL_FIT_DETERMINISM": "PASS",
        "model_artifact_sha": model_artifact_sha,
        "training_rows": len(fit_rows),
        "training_cutoff": training_cutoff,
        "joint_intercept": joint_model["intercept"],
        "joint_betas": joint_model["feature_betas"],
        "retrospective_blocks_prospective": retrospective_blocks_prospective,
        "PROSPECTIVE_STATUS": window_manifest["PROSPECTIVE_STATUS"],
    }
    print(json.dumps(summary, indent=2), flush=True)
    (TMP / "fit_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
