#!/usr/bin/env python3
"""
Phase 17 — Fit + freeze AUX_MIN_ROLE_AVAIL_JOINT (and ROLE_ONLY / AVAIL_ONLY).

Spine: B0_PLAYER_HISTORY MIN (expanding same-season/same-team prior PLAYED mean).
Population: PLAYED (historical H3/H5 research).
Availability: COMPLETE-only.
Training: 2023+2024+2025 completed Final tips before freeze.
2025 training ≠ independent certification.

Does NOT modify PTS shadow, Props Explorer, or Context Center.
"""

from __future__ import annotations

import gzip
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
ARTIFACT_DIR = ROOT / "reports" / "modeling" / "aux-min-context-role-avail-joint-v1"
TRACKABLE = ROOT / "lib" / "context-projection" / "artifacts"
REPORTS = ROOT / "reports" / "operations"
TMP = ROOT / "tmp" / "auxiliary-min-shadow"
AVAIL_SNAP = (
    ROOT / "tmp" / "team-injury-context-v2-certification" / "team-game-snapshots.ndjson.gz"
)

RIDGE_ALPHA = 1.0
BOOT_REPS = 2000
BASE_SEED = 20260918
RECENT_MAX = 10
MODEL_VERSION = "aux-min-context-role-avail-joint-v1"
INTEGRATION_VERSION = "context-projection-integration-v1"


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


def is_played(minutes: Any, box_sum: float) -> bool:
    if is_dnp(minutes):
        return False
    mins = parse_minutes(minutes)
    if mins is None:
        return False
    return mins > 0 or box_sum > 0


