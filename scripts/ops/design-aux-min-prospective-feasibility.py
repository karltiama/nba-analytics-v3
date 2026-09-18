#!/usr/bin/env python3
"""
Phase 18A DESIGN-ONLY feasibility / sample-size audit for auxiliary MIN prospective validation.
Does NOT refit the model. Does NOT create prospective rows.
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
OUT = ROOT / "tmp" / "auxiliary-min-prospective-validation-design"
AVAIL_SNAP = (
    ROOT / "tmp" / "team-injury-context-v2-certification" / "team-game-snapshots.ndjson.gz"
)
ARTIFACT = (
    ROOT
    / "lib"
    / "context-projection"
    / "artifacts"
    / "aux-min-model_artifact.json"
)

BOOT_REPS = 800  # design-stage; certification remains 2000
BASE_SEED = 20260918
RECENT_MAX = 10
CANDIDATE_NS = [250, 500, 750, 1000]
# Precision target: 95% CI half-width for ΔMAE (minutes). Not tuned to make +0.36 "pass".
TARGET_HALFWIDTH = 0.12


def load_dotenv() -> None:
    if not DOTENV.exists():
        return
    for line in DOTENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


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
    """Canonical PLAYED: minutes token '00' always DNP; else mins>0 or token 0/0.0 with box."""
    if is_dnp(minutes):
        return False
    mins = parse_minutes(minutes)
    if mins is None:
        return False
    return mins > 0 or box_sum > 0


def ridge_predict(beta: np.ndarray, X: np.ndarray) -> np.ndarray:
    ones = np.ones((X.shape[0], 1))
    return np.concatenate([ones, X], axis=1) @ beta


def percentile(xs: list[float], q: float) -> float:
    ys = sorted(xs)
    if not ys:
        return float("nan")
    idx = (len(ys) - 1) * q
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return ys[lo]
    return ys[lo] * (hi - idx) + ys[hi] * (idx - lo)


def block_boot_halfwidth(rows: list[dict[str, Any]], seed: int) -> dict[str, float]:
    blocks: dict[tuple[str, str], list[float]] = {}
    for r in rows:
        bk = (r["player_id"], r["game_id"])
        eb = abs(r["baseline"] - r["actual"])
        ec = abs(r["shadow"] - r["actual"])
        if bk not in blocks:
            blocks[bk] = [0.0, 0.0, 0.0]
        blocks[bk][0] += 1.0
        blocks[bk][1] += eb
        blocks[bk][2] += ec
    keys = sorted(blocks.keys())
    n = len(keys)
    wsums = [blocks[k][0] for k in keys]
    base_ae = [blocks[k][1] for k in keys]
    cand_ae = [blocks[k][2] for k in keys]
    tw = sum(wsums)
    point = sum(base_ae) / tw - sum(cand_ae) / tw
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
    lo = percentile(deltas, 0.025)
    hi = percentile(deltas, 0.975)
    return {"point": point, "halfwidth": (hi - lo) / 2.0, "ci_low": lo, "ci_high": hi, "n_blocks": float(n)}


def main() -> None:
    load_dotenv()
    import psycopg

    OUT.mkdir(parents=True, exist_ok=True)
    art = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    beta = np.array(art["primary"]["coefficients"], dtype=float)

    print("Loading availability...", flush=True)
    avail_by: dict[tuple[str, str], dict[str, Any]] = {}
    with gzip.open(AVAIL_SNAP, "rt", encoding="utf-8") as fh:
        for line in fh:
            o = json.loads(line)
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
                WHERE g.season IN ('2023','2024','2025') AND g.status='Final'
                  AND g.home_score IS NOT NULL AND g.start_time IS NOT NULL
                ORDER BY g.start_time ASC
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
                rows.append(
                    {
                        "player_id": str(pid),
                        "team_id": str(tid),
                        "game_id": str(gid),
                        "season": str(season),
                        "start": iso,
                        "minutes": mins,
                        "played": is_played(minutes, box),
                        "dnp": is_dnp(minutes),
                    }
                )

    by_ps: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_ps[(r["player_id"], r["season"])].append(r)

    # Reconstruct joint pregame-eligible candidates (same as Phase 17 fit eligibility)
    # and record eventual PLAYED vs DNP for rate estimates.
    candidates: list[dict[str, Any]] = []
    for (pid, season), hist in by_ps.items():
        hist = sorted(hist, key=lambda x: (x["start"], x["game_id"]))
        for i, cur in enumerate(hist):
            prior_played = [
                p
                for p in hist[:i]
                if p["played"] and p["team_id"] == cur["team_id"] and p["start"] < cur["start"]
            ]
            if len(prior_played) < 1:
                continue
            b0 = sum(p["minutes"] for p in prior_played) / len(prior_played)
            recent = prior_played[-RECENT_MAX:]
            role_delta = sum(p["minutes"] for p in recent) / len(recent) - b0
            av = avail_by.get((cur["game_id"], cur["team_id"]))
            if not av:
                continue
            if (av.get("completeness") or {}).get("status") != "COMPLETE":
                continue
            burden = av.get("injury_burden") or {}
            emm = burden.get("expected_missing_minutes")
            rpc = burden.get("rotation_players_out_count")
            if emm is None or rpc is None:
                continue
            X = np.array([[role_delta, float(emm), float(rpc)]], dtype=float)
            adj = float(ridge_predict(beta, X)[0])
            candidates.append(
                {
                    "player_id": pid,
                    "game_id": cur["game_id"],
                    "team_id": cur["team_id"],
                    "start": cur["start"],
                    "season": season,
                    "baseline": b0,
                    "shadow": b0 + adj,
                    "actual": cur["minutes"],
                    "played": cur["played"],
                    "dnp": cur["dnp"],
                }
            )

    candidates.sort(key=lambda r: (r["start"], r["game_id"], r["player_id"]))
    played = [c for c in candidates if c["played"]]
    dnp = [c for c in candidates if c["dnp"]]

    # Games / calendar density (2024 season subset as typical)
    games_2024 = {c["game_id"] for c in candidates if c["season"] == "2024"}
    starts_2024 = sorted({c["start"][:10] for c in candidates if c["season"] == "2024"})
    # approx unique game-days
    n_gamedays_2024 = len(starts_2024)
    # candidate rows per game
    from collections import Counter

    per_game = Counter(c["game_id"] for c in candidates)
    avg_cand_per_game = sum(per_game.values()) / max(len(per_game), 1)
    played_rate = len(played) / max(len(candidates), 1)
    # Among pregame joint candidates, eventual PLAYED rate
    # COMPLETE avail already required for candidates
    complete_joint_n = len(candidates)

    # For each candidate N: take first N PLAYED in tip order; estimate CI half-width
    # Also estimate how many pregame preds needed: N / played_rate
    size_table = []
    for n in CANDIDATE_NS:
        cohort = played[:n]
        if len(cohort) < n:
            size_table.append({"n": n, "status": "INSUFFICIENT_HISTORICAL_PLAYED"})
            continue
        # replicate 5 random contiguous windows to see halfwidth stability
        halfs = []
        for k in range(5):
            start = (k * 2000) % max(1, len(played) - n)
            window = played[start : start + n]
            hw = block_boot_halfwidth(window, BASE_SEED + n + k)
            halfs.append(hw["halfwidth"])
        # primary window: first N in chronological order (protocol-aligned)
        primary = block_boot_halfwidth(cohort, BASE_SEED + n)
        games_needed_pregame = n / played_rate
        calendar_games_est = games_needed_pregame / avg_cand_per_game
        # rough: ~10–15 games/night in season → nights
        nights_est = calendar_games_est / 12.0
        size_table.append(
            {
                "n_resolved_played": n,
                "primary_point_dmae": primary["point"],
                "primary_ci_halfwidth": primary["halfwidth"],
                "primary_ci": [primary["ci_low"], primary["ci_high"]],
                "halfwidth_window_mean": sum(halfs) / len(halfs),
                "halfwidth_window_max": max(halfs),
                "meets_target_halfwidth_012": primary["halfwidth"] <= TARGET_HALFWIDTH,
                "est_pregame_predictions_needed": games_needed_pregame,
                "est_nba_games_spanned": calendar_games_est,
                "est_slate_nights_at_12_games": nights_est,
                "n_blocks": primary["n_blocks"],
            }
        )

    # Select N: smallest grid point where BOTH
    #   (a) chronological first-N primary half-width ≤ TARGET
    #   (b) mean half-width across contiguous historical windows ≤ TARGET
    # Not tuned to make retrospective +0.36 significant; deliberately not copied from PTS N=500.
    for row in size_table:
        if "primary_ci_halfwidth" in row:
            row["meets_dual_precision"] = bool(
                row.get("meets_target_halfwidth_012")
                and row.get("halfwidth_window_mean", 999) <= TARGET_HALFWIDTH
            )
        else:
            row["meets_dual_precision"] = False

    selected = None
    for row in size_table:
        if row.get("meets_dual_precision"):
            selected = row["n_resolved_played"]
            break
    if selected is None:
        selected = 1000  # fallback max grid

    # Rationale: precision-first, not significance of retrospective +0.36
    feasibility = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model_artifact_sha": art.get("model_artifact_sha"),
        "design_stage_only": True,
        "PLAYED_DEFINITION": {
            "source": "lib/wowy/appearance.ts classifyWowyAppearance (canonical WOWY/PGL)",
            "rule": 'minutes token "00" => dnp; minutes>0 => played; token "0"/"0.0" => played (0-min appearance); DNP not scored as 0-minute primary target',
            "PLAYED_STATUS_USED_AS_MODEL_FEATURE": False,
            "PLAYED_STATUS_USED_FOR_TARGET_POPULATION_RESOLUTION": True,
        },
        "universe": {
            "pregame_joint_complete_candidates": complete_joint_n,
            "eventual_played": len(played),
            "eventual_dnp": len(dnp),
            "played_resolution_rate": played_rate,
            "avg_joint_candidates_per_game": avg_cand_per_game,
            "unique_games": len(per_game),
            "gamedays_2024_approx": n_gamedays_2024,
            "unique_games_2024": len(games_2024),
            "est_played_per_game": avg_cand_per_game * played_rate,
            "est_played_per_slate_night_12_games": avg_cand_per_game * played_rate * 12.0,
        },
        "clustering": "SUBJECT_GAME_BLOCK (player_id, game_id)",
        "bootstrap_draws_design_stage": BOOT_REPS,
        "certification_bootstrap_draws_planned": 2000,
        "precision_target_halfwidth_minutes": TARGET_HALFWIDTH,
        "precision_rule": (
            "Select smallest N in {250,500,750,1000} such that chronological first-N "
            "PLAYED subject-game block-bootstrap 95% CI half-width <= 0.12 AND mean "
            "half-width across 5 contiguous historical windows <= 0.12. Not tuned to "
            "certify retrospective +0.36; not copied from PTS N=500."
        ),
        "candidate_table": size_table,
        "PROSPECTIVE_MIN_REQUIRED_N": selected,
        "N_DEFINITION": "resolved PLAYED primary observations (first N in prediction-time order after outcome resolution)",
        "pts_n_500_copied": False,
        "note_early_window_dmae": (
            "Chronological early windows can show negative ΔMAE; full retrospective "
            "ΔMAE≈+0.36 is post-selection diagnostic only and is NOT the certification estimand."
        ),
    }
    (OUT / "sample_size_feasibility.json").write_text(
        json.dumps(feasibility, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"selected_n": selected, "played_rate": played_rate, "candidates": complete_joint_n}, indent=2))


if __name__ == "__main__":
    main()