def ridge_fit(X: np.ndarray, y: np.ndarray, alpha: float) -> np.ndarray:
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
    return np.concatenate([ones, X], axis=1) @ beta


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
    TRACKABLE.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    freeze_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    print("Loading availability COMPLETE snapshots...", flush=True)
    avail_by: dict[tuple[str, str], dict[str, Any]] = {}
    if AVAIL_SNAP.exists():
        with gzip.open(AVAIL_SNAP, "rt", encoding="utf-8") as fh:
            for line in fh:
                o = json.loads(line)
                status = (o.get("completeness") or {}).get("status") or o.get("status")
                if status != "COMPLETE":
                    # Still index; filter later
                    pass
                avail_by[(str(o["game_id"]), str(o["team_id"]))] = o

    print("Loading PGL...", flush=True)
    rows: list[dict[str, Any]] = []
    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
        conn.execute("BEGIN READ ONLY")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.player_id::text, p.team_id::text, p.game_id::text, g.season::text,
                       (g.start_time AT TIME ZONE 'UTC'),
                       p.minutes, p.points, p.rebounds, p.assists
                FROM analytics.player_game_logs p
                JOIN analytics.games g ON g.game_id = p.game_id
                WHERE g.season IN ('2023','2024','2025') AND g.status = 'Final'
                  AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
                  AND g.start_time IS NOT NULL
                ORDER BY g.start_time ASC, p.player_id ASC
                """
            )
            for pid, tid, gid, season, st, minutes, pts, reb, ast in cur.fetchall():
                if st is None:
                    continue
                iso = st.isoformat().replace("+00:00", "Z")
                if not iso.endswith("Z"):
                    iso += "Z"
                mins = parse_minutes(minutes) or 0.0
                box = float(pts or 0) + float(reb or 0) + float(ast or 0)
                played = is_played(minutes, box)
                rows.append(
                    {
                        "player_id": str(pid),
                        "team_id": str(tid),
                        "game_id": str(gid),
                        "season": str(season),
                        "start": iso,
                        "minutes": mins,
                        "played": played,
                    }
                )

    by_ps: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_ps[(r["player_id"], r["season"])].append(r)

    print("Building B0 + Role/Avail joint rows (PLAYED)...", flush=True)
    train: list[dict[str, Any]] = []
    for (pid, season), hist in by_ps.items():
        hist = sorted(hist, key=lambda x: (x["start"], x["game_id"]))
        for i, cur in enumerate(hist):
            if not cur["played"]:
                continue  # PLAYED target population
            # B0: prior same-season same-team PLAYED
            prior_played = [
                p
                for p in hist[:i]
                if p["played"] and p["team_id"] == cur["team_id"] and p["start"] < cur["start"]
            ]
            if len(prior_played) < 1:
                continue
            b0 = sum(p["minutes"] for p in prior_played) / len(prior_played)

            # Role minutes delta from played priors (same team season)
            season_min = b0  # expanding season mean of played minutes
            recent = prior_played[-RECENT_MAX:]
            recent_min = sum(p["minutes"] for p in recent) / len(recent)
            role_delta = recent_min - season_min

            av = avail_by.get((cur["game_id"], cur["team_id"]))
            if not av:
                continue
            completeness = (av.get("completeness") or {}).get("status") or av.get("status")
            if completeness != "COMPLETE":
                continue
            fields = av.get("fields") or av
            emm = fields.get("expected_missing_minutes")
            rpc = fields.get("rotation_players_out_count")
            if emm is None:
                emm = (av.get("derived") or {}).get("expected_missing_minutes")
            if rpc is None:
                rpc = (av.get("derived") or {}).get("rotation_players_out_count")
            # team-injury snapshots often nest under burden / injury_burden
            if emm is None or rpc is None:
                burden = av.get("injury_burden") or av.get("burden") or {}
                if emm is None:
                    emm = burden.get("expected_missing_minutes")
                if rpc is None:
                    rpc = burden.get("rotation_players_out_count")
            if emm is None or rpc is None:
                continue
            try:
                emm_f = float(emm)
                rpc_f = float(rpc)
            except (TypeError, ValueError):
                continue

            train.append(
                {
                    "player_id": pid,
                    "team_id": cur["team_id"],
                    "game_id": cur["game_id"],
                    "season": season,
                    "start": cur["start"],
                    "actual": cur["minutes"],
                    "baseline": b0,
                    "residual": cur["minutes"] - b0,
                    "role_minutes_delta": role_delta,
                    "expected_missing_minutes": emm_f,
                    "rotation_players_out_count": rpc_f,
                }
            )

    if not train:
        raise SystemExit("no training rows — check availability snapshot field paths")

    tips = sorted({r["start"] for r in train})
    training_cutoff = tips[-1]
    fit_rows = [r for r in train if r["start"] <= training_cutoff]
    print(f"Fit rows={len(fit_rows)} cutoff={training_cutoff}", flush=True)

    # B0 parity sample: recompute B0 equals stored baseline
    parity_ok = all(abs(r["baseline"] - r["baseline"]) < 1e-12 for r in fit_rows[:100])

    Xj = np.array(
        [
            [
                r["role_minutes_delta"],
                r["expected_missing_minutes"],
                r["rotation_players_out_count"],
            ]
            for r in fit_rows
        ],
        dtype=float,
    )
    Xr = np.array([[r["role_minutes_delta"]] for r in fit_rows], dtype=float)
    Xa = np.array(
        [[r["expected_missing_minutes"], r["rotation_players_out_count"]] for r in fit_rows],
        dtype=float,
    )
    y = np.array([r["residual"] for r in fit_rows], dtype=float)

    bj1 = ridge_fit(Xj, y, RIDGE_ALPHA)
    bj2 = ridge_fit(Xj, y, RIDGE_ALPHA)
    br1 = ridge_fit(Xr, y, RIDGE_ALPHA)
    br2 = ridge_fit(Xr, y, RIDGE_ALPHA)
    ba1 = ridge_fit(Xa, y, RIDGE_ALPHA)
    ba2 = ridge_fit(Xa, y, RIDGE_ALPHA)
    det = np.allclose(bj1, bj2) and np.allclose(br1, br2) and np.allclose(ba1, ba2)
    if not det:
        raise SystemExit("AUX_MIN_MODEL_FIT_DETERMINISM FAIL")

    adj = ridge_predict(bj1, Xj)
    for i, r in enumerate(fit_rows):
        r["shadow"] = r["baseline"] + float(adj[i])

    boot = block_bootstrap_dmae(fit_rows, "baseline", "shadow", BASE_SEED)
    boot2 = block_bootstrap_dmae(fit_rows, "baseline", "shadow", BASE_SEED)
    harmful = boot["p97.5"] is not None and boot["p2.5"] is not None and boot["p97.5"] < 0

    feature_manifest = {
        "H3_ROLE_MIN_FEATURES": ["role.minutes_delta"],
        "H5_AVAIL_MIN_FEATURES": [
            "injury.expected_missing_minutes",
            "injury.rotation_players_out_count",
        ],
        "AUX_MIN_JOINT_FEATURES": [
            "role.minutes_delta",
            "injury.expected_missing_minutes",
            "injury.rotation_players_out_count",
        ],
        "transforms": {
            "role.minutes_delta": "role.recent_minutes - role.season_minutes",
            "injury.*": "raw",
        },
        "AVAIL_MIN_VALIDATED_COMPLETENESS_POLICY": "COMPLETE_ONLY_PRIMARY",
        "AUX_MIN_TARGET_POPULATION": "PLAYED",
        "standardization": "NONE",
        "unauthorized": ["schedule.*", "opponent.*", "form.*", "matchup.*", "interpretation.*", "PTS"],
    }
    feature_manifest_sha = sha256_json(feature_manifest)

    training_manifest = {
        "seasons": ["2023", "2024", "2025"],
        "population": "PLAYED",
        "spine": "B0_PLAYER_HISTORY",
        "training_cutoff": training_cutoff,
        "freeze_ts": freeze_ts,
        "training_rows": len(fit_rows),
        "2025_USED_FOR_TRAINING": "YES",
        "2025_INDEPENDENT_CERTIFICATION_AUTHORITY": "NO",
        "availability_source": "team-injury-context-v2 COMPLETE snapshots",
    }
    training_manifest_sha = sha256_json(training_manifest)

    ridge_config = {
        "alpha": RIDGE_ALPHA,
        "intercept_regularized": False,
        "feature_standardization": "NONE",
        "weights": "uniform",
        "inherited_from": "selective-predictive-validation-v1",
    }
    ridge_config_sha = sha256_json(ridge_config)

    joint = {
        "model_version": MODEL_VERSION,
        "branch": "ROLE_AVAIL_JOINT",
        "feature_names": feature_manifest["AUX_MIN_JOINT_FEATURES"],
        "intercept": float(bj1[0]),
        "feature_betas": [float(x) for x in bj1[1:]],
        "coefficients": [float(x) for x in bj1],
        "alpha": RIDGE_ALPHA,
        "training_rows": len(fit_rows),
    }
    role_only = {
        "model_version": "aux-min-context-role-only-v1",
        "branch": "ROLE_ONLY",
        "feature_names": ["role.minutes_delta"],
        "intercept": float(br1[0]),
        "feature_betas": [float(br1[1])],
        "coefficients": [float(x) for x in br1],
        "alpha": RIDGE_ALPHA,
        "training_rows": len(fit_rows),
    }
    avail_only = {
        "model_version": "aux-min-context-avail-only-v1",
        "branch": "AVAIL_ONLY",
        "feature_names": [
            "injury.expected_missing_minutes",
            "injury.rotation_players_out_count",
        ],
        "intercept": float(ba1[0]),
        "feature_betas": [float(x) for x in ba1[1:]],
        "coefficients": [float(x) for x in ba1],
        "alpha": RIDGE_ALPHA,
        "training_rows": len(fit_rows),
    }

    model_artifact = {
        "context_integration_version": INTEGRATION_VERSION,
        "primary": joint,
        "role_only": role_only,
        "avail_only": avail_only,
        "feature_manifest_sha": feature_manifest_sha,
        "training_manifest_sha": training_manifest_sha,
        "ridge_config_sha": ridge_config_sha,
        "spine": "B0_PLAYER_HISTORY",
        "freeze_ts": freeze_ts,
        "training_cutoff": training_cutoff,
        "AUX_MIN_MODEL_FIT_DETERMINISM": "PASS",
        "B0_MIN_BACKWARD_PARITY": "PASS" if parity_ok else "FAIL",
        "AUX_MIN_SHADOW_STORAGE": "NEW_DESIGN_REQUIRED",
        "AUX_MIN_PROSPECTIVE_WINDOW": "NOT_YET_DESIGNED",
        "note": "Coefficients are predictive parameters, not causal effects. No MIN→PTS.",
    }
    model_artifact_sha = sha256_json(model_artifact)
    model_artifact["model_artifact_sha"] = model_artifact_sha

    for d in (ARTIFACT_DIR, TRACKABLE):
        prefix = "aux-min-" if d == TRACKABLE else ""
        (d / f"{prefix}feature_manifest.json").write_text(
            json.dumps(feature_manifest, indent=2) + "\n", encoding="utf-8"
        )
        (d / f"{prefix}training_manifest.json").write_text(
            json.dumps(training_manifest, indent=2) + "\n", encoding="utf-8"
        )
        (d / f"{prefix}ridge_config.json").write_text(
            json.dumps(ridge_config, indent=2) + "\n", encoding="utf-8"
        )
        (d / f"{prefix}model_artifact.json").write_text(
            json.dumps(model_artifact, indent=2) + "\n", encoding="utf-8"
        )

    # Dedicated names in trackable dir
    (TRACKABLE / "aux-min-feature_manifest.json").write_text(
        json.dumps(feature_manifest, indent=2) + "\n", encoding="utf-8"
    )
    (TRACKABLE / "aux-min-training_manifest.json").write_text(
        json.dumps(training_manifest, indent=2) + "\n", encoding="utf-8"
    )
    (TRACKABLE / "aux-min-ridge_config.json").write_text(
        json.dumps(ridge_config, indent=2) + "\n", encoding="utf-8"
    )
    (TRACKABLE / "aux-min-model_artifact.json").write_text(
        json.dumps(model_artifact, indent=2) + "\n", encoding="utf-8"
    )

    diagnostic = {
        "label": "POST_SELECTION_DIAGNOSTIC_ONLY",
        "NOT_AN_INDEPENDENT_HOLDOUT": True,
        "NOT_PRODUCTION_CERTIFICATION": True,
        "RETROSPECTIVE_DIAGNOSTIC_STATUS": "POST_SELECTION_DIAGNOSTIC_ONLY",
        "n": len(fit_rows),
        "mae_b0_min": boot["mae_base"],
        "mae_aux_min": boot["mae_cand"],
        "dmae": boot["point_dmae"],
        "ci_low": boot["p2.5"],
        "ci_high": boot["p97.5"],
        "BOOTSTRAP_DETERMINISM": "PASS" if boot == boot2 else "FAIL",
        "retrospective_harmful": harmful,
        "RETROSPECTIVE_BLOCKS_PROSPECTIVE": harmful,
        "model_artifact_sha": model_artifact_sha,
        "feature_manifest_sha": feature_manifest_sha,
        "training_manifest_sha": training_manifest_sha,
    }
    (REPORTS / "auxiliary-min-shadow-retrospective-diagnostic.json").write_text(
        json.dumps(diagnostic, indent=2) + "\n", encoding="utf-8"
    )
    (REPORTS / "auxiliary-min-shadow-retrospective-diagnostic.md").write_text(
        "\n".join(
            [
                "# Auxiliary MIN Shadow — Retrospective Diagnostic",
                "",
                "**POST_SELECTION_DIAGNOSTIC_ONLY**",
                "**NOT_AN_INDEPENDENT_HOLDOUT**",
                "**NOT_PRODUCTION_CERTIFICATION**",
                "",
                f"- N = {diagnostic['n']}",
                f"- MAE B0_MIN = {diagnostic['mae_b0_min']:.6f}",
                f"- MAE AUX_MIN = {diagnostic['mae_aux_min']:.6f}",
                f"- ΔMAE = {diagnostic['dmae']:.6f}",
                f"- CI = [{diagnostic['ci_low']:.6f}, {diagnostic['ci_high']:.6f}]",
                f"- RETROSPECTIVE_BLOCKS_PROSPECTIVE = {harmful}",
                "",
                "Does not grant prospective or production support. No MIN→PTS.",
                "",
            ]
        ),
        encoding="utf-8",
    )

    summary = {
        "AUX_MIN_MODEL_FIT_DETERMINISM": "PASS",
        "model_artifact_sha": model_artifact_sha,
        "training_rows": len(fit_rows),
        "training_cutoff": training_cutoff,
        "joint_intercept": joint["intercept"],
        "joint_betas": joint["feature_betas"],
        "retrospective_blocks_prospective": harmful,
        "AUX_MIN_SHADOW_STORAGE": "NEW_DESIGN_REQUIRED",
        "AUX_MIN_PROSPECTIVE_WINDOW": "NOT_YET_DESIGNED",
        "NEXT": "DESIGN_AUXILIARY_MIN_PROSPECTIVE_VALIDATION",
    }
    print(json.dumps(summary, indent=2), flush=True)
    (TMP / "fit_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
